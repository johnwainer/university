import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';

/**
 * Phase 3 — Syllabus + Compliance (FERPA/IPEDS/WCAG).
 *
 * Admin routes for the native syllabus engine and the transversal compliance
 * surface. Wired by the orchestrator via
 * `registerSyllabusRoutes(app, { pool, ensureAdmin })`.
 *
 * `ensureAdmin` returns the admin session (which carries `email`), used here to
 * attribute FERPA access-log entries to the acting administrator.
 */
export interface SyllabusContext {
  pool: Pool;
  ensureAdmin: (request: any) => unknown;
}

const sectionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  required: z.boolean().optional(),
  defaultContent: z.string().optional()
});

const templateCreateSchema = z.object({
  name: z.string().min(1),
  sections: z.array(sectionSchema).optional(),
  isActive: z.boolean().optional(),
  tenantId: z.string().uuid().optional()
});

const templateUpdateSchema = templateCreateSchema.partial();

const syllabusCreateSchema = z.object({
  title: z.string().min(1),
  templateId: z.string().uuid().optional(),
  moodleCourseId: z.number().int().optional(),
  degreeProgramId: z.string().optional(),
  termId: z.string().optional(),
  content: z.record(z.unknown()).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  tenantId: z.string().uuid().optional()
});

const syllabusUpdateSchema = syllabusCreateSchema.partial();

const complianceCreateSchema = z.object({
  area: z.enum(['ferpa', 'ipeds', 'wcag', 'title_ix', 'ada', 'accreditation']),
  title: z.string().min(1),
  status: z.enum(['compliant', 'pending', 'action_required']).optional(),
  detail: z.string().optional(),
  evidenceUrl: z.string().optional(),
  period: z.string().optional(),
  tenantId: z.string().uuid().optional()
});

const complianceUpdateSchema = z.object({
  area: z.enum(['ferpa', 'ipeds', 'wcag', 'title_ix', 'ada', 'accreditation']).optional(),
  title: z.string().min(1).optional(),
  status: z.enum(['compliant', 'pending', 'action_required']).optional(),
  detail: z.string().optional(),
  evidenceUrl: z.string().optional(),
  period: z.string().optional()
});

const ferpaLogCreateSchema = z.object({
  subjectUserId: z.string().optional(),
  resource: z.string().min(1),
  action: z.string().min(1),
  actorEmail: z.string().email().optional(),
  tenantId: z.string().uuid().optional()
});

type TemplateSection = {
  key: string;
  label: string;
  required?: boolean;
  defaultContent?: string;
};

function adminEmail(session: unknown): string {
  if (session && typeof session === 'object' && 'email' in session) {
    const value = (session as { email?: unknown }).email;
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return 'admin';
}

export function registerSyllabusRoutes(app: FastifyInstance, ctx: SyllabusContext): void {
  const { pool, ensureAdmin } = ctx;

  // ===========================================================================
  // Syllabus templates.
  // ===========================================================================
  app.get('/admin/syllabus/templates', async (request) => {
    ensureAdmin(request);
    const result = await pool.query(
      `SELECT id, tenant_id, name, sections, is_active, created_at
       FROM syllabus_templates
       ORDER BY created_at DESC`
    );
    return result.rows;
  });

  app.post('/admin/syllabus/templates', async (request, reply) => {
    ensureAdmin(request);
    const body = templateCreateSchema.parse(request.body);
    const result = await pool.query(
      `INSERT INTO syllabus_templates (tenant_id, name, sections, is_active)
       VALUES ($1, $2, $3::jsonb, $4)
       RETURNING *`,
      [
        body.tenantId ?? null,
        body.name,
        JSON.stringify(body.sections ?? []),
        body.isActive ?? true
      ]
    );
    return reply.status(201).send(result.rows[0]);
  });

  app.patch('/admin/syllabus/templates/:id', async (request) => {
    ensureAdmin(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = templateUpdateSchema.parse(request.body);

    const sets: string[] = [];
    const params: unknown[] = [];
    if (body.tenantId !== undefined) {
      params.push(body.tenantId);
      sets.push(`tenant_id = $${params.length}`);
    }
    if (body.name !== undefined) {
      params.push(body.name);
      sets.push(`name = $${params.length}`);
    }
    if (body.sections !== undefined) {
      params.push(JSON.stringify(body.sections));
      sets.push(`sections = $${params.length}::jsonb`);
    }
    if (body.isActive !== undefined) {
      params.push(body.isActive);
      sets.push(`is_active = $${params.length}`);
    }
    if (sets.length === 0) {
      throw app.httpErrors.badRequest('No fields to update');
    }
    params.push(id);
    const result = await pool.query(
      `UPDATE syllabus_templates SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (result.rowCount === 0) {
      throw app.httpErrors.notFound('Template not found');
    }
    return result.rows[0];
  });

  app.delete('/admin/syllabus/templates/:id', async (request) => {
    ensureAdmin(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await pool.query(
      'DELETE FROM syllabus_templates WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rowCount === 0) {
      throw app.httpErrors.notFound('Template not found');
    }
    return { deleted: true, id };
  });

  // ===========================================================================
  // Syllabi (versioned per course / program / term).
  // ===========================================================================
  app.get('/admin/syllabi', async (request) => {
    ensureAdmin(request);
    const query = z
      .object({
        status: z.enum(['draft', 'published', 'archived']).optional(),
        moodleCourseId: z.coerce.number().int().optional()
      })
      .parse(request.query ?? {});

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.status) {
      params.push(query.status);
      conditions.push(`s.status = $${params.length}`);
    }
    if (query.moodleCourseId !== undefined) {
      params.push(query.moodleCourseId);
      conditions.push(`s.moodle_course_id = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT s.*, t.name AS template_name,
              mc.full_name AS course_name,
              dp.name AS program_name,
              at.name AS term_name
       FROM syllabi s
       LEFT JOIN syllabus_templates t ON t.id = s.template_id
       LEFT JOIN moodle_courses mc ON mc.moodle_course_id = s.moodle_course_id
       LEFT JOIN degree_programs dp ON dp.id = s.degree_program_id
       LEFT JOIN academic_terms at ON at.id = s.term_id
       ${where}
       ORDER BY s.updated_at DESC`,
      params
    );
    return result.rows;
  });

  app.post('/admin/syllabi', async (request, reply) => {
    ensureAdmin(request);
    const body = syllabusCreateSchema.parse(request.body);
    const result = await pool.query(
      `INSERT INTO syllabi
         (tenant_id, moodle_course_id, degree_program_id, term_id, template_id,
          title, content, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       RETURNING *`,
      [
        body.tenantId ?? null,
        body.moodleCourseId ?? null,
        body.degreeProgramId ?? null,
        body.termId ?? null,
        body.templateId ?? null,
        body.title,
        JSON.stringify(body.content ?? {}),
        body.status ?? 'draft'
      ]
    );
    return reply.status(201).send(result.rows[0]);
  });

  app.patch('/admin/syllabi/:id', async (request) => {
    ensureAdmin(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = syllabusUpdateSchema.parse(request.body);

    const sets: string[] = [];
    const params: unknown[] = [];
    const pushSet = (column: string, value: unknown, cast = '') => {
      params.push(value);
      sets.push(`${column} = $${params.length}${cast}`);
    };

    if (body.tenantId !== undefined) pushSet('tenant_id', body.tenantId);
    if (body.moodleCourseId !== undefined) pushSet('moodle_course_id', body.moodleCourseId);
    if (body.degreeProgramId !== undefined) pushSet('degree_program_id', body.degreeProgramId);
    if (body.termId !== undefined) pushSet('term_id', body.termId);
    if (body.templateId !== undefined) pushSet('template_id', body.templateId);
    if (body.title !== undefined) pushSet('title', body.title);
    if (body.content !== undefined) pushSet('content', JSON.stringify(body.content), '::jsonb');
    if (body.status !== undefined) pushSet('status', body.status);

    if (sets.length === 0) {
      throw app.httpErrors.badRequest('No fields to update');
    }
    sets.push('updated_at = now()');
    params.push(id);
    const result = await pool.query(
      `UPDATE syllabi SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (result.rowCount === 0) {
      throw app.httpErrors.notFound('Syllabus not found');
    }
    return result.rows[0];
  });

  // Publish: fill missing sections from the template, bump version, mark published.
  app.post('/admin/syllabi/:id/publish', async (request) => {
    ensureAdmin(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

    const current = await pool.query(
      `SELECT s.*, t.sections AS template_sections
       FROM syllabi s
       LEFT JOIN syllabus_templates t ON t.id = s.template_id
       WHERE s.id = $1`,
      [id]
    );
    if (current.rowCount === 0) {
      throw app.httpErrors.notFound('Syllabus not found');
    }
    const row = current.rows[0] as {
      content: Record<string, unknown> | null;
      template_sections: TemplateSection[] | null;
    };

    // Auto-fill any required/known section missing from the syllabus content
    // using the template's defaultContent.
    const content: Record<string, unknown> = { ...(row.content ?? {}) };
    const sections = Array.isArray(row.template_sections) ? row.template_sections : [];
    for (const section of sections) {
      if (!section || typeof section.key !== 'string') continue;
      const value = content[section.key];
      if (value === undefined || value === null || value === '') {
        content[section.key] = section.defaultContent ?? '';
      }
    }

    const result = await pool.query(
      `UPDATE syllabi
       SET content = $1::jsonb,
           status = 'published',
           published_at = now(),
           version = version + 1,
           updated_at = now()
       WHERE id = $2
       RETURNING *`,
      [JSON.stringify(content), id]
    );
    return result.rows[0];
  });

  // ===========================================================================
  // Compliance records.
  // ===========================================================================
  app.get('/admin/compliance/records', async (request) => {
    ensureAdmin(request);
    const query = z
      .object({
        area: z
          .enum(['ferpa', 'ipeds', 'wcag', 'title_ix', 'ada', 'accreditation'])
          .optional()
      })
      .parse(request.query ?? {});

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.area) {
      params.push(query.area);
      conditions.push(`area = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT id, tenant_id, area, title, status, detail, evidence_url, period, created_at
       FROM compliance_records
       ${where}
       ORDER BY created_at DESC`,
      params
    );
    return result.rows;
  });

  app.post('/admin/compliance/records', async (request, reply) => {
    ensureAdmin(request);
    const body = complianceCreateSchema.parse(request.body);
    const result = await pool.query(
      `INSERT INTO compliance_records
         (tenant_id, area, title, status, detail, evidence_url, period)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        body.tenantId ?? null,
        body.area,
        body.title,
        body.status ?? 'pending',
        body.detail ?? null,
        body.evidenceUrl ?? null,
        body.period ?? null
      ]
    );
    return reply.status(201).send(result.rows[0]);
  });

  app.patch('/admin/compliance/records/:id', async (request) => {
    ensureAdmin(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = complianceUpdateSchema.parse(request.body);

    const columnMap: Record<string, unknown> = {
      area: body.area,
      title: body.title,
      status: body.status,
      detail: body.detail,
      evidence_url: body.evidenceUrl,
      period: body.period
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [column, value] of Object.entries(columnMap)) {
      if (value !== undefined) {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      }
    }
    if (sets.length === 0) {
      throw app.httpErrors.badRequest('No fields to update');
    }
    params.push(id);
    const result = await pool.query(
      `UPDATE compliance_records SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (result.rowCount === 0) {
      throw app.httpErrors.notFound('Compliance record not found');
    }
    return result.rows[0];
  });

  // ===========================================================================
  // FERPA access log.
  // ===========================================================================
  app.get('/admin/compliance/ferpa-log', async (request) => {
    ensureAdmin(request);
    const query = z
      .object({
        subjectUserId: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(1000).optional()
      })
      .parse(request.query ?? {});

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.subjectUserId) {
      params.push(query.subjectUserId);
      conditions.push(`l.subject_user_id = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(query.limit ?? 200);

    const result = await pool.query(
      `SELECT l.id, l.tenant_id, l.actor_email, l.subject_user_id, l.resource,
              l.action, l.created_at, u.full_name AS subject_name, u.email AS subject_email
       FROM ferpa_access_log l
       LEFT JOIN users u ON u.id = l.subject_user_id
       ${where}
       ORDER BY l.created_at DESC
       LIMIT $${params.length}`,
      params
    );
    return result.rows;
  });

  app.post('/admin/compliance/ferpa-log', async (request, reply) => {
    const session = ensureAdmin(request);
    const body = ferpaLogCreateSchema.parse(request.body);
    const result = await pool.query(
      `INSERT INTO ferpa_access_log
         (tenant_id, actor_email, subject_user_id, resource, action)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        body.tenantId ?? null,
        body.actorEmail ?? adminEmail(session),
        body.subjectUserId ?? null,
        body.resource,
        body.action
      ]
    );
    return reply.status(201).send(result.rows[0]);
  });

  // ===========================================================================
  // IPEDS/NCES report summary. Pulls institution identifiers from `.env` and
  // best-effort counts from `users` / `student_enrollments` (each guarded so a
  // missing table never breaks the report).
  // ===========================================================================
  app.get('/admin/compliance/ipeds-report', async (request) => {
    ensureAdmin(request);

    const safeCount = async (sql: string): Promise<number | null> => {
      try {
        const result = await pool.query<{ count: string }>(sql);
        return Number(result.rows[0]?.count ?? '0');
      } catch {
        return null;
      }
    };

    const [
      totalUsers,
      totalEnrollments,
      activeEnrollments,
      completedEnrollments,
      degreePrograms,
      activeTerms
    ] = await Promise.all([
      safeCount('SELECT COUNT(*)::text AS count FROM users'),
      safeCount('SELECT COUNT(*)::text AS count FROM student_enrollments'),
      safeCount(
        "SELECT COUNT(*)::text AS count FROM student_enrollments WHERE status = 'enrolled'"
      ),
      safeCount(
        "SELECT COUNT(*)::text AS count FROM student_enrollments WHERE status = 'completed'"
      ),
      safeCount('SELECT COUNT(*)::text AS count FROM degree_programs'),
      safeCount('SELECT COUNT(*)::text AS count FROM academic_terms WHERE is_active = true')
    ]);

    return {
      generatedAt: new Date().toISOString(),
      institution: {
        name: process.env.INSTITUTION_NAME ?? '',
        ncesId: process.env.NCES_ID ?? '',
        ipedsCode: process.env.IPEDS_CODE ?? '',
        stateAuthorizationId: process.env.STATE_AUTHORIZATION_ID ?? '',
        regionalAccreditor: process.env.REGIONAL_ACCREDITOR ?? ''
      },
      compliance: {
        ferpaOfficerEmail: process.env.FERPA_OFFICER_EMAIL ?? '',
        titleIxCoordinatorEmail: process.env.TITLE_IX_COORDINATOR_EMAIL ?? '',
        adaCoordinatorEmail: process.env.ADA_COORDINATOR_EMAIL ?? ''
      },
      counts: {
        totalUsers,
        totalEnrollments,
        activeEnrollments,
        completedEnrollments,
        degreePrograms,
        activeTerms
      }
    };
  });
}
