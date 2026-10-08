import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { getCieChecklist } from './service.js';
import type { DocumentScope, DocumentStatus } from './service.js';
import { config } from '../../config.js';

/**
 * Etapa I — Rutas del repositorio de compliance CIE y del formulario público.
 *
 * Prefijos de cara al cliente (Fastify reescribe el `/api` inicial, así que
 * aquí se registran sin él):
 *   - públicas: `/api/v1/programs`, `/api/v1/contact`
 *   - admin:    `/api/admin/cie/*`, `/api/admin/contact-messages`
 *
 * Se usa el prefijo `/admin/cie/` y NO `/admin/compliance/`: esa raíz ya la
 * ocupan las rutas preexistentes del módulo syllabus
 * (`/admin/compliance/records|ferpa-log|ipeds-report`), que son otra cosa.
 */

export interface CieContext {
  pool: Pool;
  /** Lanza 401 si la petición no trae credenciales admin válidas. */
  ensureAdmin: (request: any) => { email?: string } | unknown;
  /** Máximo de mensajes de contacto por IP dentro de la ventana. */
  contactRateLimit?: { max: number; windowMinutes: number };
}

/* -------------------------------------------------------------------------- */
/* Validación                                                                 */
/* -------------------------------------------------------------------------- */

const SCOPES = ['institutional', 'program', 'faculty'] as const;
const DOCUMENT_STATUSES = ['draft', 'in_review', 'approved', 'rejected'] as const;
const FACULTY_STATUSES = ['active', 'inactive', 'candidate'] as const;
const CONTACT_STATUSES = ['new', 'in_progress', 'closed', 'spam'] as const;
const FACULTY_DEGREE_LEVELS = ['bachelor', 'master', 'doctoral', 'professional', 'other'] as const;
const LOCALES = ['es', 'en'] as const;

const nonEmpty = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .nullable()
  .optional();

const documentTypeSchema = z.object({
  code: nonEmpty(64).transform((value) => value.toUpperCase()),
  nameEs: nonEmpty(200),
  nameEn: nonEmpty(200),
  scope: z.enum(SCOPES),
  cieRequired: z.boolean().default(true),
  displayOrder: z.number().int().min(0).max(100000).default(0),
  helpEs: optionalText(2000),
  helpEn: optionalText(2000),
  isActive: z.boolean().default(true)
});
const documentTypeUpdateSchema = documentTypeSchema.partial();

const documentSchema = z.object({
  documentTypeId: nonEmpty(64),
  programId: optionalText(64),
  facultyId: optionalText(64),
  title: nonEmpty(300),
  fileUrl: optionalText(2000),
  version: nonEmpty(32).default('1'),
  status: z.enum(DOCUMENT_STATUSES).default('draft'),
  effectiveDate: isoDate,
  expiresAt: isoDate,
  notes: optionalText(4000)
});
// El ámbito de un documento no se reasigna por PATCH: cambiarlo movería la
// evidencia de unidad y rompería los índices parciales de unicidad.
const documentUpdateSchema = documentSchema
  .omit({ documentTypeId: true, programId: true, facultyId: true })
  .partial();

const facultySchema = z.object({
  fullName: nonEmpty(200),
  email: z.string().trim().email().max(200).toLowerCase(),
  programId: optionalText(64),
  credentials: optionalText(500),
  degreeLevel: z.enum(FACULTY_DEGREE_LEVELS).nullable().optional(),
  timezone: optionalText(64),
  officeHours: optionalText(500),
  zoomBookingUrl: optionalText(2000),
  bioEs: optionalText(4000),
  bioEn: optionalText(4000),
  status: z.enum(FACULTY_STATUSES).default('active'),
  moodleUserId: z.number().int().positive().nullable().optional()
});
const facultyUpdateSchema = facultySchema.partial();

const contactSchema = z.object({
  fullName: nonEmpty(200),
  email: z.string().trim().email().max(200).toLowerCase(),
  phone: optionalText(40),
  programId: optionalText(64),
  subject: optionalText(200),
  message: z.string().trim().min(10).max(5000),
  locale: z.enum(LOCALES).optional(),
  /**
   * Honeypot: un campo oculto que una persona nunca llena. Si llega con
   * contenido, se acepta la petición sin almacenar nada.
   */
  company: z.string().max(200).optional()
});

const contactStatusSchema = z.object({ status: z.enum(CONTACT_STATUSES) });

const listDocumentsQuerySchema = z.object({
  scope: z.enum(SCOPES).optional(),
  status: z.enum(DOCUMENT_STATUSES).optional(),
  programId: z.string().trim().min(1).optional(),
  facultyId: z.string().trim().min(1).optional(),
  documentTypeId: z.string().trim().min(1).optional()
});

const contactListQuerySchema = z.object({
  status: z.enum(CONTACT_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional()
});

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

function resolveLocale(request: FastifyRequest): 'es' | 'en' {
  const query = request.query as Record<string, unknown> | undefined;
  if (query?.locale === 'es' || query?.locale === 'en') {
    return query.locale;
  }
  const header = request.headers['accept-language'];
  if (typeof header === 'string') {
    for (const part of header.split(',')) {
      const tag = part.split(';')[0]?.trim().slice(0, 2).toLowerCase();
      if (tag === 'es' || tag === 'en') {
        return tag;
      }
    }
  }
  return 'es';
}

/** Loopback y rangos privados: las únicas fuentes de las que se acepta XFF. */
function isTrustedProxy(ip: string): boolean {
  const addr = ip.replace(/^::ffff:/, '');
  return (
    addr === '127.0.0.1' ||
    addr === '::1' ||
    addr.startsWith('10.') ||
    addr.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(addr)
  );
}

/**
 * IP real del cliente para el límite por IP del formulario público.
 *
 * `X-Forwarded-For` solo se honra si la conexión viene de un proxy de
 * confianza (en producción, el Nginx del mismo host). Confiar en la cabecera
 * sin esa condición dejaría que cualquiera la falsificara y enviara mensajes
 * ilimitados rotando el valor, que es justo lo que el límite debe impedir.
 */
function clientIp(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim() && isTrustedProxy(request.ip)) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) {
      return first;
    }
  }
  return request.ip;
}

/** `23505` es la violación de unicidad de PostgreSQL. */
function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === '23505');
}

function adminEmail(session: unknown): string | null {
  if (session && typeof session === 'object' && 'email' in session) {
    const value = (session as { email?: unknown }).email;
    return typeof value === 'string' ? value : null;
  }
  return null;
}

/** Proyección camelCase de `cie_document_types`. */
const DOCUMENT_TYPE_SELECT = `
  SELECT id, code, name_es AS "nameEs", name_en AS "nameEn", scope,
         cie_required AS "cieRequired", display_order AS "displayOrder",
         help_es AS "helpEs", help_en AS "helpEn", is_active AS "isActive",
         created_at AS "createdAt", updated_at AS "updatedAt"
  FROM cie_document_types
`;

/**
 * Documento con las relaciones resueltas. `isExpired` se calcula en SQL con
 * `CURRENT_DATE` para que la vigencia la decida el reloj del servidor de base
 * y no el del proceso Node.
 */
const DOCUMENT_DETAIL_SELECT = `
  SELECT
    d.id, d.document_type_id AS "documentTypeId", d.program_id AS "programId",
    d.faculty_id AS "facultyId", d.title, d.file_url AS "fileUrl", d.version, d.status,
    to_char(d.effective_date, 'YYYY-MM-DD') AS "effectiveDate",
    to_char(d.expires_at, 'YYYY-MM-DD') AS "expiresAt",
    d.notes,
    d.uploaded_by AS "uploadedBy", d.created_at AS "createdAt", d.updated_at AS "updatedAt",
    t.code    AS "documentTypeCode",
    t.name_es AS "documentTypeNameEs",
    t.name_en AS "documentTypeNameEn",
    t.scope   AS "documentTypeScope",
    t.cie_required AS "cieRequired",
    p.code    AS "programCode",
    p.name    AS "programName",
    f.full_name AS "facultyFullName",
    (d.expires_at IS NOT NULL AND d.expires_at < CURRENT_DATE) AS "isExpired"
  FROM cie_documents d
  JOIN cie_document_types t ON t.id = d.document_type_id
  LEFT JOIN degree_programs p ON p.id = d.program_id
  LEFT JOIN faculty_records f ON f.id = d.faculty_id
`;

const FACULTY_SELECT_COLUMNS = `
  f.id, f.full_name AS "fullName", f.email, f.program_id AS "programId",
  f.credentials, f.degree_level AS "degreeLevel", f.timezone,
  f.office_hours AS "officeHours", f.zoom_booking_url AS "zoomBookingUrl",
  f.bio_es AS "bioEs", f.bio_en AS "bioEn", f.status,
  f.moodle_user_id AS "moodleUserId",
  f.created_at AS "createdAt", f.updated_at AS "updatedAt"
`;

const CONTACT_SELECT = `
  SELECT
    c.id, c.full_name AS "fullName", c.email, c.phone, c.program_id AS "programId",
    c.subject, c.message, c.locale, c.status, c.source,
    c.handled_by AS "handledBy", c.handled_at AS "handledAt", c.created_at AS "createdAt",
    p.code AS "programCode",
    p.name AS "programName"
  FROM contact_messages c
  LEFT JOIN degree_programs p ON p.id = c.program_id
`;

/* -------------------------------------------------------------------------- */
/* Registro                                                                   */
/* -------------------------------------------------------------------------- */

export function registerCieRoutes(app: FastifyInstance, ctx: CieContext): void {
  const { pool, ensureAdmin } = ctx;
  const rateLimit = ctx.contactRateLimit ?? { max: 5, windowMinutes: 60 };
  const institutionName = config.institution.name;

  async function getDocumentById(id: string) {
    const result = await pool.query(`${DOCUMENT_DETAIL_SELECT} WHERE d.id = $1`, [id]);
    return result.rows[0] ?? null;
  }

  async function programExists(id: string): Promise<boolean> {
    const result = await pool.query(`SELECT 1 FROM degree_programs WHERE id = $1`, [id]);
    return result.rows.length > 0;
  }

  async function facultyExists(id: string): Promise<boolean> {
    const result = await pool.query(`SELECT 1 FROM faculty_records WHERE id = $1`, [id]);
    return result.rows.length > 0;
  }

  /* ----------------------------- Públicas -------------------------------- */

  /**
   * Catálogo público de programas. Se sirve desde `degree_programs`, la tabla
   * que ya es fuente de verdad del SIS en esta rama. Esa tabla tiene un solo
   * `name` (no columnas por idioma), así que `locale` se devuelve en el sobre
   * de la respuesta para que el cliente sepa en qué idioma pidió, pero los
   * nombres salen tal cual están registrados.
   */
  app.get('/v1/programs', async (request) => {
    const locale = resolveLocale(request);
    const result = await pool.query(
      `SELECT id, code, name, description, degree_level AS "degreeLevel",
              credit_hours_required AS "creditHours"
       FROM degree_programs
       WHERE is_active = true
       ORDER BY code`
    );
    return { locale, programs: result.rows };
  });

  // Formulario de contacto de la web pública.
  app.post('/v1/contact', async (request, reply) => {
    const payload = contactSchema.parse(request.body);

    // Honeypot relleno: es un bot. Respuesta de aspecto normal, nada
    // persistido — no se le confirma al bot que fue detectado.
    if (payload.company && payload.company.trim()) {
      request.log.warn({ ip: clientIp(request) }, 'contact form honeypot triggered');
      return reply.code(202).send({ received: true, id: 'discarded' });
    }

    const ip = clientIp(request);
    const recent = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM contact_messages
       WHERE remote_ip = $1 AND created_at > NOW() - ($2 || ' minutes')::interval`,
      [ip, String(Math.max(1, rateLimit.windowMinutes))]
    );
    if (Number(recent.rows[0]?.total ?? 0) >= rateLimit.max) {
      return reply.tooManyRequests(
        `Too many contact submissions. Try again in ${rateLimit.windowMinutes} minutes.`
      );
    }

    if (payload.programId && !(await programExists(payload.programId))) {
      return reply.badRequest('Unknown programId');
    }

    const inserted = await pool.query(
      `INSERT INTO contact_messages
         (full_name, email, phone, program_id, subject, message, locale, source, remote_ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'public-web', $8, $9)
       RETURNING id`,
      [
        payload.fullName,
        payload.email,
        payload.phone ?? null,
        payload.programId ?? null,
        payload.subject ?? null,
        payload.message,
        payload.locale ?? resolveLocale(request),
        ip,
        typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null
      ]
    );

    const id = String(inserted.rows[0].id);
    request.log.info({ contactMessageId: id }, 'contact message stored');
    return reply.code(201).send({ received: true, id });
  });

  /* ------------------------ Admin — checklist ---------------------------- */

  // Tablero de estado documental (semáforo). Etapa I: estado binario.
  app.get('/admin/cie/checklist', async (request) => {
    ensureAdmin(request);
    return getCieChecklist(pool, institutionName);
  });

  // Resumen compacto para el dashboard del panel admin.
  app.get('/admin/cie/overview', async (request) => {
    ensureAdmin(request);
    const checklist = await getCieChecklist(pool, institutionName);
    return {
      generatedAt: checklist.generatedAt,
      summary: checklist.summary,
      counters: checklist.counters,
      sections: checklist.sections.map((section) => ({
        scope: section.scope,
        titleEs: section.titleEs,
        titleEn: section.titleEn,
        signal: section.signal,
        requiredItems: section.items.filter((item) => item.cieRequired).length
      }))
    };
  });

  /* --------------------- Admin — tipos de documento ---------------------- */

  app.get('/admin/cie/document-types', async (request) => {
    ensureAdmin(request);
    const query = z
      .object({
        scope: z.enum(SCOPES).optional(),
        includeInactive: z.coerce.boolean().optional()
      })
      .parse(request.query ?? {});
    const result = await pool.query(
      `${DOCUMENT_TYPE_SELECT}
       WHERE ($1::text IS NULL OR scope = $1)
         AND ($2::boolean IS TRUE OR is_active IS TRUE)
       ORDER BY display_order, code`,
      [query.scope ?? null, query.includeInactive ?? false]
    );
    return { documentTypes: result.rows };
  });

  app.post('/admin/cie/document-types', async (request, reply) => {
    ensureAdmin(request);
    const payload = documentTypeSchema.parse(request.body);
    try {
      const result = await pool.query(
        `INSERT INTO cie_document_types
           (code, name_es, name_en, scope, cie_required, display_order, help_es, help_en, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          payload.code,
          payload.nameEs,
          payload.nameEn,
          payload.scope,
          payload.cieRequired,
          payload.displayOrder,
          payload.helpEs ?? null,
          payload.helpEn ?? null,
          payload.isActive
        ]
      );
      const created = await pool.query(`${DOCUMENT_TYPE_SELECT} WHERE id = $1`, [
        result.rows[0].id
      ]);
      return reply.code(201).send({ created: true, documentType: created.rows[0] });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return reply.conflict(`Document type code ${payload.code} already exists`);
      }
      throw error;
    }
  });

  app.patch<{ Params: { documentTypeId: string } }>(
    '/admin/cie/document-types/:documentTypeId',
    async (request, reply) => {
      ensureAdmin(request);
      const payload = documentTypeUpdateSchema.parse(request.body);
      const result = await pool.query(
        `UPDATE cie_document_types SET
           code          = COALESCE($2, code),
           name_es       = COALESCE($3, name_es),
           name_en       = COALESCE($4, name_en),
           scope         = COALESCE($5, scope),
           cie_required  = COALESCE($6, cie_required),
           display_order = COALESCE($7, display_order),
           help_es       = COALESCE($8, help_es),
           help_en       = COALESCE($9, help_en),
           is_active     = COALESCE($10, is_active),
           updated_at    = NOW()
         WHERE id = $1
         RETURNING id`,
        [
          request.params.documentTypeId,
          payload.code ?? null,
          payload.nameEs ?? null,
          payload.nameEn ?? null,
          payload.scope ?? null,
          payload.cieRequired ?? null,
          payload.displayOrder ?? null,
          payload.helpEs ?? null,
          payload.helpEn ?? null,
          payload.isActive ?? null
        ]
      );
      if (!result.rows[0]) {
        return reply.notFound('Document type not found');
      }
      const updated = await pool.query(`${DOCUMENT_TYPE_SELECT} WHERE id = $1`, [
        request.params.documentTypeId
      ]);
      return { updated: true, documentType: updated.rows[0] };
    }
  );

  app.delete<{ Params: { documentTypeId: string } }>(
    '/admin/cie/document-types/:documentTypeId',
    async (request, reply) => {
      ensureAdmin(request);
      const result = await pool.query(`DELETE FROM cie_document_types WHERE id = $1`, [
        request.params.documentTypeId
      ]);
      if ((result.rowCount ?? 0) === 0) {
        return reply.notFound('Document type not found');
      }
      return { deleted: true };
    }
  );

  /* ------------------------ Admin — documentos --------------------------- */

  app.get('/admin/cie/documents', async (request) => {
    ensureAdmin(request);
    const query = listDocumentsQuerySchema.parse(request.query ?? {});
    const result = await pool.query(
      `${DOCUMENT_DETAIL_SELECT}
       WHERE ($1::text IS NULL OR t.scope = $1)
         AND ($2::text IS NULL OR d.status = $2)
         AND ($3::text IS NULL OR d.program_id = $3)
         AND ($4::text IS NULL OR d.faculty_id = $4)
         AND ($5::text IS NULL OR d.document_type_id = $5)
       ORDER BY t.display_order, t.code, p.code NULLS FIRST, f.full_name NULLS FIRST`,
      [
        query.scope ?? null,
        query.status ?? null,
        query.programId ?? null,
        query.facultyId ?? null,
        query.documentTypeId ?? null
      ]
    );
    return { documents: result.rows };
  });

  app.post('/admin/cie/documents', async (request, reply) => {
    const session = ensureAdmin(request);
    const payload = documentSchema.parse(request.body);

    const typeResult = await pool.query(`SELECT id, scope FROM cie_document_types WHERE id = $1`, [
      payload.documentTypeId
    ]);
    const documentType = typeResult.rows[0];
    if (!documentType) {
      return reply.badRequest('Unknown documentTypeId');
    }

    // El ámbito del tipo decide qué relación debe venir poblada. Sin esta
    // validación un documento institucional podría colgarse de un programa y
    // el checklist dejaría de encontrarlo donde lo busca.
    const scope = String(documentType.scope) as DocumentScope;
    if (scope === 'institutional' && (payload.programId || payload.facultyId)) {
      return reply.badRequest(
        'An institutional document must not reference a program or faculty member'
      );
    }
    if (scope === 'program') {
      if (!payload.programId) {
        return reply.badRequest('programId is required for a program-scoped document');
      }
      if (payload.facultyId) {
        return reply.badRequest('A program document must not reference a faculty member');
      }
      if (!(await programExists(payload.programId))) {
        return reply.badRequest('Unknown programId');
      }
    }
    if (scope === 'faculty') {
      if (!payload.facultyId) {
        return reply.badRequest('facultyId is required for a faculty-scoped document');
      }
      if (payload.programId) {
        return reply.badRequest('A faculty document must not reference a program');
      }
      if (!(await facultyExists(payload.facultyId))) {
        return reply.badRequest('Unknown facultyId');
      }
    }

    if (payload.effectiveDate && payload.expiresAt && payload.expiresAt < payload.effectiveDate) {
      return reply.badRequest('expiresAt must not be earlier than effectiveDate');
    }

    try {
      const inserted = await pool.query(
        `INSERT INTO cie_documents
           (document_type_id, program_id, faculty_id, title, file_url, version,
            status, effective_date, expires_at, notes, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          payload.documentTypeId,
          payload.programId ?? null,
          payload.facultyId ?? null,
          payload.title,
          payload.fileUrl ?? null,
          payload.version,
          payload.status,
          payload.effectiveDate ?? null,
          payload.expiresAt ?? null,
          payload.notes ?? null,
          adminEmail(session)
        ]
      );
      const document = await getDocumentById(String(inserted.rows[0].id));
      return reply.code(201).send({ created: true, document });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return reply.conflict(
          'A document of this type already exists for that target. Update it instead of creating a second one.'
        );
      }
      throw error;
    }
  });

  app.patch<{ Params: { documentId: string } }>(
    '/admin/cie/documents/:documentId',
    async (request, reply) => {
      const session = ensureAdmin(request);
      const payload = documentUpdateSchema.parse(request.body);

      const current = await getDocumentById(request.params.documentId);
      if (!current) {
        return reply.notFound('Document not found');
      }

      // La vigencia se valida contra el valor efectivo tras el PATCH, no solo
      // contra lo que trae el cuerpo: un PATCH que solo mueve `expiresAt`
      // también puede invertir el rango. Ambos lados son 'YYYY-MM-DD' (la
      // lectura las formatea en SQL), así que comparar como texto es válido.
      const effectiveDate: string | null = payload.effectiveDate ?? current.effectiveDate ?? null;
      const expiresAt: string | null = payload.expiresAt ?? current.expiresAt ?? null;
      if (effectiveDate && expiresAt && expiresAt < effectiveDate) {
        return reply.badRequest('expiresAt must not be earlier than effectiveDate');
      }

      const result = await pool.query(
        `UPDATE cie_documents SET
           title          = COALESCE($2, title),
           file_url       = COALESCE($3, file_url),
           version        = COALESCE($4, version),
           status         = COALESCE($5, status),
           effective_date = COALESCE($6, effective_date),
           expires_at     = COALESCE($7, expires_at),
           notes          = COALESCE($8, notes),
           uploaded_by    = COALESCE($9, uploaded_by),
           updated_at     = NOW()
         WHERE id = $1
         RETURNING id`,
        [
          request.params.documentId,
          payload.title ?? null,
          payload.fileUrl ?? null,
          payload.version ?? null,
          payload.status ?? null,
          payload.effectiveDate ?? null,
          payload.expiresAt ?? null,
          payload.notes ?? null,
          adminEmail(session)
        ]
      );
      if (!result.rows[0]) {
        return reply.notFound('Document not found');
      }
      return { updated: true, document: await getDocumentById(request.params.documentId) };
    }
  );

  app.delete<{ Params: { documentId: string } }>(
    '/admin/cie/documents/:documentId',
    async (request, reply) => {
      ensureAdmin(request);
      const result = await pool.query(`DELETE FROM cie_documents WHERE id = $1`, [
        request.params.documentId
      ]);
      if ((result.rowCount ?? 0) === 0) {
        return reply.notFound('Document not found');
      }
      return { deleted: true };
    }
  );

  /* ------------------------- Admin — faculty ----------------------------- */

  /**
   * Expedientes con su cobertura documental resuelta: cuántos de los tipos de
   * ámbito `faculty` exigidos por la CIE están aprobados y vigentes para cada
   * docente, y qué códigos faltan. Es el mismo criterio del checklist, para
   * que la pestaña Faculty y el semáforo nunca se contradigan.
   */
  app.get('/admin/cie/faculty', async (request) => {
    ensureAdmin(request);
    const query = z
      .object({ status: z.enum(FACULTY_STATUSES).optional() })
      .parse(request.query ?? {});
    const result = await pool.query(
      `WITH required_faculty_types AS (
         SELECT id, code FROM cie_document_types
         WHERE scope = 'faculty' AND cie_required IS TRUE AND is_active IS TRUE
       )
       SELECT
         ${FACULTY_SELECT_COLUMNS},
         p.code AS "programCode",
         p.name AS "programName",
         (SELECT COUNT(*)::int FROM required_faculty_types) AS "requiredDocuments",
         (
           SELECT COUNT(*)::int
           FROM cie_documents d
           JOIN required_faculty_types rt ON rt.id = d.document_type_id
           WHERE d.faculty_id = f.id
             AND d.status = 'approved'
             AND (d.expires_at IS NULL OR d.expires_at >= CURRENT_DATE)
         ) AS "approvedDocuments",
         COALESCE(
           (
             SELECT ARRAY_AGG(rt.code ORDER BY rt.code)
             FROM required_faculty_types rt
             WHERE NOT EXISTS (
               SELECT 1 FROM cie_documents d
               WHERE d.faculty_id = f.id
                 AND d.document_type_id = rt.id
                 AND d.status = 'approved'
                 AND (d.expires_at IS NULL OR d.expires_at >= CURRENT_DATE)
             )
           ),
           ARRAY[]::text[]
         ) AS "missingDocumentCodes"
       FROM faculty_records f
       LEFT JOIN degree_programs p ON p.id = f.program_id
       WHERE ($1::text IS NULL OR f.status = $1)
       ORDER BY f.full_name`,
      [query.status ?? null]
    );
    return { faculty: result.rows };
  });

  app.post('/admin/cie/faculty', async (request, reply) => {
    ensureAdmin(request);
    const payload = facultySchema.parse(request.body);
    if (payload.programId && !(await programExists(payload.programId))) {
      return reply.badRequest('Unknown programId');
    }
    try {
      const result = await pool.query(
        `INSERT INTO faculty_records
           (full_name, email, program_id, credentials, degree_level, timezone,
            office_hours, zoom_booking_url, bio_es, bio_en, status, moodle_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [
          payload.fullName,
          payload.email,
          payload.programId ?? null,
          payload.credentials ?? null,
          payload.degreeLevel ?? null,
          payload.timezone ?? null,
          payload.officeHours ?? null,
          payload.zoomBookingUrl ?? null,
          payload.bioEs ?? null,
          payload.bioEn ?? null,
          payload.status,
          payload.moodleUserId ?? null
        ]
      );
      const created = await pool.query(
        `SELECT ${FACULTY_SELECT_COLUMNS} FROM faculty_records f WHERE f.id = $1`,
        [result.rows[0].id]
      );
      return reply.code(201).send({ created: true, faculty: created.rows[0] });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return reply.conflict(`A faculty record already exists for ${payload.email}`);
      }
      throw error;
    }
  });

  app.patch<{ Params: { facultyId: string } }>(
    '/admin/cie/faculty/:facultyId',
    async (request, reply) => {
      ensureAdmin(request);
      const payload = facultyUpdateSchema.parse(request.body);
      if (payload.programId && !(await programExists(payload.programId))) {
        return reply.badRequest('Unknown programId');
      }
      try {
        const result = await pool.query(
          `UPDATE faculty_records SET
             full_name        = COALESCE($2, full_name),
             email            = COALESCE($3, email),
             program_id       = COALESCE($4, program_id),
             credentials      = COALESCE($5, credentials),
             degree_level     = COALESCE($6, degree_level),
             timezone         = COALESCE($7, timezone),
             office_hours     = COALESCE($8, office_hours),
             zoom_booking_url = COALESCE($9, zoom_booking_url),
             bio_es           = COALESCE($10, bio_es),
             bio_en           = COALESCE($11, bio_en),
             status           = COALESCE($12, status),
             moodle_user_id   = COALESCE($13, moodle_user_id),
             updated_at       = NOW()
           WHERE id = $1
           RETURNING id`,
          [
            request.params.facultyId,
            payload.fullName ?? null,
            payload.email ?? null,
            payload.programId ?? null,
            payload.credentials ?? null,
            payload.degreeLevel ?? null,
            payload.timezone ?? null,
            payload.officeHours ?? null,
            payload.zoomBookingUrl ?? null,
            payload.bioEs ?? null,
            payload.bioEn ?? null,
            payload.status ?? null,
            payload.moodleUserId ?? null
          ]
        );
        if (!result.rows[0]) {
          return reply.notFound('Faculty record not found');
        }
        const updated = await pool.query(
          `SELECT ${FACULTY_SELECT_COLUMNS} FROM faculty_records f WHERE f.id = $1`,
          [request.params.facultyId]
        );
        return { updated: true, faculty: updated.rows[0] };
      } catch (error) {
        if (isUniqueViolation(error)) {
          return reply.conflict(`A faculty record already exists for ${payload.email}`);
        }
        throw error;
      }
    }
  );

  app.delete<{ Params: { facultyId: string } }>(
    '/admin/cie/faculty/:facultyId',
    async (request, reply) => {
      ensureAdmin(request);
      const result = await pool.query(`DELETE FROM faculty_records WHERE id = $1`, [
        request.params.facultyId
      ]);
      if ((result.rowCount ?? 0) === 0) {
        return reply.notFound('Faculty record not found');
      }
      return { deleted: true };
    }
  );

  /* ------------------- Admin — mensajes de contacto ---------------------- */

  app.get('/admin/contact-messages', async (request) => {
    ensureAdmin(request);
    const query = contactListQuerySchema.parse(request.query ?? {});
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const offset = Math.max(query.offset ?? 0, 0);
    const [rows, total] = await Promise.all([
      pool.query(
        `${CONTACT_SELECT}
         WHERE ($1::text IS NULL OR c.status = $1)
         ORDER BY c.created_at DESC
         LIMIT $2 OFFSET $3`,
        [query.status ?? null, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total FROM contact_messages WHERE ($1::text IS NULL OR status = $1)`,
        [query.status ?? null]
      )
    ]);
    return { items: rows.rows, total: Number(total.rows[0]?.total ?? 0) };
  });

  app.patch<{ Params: { messageId: string } }>(
    '/admin/contact-messages/:messageId/status',
    async (request, reply) => {
      const session = ensureAdmin(request);
      const payload = contactStatusSchema.parse(request.body);
      // Volver a 'new' devuelve el mensaje a la bandeja sin dueño: se limpian
      // responsable y fecha de gestión para que no quede un rastro falso.
      const handledBy = payload.status === 'new' ? null : adminEmail(session);
      const result = await pool.query(
        `UPDATE contact_messages SET
           status     = $2,
           handled_by = $3,
           handled_at = CASE WHEN $2 = 'new' THEN NULL ELSE NOW() END
         WHERE id = $1
         RETURNING id`,
        [request.params.messageId, payload.status, handledBy]
      );
      if (!result.rows[0]) {
        return reply.notFound('Contact message not found');
      }
      const message = await pool.query(`${CONTACT_SELECT} WHERE c.id = $1`, [
        request.params.messageId
      ]);
      return { updated: true, message: message.rows[0] };
    }
  );
}
