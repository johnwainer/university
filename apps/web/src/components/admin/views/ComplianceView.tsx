import React, { useEffect, useMemo, useState } from 'react';

/**
 * Phase 3 — Syllabus + Compliance (admin view).
 *
 * Self-contained: talks to the `/admin/syllabus/*` and `/admin/compliance/*`
 * routes directly (these endpoints are not yet in the shared `lib/api.ts`
 * client, which is owned by the orchestrator). Tabs: Syllabus (templates +
 * syllabi with publish), Cumplimiento (records by area + FERPA log) and
 * IPEDS/Reportes.
 */

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api';

type TemplateSection = {
  key: string;
  label: string;
  required?: boolean;
  defaultContent?: string;
};

type SyllabusTemplate = {
  id: string;
  tenant_id: string | null;
  name: string;
  sections: TemplateSection[];
  is_active: boolean;
  created_at: string;
};

type Syllabus = {
  id: string;
  moodle_course_id: number | null;
  degree_program_id: string | null;
  term_id: string | null;
  template_id: string | null;
  template_name: string | null;
  course_name: string | null;
  program_name: string | null;
  term_name: string | null;
  title: string;
  content: Record<string, unknown>;
  version: number;
  status: 'draft' | 'published' | 'archived';
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

type ComplianceArea = 'ferpa' | 'ipeds' | 'wcag' | 'title_ix' | 'ada' | 'accreditation';
type ComplianceStatus = 'compliant' | 'pending' | 'action_required';

type ComplianceRecord = {
  id: string;
  area: ComplianceArea;
  title: string;
  status: ComplianceStatus;
  detail: string | null;
  evidence_url: string | null;
  period: string | null;
  created_at: string;
};

type FerpaLogEntry = {
  id: string;
  actor_email: string;
  subject_user_id: string | null;
  subject_name: string | null;
  subject_email: string | null;
  resource: string;
  action: string;
  created_at: string;
};

type IpedsReport = {
  generatedAt: string;
  institution: {
    name: string;
    ncesId: string;
    ipedsCode: string;
    stateAuthorizationId: string;
    regionalAccreditor: string;
  };
  compliance: {
    ferpaOfficerEmail: string;
    titleIxCoordinatorEmail: string;
    adaCoordinatorEmail: string;
  };
  counts: {
    totalUsers: number | null;
    totalEnrollments: number | null;
    activeEnrollments: number | null;
    completedEnrollments: number | null;
    degreePrograms: number | null;
    activeTerms: number | null;
  };
};

const AREAS: { value: ComplianceArea; label: string }[] = [
  { value: 'ferpa', label: 'FERPA' },
  { value: 'ipeds', label: 'IPEDS' },
  { value: 'wcag', label: 'WCAG' },
  { value: 'title_ix', label: 'Title IX' },
  { value: 'ada', label: 'ADA' },
  { value: 'accreditation', label: 'Acreditación' }
];

const STATUSES: { value: ComplianceStatus; label: string }[] = [
  { value: 'compliant', label: 'Cumple' },
  { value: 'pending', label: 'Pendiente' },
  { value: 'action_required', label: 'Acción requerida' }
];

async function complianceFetch<T>(
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

type ComplianceTab = 'syllabus' | 'compliance' | 'reports';

export function ComplianceView({
  sessionToken,
  setError,
  setInfo
}: {
  sessionToken: string | null;
  setError: (msg: string | null) => void;
  setInfo: (msg: string | null) => void;
}) {
  const [tab, setTab] = useState<ComplianceTab>('syllabus');

  const [templates, setTemplates] = useState<SyllabusTemplate[]>([]);
  const [syllabi, setSyllabi] = useState<Syllabus[]>([]);
  const [records, setRecords] = useState<ComplianceRecord[]>([]);
  const [ferpaLog, setFerpaLog] = useState<FerpaLogEntry[]>([]);
  const [report, setReport] = useState<IpedsReport | null>(null);
  const [loading, setLoading] = useState(false);

  const [templateForm, setTemplateForm] = useState({ name: '', sectionsJson: '' });
  const [savingTemplate, setSavingTemplate] = useState(false);

  const [syllabusForm, setSyllabusForm] = useState({
    title: '',
    templateId: '',
    moodleCourseId: '',
    degreeProgramId: '',
    termId: ''
  });
  const [savingSyllabus, setSavingSyllabus] = useState(false);

  const [recordForm, setRecordForm] = useState({
    area: 'ferpa' as ComplianceArea,
    title: '',
    status: 'pending' as ComplianceStatus,
    detail: '',
    evidenceUrl: '',
    period: ''
  });
  const [savingRecord, setSavingRecord] = useState(false);

  const [ferpaForm, setFerpaForm] = useState({
    subjectUserId: '',
    resource: '',
    action: ''
  });
  const [savingFerpa, setSavingFerpa] = useState(false);

  const loadSyllabusTab = async (token: string) => {
    setLoading(true);
    try {
      const [tmpl, syl] = await Promise.all([
        complianceFetch<SyllabusTemplate[]>(token, '/admin/syllabus/templates'),
        complianceFetch<Syllabus[]>(token, '/admin/syllabi')
      ]);
      setTemplates(tmpl);
      setSyllabi(syl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Error cargando syllabus');
    } finally {
      setLoading(false);
    }
  };

  const loadComplianceTab = async (token: string) => {
    setLoading(true);
    try {
      const [recs, log] = await Promise.all([
        complianceFetch<ComplianceRecord[]>(token, '/admin/compliance/records'),
        complianceFetch<FerpaLogEntry[]>(token, '/admin/compliance/ferpa-log')
      ]);
      setRecords(recs);
      setFerpaLog(log);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Error cargando cumplimiento');
    } finally {
      setLoading(false);
    }
  };

  const loadReportTab = async (token: string) => {
    setLoading(true);
    try {
      const data = await complianceFetch<IpedsReport>(token, '/admin/compliance/ipeds-report');
      setReport(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Error cargando reporte IPEDS');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!sessionToken) return;
    if (tab === 'syllabus') void loadSyllabusTab(sessionToken);
    else if (tab === 'compliance') void loadComplianceTab(sessionToken);
    else void loadReportTab(sessionToken);
  }, [sessionToken, tab]);

  // --- Templates -------------------------------------------------------------
  const onCreateTemplate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionToken) return;
    setSavingTemplate(true);
    setError(null);
    setInfo(null);
    let sections: TemplateSection[] | undefined;
    if (templateForm.sectionsJson.trim()) {
      try {
        sections = JSON.parse(templateForm.sectionsJson) as TemplateSection[];
      } catch {
        setError('Las secciones deben ser un JSON válido (array de {key,label,required,defaultContent}).');
        setSavingTemplate(false);
        return;
      }
    }
    try {
      await complianceFetch(sessionToken, '/admin/syllabus/templates', {
        method: 'POST',
        body: { name: templateForm.name, sections }
      });
      setInfo('Plantilla creada.');
      setTemplateForm({ name: '', sectionsJson: '' });
      await loadSyllabusTab(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo crear la plantilla');
    } finally {
      setSavingTemplate(false);
    }
  };

  const onToggleTemplate = async (template: SyllabusTemplate) => {
    if (!sessionToken) return;
    try {
      await complianceFetch(sessionToken, `/admin/syllabus/templates/${template.id}`, {
        method: 'PATCH',
        body: { isActive: !template.is_active }
      });
      setInfo(template.is_active ? 'Plantilla desactivada.' : 'Plantilla activada.');
      await loadSyllabusTab(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo actualizar la plantilla');
    }
  };

  const onDeleteTemplate = async (id: string) => {
    if (!sessionToken || !confirm('¿Eliminar esta plantilla?')) return;
    try {
      await complianceFetch(sessionToken, `/admin/syllabus/templates/${id}`, { method: 'DELETE' });
      setInfo('Plantilla eliminada.');
      await loadSyllabusTab(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo eliminar la plantilla');
    }
  };

  // --- Syllabi ---------------------------------------------------------------
  const onCreateSyllabus = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionToken) return;
    setSavingSyllabus(true);
    setError(null);
    setInfo(null);
    try {
      await complianceFetch(sessionToken, '/admin/syllabi', {
        method: 'POST',
        body: {
          title: syllabusForm.title,
          templateId: syllabusForm.templateId || undefined,
          moodleCourseId: syllabusForm.moodleCourseId
            ? Number(syllabusForm.moodleCourseId)
            : undefined,
          degreeProgramId: syllabusForm.degreeProgramId || undefined,
          termId: syllabusForm.termId || undefined
        }
      });
      setInfo('Syllabus creado en borrador.');
      setSyllabusForm({ title: '', templateId: '', moodleCourseId: '', degreeProgramId: '', termId: '' });
      await loadSyllabusTab(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo crear el syllabus');
    } finally {
      setSavingSyllabus(false);
    }
  };

  const onPublishSyllabus = async (id: string) => {
    if (!sessionToken) return;
    try {
      await complianceFetch(sessionToken, `/admin/syllabi/${id}/publish`, { method: 'POST' });
      setInfo('Syllabus publicado (secciones obligatorias autocompletadas).');
      await loadSyllabusTab(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo publicar el syllabus');
    }
  };

  // --- Compliance records ----------------------------------------------------
  const onCreateRecord = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionToken) return;
    setSavingRecord(true);
    setError(null);
    setInfo(null);
    try {
      await complianceFetch(sessionToken, '/admin/compliance/records', {
        method: 'POST',
        body: {
          area: recordForm.area,
          title: recordForm.title,
          status: recordForm.status,
          detail: recordForm.detail || undefined,
          evidenceUrl: recordForm.evidenceUrl || undefined,
          period: recordForm.period || undefined
        }
      });
      setInfo('Registro de cumplimiento creado.');
      setRecordForm({ area: 'ferpa', title: '', status: 'pending', detail: '', evidenceUrl: '', period: '' });
      await loadComplianceTab(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo crear el registro');
    } finally {
      setSavingRecord(false);
    }
  };

  const onUpdateRecordStatus = async (id: string, status: ComplianceStatus) => {
    if (!sessionToken) return;
    try {
      await complianceFetch(sessionToken, `/admin/compliance/records/${id}`, {
        method: 'PATCH',
        body: { status }
      });
      setInfo('Estado actualizado.');
      await loadComplianceTab(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo actualizar el estado');
    }
  };

  // --- FERPA log -------------------------------------------------------------
  const onCreateFerpaLog = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionToken) return;
    setSavingFerpa(true);
    setError(null);
    setInfo(null);
    try {
      await complianceFetch(sessionToken, '/admin/compliance/ferpa-log', {
        method: 'POST',
        body: {
          subjectUserId: ferpaForm.subjectUserId || undefined,
          resource: ferpaForm.resource,
          action: ferpaForm.action
        }
      });
      setInfo('Acceso registrado en el log FERPA.');
      setFerpaForm({ subjectUserId: '', resource: '', action: '' });
      await loadComplianceTab(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo registrar el acceso');
    } finally {
      setSavingFerpa(false);
    }
  };

  const statusByArea = useMemo(() => {
    const map = new Map<ComplianceArea, ComplianceStatus>();
    // Worst status wins per area: action_required > pending > compliant.
    const rank: Record<ComplianceStatus, number> = {
      action_required: 2,
      pending: 1,
      compliant: 0
    };
    records.forEach((r) => {
      const current = map.get(r.area);
      if (!current || rank[r.status] > rank[current]) {
        map.set(r.area, r.status);
      }
    });
    return map;
  }, [records]);

  if (!sessionToken) {
    return <p>Inicia sesión para gestionar el cumplimiento.</p>;
  }

  return (
    <section className="grid-1">
      <article className="card">
        <div className="inline-actions" style={{ marginBottom: '8px' }}>
          <button className={tab === 'syllabus' ? '' : 'ghost'} onClick={() => setTab('syllabus')}>
            Syllabus
          </button>
          <button className={tab === 'compliance' ? '' : 'ghost'} onClick={() => setTab('compliance')}>
            Cumplimiento
          </button>
          <button className={tab === 'reports' ? '' : 'ghost'} onClick={() => setTab('reports')}>
            IPEDS/Reportes
          </button>
        </div>
        {loading ? <p>Cargando...</p> : null}
      </article>

      {tab === 'syllabus' && (
        <>
          <article className="card">
            <h2>Crear plantilla</h2>
            <form className="login-form" onSubmit={onCreateTemplate}>
              <label>Nombre</label>
              <input
                value={templateForm.name}
                onChange={(e) => setTemplateForm((c) => ({ ...c, name: e.target.value }))}
                placeholder="Plantilla de cumplimiento"
                required
              />
              <label>Secciones (JSON opcional)</label>
              <textarea
                value={templateForm.sectionsJson}
                onChange={(e) => setTemplateForm((c) => ({ ...c, sectionsJson: e.target.value }))}
                placeholder='[{"key":"course_objectives","label":"Course Objectives","required":true,"defaultContent":"..."}]'
                rows={4}
              />
              <button type="submit" disabled={savingTemplate}>
                {savingTemplate ? 'Guardando...' : 'Crear plantilla'}
              </button>
            </form>
          </article>

          <article className="card scroll-card">
            <h2>Plantillas ({templates.length})</h2>
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Secciones</th>
                  <th>Estado</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {templates.length === 0 ? (
                  <tr>
                    <td colSpan={4}>No hay plantillas.</td>
                  </tr>
                ) : (
                  templates.map((t) => (
                    <tr key={t.id}>
                      <td>{t.name}</td>
                      <td>
                        {(t.sections ?? [])
                          .map((s) => `${s.label}${s.required ? '*' : ''}`)
                          .join(', ') || '-'}
                      </td>
                      <td>{t.is_active ? 'activa' : 'inactiva'}</td>
                      <td>
                        <div className="inline-actions">
                          <button className="ghost" onClick={() => void onToggleTemplate(t)}>
                            {t.is_active ? 'Desactivar' : 'Activar'}
                          </button>
                          <button className="ghost danger" onClick={() => void onDeleteTemplate(t.id)}>
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </article>

          <article className="card">
            <h2>Crear syllabus</h2>
            <form className="login-form" onSubmit={onCreateSyllabus}>
              <label>Título</label>
              <input
                value={syllabusForm.title}
                onChange={(e) => setSyllabusForm((c) => ({ ...c, title: e.target.value }))}
                placeholder="Introducción a la Programación — Otoño 2026"
                required
              />
              <label>Plantilla</label>
              <select
                value={syllabusForm.templateId}
                onChange={(e) => setSyllabusForm((c) => ({ ...c, templateId: e.target.value }))}
              >
                <option value="">Sin plantilla</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <label>ID Curso Moodle (opcional)</label>
              <input
                type="number"
                value={syllabusForm.moodleCourseId}
                onChange={(e) => setSyllabusForm((c) => ({ ...c, moodleCourseId: e.target.value }))}
                placeholder="123"
              />
              <label>ID Programa (opcional)</label>
              <input
                value={syllabusForm.degreeProgramId}
                onChange={(e) => setSyllabusForm((c) => ({ ...c, degreeProgramId: e.target.value }))}
                placeholder="uuid del degree program"
              />
              <label>ID Término (opcional)</label>
              <input
                value={syllabusForm.termId}
                onChange={(e) => setSyllabusForm((c) => ({ ...c, termId: e.target.value }))}
                placeholder="uuid del academic term"
              />
              <button type="submit" disabled={savingSyllabus}>
                {savingSyllabus ? 'Guardando...' : 'Crear syllabus'}
              </button>
            </form>
          </article>

          <article className="card scroll-card">
            <h2>Syllabi ({syllabi.length})</h2>
            <table>
              <thead>
                <tr>
                  <th>Título</th>
                  <th>Curso</th>
                  <th>Programa</th>
                  <th>Término</th>
                  <th>Versión</th>
                  <th>Estado</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {syllabi.length === 0 ? (
                  <tr>
                    <td colSpan={7}>No hay syllabi.</td>
                  </tr>
                ) : (
                  syllabi.map((s) => (
                    <tr key={s.id}>
                      <td>{s.title}</td>
                      <td>{s.course_name ?? (s.moodle_course_id ?? '-')}</td>
                      <td>{s.program_name ?? '-'}</td>
                      <td>{s.term_name ?? '-'}</td>
                      <td>v{s.version}</td>
                      <td>{s.status}</td>
                      <td>
                        {s.status !== 'published' ? (
                          <button className="ghost" onClick={() => void onPublishSyllabus(s.id)}>
                            Publicar
                          </button>
                        ) : (
                          <span className="badge">publicado</span>
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

      {tab === 'compliance' && (
        <>
          <article className="card scroll-card">
            <h2>Estado por área</h2>
            <div className="grid-like-two" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
              {AREAS.map((area) => {
                const status = statusByArea.get(area.value);
                return (
                  <div
                    key={area.value}
                    style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '8px' }}
                  >
                    <small style={{ color: 'var(--text-muted)' }}>{area.label}</small>
                    <div style={{ fontWeight: 800 }}>
                      {status
                        ? STATUSES.find((s) => s.value === status)?.label ?? status
                        : 'Sin registros'}
                    </div>
                  </div>
                );
              })}
            </div>
          </article>

          <article className="card">
            <h2>Nuevo registro de cumplimiento</h2>
            <form className="login-form" onSubmit={onCreateRecord}>
              <label>Área</label>
              <select
                value={recordForm.area}
                onChange={(e) => setRecordForm((c) => ({ ...c, area: e.target.value as ComplianceArea }))}
              >
                {AREAS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
              <label>Título</label>
              <input
                value={recordForm.title}
                onChange={(e) => setRecordForm((c) => ({ ...c, title: e.target.value }))}
                placeholder="Revisión anual FERPA"
                required
              />
              <label>Estado</label>
              <select
                value={recordForm.status}
                onChange={(e) => setRecordForm((c) => ({ ...c, status: e.target.value as ComplianceStatus }))}
              >
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <label>Detalle</label>
              <input
                value={recordForm.detail}
                onChange={(e) => setRecordForm((c) => ({ ...c, detail: e.target.value }))}
                placeholder="Descripción / notas"
              />
              <label>URL de evidencia</label>
              <input
                value={recordForm.evidenceUrl}
                onChange={(e) => setRecordForm((c) => ({ ...c, evidenceUrl: e.target.value }))}
                placeholder="https://..."
              />
              <label>Periodo</label>
              <input
                value={recordForm.period}
                onChange={(e) => setRecordForm((c) => ({ ...c, period: e.target.value }))}
                placeholder="2025-2026"
              />
              <button type="submit" disabled={savingRecord}>
                {savingRecord ? 'Guardando...' : 'Crear registro'}
              </button>
            </form>
          </article>

          <article className="card scroll-card">
            <h2>Registros de cumplimiento ({records.length})</h2>
            <table>
              <thead>
                <tr>
                  <th>Área</th>
                  <th>Título</th>
                  <th>Estado</th>
                  <th>Periodo</th>
                  <th>Evidencia</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {records.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No hay registros.</td>
                  </tr>
                ) : (
                  records.map((r) => (
                    <tr key={r.id}>
                      <td>{AREAS.find((a) => a.value === r.area)?.label ?? r.area}</td>
                      <td>{r.title}</td>
                      <td>
                        <select
                          value={r.status}
                          onChange={(e) =>
                            void onUpdateRecordStatus(r.id, e.target.value as ComplianceStatus)
                          }
                        >
                          {STATUSES.map((s) => (
                            <option key={s.value} value={s.value}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>{r.period ?? '-'}</td>
                      <td>
                        {r.evidence_url ? (
                          <a href={r.evidence_url} target="_blank" rel="noreferrer">
                            ver
                          </a>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td>{new Date(r.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </article>

          <article className="card">
            <h2>Registrar acceso (FERPA)</h2>
            <form className="login-form" onSubmit={onCreateFerpaLog}>
              <label>ID de estudiante (subject)</label>
              <input
                value={ferpaForm.subjectUserId}
                onChange={(e) => setFerpaForm((c) => ({ ...c, subjectUserId: e.target.value }))}
                placeholder="user id"
              />
              <label>Recurso</label>
              <input
                value={ferpaForm.resource}
                onChange={(e) => setFerpaForm((c) => ({ ...c, resource: e.target.value }))}
                placeholder="transcript / enrollment / ledger"
                required
              />
              <label>Acción</label>
              <input
                value={ferpaForm.action}
                onChange={(e) => setFerpaForm((c) => ({ ...c, action: e.target.value }))}
                placeholder="view / export / edit"
                required
              />
              <button type="submit" disabled={savingFerpa}>
                {savingFerpa ? 'Registrando...' : 'Registrar acceso'}
              </button>
            </form>
          </article>

          <article className="card scroll-card">
            <h2>Log de acceso FERPA ({ferpaLog.length})</h2>
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Actor</th>
                  <th>Estudiante</th>
                  <th>Recurso</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {ferpaLog.length === 0 ? (
                  <tr>
                    <td colSpan={5}>Sin accesos registrados.</td>
                  </tr>
                ) : (
                  ferpaLog.map((l) => (
                    <tr key={l.id}>
                      <td>{new Date(l.created_at).toLocaleString()}</td>
                      <td>{l.actor_email}</td>
                      <td>{l.subject_name ?? l.subject_email ?? l.subject_user_id ?? '-'}</td>
                      <td>{l.resource}</td>
                      <td>{l.action}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </article>
        </>
      )}

      {tab === 'reports' && (
        <article className="card scroll-card">
          <h2>Reporte IPEDS / NCES</h2>
          {!report ? (
            <p>Cargando reporte...</p>
          ) : (
            <div className="grid-1">
              <p style={{ color: 'var(--text-muted)' }}>
                Generado: {new Date(report.generatedAt).toLocaleString()}
              </p>
              <h3>Institución</h3>
              <table>
                <tbody>
                  <tr>
                    <th>Nombre</th>
                    <td>{report.institution.name || '-'}</td>
                  </tr>
                  <tr>
                    <th>NCES ID</th>
                    <td>{report.institution.ncesId || '-'}</td>
                  </tr>
                  <tr>
                    <th>IPEDS Code</th>
                    <td>{report.institution.ipedsCode || '-'}</td>
                  </tr>
                  <tr>
                    <th>State Authorization</th>
                    <td>{report.institution.stateAuthorizationId || '-'}</td>
                  </tr>
                  <tr>
                    <th>Acreditador regional</th>
                    <td>{report.institution.regionalAccreditor || '-'}</td>
                  </tr>
                </tbody>
              </table>

              <h3>Contactos de cumplimiento</h3>
              <table>
                <tbody>
                  <tr>
                    <th>FERPA Officer</th>
                    <td>{report.compliance.ferpaOfficerEmail || '-'}</td>
                  </tr>
                  <tr>
                    <th>Title IX Coordinator</th>
                    <td>{report.compliance.titleIxCoordinatorEmail || '-'}</td>
                  </tr>
                  <tr>
                    <th>ADA Coordinator</th>
                    <td>{report.compliance.adaCoordinatorEmail || '-'}</td>
                  </tr>
                </tbody>
              </table>

              <h3>Conteos</h3>
              <table>
                <tbody>
                  <tr>
                    <th>Usuarios totales</th>
                    <td>{report.counts.totalUsers ?? 'n/d'}</td>
                  </tr>
                  <tr>
                    <th>Matrículas totales</th>
                    <td>{report.counts.totalEnrollments ?? 'n/d'}</td>
                  </tr>
                  <tr>
                    <th>Matrículas activas</th>
                    <td>{report.counts.activeEnrollments ?? 'n/d'}</td>
                  </tr>
                  <tr>
                    <th>Matrículas completadas</th>
                    <td>{report.counts.completedEnrollments ?? 'n/d'}</td>
                  </tr>
                  <tr>
                    <th>Programas de grado</th>
                    <td>{report.counts.degreePrograms ?? 'n/d'}</td>
                  </tr>
                  <tr>
                    <th>Términos activos</th>
                    <td>{report.counts.activeTerms ?? 'n/d'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </article>
      )}
    </section>
  );
}
