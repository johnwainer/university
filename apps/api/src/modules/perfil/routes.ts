import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  CONTACTO_PREFERIDO,
  FAMILIARIDAD_IA,
  METAS_APRENDIZAJE,
  VALORES_CONTACTO_PREFERIDO,
  VALORES_FAMILIARIDAD_IA,
  VALORES_METAS_APRENDIZAJE
} from './catalogos.js';
import { avatarConfigurado, subirAvatar } from './avatar.js';

/**
 * Perfil extendido del estudiante: lo que ve él y lo que ve el staff.
 *
 * LA REGLA DE VISIBILIDAD, que es el motivo de que este archivo exista:
 *
 *   - `GET /v1/me/profile`  — el estudiante ve y edita TODO su propio perfil,
 *     incluido el bloque de staff. Son datos que él declara sobre sí mismo
 *     (nombre legal, años de experiencia, metas): ocultárselos no protege a
 *     nadie y le impediría corregirlos.
 *   - `GET /v1/profiles/:userId` — NO EXISTE. Un estudiante no puede pedir el
 *     perfil de otro, ni el bloque visible. Si TFU quiere un directorio de
 *     compañeros, es una decisión suya y una ruta nueva con su propia regla.
 *   - `GET /admin/students/:userId/profile` — docentes y staff ven los dos
 *     bloques. Pasa por el guardián `preHandler` de /admin/* con la sección
 *     `sis`, así que el rol `lectura` lo ve y `contenido` no.
 *
 * El bloque de staff viaja en una propiedad aparte (`staff`) y no mezclado con
 * el resto: así una respuesta pública futura puede omitir la propiedad entera
 * en vez de acordarse de quitar nueve campos uno por uno.
 */

const FILAS_VISIBLES = `
  preferred_name   AS "preferredName",
  avatar_url       AS "avatarUrl",
  headline,
  industry,
  bio,
  country_region   AS "countryRegion",
  portfolio_url    AS "portfolioUrl"
`;

const FILAS_STAFF = `
  legal_name       AS "legalName",
  current_position AS "currentRole",
  years_experience AS "yearsExperience",
  ai_familiarity   AS "aiFamiliarity",
  learning_goals   AS "learningGoals",
  time_zone        AS "timeZone",
  preferred_contact AS "preferredContact",
  languages,
  language_support AS "languageSupport"
`;

/** Texto corto opcional: cadena vacía y null significan «sin dato». */
const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

const urlOpcional = z
  .string()
  .trim()
  .max(300)
  .transform((v) => (v.length === 0 ? null : v))
  .nullable()
  .optional()
  .refine(
    (v) => v == null || /^https?:\/\/[^\s]+$/i.test(v),
    'El enlace debe empezar por http:// o https://'
  );

const perfilSchema = z.object({
  preferredName: textoOpcional(120),
  headline: textoOpcional(160),
  industry: textoOpcional(120),
  // Cuatro frases caben de sobra en 1200 caracteres; el límite evita que el
  // campo se use como documento.
  bio: textoOpcional(1200),
  countryRegion: textoOpcional(120),
  portfolioUrl: urlOpcional,

  legalName: textoOpcional(160),
  currentRole: textoOpcional(160),
  yearsExperience: z.number().int().min(0).max(70).nullable().optional(),
  aiFamiliarity: z.enum(VALORES_FAMILIARIDAD_IA as [string, ...string[]]).nullable().optional(),
  learningGoals: z.array(z.enum(VALORES_METAS_APRENDIZAJE as [string, ...string[]])).max(5).optional(),
  timeZone: textoOpcional(80),
  preferredContact: z.enum(VALORES_CONTACTO_PREFERIDO as [string, ...string[]]).nullable().optional(),
  languages: textoOpcional(160),
  languageSupport: textoOpcional(400),

  /** Data URL de la foto. Se sube al bucket y sólo se guarda la URL. */
  avatarDataUrl: z.string().max(4_000_000).optional()
});

type FilaPerfil = Record<string, unknown>;

function armarRespuesta(fila: FilaPerfil | undefined) {
  const vacio = {
    preferredName: null,
    avatarUrl: null,
    headline: null,
    industry: null,
    bio: null,
    countryRegion: null,
    portfolioUrl: null
  };
  const vacioStaff = {
    legalName: null,
    currentRole: null,
    yearsExperience: null,
    aiFamiliarity: null,
    learningGoals: [] as string[],
    timeZone: null,
    preferredContact: null,
    languages: null,
    languageSupport: null
  };
  if (!fila) {
    // Un estudiante sin perfil no es un error: devuelve la forma completa con
    // todo en null para que el formulario del portal no tenga que distinguir
    // «no existe» de «está vacío».
    return { exists: false, visible: vacio, staff: vacioStaff };
  }
  const visible = { ...vacio };
  for (const k of Object.keys(vacio)) {
    (visible as Record<string, unknown>)[k] = fila[k] ?? null;
  }
  const staff = { ...vacioStaff };
  for (const k of Object.keys(vacioStaff)) {
    (staff as Record<string, unknown>)[k] = fila[k] ?? (k === 'learningGoals' ? [] : null);
  }
  return { exists: true, visible, staff };
}

export function registerPerfilRoutes(
  app: FastifyInstance,
  ctx: {
    pool: Pool;
    ensureAdmin: (request: FastifyRequest) => void;
    resolvePublicUser: (request: FastifyRequest) => { userId: string; email: string };
  }
): void {
  const { pool, ensureAdmin, resolvePublicUser } = ctx;

  /** Catálogos para pintar los desplegables. Público: no revela datos. */
  app.get('/v1/profile/options', async () => ({
    aiFamiliarity: FAMILIARIDAD_IA,
    learningGoals: METAS_APRENDIZAJE,
    preferredContact: CONTACTO_PREFERIDO,
    avatarUploadEnabled: avatarConfigurado()
  }));

  app.get('/v1/me/profile', async (request) => {
    const { userId } = resolvePublicUser(request);
    const result = await pool.query(
      `SELECT ${FILAS_VISIBLES}, ${FILAS_STAFF} FROM student_profiles WHERE user_id = $1`,
      [userId]
    );
    return armarRespuesta(result.rows[0]);
  });

  app.patch('/v1/me/profile', async (request, reply) => {
    const { userId } = resolvePublicUser(request);
    const body = perfilSchema.parse(request.body ?? {});

    // La foto primero: si falla la subida se informa y NO se guarda nada, para
    // que el estudiante no crea que su foto quedó registrada.
    let avatar: { url: string; objectKey: string } | null = null;
    let avatarAviso: string | null = null;
    if (body.avatarDataUrl) {
      const anterior = await pool.query(
        'SELECT avatar_object_key AS "objectKey" FROM student_profiles WHERE user_id = $1',
        [userId]
      );
      const subida = await subirAvatar({
        dataUrl: body.avatarDataUrl,
        objectKeyAnterior: (anterior.rows[0]?.objectKey as string | null) ?? null
      });
      if (subida.ok) {
        avatar = { url: subida.url, objectKey: subida.objectKey };
      } else if (subida.configured || /data URL|no admitido|vacía|más de/.test(subida.detail)) {
        // Una imagen inválida se rechaza SIEMPRE, con bucket o sin él: así el
        // mismo archivo da el mismo resultado en desarrollo y en producción.
        return reply.badRequest(subida.detail);
      } else {
        // Sin bucket configurado el perfil se guarda igual y se dice por qué la
        // foto no: es el mismo criterio del mailer sin SMTP.
        avatarAviso = subida.detail;
      }
    }

    // UPSERT con COALESCE: un campo ausente en el cuerpo no se toca; un campo
    // enviado como null SÍ se borra. Distinguir «no enviado» de «borrado» es la
    // diferencia entre guardar media pestaña del formulario y vaciar la otra
    // mitad sin querer.
    const enviado = (clave: keyof typeof body) =>
      Object.prototype.hasOwnProperty.call(body, clave);

    const columnas: Array<[string, unknown, boolean]> = [
      ['preferred_name', body.preferredName ?? null, enviado('preferredName')],
      ['headline', body.headline ?? null, enviado('headline')],
      ['industry', body.industry ?? null, enviado('industry')],
      ['bio', body.bio ?? null, enviado('bio')],
      ['country_region', body.countryRegion ?? null, enviado('countryRegion')],
      ['portfolio_url', body.portfolioUrl ?? null, enviado('portfolioUrl')],
      ['legal_name', body.legalName ?? null, enviado('legalName')],
      ['current_position', body.currentRole ?? null, enviado('currentRole')],
      ['years_experience', body.yearsExperience ?? null, enviado('yearsExperience')],
      ['ai_familiarity', body.aiFamiliarity ?? null, enviado('aiFamiliarity')],
      ['learning_goals', body.learningGoals ?? [], enviado('learningGoals')],
      ['time_zone', body.timeZone ?? null, enviado('timeZone')],
      ['preferred_contact', body.preferredContact ?? null, enviado('preferredContact')],
      ['languages', body.languages ?? null, enviado('languages')],
      ['language_support', body.languageSupport ?? null, enviado('languageSupport')],
      ['avatar_url', avatar?.url ?? null, avatar !== null],
      ['avatar_object_key', avatar?.objectKey ?? null, avatar !== null]
    ];

    const params: unknown[] = [userId];
    const nombres: string[] = [];
    const valores: string[] = [];
    const sets: string[] = [];
    for (const [columna, valor, presente] of columnas) {
      if (!presente) continue;
      params.push(valor);
      const ph = `$${params.length}`;
      nombres.push(columna);
      valores.push(ph);
      sets.push(`${columna} = ${ph}`);
    }

    if (nombres.length === 0) {
      const actual = await pool.query(
        `SELECT ${FILAS_VISIBLES}, ${FILAS_STAFF} FROM student_profiles WHERE user_id = $1`,
        [userId]
      );
      return { ...armarRespuesta(actual.rows[0]), avatarAviso };
    }

    const result = await pool.query(
      `INSERT INTO student_profiles (user_id${nombres.length ? ', ' + nombres.join(', ') : ''})
       VALUES ($1${valores.length ? ', ' + valores.join(', ') : ''})
       ON CONFLICT (user_id) DO UPDATE
         SET ${sets.join(', ')}, updated_at = NOW()
       RETURNING ${FILAS_VISIBLES}, ${FILAS_STAFF}`,
      params
    );
    request.log.info({ userId, campos: nombres.length }, 'perfil de estudiante actualizado');
    return { ...armarRespuesta(result.rows[0]), avatarAviso };
  });

  /**
   * Perfil de un estudiante para docentes y staff.
   *
   * Va bajo /admin/* a propósito: así lo cubre el guardián de IAM sin tener que
   * repetir la comprobación aquí. El prefijo está mapeado a la sección `sis` en
   * ROUTE_SECTIONS; una ruta /admin no mapeada queda sólo para superadmin, de
   * modo que el olvido falla cerrado y no abierto.
   */
  app.get('/admin/students/:userId/profile', async (request, reply) => {
    ensureAdmin(request);
    const { userId } = request.params as { userId: string };
    const result = await pool.query(
      `SELECT u.id, u.full_name AS "fullName", u.email, u.locale,
              p.updated_at AS "updatedAt", ${FILAS_VISIBLES}, ${FILAS_STAFF}
       FROM users u
       LEFT JOIN student_profiles p ON p.user_id = u.id
       WHERE u.id = $1`,
      [userId]
    );
    const fila = result.rows[0];
    if (!fila) {
      return reply.notFound('Unknown user');
    }
    return {
      user: { id: fila.id, fullName: fila.fullName, email: fila.email, locale: fila.locale },
      updatedAt: fila.updatedAt ?? null,
      ...armarRespuesta(fila.preferredName === undefined ? undefined : fila)
    };
  });

  /**
   * Listado para el panel: quién ha llenado su perfil y quién no.
   *
   * Existe porque la pregunta operativa real no es «¿cómo está el perfil de
   * este estudiante?» sino «¿a quién hay que recordárselo?».
   */
  app.get('/admin/students/profiles', async (request) => {
    ensureAdmin(request);
    const query = z
      .object({
        search: z.string().trim().max(120).optional(),
        soloIncompletos: z.coerce.boolean().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional()
      })
      .parse(request.query ?? {});

    const result = await pool.query(
      `SELECT u.id, u.full_name AS "fullName", u.email,
              p.preferred_name AS "preferredName",
              p.avatar_url AS "avatarUrl",
              p.headline, p.industry, p.country_region AS "countryRegion",
              p.ai_familiarity AS "aiFamiliarity",
              p.updated_at AS "updatedAt",
              -- Siete campos deciden si el perfil está «completo»: los que TFU
              -- pidió como visibles, salvo el enlace de portafolio, que es
              -- opcional por definición.
              (CASE WHEN p.user_id IS NULL THEN 0 ELSE (
                 (p.preferred_name IS NOT NULL)::int +
                 (p.avatar_url IS NOT NULL)::int +
                 (p.headline IS NOT NULL)::int +
                 (p.industry IS NOT NULL)::int +
                 (p.bio IS NOT NULL)::int +
                 (p.country_region IS NOT NULL)::int
               ) END) AS "camposLlenos"
       FROM users u
       LEFT JOIN student_profiles p ON p.user_id = u.id
       WHERE ($1::text IS NULL OR u.full_name ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%')
       ORDER BY u.full_name
       LIMIT $2`,
      [query.search ?? null, query.limit ?? 100]
    );
    const items = result.rows
      .map((row) => ({ ...row, total: 6 }))
      .filter((row) => (query.soloIncompletos ? Number(row.camposLlenos) < 6 : true));
    return { items, total: items.length };
  });
}
