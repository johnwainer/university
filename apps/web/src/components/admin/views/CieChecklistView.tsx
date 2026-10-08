import { useCallback, useEffect, useMemo, useState } from 'react';

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
 * Etiquetas de texto del semáforo. El color NUNCA es el único portador del
 * estado: cada señal va acompañada de su etiqueta, para cumplir WCAG 2.1 AA.
 */
const SIGNAL_LABEL: Record<ChecklistSignal, string> = {
  green: 'Completo',
  amber: 'Incompleto',
  red: 'Sin evidencia'
};

const SCOPE_LABEL: Record<DocumentScope, string> = {
  institutional: 'Institucional',
  program: 'Por programa',
  faculty: 'Faculty'
};

const DOCUMENT_STATUS_LABEL: Record<DocumentStatus, string> = {
  draft: 'Borrador',
  in_review: 'En revisión',
  approved: 'Aprobado',
  rejected: 'Rechazado'
};

const CONTACT_STATUS_LABEL: Record<ContactStatus, string> = {
  new: 'Nuevo',
  in_progress: 'En gestión',
  closed: 'Cerrado',
  spam: 'Spam'
};

const DEGREE_LEVEL_LABEL: Record<FacultyDegreeLevel, string> = {
  bachelor: 'Pregrado',
  master: 'Maestría',
  doctoral: 'Doctorado',
  professional: 'Título profesional',
  other: 'Otro'
};

const GAP_STATE_LABEL: Record<string, string> = {
  missing: 'No cargado',
  draft: 'Borrador',
  in_review: 'En revisión',
  rejected: 'Rechazado',
  expired: 'Vencido',
  approved: 'Aprobado'
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

function SignalDot({ signal }: { signal: ChecklistSignal }) {
  return (
    <span className={`cie-signal cie-signal-${signal}`} title={SIGNAL_LABEL[signal]}>
      <span className="cie-signal-dot" aria-hidden="true" />
      {SIGNAL_LABEL[signal]}
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
        if (!cancelled) reportError(error, 'No se pudo cargar el repositorio CIE');
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
    setError
  ]);

  /* -------------------------------- Acciones ------------------------------ */

  const submitFaculty = async () => {
    if (!sessionToken) return;
    if (!facultyForm.fullName.trim() || !facultyForm.email.trim()) {
      setError('Nombre y correo del docente son obligatorios');
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
      setInfo(`Expediente de ${facultyForm.fullName.trim()} creado`);
      setFacultyForm({ fullName: '', email: '', programId: '', credentials: '', degreeLevel: '' });
      await loadFaculty(sessionToken);
    } catch (error) {
      reportError(error, 'No se pudo crear el expediente');
    } finally {
      setSaving(false);
    }
  };

  const submitDocument = async () => {
    if (!sessionToken) return;
    if (!documentForm.documentTypeId || !documentForm.title.trim()) {
      setError('Tipo de documento y título son obligatorios');
      return;
    }
    const scope = selectedDocumentType?.scope;
    if (scope === 'program' && !documentForm.programId) {
      setError('Este tipo de documento exige seleccionar un programa');
      return;
    }
    if (scope === 'faculty' && !documentForm.facultyId) {
      setError('Este tipo de documento exige seleccionar un docente');
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
      setInfo('Documento registrado en el repositorio');
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
      reportError(error, 'No se pudo registrar el documento');
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
      setInfo(`${document.title}: ${DOCUMENT_STATUS_LABEL[status]}`);
      await Promise.all([loadDocuments(sessionToken), loadChecklist(sessionToken)]);
    } catch (error) {
      reportError(error, 'No se pudo actualizar el documento');
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
      setInfo('Documento eliminado del repositorio');
      await Promise.all([loadDocuments(sessionToken), loadChecklist(sessionToken)]);
    } catch (error) {
      reportError(error, 'No se pudo eliminar el documento');
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
      reportError(error, 'No se pudo actualizar el mensaje');
    } finally {
      setSaving(false);
    }
  };

  /* -------------------------------- Render -------------------------------- */

  if (!sessionToken) {
    return <p className="cie-note">Inicia sesión para ver el checklist CIE.</p>;
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
          <SignalDot signal={item.signal} />
          <span className="cie-item-name">
            {item.nameEs}
            {item.cieRequired ? <em className="cie-badge">CIE</em> : null}
          </span>
          <span className="cie-item-counts">
            {item.approved}/{item.expected} aprobados
            {item.pending > 0 ? ` · ${item.pending} pendientes` : ''}
            {item.expired > 0 ? ` · ${item.expired} vencidos` : ''}
            {item.missing > 0 ? ` · ${item.missing} sin cargar` : ''}
          </span>
        </button>
        {isExpanded ? (
          <div className="cie-checklist-detail">
            {item.helpEs ? <p className="cie-help">{item.helpEs}</p> : null}
            {item.gaps.length === 0 ? (
              <p className="cie-ok">Toda la evidencia exigida está aprobada y vigente.</p>
            ) : (
              <table className="cie-gap-table">
                <thead>
                  <tr>
                    <th>Unidad</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {item.gaps.map((gap, index) => (
                    <tr key={`${item.documentTypeId}-${gap.targetId ?? `gap-${index}`}`}>
                      <td>{gap.targetLabel}</td>
                      <td>{GAP_STATE_LABEL[gap.state] ?? gap.state}</td>
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
            ['checklist', 'Checklist'],
            ['documents', 'Documentos'],
            ['faculty', 'Faculty'],
            ['contact', 'Mensajes de contacto']
          ] as Array<[Tab, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={tab === value ? 'active' : ''}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </nav>

      {loading ? <p className="cie-loading">Cargando…</p> : null}

      {/* ------------------------------ Checklist ---------------------------- */}
      {tab === 'checklist' && checklist ? (
        <section>
          <div className="cie-summary">
            <div className="cie-summary-main">
              <SignalDot signal={checklist.summary.signal} />
              <strong className="cie-percent">{checklist.summary.completionPercent}%</strong>
              <span>
                completitud documental exigida por la CIE ({checklist.summary.totalApproved} de{' '}
                {checklist.summary.totalRequired} evidencias aprobadas y vigentes)
              </span>
            </div>
            <dl className="cie-counters">
              <div>
                <dt>Sin cargar</dt>
                <dd>{checklist.summary.totalMissing}</dd>
              </div>
              <div>
                <dt>En trámite</dt>
                <dd>{checklist.summary.totalPending}</dd>
              </div>
              <div>
                <dt>Vencidas</dt>
                <dd>{checklist.summary.totalExpired}</dd>
              </div>
              <div>
                <dt>Programas activos</dt>
                <dd>{checklist.counters.activePrograms}</dd>
              </div>
              <div>
                <dt>Expedientes activos</dt>
                <dd>{checklist.counters.activeFacultyRecords}</dd>
              </div>
              <div>
                <dt>Vencen en 30 días</dt>
                <dd>{checklist.counters.expiringSoon}</dd>
              </div>
            </dl>
            {checklist.summary.cieReady ? (
              <p className="cie-ready">
                Toda la evidencia exigida está completa. El expediente está listo para sustentar la
                solicitud ante la CIE.
              </p>
            ) : null}
            {checklist.counters.activePrograms === 0 ? (
              <p className="cie-warning">
                No hay programas activos en <strong>degree_programs</strong>. La evidencia por
                programa no se puede exigir hasta que exista al menos uno: créalos en la sección{' '}
                <strong>SIS / Académico</strong> del panel.
              </p>
            ) : null}
          </div>

          {checklist.sections.map((section) => (
            <div key={section.scope} className="cie-section">
              <h3>
                {section.titleEs} <SignalDot signal={section.signal} />
              </h3>
              {section.items.length === 0 ? (
                <p className="cie-empty">Sin tipos de documento configurados en este ámbito.</p>
              ) : (
                <ul className="cie-checklist">{section.items.map(renderChecklistItem)}</ul>
              )}
            </div>
          ))}
          <p className="cie-generated">
            Generado {new Date(checklist.generatedAt).toLocaleString('es-CO')}
          </p>
        </section>
      ) : null}

      {/* ------------------------------ Documentos --------------------------- */}
      {tab === 'documents' ? (
        <section>
          <div className="cie-form-card">
            <h3>Registrar evidencia</h3>
            <div className="cie-form-grid">
              <label>
                Tipo de documento
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
                  <option value="">Selecciona…</option>
                  {documentTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      [{SCOPE_LABEL[type.scope]}] {type.nameEs}
                      {type.cieRequired ? ' · CIE' : ''}
                    </option>
                  ))}
                </select>
              </label>

              {selectedDocumentType?.scope === 'program' ? (
                <label>
                  Programa
                  <select
                    value={documentForm.programId}
                    onChange={(event) =>
                      setDocumentForm((previous) => ({ ...previous, programId: event.target.value }))
                    }
                  >
                    <option value="">Selecciona…</option>
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
                  Docente
                  <select
                    value={documentForm.facultyId}
                    onChange={(event) =>
                      setDocumentForm((previous) => ({ ...previous, facultyId: event.target.value }))
                    }
                  >
                    <option value="">Selecciona…</option>
                    {faculty.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.fullName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <label>
                Título
                <input
                  type="text"
                  value={documentForm.title}
                  onChange={(event) =>
                    setDocumentForm((previous) => ({ ...previous, title: event.target.value }))
                  }
                />
              </label>
              <label>
                URL del archivo
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
                Versión
                <input
                  type="text"
                  value={documentForm.version}
                  onChange={(event) =>
                    setDocumentForm((previous) => ({ ...previous, version: event.target.value }))
                  }
                />
              </label>
              <label>
                Estado
                <select
                  value={documentForm.status}
                  onChange={(event) =>
                    setDocumentForm((previous) => ({
                      ...previous,
                      status: event.target.value as DocumentStatus
                    }))
                  }
                >
                  {(Object.keys(DOCUMENT_STATUS_LABEL) as DocumentStatus[]).map((status) => (
                    <option key={status} value={status}>
                      {DOCUMENT_STATUS_LABEL[status]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Vigente desde
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
                Vence
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
              {saving ? 'Guardando…' : 'Registrar documento'}
            </button>
          </div>

          <div className="cie-filters">
            <label>
              Ámbito
              <select
                value={documentScopeFilter}
                onChange={(event) => setDocumentScopeFilter(event.target.value as DocumentScope | '')}
              >
                <option value="">Todos</option>
                {(Object.keys(SCOPE_LABEL) as DocumentScope[]).map((scope) => (
                  <option key={scope} value={scope}>
                    {SCOPE_LABEL[scope]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Estado
              <select
                value={documentStatusFilter}
                onChange={(event) =>
                  setDocumentStatusFilter(event.target.value as DocumentStatus | '')
                }
              >
                <option value="">Todos</option>
                {(Object.keys(DOCUMENT_STATUS_LABEL) as DocumentStatus[]).map((status) => (
                  <option key={status} value={status}>
                    {DOCUMENT_STATUS_LABEL[status]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <table className="cie-table">
            <thead>
              <tr>
                <th>Documento</th>
                <th>Tipo</th>
                <th>Unidad</th>
                <th>Estado</th>
                <th>Vence</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {documents.length === 0 ? (
                <tr>
                  <td colSpan={6} className="cie-empty">
                    Sin documentos registrados con estos filtros.
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
                      {document.programCode ?? document.facultyFullName ?? 'Institucional'}
                    </td>
                    <td>
                      {DOCUMENT_STATUS_LABEL[document.status]}
                      {document.isExpired ? <strong className="cie-expired"> vencido</strong> : null}
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
                        {(Object.keys(DOCUMENT_STATUS_LABEL) as DocumentStatus[]).map((status) => (
                          <option key={status} value={status}>
                            {DOCUMENT_STATUS_LABEL[status]}
                          </option>
                        ))}
                      </select>
                      <button type="button" disabled={saving} onClick={() => removeDocument(document)}>
                        Eliminar
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
            <h3>Nuevo expediente de faculty</h3>
            <div className="cie-form-grid">
              <label>
                Nombre completo
                <input
                  type="text"
                  value={facultyForm.fullName}
                  onChange={(event) =>
                    setFacultyForm((previous) => ({ ...previous, fullName: event.target.value }))
                  }
                />
              </label>
              <label>
                Correo
                <input
                  type="email"
                  value={facultyForm.email}
                  onChange={(event) =>
                    setFacultyForm((previous) => ({ ...previous, email: event.target.value }))
                  }
                />
              </label>
              <label>
                Programa
                <select
                  value={facultyForm.programId}
                  onChange={(event) =>
                    setFacultyForm((previous) => ({ ...previous, programId: event.target.value }))
                  }
                >
                  <option value="">Sin asignar</option>
                  {programs.map((program) => (
                    <option key={program.id} value={program.id}>
                      {program.code} — {program.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Grado máximo
                <select
                  value={facultyForm.degreeLevel}
                  onChange={(event) =>
                    setFacultyForm((previous) => ({
                      ...previous,
                      degreeLevel: event.target.value as '' | FacultyDegreeLevel
                    }))
                  }
                >
                  <option value="">Sin especificar</option>
                  {(Object.keys(DEGREE_LEVEL_LABEL) as FacultyDegreeLevel[]).map((level) => (
                    <option key={level} value={level}>
                      {DEGREE_LEVEL_LABEL[level]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Credenciales
                <input
                  type="text"
                  placeholder="Ph.D. Educación, M.Ed."
                  value={facultyForm.credentials}
                  onChange={(event) =>
                    setFacultyForm((previous) => ({ ...previous, credentials: event.target.value }))
                  }
                />
              </label>
            </div>
            <button type="button" className="primary-btn" disabled={saving} onClick={submitFaculty}>
              {saving ? 'Guardando…' : 'Crear expediente'}
            </button>
            {programs.length === 0 ? (
              <p className="cie-note">
                No hay programas registrados. Se pueden crear expedientes sin programa asignado y
                vincularlos después; los programas se crean en <strong>SIS / Académico</strong>.
              </p>
            ) : null}
          </div>

          <table className="cie-table">
            <thead>
              <tr>
                <th>Docente</th>
                <th>Programa</th>
                <th>Grado</th>
                <th>Cobertura documental</th>
                <th>Falta</th>
              </tr>
            </thead>
            <tbody>
              {faculty.length === 0 ? (
                <tr>
                  <td colSpan={5} className="cie-empty">
                    Aún no hay expedientes cargados.
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
                          (member.degreeLevel ? DEGREE_LEVEL_LABEL[member.degreeLevel] : '—')}
                      </td>
                      <td>
                        <SignalDot
                          signal={complete ? 'green' : member.approvedDocuments === 0 ? 'red' : 'amber'}
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
              Estado
              <select
                value={contactStatusFilter}
                onChange={(event) => setContactStatusFilter(event.target.value as ContactStatus | '')}
              >
                <option value="">Todos</option>
                {(Object.keys(CONTACT_STATUS_LABEL) as ContactStatus[]).map((status) => (
                  <option key={status} value={status}>
                    {CONTACT_STATUS_LABEL[status]}
                  </option>
                ))}
              </select>
            </label>
            <span className="cie-note">{contactTotal} mensajes en total</span>
          </div>

          <table className="cie-table">
            <thead>
              <tr>
                <th>Recibido</th>
                <th>Remitente</th>
                <th>Programa</th>
                <th>Mensaje</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {contactMessages.length === 0 ? (
                <tr>
                  <td colSpan={5} className="cie-empty">
                    Sin mensajes con este filtro.
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
                        {(Object.keys(CONTACT_STATUS_LABEL) as ContactStatus[]).map((status) => (
                          <option key={status} value={status}>
                            {CONTACT_STATUS_LABEL[status]}
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
