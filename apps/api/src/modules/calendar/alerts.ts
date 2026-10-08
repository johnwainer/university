/**
 * Avisos del punto de control de aulas listas (§8 del Master Syllabus).
 *
 * El checklist ya decía si un aula estaba lista; lo que faltaba era que
 * alguien se enterara sin entrar a mirarlo. «Los profesores deben tener sus
 * aulas listas los jueves a las 10 AM antes de que la clase empiece el
 * martes»: si el corte pasa y el aula sigue incompleta, el aviso tiene que
 * salir solo.
 *
 * Tres decisiones:
 *
 * 1. El aviso es un registro, no un correo. La tabla es el sistema de verdad:
 *    sobrevive a un fallo de entrega, se puede consultar desde el panel y deja
 *    constancia de cuándo se avisó y cuándo se resolvió. El envío es un efecto
 *    secundario de ese registro.
 *
 * 2. Un aviso abierto por curso y semana. Ejecutar el chequeo diez veces no
 *    genera diez avisos: se reutiliza el abierto y se actualiza qué falta. Y
 *    cuando el aula se completa, el aviso se cierra solo, con fecha.
 *
 * 3. El correo no se finge. TFU todavía no ha entregado SMTP ni ha creado los
 *    buzones institucionales, así que mientras `SMTP_URL` no esté definida el
 *    aviso queda registrado y marcado como pendiente de entrega, y el panel lo
 *    dice. Preferible a un envío silencioso que nadie recibe.
 */
import type { Pool } from 'pg';
import type { ShellCheckItem } from './service.js';

export async function migrateShellAlerts(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shell_alerts (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
      term_id TEXT NOT NULL,
      moodle_course_id BIGINT NOT NULL,
      week INTEGER NOT NULL,
      -- 'pending'  : falta algo y el corte todavía no ha pasado.
      -- 'overdue'  : el corte pasó y el aula sigue incompleta.
      severity TEXT NOT NULL CHECK (severity IN ('pending','overdue')),
      shell_ready_by TIMESTAMPTZ,
      missing JSONB NOT NULL DEFAULT '[]'::jsonb,
      -- A quién le toca, resuelto en el momento del aviso.
      recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
      -- Estado de entrega: 'recorded' mientras no haya canal configurado.
      delivery TEXT NOT NULL DEFAULT 'recorded'
        CHECK (delivery IN ('recorded','sent','failed')),
      delivery_detail TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    );
    -- Un solo aviso abierto por curso y semana. El índice parcial es lo que
    -- impide que el chequeo diario acumule duplicados.
    CREATE UNIQUE INDEX IF NOT EXISTS shell_alerts_open_idx
      ON shell_alerts(term_id, moodle_course_id, week) WHERE resolved_at IS NULL;
    CREATE INDEX IF NOT EXISTS shell_alerts_term_idx ON shell_alerts(term_id);
  `);
}

export type AlertRecipient = { role: 'instructor' | 'program_director'; name?: string; email: string };

export type RaisedAlert = {
  moodleCourseId: number;
  week: number;
  severity: 'pending' | 'overdue';
  missing: string[];
  recipients: AlertRecipient[];
  created: boolean;
};

/**
 * Resuelve a quién avisa un curso.
 *
 * El instructor sale del expediente de faculty cuando está asociado al curso,
 * y si no, de quien tenga rol docente en Moodle. El director de programa sale
 * del decano del departamento del programa; si el dato no está cargado, se
 * cae al contacto académico institucional, que es mejor que no avisar a nadie.
 */
export async function resolveRecipients(
  pool: Pool,
  moodleCourseId: number,
  options: {
    teachersInMoodle?: (courseId: number) => Promise<Array<{ fullname?: string; email?: string }>>;
    fallbackEmail?: string;
  }
): Promise<AlertRecipient[]> {
  const recipients: AlertRecipient[] = [];

  const faculty = await pool.query<{ full_name: string; email: string }>(
    `SELECT fr.full_name, fr.email
       FROM faculty_records fr
       JOIN syllabi s ON s.degree_program_id = fr.program_id
      WHERE s.moodle_course_id = $1 AND fr.status = 'active'
      LIMIT 1`,
    [moodleCourseId]
  ).catch(() => ({ rows: [] as Array<{ full_name: string; email: string }> }));

  if (faculty.rows[0]?.email) {
    recipients.push({ role: 'instructor', name: faculty.rows[0].full_name, email: faculty.rows[0].email });
  } else if (options.teachersInMoodle) {
    const teachers = await options.teachersInMoodle(moodleCourseId).catch(() => []);
    for (const teacher of teachers) {
      if (teacher.email) {
        recipients.push({ role: 'instructor', name: teacher.fullname, email: teacher.email });
      }
    }
  }

  const director = await pool.query<{ dean_name: string | null; email: string | null }>(
    `SELECT d.dean_name, NULL::text AS email
       FROM syllabi s
       JOIN degree_programs dp ON dp.id = s.degree_program_id
       JOIN departments d ON d.id = dp.department_id
      WHERE s.moodle_course_id = $1
      LIMIT 1`,
    [moodleCourseId]
  ).catch(() => ({ rows: [] as Array<{ dean_name: string | null; email: string | null }> }));

  const directorEmail = director.rows[0]?.email ?? options.fallbackEmail ?? '';
  if (directorEmail) {
    recipients.push({
      role: 'program_director',
      name: director.rows[0]?.dean_name ?? undefined,
      email: directorEmail
    });
  }

  // Sin duplicar una dirección que sea a la vez instructor y director.
  const seen = new Set<string>();
  return recipients.filter((recipient) => {
    const key = recipient.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Levanta, actualiza o cierra los avisos de un chequeo.
 *
 * Devuelve sólo los que están abiertos después de reconciliar, que es lo que
 * el panel y el envío necesitan.
 */
export async function reconcileAlerts(
  pool: Pool,
  termId: string,
  items: ShellCheckItem[],
  resolveFor: (moodleCourseId: number) => Promise<AlertRecipient[]>
): Promise<RaisedAlert[]> {
  const open: RaisedAlert[] = [];

  for (const item of items) {
    if (item.week === null) {
      continue;
    }

    if (item.ready) {
      // El aula se completó: el aviso se cierra con fecha, no se borra.
      await pool.query(
        `UPDATE shell_alerts SET resolved_at = NOW(), updated_at = NOW()
          WHERE term_id = $1 AND moodle_course_id = $2 AND week = $3 AND resolved_at IS NULL`,
        [termId, item.moodleCourseId, item.week]
      );
      continue;
    }

    const severity: 'pending' | 'overdue' = item.overdue ? 'overdue' : 'pending';
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM shell_alerts
        WHERE term_id = $1 AND moodle_course_id = $2 AND week = $3 AND resolved_at IS NULL
        LIMIT 1`,
      [termId, item.moodleCourseId, item.week]
    );

    const recipients = await resolveFor(item.moodleCourseId);

    if (existing.rows[0]) {
      await pool.query(
        `UPDATE shell_alerts
            SET severity = $2, missing = $3::jsonb, recipients = $4::jsonb,
                shell_ready_by = $5, updated_at = NOW()
          WHERE id = $1`,
        [
          existing.rows[0].id,
          severity,
          JSON.stringify(item.missing),
          JSON.stringify(recipients),
          item.shellReadyBy
        ]
      );
      open.push({ ...toRaised(item, severity, recipients), created: false });
    } else {
      await pool.query(
        `INSERT INTO shell_alerts
           (term_id, moodle_course_id, week, severity, shell_ready_by, missing, recipients)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
         ON CONFLICT DO NOTHING`,
        [
          termId,
          item.moodleCourseId,
          item.week,
          severity,
          item.shellReadyBy,
          JSON.stringify(item.missing),
          JSON.stringify(recipients)
        ]
      );
      open.push({ ...toRaised(item, severity, recipients), created: true });
    }
  }

  return open;
}

function toRaised(
  item: ShellCheckItem,
  severity: 'pending' | 'overdue',
  recipients: AlertRecipient[]
): Omit<RaisedAlert, 'created'> {
  return {
    moodleCourseId: item.moodleCourseId,
    week: item.week as number,
    severity,
    missing: item.missing,
    recipients
  };
}

/** Texto del aviso, bilingüe en una sola pieza porque va a una bandeja mixta. */
export function alertMessage(
  courseName: string,
  week: number,
  shellReadyBy: string | null,
  missing: string[],
  overdue: boolean
): { subject: string; body: string } {
  const corte = shellReadyBy
    ? new Date(shellReadyBy).toLocaleString('es-ES', { dateStyle: 'full', timeStyle: 'short', timeZone: 'America/New_York' })
    : 'sin fecha de corte';
  const subject = overdue
    ? `Aula no lista — ${courseName}, semana ${week}`
    : `Preparación pendiente — ${courseName}, semana ${week}`;
  const body = [
    overdue
      ? `El corte de preparación (${corte} ET) ya pasó y el aula de la semana ${week} sigue incompleta.`
      : `El aula de la semana ${week} aún no está completa. El corte es el ${corte} ET.`,
    '',
    'Falta:',
    ...missing.map((line) => `  · ${line}`),
    '',
    'Referencia: Master Syllabus TFU, §8 — el aula debe estar lista el jueves a las 10:00 ET antes del inicio del martes.'
  ].join('\n');
  return { subject, body };
}
