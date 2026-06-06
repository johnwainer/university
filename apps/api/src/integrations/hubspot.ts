/**
 * HubSpot connector (CRM contacts).
 *
 * Optional, bidirectional-friendly sync layer for `crm_contacts`. The native
 * CRM-lite tables remain the operational source of truth; HubSpot is a marketing
 * mirror. When `HUBSPOT_ACCESS_TOKEN` is unset, every call returns a graceful
 * "not configured" result instead of throwing.
 *
 * Env:
 *   HUBSPOT_ACCESS_TOKEN — Private App access token (Bearer). Optional.
 *
 * Uses the Fetch API (Node 18+ global `fetch`) against the HubSpot CRM v3 API:
 *   https://api.hubapi.com/crm/v3/objects/contacts
 */

const HUBSPOT_API_BASE = 'https://api.hubapi.com/crm/v3/objects/contacts';

export interface HubspotResult<T> {
  ok: boolean;
  configured: boolean;
  data?: T;
  error?: string;
}

export interface HubspotContactInput {
  email?: string;
  fullName?: string;
  phone?: string;
  /** Extra HubSpot contact properties (raw property names). */
  properties?: Record<string, string>;
}

export interface HubspotContact {
  id: string;
  properties: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
}

function getToken(): string {
  return (process.env.HUBSPOT_ACCESS_TOKEN ?? '').trim();
}

export function isHubspotConfigured(): boolean {
  return getToken().length > 0;
}

function notConfigured<T>(): HubspotResult<T> {
  return { ok: false, configured: false, error: 'HubSpot not configured' };
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${getToken()}`,
    'Content-Type': 'application/json'
  };
}

function buildProperties(input: HubspotContactInput): Record<string, string> {
  const properties: Record<string, string> = { ...(input.properties ?? {}) };
  if (input.email) {
    properties.email = input.email;
  }
  if (input.phone) {
    properties.phone = input.phone;
  }
  if (input.fullName) {
    const trimmed = input.fullName.trim();
    const spaceIndex = trimmed.indexOf(' ');
    if (spaceIndex === -1) {
      properties.firstname = trimmed;
    } else {
      properties.firstname = trimmed.slice(0, spaceIndex);
      properties.lastname = trimmed.slice(spaceIndex + 1);
    }
  }
  return properties;
}

async function readError(response: Response): Promise<string> {
  try {
    const raw = await response.text();
    return raw ? `${response.status} - ${raw}` : `${response.status}`;
  } catch {
    return `${response.status}`;
  }
}

/**
 * Upsert a contact by email. HubSpot's standard contacts API does not expose a
 * single upsert verb, so we search by email first and PATCH if found, otherwise
 * POST a new contact. When no email is provided we always create.
 */
export async function upsertContact(
  input: HubspotContactInput
): Promise<HubspotResult<HubspotContact>> {
  if (!isHubspotConfigured()) {
    return notConfigured<HubspotContact>();
  }

  const properties = buildProperties(input);

  try {
    let existingId: string | null = null;
    if (input.email) {
      const searchResponse = await fetch(`${HUBSPOT_API_BASE}/search`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          filterGroups: [
            {
              filters: [
                { propertyName: 'email', operator: 'EQ', value: input.email }
              ]
            }
          ],
          properties: ['email', 'firstname', 'lastname', 'phone'],
          limit: 1
        })
      });
      if (searchResponse.ok) {
        const payload = (await searchResponse.json()) as {
          results?: Array<{ id: string }>;
        };
        existingId = payload.results?.[0]?.id ?? null;
      }
    }

    const target = existingId ? `${HUBSPOT_API_BASE}/${existingId}` : HUBSPOT_API_BASE;
    const response = await fetch(target, {
      method: existingId ? 'PATCH' : 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ properties })
    });

    if (!response.ok) {
      return {
        ok: false,
        configured: true,
        error: await readError(response)
      };
    }

    const data = (await response.json()) as HubspotContact;
    return { ok: true, configured: true, data };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      error: error instanceof Error ? error.message : 'HubSpot request failed'
    };
  }
}

/** List contacts from HubSpot (up to `limit`, capped at 100 per API page). */
export async function listContacts(
  limit = 20
): Promise<HubspotResult<HubspotContact[]>> {
  if (!isHubspotConfigured()) {
    return notConfigured<HubspotContact[]>();
  }

  const capped = Math.max(1, Math.min(limit, 100));
  const params = new URLSearchParams({
    limit: String(capped),
    properties: 'email,firstname,lastname,phone'
  });

  try {
    const response = await fetch(`${HUBSPOT_API_BASE}?${params.toString()}`, {
      method: 'GET',
      headers: authHeaders()
    });

    if (!response.ok) {
      return {
        ok: false,
        configured: true,
        error: await readError(response)
      };
    }

    const payload = (await response.json()) as { results?: HubspotContact[] };
    return { ok: true, configured: true, data: payload.results ?? [] };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      error: error instanceof Error ? error.message : 'HubSpot request failed'
    };
  }
}
