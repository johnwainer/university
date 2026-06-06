/**
 * Phase 4 — Accounting connector (QuickBooks Online).
 *
 * Pushes native billing rows (`invoices` / `payments`) into the QuickBooks
 * general ledger. OAuth2 client over the Intuit Accounting API. Like the other
 * connectors it degrades gracefully: when credentials are missing it reports
 * `configured: false` instead of throwing, so the admin "Contabilidad" tab can
 * render a "no configurado" state.
 *
 * Environment variables (documented; loaded by the orchestrator):
 *   QBO_ACCESS_TOKEN     OAuth2 bearer access token (refresh handled out of band).
 *   QBO_REALM_ID         QuickBooks company (realm) id.
 *   QBO_API_BASE_URL     Optional override. Defaults to the production host
 *                        https://quickbooks.api.intuit.com — point it at
 *                        https://sandbox-quickbooks.api.intuit.com for sandbox.
 *   QBO_MINOR_VERSION    Optional Intuit API minor version (defaults to 70).
 */

const QBO_BASE_URL = (
  process.env.QBO_API_BASE_URL ?? 'https://quickbooks.api.intuit.com'
).replace(/\/+$/, '');
const QBO_MINOR_VERSION = process.env.QBO_MINOR_VERSION ?? '70';

/** Result of a GL push: the external (QuickBooks) id when known. */
export interface GlPushResult {
  externalId: string | null;
  raw: unknown;
}

/** Minimal shape we read from a native `invoices` row. */
export interface InvoiceInput {
  id: string;
  amount?: number | string | null;
  currency?: string | null;
  customer_name?: string | null;
  description?: string | null;
  external_id?: string | null;
}

/** Minimal shape we read from a native `payments` row. */
export interface PaymentInput {
  id: string;
  amount?: number | string | null;
  currency?: string | null;
  customer_name?: string | null;
  external_id?: string | null;
}

export function isQuickbooksConfigured(): boolean {
  return Boolean(process.env.QBO_ACCESS_TOKEN && process.env.QBO_REALM_ID);
}

async function qboPost<T>(entity: string, body: unknown): Promise<T> {
  const token = process.env.QBO_ACCESS_TOKEN;
  const realmId = process.env.QBO_REALM_ID;
  if (!token || !realmId) {
    throw new Error('QuickBooks is not configured (missing QBO_ACCESS_TOKEN / QBO_REALM_ID)');
  }
  const url =
    `${QBO_BASE_URL}/v3/company/${encodeURIComponent(realmId)}/${entity}` +
    `?minorversion=${encodeURIComponent(QBO_MINOR_VERSION)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`QuickBooks API ${response.status}: ${detail || response.statusText}`);
  }
  return (await response.json()) as T;
}

function toAmount(value: number | string | null | undefined): number {
  const parsed = typeof value === 'string' ? Number(value) : value ?? 0;
  return Number.isFinite(parsed) ? Number(parsed) : 0;
}

/**
 * Push a native invoice to QuickBooks as a Sales Receipt line. Gate on
 * `isQuickbooksConfigured()` first. Returns the QuickBooks entity id.
 */
export async function pushInvoice(invoice: InvoiceInput): Promise<GlPushResult> {
  const amount = toAmount(invoice.amount);
  const payload = {
    Line: [
      {
        Amount: amount,
        DetailType: 'SalesItemLineDetail',
        Description: invoice.description ?? `Invoice ${invoice.id}`,
        SalesItemLineDetail: {}
      }
    ],
    CustomerMemo: { value: `pae-u invoice ${invoice.id}` },
    PrivateNote: `pae-u:invoice:${invoice.id}`,
    ...(invoice.currency ? { CurrencyRef: { value: invoice.currency } } : {})
  };
  const result = await qboPost<{ Invoice?: { Id?: string }; SalesReceipt?: { Id?: string } }>(
    'invoice',
    payload
  );
  const externalId = result.Invoice?.Id ?? result.SalesReceipt?.Id ?? null;
  return { externalId, raw: result };
}

/**
 * Push a native payment to QuickBooks. Gate on `isQuickbooksConfigured()`
 * first. Returns the QuickBooks Payment entity id.
 */
export async function pushPayment(payment: PaymentInput): Promise<GlPushResult> {
  const amount = toAmount(payment.amount);
  const payload = {
    TotalAmt: amount,
    PrivateNote: `pae-u:payment:${payment.id}`,
    ...(payment.currency ? { CurrencyRef: { value: payment.currency } } : {})
  };
  const result = await qboPost<{ Payment?: { Id?: string } }>('payment', payload);
  const externalId = result.Payment?.Id ?? null;
  return { externalId, raw: result };
}
