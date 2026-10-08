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
import { alertMessage, reconcileAlerts, resolveRecipients, type AlertRecipient } from './alerts.js';

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
  /** Profesores con rol docente en un curso de Moodle, para resolver el aviso. */
  teachersInCourse?: (courseId: number) => Promise<Array<{ fullname?: string; email?: string }>>;
  /** Envía el aviso. Si no hay canal configurado, lo dice en vez de fingirlo. */
  sendMail?: (input: { to: string[]; subject: string; text: string }) => Promise<{ configured: boolean; ok: boolean; detail?: string }>;
  /** Destinatario de respaldo cuando el programa no tiene decano cargado. */
  academicContact?: string;
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

    // El chequeo no sólo informa: reconcilia los avisos. Así el mismo endpoint
    // sirve para la pantalla y para el temporizador diario, sin dos caminos que
    // puedan discrepar.
    const notify = (request.query as { notify?: string } | undefined)?.notify !== 'false';
    const alerts = notify
      ? await reconcileAlerts(pool, termId, items, (courseId) =>
          resolveRecipients(pool, courseId, {
            teachersInMoodle: ctx.teachersInCourse,
            fallbackEmail: ctx.academicContact
          })
        )
      : [];

    const delivered: Array<{ moodleCourseId: number; week: number; delivery: string; detail?: string }> = [];
    for (const alert of alerts) {
      // Sólo se intenta entregar un aviso recién abierto o ya vencido. Un
      // 'pending' que ya se avisó no se repite cada día.
      if (!alert.created && alert.severity !== 'overdue') {
        continue;
      }
      const course = items.find((item) => item.moodleCourseId === alert.moodleCourseId);
      const { subject, body } = alertMessage(
        course?.courseName ?? `Curso ${alert.moodleCourseId}`,
        alert.week,
        course?.shellReadyBy ?? null,
        alert.missing,
        alert.severity === 'overdue'
      );
      const result = ctx.sendMail
        ? await ctx.sendMail({ to: alert.recipients.map((r: AlertRecipient) => r.email), subject, text: body })
        : { configured: false, ok: false, detail: 'No hay canal de envío conectado.' };
      const delivery = result.ok ? 'sent' : result.configured ? 'failed' : 'recorded';
      await pool.query(
        `UPDATE shell_alerts SET delivery = $4, delivery_detail = $5, updated_at = NOW()
          WHERE term_id = $1 AND moodle_course_id = $2 AND week = $3 AND resolved_at IS NULL`,
        [termId, alert.moodleCourseId, alert.week, delivery, result.detail ?? null]
      );
      delivered.push({
        moodleCourseId: alert.moodleCourseId,
        week: alert.week,
        delivery,
        detail: result.detail
      });
    }

    return {
      termId,
      checkedAt: new Date().toISOString(),
      total: items.length,
      ready: items.filter((item) => item.ready).length,
      overdue: items.filter((item) => item.overdue).length,
      items,
      alerts: { open: alerts.length, delivered }
    };
  });

  /** Avisos abiertos, para la tarjeta del panel. */
  app.get('/admin/calendar/alerts', async (request) => {
    ensureAdmin(request);
    const query = z
      .object({ termId: z.string().optional(), includeResolved: z.coerce.boolean().optional() })
      .parse(request.query ?? {});
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.termId) {
      params.push(query.termId);
      conditions.push(`sa.term_id = $${params.length}`);
    }
    if (!query.includeResolved) {
      conditions.push('sa.resolved_at IS NULL');
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT sa.*, COALESCE(mc.full_name, '(sin nombre)') AS course_name
         FROM shell_alerts sa
         LEFT JOIN moodle_courses mc ON mc.moodle_course_id = sa.moodle_course_id
         ${where}
        ORDER BY sa.severity DESC, sa.shell_ready_by NULLS LAST, sa.created_at DESC
        LIMIT 200`,
      params
    );
    return { alerts: result.rows };
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
