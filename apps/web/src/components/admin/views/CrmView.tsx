import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Phase 2 — CRM de admisión + retención (admin view).
 *
 * Self-contained: talks to the `/admin/crm/*` routes directly (these endpoints
 * are not yet in the shared `lib/api.ts` client, which is owned by the
 * orchestrator). Tabs: Pipeline (simple kanban), Contactos (CRUD) and Alertas
 * tempranas.
 */

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api';

type Stage = {
  id: string;
  name: string;
  sort_order: number;
  is_won: boolean;
  is_lost: boolean;
  contact_count: number;
};

type Contact = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  source: string | null;
  stage_id: string | null;
  stage_name: string | null;
  owner_email: string | null;
  lead_score: number;
  status: string | null;
  notes: string | null;
  created_at: string;
};

type Activity = {
  id: string;
  kind: string;
  subject: string | null;
  body: string | null;
  due_date: string | null;
  completed: boolean;
  created_at: string;
};

type EarlyAlert = {
  id: string;
  student_user_id: string | null;
  student_name: string | null;
  student_email: string | null;
  severity: 'low' | 'medium' | 'high';
  reason: string | null;
  signal: string | null;
  resolved: boolean;
  created_at: string;
  resolved_at: string | null;
};

async function crmFetch<T>(
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

type CrmTab = 'pipeline' | 'contacts' | 'alerts';

export function CrmView({
  sessionToken,
  setError,
  setInfo
}: {
  sessionToken: string | null;
  setError: (msg: string | null) => void;
  setInfo: (msg: string | null) => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<CrmTab>('pipeline');

  const [stages, setStages] = useState<Stage[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [alerts, setAlerts] = useState<EarlyAlert[]>([]);
  const [loading, setLoading] = useState(false);

  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);

  const [contactForm, setContactForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    source: '',
    stageId: '',
    ownerEmail: '',
    status: '',
    notes: ''
  });
  const [savingContact, setSavingContact] = useState(false);

  const [activityForm, setActivityForm] = useState({
    kind: 'note' as Activity['kind'],
    subject: '',
    body: '',
    dueDate: ''
  });
  const [savingActivity, setSavingActivity] = useState(false);

  const [alertForm, setAlertForm] = useState({
    studentUserId: '',
    severity: 'low' as EarlyAlert['severity'],
    reason: '',
    signal: ''
  });
  const [savingAlert, setSavingAlert] = useState(false);

  const stageById = useMemo(() => {
    const map = new Map<string, Stage>();
    stages.forEach((s) => map.set(s.id, s));
    return map;
  }, [stages]);

  const loadAll = async (token: string) => {
    setLoading(true);
    try {
      const [pipeline, contactList, alertList] = await Promise.all([
        crmFetch<Stage[]>(token, '/admin/crm/pipeline'),
        crmFetch<Contact[]>(token, '/admin/crm/contacts'),
        crmFetch<EarlyAlert[]>(token, '/admin/crm/early-alerts')
      ]);
      setStages(pipeline);
      setContacts(contactList);
      setAlerts(alertList);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.crm.errorCargarCrm'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (sessionToken) void loadAll(sessionToken);
  }, [sessionToken]);

  const onCreateContact = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionToken) return;
    setSavingContact(true);
    setError(null);
    setInfo(null);
    try {
      await crmFetch(sessionToken, '/admin/crm/contacts', {
        method: 'POST',
        body: {
          fullName: contactForm.fullName,
          email: contactForm.email || undefined,
          phone: contactForm.phone || undefined,
          source: contactForm.source || undefined,
          stageId: contactForm.stageId || undefined,
          ownerEmail: contactForm.ownerEmail || undefined,
          status: contactForm.status || undefined,
          notes: contactForm.notes || undefined
        }
      });
      setInfo(t('admin.crm.contactoCreado'));
      setContactForm({
        fullName: '',
        email: '',
        phone: '',
        source: '',
        stageId: '',
        ownerEmail: '',
        status: '',
        notes: ''
      });
      await loadAll(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.crm.errorCrearContacto'));
    } finally {
      setSavingContact(false);
    }
  };

  const onMoveStage = async (contactId: string, stageId: string) => {
    if (!sessionToken || !stageId) return;
    setError(null);
    try {
      await crmFetch(sessionToken, `/admin/crm/contacts/${contactId}/stage`, {
        method: 'PATCH',
        body: { stageId }
      });
      await loadAll(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.crm.errorMoverContacto'));
    }
  };

  const onDeleteContact = async (contactId: string) => {
    if (!sessionToken || !confirm(t('admin.crm.confirmEliminarContacto'))) return;
    try {
      await crmFetch(sessionToken, `/admin/crm/contacts/${contactId}`, {
        method: 'DELETE'
      });
      setInfo(t('admin.crm.contactoEliminado'));
      if (selectedContactId === contactId) {
        setSelectedContactId(null);
        setActivities([]);
      }
      await loadAll(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.crm.errorEliminarContacto'));
    }
  };

  const onSelectContact = async (contactId: string) => {
    if (!sessionToken) return;
    if (selectedContactId === contactId) {
      setSelectedContactId(null);
      setActivities([]);
      return;
    }
    setSelectedContactId(contactId);
    setActivities([]);
    try {
      const list = await crmFetch<Activity[]>(
        sessionToken,
        `/admin/crm/contacts/${contactId}/activities`
      );
      setActivities(list);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.crm.errorCargarActividad'));
    }
  };

  const onAddActivity = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionToken || !selectedContactId) return;
    setSavingActivity(true);
    try {
      await crmFetch(sessionToken, `/admin/crm/contacts/${selectedContactId}/activities`, {
        method: 'POST',
        body: {
          kind: activityForm.kind,
          subject: activityForm.subject || undefined,
          body: activityForm.body || undefined,
          dueDate: activityForm.dueDate || undefined
        }
      });
      setActivityForm({ kind: 'note', subject: '', body: '', dueDate: '' });
      const list = await crmFetch<Activity[]>(
        sessionToken,
        `/admin/crm/contacts/${selectedContactId}/activities`
      );
      setActivities(list);
      setInfo(t('admin.crm.actividadRegistrada'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.crm.errorRegistrarActividad'));
    } finally {
      setSavingActivity(false);
    }
  };

  const onCreateAlert = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionToken) return;
    setSavingAlert(true);
    setError(null);
    setInfo(null);
    try {
      await crmFetch(sessionToken, '/admin/crm/early-alerts', {
        method: 'POST',
        body: {
          studentUserId: alertForm.studentUserId,
          severity: alertForm.severity,
          reason: alertForm.reason || undefined,
          signal: alertForm.signal || undefined
        }
      });
      setInfo(t('admin.crm.alertaCreada'));
      setAlertForm({ studentUserId: '', severity: 'low', reason: '', signal: '' });
      await loadAll(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.crm.errorCrearAlerta'));
    } finally {
      setSavingAlert(false);
    }
  };

  const onResolveAlert = async (alertId: string) => {
    if (!sessionToken) return;
    try {
      await crmFetch(sessionToken, `/admin/crm/early-alerts/${alertId}/resolve`, {
        method: 'PATCH'
      });
      setInfo(t('admin.crm.alertaResuelta'));
      await loadAll(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.crm.errorResolverAlerta'));
    }
  };

  const orderedStages = useMemo(
    () => [...stages].sort((a, b) => a.sort_order - b.sort_order),
    [stages]
  );

  const contactsByStage = useMemo(() => {
    const map = new Map<string, Contact[]>();
    contacts.forEach((contact) => {
      const key = contact.stage_id ?? 'unassigned';
      const bucket = map.get(key) ?? [];
      bucket.push(contact);
      map.set(key, bucket);
    });
    return map;
  }, [contacts]);

  if (!sessionToken) {
    return <p>{t('admin.crm.sinSesion')}</p>;
  }

  return (
    <section className="grid-1">
      <article className="card">
        <div className="inline-actions" style={{ marginBottom: '8px' }}>
          <button className={tab === 'pipeline' ? '' : 'ghost'} onClick={() => setTab('pipeline')}>
            {t('admin.crm.tabPipeline')}
          </button>
          <button className={tab === 'contacts' ? '' : 'ghost'} onClick={() => setTab('contacts')}>
            {t('admin.crm.tabContactos')}
          </button>
          <button className={tab === 'alerts' ? '' : 'ghost'} onClick={() => setTab('alerts')}>
            {t('admin.crm.tabAlertas')}
          </button>
          {loading ? (
            <span style={{ color: 'var(--text-muted)' }}>{t('admin.crm.cargando')}</span>
          ) : null}
        </div>
      </article>

      {tab === 'pipeline' && (
        <article className="card scroll-card">
          <h2>{t('admin.crm.pipelineTitulo')}</h2>
          <div style={{ display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '8px' }}>
            {orderedStages.map((stage) => {
              const stageContacts = contactsByStage.get(stage.id) ?? [];
              return (
                <div
                  key={stage.id}
                  style={{
                    minWidth: '220px',
                    flex: '0 0 220px',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    padding: '12px',
                    background: 'rgba(255,255,255,0.02)'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <strong>{stage.name}</strong>
                    <span className="badge">{stage.contact_count}</span>
                  </div>
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {stageContacts.length === 0 ? (
                      <small style={{ color: 'var(--text-muted)' }}>{t('admin.crm.sinContactosEtapa')}</small>
                    ) : (
                      stageContacts.map((contact) => (
                        <div
                          key={contact.id}
                          style={{
                            border: '1px solid var(--border-color)',
                            borderRadius: '6px',
                            padding: '8px',
                            fontSize: '0.85rem'
                          }}
                        >
                          <strong style={{ display: 'block' }}>{contact.full_name}</strong>
                          {contact.email ? (
                            <small style={{ color: 'var(--text-muted)' }}>{contact.email}</small>
                          ) : null}
                          <div style={{ marginTop: '6px' }}>
                            <select
                              value={contact.stage_id ?? ''}
                              onChange={(e) => void onMoveStage(contact.id, e.target.value)}
                              style={{ width: '100%', padding: '4px' }}
                            >
                              {orderedStages.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      )}

      {tab === 'contacts' && (
        <>
          <article className="card">
            <h2>{t('admin.crm.nuevoContacto')}</h2>
            <form className="login-form" onSubmit={onCreateContact}>
              <label>{t('admin.crm.campoNombreCompleto')}</label>
              <input
                value={contactForm.fullName}
                onChange={(e) => setContactForm((c) => ({ ...c, fullName: e.target.value }))}
                placeholder={t('admin.crm.placeholderNombreCompleto')}
                required
              />
              <label>{t('admin.crm.campoEmail')}</label>
              <input
                type="email"
                value={contactForm.email}
                onChange={(e) => setContactForm((c) => ({ ...c, email: e.target.value }))}
                placeholder={t('admin.crm.placeholderEmail')}
              />
              <label>{t('admin.crm.campoTelefono')}</label>
              <input
                value={contactForm.phone}
                onChange={(e) => setContactForm((c) => ({ ...c, phone: e.target.value }))}
                placeholder={t('admin.crm.placeholderTelefono')}
              />
              <label>{t('admin.crm.campoOrigen')}</label>
              <input
                value={contactForm.source}
                onChange={(e) => setContactForm((c) => ({ ...c, source: e.target.value }))}
                placeholder={t('admin.crm.placeholderOrigen')}
              />
              <label>{t('admin.crm.campoEtapa')}</label>
              <select
                value={contactForm.stageId}
                onChange={(e) => setContactForm((c) => ({ ...c, stageId: e.target.value }))}
              >
                <option value="">{t('admin.crm.optionSeleccionaEtapa')}</option>
                {orderedStages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <label>{t('admin.crm.campoOwner')}</label>
              <input
                type="email"
                value={contactForm.ownerEmail}
                onChange={(e) => setContactForm((c) => ({ ...c, ownerEmail: e.target.value }))}
                placeholder={t('admin.crm.placeholderOwner')}
              />
              <label>{t('admin.crm.campoEstado')}</label>
              <input
                value={contactForm.status}
                onChange={(e) => setContactForm((c) => ({ ...c, status: e.target.value }))}
                placeholder={t('admin.crm.placeholderEstado')}
              />
              <label>{t('admin.crm.campoNotas')}</label>
              <input
                value={contactForm.notes}
                onChange={(e) => setContactForm((c) => ({ ...c, notes: e.target.value }))}
                placeholder={t('admin.crm.placeholderNotas')}
              />
              <button type="submit" disabled={savingContact}>
                {savingContact ? t('admin.crm.guardando') : t('admin.crm.crearContacto')}
              </button>
            </form>
          </article>

          <article className="card scroll-card">
            <h2>{t('admin.crm.contactosTitulo', { total: contacts.length })}</h2>
            <table>
              <thead>
                <tr>
                  <th>{t('admin.crm.colNombre')}</th>
                  <th>{t('admin.crm.colEmail')}</th>
                  <th>{t('admin.crm.colEtapa')}</th>
                  <th>{t('admin.crm.colOrigen')}</th>
                  <th>{t('admin.crm.colScore')}</th>
                  <th>{t('admin.crm.colAccion')}</th>
                </tr>
              </thead>
              <tbody>
                {contacts.length === 0 ? (
                  <tr>
                    <td colSpan={6}>{t('admin.crm.sinContactos')}</td>
                  </tr>
                ) : (
                  contacts.map((contact) => (
                    <React.Fragment key={contact.id}>
                      <tr>
                        <td>{contact.full_name}</td>
                        <td>{contact.email ?? '-'}</td>
                        <td>{contact.stage_name ?? stageById.get(contact.stage_id ?? '')?.name ?? '-'}</td>
                        <td>{contact.source ?? '-'}</td>
                        <td>{contact.lead_score}</td>
                        <td>
                          <div className="inline-actions">
                            <button className="ghost" onClick={() => void onSelectContact(contact.id)}>
                              {selectedContactId === contact.id
                                ? t('admin.crm.cerrar')
                                : t('admin.crm.actividad')}
                            </button>
                            <button className="ghost danger" onClick={() => void onDeleteContact(contact.id)}>
                              {t('admin.crm.eliminar')}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {selectedContactId === contact.id && (
                        <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                          <td colSpan={6}>
                            <div style={{ padding: '12px', display: 'grid', gap: '12px' }}>
                              <form className="inline-actions" onSubmit={onAddActivity}>
                                <select
                                  value={activityForm.kind}
                                  onChange={(e) =>
                                    setActivityForm((a) => ({ ...a, kind: e.target.value as Activity['kind'] }))
                                  }
                                  style={{ padding: '6px' }}
                                >
                                  <option value="note">{t('admin.crm.actividadNota')}</option>
                                  <option value="email">{t('admin.crm.actividadEmail')}</option>
                                  <option value="call">{t('admin.crm.actividadLlamada')}</option>
                                  <option value="task">{t('admin.crm.actividadTarea')}</option>
                                </select>
                                <input
                                  value={activityForm.subject}
                                  onChange={(e) =>
                                    setActivityForm((a) => ({ ...a, subject: e.target.value }))
                                  }
                                  placeholder={t('admin.crm.placeholderAsunto')}
                                  style={{ padding: '6px' }}
                                />
                                <input
                                  value={activityForm.body}
                                  onChange={(e) => setActivityForm((a) => ({ ...a, body: e.target.value }))}
                                  placeholder={t('admin.crm.placeholderDetalle')}
                                  style={{ padding: '6px', flex: 1 }}
                                />
                                <input
                                  type="date"
                                  value={activityForm.dueDate}
                                  onChange={(e) =>
                                    setActivityForm((a) => ({ ...a, dueDate: e.target.value }))
                                  }
                                  style={{ padding: '6px' }}
                                />
                                <button type="submit" disabled={savingActivity} className="ghost">
                                  {savingActivity ? '...' : t('admin.crm.anadir')}
                                </button>
                              </form>
                              {activities.length === 0 ? (
                                <small style={{ color: 'var(--text-muted)' }}>
                                  {t('admin.crm.sinActividad')}
                                </small>
                              ) : (
                                <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '0.85rem' }}>
                                  {activities.map((act) => (
                                    <li key={act.id} style={{ marginBottom: '4px' }}>
                                      <strong>[{act.kind}]</strong> {act.subject ?? ''}{' '}
                                      {act.body ? `— ${act.body}` : ''}{' '}
                                      <small style={{ color: 'var(--text-muted)' }}>
                                        {new Date(act.created_at).toLocaleString()}
                                      </small>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </article>
        </>
      )}

      {tab === 'alerts' && (
        <>
          <article className="card">
            <h2>{t('admin.crm.nuevaAlerta')}</h2>
            <form className="login-form" onSubmit={onCreateAlert}>
              <label>{t('admin.crm.campoIdEstudiante')}</label>
              <input
                value={alertForm.studentUserId}
                onChange={(e) => setAlertForm((a) => ({ ...a, studentUserId: e.target.value }))}
                placeholder={t('admin.crm.placeholderIdEstudiante')}
                required
              />
              <label>{t('admin.crm.campoSeveridad')}</label>
              <select
                value={alertForm.severity}
                onChange={(e) =>
                  setAlertForm((a) => ({ ...a, severity: e.target.value as EarlyAlert['severity'] }))
                }
              >
                <option value="low">{t('admin.crm.severidadBaja')}</option>
                <option value="medium">{t('admin.crm.severidadMedia')}</option>
                <option value="high">{t('admin.crm.severidadAlta')}</option>
              </select>
              <label>{t('admin.crm.campoMotivo')}</label>
              <input
                value={alertForm.reason}
                onChange={(e) => setAlertForm((a) => ({ ...a, reason: e.target.value }))}
                placeholder={t('admin.crm.placeholderMotivo')}
              />
              <label>{t('admin.crm.campoSenal')}</label>
              <input
                value={alertForm.signal}
                onChange={(e) => setAlertForm((a) => ({ ...a, signal: e.target.value }))}
                placeholder={t('admin.crm.placeholderSenal')}
              />
              <button type="submit" disabled={savingAlert}>
                {savingAlert ? t('admin.crm.guardando') : t('admin.crm.crearAlerta')}
              </button>
            </form>
          </article>

          <article className="card scroll-card">
            <h2>{t('admin.crm.alertasTitulo', { total: alerts.length })}</h2>
            <table>
              <thead>
                <tr>
                  <th>{t('admin.crm.colEstudiante')}</th>
                  <th>{t('admin.crm.colSeveridad')}</th>
                  <th>{t('admin.crm.colMotivo')}</th>
                  <th>{t('admin.crm.colSenal')}</th>
                  <th>{t('admin.crm.colEstado')}</th>
                  <th>{t('admin.crm.colAccion')}</th>
                </tr>
              </thead>
              <tbody>
                {alerts.length === 0 ? (
                  <tr>
                    <td colSpan={6}>{t('admin.crm.sinAlertas')}</td>
                  </tr>
                ) : (
                  alerts.map((alert) => (
                    <tr key={alert.id}>
                      <td>{alert.student_name ?? alert.student_email ?? alert.student_user_id ?? '-'}</td>
                      <td>{alert.severity}</td>
                      <td>{alert.reason ?? '-'}</td>
                      <td>{alert.signal ?? '-'}</td>
                      <td>
                        {alert.resolved ? t('admin.crm.alertaEstadoResuelta') : t('admin.crm.alertaEstadoAbierta')}
                      </td>
                      <td>
                        {alert.resolved ? (
                          <span style={{ color: 'var(--text-muted)' }}>
                            {alert.resolved_at ? new Date(alert.resolved_at).toLocaleDateString() : '-'}
                          </span>
                        ) : (
                          <button className="ghost" onClick={() => void onResolveAlert(alert.id)}>
                            {t('admin.crm.resolver')}
                          </button>
                        )}
                      </td>
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
