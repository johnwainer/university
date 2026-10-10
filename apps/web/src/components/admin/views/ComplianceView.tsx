import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SyllabusEditor, type EditableSyllabus } from './SyllabusEditor';

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

/**
 * Estos mapas guardan CLAVES de i18next, no etiquetas: la vista se traduce en
 * tiempo de render con t(labelKey), de modo que al cambiar de idioma las
 * etiquetas cambian sin recargar. El `value` sigue siendo el identificador que
 * viaja a la API y nunca se traduce.
 */
const AREAS: { value: ComplianceArea; labelKey: string }[] = [
  { value: 'ferpa', labelKey: 'admin.compliance.areas.ferpa' },
  { value: 'ipeds', labelKey: 'admin.compliance.areas.ipeds' },
  { value: 'wcag', labelKey: 'admin.compliance.areas.wcag' },
  { value: 'title_ix', labelKey: 'admin.compliance.areas.titleIx' },
  { value: 'ada', labelKey: 'admin.compliance.areas.ada' },
  { value: 'accreditation', labelKey: 'admin.compliance.areas.accreditation' }
];

const STATUSES: { value: ComplianceStatus; labelKey: string }[] = [
  { value: 'compliant', labelKey: 'admin.compliance.estados.compliant' },
  { value: 'pending', labelKey: 'admin.compliance.estados.pending' },
  { value: 'action_required', labelKey: 'admin.compliance.estados.actionRequired' }
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
  const { t } = useTranslation();
  const [tab, setTab] = useState<ComplianceTab>('syllabus');

  const [templates, setTemplates] = useState<SyllabusTemplate[]>([]);
  const [syllabi, setSyllabi] = useState<Syllabus[]>([]);
  /** Sílabo abierto en el editor de las 24 secciones; null = listado. */
  const [editing, setEditing] = useState<Syllabus | null>(null);
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
      setError(reason instanceof Error ? reason.message : t('admin.compliance.errorCargarSyllabus'));
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
      setError(reason instanceof Error ? reason.message : t('admin.compliance.errorCargarCumplimiento'));
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
      setError(reason instanceof Error ? reason.message : t('admin.compliance.errorCargarReporte'));
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
        setError(t('admin.compliance.errorSeccionesJson'));
        setSavingTemplate(false);
        return;
      }
    }
    try {
      await complianceFetch(sessionToken, '/admin/syllabus/templates', {
        method: 'POST',
        body: { name: templateForm.name, sections }
      });
      setInfo(t('admin.compliance.plantillaCreada'));
      setTemplateForm({ name: '', sectionsJson: '' });
      await loadSyllabusTab(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.compliance.errorCrearPlantilla'));
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
      setInfo(
        template.is_active
          ? t('admin.compliance.plantillaDesactivada')
          : t('admin.compliance.plantillaActivada')
      );
      await loadSyllabusTab(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.compliance.errorActualizarPlantilla'));
    }
  };

  const onDeleteTemplate = async (id: string) => {
    if (!sessionToken || !confirm(t('admin.compliance.confirmEliminarPlantilla'))) return;
    try {
      await complianceFetch(sessionToken, `/admin/syllabus/templates/${id}`, { method: 'DELETE' });
      setInfo(t('admin.compliance.plantillaEliminada'));
      await loadSyllabusTab(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.compliance.errorEliminarPlantilla'));
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
      setInfo(t('admin.compliance.syllabusCreado'));
      setSyllabusForm({ title: '', templateId: '', moodleCourseId: '', degreeProgramId: '', termId: '' });
      await loadSyllabusTab(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.compliance.errorCrearSyllabus'));
    } finally {
      setSavingSyllabus(false);
    }
  };

  const onPublishSyllabus = async (id: string) => {
    if (!sessionToken) return;
    try {
      await complianceFetch(sessionToken, `/admin/syllabi/${id}/publish`, { method: 'POST' });
      setInfo(t('admin.compliance.syllabusPublicado'));
      await loadSyllabusTab(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.compliance.errorPublicarSyllabus'));
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
      setInfo(t('admin.compliance.registroCreado'));
      setRecordForm({ area: 'ferpa', title: '', status: 'pending', detail: '', evidenceUrl: '', period: '' });
      await loadComplianceTab(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.compliance.errorCrearRegistro'));
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
      setInfo(t('admin.compliance.estadoActualizado'));
      await loadComplianceTab(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.compliance.errorActualizarEstado'));
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
      setInfo(t('admin.compliance.accesoRegistrado'));
      setFerpaForm({ subjectUserId: '', resource: '', action: '' });
      await loadComplianceTab(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.compliance.errorRegistrarAcceso'));
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
    return <p>{t('admin.compliance.sinSesion')}</p>;
  }

  return (
    <section className="grid-1">
      <article className="card">
        <div className="inline-actions" style={{ marginBottom: '8px' }}>
          <button className={tab === 'syllabus' ? '' : 'ghost'} onClick={() => setTab('syllabus')}>
            {t('admin.compliance.tabs.syllabus')}
          </button>
          <button className={tab === 'compliance' ? '' : 'ghost'} onClick={() => setTab('compliance')}>
            {t('admin.compliance.tabs.cumplimiento')}
          </button>
          <button className={tab === 'reports' ? '' : 'ghost'} onClick={() => setTab('reports')}>
            {t('admin.compliance.tabs.reportes')}
          </button>
        </div>
        {loading ? <p>{t('admin.compliance.cargando')}</p> : null}
      </article>

      {/* El editor sustituye al listado mientras está abierto: son 24 secciones
          y partir la pantalla las dejaría ilegibles. */}
      {tab === 'syllabus' && editing && sessionToken ? (
        <SyllabusEditor
          token={sessionToken}
          syllabus={editing as unknown as EditableSyllabus}
          onClose={() => {
            setEditing(null);
            void loadSyllabusTab(sessionToken);
          }}
          onSaved={(updated) => {
            setSyllabi((current) =>
              current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item))
            );
            setEditing((current) => (current ? { ...current, ...updated } : current));
          }}
        />
      ) : null}

      {tab === 'syllabus' && !editing && (
        <>
          <article className="card">
            <h2>{t('admin.compliance.crearPlantillaTitulo')}</h2>
            <form className="login-form" onSubmit={onCreateTemplate}>
              <label>{t('admin.compliance.campoNombre')}</label>
              <input
                value={templateForm.name}
                onChange={(e) => setTemplateForm((c) => ({ ...c, name: e.target.value }))}
                placeholder={t('admin.compliance.placeholderNombrePlantilla')}
                required
              />
              <label>{t('admin.compliance.campoSecciones')}</label>
              <textarea
                value={templateForm.sectionsJson}
                onChange={(e) => setTemplateForm((c) => ({ ...c, sectionsJson: e.target.value }))}
                placeholder='[{"key":"course_objectives","label":"Course Objectives","required":true,"defaultContent":"..."}]'
                rows={4}
              />
              <button type="submit" disabled={savingTemplate}>
                {savingTemplate ? t('admin.compliance.guardando') : t('admin.compliance.crearPlantilla')}
              </button>
            </form>
          </article>

          <article className="card scroll-card">
            <h2>{t('admin.compliance.plantillasTitulo', { total: templates.length })}</h2>
            <table>
              <thead>
                <tr>
                  <th>{t('admin.compliance.colNombre')}</th>
                  <th>{t('admin.compliance.colSecciones')}</th>
                  <th>{t('admin.compliance.colEstado')}</th>
                  <th>{t('admin.compliance.colAccion')}</th>
                </tr>
              </thead>
              <tbody>
                {templates.length === 0 ? (
                  <tr>
                    <td colSpan={4}>{t('admin.compliance.sinPlantillas')}</td>
                  </tr>
                ) : (
                  templates.map((template) => (
                    <tr key={template.id}>
                      <td>{template.name}</td>
                      <td>
                        {(template.sections ?? [])
                          .map((s) => `${s.label}${s.required ? '*' : ''}`)
                          .join(', ') || '-'}
                      </td>
                      <td>
                        {template.is_active
                          ? t('admin.compliance.estadoActiva')
                          : t('admin.compliance.estadoInactiva')}
                      </td>
                      <td>
                        <div className="inline-actions">
                          <button className="ghost" onClick={() => void onToggleTemplate(template)}>
                            {template.is_active
                              ? t('admin.compliance.desactivar')
                              : t('admin.compliance.activar')}
                          </button>
                          <button className="ghost danger" onClick={() => void onDeleteTemplate(template.id)}>
                            {t('admin.compliance.eliminar')}
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
            <h2>{t('admin.compliance.crearSyllabusTitulo')}</h2>
            <form className="login-form" onSubmit={onCreateSyllabus}>
              <label>{t('admin.compliance.campoTitulo')}</label>
              <input
                value={syllabusForm.title}
                onChange={(e) => setSyllabusForm((c) => ({ ...c, title: e.target.value }))}
                placeholder={t('admin.compliance.placeholderTituloSyllabus')}
                required
              />
              <label>{t('admin.compliance.campoPlantilla')}</label>
              <select
                value={syllabusForm.templateId}
                onChange={(e) => setSyllabusForm((c) => ({ ...c, templateId: e.target.value }))}
              >
                <option value="">{t('admin.compliance.optionSinPlantilla')}</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
              <label>{t('admin.compliance.campoIdCurso')}</label>
              <input
                type="number"
                value={syllabusForm.moodleCourseId}
                onChange={(e) => setSyllabusForm((c) => ({ ...c, moodleCourseId: e.target.value }))}
                placeholder="123"
              />
              <label>{t('admin.compliance.campoIdPrograma')}</label>
              <input
                value={syllabusForm.degreeProgramId}
                onChange={(e) => setSyllabusForm((c) => ({ ...c, degreeProgramId: e.target.value }))}
                placeholder={t('admin.compliance.placeholderIdPrograma')}
              />
              <label>{t('admin.compliance.campoIdTermino')}</label>
              <input
                value={syllabusForm.termId}
                onChange={(e) => setSyllabusForm((c) => ({ ...c, termId: e.target.value }))}
                placeholder={t('admin.compliance.placeholderIdTermino')}
              />
              <button type="submit" disabled={savingSyllabus}>
                {savingSyllabus ? t('admin.compliance.guardando') : t('admin.compliance.crearSyllabus')}
              </button>
            </form>
          </article>

          <article className="card scroll-card">
            <h2>{t('admin.compliance.syllabiTitulo', { total: syllabi.length })}</h2>
            <table>
              <thead>
                <tr>
                  <th>{t('admin.compliance.colTitulo')}</th>
                  <th>{t('admin.compliance.colCurso')}</th>
                  <th>{t('admin.compliance.colPrograma')}</th>
                  <th>{t('admin.compliance.colTermino')}</th>
                  <th>{t('admin.compliance.colVersion')}</th>
                  <th>{t('admin.compliance.colEstado')}</th>
                  <th>{t('admin.compliance.colAccion')}</th>
                </tr>
              </thead>
              <tbody>
                {syllabi.length === 0 ? (
                  <tr>
                    <td colSpan={7}>{t('admin.compliance.sinSyllabi')}</td>
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
                        <div className="inline-actions">
                          <button className="ghost" onClick={() => setEditing(s)}>
                            {t('admin.compliance.editarSecciones')}
                          </button>
                          {s.status !== 'published' ? (
                            <button className="ghost" onClick={() => void onPublishSyllabus(s.id)}>
                              {t('admin.compliance.publicar')}
                            </button>
                          ) : (
                            <span className="badge">{t('admin.compliance.badgePublicado')}</span>
                          )}
                        </div>
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
            <h2>{t('admin.compliance.estadoPorAreaTitulo')}</h2>
            <div className="grid-like-two" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
              {AREAS.map((area) => {
                const status = statusByArea.get(area.value);
                return (
                  <div
                    key={area.value}
                    style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '8px' }}
                  >
                    <small style={{ color: 'var(--text-muted)' }}>{t(area.labelKey)}</small>
                    <div style={{ fontWeight: 800 }}>
                      {status
                        ? (() => {
                            const match = STATUSES.find((s) => s.value === status);
                            return match ? t(match.labelKey) : status;
                          })()
                        : t('admin.compliance.sinRegistrosArea')}
                    </div>
                  </div>
                );
              })}
            </div>
          </article>

          <article className="card">
            <h2>{t('admin.compliance.nuevoRegistroTitulo')}</h2>
            <form className="login-form" onSubmit={onCreateRecord}>
              <label>{t('admin.compliance.campoArea')}</label>
              <select
                value={recordForm.area}
                onChange={(e) => setRecordForm((c) => ({ ...c, area: e.target.value as ComplianceArea }))}
              >
                {AREAS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {t(a.labelKey)}
                  </option>
                ))}
              </select>
              <label>{t('admin.compliance.campoTitulo')}</label>
              <input
                value={recordForm.title}
                onChange={(e) => setRecordForm((c) => ({ ...c, title: e.target.value }))}
                placeholder={t('admin.compliance.placeholderTituloRegistro')}
                required
              />
              <label>{t('admin.compliance.campoEstado')}</label>
              <select
                value={recordForm.status}
                onChange={(e) => setRecordForm((c) => ({ ...c, status: e.target.value as ComplianceStatus }))}
              >
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {t(s.labelKey)}
                  </option>
                ))}
              </select>
              <label>{t('admin.compliance.campoDetalle')}</label>
              <input
                value={recordForm.detail}
                onChange={(e) => setRecordForm((c) => ({ ...c, detail: e.target.value }))}
                placeholder={t('admin.compliance.placeholderDetalle')}
              />
              <label>{t('admin.compliance.campoEvidencia')}</label>
              <input
                value={recordForm.evidenceUrl}
                onChange={(e) => setRecordForm((c) => ({ ...c, evidenceUrl: e.target.value }))}
                placeholder="https://..."
              />
              <label>{t('admin.compliance.campoPeriodo')}</label>
              <input
                value={recordForm.period}
                onChange={(e) => setRecordForm((c) => ({ ...c, period: e.target.value }))}
                placeholder="2025-2026"
              />
              <button type="submit" disabled={savingRecord}>
                {savingRecord ? t('admin.compliance.guardando') : t('admin.compliance.crearRegistro')}
              </button>
            </form>
          </article>

          <article className="card scroll-card">
            <h2>{t('admin.compliance.registrosTitulo', { total: records.length })}</h2>
            <table>
              <thead>
                <tr>
                  <th>{t('admin.compliance.colArea')}</th>
                  <th>{t('admin.compliance.colTitulo')}</th>
                  <th>{t('admin.compliance.colEstado')}</th>
                  <th>{t('admin.compliance.colPeriodo')}</th>
                  <th>{t('admin.compliance.colEvidencia')}</th>
                  <th>{t('admin.compliance.colAccion')}</th>
                </tr>
              </thead>
              <tbody>
                {records.length === 0 ? (
                  <tr>
                    <td colSpan={6}>{t('admin.compliance.sinRegistros')}</td>
                  </tr>
                ) : (
                  records.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {(() => {
                          const match = AREAS.find((a) => a.value === r.area);
                          return match ? t(match.labelKey) : r.area;
                        })()}
                      </td>
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
                              {t(s.labelKey)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>{r.period ?? '-'}</td>
                      <td>
                        {r.evidence_url ? (
                          <a href={r.evidence_url} target="_blank" rel="noreferrer">
                            {t('admin.compliance.verEvidencia')}
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
            <h2>{t('admin.compliance.registrarAccesoTitulo')}</h2>
            <form className="login-form" onSubmit={onCreateFerpaLog}>
              <label>{t('admin.compliance.campoIdEstudiante')}</label>
              <input
                value={ferpaForm.subjectUserId}
                onChange={(e) => setFerpaForm((c) => ({ ...c, subjectUserId: e.target.value }))}
                placeholder={t('admin.compliance.placeholderIdEstudiante')}
              />
              <label>{t('admin.compliance.campoRecurso')}</label>
              <input
                value={ferpaForm.resource}
                onChange={(e) => setFerpaForm((c) => ({ ...c, resource: e.target.value }))}
                placeholder="transcript / enrollment / ledger"
                required
              />
              <label>{t('admin.compliance.campoAccion')}</label>
              <input
                value={ferpaForm.action}
                onChange={(e) => setFerpaForm((c) => ({ ...c, action: e.target.value }))}
                placeholder="view / export / edit"
                required
              />
              <button type="submit" disabled={savingFerpa}>
                {savingFerpa ? t('admin.compliance.registrando') : t('admin.compliance.registrarAcceso')}
              </button>
            </form>
          </article>

          <article className="card scroll-card">
            <h2>{t('admin.compliance.logFerpaTitulo', { total: ferpaLog.length })}</h2>
            <table>
              <thead>
                <tr>
                  <th>{t('admin.compliance.colFecha')}</th>
                  <th>{t('admin.compliance.colActor')}</th>
                  <th>{t('admin.compliance.colEstudiante')}</th>
                  <th>{t('admin.compliance.colRecurso')}</th>
                  <th>{t('admin.compliance.colAccionFerpa')}</th>
                </tr>
              </thead>
              <tbody>
                {ferpaLog.length === 0 ? (
                  <tr>
                    <td colSpan={5}>{t('admin.compliance.sinAccesos')}</td>
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
          <h2>{t('admin.compliance.reporteTitulo')}</h2>
          {!report ? (
            <p>{t('admin.compliance.cargandoReporte')}</p>
          ) : (
            <div className="grid-1">
              <p style={{ color: 'var(--text-muted)' }}>
                {t('admin.compliance.generado', {
                  fecha: new Date(report.generatedAt).toLocaleString()
                })}
              </p>
              <h3>{t('admin.compliance.institucionTitulo')}</h3>
              <table>
                <tbody>
                  <tr>
                    <th>{t('admin.compliance.colNombre')}</th>
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
                    <th>{t('admin.compliance.acreditadorRegional')}</th>
                    <td>{report.institution.regionalAccreditor || '-'}</td>
                  </tr>
                </tbody>
              </table>

              <h3>{t('admin.compliance.contactosTitulo')}</h3>
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

              <h3>{t('admin.compliance.conteosTitulo')}</h3>
              <table>
                <tbody>
                  <tr>
                    <th>{t('admin.compliance.usuariosTotales')}</th>
                    <td>{report.counts.totalUsers ?? t('admin.compliance.sinDato')}</td>
                  </tr>
                  <tr>
                    <th>{t('admin.compliance.matriculasTotales')}</th>
                    <td>{report.counts.totalEnrollments ?? t('admin.compliance.sinDato')}</td>
                  </tr>
                  <tr>
                    <th>{t('admin.compliance.matriculasActivas')}</th>
                    <td>{report.counts.activeEnrollments ?? t('admin.compliance.sinDato')}</td>
                  </tr>
                  <tr>
                    <th>{t('admin.compliance.matriculasCompletadas')}</th>
                    <td>{report.counts.completedEnrollments ?? t('admin.compliance.sinDato')}</td>
                  </tr>
                  <tr>
                    <th>{t('admin.compliance.programasGrado')}</th>
                    <td>{report.counts.degreePrograms ?? t('admin.compliance.sinDato')}</td>
                  </tr>
                  <tr>
                    <th>{t('admin.compliance.terminosActivos')}</th>
                    <td>{report.counts.activeTerms ?? t('admin.compliance.sinDato')}</td>
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
