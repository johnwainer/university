import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Pool } from 'pg';
import { SECTION_IDS, type PermissionLevel } from './sections.js';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: string,
  keylen: number
) => Promise<Buffer>;

const LARGO_CLAVE = 64;

export type AdminIdentity = {
  /** null cuando es la cuenta de arranque del .env, que no vive en la base. */
  userId: string | null;
  email: string;
  fullName: string;
  roleKey: string;
  roleNameEs: string;
  roleNameEn: string;
  locale: 'es' | 'en';
  isBootstrap: boolean;
  permisos: Record<string, PermissionLevel>;
};

export type AdminSession = AdminIdentity & {
  token: string;
  createdAt: string;
  expiresAt: string;
};

export async function hashPassword(plano: string): Promise<{ salt: string; hash: string }> {
  const salt = randomBytes(16).toString('hex');
  const derivado = await scrypt(plano, salt, LARGO_CLAVE);
  return { salt, hash: derivado.toString('hex') };
}

export async function verifyPassword(plano: string, salt: string, hash: string): Promise<boolean> {
  const derivado = await scrypt(plano, salt, LARGO_CLAVE);
  const esperado = Buffer.from(hash, 'hex');
  // Longitudes distintas harían reventar timingSafeEqual en vez de devolver
  // false, así que se comprueba antes.
  if (esperado.length !== derivado.length) return false;
  return timingSafeEqual(derivado, esperado);
}

/** Permisos de la cuenta de arranque: todo en 'edit', sin pasar por la base. */
export function permisosSuperadmin(): Record<string, PermissionLevel> {
  const p: Record<string, PermissionLevel> = {};
  for (const s of SECTION_IDS) p[s] = 'edit';
  return p;
}

export async function permisosDeRol(pool: Pool, roleId: string): Promise<Record<string, PermissionLevel>> {
  const { rows } = await pool.query(
    'SELECT section, level FROM admin_role_permissions WHERE role_id = $1',
    [roleId]
  );
  const p: Record<string, PermissionLevel> = {};
  for (const s of SECTION_IDS) p[s] = 'none';
  for (const r of rows as Array<{ section: string; level: PermissionLevel }>) {
    if (s_valida(r.section)) p[r.section] = r.level;
  }
  return p;
}

function s_valida(section: string): boolean {
  return SECTION_IDS.includes(section);
}

/**
 * Comprueba credenciales contra la tabla de usuarios.
 * Devuelve null si no existe, está inactivo o la contraseña no cuadra: los tres
 * casos dan la misma respuesta a propósito, para no revelar qué correos existen.
 */
export async function autenticar(pool: Pool, email: string, password: string): Promise<AdminIdentity | null> {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.full_name, u.password_salt, u.password_hash, u.locale, u.is_active,
            u.role_id, r.key AS role_key, r.name_es, r.name_en
       FROM admin_users u
       LEFT JOIN admin_roles r ON r.id = u.role_id
      WHERE lower(u.email) = lower($1)`,
    [email]
  );
  if (!rows.length) return null;
  const u = rows[0];
  if (!u.is_active) return null;
  if (!(await verifyPassword(password, u.password_salt, u.password_hash))) return null;

  return {
    userId: u.id,
    email: u.email,
    fullName: u.full_name,
    roleKey: u.role_key ?? 'sin-rol',
    roleNameEs: u.name_es ?? 'Sin rol',
    roleNameEn: u.name_en ?? 'No role',
    locale: (u.locale === 'en' ? 'en' : 'es') as 'es' | 'en',
    isBootstrap: false,
    permisos: u.role_id ? await permisosDeRol(pool, u.role_id) : {}
  };
}

export async function crearSesion(pool: Pool, ident: AdminIdentity, ttlMinutos: number): Promise<AdminSession> {
  const token = randomBytes(32).toString('hex');
  const ahora = new Date();
  const expira = new Date(ahora.getTime() + ttlMinutos * 60000);
  await pool.query(
    `INSERT INTO admin_sessions (token, admin_user_id, email, created_at, expires_at)
     VALUES ($1,$2,$3,$4,$5)`,
    [token, ident.userId, ident.email, ahora, expira]
  );
  return { ...ident, token, createdAt: ahora.toISOString(), expiresAt: expira.toISOString() };
}

/**
 * Recupera una sesión por token y vuelve a resolver sus permisos desde la base.
 *
 * Se releen los permisos en cada petición en vez de guardarlos dentro del token
 * porque si a alguien le quitan un permiso tiene que perderlo en ese momento, no
 * cuando le caduque la sesión horas después.
 */
export async function sesionPorToken(
  pool: Pool,
  token: string,
  bootstrapEmail: string
): Promise<AdminSession | null> {
  const { rows } = await pool.query(
    `SELECT s.token, s.admin_user_id, s.email, s.created_at, s.expires_at,
            u.full_name, u.locale, u.is_active, u.role_id,
            r.key AS role_key, r.name_es, r.name_en
       FROM admin_sessions s
       LEFT JOIN admin_users u ON u.id = s.admin_user_id
       LEFT JOIN admin_roles r ON r.id = u.role_id
      WHERE s.token = $1`,
    [token]
  );
  if (!rows.length) return null;
  const s = rows[0];

  if (new Date(s.expires_at).getTime() <= Date.now()) {
    await pool.query('DELETE FROM admin_sessions WHERE token = $1', [token]);
    return null;
  }

  // Sesión de la cuenta de arranque: no tiene fila en admin_users.
  if (!s.admin_user_id) {
    return {
      userId: null,
      email: s.email,
      fullName: s.email === bootstrapEmail ? 'Administrador (.env)' : s.email,
      roleKey: 'superadmin',
      roleNameEs: 'Superadministrador',
      roleNameEn: 'Super administrator',
      locale: 'es',
      isBootstrap: true,
      permisos: permisosSuperadmin(),
      token: s.token,
      createdAt: new Date(s.created_at).toISOString(),
      expiresAt: new Date(s.expires_at).toISOString()
    };
  }

  // Si desactivaron la cuenta mientras tenía sesión abierta, se corta aquí.
  if (!s.is_active) {
    await pool.query('DELETE FROM admin_sessions WHERE token = $1', [token]);
    return null;
  }

  return {
    userId: s.admin_user_id,
    email: s.email,
    fullName: s.full_name,
    roleKey: s.role_key ?? 'sin-rol',
    roleNameEs: s.name_es ?? 'Sin rol',
    roleNameEn: s.name_en ?? 'No role',
    locale: (s.locale === 'en' ? 'en' : 'es') as 'es' | 'en',
    isBootstrap: false,
    permisos: s.role_id ? await permisosDeRol(pool, s.role_id) : {},
    token: s.token,
    createdAt: new Date(s.created_at).toISOString(),
    expiresAt: new Date(s.expires_at).toISOString()
  };
}

export async function cerrarSesion(pool: Pool, token: string): Promise<void> {
  await pool.query('DELETE FROM admin_sessions WHERE token = $1', [token]);
}

export async function limpiarSesionesCaducadas(pool: Pool): Promise<void> {
  await pool.query('DELETE FROM admin_sessions WHERE expires_at <= now()');
}

/** ¿El nivel que tiene alcanza para lo que se le pide? edit implica view. */
export function alcanza(tiene: PermissionLevel | undefined, necesita: 'view' | 'edit'): boolean {
  if (tiene === 'edit') return true;
  if (tiene === 'view') return necesita === 'view';
  return false;
}
