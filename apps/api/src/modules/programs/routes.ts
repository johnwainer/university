import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';

/**
 * Composición de programas desde el panel.
 *
 * El programa es la unidad que el estudiante ve y cursa; estas rutas son las
 * que permiten decir qué cursos contiene cada uno. Cuelgan de
 * `/admin/degree-programs`, que el guardián de permisos ya asigna a la sección
 * `sis`, así que respetan los roles sin configuración adicional.
 */
export interface ProgramsAdminContext {
  pool: Pool;
  ensureAdmin: (request: any) => any;
}

const vincularSchema = z.object({
  moodleCourseId: z.number().int().positive(),
  sortOrder: z.number().int().min(0).optional()
});

const ordenSchema = z.object({
  // Lista completa de ids en el orden deseado. Se manda entera y no por
  // parejas para que el orden quede consistente en una sola operación.
  moodleCourseIds: z.array(z.number().int().positive())
});

export function registerProgramsAdminRoutes(app: FastifyInstance, ctx: ProgramsAdminContext): void {
  const { pool, ensureAdmin } = ctx;

  /** Los programas con los cursos que contienen. */
  app.get('/admin/degree-programs/composition', async (request) => {
    ensureAdmin(request);
    const { rows } = await pool.query(`
      SELECT dp.id, dp.code, dp.name, dp.is_active,
             COALESCE(
               json_agg(
                 json_build_object(
                   'moodleCourseId', mc.moodle_course_id,
                   'shortName', mc.short_name,
                   'fullName', mc.full_name,
                   'visible', mc.visible,
                   'sortOrder', dr.sort_order
                 ) ORDER BY dr.sort_order, mc.moodle_course_id
               ) FILTER (WHERE mc.moodle_course_id IS NOT NULL),
               '[]'
             ) AS courses
        FROM degree_programs dp
        LEFT JOIN degree_requirements dr
               ON dr.degree_program_id = dp.id
              AND dr.requirement_type = 'course'
              AND dr.moodle_course_id IS NOT NULL
        LEFT JOIN moodle_courses mc ON mc.moodle_course_id = dr.moodle_course_id
       GROUP BY dp.id, dp.code, dp.name, dp.is_active
       ORDER BY dp.is_active DESC, dp.code
    `);
    return { programs: rows };
  });

  /**
   * Aulas de Moodle que todavía no pertenecen a ningún programa.
   *
   * Es lo que hace falta para componer: ofrecer sólo lo asignable. Un curso ya
   * asignado no aparece, porque pertenecer a dos programas a la vez haría
   * ambiguo de qué programa depende la matrícula de un estudiante.
   */
  app.get('/admin/degree-programs/available-courses', async (request) => {
    ensureAdmin(request);
    const { rows } = await pool.query(`
      SELECT mc.moodle_course_id, mc.short_name, mc.full_name, mc.visible
        FROM moodle_courses mc
       WHERE NOT EXISTS (
         SELECT 1 FROM degree_requirements dr
          WHERE dr.requirement_type = 'course' AND dr.moodle_course_id = mc.moodle_course_id
       )
       ORDER BY mc.moodle_course_id
    `);
    return { courses: rows };
  });

  app.post('/admin/degree-programs/:id/courses', async (request, reply) => {
    ensureAdmin(request);
    const { id } = request.params as { id: string };
    const body = vincularSchema.parse(request.body);

    const programa = await pool.query('SELECT code FROM degree_programs WHERE id = $1', [id]);
    if (!programa.rowCount) return reply.notFound('Programa no encontrado');

    const curso = await pool.query('SELECT 1 FROM moodle_courses WHERE moodle_course_id = $1', [body.moodleCourseId]);
    if (!curso.rowCount) return reply.badRequest('Ese curso no existe en Moodle');

    // Un curso en dos programas dejaría ambiguo de qué programa depende la
    // matrícula de quien lo esté cursando, así que se bloquea aquí.
    const yaAsignado = await pool.query(
      `SELECT dp.code FROM degree_requirements dr
         JOIN degree_programs dp ON dp.id = dr.degree_program_id
        WHERE dr.requirement_type = 'course' AND dr.moodle_course_id = $1`,
      [body.moodleCourseId]
    );
    if (yaAsignado.rowCount) {
      return reply.conflict(`Ese curso ya pertenece al programa ${yaAsignado.rows[0].code}`);
    }

    await pool.query(
      `INSERT INTO degree_requirements (degree_program_id, requirement_type, moodle_course_id, description, sort_order)
       VALUES ($1, 'course', $2, $3, $4)`,
      [id, body.moodleCourseId, `Curso del programa ${programa.rows[0].code}`, body.sortOrder ?? 0]
    );
    return { linked: true };
  });

  app.delete('/admin/degree-programs/:id/courses/:moodleCourseId', async (request, reply) => {
    ensureAdmin(request);
    const { id, moodleCourseId } = request.params as { id: string; moodleCourseId: string };

    // Si hay estudiantes cursándolo, quitarlo del programa los dejaría con una
    // matrícula que ya no cuelga de nada. Se avisa en vez de romperlo en silencio.
    const matriculados = await pool.query(
      `SELECT count(*)::int n FROM student_enrollments
        WHERE degree_program_id = $1 AND moodle_course_id = $2 AND status = 'enrolled'`,
      [id, Number(moodleCourseId)]
    );
    if (matriculados.rows[0].n > 0) {
      return reply.badRequest(
        `${matriculados.rows[0].n} estudiante(s) tienen matrícula activa en ese curso dentro del programa`
      );
    }

    const r = await pool.query(
      `DELETE FROM degree_requirements
        WHERE degree_program_id = $1 AND requirement_type = 'course' AND moodle_course_id = $2`,
      [id, Number(moodleCourseId)]
    );
    if (!r.rowCount) return reply.notFound('Ese curso no pertenece a este programa');
    return { unlinked: true };
  });

  app.put('/admin/degree-programs/:id/courses/order', async (request, reply) => {
    ensureAdmin(request);
    const { id } = request.params as { id: string };
    const { moodleCourseIds } = ordenSchema.parse(request.body);

    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      for (let i = 0; i < moodleCourseIds.length; i += 1) {
        await cliente.query(
          `UPDATE degree_requirements SET sort_order = $3
            WHERE degree_program_id = $1 AND requirement_type = 'course' AND moodle_course_id = $2`,
          [id, moodleCourseIds[i], i]
        );
      }
      await cliente.query('COMMIT');
    } catch (e) {
      await cliente.query('ROLLBACK');
      throw e;
    } finally {
      cliente.release();
    }
    return { reordered: true };
  });
}
