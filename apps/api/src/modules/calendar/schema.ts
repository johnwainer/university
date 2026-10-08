import type { Pool } from 'pg';

/**
 * Calendario académico — periodos, festivos y malla generada.
 *
 * La tabla `academic_calendar` que ya existía en el módulo SIS guarda eventos
 * sueltos (nombre + fecha). Sirve para publicar un calendario institucional,
 * pero no para gobernar el aula: no sabe de semanas, ni de plazos, ni de qué
 * curso depende de qué periodo. Esto es lo otro.
 *
 * Tres tablas:
 *
 *   academic_holidays   Capa institucional de festivos. Al tocarla se
 *                       recalculan las mallas de los términos activos, que es
 *                       lo que pide la Cláusula 7 cuando habla de desplazar
 *                       automáticamente las fechas afectadas.
 *
 *   term_grids          La malla generada de un término: ocho semanas con sus
 *                       plazos. Se guarda calculada y no se recalcula en cada
 *                       lectura para que el aula y el portal vean exactamente
 *                       las mismas fechas, incluso si alguien cambia un festivo
 *                       a mitad de término (entonces se regenera a propósito y
 *                       queda constancia).
 *
 *   course_schedules    Qué curso de Moodle corre en qué término, y el estado
 *                       de su punto de control de aulas listas.
 */
export async function migrateCalendar(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS academic_holidays (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
      holiday_date DATE NOT NULL,
      name_es TEXT NOT NULL,
      name_en TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS academic_holidays_date_idx
      ON academic_holidays(holiday_date) WHERE is_active;

    CREATE TABLE IF NOT EXISTS term_grids (
      term_id TEXT PRIMARY KEY,
      starts_on DATE NOT NULL,
      ends_on DATE NOT NULL,
      -- La malla completa: ocho semanas con plazos, aperturas y cortes.
      grid JSONB NOT NULL,
      -- Sube en cada regeneración, para que el aula sepa si va por detrás.
      revision INTEGER NOT NULL DEFAULT 1,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS course_schedules (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
      term_id TEXT NOT NULL,
      moodle_course_id BIGINT NOT NULL,
      -- Estado del corte de preparación (§8 del Master Syllabus: jueves 10:00).
      shell_ready BOOLEAN NOT NULL DEFAULT false,
      shell_checked_at TIMESTAMPTZ,
      shell_missing JSONB NOT NULL DEFAULT '[]'::jsonb,
      -- Revisión de la malla que se empujó por última vez a Moodle.
      pushed_revision INTEGER,
      pushed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS course_schedules_term_course_idx
      ON course_schedules(term_id, moodle_course_id);
    CREATE INDEX IF NOT EXISTS course_schedules_term_idx ON course_schedules(term_id);
  `);

  await seedHolidays(pool);
}

/**
 * Festivos federales de EE. UU. del curso 2026–2027 que caen en día lectivo.
 *
 * Sólo se siembran si la tabla está vacía: en cuanto TFU ajuste su propia capa
 * desde el panel, esto no vuelve a tocarla. No incluye los que caen en fin de
 * semana ni los que no afectan a una semana de martes a lunes.
 */
async function seedHolidays(pool: Pool): Promise<void> {
  const existing = await pool.query(`SELECT 1 FROM academic_holidays LIMIT 1`);
  if (existing.rowCount && existing.rowCount > 0) {
    return;
  }
  const seed: Array<[string, string, string]> = [
    ['2026-11-26', 'Día de Acción de Gracias', 'Thanksgiving Day'],
    ['2026-11-27', 'Viernes después de Acción de Gracias', 'Day after Thanksgiving'],
    ['2026-12-25', 'Navidad', 'Christmas Day'],
    ['2027-01-01', 'Año Nuevo', "New Year's Day"],
    ['2027-01-18', 'Día de Martin Luther King Jr.', 'Martin Luther King Jr. Day'],
    ['2027-05-31', 'Día de los Caídos', 'Memorial Day'],
    ['2027-07-05', 'Día de la Independencia (observado)', 'Independence Day (observed)'],
    ['2027-09-06', 'Día del Trabajo', 'Labor Day']
  ];
  for (const [date, nameEs, nameEn] of seed) {
    await pool.query(
      `INSERT INTO academic_holidays (holiday_date, name_es, name_en)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [date, nameEs, nameEn]
    );
  }
}
