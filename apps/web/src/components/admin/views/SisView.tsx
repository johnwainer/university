import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Fase 1 — Núcleo SIS + Pagos (admin view).
 *
 * Self-contained: habla directamente con las rutas `/admin/admissions`,
 * `/admin/students/:id/ledger`, `/admin/invoices`, `/admin/holds` y
 * `/admin/students/:id/degree-audit`. Estos endpoints aún no están en el cliente
 * compartido `lib/api.ts` (propiedad del orquestador), por eso usamos un helper
 * de fetch local con el mismo patrón que `CrmView.tsx`.
 *
 * Pestañas: Admisiones, Finanzas (ledger/invoices/holds) y Auditoría de grado.
 */

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api';

type Stage = 'lead' | 'applied' | 'admitted' | 'enrolled' | 'rejected';

type AdmissionApplication = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  program_id: string | null;
  program_name: string | null;
  stage: Stage;
  status: string;
  notes: string | null;
  created_at: string;
};

type LedgerEntry = {
  id: string;
  kind: 'charge' | 'payment' | 'aid' | 'adjustment';
  description: string | null;
  amount_cents: number;
  currency: string;
  balance_cents: number;
  term_id: string | null;
  created_at: string;
};

type LedgerResponse = {
  entries: LedgerEntry[];
  balanceCents: number;
  currency: string;
};

type Invoice = {
  id: string;
  student_user_id: string;
  student_name: string | null;
  student_email: string | null;
  status: 'draft' | 'open' | 'paid' | 'void';
  total_cents: number;
  currency: string;
  stripe_invoice_id: string | null;
  due_date: string | null;
  created_at: string;
};

type Hold = {
  id: string;
  student_user_id: string;
  student_name: string | null;
  student_email: string | null;
  hold_type: 'financial' | 'academic' | 'documents';
  reason: string | null;
  active: boolean;
  created_at: string;
  released_at: string | null;
};

type DegreeAuditRequirement = {
  id: string;
  requirement_type: 'course' | 'credits' | 'gpa';
  description: string | null;
  satisfied: boolean;
  detail: string;
};

type DegreeAudit = {
  degreeProgramId: string | null;
  totalRequirements: number;
  satisfiedRequirements: number;
  percentComplete: number;
  completedCredits: number;
  cumulativeGpa: number | null;
  requirements: DegreeAuditRequirement[];
};

async function sisFetch<T>(
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

function formatMoney(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

type SisTab = 'admissions' | 'finance' | 'audit';

const STAGES: Stage[] = ['lead', 'applied', 'admitted', 'enrolled', 'rejected'];

export function SisView({
  sessionToken,
  setError,
  setInfo
}: {
  sessionToken: string | null;
  setError: (msg: string | null) => void;
  setInfo: (msg: string | null) => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<SisTab>('admissions');

  // Admisiones
  const [applications, setApplications] = useState<AdmissionApplication[]>([]);
  const [loadingAdmissions, setLoadingAdmissions] = useState(false);
  const [admissionForm, setAdmissionForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    notes: ''
  });
  const [savingAdmission, setSavingAdmission] = useState(false);

  // Finanzas
  const [ledgerStudentId, setLedgerStudentId] = useState('');
  const [ledger, setLedger] = useState<LedgerResponse | null>(null);
  const [ledgerForm, setLedgerForm] = useState({
    kind: 'charge' as LedgerEntry['kind'],
    amount: '',
    description: ''
  });
  const [savingLedger, setSavingLedger] = useState(false);

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoiceForm, setInvoiceForm] = useState({ studentUserId: '', total: '', dueDate: '' });
  const [savingInvoice, setSavingInvoice] = useState(false);

  const [holds, setHolds] = useState<Hold[]>([]);
  const [holdForm, setHoldForm] = useState({
    studentUserId: '',
    holdType: 'financial' as Hold['hold_type'],
    reason: ''
  });
  const [savingHold, setSavingHold] = useState(false);

  // Auditoría de grado
  const [auditStudentId, setAuditStudentId] = useState('');
  const [audit, setAudit] = useState<DegreeAudit | null>(null);
  const [loadingAudit, setLoadingAudit] = useState(false);

  const loadAdmissions = async (token: string) => {
    setLoadingAdmissions(true);
    try {
      const data = await sisFetch<AdmissionApplication[]>(token, '/admin/admissions');
      setApplications(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.sis.errorCargarAdmisiones'));
    } finally {
      setLoadingAdmissions(false);
    }
  };

  const loadInvoices = async (token: string) => {
    try {
      const data = await sisFetch<Invoice[]>(token, '/admin/invoices');
      setInvoices(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.sis.errorCargarFacturas'));
    }
  };

  const loadHolds = async (token: string) => {
    try {
      const data = await sisFetch<Hold[]>(token, '/admin/holds');
      setHolds(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.sis.errorCargarBloqueos'));
    }
  };

  useEffect(() => {
    if (!sessionToken) return;
    if (tab === 'admissions') void loadAdmissions(sessionToken);
    if (tab === 'finance') {
      void loadInvoices(sessionToken);
      void loadHolds(sessionToken);
    }
  }, [sessionToken, tab]);

  const onCreateAdmission = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionToken) return;
    setSavingAdmission(true);
    setError(null);
    setInfo(null);
    try {
      await sisFetch(sessionToken, '/admin/admissions', {
        method: 'POST',
        body: {
          fullName: admissionForm.fullName,
          email: admissionForm.email,
          phone: admissionForm.phone || undefined,
          notes: admissionForm.notes || undefined
        }
      });
      setInfo(t('admin.sis.aplicacionCreada'));
      setAdmissionForm({ fullName: '', email: '', phone: '', notes: '' });
      await loadAdmissions(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.sis.errorCrearAplicacion'));
    } finally {
      setSavingAdmission(false);
    }
  };

  const onChangeStage = async (id: string, stage: Stage) => {
    if (!sessionToken) return;
    setError(null);
    setInfo(null);
    try {
      await sisFetch(sessionToken, `/admin/admissions/${id}/stage`, {
        method: 'PATCH',
        body: { stage }
      });
      setInfo(t('admin.sis.etapaActualizada'));
      await loadAdmissions(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.sis.errorActualizarEtapa'));
    }
  };

  const onLoadLedger = async () => {
    if (!sessionToken || !ledgerStudentId) return;
    setError(null);
    try {
      const data = await sisFetch<LedgerResponse>(
        sessionToken,
        `/admin/students/${ledgerStudentId}/ledger`
      );
      setLedger(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.sis.errorCargarLedger'));
    }
  };

  const onAddLedgerEntry = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionToken || !ledgerStudentId) return;
    const amount = Math.round(parseFloat(ledgerForm.amount) * 100);
    if (!Number.isFinite(amount)) {
      setError(t('admin.sis.errorMontoInvalido'));
      return;
    }
    setSavingLedger(true);
    setError(null);
    setInfo(null);
    try {
      await sisFetch(sessionToken, `/admin/students/${ledgerStudentId}/ledger`, {
        method: 'POST',
        body: {
          kind: ledgerForm.kind,
          amountCents: amount,
          description: ledgerForm.description || undefined
        }
      });
      setInfo(t('admin.sis.movimientoRegistrado'));
      setLedgerForm({ kind: 'charge', amount: '', description: '' });
      await onLoadLedger();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.sis.errorRegistrarMovimiento'));
    } finally {
      setSavingLedger(false);
    }
  };

  const onCreateInvoice = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionToken) return;
    const total = Math.round(parseFloat(invoiceForm.total) * 100);
    if (!Number.isFinite(total)) {
      setError(t('admin.sis.errorTotalInvalido'));
      return;
    }
    setSavingInvoice(true);
    setError(null);
    setInfo(null);
    try {
      await sisFetch(sessionToken, '/admin/invoices', {
        method: 'POST',
        body: {
          studentUserId: invoiceForm.studentUserId,
          totalCents: total,
          dueDate: invoiceForm.dueDate || undefined
        }
      });
      setInfo(t('admin.sis.facturaCreada'));
      setInvoiceForm({ studentUserId: '', total: '', dueDate: '' });
      await loadInvoices(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.sis.errorCrearFactura'));
    } finally {
      setSavingInvoice(false);
    }
  };

  const onCreateHold = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionToken) return;
    setSavingHold(true);
    setError(null);
    setInfo(null);
    try {
      await sisFetch(sessionToken, '/admin/holds', {
        method: 'POST',
        body: {
          studentUserId: holdForm.studentUserId,
          holdType: holdForm.holdType,
          reason: holdForm.reason || undefined
        }
      });
      setInfo(t('admin.sis.bloqueoCreado'));
      setHoldForm({ studentUserId: '', holdType: 'financial', reason: '' });
      await loadHolds(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.sis.errorCrearBloqueo'));
    } finally {
      setSavingHold(false);
    }
  };

  const onReleaseHold = async (id: string) => {
    if (!sessionToken) return;
    setError(null);
    setInfo(null);
    try {
      await sisFetch(sessionToken, `/admin/holds/${id}/release`, { method: 'PATCH' });
      setInfo(t('admin.sis.bloqueoLiberado'));
      await loadHolds(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.sis.errorLiberarBloqueo'));
    }
  };

  const onLoadAudit = async () => {
    if (!sessionToken || !auditStudentId) return;
    setLoadingAudit(true);
    setError(null);
    try {
      const data = await sisFetch<DegreeAudit>(
        sessionToken,
        `/admin/students/${auditStudentId}/degree-audit`
      );
      setAudit(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.sis.errorCargarAuditoria'));
    } finally {
      setLoadingAudit(false);
    }
  };

  return (
    <section className="grid-1">
      <article className="card">
        <div className="inline-actions" style={{ marginBottom: '16px' }}>
          <button className={tab === 'admissions' ? '' : 'ghost'} onClick={() => setTab('admissions')}>
            {t('admin.sis.tabAdmisiones')}
          </button>
          <button className={tab === 'finance' ? '' : 'ghost'} onClick={() => setTab('finance')}>
            {t('admin.sis.tabFinanzas')}
          </button>
          <button className={tab === 'audit' ? '' : 'ghost'} onClick={() => setTab('audit')}>
            {t('admin.sis.tabAuditoria')}
          </button>
        </div>

        {tab === 'admissions' && (
          <div className="grid-2">
            <div>
              <h2>{t('admin.sis.nuevaAplicacion')}</h2>
              <form className="login-form" onSubmit={onCreateAdmission}>
                <label>{t('admin.sis.campoNombreCompleto')}</label>
                <input
                  value={admissionForm.fullName}
                  onChange={(e) => setAdmissionForm((c) => ({ ...c, fullName: e.target.value }))}
                  required
                />
                <label>{t('admin.sis.campoEmail')}</label>
                <input
                  type="email"
                  value={admissionForm.email}
                  onChange={(e) => setAdmissionForm((c) => ({ ...c, email: e.target.value }))}
                  required
                />
                <label>{t('admin.sis.campoTelefono')}</label>
                <input
                  value={admissionForm.phone}
                  onChange={(e) => setAdmissionForm((c) => ({ ...c, phone: e.target.value }))}
                />
                <label>{t('admin.sis.campoNotas')}</label>
                <input
                  value={admissionForm.notes}
                  onChange={(e) => setAdmissionForm((c) => ({ ...c, notes: e.target.value }))}
                />
                <button type="submit" disabled={savingAdmission}>
                  {savingAdmission ? t('admin.sis.guardando') : t('admin.sis.crearAplicacion')}
                </button>
              </form>
            </div>
            <div>
              <h2>{t('admin.sis.aplicacionesTitulo', { total: applications.length })}</h2>
              {loadingAdmissions ? <p>{t('admin.sis.cargando')}</p> : null}
              <table>
                <thead>
                  <tr>
                    <th>{t('admin.sis.colNombre')}</th>
                    <th>{t('admin.sis.colEmail')}</th>
                    <th>{t('admin.sis.colPrograma')}</th>
                    <th>{t('admin.sis.colEtapa')}</th>
                  </tr>
                </thead>
                <tbody>
                  {applications.length === 0 ? (
                    <tr>
                      <td colSpan={4}>{t('admin.sis.sinAplicaciones')}</td>
                    </tr>
                  ) : (
                    applications.map((a) => (
                      <tr key={a.id}>
                        <td>{a.full_name}</td>
                        <td>{a.email}</td>
                        <td>{a.program_name ?? '-'}</td>
                        <td>
                          <select
                            value={a.stage}
                            onChange={(e) => void onChangeStage(a.id, e.target.value as Stage)}
                          >
                            {STAGES.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'finance' && (
          <div className="grid-1">
            <div className="card">
              <h2>{t('admin.sis.estadoCuentaTitulo')}</h2>
              <div className="inline-actions" style={{ marginBottom: '12px' }}>
                <input
                  placeholder={t('admin.sis.placeholderIdUsuarioEstudiante')}
                  value={ledgerStudentId}
                  onChange={(e) => setLedgerStudentId(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button onClick={() => void onLoadLedger()}>{t('admin.sis.cargarLedger')}</button>
              </div>
              {ledger && (
                <>
                  <p>
                    <strong>{t('admin.sis.labelBalance')}</strong>{' '}
                    {formatMoney(ledger.balanceCents, ledger.currency)}
                  </p>
                  <table>
                    <thead>
                      <tr>
                        <th>{t('admin.sis.colFecha')}</th>
                        <th>{t('admin.sis.colTipo')}</th>
                        <th>{t('admin.sis.colDescripcion')}</th>
                        <th>{t('admin.sis.colMonto')}</th>
                        <th>{t('admin.sis.colBalance')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.entries.length === 0 ? (
                        <tr>
                          <td colSpan={5}>{t('admin.sis.sinMovimientos')}</td>
                        </tr>
                      ) : (
                        ledger.entries.map((e) => (
                          <tr key={e.id}>
                            <td>{new Date(e.created_at).toLocaleDateString()}</td>
                            <td>{e.kind}</td>
                            <td>{e.description ?? '-'}</td>
                            <td>{formatMoney(e.amount_cents, e.currency)}</td>
                            <td>{formatMoney(e.balance_cents, e.currency)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                  <form className="login-form" onSubmit={onAddLedgerEntry} style={{ marginTop: '12px' }}>
                    <label>{t('admin.sis.campoTipoMovimiento')}</label>
                    <select
                      value={ledgerForm.kind}
                      onChange={(e) =>
                        setLedgerForm((c) => ({ ...c, kind: e.target.value as LedgerEntry['kind'] }))
                      }
                    >
                      <option value="charge">{t('admin.sis.movimientoCargo')}</option>
                      <option value="payment">{t('admin.sis.movimientoPago')}</option>
                      <option value="aid">{t('admin.sis.movimientoAyuda')}</option>
                      <option value="adjustment">{t('admin.sis.movimientoAjuste')}</option>
                    </select>
                    <label>{t('admin.sis.campoMonto')}</label>
                    <input
                      value={ledgerForm.amount}
                      onChange={(e) => setLedgerForm((c) => ({ ...c, amount: e.target.value }))}
                      placeholder={t('admin.sis.placeholderMonto')}
                      required
                    />
                    <label>{t('admin.sis.campoDescripcion')}</label>
                    <input
                      value={ledgerForm.description}
                      onChange={(e) => setLedgerForm((c) => ({ ...c, description: e.target.value }))}
                    />
                    <button type="submit" disabled={savingLedger}>
                      {savingLedger ? t('admin.sis.guardando') : t('admin.sis.registrarMovimiento')}
                    </button>
                  </form>
                </>
              )}
            </div>

            <div className="card">
              <h2>{t('admin.sis.facturasTitulo', { total: invoices.length })}</h2>
              <form className="inline-actions" onSubmit={onCreateInvoice} style={{ marginBottom: '12px' }}>
                <input
                  placeholder={t('admin.sis.placeholderIdEstudiante')}
                  value={invoiceForm.studentUserId}
                  onChange={(e) => setInvoiceForm((c) => ({ ...c, studentUserId: e.target.value }))}
                  required
                />
                <input
                  placeholder={t('admin.sis.placeholderTotal')}
                  value={invoiceForm.total}
                  onChange={(e) => setInvoiceForm((c) => ({ ...c, total: e.target.value }))}
                  required
                />
                <input
                  type="date"
                  value={invoiceForm.dueDate}
                  onChange={(e) => setInvoiceForm((c) => ({ ...c, dueDate: e.target.value }))}
                />
                <button type="submit" disabled={savingInvoice}>
                  {savingInvoice ? '...' : t('admin.sis.crearFactura')}
                </button>
              </form>
              <table>
                <thead>
                  <tr>
                    <th>{t('admin.sis.colEstudiante')}</th>
                    <th>{t('admin.sis.colTotal')}</th>
                    <th>{t('admin.sis.colEstado')}</th>
                    <th>{t('admin.sis.colVence')}</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.length === 0 ? (
                    <tr>
                      <td colSpan={4}>{t('admin.sis.sinFacturas')}</td>
                    </tr>
                  ) : (
                    invoices.map((inv) => (
                      <tr key={inv.id}>
                        <td>{inv.student_name ?? inv.student_user_id}</td>
                        <td>{formatMoney(inv.total_cents, inv.currency)}</td>
                        <td>{inv.status}</td>
                        <td>{inv.due_date ?? '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="card">
              <h2>{t('admin.sis.bloqueosTitulo', { total: holds.length })}</h2>
              <form className="inline-actions" onSubmit={onCreateHold} style={{ marginBottom: '12px' }}>
                <input
                  placeholder={t('admin.sis.placeholderIdEstudiante')}
                  value={holdForm.studentUserId}
                  onChange={(e) => setHoldForm((c) => ({ ...c, studentUserId: e.target.value }))}
                  required
                />
                <select
                  value={holdForm.holdType}
                  onChange={(e) =>
                    setHoldForm((c) => ({ ...c, holdType: e.target.value as Hold['hold_type'] }))
                  }
                >
                  <option value="financial">{t('admin.sis.bloqueoFinanciero')}</option>
                  <option value="academic">{t('admin.sis.bloqueoAcademico')}</option>
                  <option value="documents">{t('admin.sis.bloqueoDocumentos')}</option>
                </select>
                <input
                  placeholder={t('admin.sis.placeholderRazon')}
                  value={holdForm.reason}
                  onChange={(e) => setHoldForm((c) => ({ ...c, reason: e.target.value }))}
                />
                <button type="submit" disabled={savingHold}>
                  {savingHold ? '...' : t('admin.sis.crearBloqueo')}
                </button>
              </form>
              <table>
                <thead>
                  <tr>
                    <th>{t('admin.sis.colEstudiante')}</th>
                    <th>{t('admin.sis.colTipo')}</th>
                    <th>{t('admin.sis.colRazon')}</th>
                    <th>{t('admin.sis.colEstado')}</th>
                    <th>{t('admin.sis.colAccion')}</th>
                  </tr>
                </thead>
                <tbody>
                  {holds.length === 0 ? (
                    <tr>
                      <td colSpan={5}>{t('admin.sis.sinBloqueos')}</td>
                    </tr>
                  ) : (
                    holds.map((h) => (
                      <tr key={h.id}>
                        <td>{h.student_name ?? h.student_user_id}</td>
                        <td>{h.hold_type}</td>
                        <td>{h.reason ?? '-'}</td>
                        <td>{h.active ? t('admin.sis.holdActivo') : t('admin.sis.holdLiberado')}</td>
                        <td>
                          {h.active ? (
                            <button className="ghost" onClick={() => void onReleaseHold(h.id)}>
                              {t('admin.sis.liberar')}
                            </button>
                          ) : (
                            '-'
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'audit' && (
          <div className="grid-1">
            <div className="inline-actions" style={{ marginBottom: '12px' }}>
              <input
                placeholder={t('admin.sis.placeholderIdUsuarioEstudiante')}
                value={auditStudentId}
                onChange={(e) => setAuditStudentId(e.target.value)}
                style={{ flex: 1 }}
              />
              <button onClick={() => void onLoadAudit()}>{t('admin.sis.auditar')}</button>
            </div>
            {loadingAudit ? <p>{t('admin.sis.cargando')}</p> : null}
            {audit && (
              <div className="card">
                <h2>{t('admin.sis.auditoriaTitulo')}</h2>
                <p>
                  <strong>{t('admin.sis.labelCumplido')}</strong>{' '}
                  {t('admin.sis.cumplidoValor', {
                    count: audit.totalRequirements,
                    percent: audit.percentComplete,
                    satisfied: audit.satisfiedRequirements
                  })}
                </p>
                <p>
                  <strong>{t('admin.sis.labelCreditos')}</strong> {audit.completedCredits} ·{' '}
                  <strong>{t('admin.sis.labelGpa')}</strong>{' '}
                  {audit.cumulativeGpa ?? t('admin.sis.gpaNoDisponible')}
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>{t('admin.sis.colTipo')}</th>
                      <th>{t('admin.sis.colDescripcion')}</th>
                      <th>{t('admin.sis.colDetalle')}</th>
                      <th>{t('admin.sis.colEstado')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.requirements.length === 0 ? (
                      <tr>
                        <td colSpan={4}>
                          {audit.degreeProgramId
                            ? t('admin.sis.sinRequisitos')
                            : t('admin.sis.sinProgramaGrado')}
                        </td>
                      </tr>
                    ) : (
                      audit.requirements.map((r) => (
                        <tr key={r.id}>
                          <td>{r.requirement_type}</td>
                          <td>{r.description ?? '-'}</td>
                          <td>{r.detail}</td>
                          <td>{r.satisfied ? '✓' : '✗'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </article>
    </section>
  );
}
