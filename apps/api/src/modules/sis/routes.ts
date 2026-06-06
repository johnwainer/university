import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  appendLedgerEntry,
  computeDegreeAudit,
  getCurrentBalance
} from './service.js';
import {
  createPaymentIntent,
  isStripeConfigured,
  verifyAndParseWebhook
} from '../../integrations/stripe.js';

/**
 * Contexto inyectado por el orquestador al cablear las rutas del SIS.
 *
 * - `pool`: pool de Postgres compartido.
 * - `ensureAdmin`: valida credenciales admin (lanza si no autorizado).
 * - `resolvePublicUser`: resuelve el usuario público autenticado a partir del
 *    request (Bearer token de sesión pública). Debe devolver al menos
 *    `{ userId, tenantId? }` o lanzar/retornar null si no hay sesión válida.
 *    El orquestador lo cablea con `getPublicSessionFromRequest`.
 */
export interface SisPublicUser {
  userId: string;
  tenantId?: string | null;
  email?: string;
}

export interface SisContext {
  pool: Pool;
  ensureAdmin: (request: any) => unknown;
  resolvePublicUser?: (request: any) => SisPublicUser | null | Promise<SisPublicUser | null>;
}

const stageEnum = z.enum(['lead', 'applied', 'admitted', 'enrolled', 'rejected']);
const ledgerKindEnum = z.enum(['charge', 'payment', 'aid', 'adjustment']);
const holdTypeEnum = z.enum(['financial', 'academic', 'documents']);
const invoiceStatusEnum = z.enum(['draft', 'open', 'paid', 'void']);

export function registerSisRoutes(app: FastifyInstance, ctx: SisContext): void {
  const { pool, ensureAdmin } = ctx;

  async function getPublicUser(request: any): Promise<SisPublicUser> {
    if (!ctx.resolvePublicUser) {
      throw app.httpErrors.unauthorized('Public session resolver not configured');
    }
    const user = await ctx.resolvePublicUser(request);
    if (!user || !user.userId) {
      throw app.httpErrors.unauthorized('Public session is required');
    }
    return user;
  }

  async function resolveTenantId(userId: string): Promise<string | null> {
    const res = await pool.query(`SELECT tenant_id FROM users WHERE id = $1`, [userId]);
    return res.rows[0]?.tenant_id ?? null;
  }

  // ---------------------------------------------------------------------------
  // ADMISIONES
  // ---------------------------------------------------------------------------
  app.get('/admin/admissions', async (request) => {
    ensureAdmin(request);
    const query = z
      .object({ stage: stageEnum.optional() })
      .parse(request.query ?? {});
    const params: unknown[] = [];
    let where = '';
    if (query.stage) {
      params.push(query.stage);
      where = `WHERE a.stage = $1`;
    }
    const result = await pool.query(
      `SELECT a.id, a.tenant_id, a.full_name, a.email, a.phone, a.program_id,
              a.stage, a.status, a.notes, a.created_at, a.updated_at,
              dp.name AS program_name
       FROM admissions_applications a
       LEFT JOIN degree_programs dp ON a.program_id = dp.id
       ${where}
       ORDER BY a.created_at DESC`,
      params
    );
    return result.rows;
  });

  app.post('/admin/admissions', async (request, reply) => {
    ensureAdmin(request);
    const body = z
      .object({
        tenantId: z.string().optional(),
        fullName: z.string().min(1),
        email: z.string().email(),
        phone: z.string().optional(),
        programId: z.string().optional(),
        stage: stageEnum.optional(),
        status: z.string().optional(),
        notes: z.string().optional()
      })
      .parse(request.body);
    const result = await pool.query(
      `INSERT INTO admissions_applications
         (tenant_id, full_name, email, phone, program_id, stage, status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        body.tenantId ?? null,
        body.fullName,
        body.email,
        body.phone ?? null,
        body.programId ?? null,
        body.stage ?? 'lead',
        body.status ?? 'open',
        body.notes ?? null
      ]
    );
    return reply.status(201).send(result.rows[0]);
  });

  app.patch('/admin/admissions/:id', async (request) => {
    ensureAdmin(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        fullName: z.string().min(1).optional(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        programId: z.string().optional(),
        stage: stageEnum.optional(),
        status: z.string().optional(),
        notes: z.string().optional()
      })
      .parse(request.body);

    const result = await pool.query(
      `UPDATE admissions_applications
       SET full_name = COALESCE($2, full_name),
           email = COALESCE($3, email),
           phone = COALESCE($4, phone),
           program_id = COALESCE($5, program_id),
           stage = COALESCE($6, stage),
           status = COALESCE($7, status),
           notes = COALESCE($8, notes),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        body.fullName ?? null,
        body.email ?? null,
        body.phone ?? null,
        body.programId ?? null,
        body.stage ?? null,
        body.status ?? null,
        body.notes ?? null
      ]
    );
    if (result.rows.length === 0) {
      throw app.httpErrors.notFound('Application not found');
    }
    return result.rows[0];
  });

  app.patch('/admin/admissions/:id/stage', async (request) => {
    ensureAdmin(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ stage: stageEnum }).parse(request.body);
    const result = await pool.query(
      `UPDATE admissions_applications
       SET stage = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, body.stage]
    );
    if (result.rows.length === 0) {
      throw app.httpErrors.notFound('Application not found');
    }
    return result.rows[0];
  });

  // ---------------------------------------------------------------------------
  // LEDGER ESTUDIANTIL
  // ---------------------------------------------------------------------------
  app.get('/admin/students/:id/ledger', async (request) => {
    ensureAdmin(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const entriesRes = await pool.query(
      `SELECT id, kind, description, amount_cents, currency, balance_cents, term_id, created_at
       FROM student_ledger
       WHERE student_user_id = $1
       ORDER BY created_at ASC, id ASC`,
      [id]
    );
    const balanceCents = await getCurrentBalance(pool, id);
    const currency = entriesRes.rows[0]?.currency ?? 'usd';
    return { entries: entriesRes.rows, balanceCents, currency };
  });

  app.post('/admin/students/:id/ledger', async (request, reply) => {
    ensureAdmin(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        kind: ledgerKindEnum,
        amountCents: z.number().int(),
        description: z.string().optional(),
        currency: z.string().optional(),
        termId: z.string().optional()
      })
      .parse(request.body);
    const tenantId = await resolveTenantId(id);
    const entry = await appendLedgerEntry(pool, {
      tenantId,
      studentUserId: id,
      termId: body.termId ?? null,
      kind: body.kind,
      description: body.description ?? null,
      amountCents: body.amountCents,
      currency: body.currency ?? 'usd'
    });
    return reply.status(201).send(entry);
  });

  // ---------------------------------------------------------------------------
  // DEGREE AUDIT
  // ---------------------------------------------------------------------------
  app.get('/admin/students/:id/degree-audit', async (request) => {
    ensureAdmin(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    return computeDegreeAudit(pool, id);
  });

  // ---------------------------------------------------------------------------
  // INVOICES
  // ---------------------------------------------------------------------------
  app.get('/admin/invoices', async (request) => {
    ensureAdmin(request);
    const query = z
      .object({ studentUserId: z.string().optional(), status: invoiceStatusEnum.optional() })
      .parse(request.query ?? {});
    const params: unknown[] = [];
    const clauses: string[] = [];
    if (query.studentUserId) {
      params.push(query.studentUserId);
      clauses.push(`i.student_user_id = $${params.length}`);
    }
    if (query.status) {
      params.push(query.status);
      clauses.push(`i.status = $${params.length}`);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT i.id, i.tenant_id, i.student_user_id, i.term_id, i.status, i.total_cents,
              i.currency, i.stripe_invoice_id, i.due_date, i.created_at,
              u.full_name AS student_name, u.email AS student_email
       FROM invoices i
       LEFT JOIN users u ON i.student_user_id = u.id
       ${where}
       ORDER BY i.created_at DESC`,
      params
    );
    return result.rows;
  });

  app.post('/admin/invoices', async (request, reply) => {
    ensureAdmin(request);
    const body = z
      .object({
        studentUserId: z.string(),
        termId: z.string().optional(),
        totalCents: z.number().int().nonnegative(),
        currency: z.string().optional(),
        status: invoiceStatusEnum.optional(),
        dueDate: z.string().optional()
      })
      .parse(request.body);
    const tenantId = await resolveTenantId(body.studentUserId);
    const result = await pool.query(
      `INSERT INTO invoices
         (tenant_id, student_user_id, term_id, status, total_cents, currency, due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        tenantId,
        body.studentUserId,
        body.termId ?? null,
        body.status ?? 'draft',
        body.totalCents,
        body.currency ?? 'usd',
        body.dueDate ?? null
      ]
    );
    return reply.status(201).send(result.rows[0]);
  });

  // ---------------------------------------------------------------------------
  // ENROLLMENT HOLDS
  // ---------------------------------------------------------------------------
  app.get('/admin/holds', async (request) => {
    ensureAdmin(request);
    const query = z
      .object({ studentUserId: z.string().optional(), active: z.enum(['true', 'false']).optional() })
      .parse(request.query ?? {});
    const params: unknown[] = [];
    const clauses: string[] = [];
    if (query.studentUserId) {
      params.push(query.studentUserId);
      clauses.push(`h.student_user_id = $${params.length}`);
    }
    if (query.active) {
      params.push(query.active === 'true');
      clauses.push(`h.active = $${params.length}`);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT h.id, h.tenant_id, h.student_user_id, h.hold_type, h.reason, h.active,
              h.created_at, h.released_at,
              u.full_name AS student_name, u.email AS student_email
       FROM enrollment_holds h
       LEFT JOIN users u ON h.student_user_id = u.id
       ${where}
       ORDER BY h.created_at DESC`,
      params
    );
    return result.rows;
  });

  app.post('/admin/holds', async (request, reply) => {
    ensureAdmin(request);
    const body = z
      .object({
        studentUserId: z.string(),
        holdType: holdTypeEnum,
        reason: z.string().optional()
      })
      .parse(request.body);
    const tenantId = await resolveTenantId(body.studentUserId);
    const result = await pool.query(
      `INSERT INTO enrollment_holds (tenant_id, student_user_id, hold_type, reason)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [tenantId, body.studentUserId, body.holdType, body.reason ?? null]
    );
    return reply.status(201).send(result.rows[0]);
  });

  app.patch('/admin/holds/:id/release', async (request) => {
    ensureAdmin(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const result = await pool.query(
      `UPDATE enrollment_holds
       SET active = false, released_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) {
      throw app.httpErrors.notFound('Hold not found');
    }
    return result.rows[0];
  });

  // ---------------------------------------------------------------------------
  // ESTUDIANTE AUTENTICADO: BILLING + PAGO
  // ---------------------------------------------------------------------------
  app.get('/v1/me/billing', async (request) => {
    const user = await getPublicUser(request);
    const [entriesRes, invoicesRes, holdsRes] = await Promise.all([
      pool.query(
        `SELECT id, kind, description, amount_cents, currency, balance_cents, term_id, created_at
         FROM student_ledger
         WHERE student_user_id = $1
         ORDER BY created_at ASC, id ASC`,
        [user.userId]
      ),
      pool.query(
        `SELECT id, term_id, status, total_cents, currency, stripe_invoice_id, due_date, created_at
         FROM invoices
         WHERE student_user_id = $1
         ORDER BY created_at DESC`,
        [user.userId]
      ),
      pool.query(
        `SELECT id, hold_type, reason, active, created_at, released_at
         FROM enrollment_holds
         WHERE student_user_id = $1 AND active = true
         ORDER BY created_at DESC`,
        [user.userId]
      )
    ]);
    const balanceCents = await getCurrentBalance(pool, user.userId);
    const currency = entriesRes.rows[0]?.currency ?? 'usd';
    return {
      balanceCents,
      currency,
      ledger: entriesRes.rows,
      invoices: invoicesRes.rows,
      holds: holdsRes.rows
    };
  });

  app.post('/v1/me/pay', async (request, reply) => {
    const user = await getPublicUser(request);
    const body = z
      .object({
        amountCents: z.number().int().positive().optional(),
        invoiceId: z.string().optional(),
        currency: z.string().optional()
      })
      .parse(request.body ?? {});

    if (!isStripeConfigured()) {
      throw app.httpErrors.serviceUnavailable('Stripe is not configured');
    }

    // Determina el monto: explícito, o desde la factura, o el balance pendiente.
    let amountCents = body.amountCents ?? 0;
    let currency = body.currency ?? 'usd';
    if (body.invoiceId) {
      const inv = await pool.query(
        `SELECT total_cents, currency FROM invoices WHERE id = $1 AND student_user_id = $2`,
        [body.invoiceId, user.userId]
      );
      if (inv.rows.length === 0) {
        throw app.httpErrors.notFound('Invoice not found');
      }
      if (!body.amountCents) {
        amountCents = Number(inv.rows[0].total_cents);
      }
      currency = body.currency ?? inv.rows[0].currency ?? 'usd';
    } else if (!body.amountCents) {
      amountCents = await getCurrentBalance(pool, user.userId);
    }

    if (amountCents <= 0) {
      throw app.httpErrors.badRequest('No outstanding amount to pay');
    }

    const tenantId = user.tenantId ?? (await resolveTenantId(user.userId));
    const intent = await createPaymentIntent({
      amountCents,
      currency,
      description: `Tuition payment for ${user.userId}`,
      metadata: {
        student_user_id: user.userId,
        ...(body.invoiceId ? { invoice_id: body.invoiceId } : {}),
        ...(tenantId ? { tenant_id: tenantId } : {})
      }
    });

    if (!intent.configured) {
      throw app.httpErrors.serviceUnavailable('Stripe is not configured');
    }

    // Registra el pago como pendiente para conciliar luego vía webhook.
    await pool.query(
      `INSERT INTO payments
         (tenant_id, invoice_id, student_user_id, amount_cents, currency, status, method, stripe_payment_intent_id)
       VALUES ($1, $2, $3, $4, $5, 'pending', 'stripe', $6)
       ON CONFLICT (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL
       DO NOTHING`,
      [
        tenantId,
        body.invoiceId ?? null,
        user.userId,
        amountCents,
        currency,
        intent.id
      ]
    );

    return reply.status(201).send({
      clientSecret: intent.clientSecret,
      paymentIntentId: intent.id,
      amountCents: intent.amountCents,
      currency: intent.currency,
      status: intent.status
    });
  });

  // ---------------------------------------------------------------------------
  // WEBHOOK STRIPE
  // ---------------------------------------------------------------------------
  app.post('/v1/webhooks/stripe', async (request, reply) => {
    const signature = request.headers['stripe-signature'] as string | undefined;
    // El cuerpo crudo es necesario para verificar la firma. Si el orquestador
    // registra un raw-body parser lo expondrá en `request.rawBody`; si no,
    // re-serializamos el body parseado (válido en dev sin firma).
    const rawBody: string =
      (request as any).rawBody !== undefined
        ? (request as any).rawBody
        : JSON.stringify(request.body ?? {});

    const result = verifyAndParseWebhook(rawBody, signature);

    // Si hay secreto configurado pero la firma no verifica, rechazamos.
    if (!result.verified) {
      if (result.configured) {
        throw app.httpErrors.badRequest(`Webhook signature verification failed: ${result.reason}`);
      }
      // Sin secreto (dev): aceptamos el body parseado para poder probar.
      const devEvent = (request.body ?? {}) as {
        type?: string;
        data?: { object?: Record<string, unknown> };
      };
      if (devEvent.type && devEvent.data?.object) {
        await reconcileEvent(devEvent.type, devEvent.data.object);
      }
      return reply.status(200).send({ received: true, verified: false });
    }

    await reconcileEvent(result.event.type, result.event.data.object);
    return reply.status(200).send({ received: true, verified: true });
  });

  /**
   * Concilia un evento de Stripe: actualiza `payments`, marca `invoices` como
   * pagadas y libera los `enrollment_holds` financieros del estudiante.
   */
  async function reconcileEvent(type: string, obj: Record<string, unknown>): Promise<void> {
    const paymentIntentId =
      typeof obj.id === 'string' && type.startsWith('payment_intent.') ? obj.id : null;
    const metadata = (obj.metadata as Record<string, unknown> | undefined) ?? {};
    const studentUserId =
      typeof metadata.student_user_id === 'string' ? metadata.student_user_id : null;
    const invoiceId = typeof metadata.invoice_id === 'string' ? metadata.invoice_id : null;

    if (type === 'payment_intent.succeeded' && paymentIntentId) {
      // Actualiza el pago. Si no existía (p.ej. creado fuera de banda), lo inserta.
      const updated = await pool.query(
        `UPDATE payments
         SET status = 'succeeded'
         WHERE stripe_payment_intent_id = $1
         RETURNING student_user_id, invoice_id, amount_cents, currency, tenant_id`,
        [paymentIntentId]
      );

      let resolvedStudent = studentUserId;
      let resolvedInvoice = invoiceId;
      let amountCents = typeof obj.amount === 'number' ? obj.amount : 0;
      let currency = typeof obj.currency === 'string' ? obj.currency : 'usd';
      let tenantId: string | null = null;

      if (updated.rows.length > 0) {
        const row = updated.rows[0];
        resolvedStudent = resolvedStudent ?? row.student_user_id;
        resolvedInvoice = resolvedInvoice ?? row.invoice_id;
        amountCents = Number(row.amount_cents) || amountCents;
        currency = row.currency ?? currency;
        tenantId = row.tenant_id ?? null;
      } else if (resolvedStudent) {
        tenantId = await resolveTenantId(resolvedStudent);
        await pool.query(
          `INSERT INTO payments
             (tenant_id, invoice_id, student_user_id, amount_cents, currency, status, method, stripe_payment_intent_id)
           VALUES ($1, $2, $3, $4, $5, 'succeeded', 'stripe', $6)
           ON CONFLICT (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL
           DO UPDATE SET status = 'succeeded'`,
          [tenantId, resolvedInvoice, resolvedStudent, amountCents, currency, paymentIntentId]
        );
      }

      if (resolvedStudent) {
        // Asienta el abono en el ledger (idempotencia básica: evita duplicar si
        // ya existe un movimiento de pago para este payment intent en la nota).
        const ledgerNote = `Stripe payment ${paymentIntentId}`;
        const existing = await pool.query(
          `SELECT 1 FROM student_ledger
           WHERE student_user_id = $1 AND kind = 'payment' AND description = $2
           LIMIT 1`,
          [resolvedStudent, ledgerNote]
        );
        if (existing.rows.length === 0 && amountCents > 0) {
          await appendLedgerEntry(pool, {
            tenantId,
            studentUserId: resolvedStudent,
            termId: null,
            kind: 'payment',
            description: ledgerNote,
            amountCents,
            currency
          });
        }

        // Marca la factura como pagada.
        if (resolvedInvoice) {
          await pool.query(`UPDATE invoices SET status = 'paid' WHERE id = $1`, [resolvedInvoice]);
        }

        // Libera holds financieros activos del estudiante.
        await pool.query(
          `UPDATE enrollment_holds
           SET active = false, released_at = NOW()
           WHERE student_user_id = $1 AND hold_type = 'financial' AND active = true`,
          [resolvedStudent]
        );
      }
    } else if (type === 'payment_intent.payment_failed' && paymentIntentId) {
      await pool.query(
        `UPDATE payments SET status = 'failed' WHERE stripe_payment_intent_id = $1`,
        [paymentIntentId]
      );
    }
  }
}
