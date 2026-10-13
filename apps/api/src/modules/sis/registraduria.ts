/**
 * Registraduría: matrícula SIS y registro de calificaciones.
 *
 * ¿Por qué existe este archivo? Porque faltaba el eslabón que conecta lo que
 * ya había. El estado al empezar esta tanda de trabajo era:
 *
 * - `student_enrollments` es la tabla del SIS: lleva el periodo, el programa,
 *   el aula, el estado, la nota y los créditos. La leen el expediente del
 *   estudiante (`/v1/me/transcript`), el promedio (`/v1/me/gpa`), la auditoría
 *   de grado y los contadores del panel.
 * - La matrícula por programa del panel escribía sólo `user_course_enrollments`,
 *   que es el espejo de Moodle. **Nunca escribía `student_enrollments`.**
 * - Por lo tanto el expediente y el promedio del estudiante estaban condenados
 *   a salir vacíos aunque la matrícula en Moodle funcionara, porque nadie
 *   escribía la tabla de la que se leen.
 * - Y la nota no tenía escritor en ninguna parte: ni ruta, ni pantalla.
 *
 * Aquí se cierra eso. La separación que sostiene todo el módulo es:
 *
 *   matrícula en el PROGRAMA  →  hecho de la plataforma  →  student_enrollments
 *   acceso al AULA            →  hecho de Moodle         →  user_course_enrollments
 *
 * Son independientes a propósito. Mientras la matrícula en Moodle siga rota
 * (falta la fila `paeu_ws_client → student` en `role_allow_assign`, y el puerto
 * 22 de esa máquina está cerrado), el estudiante puede estar matriculado en su
 * programa, ver su plan de estudios, su calendario y sus notas, y que el portal
 * le diga de frente que el aula todavía no está disponible. Antes la matrícula
 * entera se caía con Moodle y no quedaba rastro de nada.
 */

import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  ESCALA_ESTANDAR_4_0,
  LETRAS_VALIDAS,
  estadoParaNota,
  notaDeEscala
} from './calificaciones.js';
import { periodoActivo } from './periodos.js';

export interface RegistraduriaContext {
  pool: Pool;
  ensureAdmin: (request: any) => unknown;
}

/** Una matrícula SIS a crear. */
export interface MatriculaSis {
  userId: string;
  termId: string;
  moodleCourseId: number;
  degreeProgramId: string;
  creditHours: number;
}

/**
 * Crea o actualiza la matrícula SIS de un estudiante en un aula de su programa.
 *
 * No toca la nota ni el estado si la matrícula ya existía: rematricular a
 * alguien no puede borrarle una calificación ya registrada. Por eso el
 * `ON CONFLICT` sólo refresca el programa y los créditos.
 */
export async function matricularEnSis(pool: Pool, m: MatriculaSis): Promise<void> {
  await pool.query(
    `INSERT INTO student_enrollments
       (user_id, term_id, moodle_course_id, degree_program_id, status, credit_hours)
     VALUES ($1, $2, $3, $4, 'enrolled', $5)
     ON CONFLICT (user_id, term_id, moodle_course_id) DO UPDATE
        SET degree_program_id = EXCLUDED.degree_program_id,
            credit_hours      = EXCLUDED.credit_hours`,
    [m.userId, m.termId, m.moodleCourseId, m.degreeProgramId, m.creditHours]
  );
}

/**
 * Los créditos que vale un aula.
 *
 * Salen de `moodle_courses.credit_hours`. **TFU todavía no ha confirmado los
 * créditos de los trece programas** (sus `degree_programs.credit_hours_required`
 * están en 0 y los programas son certificados de horas de contacto), así que
 * esto usa lo que haya en la tabla y no se inventa un número por programa.
 */
export async function creditosDelAula(pool: Pool, moodleCourseId: number): Promise<number> {
  const { rows } = await pool.query<{ credit_hours: number }>(
    'SELECT credit_hours FROM moodle_courses WHERE moodle_course_id = $1',
    [moodleCourseId]
  );
  return rows.length ? Number(rows[0].credit_hours) : 3;
}

export function registerRegistraduriaRoutes(app: FastifyInstance, ctx: RegistraduriaContext): void {
  const { pool, ensureAdmin } = ctx;

  /**
   * La escala con la que se califica.
   *
   * Se sirve desde el servidor en vez de duplicarla en el front para que no
   * puedan discrepar, y lleva `pendienteDeConfirmacion` porque es la escala
   * estándar de 4,0 y TFU no ha confirmado la suya. El panel lo muestra como
   * tal: no se presenta una escala inventada como si fuera la de la
   * institución.
   */
  app.get('/admin/registrar/scale', async (request) => {
    ensureAdmin(request);
    return {
      escala: ESCALA_ESTANDAR_4_0,
      pendienteDeConfirmacion: true,
      notaEs:
        'Escala estadounidense estándar de 4,0. TFU todavía no ha confirmado su propia escala de calificación.',
      notaEn: 'Standard US 4.0 scale. TFU has not yet confirmed its own grading scale.'
    };
  });

  /**
   * Las matrículas SIS, que es sobre lo que se califica.
   *
   * Se puede filtrar por periodo, programa o estudiante. Trae el nombre del
   * estudiante y del aula resueltos porque la pantalla los necesita y hacerlo
   * aquí evita que el panel dispare una consulta por fila.
   */
  app.get('/admin/registrar/enrollments', async (request) => {
    ensureAdmin(request);
    const q = z
      .object({
        termCode: z.string().optional(),
        programCode: z.string().optional(),
        studentUserId: z.string().optional()
      })
      .parse(request.query ?? {});

    const params: unknown[] = [];
    const filtros: string[] = [];
    if (q.termCode) {
      params.push(q.termCode);
      filtros.push(`t.code = $${params.length}`);
    }
    if (q.programCode) {
      params.push(q.programCode);
      filtros.push(`dp.code = $${params.length}`);
    }
    if (q.studentUserId) {
      params.push(q.studentUserId);
      filtros.push(`se.user_id = $${params.length}`);
    }
    const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT se.id, se.user_id, se.moodle_course_id, se.status, se.grade, se.grade_points,
              se.credit_hours, se.enrolled_at, se.completed_at,
              u.full_name AS student_name, u.email AS student_email,
              t.code AS term_code, t.name AS term_name,
              dp.code AS program_code, dp.name AS program_name,
              mc.full_name AS course_name, mc.short_name AS course_short_name,
              -- Si el aula es accesible de verdad es un hecho de Moodle, y se
              -- consulta aparte: una matrícula SIS sin espejo en Moodle es
              -- exactamente el estado que produce el bloqueante de matrícula.
              (uce.user_id IS NOT NULL AND uce.status = 'active') AS aula_accesible
         FROM student_enrollments se
         JOIN users u            ON u.id = se.user_id
         JOIN academic_terms t   ON t.id = se.term_id
         LEFT JOIN degree_programs dp ON dp.id = se.degree_program_id
         LEFT JOIN moodle_courses mc  ON mc.moodle_course_id = se.moodle_course_id
         LEFT JOIN user_course_enrollments uce
                ON uce.user_id = se.user_id AND uce.moodle_course_id = se.moodle_course_id
         ${where}
         ORDER BY t.start_date DESC, u.full_name, mc.full_name`,
      params
    );
    return { enrollments: rows };
  });

  /**
   * Registrar la calificación de una matrícula.
   *
   * Los puntos y el estado NO los manda el cliente: se derivan de la letra con
   * la escala del servidor. Si los mandara el cliente podrían contradecirse
   * —una `A` con 0,0 puntos, o una `F` con estado `enrolled`— y la auditoría de
   * grado y el promedio quedarían mintiendo sin que nada fallara.
   */
  app.patch('/admin/registrar/enrollments/:id', async (request, reply) => {
    ensureAdmin(request);
    const { id } = request.params as { id: string };
    const body = z
      .object({
        // `null` borra la nota y devuelve la matrícula a cursando, que es lo
        // que hace falta para corregir un error de registro.
        grade: z
          .union([z.enum(LETRAS_VALIDAS as [string, ...string[]]), z.null()])
          .optional(),
        creditHours: z.number().int().min(0).max(12).optional()
      })
      .parse(request.body ?? {});

    const existe = await pool.query('SELECT id FROM student_enrollments WHERE id = $1', [id]);
    if (!existe.rowCount) return reply.notFound('Matrícula no encontrada');

    if (body.creditHours !== undefined) {
      await pool.query('UPDATE student_enrollments SET credit_hours = $2 WHERE id = $1', [
        id,
        body.creditHours
      ]);
    }

    if (body.grade !== undefined) {
      if (body.grade === null) {
        await pool.query(
          `UPDATE student_enrollments
              SET grade = NULL, grade_points = NULL, status = 'enrolled', completed_at = NULL
            WHERE id = $1`,
          [id]
        );
      } else {
        const nota = notaDeEscala(body.grade);
        if (!nota) return reply.badRequest(`Nota fuera de la escala: ${body.grade}`);
        const estado = estadoParaNota(nota.letra);
        await pool.query(
          `UPDATE student_enrollments
              SET grade = $2,
                  grade_points = $3,
                  status = $4,
                  completed_at = CASE WHEN $4 = 'enrolled' THEN NULL ELSE NOW() END
            WHERE id = $1`,
          [id, nota.letra, nota.puntos, estado]
        );
      }
    }

    const { rows } = await pool.query(
      `SELECT id, user_id, moodle_course_id, status, grade, grade_points, credit_hours, completed_at
         FROM student_enrollments WHERE id = $1`,
      [id]
    );
    return { enrollment: rows[0] };
  });

  /** El periodo en curso, para que la pantalla sepa sobre qué califica. */
  app.get('/admin/registrar/term', async (request) => {
    ensureAdmin(request);
    const periodo = await periodoActivo(pool);
    return { term: periodo };
  });
}
