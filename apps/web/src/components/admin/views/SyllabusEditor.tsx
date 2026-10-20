import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Editor del Master Syllabus TFU — las 24 secciones.
 *
 * El módulo ya tenía API, tablas y puerta de publicación, pero el panel sólo
 * permitía crear el registro y pegar JSON a mano. Eso significa que la facultad
 * no podía redactar un sílabo: podía, como mucho, describirlo. Esto es la parte
 * que faltaba.
 *
 * Tres decisiones que explican la forma del componente:
 *
 * 1. Las secciones se agrupan por el tratamiento de la Cláusula 6, no por
 *    número. Lo que la facultad puede tocar y lo que hereda de la institución
 *    son dos conversaciones distintas, y mezclarlas invita a que alguien
 *    intente reescribir una política institucional desde el curso.
 *
 * 2. La validación la hace el servidor, no el navegador. Las reglas viven en
 *    validation.ts porque también gobiernan la publicación; duplicarlas aquí
 *    garantizaría que un día divergieran y el editor dijera «listo» sobre algo
 *    que el servidor rechaza. Se consulta con rebote mientras se escribe.
 *
 * 3. Guardar nunca se bloquea. Un borrador a medias es legítimo —se redacta en
 *    varias sesiones— y lo que se bloquea es publicarlo. El panel de problemas
 *    acompaña, no impide.
 */

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api';

/* ----------------------------------------------------------------- tipos */

type SectionTreatment = 'institutional' | 'faculty' | 'structured';

type MasterSection = {
  number: number;
  key: string;
  labelEs: string;
  labelEn: string;
  treatment: SectionTreatment;
  helpEs?: string;
  institutionalEs?: string;
  institutionalEn?: string;
  shape?: string;
};

type ValidationIssue = {
  section: string;
  code: string;
  messageEs: string;
  messageEn: string;
  severity: 'blocking' | 'warning';
};

type MasterModel = {
  sections: MasterSection[];
  assessmentCategories: Array<{ key: string; labelEs: string; labelEn: string; defaultWeight: number }>;
  gradingScale: Array<{ letter: string; min: number; max: number; points: number }>;
  passingMinimums: Record<string, string>;
  maxSingleComponentWeight: number;
  aiStandards: Array<{ value: string; labelEs: string; labelEn: string } | string>;
  weeklyCadence: {
    deadlines: Array<{ key: string; dayOffset: number; labelEs: string; labelEn: string }>;
  };
};

export type EditableSyllabus = {
  id: string;
  title: string;
  content: Record<string, unknown>;
  version: number;
  status: 'draft' | 'published' | 'archived';
  moodle_course_id: number | null;
  term_id: string | null;
};

type Outcome = { id?: string; text?: string; assessment?: string };
type Week = {
  week?: number;
  /** Fechas traídas del calendario del término; no se editan a mano. */
  startsOn?: string;
  endsOn?: string;
  shifted?: boolean;
  topic?: string;
  readings?: string;
  activities?: string;
};

type PublishResult = {
  destinations?: {
    catalog?: { ok: boolean };
    moodle?: { ok: boolean; placed?: string; error?: string };
    complianceRepository?: { ok: boolean };
  };
  warnings?: ValidationIssue[];
};

/* ------------------------------------------------------------- utilidades */

async function adminFetch<T>(
  token: string,
  path: string,
  options?: { method?: string; body?: unknown }
): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (options?.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API_URL}${path}`, {
    method: options?.method ?? 'GET',
    headers,
    body: options?.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const raw = await response.text();
  const parsed = raw ? (JSON.parse(raw) as unknown) : undefined;
  if (!response.ok) {
    const detail = parsed as { message?: string; error?: string; blocking?: ValidationIssue[] } | undefined;
    const error = new Error(detail?.message ?? detail?.error ?? `Error ${response.status}`);
    (error as Error & { blocking?: ValidationIssue[] }).blocking = detail?.blocking;
    throw error;
  }
  return parsed as T;
}

/** Lee un valor anidado del contenido sin asumir su forma. */
function record(content: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = content[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Este mapa guarda CLAVES de i18next, no etiquetas: el tratamiento se traduce
 * en tiempo de render con t(TREATMENT_LABEL_KEY[...]), de modo que al cambiar
 * de idioma los encabezados cambian sin recargar. La clave del objeto sigue
 * siendo el identificador del tratamiento que viene del servidor y nunca se
 * traduce.
 */
const TREATMENT_LABEL_KEY: Record<SectionTreatment, string> = {
  faculty: 'admin.syllabus.tratamientoFacultad',
  structured: 'admin.syllabus.tratamientoEstructurado',
  institutional: 'admin.syllabus.tratamientoInstitucional'
};

/**
 * Igual que arriba: `value` es el identificador que viaja en el payload de
 * `grading.courseLevel` y no se traduce; `labelKey` es la clave que se resuelve
 * al pintar la opción.
 */
const LEVELS: Array<{ value: string; labelKey: string }> = [
  { value: 'undergraduate', labelKey: 'admin.syllabus.nivelGrado' },
  { value: 'graduate', labelKey: 'admin.syllabus.nivelPosgrado' },
  { value: 'transfer_undergraduate', labelKey: 'admin.syllabus.nivelGradoTransferencia' },
  { value: 'transfer_graduate', labelKey: 'admin.syllabus.nivelPosgradoTransferencia' }
];

/* =========================================================== el componente */

export function SyllabusEditor({
  token,
  syllabus,
  onClose,
  onSaved
}: {
  token: string;
  syllabus: EditableSyllabus;
  onClose: () => void;
  onSaved: (updated: EditableSyllabus) => void;
}) {
  const { t } = useTranslation();
  const [master, setMaster] = useState<MasterModel | null>(null);
  const [content, setContent] = useState<Record<string, unknown>>(syllabus.content ?? {});
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [activeKey, setActiveKey] = useState<string>('instructor_information');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [status, setStatus] = useState(syllabus.status);
  const [version, setVersion] = useState(syllabus.version);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<PublishResult | null>(null);
  const [blocking, setBlocking] = useState<ValidationIssue[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void adminFetch<MasterModel>(token, '/admin/syllabus/master')
      .then((model) => {
        if (!cancelled) setMaster(model);
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : t('admin.syllabus.errorCargarMaster'));
      });
    return () => {
      cancelled = true;
    };
  }, [token, t]);

  /* La validación es del servidor. Con rebote, para no mandar una petición por
     tecla, y con un contador de secuencia para que una respuesta lenta no pise
     a una más reciente. */
  const sequence = useRef(0);
  useEffect(() => {
    const mine = ++sequence.current;
    const timer = window.setTimeout(() => {
      void adminFetch<{ issues: ValidationIssue[] }>(token, '/admin/syllabi/validate', {
        method: 'POST',
        body: { content }
      })
        .then((result) => {
          if (sequence.current === mine) setIssues(result.issues ?? []);
        })
        .catch(() => {
          /* Si la comprobación falla, el editor sigue usable; la puerta real
             está en publicar. */
        });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [content, token]);

  const issuesBySection = useMemo(() => {
    const map = new Map<string, ValidationIssue[]>();
    for (const issue of issues) {
      map.set(issue.section, [...(map.get(issue.section) ?? []), issue]);
    }
    return map;
  }, [issues]);

  const blockingCount = issues.filter((issue) => issue.severity === 'blocking').length;
  const warningCount = issues.length - blockingCount;

  const update = useCallback((key: string, value: unknown) => {
    setContent((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setPublished(null);
    setBlocking(null);
  }, []);

  const updateIn = useCallback(
    (key: string, field: string, value: unknown) => {
      setContent((current) => ({
        ...current,
        [key]: { ...record(current, key), [field]: value }
      }));
      setDirty(true);
      setPublished(null);
      setBlocking(null);
    },
    []
  );

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await adminFetch<EditableSyllabus & { validation?: { issues: ValidationIssue[] } }>(
        token,
        `/admin/syllabi/${syllabus.id}`,
        { method: 'PATCH', body: { content } }
      );
      setDirty(false);
      setVersion(saved.version);
      setIssues(saved.validation?.issues ?? issues);
      onSaved(saved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.syllabus.errorGuardar'));
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    setPublishing(true);
    setError(null);
    setBlocking(null);
    try {
      // Se guarda antes de publicar: publicar lo que hay en pantalla y no lo
      // último guardado es lo que la facultad espera.
      await adminFetch(token, `/admin/syllabi/${syllabus.id}`, { method: 'PATCH', body: { content } });
      const result = await adminFetch<EditableSyllabus & PublishResult>(
        token,
        `/admin/syllabi/${syllabus.id}/publish`,
        { method: 'POST' }
      );
      setDirty(false);
      setStatus('published');
      setVersion(result.version);
      setPublished({ destinations: result.destinations, warnings: result.warnings });
      onSaved(result);
    } catch (reason) {
      const withBlocking = reason as Error & { blocking?: ValidationIssue[] };
      if (withBlocking.blocking?.length) {
        setBlocking(withBlocking.blocking);
      } else {
        setError(reason instanceof Error ? reason.message : t('admin.syllabus.errorPublicar'));
      }
    } finally {
      setPublishing(false);
    }
  };

  if (!master) {
    return (
      <article className="card">
        <h2>{syllabus.title}</h2>
        <p className="muted">{error ?? t('admin.syllabus.cargandoMaster')}</p>
        <button className="ghost" onClick={onClose}>
          {t('admin.syllabus.volver')}
        </button>
      </article>
    );
  }

  const section = master.sections.find((item) => item.key === activeKey) ?? master.sections[0];

  return (
    <article className="card syllabus-editor">
      <header className="syllabus-editor-head">
        <div>
          <h2>{syllabus.title}</h2>
          <p className="muted">
            v{version} · {status === 'published' ? t('admin.syllabus.estadoPublicado') : status}
            {dirty ? ` · ${t('admin.syllabus.cambiosSinGuardar')}` : ''}
          </p>
        </div>
        <div className="inline-actions">
          <button onClick={() => void save()} disabled={saving}>
            {saving ? t('admin.syllabus.guardando') : t('admin.syllabus.guardarBorrador')}
          </button>
          <button
            onClick={() => void publish()}
            disabled={publishing || blockingCount > 0}
            title={
              blockingCount > 0
                ? t('admin.syllabus.tituloPublicarBloqueado')
                : t('admin.syllabus.tituloPublicar')
            }
          >
            {publishing ? t('admin.syllabus.publicando') : t('admin.syllabus.publicar')}
          </button>
          <button className="ghost" onClick={onClose}>
            {t('admin.syllabus.volver')}
          </button>
        </div>
      </header>

      <p className="syllabus-counters">
        <span className={blockingCount > 0 ? 'badge danger' : 'badge'}>
          {t('admin.syllabus.contadorBloqueantes', { count: blockingCount })}
        </span>{' '}
        <span className="badge">{t('admin.syllabus.contadorAvisos', { count: warningCount })}</span>
        {status === 'published' ? (
          <>
            {' '}
            <a className="badge" href={`${API_URL}/v1/syllabi/${syllabus.id}/export?format=html`} target="_blank" rel="noreferrer">
              {t('admin.syllabus.verHtml')}
            </a>{' '}
            <a className="badge" href={`${API_URL}/v1/syllabi/${syllabus.id}/export?format=pdf`} target="_blank" rel="noreferrer">
              {t('admin.syllabus.descargarPdf')}
            </a>
          </>
        ) : null}
      </p>

      {error ? <p className="form-error">{error}</p> : null}

      {blocking ? (
        <div className="syllabus-blocking" role="alert">
          <strong>{t('admin.syllabus.noSePublico')}</strong>
          <ul>
            {blocking.map((issue) => (
              <li key={`${issue.section}-${issue.code}`}>
                <button className="link-like" onClick={() => setActiveKey(issue.section)}>
                  {issue.messageEs}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {published ? (
        <div className="syllabus-published" role="status">
          <strong>{t('admin.syllabus.publicadoEn')}</strong>
          <ul>
            <li>{t('admin.syllabus.destinoCatalogo')}</li>
            <li>
              {t('admin.syllabus.destinoMoodle')}{' '}
              {published.destinations?.moodle?.ok
                ? t('admin.syllabus.destinoMoodleOk', {
                    placed: published.destinations.moodle.placed ?? t('admin.syllabus.moodleCourseShell')
                  })
                : t('admin.syllabus.destinoMoodleFallo', {
                    detalle: published.destinations?.moodle?.error ?? t('admin.syllabus.sinDetalle')
                  })}
            </li>
            <li>{t('admin.syllabus.destinoRepositorio')}</li>
          </ul>
          {published.warnings?.length ? (
            <p className="muted">
              {t('admin.syllabus.avisosAbiertos', { count: published.warnings.length })}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="syllabus-layout">
        <nav className="syllabus-nav" aria-label={t('admin.syllabus.ariaNavSecciones')}>
          {(['structured', 'faculty', 'institutional'] as SectionTreatment[]).map((treatment) => {
            const group = master.sections.filter((item) => item.treatment === treatment);
            // El Master Syllabus de TFU reparte sus 24 secciones en estructuradas
            // y heredadas; no deja ninguna de texto libre. El grupo vacío no se
            // pinta, pero el caso se mantiene porque la Cláusula 6 contempla los
            // tres tratamientos y TFU puede reclasificar una sección.
            if (group.length === 0) return null;
            return (
            <div key={treatment}>
              <h3>{t(TREATMENT_LABEL_KEY[treatment])}</h3>
              <ul>
                {group
                  .map((item) => {
                    const sectionIssues = issuesBySection.get(item.key) ?? [];
                    const hasBlocking = sectionIssues.some((issue) => issue.severity === 'blocking');
                    return (
                      <li key={item.key}>
                        <button
                          className={item.key === section.key ? 'syllabus-nav-item active' : 'syllabus-nav-item'}
                          onClick={() => setActiveKey(item.key)}
                          aria-current={item.key === section.key ? 'true' : undefined}
                        >
                          <span className="syllabus-nav-number">{item.number}</span>
                          <span>{item.labelEs}</span>
                          {hasBlocking ? (
                            <span className="syllabus-dot blocking" aria-label={t('admin.syllabus.ariaImpidePublicar')}>
                              ●
                            </span>
                          ) : sectionIssues.length > 0 ? (
                            <span className="syllabus-dot warning" aria-label={t('admin.syllabus.ariaAviso')}>
                              ●
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
              </ul>
            </div>
            );
          })}
        </nav>

        <section className="syllabus-panel" aria-live="polite">
          <h3>
            {section.number}. {section.labelEs}
          </h3>
          <p className="muted syllabus-treatment">{t(TREATMENT_LABEL_KEY[section.treatment])}</p>
          {section.helpEs ? <p className="syllabus-help">{section.helpEs}</p> : null}

          {(issuesBySection.get(section.key) ?? []).map((issue) => (
            <p
              key={issue.code}
              className={issue.severity === 'blocking' ? 'syllabus-issue blocking' : 'syllabus-issue'}
            >
              {issue.messageEs}
            </p>
          ))}

          <SectionFields
            section={section}
            master={master}
            content={content}
            update={update}
            updateIn={updateIn}
            token={token}
            syllabusId={syllabus.id}
            termId={syllabus.term_id ?? null}
          />
        </section>
      </div>
    </article>
  );
}

/* ================================================= campos por tratamiento */

function SectionFields({
  section,
  master,
  content,
  update,
  updateIn,
  token,
  syllabusId,
  termId
}: {
  section: MasterSection;
  master: MasterModel;
  content: Record<string, unknown>;
  update: (key: string, value: unknown) => void;
  updateIn: (key: string, field: string, value: unknown) => void;
  token: string;
  syllabusId: string;
  termId: string | null;
}) {
  const { t } = useTranslation();

  if (section.treatment === 'institutional') {
    const inherited = section.institutionalEs ?? '';
    return (
      <div className="syllabus-inherited">
        <p className="muted">{t('admin.syllabus.textoInstitucionalAviso')}</p>
        {inherited ? (
          // El HTML viene de nuestro propio módulo versionado, no de entrada de
          // usuario: es contenido institucional del repositorio.
          <div className="syllabus-inherited-body" dangerouslySetInnerHTML={{ __html: inherited }} />
        ) : (
          <p className="syllabus-issue">{t('admin.syllabus.textoInstitucionalVacio')}</p>
        )}
      </div>
    );
  }

  if (section.treatment === 'faculty') {
    return (
      <label className="syllabus-field">
        <span>{t('admin.syllabus.campoContenidoSeccion')}</span>
        <textarea
          rows={12}
          value={text(content[section.key])}
          onChange={(event) => update(section.key, event.target.value)}
          placeholder={t('admin.syllabus.placeholderHtmlSencillo')}
        />
        <small className="muted">{t('admin.syllabus.ayudaHtmlSencillo')}</small>
      </label>
    );
  }

  switch (section.shape) {
    case 'instructor':
      return <InstructorFields content={content} updateIn={updateIn} />;
    case 'clo_matrix':
      return <OutcomesFields content={content} update={update} />;
    case 'assessment_weights':
      return <WeightsFields content={content} master={master} updateIn={updateIn} />;
    case 'course_schedule':
      return <ScheduleFields content={content} update={update} token={token} syllabusId={syllabusId} termId={termId} />;
    case 'ai_standard':
      return <AiFields content={content} master={master} updateIn={updateIn} />;
    default:
      return (
        <label className="syllabus-field">
          <span>{t('admin.syllabus.campoContenidoSeccion')}</span>
          <textarea
            rows={10}
            value={text(content[section.key])}
            onChange={(event) => update(section.key, event.target.value)}
          />
        </label>
      );
  }
}

function InstructorFields({
  content,
  updateIn
}: {
  content: Record<string, unknown>;
  updateIn: (key: string, field: string, value: unknown) => void;
}) {
  const { t } = useTranslation();
  const data = record(content, 'instructor_information');
  /* Igual que los otros mapas del archivo: `field` es el nombre del campo que
     viaja a la API y no se traduce; las otras dos posiciones son CLAVES de
     i18next que se resuelven al pintar cada input. */
  const fields: Array<[string, string, string?]> = [
    ['name', 'admin.syllabus.instructorNombre', 'admin.syllabus.instructorNombrePlaceholder'],
    ['email', 'admin.syllabus.instructorCorreo', 'admin.syllabus.instructorCorreoPlaceholder'],
    ['office_hours', 'admin.syllabus.instructorHorario', 'admin.syllabus.instructorHorarioPlaceholder'],
    ['booking_url', 'admin.syllabus.instructorReserva', 'admin.syllabus.instructorReservaPlaceholder'],
    [
      'response_time',
      'admin.syllabus.instructorRespuesta',
      'admin.syllabus.instructorRespuestaPlaceholder'
    ]
  ];
  return (
    <>
      {fields.map(([field, labelKey, placeholderKey]) => (
        <label className="syllabus-field" key={field}>
          <span>{t(labelKey)}</span>
          <input
            value={text(data[field])}
            onChange={(event) => updateIn('instructor_information', field, event.target.value)}
            placeholder={placeholderKey ? t(placeholderKey) : undefined}
          />
        </label>
      ))}
      <label className="syllabus-field">
        <span>{t('admin.syllabus.instructorBiografia')}</span>
        <textarea
          rows={5}
          value={text(data.bio)}
          onChange={(event) => updateIn('instructor_information', 'bio', event.target.value)}
        />
      </label>
    </>
  );
}

function OutcomesFields({
  content,
  update
}: {
  content: Record<string, unknown>;
  update: (key: string, value: unknown) => void;
}) {
  const { t } = useTranslation();
  const data = record(content, 'learning_outcomes');
  const outcomes: Outcome[] = Array.isArray(data.outcomes) ? (data.outcomes as Outcome[]) : [];

  const write = (next: Outcome[]) => update('learning_outcomes', { ...data, outcomes: next });

  return (
    <>
      <p className="muted">{t('admin.syllabus.cloAviso')}</p>
      {outcomes.map((outcome, index) => (
        <fieldset className="syllabus-repeat" key={index}>
          <legend>{outcome.id?.trim() || `CLO ${index + 1}`}</legend>
          <label className="syllabus-field">
            <span>{t('admin.syllabus.cloIdentificador')}</span>
            <input
              value={outcome.id ?? ''}
              onChange={(event) =>
                write(outcomes.map((item, i) => (i === index ? { ...item, id: event.target.value } : item)))
              }
              placeholder={`CLO${index + 1}`}
            />
          </label>
          <label className="syllabus-field">
            <span>{t('admin.syllabus.cloResultado')}</span>
            <textarea
              rows={2}
              value={outcome.text ?? ''}
              onChange={(event) =>
                write(outcomes.map((item, i) => (i === index ? { ...item, text: event.target.value } : item)))
              }
              placeholder={t('admin.syllabus.cloResultadoPlaceholder')}
            />
          </label>
          <label className="syllabus-field">
            <span>{t('admin.syllabus.cloEvaluacion')}</span>
            <input
              value={outcome.assessment ?? ''}
              onChange={(event) =>
                write(outcomes.map((item, i) => (i === index ? { ...item, assessment: event.target.value } : item)))
              }
              placeholder={t('admin.syllabus.cloEvaluacionPlaceholder')}
            />
          </label>
          <button className="ghost danger" onClick={() => write(outcomes.filter((_, i) => i !== index))}>
            {t('admin.syllabus.cloQuitar')}
          </button>
        </fieldset>
      ))}
      <button
        className="ghost"
        onClick={() => write([...outcomes, { id: `CLO${outcomes.length + 1}`, text: '', assessment: '' }])}
      >
        {t('admin.syllabus.cloAnadir')}
      </button>
    </>
  );
}

function WeightsFields({
  content,
  master,
  updateIn
}: {
  content: Record<string, unknown>;
  master: MasterModel;
  updateIn: (key: string, field: string, value: unknown) => void;
}) {
  const { t } = useTranslation();
  const data = record(content, 'grading');
  const weights = (data.weights && typeof data.weights === 'object' ? data.weights : {}) as Record<string, number>;
  const level = text(data.courseLevel);

  // Se suma en centésimas enteras, igual que el servidor, para que el total que
  // ve la facultad coincida con el que decide la publicación.
  const total =
    Object.values(weights).reduce((sum, value) => sum + Math.round((Number(value) || 0) * 100), 0) / 100;

  const setWeight = (key: string, raw: string) => {
    const next = { ...weights };
    if (raw.trim() === '') {
      delete next[key];
    } else {
      next[key] = Number(raw);
    }
    updateIn('grading', 'weights', next);
  };

  return (
    <>
      <label className="syllabus-field">
        <span>{t('admin.syllabus.nivelCurso')}</span>
        <select value={level} onChange={(event) => updateIn('grading', 'courseLevel', event.target.value)}>
          <option value="">{t('admin.syllabus.sinDefinir')}</option>
          {LEVELS.map((item) => (
            <option key={item.value} value={item.value}>
              {t(item.labelKey)}
            </option>
          ))}
        </select>
        <small className="muted">
          {level && master.passingMinimums[level]
            ? t('admin.syllabus.minimoAprobacion', { minimo: master.passingMinimums[level] })
            : t('admin.syllabus.minimoAprobacionSinNivel')}
        </small>
      </label>

      <table className="syllabus-weights">
        <caption>
          {t('admin.syllabus.captionPesos', { max: master.maxSingleComponentWeight })}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t('admin.syllabus.colCategoria')}</th>
            <th scope="col">{t('admin.syllabus.colInstitucional')}</th>
            <th scope="col">{t('admin.syllabus.colEsteCurso')}</th>
          </tr>
        </thead>
        <tbody>
          {master.assessmentCategories.map((category) => (
            <tr key={category.key}>
              <th scope="row">{category.labelEs}</th>
              <td>{category.defaultWeight}%</td>
              <td>
                <input
                  type="number"
                  min={0}
                  max={master.maxSingleComponentWeight}
                  value={weights[category.key] ?? ''}
                  onChange={(event) => setWeight(category.key, event.target.value)}
                  aria-label={t('admin.syllabus.ariaPesoCategoria', { categoria: category.labelEs })}
                />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">{t('admin.syllabus.colTotal')}</th>
            <td>100%</td>
            <td className={total === 100 ? 'syllabus-total ok' : 'syllabus-total bad'}>{total}%</td>
          </tr>
        </tfoot>
      </table>

      <button
        className="ghost"
        onClick={() =>
          updateIn(
            'grading',
            'weights',
            Object.fromEntries(master.assessmentCategories.map((item) => [item.key, item.defaultWeight]))
          )
        }
      >
        {t('admin.syllabus.usarPesosInstitucionales')}
      </button>

      <table className="syllabus-weights">
        <caption>{t('admin.syllabus.captionEscala')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('admin.syllabus.colLetra')}</th>
            <th scope="col">{t('admin.syllabus.colRango')}</th>
            <th scope="col">{t('admin.syllabus.colPuntos')}</th>
          </tr>
        </thead>
        <tbody>
          {master.gradingScale.map((grade) => (
            <tr key={grade.letter}>
              <th scope="row">{grade.letter}</th>
              <td>
                {grade.min}–{grade.max}
              </td>
              <td>{grade.points.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function ScheduleFields({
  content,
  update,
  token,
  syllabusId,
  termId
}: {
  content: Record<string, unknown>;
  update: (key: string, value: unknown) => void;
  token: string;
  syllabusId: string;
  termId: string | null;
}) {
  const { t } = useTranslation();
  const data = record(content, 'course_schedule');
  const weeks: Week[] = Array.isArray(data.weeks) ? (data.weeks as Week[]) : [];
  const [sincronizando, setSincronizando] = useState(false);
  const [avisoCalendario, setAvisoCalendario] = useState<string | null>(null);

  const write = (next: Week[]) => update('course_schedule', { ...data, weeks: next });

  /**
   * Trae las fechas del calendario académico del término.
   *
   * Es la respuesta a la pregunta de TFU sobre si el calendario se sincroniza
   * con el sílabo: ahora sí, en una dirección. El término es la única fuente de
   * fechas —si un festivo las desplaza, se desplazan para todas las secciones—
   * y aquí se refrescan sin tocar tema, lecturas ni actividades.
   */
  const traerDelCalendario = async () => {
    setSincronizando(true);
    setAvisoCalendario(null);
    try {
      const resultado = await adminFetch<{ synced: boolean; reason?: string; weeks: Week[] }>(
        token,
        `/admin/syllabi/${encodeURIComponent(syllabusId)}/sync-calendar`,
        { method: 'POST' }
      );
      write(resultado.weeks ?? []);
      setAvisoCalendario(
        resultado.synced
          ? t('admin.syllabus.calendarioTraido')
          : t('admin.syllabus.calendarioYaAlineado')
      );
    } catch (error) {
      setAvisoCalendario(error instanceof Error ? error.message : String(error));
    } finally {
      setSincronizando(false);
    }
  };

  return (
    <>
      <p className="muted">{t('admin.syllabus.cronogramaAviso')}</p>
      <div className="inline-actions" style={{ marginBottom: '10px' }}>
        <button className="ghost" onClick={() => void traerDelCalendario()} disabled={sincronizando || !termId}>
          {sincronizando ? t('admin.syllabus.calendarioTrayendo') : t('admin.syllabus.calendarioTraer')}
        </button>
        {!termId ? <small className="muted">{t('admin.syllabus.calendarioSinTermino')}</small> : null}
      </div>
      {avisoCalendario ? <p className="muted">{avisoCalendario}</p> : null}
      {weeks.length === 0 ? (
        <button
          className="ghost"
          onClick={() =>
            write(Array.from({ length: 8 }, (_, index) => ({ week: index + 1, topic: '', readings: '', activities: '' })))
          }
        >
          {t('admin.syllabus.crearOchoSemanas')}
        </button>
      ) : null}
      {weeks.map((week, index) => (
        <fieldset className="syllabus-repeat" key={index}>
          <legend>
            {t('admin.syllabus.semana', { numero: week.week ?? index + 1 })}
            {/* Las fechas vienen del calendario y por eso se MUESTRAN, no se
                editan aquí: editarlas en el sílabo las separaría del término. */}
            {week.startsOn && week.endsOn ? (
              <small className="muted">
                {' '}
                · {week.startsOn} – {week.endsOn}
                {week.shifted ? ` · ${t('admin.syllabus.semanaDesplazada')}` : ''}
              </small>
            ) : null}
          </legend>
          <label className="syllabus-field">
            <span>{t('admin.syllabus.semanaTema')}</span>
            <input
              value={week.topic ?? ''}
              onChange={(event) =>
                write(weeks.map((item, i) => (i === index ? { ...item, topic: event.target.value } : item)))
              }
            />
          </label>
          <label className="syllabus-field">
            <span>{t('admin.syllabus.semanaLecturas')}</span>
            <textarea
              rows={2}
              value={week.readings ?? ''}
              onChange={(event) =>
                write(weeks.map((item, i) => (i === index ? { ...item, readings: event.target.value } : item)))
              }
            />
          </label>
          <label className="syllabus-field">
            <span>{t('admin.syllabus.semanaActividades')}</span>
            <textarea
              rows={2}
              value={week.activities ?? ''}
              onChange={(event) =>
                write(weeks.map((item, i) => (i === index ? { ...item, activities: event.target.value } : item)))
              }
            />
          </label>
        </fieldset>
      ))}
    </>
  );
}

function AiFields({
  content,
  master,
  updateIn
}: {
  content: Record<string, unknown>;
  master: MasterModel;
  updateIn: (key: string, field: string, value: unknown) => void;
}) {
  const { t } = useTranslation();
  const data = record(content, 'artificial_intelligence');
  // La lista la manda el servidor (§14): cerrada y con su etiqueta. Se acepta
  // también la forma de cadena por si una versión vieja de la API la devuelve así.
  const standards = master.aiStandards.map((item) =>
    typeof item === 'string' ? { value: item, labelEs: item } : item
  );
  return (
    <>
      <label className="syllabus-field">
        <span>{t('admin.syllabus.estandarIa')}</span>
        <select
          value={text(data.standard)}
          onChange={(event) => updateIn('artificial_intelligence', 'standard', event.target.value)}
        >
          <option value="">{t('admin.syllabus.sinDefinir')}</option>
          {standards.map((item) => (
            <option key={item.value} value={item.value}>
              {item.labelEs ?? item.value}
            </option>
          ))}
        </select>
        <small className="muted">{t('admin.syllabus.estandarIaAyuda')}</small>
      </label>
      <label className="syllabus-field">
        <span>{t('admin.syllabus.indicacionesEstudiante')}</span>
        <textarea
          rows={6}
          value={text(data.guidance)}
          onChange={(event) => updateIn('artificial_intelligence', 'guidance', event.target.value)}
          placeholder={t('admin.syllabus.indicacionesPlaceholder')}
        />
      </label>
    </>
  );
}
