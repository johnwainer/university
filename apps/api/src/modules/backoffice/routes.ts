import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';

import {
  isGustoConfigured,
  isDeelConfigured,
  listEmployees,
  listWorkers,
  type StaffMember
} from '../../integrations/gusto.js';
import {
  isQuickbooksConfigured,
  pushInvoice,
  pushPayment
} from '../../integrations/quickbooks.js';

/**
 * Phase 4 — Back-office connectors (HR + Accounting) admin routes.
 *
 * Wired by the orchestrator via
 * `registerBackofficeRoutes(app, { pool, ensureAdmin })`.
 *
 *   GET  /admin/hr/staff            list the local staff cache
 *   POST /admin/hr/staff            manual staff entry (provider = 'manual')
 *   POST /admin/hr/sync             pull from Gusto/Deel and upsert the cache
 *   GET  /admin/accounting/status   gl_sync_log summary + QuickBooks status
 *   POST /admin/accounting/sync     push pending invoices/payments to the GL
 */
export interface BackofficeContext {
  pool: Pool;
  ensureAdmin: (request: any) => unknown;
}

const staffCreateSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email().optional(),
  role: z.string().optional(),
  employmentType: z.enum(['employee', 'contractor']).optional(),
  status: z.string().optional(),
  country: z.string().optional(),
  tenantId: z.string().uuid().optional()
});

async function upsertStaff(pool: Pool, member: StaffMember): Promise<void> {
  await pool.query(
    `INSERT INTO staff_directory
       (external_id, provider, full_name, email, role, employment_type, status, country, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (provider, external_id) WHERE external_id IS NOT NULL
     DO UPDATE SET
       full_name = EXCLUDED.full_name,
       email = EXCLUDED.email,
       role = EXCLUDED.role,
       employment_type = EXCLUDED.employment_type,
       status = EXCLUDED.status,
       country = EXCLUDED.country,
       synced_at = now()`,
    [
      member.externalId,
      member.provider,
      member.fullName,
      member.email,
      member.role,
      member.employmentType,
      member.status,
      member.country
    ]
  );
}

export function registerBackofficeRoutes(app: FastifyInstance, ctx: BackofficeContext): void {
  const { pool, ensureAdmin } = ctx;

  // ---------------------------------------------------------------------------
  // HR — staff directory (local cache fed by Gusto/Deel + manual entries).
  // ---------------------------------------------------------------------------
  app.get('/admin/hr/staff', async (request) => {
    ensureAdmin(request);
    const result = await pool.query(
      `SELECT id, tenant_id, external_id, provider, full_name, email, role,
              employment_type, status, country, synced_at, created_at
       FROM staff_directory
       ORDER BY full_name ASC`
    );
    return {
      providers: {
        gusto: isGustoConfigured(),
        deel: isDeelConfigured()
      },
      staff: result.rows
    };
  });

  app.post('/admin/hr/staff', async (request, reply) => {
    ensureAdmin(request);
    const body = staffCreateSchema.parse(request.body);
    const result = await pool.query(
      `INSERT INTO staff_directory
         (tenant_id, provider, full_name, email, role, employment_type, status, country)
       VALUES ($1, 'manual', $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        body.tenantId ?? null,
        body.fullName,
        body.email ?? null,
        body.role ?? null,
        body.employmentType ?? 'employee',
        body.status ?? 'active',
        body.country ?? null
      ]
    );
    return reply.status(201).send(result.rows[0]);
  });

  app.post('/admin/hr/sync', async (request) => {
    ensureAdmin(request);

    if (!isGustoConfigured() && !isDeelConfigured()) {
      return {
        status: 'not_configured',
        message: 'Ningún conector de HR está configurado (Gusto/Deel).',
        synced: 0,
        providers: { gusto: false, deel: false }
      };
    }

    const errors: string[] = [];
    let synced = 0;

    if (isGustoConfigured()) {
      try {
        const employees = await listEmployees();
        for (const member of employees) {
          if (!member.externalId) continue;
          await upsertStaff(pool, member);
          synced += 1;
        }
      } catch (error) {
        errors.push(`Gusto: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (isDeelConfigured()) {
      try {
        const workers = await listWorkers();
        for (const member of workers) {
          if (!member.externalId) continue;
          await upsertStaff(pool, member);
          synced += 1;
        }
      } catch (error) {
        errors.push(`Deel: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return {
      status: errors.length ? 'partial' : 'ok',
      synced,
      errors,
      providers: { gusto: isGustoConfigured(), deel: isDeelConfigured() }
    };
  });

  // ---------------------------------------------------------------------------
  // Accounting — QuickBooks GL sync of native invoices/payments.
  // ---------------------------------------------------------------------------
  app.get('/admin/accounting/status', async (request) => {
    ensureAdmin(request);

    const summaryResult = await pool.query<{ status: string; count: string }>(
      `SELECT status, COUNT(*)::text AS count
       FROM gl_sync_log
       GROUP BY status`
    );
    const summary: Record<string, number> = { pending: 0, synced: 0, error: 0 };
    for (const row of summaryResult.rows) {
      summary[row.status] = Number(row.count);
    }

    const recent = await pool.query(
      `SELECT id, tenant_id, provider, entity_type, entity_id, external_id,
              status, message, created_at
       FROM gl_sync_log
       ORDER BY created_at DESC
       LIMIT 50`
    );

    return {
      quickbooksConfigured: isQuickbooksConfigured(),
      summary,
      log: recent.rows
    };
  });

  app.post('/admin/accounting/sync', async (request) => {
    ensureAdmin(request);

    if (!isQuickbooksConfigured()) {
      return {
        status: 'not_configured',
        message: 'QuickBooks no está configurado (faltan QBO_ACCESS_TOKEN / QBO_REALM_ID).',
        pushed: 0
      };
    }

    let pushed = 0;
    const errors: string[] = [];

    // Invoices. The billing tables are owned by Phase 1 and may not exist yet,
    // so every read is guarded.
    try {
      const invoices = await pool.query(
        `SELECT * FROM invoices ORDER BY created_at ASC LIMIT 100`
      );
      for (const invoice of invoices.rows) {
        try {
          const result = await pushInvoice(invoice);
          await pool.query(
            `INSERT INTO gl_sync_log
               (provider, entity_type, entity_id, external_id, status, message)
             VALUES ('quickbooks', 'invoice', $1, $2, 'synced', NULL)`,
            [invoice.id ?? null, result.externalId]
          );
          pushed += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`invoice ${invoice.id}: ${message}`);
          await pool.query(
            `INSERT INTO gl_sync_log
               (provider, entity_type, entity_id, external_id, status, message)
             VALUES ('quickbooks', 'invoice', $1, NULL, 'error', $2)`,
            [invoice.id ?? null, message]
          );
        }
      }
    } catch {
      // `invoices` table not present yet — skip silently.
    }

    // Payments. Same guarded pattern.
    try {
      const payments = await pool.query(
        `SELECT * FROM payments ORDER BY created_at ASC LIMIT 100`
      );
      for (const payment of payments.rows) {
        try {
          const result = await pushPayment(payment);
          await pool.query(
            `INSERT INTO gl_sync_log
               (provider, entity_type, entity_id, external_id, status, message)
             VALUES ('quickbooks', 'payment', $1, $2, 'synced', NULL)`,
            [payment.id ?? null, result.externalId]
          );
          pushed += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`payment ${payment.id}: ${message}`);
          await pool.query(
            `INSERT INTO gl_sync_log
               (provider, entity_type, entity_id, external_id, status, message)
             VALUES ('quickbooks', 'payment', $1, NULL, 'error', $2)`,
            [payment.id ?? null, message]
          );
        }
      }
    } catch {
      // `payments` table not present yet — skip silently.
    }

    return {
      status: errors.length ? 'partial' : 'ok',
      pushed,
      errors
    };
  });
}
