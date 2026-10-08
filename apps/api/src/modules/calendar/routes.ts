import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  activeHolidays,
  checkShellReadiness,
  generateTermGrid,
  getTermGrid,
  regenerateAllGrids
} from './service.js';
import { TERM_WEEKS } from './cadence.js';

/**
 * Calendario académico y cadencia del aula.
 *
 * Públicas : GET /api/v1/calendar/terms/:termId   (malla del término)
 *            GET /api/v1/calendar/holidays
 * Admin    : generación de mallas, capa de festivos, asignación de cursos a
 *            término, punto de control de aulas listas y propagación a Moodle.
 */
export interface CalendarContext {
  pool: Pool;
  ensureAdmin: (request: any) => unknown;
  /** Lee el contenido de un curso en Moodle; inyectado para no acoplar módulos. */
  getCourseContents: (courseId: number) => Promise<{ ok: boolean; data?: unknown }>;
  /** Empuja fechas a un curso de Moodle. */
  pushDatesToMoodle: (
    courseId: number,
    grid: Awaited<ReturnType<typeof getTermGrid>>
  ) => Promise<{ ok: boolean; updated: number; error?: string }>;
}

const civilDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Se espera YYYY-MM-DD');

export function registerCalendarRoutes(app: FastifyInstance, ctx: CalendarContext): void {
  const { pool, ensureAdmin } = ctx;

  /* ---------------------------------------------------------------- público */

  app.get('/v1/calendar/holidays', async () => ({ holidays: await activeHolidays(pool) }));

  app.get('/v1/calendar/terms/:termId', async (request, reply) => {
    const { termId } = request.params as { termId: string };
    const stored = await getTermGrid(pool, termId);
    if (!stored) {
      return reply.notFound(`No hay malla generada para el periodo ${termId}`);
    }
    return { termId, revision: stored.revision, termWeeks: TERM_WEEKS, ...stored.grid };
  });

  /* ----------------------------------------------------------------- admin */

  app.post('/admin/calendar/terms/:termId/grid', async (request) => {
    ensureAdmin(request);
    const { termId } = request.params as { termId: string };
    const body = z.object({ startDate: civilDate }).parse(request.body);
    const { grid, revision } = await generateTermGrid(pool, termId, body.startDate);
    return { termId, revision, ...grid };
  });

  app.get('/admin/calendar/holidays', async (request) => {
    ensureAdmin(request);
    const result = await pool.query(
      `SELECT id, holiday_date, name_es, name_en, is_active
         FROM academic_holidays ORDER BY holiday_date`
    );
    return { holidays: result.rows };
  });

  app.post('/admin/calendar/holidays', async (request) => {
    ensureAdmin(request);
    const body = z
      .object({ date: civilDate, nameEs: z.string().min(2), nameEn: z.string().min(2) })
      .parse(request.body);
    const result = await pool.query(
      `INSERT INTO academic_holidays (holiday_date, name_es, name_en)
       VALUES ($1, $2, $3) RETURNING *`,
      [body.date, body.nameEs, body.nameEn]
    );
    // Un festivo nuevo desplaza fechas en todas las secciones activas, no sólo
    // en la que se esté mirando (Cláusula 7).
    const { regenerated } = await regenerateAllGrids(pool);
    return { holiday: result.rows[0], regeneratedTerms: regenerated };
  });

  app.delete('/admin/calendar/holidays/:id', async (request, reply) => {
    ensureAdmin(request);
    const { id } = request.params as { id: string };
    // Se desactiva en vez de borrarse: así queda por qué una malla pasada tenía
    // una fecha desplazada.
    const result = await pool.query(
      `UPDATE academic_holidays SET is_active = false WHERE id = $1 RETURNING id`,
      [id]
    );
    if (result.rowCount === 0) {
      return reply.notFound('Festivo no encontrado');
    }
    const { regenerated } = await regenerateAllGrids(pool);
    return { removed: id, regeneratedTerms: regenerated };
  });

  app.post('/admin/calendar/terms/:termId/courses', async (request) => {
    ensureAdmin(request);
    const { termId } = request.params as { termId: string };
    const body = z.object({ moodleCourseIds: z.array(z.number().int().positive()).min(1) }).parse(
      request.body
    );
    for (const courseId of body.moodleCourseIds) {
      await pool.query(
        `INSERT INTO course_schedules (term_id, moodle_course_id)
         VALUES ($1, $2) ON CONFLICT (term_id, moodle_course_id) DO NOTHING`,
        [termId, courseId]
      );
    }
    return { termId, attached: body.moodleCourseIds.length };
  });

  app.get('/admin/calendar/terms/:termId/shell-check', async (request) => {
    ensureAdmin(request);
    const { termId } = request.params as { termId: string };

    const courses = await pool.query<{ moodle_course_id: string }>(
      `SELECT moodle_course_id FROM course_schedules WHERE term_id = $1`,
      [termId]
    );
    const contents = new Map<number, { sections: Array<{ name?: string; modules?: Array<{ name?: string; modname?: string }> }> }>();
    for (const row of courses.rows) {
      const courseId = Number(row.moodle_course_id);
      const result = await ctx.getCourseContents(courseId);
      if (result.ok && Array.isArray(result.data)) {
        contents.set(courseId, { sections: result.data as never[] });
      }
    }

    const items = await checkShellReadiness(pool, termId, contents);
    return {
      termId,
      checkedAt: new Date().toISOString(),
      total: items.length,
      ready: items.filter((item) => item.ready).length,
      overdue: items.filter((item) => item.overdue).length,
      items
    };
  });

  app.post('/admin/calendar/terms/:termId/push-to-moodle', async (request, reply) => {
    ensureAdmin(request);
    const { termId } = request.params as { termId: string };
    const stored = await getTermGrid(pool, termId);
    if (!stored) {
      return reply.notFound(`No hay malla generada para el periodo ${termId}`);
    }

    const courses = await pool.query<{ moodle_course_id: string }>(
      `SELECT moodle_course_id FROM course_schedules WHERE term_id = $1`,
      [termId]
    );

    const results = [];
    for (const row of courses.rows) {
      const courseId = Number(row.moodle_course_id);
      const pushed = await ctx.pushDatesToMoodle(courseId, stored);
      if (pushed.ok) {
        await pool.query(
          `UPDATE course_schedules
              SET pushed_revision = $3, pushed_at = NOW(), updated_at = NOW()
            WHERE term_id = $1 AND moodle_course_id = $2`,
          [termId, courseId, stored.revision]
        );
      }
      results.push({ moodleCourseId: courseId, ...pushed });
    }

    return {
      termId,
      revision: stored.revision,
      courses: results.length,
      ok: results.filter((item) => item.ok).length,
      results
    };
  });
}
