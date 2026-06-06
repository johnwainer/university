/**
 * Stripe connector (Fase 1 — Pagos).
 *
 * No añade una dependencia npm nueva: habla directamente con la REST API de
 * Stripe vía `fetch` usando autenticación Basic con `STRIPE_SECRET_KEY`.
 *
 * Variables de entorno requeridas (opcionales — si faltan, el conector se
 * degrada con elegancia y NUNCA lanza al cargar el módulo):
 *   - STRIPE_SECRET_KEY      Clave secreta (sk_test_... / sk_live_...).
 *   - STRIPE_WEBHOOK_SECRET  Secreto de firma del endpoint de webhook (whsec_...).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

export interface StripeUnconfigured {
  configured: false;
}

export interface CreatePaymentIntentInput {
  amountCents: number;
  currency: string;
  metadata?: Record<string, string>;
  description?: string;
}

export interface CreatePaymentIntentResult {
  configured: true;
  id: string;
  clientSecret: string;
  status: string;
  amountCents: number;
  currency: string;
}

export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
  [key: string]: unknown;
}

export interface VerifyWebhookOk {
  configured: true;
  verified: true;
  event: StripeWebhookEvent;
}

export interface VerifyWebhookFailed {
  configured: boolean;
  verified: false;
  reason: string;
}

export type VerifyWebhookResult = VerifyWebhookOk | VerifyWebhookFailed;

function getSecretKey(): string | null {
  const key = process.env.STRIPE_SECRET_KEY;
  return key && key.trim().length > 0 ? key.trim() : null;
}

function getWebhookSecret(): string | null {
  const key = process.env.STRIPE_WEBHOOK_SECRET;
  return key && key.trim().length > 0 ? key.trim() : null;
}

export function isStripeConfigured(): boolean {
  return getSecretKey() !== null;
}

/**
 * Codifica un objeto plano (con metadata anidada de un nivel) al formato
 * `application/x-www-form-urlencoded` que espera la API de Stripe.
 */
function encodeForm(input: CreatePaymentIntentInput): string {
  const params = new URLSearchParams();
  params.set('amount', String(Math.round(input.amountCents)));
  params.set('currency', input.currency.toLowerCase());
  // Habilita métodos de pago automáticos para que el client_secret sea usable
  // con Stripe Elements/Checkout sin configuración extra.
  params.set('automatic_payment_methods[enabled]', 'true');
  if (input.description) {
    params.set('description', input.description);
  }
  if (input.metadata) {
    for (const [key, value] of Object.entries(input.metadata)) {
      if (value !== undefined && value !== null) {
        params.set(`metadata[${key}]`, String(value));
      }
    }
  }
  return params.toString();
}

/**
 * Crea un PaymentIntent en Stripe. Si el conector no está configurado devuelve
 * `{ configured: false }` en lugar de lanzar.
 */
export async function createPaymentIntent(
  input: CreatePaymentIntentInput
): Promise<CreatePaymentIntentResult | StripeUnconfigured> {
  const secretKey = getSecretKey();
  if (!secretKey) {
    return { configured: false };
  }

  const authorization = `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`;
  const response = await fetch(`${STRIPE_API_BASE}/payment_intents`, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: encodeForm(input)
  });

  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const errObj = payload.error as { message?: string } | undefined;
    throw new Error(`Stripe createPaymentIntent failed: ${errObj?.message ?? response.status}`);
  }

  return {
    configured: true,
    id: String(payload.id),
    clientSecret: String(payload.client_secret),
    status: String(payload.status),
    amountCents: Number(payload.amount),
    currency: String(payload.currency)
  };
}

/**
 * Parsea el header `Stripe-Signature` (`t=...,v1=...`).
 */
function parseSignatureHeader(header: string): { timestamp: string | null; signatures: string[] } {
  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [key, value] = part.split('=');
    if (key === 't') timestamp = value ?? null;
    if (key === 'v1' && value) signatures.push(value);
  }
  return { timestamp, signatures };
}

/**
 * Verifica la firma del webhook de Stripe y parsea el evento.
 *
 * `rawBody` DEBE ser el cuerpo crudo exacto recibido (Buffer o string); si se
 * re-serializa un objeto ya parseado la firma no coincidirá.
 *
 * Comportamiento degradado:
 *   - Sin STRIPE_WEBHOOK_SECRET: `{ configured: false, verified: false }`
 *     pero igualmente intenta parsear el JSON para entornos de desarrollo.
 */
export function verifyAndParseWebhook(
  rawBody: string | Buffer,
  signatureHeader: string | undefined | null
): VerifyWebhookResult {
  const webhookSecret = getWebhookSecret();
  const bodyString = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');

  if (!webhookSecret) {
    // Sin secreto no podemos verificar; devolvemos no verificado para que el
    // caller decida (en dev puede aceptar; en prod debe rechazar).
    return { configured: false, verified: false, reason: 'STRIPE_WEBHOOK_SECRET not set' };
  }

  if (!signatureHeader) {
    return { configured: true, verified: false, reason: 'Missing Stripe-Signature header' };
  }

  const { timestamp, signatures } = parseSignatureHeader(signatureHeader);
  if (!timestamp || signatures.length === 0) {
    return { configured: true, verified: false, reason: 'Malformed Stripe-Signature header' };
  }

  const signedPayload = `${timestamp}.${bodyString}`;
  const expected = createHmac('sha256', webhookSecret).update(signedPayload, 'utf8').digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');

  const matched = signatures.some((sig) => {
    const sigBuf = Buffer.from(sig, 'utf8');
    return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf);
  });

  if (!matched) {
    return { configured: true, verified: false, reason: 'Signature mismatch' };
  }

  try {
    const event = JSON.parse(bodyString) as StripeWebhookEvent;
    return { configured: true, verified: true, event };
  } catch {
    return { configured: true, verified: false, reason: 'Invalid JSON body' };
  }
}
