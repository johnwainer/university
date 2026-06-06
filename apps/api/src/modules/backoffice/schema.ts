import type { Pool } from 'pg';

/**
 * Phase 4 — Back-office connectors (HR + Accounting).
 *
 * Local cache/log tables that back the Gusto/Deel staff directory and the
 * QuickBooks GL sync. The connectors themselves live in
 * `apps/api/src/integrations/{gusto,quickbooks}.ts`; these tables only persist
 * the synced state and an audit trail.
 *
 * Conventions follow the rest of the platform: uuid PKs with
 * `gen_random_uuid()`, `created_at timestamptz DEFAULT now()`, `tenant_id uuid`,
 * snake_case columns. References to billing tables owned by other phases
 * (`invoices`, `payments`) are stored as plain uuid columns WITHOUT a hard FK so
 * module migration order stays independent and this migration is safe to run
 * before Phase 1 lands those tables.
 *
 * Idempotent: safe to run on every boot.
 */
export async function migrateBackoffice(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff_directory (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID,
      external_id TEXT,
      provider TEXT NOT NULL DEFAULT 'manual'
        CHECK (provider IN ('gusto','deel','manual')),
      full_name TEXT NOT NULL,
      email TEXT,
      role TEXT,
      employment_type TEXT NOT NULL DEFAULT 'employee'
        CHECK (employment_type IN ('employee','contractor')),
      status TEXT NOT NULL DEFAULT 'active',
      country TEXT,
      synced_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS staff_directory_provider_idx
      ON staff_directory(provider);
    -- Upsert key for synced records (provider + external id). Manual rows have
    -- a null external_id and are not affected by this partial unique index.
    CREATE UNIQUE INDEX IF NOT EXISTS staff_directory_provider_external_idx
      ON staff_directory(provider, external_id)
      WHERE external_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS gl_sync_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID,
      provider TEXT NOT NULL DEFAULT 'quickbooks'
        CHECK (provider IN ('quickbooks')),
      entity_type TEXT NOT NULL
        CHECK (entity_type IN ('invoice','payment')),
      entity_id UUID,
      external_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','synced','error')),
      message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS gl_sync_log_status_idx
      ON gl_sync_log(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS gl_sync_log_entity_idx
      ON gl_sync_log(entity_type, entity_id);
  `);
}
