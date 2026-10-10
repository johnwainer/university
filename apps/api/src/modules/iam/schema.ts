import type { Pool } from 'pg';
import { SECTIONS, SECTION_IDS } from './sections.js';

/**
 * Identidad y permisos del panel administrativo.
 *
 * Antes de esto el panel tenía UNA cuenta, leída de ADMIN_EMAIL/ADMIN_PASSWORD
 * del .env, y las sesiones vivían en un Map en memoria. Eso significaba tres
 * problemas: todo el que entraba era superadministrador, la contraseña se
 * compartía entre personas, y cada `pm2 restart` echaba a todo el mundo.
 *
 * Aquí se crean las tablas que sustituyen eso. La cuenta del .env no
 * desaparece: sigue funcionando como superadministrador de arranque, porque si
 * alguien se queda fuera por una configuración de permisos mal puesta tiene que
 * existir una puerta que no dependa de la base.
 *
 * Idempotente: se ejecuta en cada arranque.
 */
export async function migrateIam(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      key TEXT NOT NULL UNIQUE,
      name_es TEXT NOT NULL,
      name_en TEXT NOT NULL,
      description_es TEXT,
      description_en TEXT,
      -- Un rol de sistema no se puede borrar ni renombrar su clave. Protege a
      -- 'superadmin' de quedarse sin nadie dentro por un clic.
      is_system BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS admin_role_permissions (
      role_id UUID NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
      section TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'none' CHECK (level IN ('none','view','edit')),
      PRIMARY KEY (role_id, section)
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      -- scrypt: salt y hash separados, en hex. No se guarda la contraseña.
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role_id UUID REFERENCES admin_roles(id) ON DELETE RESTRICT,
      locale TEXT NOT NULL DEFAULT 'es' CHECK (locale IN ('es','en')),
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_login_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS admin_users_role_idx ON admin_users(role_id);

    -- Las sesiones pasan a la base para que sobrevivan a un reinicio de pm2.
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token TEXT PRIMARY KEY,
      admin_user_id UUID REFERENCES admin_users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS admin_sessions_expira_idx ON admin_sessions(expires_at);
  `);

  await sembrarRolesIniciales(pool);
  await limpiarSeccionesObsoletas(pool);
}

/**
 * Roles de arranque.
 *
 * Se siembran sólo si la tabla está vacía de ese rol. Nunca se reescriben los
 * permisos de un rol que ya existe: si el administrador ajustó la matriz a
 * mano, un despliegue posterior no debe deshacerlo.
 *
 * Los perfiles salen de cómo está repartido el trabajo en el proyecto: lo
 * académico, admisiones, acreditación, contenido y finanzas son equipos
 * distintos en TFU, y cada uno necesita editar lo suyo y poder consultar el
 * contexto del resto sin tocarlo.
 */
const ROLES_INICIALES: Array<{
  key: string;
  nameEs: string;
  nameEn: string;
  descEs: string;
  descEn: string;
  isSystem: boolean;
  /** '*' en edit significa todas las secciones. */
  edit: string[];
  view: string[];
}> = [
  {
    key: 'superadmin',
    nameEs: 'Superadministrador',
    nameEn: 'Super administrator',
    descEs: 'Acceso total, incluida la gestión de roles.',
    descEn: 'Full access, including role management.',
    isSystem: true,
    edit: ['*'],
    view: []
  },
  {
    key: 'academico',
    nameEs: 'Académico',
    nameEn: 'Academic',
    descEs: 'Expedientes, periodos, calendario y sílabos.',
    descEn: 'Records, terms, calendar and syllabi.',
    isSystem: false,
    edit: ['sis', 'calendar', 'compliance', 'courses'],
    view: ['overview', 'reports', 'users', 'cie', 'credentials']
  },
  {
    key: 'admisiones',
    nameEs: 'Admisiones',
    nameEn: 'Admissions',
    descEs: 'Prospectos, postulaciones y cuentas de estudiante.',
    descEn: 'Prospects, applications and student accounts.',
    isSystem: false,
    edit: ['crm', 'users'],
    view: ['overview', 'reports', 'courses', 'sis', 'calendar']
  },
  {
    key: 'acreditacion',
    nameEs: 'Acreditación',
    nameEn: 'Accreditation',
    descEs: 'Evidencia CIE, credenciales y cumplimiento.',
    descEn: 'CIE evidence, credentials and compliance.',
    isSystem: false,
    edit: ['cie', 'credentials', 'compliance'],
    view: ['overview', 'reports', 'sis', 'courses', 'calendar']
  },
  {
    key: 'contenido',
    nameEs: 'Contenido',
    nameEn: 'Content',
    descEs: 'Seminarios, podcasts y catálogo.',
    descEn: 'Webinars, podcasts and catalog.',
    isSystem: false,
    edit: ['webinars', 'podcasts', 'courses'],
    view: ['overview', 'reports']
  },
  {
    key: 'finanzas',
    nameEs: 'Finanzas',
    nameEn: 'Finance',
    descEs: 'Back-office, facturación y reportes.',
    descEn: 'Back-office, billing and reports.',
    isSystem: false,
    edit: ['backoffice', 'reports'],
    view: ['overview', 'sis', 'enterprise', 'users']
  },
  {
    key: 'lectura',
    nameEs: 'Solo lectura',
    nameEn: 'Read only',
    descEs: 'Puede consultar todo el panel y no cambiar nada.',
    descEn: 'Can read the whole panel and change nothing.',
    isSystem: false,
    // Todo menos 'roles': quien sólo mira no necesita ver quién tiene qué.
    edit: [],
    view: SECTION_IDS.filter((s) => s !== 'roles')
  }
];

async function sembrarRolesIniciales(pool: Pool): Promise<void> {
  for (const rol of ROLES_INICIALES) {
    const existe = await pool.query('SELECT id FROM admin_roles WHERE key = $1', [rol.key]);
    if (existe.rowCount && existe.rowCount > 0) continue;

    const creado = await pool.query(
      `INSERT INTO admin_roles (key, name_es, name_en, description_es, description_en, is_system)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [rol.key, rol.nameEs, rol.nameEn, rol.descEs, rol.descEn, rol.isSystem]
    );
    const roleId = creado.rows[0].id as string;

    const niveles = new Map<string, 'view' | 'edit'>();
    for (const s of rol.view) niveles.set(s, 'view');
    const editables = rol.edit.includes('*') ? SECTION_IDS : rol.edit;
    for (const s of editables) niveles.set(s, 'edit');

    for (const seccion of SECTION_IDS) {
      const nivel = niveles.get(seccion) ?? 'none';
      await pool.query(
        `INSERT INTO admin_role_permissions (role_id, section, level) VALUES ($1,$2,$3)
         ON CONFLICT (role_id, section) DO NOTHING`,
        [roleId, seccion, nivel]
      );
    }
  }

  // Un rol que ya existía no se toca, pero sí se le añaden en 'none' las
  // secciones nuevas que aparezcan con el tiempo. Sin esto, una sección nueva
  // no saldría en la matriz de los roles viejos y nadie podría concederla.
  for (const seccion of SECTION_IDS) {
    await pool.query(
      `INSERT INTO admin_role_permissions (role_id, section, level)
       SELECT id, $1, 'none' FROM admin_roles
       ON CONFLICT (role_id, section) DO NOTHING`,
      [seccion]
    );
  }
}

/** Borra permisos de secciones que ya no existen, para que la matriz no mienta. */
async function limpiarSeccionesObsoletas(pool: Pool): Promise<void> {
  await pool.query('DELETE FROM admin_role_permissions WHERE NOT (section = ANY($1))', [SECTION_IDS]);
}

export { SECTIONS };
