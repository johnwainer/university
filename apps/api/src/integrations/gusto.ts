/**
 * Phase 4 — HR connector (Gusto, with optional Deel).
 *
 * Read-only directory sync for the back-office staff directory. Follows the
 * same "graceful when unconfigured" contract as the rest of the connectors:
 * the functions never throw when credentials are missing — they report
 * `configured: false` so the admin UI can render a "no configurado" state.
 *
 * Environment variables (documented; loaded by the orchestrator):
 *   GUSTO_ACCESS_TOKEN   OAuth2 bearer token for the Gusto API.
 *   GUSTO_API_BASE_URL   Optional override (defaults to https://api.gusto.com).
 *   GUSTO_COMPANY_ID     Optional company uuid; when set we list that company's
 *                        employees, otherwise we resolve the first company the
 *                        token can see via /v1/me.
 *   DEEL_API_TOKEN       Optional bearer token for the Deel API.
 *   DEEL_API_BASE_URL    Optional override (defaults to https://api.letsdeel.com).
 */

const GUSTO_BASE_URL = (process.env.GUSTO_API_BASE_URL ?? 'https://api.gusto.com').replace(/\/+$/, '');
const DEEL_BASE_URL = (process.env.DEEL_API_BASE_URL ?? 'https://api.letsdeel.com').replace(/\/+$/, '');

/** A provider-neutral person record ready to upsert into `staff_directory`. */
export interface StaffMember {
  externalId: string;
  provider: 'gusto' | 'deel';
  fullName: string;
  email: string | null;
  role: string | null;
  employmentType: 'employee' | 'contractor';
  status: string;
  country: string | null;
}

export function isGustoConfigured(): boolean {
  return Boolean(process.env.GUSTO_ACCESS_TOKEN);
}

async function gustoFetch<T>(path: string): Promise<T> {
  const token = process.env.GUSTO_ACCESS_TOKEN;
  if (!token) {
    throw new Error('Gusto is not configured (missing GUSTO_ACCESS_TOKEN)');
  }
  const response = await fetch(`${GUSTO_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    }
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Gusto API ${response.status}: ${detail || response.statusText}`);
  }
  return (await response.json()) as T;
}

async function resolveGustoCompanyId(): Promise<string | null> {
  if (process.env.GUSTO_COMPANY_ID) {
    return process.env.GUSTO_COMPANY_ID;
  }
  // /v1/me returns the authenticated user and the companies it can access.
  const me = await gustoFetch<{
    roles?: { payroll_admin?: { companies?: Array<{ uuid?: string; id?: string }> } };
  }>('/v1/me');
  const companies = me.roles?.payroll_admin?.companies ?? [];
  const first = companies[0];
  return first?.uuid ?? first?.id ?? null;
}

interface GustoEmployee {
  uuid?: string;
  id?: string | number;
  first_name?: string;
  last_name?: string;
  email?: string;
  terminated?: boolean;
  jobs?: Array<{ title?: string }>;
}

/**
 * Pull the employee directory from Gusto. Returns provider-neutral records.
 * Throws only on real API/transport errors; callers should gate on
 * `isGustoConfigured()` first.
 */
export async function listEmployees(): Promise<StaffMember[]> {
  const companyId = await resolveGustoCompanyId();
  if (!companyId) {
    return [];
  }
  const employees = await gustoFetch<GustoEmployee[]>(
    `/v1/companies/${encodeURIComponent(companyId)}/employees`
  );
  if (!Array.isArray(employees)) {
    return [];
  }
  return employees.map((employee) => {
    const externalId = String(employee.uuid ?? employee.id ?? '');
    const fullName = [employee.first_name, employee.last_name].filter(Boolean).join(' ').trim();
    return {
      externalId,
      provider: 'gusto' as const,
      fullName: fullName || (employee.email ?? 'Unknown'),
      email: employee.email ?? null,
      role: employee.jobs?.[0]?.title ?? null,
      employmentType: 'employee' as const,
      status: employee.terminated ? 'terminated' : 'active',
      country: null
    };
  });
}

export function isDeelConfigured(): boolean {
  return Boolean(process.env.DEEL_API_TOKEN);
}

async function deelFetch<T>(path: string): Promise<T> {
  const token = process.env.DEEL_API_TOKEN;
  if (!token) {
    throw new Error('Deel is not configured (missing DEEL_API_TOKEN)');
  }
  const response = await fetch(`${DEEL_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    }
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Deel API ${response.status}: ${detail || response.statusText}`);
  }
  return (await response.json()) as T;
}

interface DeelWorker {
  id?: string | number;
  hris_profile_id?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  job_title?: string;
  worker_status?: { name?: string };
  country?: string;
  hiring_type?: string;
}

/**
 * Pull the worker (contractor/EOR) directory from Deel. Returns
 * provider-neutral records. Gate on `isDeelConfigured()` first.
 */
export async function listWorkers(): Promise<StaffMember[]> {
  const payload = await deelFetch<{ data?: DeelWorker[] }>('/rest/v2/people');
  const workers = payload.data ?? [];
  return workers.map((worker) => {
    const externalId = String(worker.id ?? worker.hris_profile_id ?? '');
    const fullName =
      worker.full_name ??
      [worker.first_name, worker.last_name].filter(Boolean).join(' ').trim();
    const employmentType: 'employee' | 'contractor' =
      worker.hiring_type === 'employee' ? 'employee' : 'contractor';
    return {
      externalId,
      provider: 'deel' as const,
      fullName: fullName || (worker.email ?? 'Unknown'),
      email: worker.email ?? null,
      role: worker.job_title ?? null,
      employmentType,
      status: worker.worker_status?.name ?? 'active',
      country: worker.country ?? null
    };
  });
}
