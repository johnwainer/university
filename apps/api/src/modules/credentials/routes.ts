import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';

/**
 * Phase 5 — Advanced LMS: competencies (CBE), badges and verifiable
 * certificates layered on top of Moodle.
 *
 * The context carries the shared `pool` and the platform `ensureAdmin` guard.
 * For the authenticated public `/v1/me/*` routes we need the current public
 * user; public sessions live in an in-memory map inside `server.ts`, so the
 * orchestrator passes a `getPublicSession` resolver when wiring this module.
 * It is optional so the module still type-checks/registers if the orchestrator
 * has not wired it yet; in that case the `/v1/me/*` routes reply 401.
 */
export interface CredentialsContext {
  pool: Pool;
  ensureAdmin: (request: any) => unknown;
  /**
   * Resolves the authenticated public user from the request (bearer token).
   * Should return at least `{ userId: string }` or throw / return null when the
   * caller is not authenticated.
   */
  getPublicSession?: (request: any) => { userId: string } | null;
}

function makeSerial(): string {
  // Human-readable certificate serial, e.g. PAEU-3F9A1C-7B2E.
  const a = randomBytes(3).toString('hex').toUpperCase();
  const b = randomBytes(2).toString('hex').toUpperCase();
  return `PAEU-${a}-${b}`;
}

function makeVerificationCode(): string {
  // Opaque, URL-safe verification code.
  return randomUUID().replace(/-/g, '');
}

export function registerCredentialsRoutes(app: FastifyInstance, ctx: CredentialsContext): void {
  const { pool, ensureAdmin } = ctx;

  function requirePublicUserId(request: any): string {
    if (!ctx.getPublicSession) {
      throw app.httpErrors.unauthorized('Public session resolver not configured');
    }
    const session = ctx.getPublicSession(request);
    if (!session || !session.userId) {
      throw app.httpErrors.unauthorized('Not authenticated');
    }
    return session.userId;
  }

  // ---------------------------------------------------------------------------
  // Admin — Competencies
  // ---------------------------------------------------------------------------
  app.get('/admin/competencies', async (request) => {
    ensureAdmin(request);
    const result = await pool.query(
      `SELECT c.id, c.tenant_id, c.name, c.code, c.description, c.moodle_course_id,
              c.degree_program_id, c.created_at,
              mc.full_name AS course_name,
              dp.name AS degree_program_name
       FROM competencies c
       LEFT JOIN moodle_courses mc ON mc.moodle_course_id = c.moodle_course_id
       LEFT JOIN degree_programs dp ON dp.id = c.degree_program_id
       ORDER BY c.created_at DESC`
    );
    return result.rows;
  });

  app.post('/admin/competencies', async (request, reply) => {
    ensureAdmin(request);
    const body = z
      .object({
        name: z.string().min(1),
        code: z.string().min(1),
        description: z.string().optional(),
        moodleCourseId: z.number().int().nullable().optional(),
        degreeProgramId: z.string().nullable().optional()
      })
      .parse(request.body);
    const result = await pool.query(
      `INSERT INTO competencies (name, code, description, moodle_course_id, degree_program_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        body.name,
        body.code,
        body.description ?? null,
        body.moodleCourseId ?? null,
        body.degreeProgramId ?? null
      ]
    );
    return reply.status(201).send(result.rows[0]);
  });

  app.patch('/admin/competencies/:id', async (request, reply) => {
    ensureAdmin(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        name: z.string().min(1).optional(),
        code: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        moodleCourseId: z.number().int().nullable().optional(),
        degreeProgramId: z.string().nullable().optional()
      })
      .parse(request.body);
    const result = await pool.query(
      `UPDATE competencies
       SET name = COALESCE($2, name),
           code = COALESCE($3, code),
           description = COALESCE($4, description),
           moodle_course_id = COALESCE($5, moodle_course_id),
           degree_program_id = COALESCE($6, degree_program_id)
       WHERE id = $1
       RETURNING *`,
      [
        id,
        body.name ?? null,
        body.code ?? null,
        body.description ?? null,
        body.moodleCourseId ?? null,
        body.degreeProgramId ?? null
      ]
    );
    if (result.rowCount === 0) {
      throw app.httpErrors.notFound('Competency not found');
    }
    return reply.send(result.rows[0]);
  });

  app.delete('/admin/competencies/:id', async (request, reply) => {
    ensureAdmin(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await pool.query('DELETE FROM competencies WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      throw app.httpErrors.notFound('Competency not found');
    }
    return reply.status(204).send();
  });

  // ---------------------------------------------------------------------------
  // Admin — Badges
  // ---------------------------------------------------------------------------
  app.get('/admin/badges', async (request) => {
    ensureAdmin(request);
    const result = await pool.query(
      `SELECT b.id, b.tenant_id, b.name, b.description, b.criteria, b.image_url,
              b.competency_id, b.created_at,
              c.name AS competency_name
       FROM badges b
       LEFT JOIN competencies c ON c.id = b.competency_id
       ORDER BY b.created_at DESC`
    );
    return result.rows;
  });

  app.post('/admin/badges', async (request, reply) => {
    ensureAdmin(request);
    const body = z
      .object({
        name: z.string().min(1),
        description: z.string().optional(),
        criteria: z.string().optional(),
        imageUrl: z.string().nullable().optional(),
        competencyId: z.string().uuid().nullable().optional()
      })
      .parse(request.body);
    const result = await pool.query(
      `INSERT INTO badges (name, description, criteria, image_url, competency_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        body.name,
        body.description ?? null,
        body.criteria ?? null,
        body.imageUrl ?? null,
        body.competencyId ?? null
      ]
    );
    return reply.status(201).send(result.rows[0]);
  });

  app.delete('/admin/badges/:id', async (request, reply) => {
    ensureAdmin(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await pool.query('DELETE FROM badges WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      throw app.httpErrors.notFound('Badge not found');
    }
    return reply.status(204).send();
  });

  // ---------------------------------------------------------------------------
  // Admin — Student competency progress
  // ---------------------------------------------------------------------------
  app.get('/admin/students/:id/competencies', async (request) => {
    ensureAdmin(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const result = await pool.query(
      `SELECT scp.id, scp.tenant_id, scp.student_user_id, scp.competency_id, scp.status,
              scp.evidence, scp.achieved_at, scp.created_at,
              c.name AS competency_name, c.code AS competency_code
       FROM student_competency_progress scp
       JOIN competencies c ON c.id = scp.competency_id
       WHERE scp.student_user_id = $1
       ORDER BY c.name`,
      [id]
    );
    return result.rows;
  });

  app.post('/admin/students/:id/competencies', async (request, reply) => {
    ensureAdmin(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        competencyId: z.string().uuid(),
        status: z.enum(['not_started', 'in_progress', 'mastered']),
        evidence: z.string().nullable().optional()
      })
      .parse(request.body);
    const achievedAt = body.status === 'mastered' ? new Date().toISOString() : null;
    const result = await pool.query(
      `INSERT INTO student_competency_progress
         (student_user_id, competency_id, status, evidence, achieved_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (student_user_id, competency_id)
       DO UPDATE SET status = EXCLUDED.status,
                     evidence = EXCLUDED.evidence,
                     achieved_at = CASE
                       WHEN EXCLUDED.status = 'mastered'
                         THEN COALESCE(student_competency_progress.achieved_at, EXCLUDED.achieved_at)
                       ELSE NULL
                     END
       RETURNING *`,
      [id, body.competencyId, body.status, body.evidence ?? null, achievedAt]
    );
    return reply.status(201).send(result.rows[0]);
  });

  // ---------------------------------------------------------------------------
  // Admin — Issue certificate
  // ---------------------------------------------------------------------------
  app.post('/admin/certificates/issue', async (request, reply) => {
    ensureAdmin(request);
    const body = z
      .object({
        studentUserId: z.string(),
        title: z.string().min(1),
        kind: z.enum(['course', 'program', 'badge']),
        moodleCourseId: z.number().int().nullable().optional(),
        degreeProgramId: z.string().nullable().optional()
      })
      .parse(request.body);

    // Retry a couple of times in the (astronomically unlikely) event of a
    // serial / verification_code collision.
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await pool.query(
          `INSERT INTO certificates
             (student_user_id, title, kind, moodle_course_id, degree_program_id, serial, verification_code)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            body.studentUserId,
            body.title,
            body.kind,
            body.moodleCourseId ?? null,
            body.degreeProgramId ?? null,
            makeSerial(),
            makeVerificationCode()
          ]
        );
        return reply.status(201).send(result.rows[0]);
      } catch (error) {
        lastError = error;
      }
    }
    throw app.httpErrors.internalServerError(
      `Could not issue certificate: ${lastError instanceof Error ? lastError.message : 'unknown error'}`
    );
  });

  app.get('/admin/certificates', async (request) => {
    ensureAdmin(request);
    const result = await pool.query(
      `SELECT cert.id, cert.tenant_id, cert.student_user_id, cert.title, cert.kind,
              cert.moodle_course_id, cert.degree_program_id, cert.serial,
              cert.verification_code, cert.issued_at, cert.created_at,
              u.full_name AS student_name, u.email AS student_email,
              dp.name AS degree_program_name
       FROM certificates cert
       LEFT JOIN users u ON u.id = cert.student_user_id
       LEFT JOIN degree_programs dp ON dp.id = cert.degree_program_id
       ORDER BY cert.issued_at DESC`
    );
    return result.rows;
  });

  // ---------------------------------------------------------------------------
  // Public (authenticated student) — /v1/me/*
  // ---------------------------------------------------------------------------
  app.get('/v1/me/certificates', async (request) => {
    const userId = requirePublicUserId(request);
    const result = await pool.query(
      `SELECT cert.id, cert.title, cert.kind, cert.serial, cert.verification_code,
              cert.moodle_course_id, cert.degree_program_id, cert.issued_at,
              mc.full_name AS course_name,
              dp.name AS degree_program_name
       FROM certificates cert
       LEFT JOIN moodle_courses mc ON mc.moodle_course_id = cert.moodle_course_id
       LEFT JOIN degree_programs dp ON dp.id = cert.degree_program_id
       WHERE cert.student_user_id = $1
       ORDER BY cert.issued_at DESC`,
      [userId]
    );
    return result.rows;
  });

  app.get('/v1/me/competencies', async (request) => {
    const userId = requirePublicUserId(request);
    const result = await pool.query(
      `SELECT scp.id, scp.competency_id, scp.status, scp.evidence, scp.achieved_at,
              c.name AS competency_name, c.code AS competency_code, c.description
       FROM student_competency_progress scp
       JOIN competencies c ON c.id = scp.competency_id
       WHERE scp.student_user_id = $1
       ORDER BY c.name`,
      [userId]
    );
    return result.rows;
  });

  // ---------------------------------------------------------------------------
  // Public (no auth) — verification endpoint
  // ---------------------------------------------------------------------------
  app.get('/v1/verify/:verificationCode', async (request) => {
    const { verificationCode } = z
      .object({ verificationCode: z.string().min(1) })
      .parse(request.params);
    const result = await pool.query(
      `SELECT cert.title, cert.kind, cert.serial, cert.issued_at,
              u.full_name AS student_name,
              mc.full_name AS course_name,
              dp.name AS degree_program_name
       FROM certificates cert
       LEFT JOIN users u ON u.id = cert.student_user_id
       LEFT JOIN moodle_courses mc ON mc.moodle_course_id = cert.moodle_course_id
       LEFT JOIN degree_programs dp ON dp.id = cert.degree_program_id
       WHERE cert.verification_code = $1`,
      [verificationCode]
    );
    const row = result.rows[0];
    if (!row) {
      return { valid: false };
    }
    return {
      valid: true,
      title: row.title,
      kind: row.kind,
      serial: row.serial,
      issuedAt: row.issued_at,
      studentName: row.student_name ?? null,
      courseName: row.course_name ?? null,
      degreeProgram: row.degree_program_name ?? null
    };
  });
}
