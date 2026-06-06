import type { Pool } from 'pg';

/**
 * Phase 2 — CRM de admisión + retención.
 *
 * Creates the CRM-lite native tables (the operational source of truth for the
 * admission funnel) and the early-alert table used for retention signals.
 *
 * Conventions follow the rest of the platform: uuid PKs with
 * `gen_random_uuid()`, `created_at timestamptz DEFAULT now()`, `tenant_id uuid`,
 * snake_case columns. References to tables owned by other modules
 * (`admissions_applications`) are stored as plain uuid columns WITHOUT a hard FK
 * so module migration order stays independent. References to core tables
 * (`users`) use a real FK.
 *
 * Idempotent: safe to run on every boot.
 */
export async function migrateCrm(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_pipeline_stages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_won BOOLEAN NOT NULL DEFAULT false,
      is_lost BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS crm_pipeline_stages_order_idx
      ON crm_pipeline_stages(sort_order);

    CREATE TABLE IF NOT EXISTS crm_contacts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID,
      full_name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      source TEXT,
      stage_id UUID REFERENCES crm_pipeline_stages(id) ON DELETE SET NULL,
      owner_email TEXT,
      lead_score INTEGER NOT NULL DEFAULT 0,
      status TEXT,
      notes TEXT,
      application_id UUID,
      student_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS crm_contacts_stage_idx ON crm_contacts(stage_id);
    CREATE INDEX IF NOT EXISTS crm_contacts_email_idx ON crm_contacts(email);
    CREATE INDEX IF NOT EXISTS crm_contacts_student_idx ON crm_contacts(student_user_id);

    CREATE TABLE IF NOT EXISTS crm_activities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID,
      contact_id UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'note'
        CHECK (kind IN ('note','email','call','task','status_change')),
      subject TEXT,
      body TEXT,
      due_date DATE,
      completed BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS crm_activities_contact_idx
      ON crm_activities(contact_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS early_alerts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID,
      student_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      severity TEXT NOT NULL DEFAULT 'low'
        CHECK (severity IN ('low','medium','high')),
      reason TEXT,
      signal TEXT,
      resolved BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS early_alerts_open_idx
      ON early_alerts(resolved, severity);
    CREATE INDEX IF NOT EXISTS early_alerts_student_idx
      ON early_alerts(student_user_id);
  `);

  // Idempotent seed of the default admission pipeline (only when empty).
  const existing = await pool.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM crm_pipeline_stages'
  );
  if (Number(existing.rows[0]?.count ?? '0') === 0) {
    await pool.query(
      `INSERT INTO crm_pipeline_stages (name, sort_order, is_won, is_lost)
       VALUES
         ('Lead', 0, false, false),
         ('Contacted', 1, false, false),
         ('Application', 2, false, false),
         ('Admitted', 3, false, false),
         ('Enrolled', 4, true, false),
         ('Lost', 5, false, true)`
    );
  }
}
