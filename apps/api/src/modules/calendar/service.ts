/**
 * Calendario académico — generación de mallas y punto de control de aulas.
 */
import type { Pool } from 'pg';
import { buildTermGrid, upcomingWeek, weekFor, type Holiday, type TermGrid } from './cadence.js';

export async function activeHolidays(pool: Pool): Promise<Holiday[]> {
  const result = await pool.query<{ holiday_date: Date; name_es: string; name_en: string }>(
    `SELECT holiday_date, name_es, name_en FROM academic_holidays WHERE is_active ORDER BY holiday_date`
  );
  return result.rows.map((row) => ({
    // `DATE` vuelve como Date en UTC; se corta la parte civil sin convertir de
    // zona, que es lo que la malla espera.
    date: row.holiday_date.toISOString().slice(0, 10),
    nameEs: row.name_es,
    nameEn: row.name_en
  }));
}

/**
 * Genera (o regenera) la malla de un término y la guarda.
 *
 * Se guarda calculada en vez de recalcularse en cada lectura para que el aula
 * de Moodle y el portal vean las mismas fechas. Cuando cambia un festivo se
 * regenera a propósito y la revisión sube, de modo que se sabe qué cursos
 * tienen en Moodle una versión vieja.
 */
export async function generateTermGrid(
  pool: Pool,
  termId: string,
  startDate: string
): Promise<{ grid: TermGrid; revision: number }> {
  const holidays = await activeHolidays(pool);
  const grid = buildTermGrid(startDate, holidays);

  const result = await pool.query<{ revision: number }>(
    `INSERT INTO term_grids (term_id, starts_on, ends_on, grid, revision, generated_at)
     VALUES ($1, $2, $3, $4::jsonb, 1, NOW())
     ON CONFLICT (term_id) DO UPDATE
       SET starts_on = EXCLUDED.starts_on,
           ends_on = EXCLUDED.ends_on,
           grid = EXCLUDED.grid,
           revision = term_grids.revision + 1,
           generated_at = NOW()
     RETURNING revision`,
    [termId, grid.termStartsOn, grid.termEndsOn, JSON.stringify(grid)]
  );

  return { grid, revision: result.rows[0].revision };
}

export async function getTermGrid(
  pool: Pool,
  termId: string
): Promise<{ grid: TermGrid; revision: number } | null> {
  const result = await pool.query<{ grid: TermGrid; revision: number }>(
    `SELECT grid, revision FROM term_grids WHERE term_id = $1`,
    [termId]
  );
  const row = result.rows[0];
  return row ? { grid: row.grid, revision: row.revision } : null;
}

/**
 * Recalcula todas las mallas existentes.
 *
 * Se llama al tocar la capa de festivos: la Cláusula 7 pide que un festivo
 * desplace automáticamente las fechas afectadas de TODAS las secciones
 * activas, no sólo de la que se esté mirando.
 */
export async function regenerateAllGrids(pool: Pool): Promise<{ regenerated: number }> {
  const terms = await pool.query<{ term_id: string; starts_on: Date }>(
    `SELECT term_id, starts_on FROM term_grids`
  );
  let regenerated = 0;
  for (const term of terms.rows) {
    await generateTermGrid(pool, term.term_id, term.starts_on.toISOString().slice(0, 10));
    regenerated += 1;
  }
  return { regenerated };
}

export type ShellCheckItem = {
  moodleCourseId: number;
  courseName: string;
  week: number | null;
  shellReadyBy: string | null;
  ready: boolean;
  missing: string[];
  /** Cierto si ya pasó el corte y el aula sigue incompleta. */
  overdue: boolean;
};

/**
 * Punto de control de aulas listas (§8 del Master Syllabus).
 *
 * «Los profesores deben tener sus aulas listas los jueves a las 10 AM antes de
 * que la clase empiece el martes». Esto compara, para la semana entrante, lo
 * que el aula tiene contra lo que debería tener, y marca lo que falta.
 *
 * Es un checklist de estado, no un dashboard: el contrato lo dice
 * explícitamente y la capa de métricas es Etapa V.
 */
export async function checkShellReadiness(
  pool: Pool,
  termId: string,
  courseContents: Map<number, { sections: Array<{ name?: string; modules?: Array<{ name?: string; modname?: string }> }> }>
): Promise<ShellCheckItem[]> {
  const stored = await getTermGrid(pool, termId);
  if (!stored) {
    return [];
  }
  const next = upcomingWeek(stored.grid) ?? weekFor(stored.grid);
  const now = Date.now();

  const courses = await pool.query<{ moodle_course_id: string; full_name: string }>(
    `SELECT cs.moodle_course_id, COALESCE(mc.full_name, '(sin nombre)') AS full_name
       FROM course_schedules cs
       LEFT JOIN moodle_courses mc ON mc.moodle_course_id = cs.moodle_course_id
      WHERE cs.term_id = $1`,
    [termId]
  );

  const items: ShellCheckItem[] = [];
  for (const row of courses.rows) {
    const courseId = Number(row.moodle_course_id);
    const contents = courseContents.get(courseId);
    const missing: string[] = [];

    if (!contents) {
      missing.push('No se pudo leer el contenido del aula en Moodle.');
    } else if (next) {
      const section = contents.sections.find((item) =>
        new RegExp(`\\b(semana|week)\\s*${next.week}\\b`, 'i').test(item.name ?? '')
      );
      if (!section) {
        missing.push(`No existe la sección de la semana ${next.week}.`);
      } else {
        const modules = section.modules ?? [];
        const kinds = new Set(modules.map((module) => module.modname));
        if (!kinds.has('forum')) missing.push('Falta el foro de discusión de la semana.');
        if (!kinds.has('assign')) missing.push('Falta la entrega de la semana.');
        if (modules.length === 0) missing.push('La sección de la semana está vacía.');
      }
    }

    const ready = missing.length === 0;
    const shellReadyBy = next?.shellReadyBy ?? null;
    await pool.query(
      `UPDATE course_schedules
          SET shell_ready = $3, shell_checked_at = NOW(), shell_missing = $4::jsonb, updated_at = NOW()
        WHERE term_id = $1 AND moodle_course_id = $2`,
      [termId, courseId, ready, JSON.stringify(missing)]
    );

    items.push({
      moodleCourseId: courseId,
      courseName: row.full_name,
      week: next?.week ?? null,
      shellReadyBy,
      ready,
      missing,
      overdue: !ready && shellReadyBy !== null && Date.parse(shellReadyBy) < now
    });
  }

  return items;
}
