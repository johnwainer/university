import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

/**
 * Etapa I — Checklist CIE: repositorio de evidencia y estado documental.
 *
 * Criterio contractual: esta vista entrega **estado operativo binario** —qué
 * evidencia existe y cuál falta— no analítica de indicadores. No hay librería
 * de gráficos aquí a propósito; los tableros con volúmenes, tasas y tendencias
 * corresponden a la Etapa V.
 *
 * Es una vista nueva y separada de `ComplianceView.tsx`, que resuelve otra
 * cosa (plantillas de syllabus, `compliance_records` por área, log FERPA e
 * informe IPEDS). Las dos conviven.
 *
 * Autocontenida, igual que el resto de las vistas admin de esta rama: habla
 * directo con `/admin/cie/*` y `/admin/contact-messages` en vez de pasar por
 * `lib/api.ts`, que es del orquestador.
 */

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api';

type DocumentScope = 'institutional' | 'program' | 'faculty';
type DocumentStatus = 'draft' | 'in_review' | 'approved' | 'rejected';
type ChecklistSignal = 'green' | 'amber' | 'red';
type ContactStatus = 'new' | 'in_progress' | 'closed' | 'spam';
type FacultyDegreeLevel = 'bachelor' | 'master' | 'doctoral' | 'professional' | 'other';

type ChecklistGap = {
  scope: DocumentScope;
  targetId: string | null;
  targetLabel: string;
  state: 'missing' | DocumentStatus | 'expired';
};

type ChecklistItem = {
  documentTypeId: string;
  documentTypeCode: string;
  nameEs: string;
  nameEn: string;
  helpEs: string | null;
  helpEn: string | null;
  scope: DocumentScope;
  cieRequired: boolean;
  displayOrder: number;
  expected: number;
  approved: number;
  pending: number;
  expired: number;
  missing: number;
  signal: ChecklistSignal;
  gaps: ChecklistGap[];
};

type ChecklistSection = {
  scope: DocumentScope;
  titleEs: string;
  titleEn: string;
  items: ChecklistItem[];
  signal: ChecklistSignal;
};

type CieChecklistResponse = {
  generatedAt: string;
  summary: {
    totalRequired: number;
    totalApproved: number;
    totalPending: number;
    totalExpired: number;
    totalMissing: number;
    completionPercent: number;
    signal: ChecklistSignal;
    cieReady: boolean;
  };
  sections: ChecklistSection[];
  counters: {
    programs: number;
    activePrograms: number;
    facultyRecords: number;
    activeFacultyRecords: number;
    documents: number;
    approvedDocuments: number;
    expiringSoon: number;
  };
};

type CieDocumentType = {
  id: string;
  code: string;
  nameEs: string;
  nameEn: string;
  scope: DocumentScope;
  cieRequired: boolean;
  displayOrder: number;
  helpEs: string | null;
  helpEn: string | null;
  isActive: boolean;
};

type CieDocument = {
  id: string;
  documentTypeId: string;
  programId: string | null;
  facultyId: string | null;
  title: string;
  fileUrl: string | null;
  version: string;
  status: DocumentStatus;
  effectiveDate: string | null;
  expiresAt: string | null;
  notes: string | null;
  documentTypeCode: string;
  documentTypeNameEs: string;
  documentTypeScope: DocumentScope;
  cieRequired: boolean;
  programCode: string | null;
  programName: string | null;
  facultyFullName: string | null;
  isExpired: boolean;
};

type FacultyRecord = {
  id: string;
  fullName: string;
  email: string;
  programId: string | null;
  credentials: string | null;
  degreeLevel: FacultyDegreeLevel | null;
  status: 'active' | 'inactive' | 'candidate';
  programCode: string | null;
  programName: string | null;
  requiredDocuments: number;
  approvedDocuments: number;
  missingDocumentCodes: string[];
};

type ContactMessage = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  programCode: string | null;
  subject: string | null;
  message: string;
  locale: string;
  status: ContactStatus;
  handledBy: string | null;
  createdAt: string;
};

/** Fila de `/admin/degree-programs`, que devuelve snake_case tal cual. */
type DegreeProgramRow = {
  id: string;
  name: string;
  code: string;
  degree_level: string;
  is_active: boolean;
};

/**
 * Estos mapas ya no guardan el texto en español sino la CLAVE i18next que lo
 * resuelve: así un cambio de idioma se refleja al volver a pintar, sin
 * recargar ni duplicar los mapas por idioma. La clave del propio mapa
 * (`green`, `draft`, `in_review`...) es el identificador que viene de la API y
 * nunca se traduce; solo su etiqueta visible pasa por t(...).
 *
 * Etiquetas de texto del semáforo. El color NUNCA es el único portador del
 * estado: cada señal va acompañada de su etiqueta, para cumplir WCAG 2.1 AA.
 */
const SIGNAL_LABEL_KEY: Record<ChecklistSignal, string> = {
  green: 'admin.cie.senal.green',
  amber: 'admin.cie.senal.amber',
  red: 'admin.cie.senal.red'
};

const SCOPE_LABEL_KEY: Record<DocumentScope, string> = {
  institutional: 'admin.cie.ambito.institutional',
  program: 'admin.cie.ambito.program',
  faculty: 'admin.cie.ambito.faculty'
};

const DOCUMENT_STATUS_LABEL_KEY: Record<DocumentStatus, string> = {
  draft: 'admin.cie.estadoDocumento.draft',
  in_review: 'admin.cie.estadoDocumento.inReview',
  approved: 'admin.cie.estadoDocumento.approved',
  rejected: 'admin.cie.estadoDocumento.rejected'
};

const CONTACT_STATUS_LABEL_KEY: Record<ContactStatus, string> = {
  new: 'admin.cie.estadoContacto.new',
  in_progress: 'admin.cie.estadoContacto.inProgress',
  closed: 'admin.cie.estadoContacto.closed',
  spam: 'admin.cie.estadoContacto.spam'
};

const DEGREE_LEVEL_LABEL_KEY: Record<FacultyDegreeLevel, string> = {
  bachelor: 'admin.cie.grado.bachelor',
  master: 'admin.cie.grado.master',
  doctoral: 'admin.cie.grado.doctoral',
  professional: 'admin.cie.grado.professional',
  other: 'admin.cie.grado.other'
};

const GAP_STATE_LABEL_KEY: Record<string, string> = {
  missing: 'admin.cie.brecha.missing',
  draft: 'admin.cie.brecha.draft',
  in_review: 'admin.cie.brecha.inReview',
  rejected: 'admin.cie.brecha.rejected',
  expired: 'admin.cie.brecha.expired',
  approved: 'admin.cie.brecha.approved'
};

async function cieFetch<T>(
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
      // se conserva el mensaje con solo el status
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function SignalDot({ signal, t }: { signal: ChecklistSignal; t: TFunction }) {
  const label = t(SIGNAL_LABEL_KEY[signal]);
  return (
    <span className={`cie-signal cie-signal-${signal}`} title={label}>
      <span className="cie-signal-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

type Tab = 'checklist' | 'documents' | 'faculty' | 'contact';

export function CieChecklistView({
  sessionToken,
  setError,
  setInfo
}: {
  sessionToken: string | null;
  setError: (msg: string | null) => void;
  setInfo: (msg: string | null) => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('checklist');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [checklist, setChecklist] = useState<CieChecklistResponse | null>(null);
  const [programs, setPrograms] = useState<DegreeProgramRow[]>([]);
  const [documentTypes, setDocumentTypes] = useState<CieDocumentType[]>([]);
  const [documents, setDocuments] = useState<CieDocument[]>([]);
  const [faculty, setFaculty] = useState<FacultyRecord[]>([]);
  const [contactMessages, setContactMessages] = useState<ContactMessage[]>([]);
  const [contactTotal, setContactTotal] = useState(0);

  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [documentScopeFilter, setDocumentScopeFilter] = useState<DocumentScope | ''>('');
  const [documentStatusFilter, setDocumentStatusFilter] = useState<DocumentStatus | ''>('');
  const [contactStatusFilter, setContactStatusFilter] = useState<ContactStatus | ''>('');

  const [facultyForm, setFacultyForm] = useState({
    fullName: '',
    email: '',
    programId: '',
    credentials: '',
    degreeLevel: '' as '' | FacultyDegreeLevel
  });

  const [documentForm, setDocumentForm] = useState({
    documentTypeId: '',
    programId: '',
    facultyId: '',
    title: '',
    fileUrl: '',
    version: '1',
    status: 'draft' as DocumentStatus,
    effectiveDate: '',
    expiresAt: ''
  });

  const activePrograms = useMemo(() => programs.filter((program) => program.is_active), [programs]);

  const selectedDocumentType = useMemo(
    () => documentTypes.find((type) => type.id === documentForm.documentTypeId) ?? null,
    [documentTypes, documentForm.documentTypeId]
  );

  const reportError = useCallback(
    (error: unknown, fallback: string) => {
      setError(error instanceof Error ? error.message : fallback);
    },
    [setError]
  );

  /* ----------------------------- Carga de datos --------------------------- */

  const loadChecklist = useCallback(async (token: string) => {
    setChecklist(await cieFetch<CieChecklistResponse>(token, '/admin/cie/checklist'));
  }, []);

  const loadCatalogs = useCallback(async (token: string) => {
    const [programsResponse, typesResponse] = await Promise.all([
      // Los programas son `degree_programs`, del módulo SIS: esta vista los
      // lee pero no los crea.
      cieFetch<DegreeProgramRow[]>(token, '/admin/degree-programs'),
      cieFetch<{ documentTypes: CieDocumentType[] }>(token, '/admin/cie/document-types')
    ]);
    setPrograms(programsResponse);
    setDocumentTypes(typesResponse.documentTypes);
  }, []);

  const loadDocuments = useCallback(
    async (token: string) => {
      const query = new URLSearchParams();
      if (documentScopeFilter) query.set('scope', documentScopeFilter);
      if (documentStatusFilter) query.set('status', documentStatusFilter);
      const suffix = query.toString() ? `?${query.toString()}` : '';
      const response = await cieFetch<{ documents: CieDocument[] }>(
        token,
        `/admin/cie/documents${suffix}`
      );
      setDocuments(response.documents);
    },
    [documentScopeFilter, documentStatusFilter]
  );

  const loadFaculty = useCallback(async (token: string) => {
    const response = await cieFetch<{ faculty: FacultyRecord[] }>(token, '/admin/cie/faculty');
    setFaculty(response.faculty);
  }, []);

  const loadContactMessages = useCallback(
    async (token: string) => {
      const query = new URLSearchParams({ limit: '100' });
      if (contactStatusFilter) query.set('status', contactStatusFilter);
      const response = await cieFetch<{ items: ContactMessage[]; total: number }>(
        token,
        `/admin/contact-messages?${query.toString()}`
      );
      setContactMessages(response.items);
      setContactTotal(response.total);
    },
    [contactStatusFilter]
  );

  useEffect(() => {
    if (!sessionToken) return;
    const token = sessionToken;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        await loadCatalogs(token);
        if (cancelled) return;
        if (tab === 'checklist') await loadChecklist(token);
        if (tab === 'documents') await Promise.all([loadDocuments(token), loadFaculty(token)]);
        if (tab === 'faculty') await loadFaculty(token);
        if (tab === 'contact') await loadContactMessages(token);
      } catch (error) {
        if (!cancelled) reportError(error, t('admin.cie.errorCargarRepositorio'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    sessionToken,
    tab,
    loadCatalogs,
    loadChecklist,
    loadDocuments,
    loadFaculty,
    loadContactMessages,
    reportError,
    setError,
    t
  ]);

  /* -------------------------------- Acciones ------------------------------ */

  const submitFaculty = async () => {
    if (!sessionToken) return;
    if (!facultyForm.fullName.trim() || !facultyForm.email.trim()) {
      setError(t('admin.cie.errorNombreCorreoObligatorios'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await cieFetch(sessionToken, '/admin/cie/faculty', {
        method: 'POST',
        body: {
          fullName: facultyForm.fullName.trim(),
          email: facultyForm.email.trim().toLowerCase(),
          programId: facultyForm.programId || null,
          credentials: facultyForm.credentials.trim() || null,
          degreeLevel: facultyForm.degreeLevel || null
        }
      });
      setInfo(t('admin.cie.expedienteCreado', { nombre: facultyForm.fullName.trim() }));
      setFacultyForm({ fullName: '', email: '', programId: '', credentials: '', degreeLevel: '' });
      await loadFaculty(sessionToken);
    } catch (error) {
      reportError(error, t('admin.cie.errorCrearExpediente'));
    } finally {
      setSaving(false);
    }
  };

  const submitDocument = async () => {
    if (!sessionToken) return;
    if (!documentForm.documentTypeId || !documentForm.title.trim()) {
      setError(t('admin.cie.errorTipoTituloObligatorios'));
      return;
    }
    const scope = selectedDocumentType?.scope;
    if (scope === 'program' && !documentForm.programId) {
      setError(t('admin.cie.errorExigePrograma'));
      return;
    }
    if (scope === 'faculty' && !documentForm.facultyId) {
      setError(t('admin.cie.errorExigeDocente'));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await cieFetch(sessionToken, '/admin/cie/documents', {
        method: 'POST',
        body: {
          documentTypeId: documentForm.documentTypeId,
          programId: scope === 'program' ? documentForm.programId : null,
          facultyId: scope === 'faculty' ? documentForm.facultyId : null,
          title: documentForm.title.trim(),
          fileUrl: documentForm.fileUrl.trim() || null,
          version: documentForm.version.trim() || '1',
          status: documentForm.status,
          effectiveDate: documentForm.effectiveDate || null,
          expiresAt: documentForm.expiresAt || null
        }
      });
      setInfo(t('admin.cie.documentoRegistrado'));
      setDocumentForm({
        documentTypeId: '',
        programId: '',
        facultyId: '',
        title: '',
        fileUrl: '',
        version: '1',
        status: 'draft',
        effectiveDate: '',
        expiresAt: ''
      });
      await Promise.all([loadDocuments(sessionToken), loadChecklist(sessionToken)]);
    } catch (error) {
      reportError(error, t('admin.cie.errorRegistrarDocumento'));
    } finally {
      setSaving(false);
    }
  };

  const changeDocumentStatus = async (document: CieDocument, status: DocumentStatus) => {
    if (!sessionToken) return;
    setSaving(true);
    setError(null);
    try {
      await cieFetch(sessionToken, `/admin/cie/documents/${encodeURIComponent(document.id)}`, {
        method: 'PATCH',
        body: { status }
      });
      setInfo(
        t('admin.cie.documentoEstadoCambiado', {
          titulo: document.title,
          estado: t(DOCUMENT_STATUS_LABEL_KEY[status])
        })
      );
      await Promise.all([loadDocuments(sessionToken), loadChecklist(sessionToken)]);
    } catch (error) {
      reportError(error, t('admin.cie.errorActualizarDocumento'));
    } finally {
      setSaving(false);
    }
  };

  const removeDocument = async (document: CieDocument) => {
    if (!sessionToken) return;
    setSaving(true);
    setError(null);
    try {
      await cieFetch(sessionToken, `/admin/cie/documents/${encodeURIComponent(document.id)}`, {
        method: 'DELETE'
      });
      setInfo(t('admin.cie.documentoEliminado'));
      await Promise.all([loadDocuments(sessionToken), loadChecklist(sessionToken)]);
    } catch (error) {
      reportError(error, t('admin.cie.errorEliminarDocumento'));
    } finally {
      setSaving(false);
    }
  };

  const changeContactStatus = async (message: ContactMessage, status: ContactStatus) => {
    if (!sessionToken) return;
    setSaving(true);
    setError(null);
    try {
      await cieFetch(
        sessionToken,
        `/admin/contact-messages/${encodeURIComponent(message.id)}/status`,
        { method: 'PATCH', body: { status } }
      );
      await loadContactMessages(sessionToken);
    } catch (error) {
      reportError(error, t('admin.cie.errorActualizarMensaje'));
    } finally {
      setSaving(false);
    }
  };

  /* -------------------------------- Render -------------------------------- */

  if (!sessionToken) {
    return <p className="cie-note">{t('admin.cie.sinSesion')}</p>;
  }

  const renderChecklistItem = (item: ChecklistItem) => {
    const isExpanded = expandedItem === item.documentTypeId;
    return (
      <li key={item.documentTypeId} className="cie-checklist-item">
        <button
          type="button"
          className="cie-checklist-row"
          onClick={() => setExpandedItem(isExpanded ? null : item.documentTypeId)}
          aria-expanded={isExpanded}
        >
          <SignalDot signal={item.signal} t={t} />
          <span className="cie-item-name">
            {item.nameEs}
            {item.cieRequired ? <em className="cie-badge">CIE</em> : null}
          </span>
          <span className="cie-item-counts">
            {t('admin.cie.conteoAprobados', { aprobados: item.approved, esperados: item.expected })}
            {item.pending > 0 ? t('admin.cie.conteoPendientes', { count: item.pending }) : ''}
            {item.expired > 0 ? t('admin.cie.conteoVencidos', { count: item.expired }) : ''}
            {item.missing > 0 ? t('admin.cie.conteoSinCargar', { count: item.missing }) : ''}
          </span>
        </button>
        {isExpanded ? (
          <div className="cie-checklist-detail">
            {item.helpEs ? <p className="cie-help">{item.helpEs}</p> : null}
            {item.gaps.length === 0 ? (
              <p className="cie-ok">{t('admin.cie.evidenciaCompletaItem')}</p>
            ) : (
              <table className="cie-gap-table">
                <thead>
                  <tr>
                    <th>{t('admin.cie.colUnidad')}</th>
                    <th>{t('admin.cie.colEstado')}</th>
                  </tr>
                </thead>
                <tbody>
                  {item.gaps.map((gap, index) => (
                    <tr key={`${item.documentTypeId}-${gap.targetId ?? `gap-${index}`}`}>
                      <td>{gap.targetLabel}</td>
                      <td>
                        {GAP_STATE_LABEL_KEY[gap.state]
                          ? t(GAP_STATE_LABEL_KEY[gap.state])
                          : gap.state}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : null}
      </li>
    );
  };

  return (
    <div className="cie-view">
      <nav className="cie-tabs">
        {(
          [
            ['checklist', 'admin.cie.tabs.checklist'],
            ['documents', 'admin.cie.tabs.documentos'],
            ['faculty', 'admin.cie.tabs.faculty'],
            ['contact', 'admin.cie.tabs.contacto']
          ] as Array<[Tab, string]>
        ).map(([value, labelKey]) => (
          <button
            key={value}
            type="button"
            className={tab === value ? 'active' : ''}
            onClick={() => setTab(value)}
          >
            {t(labelKey)}
          </button>
        ))}
      </nav>

      {loading ? <p className="cie-loading">{t('admin.cie.cargando')}</p> : null}

      {/* ------------------------------ Checklist ---------------------------- */}
      {tab === 'checklist' && checklist ? (
        <section>
          <div className="cie-summary">
            <div className="cie-summary-main">
              <SignalDot signal={checklist.summary.signal} t={t} />
              <strong className="cie-percent">{checklist.summary.completionPercent}%</strong>
              <span>
                {t('admin.cie.resumenCompletitud', {
                  aprobadas: checklist.summary.totalApproved,
                  exigidas: checklist.summary.totalRequired
                })}
              </span>
            </div>
            <dl className="cie-counters">
              <div>
                <dt>{t('admin.cie.contadorSinCargar')}</dt>
                <dd>{checklist.summary.totalMissing}</dd>
              </div>
              <div>
                <dt>{t('admin.cie.contadorEnTramite')}</dt>
                <dd>{checklist.summary.totalPending}</dd>
              </div>
              <div>
                <dt>{t('admin.cie.contadorVencidas')}</dt>
                <dd>{checklist.summary.totalExpired}</dd>
              </div>
              <div>
                <dt>{t('admin.cie.contadorProgramasActivos')}</dt>
                <dd>{checklist.counters.activePrograms}</dd>
              </div>
              <div>
                <dt>{t('admin.cie.contadorExpedientesActivos')}</dt>
                <dd>{checklist.counters.activeFacultyRecords}</dd>
              </div>
              <div>
                <dt>{t('admin.cie.contadorVencen30')}</dt>
                <dd>{checklist.counters.expiringSoon}</dd>
              </div>
            </dl>
            {checklist.summary.cieReady ? (
              <p className="cie-ready">{t('admin.cie.expedienteListo')}</p>
            ) : null}
            {checklist.counters.activePrograms === 0 ? (
              <p className="cie-warning">
                {t('admin.cie.avisoSinProgramasActivos')}
              </p>
            ) : null}
          </div>

          {checklist.sections.map((section) => (
            <div key={section.scope} className="cie-section">
              <h3>
                {section.titleEs} <SignalDot signal={section.signal} t={t} />
              </h3>
              {section.items.length === 0 ? (
                <p className="cie-empty">{t('admin.cie.sinTiposDocumento')}</p>
              ) : (
                <ul className="cie-checklist">{section.items.map(renderChecklistItem)}</ul>
              )}
            </div>
          ))}
          <p className="cie-generated">
            {t('admin.cie.generado', {
              fecha: new Date(checklist.generatedAt).toLocaleString('es-CO')
            })}
          </p>
        </section>
      ) : null}

      {/* ------------------------------ Documentos --------------------------- */}
      {tab === 'documents' ? (
        <section>
          <div className="cie-form-card">
            <h3>{t('admin.cie.registrarEvidenciaTitulo')}</h3>
            <div className="cie-form-grid">
              <label>
                {t('admin.cie.campoTipoDocumento')}
                <select
                  value={documentForm.documentTypeId}
                  onChange={(event) =>
                    setDocumentForm((previous) => ({
                      ...previous,
                      documentTypeId: event.target.value,
                      programId: '',
                      facultyId: ''
                    }))
                  }
                >
                  <option value="">{t('admin.cie.optionSelecciona')}</option>
                  {documentTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      [{t(SCOPE_LABEL_KEY[type.scope])}] {type.nameEs}
                      {type.cieRequired ? ' · CIE' : ''}
                    </option>
                  ))}
                </select>
              </label>

              {selectedDocumentType?.scope === 'program' ? (
                <label>
                  {t('admin.cie.campoPrograma')}
                  <select
                    value={documentForm.programId}
                    onChange={(event) =>
                      setDocumentForm((previous) => ({ ...previous, programId: event.target.value }))
                    }
                  >
                    <option value="">{t('admin.cie.optionSelecciona')}</option>
                    {activePrograms.map((program) => (
                      <option key={program.id} value={program.id}>
                        {program.code} — {program.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {selectedDocumentType?.scope === 'faculty' ? (
                <label>
                  {t('admin.cie.campoDocente')}
                  <select
                    value={documentForm.facultyId}
                    onChange={(event) =>
                      setDocumentForm((previous) => ({ ...previous, facultyId: event.target.value }))
                    }
                  >
                    <option value="">{t('admin.cie.optionSelecciona')}</option>
                    {faculty.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.fullName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <label>
                {t('admin.cie.campoTitulo')}
                <input
                  type="text"
                  value={documentForm.title}
                  onChange={(event) =>
                    setDocumentForm((previous) => ({ ...previous, title: event.target.value }))
                  }
                />
              </label>
              <label>
                {t('admin.cie.campoUrlArchivo')}
                <input
                  type="url"
                  placeholder="https://…"
                  value={documentForm.fileUrl}
                  onChange={(event) =>
                    setDocumentForm((previous) => ({ ...previous, fileUrl: event.target.value }))
                  }
                />
              </label>
              <label>
                {t('admin.cie.campoVersion')}
                <input
                  type="text"
                  value={documentForm.version}
                  onChange={(event) =>
                    setDocumentForm((previous) => ({ ...previous, version: event.target.value }))
                  }
                />
              </label>
              <label>
                {t('admin.cie.campoEstado')}
                <select
                  value={documentForm.status}
                  onChange={(event) =>
                    setDocumentForm((previous) => ({
                      ...previous,
                      status: event.target.value as DocumentStatus
                    }))
                  }
                >
                  {(Object.keys(DOCUMENT_STATUS_LABEL_KEY) as DocumentStatus[]).map((status) => (
                    <option key={status} value={status}>
                      {t(DOCUMENT_STATUS_LABEL_KEY[status])}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('admin.cie.campoVigenteDesde')}
                <input
                  type="date"
                  value={documentForm.effectiveDate}
                  onChange={(event) =>
                    setDocumentForm((previous) => ({
                      ...previous,
                      effectiveDate: event.target.value
                    }))
                  }
                />
              </label>
              <label>
                {t('admin.cie.campoVence')}
                <input
                  type="date"
                  value={documentForm.expiresAt}
                  onChange={(event) =>
                    setDocumentForm((previous) => ({ ...previous, expiresAt: event.target.value }))
                  }
                />
              </label>
            </div>
            <button type="button" className="primary-btn" disabled={saving} onClick={submitDocument}>
              {saving ? t('admin.cie.guardando') : t('admin.cie.registrarDocumento')}
            </button>
          </div>

          <div className="cie-filters">
            <label>
              {t('admin.cie.filtroAmbito')}
              <select
                value={documentScopeFilter}
                onChange={(event) => setDocumentScopeFilter(event.target.value as DocumentScope | '')}
              >
                <option value="">{t('admin.cie.optionTodos')}</option>
                {(Object.keys(SCOPE_LABEL_KEY) as DocumentScope[]).map((scope) => (
                  <option key={scope} value={scope}>
                    {t(SCOPE_LABEL_KEY[scope])}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('admin.cie.campoEstado')}
              <select
                value={documentStatusFilter}
                onChange={(event) =>
                  setDocumentStatusFilter(event.target.value as DocumentStatus | '')
                }
              >
                <option value="">{t('admin.cie.optionTodos')}</option>
                {(Object.keys(DOCUMENT_STATUS_LABEL_KEY) as DocumentStatus[]).map((status) => (
                  <option key={status} value={status}>
                    {t(DOCUMENT_STATUS_LABEL_KEY[status])}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <table className="cie-table">
            <thead>
              <tr>
                <th>{t('admin.cie.colDocumento')}</th>
                <th>{t('admin.cie.colTipo')}</th>
                <th>{t('admin.cie.colUnidad')}</th>
                <th>{t('admin.cie.colEstado')}</th>
                <th>{t('admin.cie.colVence')}</th>
                <th>{t('admin.cie.colAcciones')}</th>
              </tr>
            </thead>
            <tbody>
              {documents.length === 0 ? (
                <tr>
                  <td colSpan={6} className="cie-empty">
                    {t('admin.cie.sinDocumentosFiltro')}
                  </td>
                </tr>
              ) : (
                documents.map((document) => (
                  <tr key={document.id} className={document.isExpired ? 'cie-row-expired' : ''}>
                    <td>
                      {document.fileUrl ? (
                        <a href={document.fileUrl} target="_blank" rel="noreferrer noopener">
                          {document.title}
                        </a>
                      ) : (
                        document.title
                      )}
                      <small> v{document.version}</small>
                    </td>
                    <td>{document.documentTypeNameEs}</td>
                    <td>
                      {document.programCode ??
                        document.facultyFullName ??
                        t('admin.cie.ambito.institutional')}
                    </td>
                    <td>
                      {t(DOCUMENT_STATUS_LABEL_KEY[document.status])}
                      {document.isExpired ? (
                        <strong className="cie-expired"> {t('admin.cie.marcaVencido')}</strong>
                      ) : null}
                    </td>
                    <td>{document.expiresAt ?? '—'}</td>
                    <td className="cie-actions">
                      <select
                        value={document.status}
                        disabled={saving}
                        onChange={(event) =>
                          changeDocumentStatus(document, event.target.value as DocumentStatus)
                        }
                      >
                        {(Object.keys(DOCUMENT_STATUS_LABEL_KEY) as DocumentStatus[]).map((status) => (
                          <option key={status} value={status}>
                            {t(DOCUMENT_STATUS_LABEL_KEY[status])}
                          </option>
                        ))}
                      </select>
                      <button type="button" disabled={saving} onClick={() => removeDocument(document)}>
                        {t('admin.cie.eliminar')}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      ) : null}

      {/* -------------------------------- Faculty --------------------------- */}
      {tab === 'faculty' ? (
        <section>
          <div className="cie-form-card">
            <h3>{t('admin.cie.nuevoExpedienteTitulo')}</h3>
            <div className="cie-form-grid">
              <label>
                {t('admin.cie.campoNombreCompleto')}
                <input
                  type="text"
                  value={facultyForm.fullName}
                  onChange={(event) =>
                    setFacultyForm((previous) => ({ ...previous, fullName: event.target.value }))
                  }
                />
              </label>
              <label>
                {t('admin.cie.campoCorreo')}
                <input
                  type="email"
                  value={facultyForm.email}
                  onChange={(event) =>
                    setFacultyForm((previous) => ({ ...previous, email: event.target.value }))
                  }
                />
              </label>
              <label>
                {t('admin.cie.campoPrograma')}
                <select
                  value={facultyForm.programId}
                  onChange={(event) =>
                    setFacultyForm((previous) => ({ ...previous, programId: event.target.value }))
                  }
                >
                  <option value="">{t('admin.cie.optionSinAsignar')}</option>
                  {programs.map((program) => (
                    <option key={program.id} value={program.id}>
                      {program.code} — {program.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('admin.cie.campoGradoMaximo')}
                <select
                  value={facultyForm.degreeLevel}
                  onChange={(event) =>
                    setFacultyForm((previous) => ({
                      ...previous,
                      degreeLevel: event.target.value as '' | FacultyDegreeLevel
                    }))
                  }
                >
                  <option value="">{t('admin.cie.optionSinEspecificar')}</option>
                  {(Object.keys(DEGREE_LEVEL_LABEL_KEY) as FacultyDegreeLevel[]).map((level) => (
                    <option key={level} value={level}>
                      {t(DEGREE_LEVEL_LABEL_KEY[level])}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('admin.cie.campoCredenciales')}
                <input
                  type="text"
                  placeholder={t('admin.cie.placeholderCredenciales')}
                  value={facultyForm.credentials}
                  onChange={(event) =>
                    setFacultyForm((previous) => ({ ...previous, credentials: event.target.value }))
                  }
                />
              </label>
            </div>
            <button type="button" className="primary-btn" disabled={saving} onClick={submitFaculty}>
              {saving ? t('admin.cie.guardando') : t('admin.cie.crearExpediente')}
            </button>
            {programs.length === 0 ? (
              <p className="cie-note">{t('admin.cie.avisoSinProgramas')}</p>
            ) : null}
          </div>

          <table className="cie-table">
            <thead>
              <tr>
                <th>{t('admin.cie.colDocente')}</th>
                <th>{t('admin.cie.colPrograma')}</th>
                <th>{t('admin.cie.colGrado')}</th>
                <th>{t('admin.cie.colCobertura')}</th>
                <th>{t('admin.cie.colFalta')}</th>
              </tr>
            </thead>
            <tbody>
              {faculty.length === 0 ? (
                <tr>
                  <td colSpan={5} className="cie-empty">
                    {t('admin.cie.sinExpedientes')}
                  </td>
                </tr>
              ) : (
                faculty.map((member) => {
                  const complete =
                    member.requiredDocuments > 0 &&
                    member.approvedDocuments === member.requiredDocuments;
                  return (
                    <tr key={member.id}>
                      <td>
                        {member.fullName}
                        <small> {member.email}</small>
                      </td>
                      <td>{member.programCode ?? '—'}</td>
                      <td>
                        {member.credentials ??
                          (member.degreeLevel ? t(DEGREE_LEVEL_LABEL_KEY[member.degreeLevel]) : '—')}
                      </td>
                      <td>
                        <SignalDot
                          signal={complete ? 'green' : member.approvedDocuments === 0 ? 'red' : 'amber'}
                          t={t}
                        />
                        <small>
                          {' '}
                          {member.approvedDocuments}/{member.requiredDocuments}
                        </small>
                      </td>
                      <td>
                        {member.missingDocumentCodes.length === 0
                          ? '—'
                          : member.missingDocumentCodes.join(', ')}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </section>
      ) : null}

      {/* -------------------------- Mensajes de contacto -------------------- */}
      {tab === 'contact' ? (
        <section>
          <div className="cie-filters">
            <label>
              {t('admin.cie.campoEstado')}
              <select
                value={contactStatusFilter}
                onChange={(event) => setContactStatusFilter(event.target.value as ContactStatus | '')}
              >
                <option value="">{t('admin.cie.optionTodos')}</option>
                {(Object.keys(CONTACT_STATUS_LABEL_KEY) as ContactStatus[]).map((status) => (
                  <option key={status} value={status}>
                    {t(CONTACT_STATUS_LABEL_KEY[status])}
                  </option>
                ))}
              </select>
            </label>
            <span className="cie-note">{t('admin.cie.totalMensajes', { count: contactTotal })}</span>
          </div>

          <table className="cie-table">
            <thead>
              <tr>
                <th>{t('admin.cie.colRecibido')}</th>
                <th>{t('admin.cie.colRemitente')}</th>
                <th>{t('admin.cie.colPrograma')}</th>
                <th>{t('admin.cie.colMensaje')}</th>
                <th>{t('admin.cie.colEstado')}</th>
              </tr>
            </thead>
            <tbody>
              {contactMessages.length === 0 ? (
                <tr>
                  <td colSpan={5} className="cie-empty">
                    {t('admin.cie.sinMensajesFiltro')}
                  </td>
                </tr>
              ) : (
                contactMessages.map((message) => (
                  <tr key={message.id}>
                    <td>{new Date(message.createdAt).toLocaleString('es-CO')}</td>
                    <td>
                      {message.fullName}
                      <small>
                        {' '}
                        <a href={`mailto:${message.email}`}>{message.email}</a>
                        {message.phone ? ` · ${message.phone}` : ''}
                      </small>
                    </td>
                    <td>{message.programCode ?? '—'}</td>
                    <td className="cie-message-cell">
                      {message.subject ? <strong>{message.subject}: </strong> : null}
                      {message.message}
                      <small> [{message.locale}]</small>
                    </td>
                    <td>
                      <select
                        value={message.status}
                        disabled={saving}
                        onChange={(event) =>
                          changeContactStatus(message, event.target.value as ContactStatus)
                        }
                      >
                        {(Object.keys(CONTACT_STATUS_LABEL_KEY) as ContactStatus[]).map((status) => (
                          <option key={status} value={status}>
                            {t(CONTACT_STATUS_LABEL_KEY[status])}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}

export default CieChecklistView;
