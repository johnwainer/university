import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Phase 4 — Back-office (HR + Accounting) admin view.
 *
 * Self-contained: talks to the `/admin/hr/*` and `/admin/accounting/*` routes
 * directly (these endpoints are not yet in the shared `lib/api.ts` client, which
 * is owned by the orchestrator). Tabs: "Personal (HR)" (staff list + manual
 * entry + Gusto/Deel sync) and "Contabilidad" (QuickBooks status + GL sync +
 * sync log).
 */

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api';

type StaffMember = {
  id: string;
  tenant_id: string | null;
  external_id: string | null;
  provider: 'gusto' | 'deel' | 'manual';
  full_name: string;
  email: string | null;
  role: string | null;
  employment_type: 'employee' | 'contractor';
  status: string;
  country: string | null;
  synced_at: string | null;
  created_at: string;
};

type StaffResponse = {
  providers: { gusto: boolean; deel: boolean };
  staff: StaffMember[];
};

type HrSyncResponse = {
  status: 'ok' | 'partial' | 'not_configured';
  message?: string;
  synced?: number;
  errors?: string[];
};

type GlLogEntry = {
  id: string;
  provider: string;
  entity_type: 'invoice' | 'payment';
  entity_id: string | null;
  external_id: string | null;
  status: 'pending' | 'synced' | 'error';
  message: string | null;
  created_at: string;
};

type AccountingStatus = {
  quickbooksConfigured: boolean;
  summary: { pending: number; synced: number; error: number };
  log: GlLogEntry[];
};

type AccountingSyncResponse = {
  status: 'ok' | 'partial' | 'not_configured';
  message?: string;
  pushed?: number;
  errors?: string[];
};

async function boFetch<T>(
  token: string,
  path: string,
  options?: { method?: string; body?: unknown }
): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (options?.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(`${API_URL}${path}`, {
    method: options?.method ?? 'GET',
    headers,
    body: options?.body === undefined ? undefined : JSON.stringify(options.body)
  });
  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const raw = await response.text();
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { message?: string; error?: string };
          const detail = parsed.message ?? parsed.error;
          if (detail) message = `${message} - ${detail}`;
        } catch {
          message = `${message} - ${raw}`;
        }
      }
    } catch {
      // keep status-only message
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

type BackofficeTab = 'hr' | 'accounting';

export function BackofficeView({
  sessionToken,
  setError,
  setInfo
}: {
  sessionToken: string | null;
  setError: (msg: string | null) => void;
  setInfo: (msg: string | null) => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<BackofficeTab>('hr');
  const [loading, setLoading] = useState(false);

  // HR state.
  const [providers, setProviders] = useState<{ gusto: boolean; deel: boolean }>({
    gusto: false,
    deel: false
  });
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [syncingHr, setSyncingHr] = useState(false);
  const [savingStaff, setSavingStaff] = useState(false);
  const [staffForm, setStaffForm] = useState({
    fullName: '',
    email: '',
    role: '',
    employmentType: 'employee' as 'employee' | 'contractor',
    country: ''
  });

  // Accounting state.
  const [accounting, setAccounting] = useState<AccountingStatus | null>(null);
  const [syncingGl, setSyncingGl] = useState(false);

  const loadStaff = async (token: string) => {
    setLoading(true);
    try {
      const response = await boFetch<StaffResponse>(token, '/admin/hr/staff');
      setProviders(response.providers);
      setStaff(response.staff);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.backoffice.errores.personal'));
    } finally {
      setLoading(false);
    }
  };

  const loadAccounting = async (token: string) => {
    setLoading(true);
    try {
      const response = await boFetch<AccountingStatus>(token, '/admin/accounting/status');
      setAccounting(response);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.backoffice.errores.contabilidad'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!sessionToken) return;
    void loadStaff(sessionToken);
    void loadAccounting(sessionToken);
  }, [sessionToken]);

  const onCreateStaff = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionToken) return;
    setSavingStaff(true);
    setError(null);
    setInfo(null);
    try {
      await boFetch(sessionToken, '/admin/hr/staff', {
        method: 'POST',
        body: {
          fullName: staffForm.fullName,
          email: staffForm.email || undefined,
          role: staffForm.role || undefined,
          employmentType: staffForm.employmentType,
          country: staffForm.country || undefined
        }
      });
      setInfo(t('admin.backoffice.hr.agregado'));
      setStaffForm({ fullName: '', email: '', role: '', employmentType: 'employee', country: '' });
      await loadStaff(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.backoffice.hr.errorAgregar'));
    } finally {
      setSavingStaff(false);
    }
  };

  const onSyncHr = async () => {
    if (!sessionToken) return;
    setSyncingHr(true);
    setError(null);
    setInfo(null);
    try {
      const result = await boFetch<HrSyncResponse>(sessionToken, '/admin/hr/sync', {
        method: 'POST'
      });
      if (result.status === 'not_configured') {
        setInfo(result.message ?? t('admin.backoffice.hr.sinConector'));
      } else {
        const errorSuffix = result.errors?.length
          ? t('admin.backoffice.comun.sufijoErrores', { count: result.errors.length })
          : '';
        setInfo(
          t('admin.backoffice.hr.syncOk', { total: result.synced ?? 0, errores: errorSuffix })
        );
        if (result.errors?.length) {
          setError(result.errors.join(' | '));
        }
      }
      await loadStaff(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.backoffice.hr.errorSync'));
    } finally {
      setSyncingHr(false);
    }
  };

  const onSyncGl = async () => {
    if (!sessionToken) return;
    setSyncingGl(true);
    setError(null);
    setInfo(null);
    try {
      const result = await boFetch<AccountingSyncResponse>(sessionToken, '/admin/accounting/sync', {
        method: 'POST'
      });
      if (result.status === 'not_configured') {
        setInfo(result.message ?? t('admin.backoffice.contabilidad.sinQuickbooks'));
      } else {
        const errorSuffix = result.errors?.length
          ? t('admin.backoffice.comun.sufijoErrores', { count: result.errors.length })
          : '';
        setInfo(
          t('admin.backoffice.contabilidad.syncOk', {
            total: result.pushed ?? 0,
            errores: errorSuffix
          })
        );
        if (result.errors?.length) {
          setError(result.errors.join(' | '));
        }
      }
      await loadAccounting(sessionToken);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t('admin.backoffice.contabilidad.errorSync')
      );
    } finally {
      setSyncingGl(false);
    }
  };

  if (!sessionToken) {
    return <p>{t('admin.backoffice.sinSesion')}</p>;
  }

  return (
    <section className="grid-1">
      <article className="card">
        <div className="inline-actions" style={{ marginBottom: '8px' }}>
          <button className={tab === 'hr' ? '' : 'ghost'} onClick={() => setTab('hr')}>
            {t('admin.backoffice.tabs.hr')}
          </button>
          <button className={tab === 'accounting' ? '' : 'ghost'} onClick={() => setTab('accounting')}>
            {t('admin.backoffice.tabs.contabilidad')}
          </button>
          {loading ? (
            <span style={{ color: 'var(--text-muted)' }}>{t('admin.backoffice.comun.cargando')}</span>
          ) : null}
        </div>
      </article>

      {tab === 'hr' && (
        <>
          <article className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>{t('admin.backoffice.hr.directorioTitulo')}</h2>
              <button className="ghost" onClick={() => void onSyncHr()} disabled={syncingHr}>
                {syncingHr
                  ? t('admin.backoffice.comun.sincronizando')
                  : t('admin.backoffice.hr.sincronizar')}
              </button>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              {t('admin.backoffice.hr.proveedores', {
                gusto: providers.gusto
                  ? t('admin.backoffice.comun.configurado')
                  : t('admin.backoffice.comun.noConfigurado'),
                deel: providers.deel
                  ? t('admin.backoffice.comun.configurado')
                  : t('admin.backoffice.comun.noConfigurado')
              })}
            </p>
          </article>

          <article className="card">
            <h2>{t('admin.backoffice.hr.altaTitulo')}</h2>
            <form className="login-form" onSubmit={onCreateStaff}>
              <label>{t('admin.backoffice.hr.campoNombre')}</label>
              <input
                value={staffForm.fullName}
                onChange={(e) => setStaffForm((c) => ({ ...c, fullName: e.target.value }))}
                placeholder={t('admin.backoffice.hr.campoNombrePlaceholder')}
                required
              />
              <label>{t('admin.backoffice.hr.campoEmail')}</label>
              <input
                type="email"
                value={staffForm.email}
                onChange={(e) => setStaffForm((c) => ({ ...c, email: e.target.value }))}
                placeholder="maria@atlas.edu"
              />
              <label>{t('admin.backoffice.hr.campoRol')}</label>
              <input
                value={staffForm.role}
                onChange={(e) => setStaffForm((c) => ({ ...c, role: e.target.value }))}
                placeholder={t('admin.backoffice.hr.campoRolPlaceholder')}
              />
              <label>{t('admin.backoffice.hr.campoTipo')}</label>
              <select
                value={staffForm.employmentType}
                onChange={(e) =>
                  setStaffForm((c) => ({
                    ...c,
                    employmentType: e.target.value as 'employee' | 'contractor'
                  }))
                }
              >
                <option value="employee">{t('admin.backoffice.hr.tipoEmpleado')}</option>
                <option value="contractor">{t('admin.backoffice.hr.tipoContratista')}</option>
              </select>
              <label>{t('admin.backoffice.hr.campoPais')}</label>
              <input
                value={staffForm.country}
                onChange={(e) => setStaffForm((c) => ({ ...c, country: e.target.value }))}
                placeholder="US"
              />
              <button type="submit" disabled={savingStaff}>
                {savingStaff
                  ? t('admin.backoffice.comun.guardando')
                  : t('admin.backoffice.hr.agregar')}
              </button>
            </form>
          </article>

          <article className="card scroll-card">
            <h2>{t('admin.backoffice.hr.listaTitulo', { total: staff.length })}</h2>
            <table>
              <thead>
                <tr>
                  <th>{t('admin.backoffice.hr.colNombre')}</th>
                  <th>{t('admin.backoffice.hr.colEmail')}</th>
                  <th>{t('admin.backoffice.hr.colRol')}</th>
                  <th>{t('admin.backoffice.hr.colOrigen')}</th>
                  <th>{t('admin.backoffice.hr.colTipo')}</th>
                  <th>{t('admin.backoffice.hr.colEstado')}</th>
                  <th>{t('admin.backoffice.hr.colPais')}</th>
                  <th>{t('admin.backoffice.hr.colSincronizado')}</th>
                </tr>
              </thead>
              <tbody>
                {staff.length === 0 ? (
                  <tr>
                    <td colSpan={8}>{t('admin.backoffice.hr.vacio')}</td>
                  </tr>
                ) : (
                  staff.map((member) => (
                    <tr key={member.id}>
                      <td>{member.full_name}</td>
                      <td>{member.email ?? '-'}</td>
                      <td>{member.role ?? '-'}</td>
                      <td>{member.provider}</td>
                      <td>{member.employment_type}</td>
                      <td>{member.status}</td>
                      <td>{member.country ?? '-'}</td>
                      <td>{member.synced_at ? new Date(member.synced_at).toLocaleString() : '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </article>
        </>
      )}

      {tab === 'accounting' && (
        <>
          <article className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>{t('admin.backoffice.contabilidad.titulo')}</h2>
              <button className="ghost" onClick={() => void onSyncGl()} disabled={syncingGl}>
                {syncingGl
                  ? t('admin.backoffice.comun.sincronizando')
                  : t('admin.backoffice.contabilidad.sincronizar')}
              </button>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              {t('admin.backoffice.contabilidad.estado', {
                estado: accounting?.quickbooksConfigured
                  ? t('admin.backoffice.comun.configurado')
                  : t('admin.backoffice.comun.noConfigurado')
              })}
            </p>
            {accounting && (
              <div className="grid-like-two" style={{ marginTop: '12px' }}>
                <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                  <small style={{ color: 'var(--text-muted)' }}>
                    {t('admin.backoffice.contabilidad.sincronizados')}
                  </small>
                  <div style={{ fontSize: '2rem', fontWeight: 800 }}>{accounting.summary.synced}</div>
                </div>
                <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                  <small style={{ color: 'var(--text-muted)' }}>
                    {t('admin.backoffice.contabilidad.pendientes')}
                  </small>
                  <div style={{ fontSize: '2rem', fontWeight: 800 }}>{accounting.summary.pending}</div>
                </div>
                <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                  <small style={{ color: 'var(--text-muted)' }}>
                    {t('admin.backoffice.contabilidad.errores')}
                  </small>
                  <div style={{ fontSize: '2rem', fontWeight: 800 }}>{accounting.summary.error}</div>
                </div>
              </div>
            )}
          </article>

          <article className="card scroll-card">
            <h2>{t('admin.backoffice.contabilidad.logTitulo')}</h2>
            <table>
              <thead>
                <tr>
                  <th>{t('admin.backoffice.contabilidad.colFecha')}</th>
                  <th>{t('admin.backoffice.contabilidad.colEntidad')}</th>
                  <th>{t('admin.backoffice.contabilidad.colIdInterno')}</th>
                  <th>{t('admin.backoffice.contabilidad.colIdExterno')}</th>
                  <th>{t('admin.backoffice.contabilidad.colEstado')}</th>
                  <th>{t('admin.backoffice.contabilidad.colMensaje')}</th>
                </tr>
              </thead>
              <tbody>
                {!accounting || accounting.log.length === 0 ? (
                  <tr>
                    <td colSpan={6}>{t('admin.backoffice.contabilidad.logVacio')}</td>
                  </tr>
                ) : (
                  accounting.log.map((entry) => (
                    <tr key={entry.id}>
                      <td>{new Date(entry.created_at).toLocaleString()}</td>
                      <td>{entry.entity_type}</td>
                      <td>{entry.entity_id ?? '-'}</td>
                      <td>{entry.external_id ?? '-'}</td>
                      <td>{entry.status}</td>
                      <td>{entry.message ?? '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </article>
        </>
      )}
    </section>
  );
}
