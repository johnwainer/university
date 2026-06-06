import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';

/**
 * Phase 2 — CRM de admisión + retención.
 *
 * Admin routes for the native CRM-lite (contacts, pipeline, activities) plus
 * the early-alert retention surface. Wired by the orchestrator via
 * `registerCrmRoutes(app, { pool, ensureAdmin })`.
 */
export interface CrmContext {
  pool: Pool;
  ensureAdmin: (request: any) => unknown;
}

const contactCreateSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  source: z.string().optional(),
  stageId: z.string().uuid().optional(),
  ownerEmail: z.string().email().optional(),
  leadScore: z.number().int().optional(),
  status: z.string().optional(),
  notes: z.string().optional(),
  applicationId: z.string().uuid().optional(),
  studentUserId: z.string().optional(),
  tenantId: z.string().uuid().optional()
});

const contactUpdateSchema = contactCreateSchema.partial();

const activityCreateSchema = z.object({
  kind: z.enum(['note', 'email', 'call', 'task', 'status_change']).optional(),
  subject: z.string().optional(),
  body: z.string().optional(),
  dueDate: z.string().optional(),
  completed: z.boolean().optional(),
  tenantId: z.string().uuid().optional()
});

const alertCreateSchema = z.object({
  studentUserId: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high']).optional(),
  reason: z.string().optional(),
  signal: z.string().optional(),
  tenantId: z.string().uuid().optional()
});

export function registerCrmRoutes(app: FastifyInstance, ctx: CrmContext): void {
  const { pool, ensureAdmin } = ctx;

  // ---------------------------------------------------------------------------
  // Pipeline (kanban) — stages with contact counts.
  // ---------------------------------------------------------------------------
  app.get('/admin/crm/pipeline', async (request) => {
    ensureAdmin(request);
    const result = await pool.query(
      `SELECT s.id, s.tenant_id, s.name, s.sort_order, s.is_won, s.is_lost, s.created_at,
              COUNT(c.id)::int AS contact_count
       FROM crm_pipeline_stages s
       LEFT JOIN crm_contacts c ON c.stage_id = s.id
       GROUP BY s.id
       ORDER BY s.sort_order ASC, s.created_at ASC`
    );
    return result.rows;
  });

  // ---------------------------------------------------------------------------
  // Contacts CRUD.
  // ---------------------------------------------------------------------------
  app.get('/admin/crm/contacts', async (request) => {
    ensureAdmin(request);
    const query = z
      .object({ stageId: z.string().uuid().optional(), search: z.string().optional() })
      .parse(request.query ?? {});

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.stageId) {
      params.push(query.stageId);
      conditions.push(`c.stage_id = $${params.length}`);
    }
    if (query.search) {
      params.push(`%${query.search}%`);
      conditions.push(
        `(c.full_name ILIKE $${params.length} OR c.email ILIKE $${params.length})`
      );
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT c.*, s.name AS stage_name
       FROM crm_contacts c
       LEFT JOIN crm_pipeline_stages s ON s.id = c.stage_id
       ${where}
       ORDER BY c.created_at DESC`,
      params
    );
    return result.rows;
  });

  app.post('/admin/crm/contacts', async (request, reply) => {
    ensureAdmin(request);
    const body = contactCreateSchema.parse(request.body);
    const result = await pool.query(
      `INSERT INTO crm_contacts
         (tenant_id, full_name, email, phone, source, stage_id, owner_email,
          lead_score, status, notes, application_id, student_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        body.tenantId ?? null,
        body.fullName,
        body.email ?? null,
        body.phone ?? null,
        body.source ?? null,
        body.stageId ?? null,
        body.ownerEmail ?? null,
        body.leadScore ?? 0,
        body.status ?? null,
        body.notes ?? null,
        body.applicationId ?? null,
        body.studentUserId ?? null
      ]
    );
    return reply.status(201).send(result.rows[0]);
  });

  app.patch('/admin/crm/contacts/:id', async (request) => {
    ensureAdmin(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = contactUpdateSchema.parse(request.body);

    const columnMap: Record<string, unknown> = {
      tenant_id: body.tenantId,
      full_name: body.fullName,
      email: body.email,
      phone: body.phone,
      source: body.source,
      stage_id: body.stageId,
      owner_email: body.ownerEmail,
      lead_score: body.leadScore,
      status: body.status,
      notes: body.notes,
      application_id: body.applicationId,
      student_user_id: body.studentUserId
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
    sets.push('updated_at = now()');
    params.push(id);

    const result = await pool.query(
      `UPDATE crm_contacts SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (result.rowCount === 0) {
      throw app.httpErrors.notFound('Contact not found');
    }
    return result.rows[0];
  });

  app.patch('/admin/crm/contacts/:id/stage', async (request) => {
    ensureAdmin(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ stageId: z.string().uuid() }).parse(request.body);

    const result = await pool.query(
      `UPDATE crm_contacts SET stage_id = $1, updated_at = now()
       WHERE id = $2 RETURNING *`,
      [body.stageId, id]
    );
    if (result.rowCount === 0) {
      throw app.httpErrors.notFound('Contact not found');
    }

    // Log the stage change as an activity for the funnel timeline.
    await pool.query(
      `INSERT INTO crm_activities (tenant_id, contact_id, kind, subject)
       VALUES ($1, $2, 'status_change', $3)`,
      [result.rows[0].tenant_id ?? null, id, 'Stage changed']
    );

    return result.rows[0];
  });

  app.delete('/admin/crm/contacts/:id', async (request) => {
    ensureAdmin(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await pool.query(
      'DELETE FROM crm_contacts WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rowCount === 0) {
      throw app.httpErrors.notFound('Contact not found');
    }
    return { deleted: true, id };
  });

  // ---------------------------------------------------------------------------
  // Activities (per contact).
  // ---------------------------------------------------------------------------
  app.get('/admin/crm/contacts/:id/activities', async (request) => {
    ensureAdmin(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await pool.query(
      `SELECT * FROM crm_activities WHERE contact_id = $1 ORDER BY created_at DESC`,
      [id]
    );
    return result.rows;
  });

  app.post('/admin/crm/contacts/:id/activities', async (request, reply) => {
    ensureAdmin(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = activityCreateSchema.parse(request.body);

    const contact = await pool.query(
      'SELECT id FROM crm_contacts WHERE id = $1',
      [id]
    );
    if (contact.rowCount === 0) {
      throw app.httpErrors.notFound('Contact not found');
    }

    const result = await pool.query(
      `INSERT INTO crm_activities
         (tenant_id, contact_id, kind, subject, body, due_date, completed)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        body.tenantId ?? null,
        id,
        body.kind ?? 'note',
        body.subject ?? null,
        body.body ?? null,
        body.dueDate ?? null,
        body.completed ?? false
      ]
    );
    return reply.status(201).send(result.rows[0]);
  });

  // ---------------------------------------------------------------------------
  // Early alerts (retention).
  // ---------------------------------------------------------------------------
  app.get('/admin/crm/early-alerts', async (request) => {
    ensureAdmin(request);
    const query = z
      .object({ resolved: z.enum(['true', 'false']).optional() })
      .parse(request.query ?? {});

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.resolved) {
      params.push(query.resolved === 'true');
      conditions.push(`a.resolved = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT a.*, u.full_name AS student_name, u.email AS student_email
       FROM early_alerts a
       LEFT JOIN users u ON u.id = a.student_user_id
       ${where}
       ORDER BY a.resolved ASC,
                CASE a.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END ASC,
                a.created_at DESC`,
      params
    );
    return result.rows;
  });

  app.post('/admin/crm/early-alerts', async (request, reply) => {
    ensureAdmin(request);
    const body = alertCreateSchema.parse(request.body);
    const result = await pool.query(
      `INSERT INTO early_alerts (tenant_id, student_user_id, severity, reason, signal)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        body.tenantId ?? null,
        body.studentUserId,
        body.severity ?? 'low',
        body.reason ?? null,
        body.signal ?? null
      ]
    );
    return reply.status(201).send(result.rows[0]);
  });

  app.patch('/admin/crm/early-alerts/:id/resolve', async (request) => {
    ensureAdmin(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await pool.query(
      `UPDATE early_alerts
       SET resolved = true, resolved_at = now()
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    if (result.rowCount === 0) {
      throw app.httpErrors.notFound('Early alert not found');
    }
    return result.rows[0];
  });
}
