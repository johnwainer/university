import type { Pool } from 'pg';

/**
 * Migración del módulo SIS (Fase 1: Núcleo SIS + Pagos).
 *
 * Convención de IDs: las tablas existentes (`users`, `academic_terms`,
 * `degree_programs`, `student_enrollments`) usan `TEXT PRIMARY KEY DEFAULT
 * gen_random_uuid()::TEXT`. Para poder declarar FKs reales contra ellas, las
 * columnas de referencia y las PKs de este módulo también son `TEXT` con el
 * mismo default. Funcionalmente son UUIDs generados por Postgres 16 nativo.
 *
 * Para referencias entre tablas propias del módulo se usan columnas `TEXT`
 * simples + índice (sin FK duro) para robustez ante el orden de migración.
 */
export async function migrateSis(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admissions_applications (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
      tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      program_id TEXT REFERENCES degree_programs(id) ON DELETE SET NULL,
      stage TEXT NOT NULL DEFAULT 'lead' CHECK (stage IN ('lead','applied','admitted','enrolled','rejected')),
      status TEXT NOT NULL DEFAULT 'open',
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS admissions_applications_tenant_idx ON admissions_applications(tenant_id);
    CREATE INDEX IF NOT EXISTS admissions_applications_stage_idx ON admissions_applications(stage);
    CREATE INDEX IF NOT EXISTS admissions_applications_email_idx ON admissions_applications(email);

    CREATE TABLE IF NOT EXISTS student_ledger (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
      tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
      student_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      term_id TEXT REFERENCES academic_terms(id) ON DELETE SET NULL,
      kind TEXT NOT NULL CHECK (kind IN ('charge','payment','aid','adjustment')),
      description TEXT,
      amount_cents BIGINT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'usd',
      balance_cents BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS student_ledger_student_idx ON student_ledger(student_user_id, created_at);
    CREATE INDEX IF NOT EXISTS student_ledger_term_idx ON student_ledger(term_id);
    CREATE INDEX IF NOT EXISTS student_ledger_tenant_idx ON student_ledger(tenant_id);

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
      tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
      student_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      term_id TEXT REFERENCES academic_terms(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','paid','void')),
      total_cents BIGINT NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'usd',
      stripe_invoice_id TEXT,
      due_date DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS invoices_student_idx ON invoices(student_user_id, created_at);
    CREATE INDEX IF NOT EXISTS invoices_status_idx ON invoices(status);
    CREATE INDEX IF NOT EXISTS invoices_tenant_idx ON invoices(tenant_id);
    CREATE INDEX IF NOT EXISTS invoices_stripe_idx ON invoices(stripe_invoice_id);

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
      tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
      invoice_id TEXT,
      student_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount_cents BIGINT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'usd',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed','refunded')),
      method TEXT,
      stripe_payment_intent_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS payments_student_idx ON payments(student_user_id, created_at);
    CREATE INDEX IF NOT EXISTS payments_invoice_idx ON payments(invoice_id);
    CREATE INDEX IF NOT EXISTS payments_tenant_idx ON payments(tenant_id);
    CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_pi_unique_idx ON payments(stripe_payment_intent_id)
      WHERE stripe_payment_intent_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS financial_aid (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
      tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
      student_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      term_id TEXT REFERENCES academic_terms(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      amount_cents BIGINT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS financial_aid_student_idx ON financial_aid(student_user_id);
    CREATE INDEX IF NOT EXISTS financial_aid_tenant_idx ON financial_aid(tenant_id);

    CREATE TABLE IF NOT EXISTS degree_requirements (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
      tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
      degree_program_id TEXT NOT NULL REFERENCES degree_programs(id) ON DELETE CASCADE,
      requirement_type TEXT NOT NULL CHECK (requirement_type IN ('course','credits','gpa')),
      moodle_course_id INTEGER,
      credits_required INTEGER,
      min_gpa NUMERIC(4,2),
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS degree_requirements_program_idx ON degree_requirements(degree_program_id);
    CREATE INDEX IF NOT EXISTS degree_requirements_tenant_idx ON degree_requirements(tenant_id);

    CREATE TABLE IF NOT EXISTS enrollment_holds (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
      tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
      student_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      hold_type TEXT NOT NULL CHECK (hold_type IN ('financial','academic','documents')),
      reason TEXT,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      released_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS enrollment_holds_student_idx ON enrollment_holds(student_user_id, active);
    CREATE INDEX IF NOT EXISTS enrollment_holds_tenant_idx ON enrollment_holds(tenant_id);

    CREATE TABLE IF NOT EXISTS academic_calendar (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
      tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
      term_id TEXT REFERENCES academic_terms(id) ON DELETE SET NULL,
      event_name TEXT NOT NULL,
      event_date DATE NOT NULL,
      category TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS academic_calendar_term_idx ON academic_calendar(term_id);
    CREATE INDEX IF NOT EXISTS academic_calendar_date_idx ON academic_calendar(event_date);
    CREATE INDEX IF NOT EXISTS academic_calendar_tenant_idx ON academic_calendar(tenant_id);
  `);
}
