/**
 * Reconciliación de periodos académicos.
 *
 * El proyecto tenía dos nociones de «periodo» que no se hablaban, y eso es lo
 * que impedía que existiera una sola matrícula SIS real:
 *
 * 1. `academic_terms` es la tabla a la que apunta la clave ajena de
 *    `student_enrollments`. En producción sólo contenía tres periodos de
 *    demostración heredados de la plantilla (`DEMO-2025FA`, `DEMO-2026SP`,
 *    `DEMO-2026SU`), y el marcado como activo era Spring 2026, que terminó en
 *    mayo.
 * 2. `term_grids` es donde el módulo de calendario de la Etapa II guarda el
 *    periodo real con su malla de ocho semanas. Su `term_id` es texto libre
 *    —lo elige quien llama a `POST /admin/calendar/terms/:termId/grid`— y no
 *    tiene clave ajena a nada. Así entró `TERM-2026-FALL`, que no aparece como
 *    literal en ningún archivo del repositorio porque es un dato, no código.
 *
 * Consecuencia: no se podía insertar una matrícula para el periodo real porque
 * la clave ajena no tenía a dónde apuntar. La tabla sólo tenía las doce filas
 * del `seed-demo.ts`, con aulas que no son de TFU.
 *
 * Esta función las une por el camino menos invasivo: el `term_id` de la malla
 * pasa a ser el CÓDIGO del periodo en `academic_terms`. No se reescribe el
 * módulo de calendario, que ya guarda ese identificador en tres tablas
 * (`term_grids`, `course_schedules`, `shell_alerts`), y el SIS gana un periodo
 * real al que apuntar.
 *
 * Las fechas y el nombre NO se inventan: salen de la malla que ya existe. Por
 * eso el nombre de un periodo recién reconciliado es su propio código hasta que
 * alguien lo renombre desde el panel — es menos bonito que «Otoño 2026», pero
 * es un dato que TFU puso, no uno que nos inventáramos aquí (§10).
 */

import type { Pool } from 'pg';

export interface PeriodoReconciliado {
  code: string;
  id: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  creado: boolean;
}

/**
 * Da de alta en `academic_terms` todo periodo que exista como malla, y recalcula
 * cuál está activo a partir de las fechas.
 *
 * Idempotente: se ejecuta en cada arranque. Si la malla se regenera con otras
 * fechas, el periodo las adopta.
 */
export async function reconciliarPeriodos(pool: Pool): Promise<PeriodoReconciliado[]> {
  const { rows: mallas } = await pool.query<{
    term_id: string;
    starts_on: string;
    ends_on: string;
  }>('SELECT term_id, starts_on, ends_on FROM term_grids ORDER BY starts_on');

  const resultado: PeriodoReconciliado[] = [];

  for (const malla of mallas) {
    // El código del periodo es el identificador de la malla. `ON CONFLICT` por
    // código y no por id porque el id es un uuid generado y el código es lo
    // único estable entre las dos tablas.
    const { rows } = await pool.query<{ id: string; creado: boolean }>(
      `INSERT INTO academic_terms (name, code, start_date, end_date, is_active)
       VALUES ($1, $1, $2, $3, false)
       ON CONFLICT (code) DO UPDATE
          SET start_date = EXCLUDED.start_date,
              end_date   = EXCLUDED.end_date
       RETURNING id, (xmax = 0) AS creado`,
      [malla.term_id, malla.starts_on, malla.ends_on]
    );

    resultado.push({
      code: malla.term_id,
      id: rows[0].id,
      startDate: malla.starts_on,
      endDate: malla.ends_on,
      isActive: false,
      creado: rows[0].creado
    });
  }

  // Activo es el que contiene hoy, y sólo ese. Antes `is_active` era un
  // interruptor que alguien ponía a mano y que se quedaba encendido para
  // siempre: así es como Spring 2026 seguía siendo «el periodo activo» en
  // octubre. Derivarlo de las fechas lo arregla y lo mantiene arreglado.
  await pool.query(
    `UPDATE academic_terms
        SET is_active = (CURRENT_DATE BETWEEN start_date AND end_date)
      WHERE is_active <> (CURRENT_DATE BETWEEN start_date AND end_date)`
  );

  for (const periodo of resultado) {
    const hoy = new Date().toISOString().slice(0, 10);
    periodo.isActive = periodo.startDate <= hoy && hoy <= periodo.endDate;
  }

  return resultado;
}

/**
 * El periodo activo, o null si hoy no cae dentro de ninguno.
 *
 * Devuelve null en vez de recurrir al más reciente a propósito: matricular a
 * alguien en un periodo que no está en curso es un error que debe verse, no
 * algo que la función tape eligiendo por su cuenta.
 */
export async function periodoActivo(
  pool: Pool
): Promise<{ id: string; code: string; name: string; startDate: string; endDate: string } | null> {
  const { rows } = await pool.query(
    `SELECT id, code, name, start_date, end_date
       FROM academic_terms
      WHERE is_active
        AND CURRENT_DATE BETWEEN start_date AND end_date
      ORDER BY start_date DESC
      LIMIT 1`
  );
  if (!rows.length) return null;
  return {
    id: rows[0].id,
    code: rows[0].code,
    name: rows[0].name,
    startDate:
      rows[0].start_date instanceof Date
        ? rows[0].start_date.toISOString().slice(0, 10)
        : String(rows[0].start_date).slice(0, 10),
    endDate:
      rows[0].end_date instanceof Date
        ? rows[0].end_date.toISOString().slice(0, 10)
        : String(rows[0].end_date).slice(0, 10)
  };
}
