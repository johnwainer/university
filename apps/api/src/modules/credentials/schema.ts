import type { Pool } from 'pg';

/**
 * Phase 5 — Advanced LMS: competencies (CBE), badges and verifiable
 * certificates layered on top of Moodle.
 *
 * Conventions follow the rest of the platform: uuid PKs with
 * `gen_random_uuid()`, `created_at timestamptz DEFAULT now()`, `tenant_id uuid`,
 * snake_case columns.
 *
 * IMPORTANT typing note: although the task contract describes the student and
 * degree-program references nominally as "uuid", the live schema stores
 * `users.id` and `degree_programs.id` as TEXT (see `apps/api/src/db.ts`). To stay
 * join-compatible with those tables (and to mirror the existing CRM module which
 * does the same), `student_user_id` / `degree_program_id` are declared TEXT with
 * a real FK to those tables. `moodle_course_id` is a plain INTEGER column without
 * a hard FK so module migration order stays independent of the Moodle sync.
 *
 * Idempotent: safe to run on every boot.
 */
export async function migrateCredentials(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS competencies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      description TEXT,
      moodle_course_id INTEGER,
      degree_program_id TEXT REFERENCES degree_programs(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS competencies_code_idx ON competencies(code);
    CREATE INDEX IF NOT EXISTS competencies_course_idx ON competencies(moodle_course_id);
    CREATE INDEX IF NOT EXISTS competencies_program_idx ON competencies(degree_program_id);

    CREATE TABLE IF NOT EXISTS badges (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID,
      name TEXT NOT NULL,
      description TEXT,
      criteria TEXT,
      image_url TEXT,
      competency_id UUID REFERENCES competencies(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS badges_competency_idx ON badges(competency_id);

    CREATE TABLE IF NOT EXISTS student_competency_progress (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID,
      student_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      competency_id UUID REFERENCES competencies(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'not_started'
        CHECK (status IN ('not_started','in_progress','mastered')),
      evidence TEXT,
      achieved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS student_competency_progress_unique_idx
      ON student_competency_progress(student_user_id, competency_id);
    CREATE INDEX IF NOT EXISTS student_competency_progress_student_idx
      ON student_competency_progress(student_user_id);

    CREATE TABLE IF NOT EXISTS certificates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID,
      student_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'course'
        CHECK (kind IN ('course','program','badge')),
      moodle_course_id INTEGER,
      degree_program_id TEXT REFERENCES degree_programs(id) ON DELETE SET NULL,
      serial TEXT NOT NULL UNIQUE,
      verification_code TEXT NOT NULL UNIQUE,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS certificates_student_idx ON certificates(student_user_id);
    CREATE INDEX IF NOT EXISTS certificates_verification_idx ON certificates(verification_code);
  `);
}
