import type { Pool } from 'pg';

/**
 * Phase 3 — Syllabus + Compliance (FERPA/IPEDS/WCAG).
 *
 * Creates the native syllabus engine (templates + versioned syllabi tied to
 * Moodle courses / degree programs / terms) and the transversal compliance
 * surface (compliance records by area + FERPA access audit log).
 *
 * Conventions follow the rest of the platform: uuid PKs with
 * `gen_random_uuid()`, `created_at timestamptz DEFAULT now()`, `tenant_id uuid`,
 * snake_case columns. References to core tables that use the legacy
 * `TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT` convention
 * (`degree_programs`, `academic_terms`, `users`) are stored as plain TEXT
 * columns WITHOUT a hard FK so module migration order stays independent and the
 * id types line up.
 *
 * Wired by the orchestrator via `migrateSyllabus(pool)`.
 *
 * Idempotent: safe to run on every boot. The default template is seeded only
 * when `syllabus_templates` is empty, pulling compliance contacts from the
 * institution `.env` (ADA / Title IX / FERPA officers).
 */
export async function migrateSyllabus(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS syllabus_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID,
      name TEXT NOT NULL,
      sections JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS syllabus_templates_active_idx
      ON syllabus_templates(is_active);

    CREATE TABLE IF NOT EXISTS syllabi (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID,
      moodle_course_id INTEGER,
      degree_program_id TEXT,
      term_id TEXT,
      template_id UUID REFERENCES syllabus_templates(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      content JSONB NOT NULL DEFAULT '{}'::jsonb,
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','published','archived')),
      published_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS syllabi_course_idx ON syllabi(moodle_course_id);
    CREATE INDEX IF NOT EXISTS syllabi_program_idx ON syllabi(degree_program_id);
    CREATE INDEX IF NOT EXISTS syllabi_term_idx ON syllabi(term_id);
    CREATE INDEX IF NOT EXISTS syllabi_status_idx ON syllabi(status);

    CREATE TABLE IF NOT EXISTS compliance_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID,
      area TEXT NOT NULL
        CHECK (area IN ('ferpa','ipeds','wcag','title_ix','ada','accreditation')),
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('compliant','pending','action_required')),
      detail TEXT,
      evidence_url TEXT,
      period TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS compliance_records_area_idx ON compliance_records(area);
    CREATE INDEX IF NOT EXISTS compliance_records_status_idx ON compliance_records(status);

    CREATE TABLE IF NOT EXISTS ferpa_access_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID,
      actor_email TEXT NOT NULL,
      subject_user_id TEXT,
      resource TEXT NOT NULL,
      action TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ferpa_access_log_subject_idx
      ON ferpa_access_log(subject_user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS ferpa_access_log_actor_idx
      ON ferpa_access_log(actor_email, created_at DESC);
  `);

  // ---------------------------------------------------------------------------
  // Idempotent seed of the default, compliance-aware syllabus template.
  // Only runs when no template exists yet. Required-section default content is
  // populated from the institution `.env` so ADA / Title IX statements always
  // ship with the correct coordinator contacts.
  // ---------------------------------------------------------------------------
  const existing = await pool.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM syllabus_templates'
  );
  if (Number(existing.rows[0]?.count ?? '0') === 0) {
    const institutionName = process.env.INSTITUTION_NAME ?? 'the institution';
    const adaEmail = process.env.ADA_COORDINATOR_EMAIL ?? '';
    const titleIxEmail = process.env.TITLE_IX_COORDINATOR_EMAIL ?? '';
    const ferpaEmail = process.env.FERPA_OFFICER_EMAIL ?? '';

    const adaContact = adaEmail ? ` Contact the ADA/Section 504 Coordinator at ${adaEmail}.` : '';
    const titleIxContact = titleIxEmail
      ? ` Reports may be made to the Title IX Coordinator at ${titleIxEmail}.`
      : '';
    const ferpaContact = ferpaEmail
      ? ` Questions about your education records may be directed to the FERPA Officer at ${ferpaEmail}.`
      : '';

    const sections = [
      {
        key: 'course_objectives',
        label: 'Course Objectives',
        required: true,
        defaultContent:
          'Upon successful completion of this course, students will be able to demonstrate the measurable learning outcomes listed below.'
      },
      {
        key: 'grading_policy',
        label: 'Grading Policy',
        required: true,
        defaultContent:
          'Final grades are based on the weighted assessment scheme described below. Grading scales and late-work policies apply as stated.'
      },
      {
        key: 'academic_integrity',
        label: 'Academic Integrity',
        required: true,
        defaultContent:
          `Students are expected to uphold the academic integrity policy of ${institutionName}. Plagiarism, cheating, and unauthorized collaboration are prohibited and subject to disciplinary action.${ferpaContact}`
      },
      {
        key: 'ada_accessibility',
        label: 'ADA/Accessibility Statement',
        required: true,
        defaultContent:
          `${institutionName} is committed to providing equal access to all students in compliance with the Americans with Disabilities Act (ADA) and Section 504. Students requesting reasonable accommodations should arrange them as early as possible.${adaContact}`
      },
      {
        key: 'title_ix',
        label: 'Title IX Statement',
        required: true,
        defaultContent:
          `${institutionName} prohibits discrimination on the basis of sex, including sexual harassment and sexual violence, in compliance with Title IX of the Education Amendments of 1972.${titleIxContact}`
      }
    ];

    await pool.query(
      `INSERT INTO syllabus_templates (name, sections, is_active)
       VALUES ($1, $2::jsonb, true)`,
      ['Default Compliance Template', JSON.stringify(sections)]
    );
  }
}
