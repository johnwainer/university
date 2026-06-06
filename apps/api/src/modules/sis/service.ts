import type { Pool } from 'pg';

/**
 * Lógica de negocio del SIS: balance del ledger y degree audit.
 */

export type LedgerKind = 'charge' | 'payment' | 'aid' | 'adjustment';

/**
 * Efecto de un movimiento sobre el balance del estudiante.
 *  - charge / adjustment positivo: aumenta lo que debe (+).
 *  - payment / aid: reduce lo que debe (-).
 * El `amount_cents` se almacena siempre como magnitud positiva; el signo lo
 * determina `kind`. `adjustment` puede llevar `amount_cents` negativo para
 * correcciones a la baja.
 */
export function signedDelta(kind: LedgerKind, amountCents: number): number {
  switch (kind) {
    case 'charge':
      return Math.abs(amountCents);
    case 'payment':
    case 'aid':
      return -Math.abs(amountCents);
    case 'adjustment':
      return amountCents; // respeta el signo provisto
    default:
      return 0;
  }
}

export interface LedgerEntryRow {
  id: string;
  kind: LedgerKind;
  description: string | null;
  amount_cents: string | number;
  currency: string;
  balance_cents: string | number;
  term_id: string | null;
  created_at: string;
}

export interface LedgerResult {
  entries: LedgerEntryRow[];
  balanceCents: number;
  currency: string;
}

/** Devuelve el último balance acumulado del estudiante (0 si no hay movimientos). */
export async function getCurrentBalance(pool: Pool, studentUserId: string): Promise<number> {
  const result = await pool.query(
    `SELECT balance_cents FROM student_ledger
     WHERE student_user_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [studentUserId]
  );
  if (result.rows.length === 0) return 0;
  return Number(result.rows[0].balance_cents);
}

/**
 * Inserta un movimiento recalculando el balance acumulado a partir del último.
 */
export async function appendLedgerEntry(
  pool: Pool,
  input: {
    tenantId: string | null;
    studentUserId: string;
    termId: string | null;
    kind: LedgerKind;
    description: string | null;
    amountCents: number;
    currency: string;
  }
): Promise<LedgerEntryRow> {
  const previous = await getCurrentBalance(pool, input.studentUserId);
  const newBalance = previous + signedDelta(input.kind, input.amountCents);
  const result = await pool.query(
    `INSERT INTO student_ledger
       (tenant_id, student_user_id, term_id, kind, description, amount_cents, currency, balance_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, kind, description, amount_cents, currency, balance_cents, term_id, created_at`,
    [
      input.tenantId,
      input.studentUserId,
      input.termId,
      input.kind,
      input.description,
      input.amountCents,
      input.currency,
      newBalance
    ]
  );
  return result.rows[0] as LedgerEntryRow;
}

export interface DegreeAuditRequirement {
  id: string;
  requirement_type: 'course' | 'credits' | 'gpa';
  description: string | null;
  moodle_course_id: number | null;
  credits_required: number | null;
  min_gpa: number | null;
  satisfied: boolean;
  detail: string;
}

export interface DegreeAuditResult {
  degreeProgramId: string | null;
  totalRequirements: number;
  satisfiedRequirements: number;
  percentComplete: number;
  completedCredits: number;
  cumulativeGpa: number | null;
  requirements: DegreeAuditRequirement[];
}

/**
 * Compara `degree_requirements` del programa del estudiante contra su progreso
 * real en `student_enrollments` y devuelve el % cumplido.
 *
 * Determina el programa del estudiante por su matrícula más reciente con
 * `degree_program_id`. Si no se encuentra, devuelve un audit vacío.
 */
export async function computeDegreeAudit(
  pool: Pool,
  studentUserId: string
): Promise<DegreeAuditResult> {
  // 1. Programa de grado del estudiante (matrícula más reciente con programa).
  const programRes = await pool.query(
    `SELECT degree_program_id
     FROM student_enrollments
     WHERE user_id = $1 AND degree_program_id IS NOT NULL
     ORDER BY enrolled_at DESC
     LIMIT 1`,
    [studentUserId]
  );
  const degreeProgramId: string | null = programRes.rows[0]?.degree_program_id ?? null;

  // 2. Progreso del estudiante: créditos completados, GPA, cursos completados.
  const progressRes = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'completed' THEN credit_hours ELSE 0 END), 0) AS completed_credits,
       ROUND(
         SUM(grade_points * credit_hours) /
         NULLIF(SUM(CASE WHEN grade_points IS NOT NULL THEN credit_hours ELSE 0 END), 0),
         2
       ) AS cumulative_gpa
     FROM student_enrollments
     WHERE user_id = $1`,
    [studentUserId]
  );
  const completedCredits = Number(progressRes.rows[0]?.completed_credits ?? 0);
  const cumulativeGpaRaw = progressRes.rows[0]?.cumulative_gpa;
  const cumulativeGpa = cumulativeGpaRaw === null || cumulativeGpaRaw === undefined
    ? null
    : Number(cumulativeGpaRaw);

  // Conjunto de cursos Moodle completados por el estudiante.
  const completedCoursesRes = await pool.query(
    `SELECT DISTINCT moodle_course_id
     FROM student_enrollments
     WHERE user_id = $1 AND status = 'completed'`,
    [studentUserId]
  );
  const completedCourseIds = new Set<number>(
    completedCoursesRes.rows.map((r) => Number(r.moodle_course_id))
  );

  if (!degreeProgramId) {
    return {
      degreeProgramId: null,
      totalRequirements: 0,
      satisfiedRequirements: 0,
      percentComplete: 0,
      completedCredits,
      cumulativeGpa,
      requirements: []
    };
  }

  // 3. Requisitos del programa.
  const reqRes = await pool.query(
    `SELECT id, requirement_type, description, moodle_course_id, credits_required, min_gpa
     FROM degree_requirements
     WHERE degree_program_id = $1
     ORDER BY created_at ASC`,
    [degreeProgramId]
  );

  const requirements: DegreeAuditRequirement[] = reqRes.rows.map((row) => {
    const type = row.requirement_type as 'course' | 'credits' | 'gpa';
    let satisfied = false;
    let detail = '';

    if (type === 'course') {
      const courseId = row.moodle_course_id === null ? null : Number(row.moodle_course_id);
      satisfied = courseId !== null && completedCourseIds.has(courseId);
      detail = satisfied ? 'Curso completado' : 'Curso pendiente';
    } else if (type === 'credits') {
      const required = Number(row.credits_required ?? 0);
      satisfied = completedCredits >= required;
      detail = `${completedCredits}/${required} créditos`;
    } else if (type === 'gpa') {
      const minGpa = row.min_gpa === null ? 0 : Number(row.min_gpa);
      satisfied = cumulativeGpa !== null && cumulativeGpa >= minGpa;
      detail = `GPA ${cumulativeGpa ?? 'N/A'} (mín ${minGpa})`;
    }

    return {
      id: row.id,
      requirement_type: type,
      description: row.description,
      moodle_course_id: row.moodle_course_id === null ? null : Number(row.moodle_course_id),
      credits_required: row.credits_required === null ? null : Number(row.credits_required),
      min_gpa: row.min_gpa === null ? null : Number(row.min_gpa),
      satisfied,
      detail
    };
  });

  const totalRequirements = requirements.length;
  const satisfiedRequirements = requirements.filter((r) => r.satisfied).length;
  const percentComplete = totalRequirements === 0
    ? 0
    : Math.round((satisfiedRequirements / totalRequirements) * 100);

  return {
    degreeProgramId,
    totalRequirements,
    satisfiedRequirements,
    percentComplete,
    completedCredits,
    cumulativeGpa,
    requirements
  };
}
