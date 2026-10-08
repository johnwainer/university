import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
type Week = { week?: number; topic?: string; readings?: string; activities?: string };

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

const TREATMENT_LABEL: Record<SectionTreatment, string> = {
  faculty: 'Redacta la facultad',
  structured: 'Campo con validación',
  institutional: 'Heredado de la institución'
};

const LEVELS: Array<{ value: string; label: string }> = [
  { value: 'undergraduate', label: 'Grado' },
  { value: 'graduate', label: 'Posgrado' },
  { value: 'transfer_undergraduate', label: 'Grado por transferencia' },
  { value: 'transfer_graduate', label: 'Posgrado por transferencia' }
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
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'No se pudo cargar el Master Syllabus');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

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
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar');
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
        setError(reason instanceof Error ? reason.message : 'No se pudo publicar');
      }
    } finally {
      setPublishing(false);
    }
  };

  if (!master) {
    return (
      <article className="card">
        <h2>{syllabus.title}</h2>
        <p className="muted">{error ?? 'Cargando el Master Syllabus…'}</p>
        <button className="ghost" onClick={onClose}>
          Volver
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
            v{version} · {status === 'published' ? 'publicado' : status}
            {dirty ? ' · cambios sin guardar' : ''}
          </p>
        </div>
        <div className="inline-actions">
          <button onClick={() => void save()} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar borrador'}
          </button>
          <button
            onClick={() => void publish()}
            disabled={publishing || blockingCount > 0}
            title={blockingCount > 0 ? 'Hay problemas que impiden publicar' : 'Publica al catálogo, al aula y al repositorio'}
          >
            {publishing ? 'Publicando…' : 'Publicar'}
          </button>
          <button className="ghost" onClick={onClose}>
            Volver
          </button>
        </div>
      </header>

      <p className="syllabus-counters">
        <span className={blockingCount > 0 ? 'badge danger' : 'badge'}>
          {blockingCount} {blockingCount === 1 ? 'problema que impide publicar' : 'problemas que impiden publicar'}
        </span>{' '}
        <span className="badge">{warningCount} {warningCount === 1 ? 'aviso' : 'avisos'}</span>
        {status === 'published' ? (
          <>
            {' '}
            <a className="badge" href={`${API_URL}/v1/syllabi/${syllabus.id}/export?format=html`} target="_blank" rel="noreferrer">
              Ver HTML accesible
            </a>{' '}
            <a className="badge" href={`${API_URL}/v1/syllabi/${syllabus.id}/export?format=pdf`} target="_blank" rel="noreferrer">
              Descargar PDF etiquetado
            </a>
          </>
        ) : null}
      </p>

      {error ? <p className="form-error">{error}</p> : null}

      {blocking ? (
        <div className="syllabus-blocking" role="alert">
          <strong>No se publicó. Falta resolver:</strong>
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
          <strong>Publicado en:</strong>
          <ul>
            <li>Catálogo público — ok</li>
            <li>
              Aula de Moodle —{' '}
              {published.destinations?.moodle?.ok
                ? `ok (${published.destinations.moodle.placed ?? 'course shell'})`
                : `no llegó: ${published.destinations?.moodle?.error ?? 'sin detalle'}`}
            </li>
            <li>Repositorio de cumplimiento — ok</li>
          </ul>
          {published.warnings?.length ? (
            <p className="muted">
              {published.warnings.length} aviso(s) que no impiden publicar siguen abiertos.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="syllabus-layout">
        <nav className="syllabus-nav" aria-label="Secciones del Master Syllabus">
          {(['structured', 'faculty', 'institutional'] as SectionTreatment[]).map((treatment) => {
            const group = master.sections.filter((item) => item.treatment === treatment);
            // El Master Syllabus de TFU reparte sus 24 secciones en estructuradas
            // y heredadas; no deja ninguna de texto libre. El grupo vacío no se
            // pinta, pero el caso se mantiene porque la Cláusula 6 contempla los
            // tres tratamientos y TFU puede reclasificar una sección.
            if (group.length === 0) return null;
            return (
            <div key={treatment}>
              <h3>{TREATMENT_LABEL[treatment]}</h3>
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
                            <span className="syllabus-dot blocking" aria-label="impide publicar">
                              ●
                            </span>
                          ) : sectionIssues.length > 0 ? (
                            <span className="syllabus-dot warning" aria-label="aviso">
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
          <p className="muted syllabus-treatment">{TREATMENT_LABEL[section.treatment]}</p>
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
  updateIn
}: {
  section: MasterSection;
  master: MasterModel;
  content: Record<string, unknown>;
  update: (key: string, value: unknown) => void;
  updateIn: (key: string, field: string, value: unknown) => void;
}) {
  if (section.treatment === 'institutional') {
    const inherited = section.institutionalEs ?? '';
    return (
      <div className="syllabus-inherited">
        <p className="muted">
          Este texto lo fija la institución y se publica igual en todos los sílabos vigentes. No se
          edita desde el curso.
        </p>
        {inherited ? (
          // El HTML viene de nuestro propio módulo versionado, no de entrada de
          // usuario: es contenido institucional del repositorio.
          <div className="syllabus-inherited-body" dangerouslySetInnerHTML={{ __html: inherited }} />
        ) : (
          <p className="syllabus-issue">
            TFU aún no ha fijado el texto de esta sección. Al publicar saldrá vacía.
          </p>
        )}
      </div>
    );
  }

  if (section.treatment === 'faculty') {
    return (
      <label className="syllabus-field">
        <span>Contenido de la sección</span>
        <textarea
          rows={12}
          value={text(content[section.key])}
          onChange={(event) => update(section.key, event.target.value)}
          placeholder="Se admite HTML sencillo: <p>, <ul>, <li>, <strong>, <em>, <a>."
        />
        <small className="muted">
          Se admite HTML sencillo. El servidor filtra etiquetas y atributos antes de publicar.
        </small>
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
      return <ScheduleFields content={content} update={update} />;
    case 'ai_standard':
      return <AiFields content={content} master={master} updateIn={updateIn} />;
    default:
      return (
        <label className="syllabus-field">
          <span>Contenido de la sección</span>
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
  const data = record(content, 'instructor_information');
  const fields: Array<[string, string, string?]> = [
    ['name', 'Nombre y credenciales', 'Dra. Ana Ruiz, Ph.D.'],
    ['email', 'Correo TFU', 'aruiz@thefloridianuniversity.com'],
    ['office_hours', 'Horario de oficina, con zona horaria', 'Martes 18:00–19:00 ET'],
    ['booking_url', 'Enlace de reserva', 'https://…'],
    ['response_time', 'Tiempo típico de respuesta', 'Dentro de 24 horas en días laborables']
  ];
  return (
    <>
      {fields.map(([field, label, placeholder]) => (
        <label className="syllabus-field" key={field}>
          <span>{label}</span>
          <input
            value={text(data[field])}
            onChange={(event) => updateIn('instructor_information', field, event.target.value)}
            placeholder={placeholder}
          />
        </label>
      ))}
      <label className="syllabus-field">
        <span>Biografía</span>
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
  const data = record(content, 'learning_outcomes');
  const outcomes: Outcome[] = Array.isArray(data.outcomes) ? (data.outcomes as Outcome[]) : [];

  const write = (next: Outcome[]) => update('learning_outcomes', { ...data, outcomes: next });

  return (
    <>
      <p className="muted">
        Cada resultado necesita su evaluación principal. Un CLO sin evaluación impide publicar.
      </p>
      {outcomes.map((outcome, index) => (
        <fieldset className="syllabus-repeat" key={index}>
          <legend>{outcome.id?.trim() || `CLO ${index + 1}`}</legend>
          <label className="syllabus-field">
            <span>Identificador</span>
            <input
              value={outcome.id ?? ''}
              onChange={(event) =>
                write(outcomes.map((item, i) => (i === index ? { ...item, id: event.target.value } : item)))
              }
              placeholder={`CLO${index + 1}`}
            />
          </label>
          <label className="syllabus-field">
            <span>Resultado medible</span>
            <textarea
              rows={2}
              value={outcome.text ?? ''}
              onChange={(event) =>
                write(outcomes.map((item, i) => (i === index ? { ...item, text: event.target.value } : item)))
              }
              placeholder="Al terminar el curso, el estudiante podrá…"
            />
          </label>
          <label className="syllabus-field">
            <span>Evaluación que lo mide</span>
            <input
              value={outcome.assessment ?? ''}
              onChange={(event) =>
                write(outcomes.map((item, i) => (i === index ? { ...item, assessment: event.target.value } : item)))
              }
              placeholder="Proyecto aplicado, semana 6"
            />
          </label>
          <button className="ghost danger" onClick={() => write(outcomes.filter((_, i) => i !== index))}>
            Quitar
          </button>
        </fieldset>
      ))}
      <button
        className="ghost"
        onClick={() => write([...outcomes, { id: `CLO${outcomes.length + 1}`, text: '', assessment: '' }])}
      >
        Añadir resultado
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
        <span>Nivel del curso</span>
        <select value={level} onChange={(event) => updateIn('grading', 'courseLevel', event.target.value)}>
          <option value="">Sin definir</option>
          {LEVELS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <small className="muted">
          {level && master.passingMinimums[level]
            ? `Mínimo de aprobación que aplicará el sistema: ${master.passingMinimums[level]}.`
            : 'Determina el mínimo de aprobación. Sin él no se publica.'}
        </small>
      </label>

      <table className="syllabus-weights">
        <caption>
          Pesos de evaluación. Parten de los institucionales; la suma debe dar 100% y ninguna pieza
          puede pasar del {master.maxSingleComponentWeight}%.
        </caption>
        <thead>
          <tr>
            <th scope="col">Categoría</th>
            <th scope="col">Institucional</th>
            <th scope="col">Este curso</th>
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
                  aria-label={`Peso de ${category.labelEs}`}
                />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
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
        Usar los pesos institucionales
      </button>

      <table className="syllabus-weights">
        <caption>Escala institucional. No es editable desde el curso.</caption>
        <thead>
          <tr>
            <th scope="col">Letra</th>
            <th scope="col">Rango</th>
            <th scope="col">Puntos</th>
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
  update
}: {
  content: Record<string, unknown>;
  update: (key: string, value: unknown) => void;
}) {
  const data = record(content, 'course_schedule');
  const weeks: Week[] = Array.isArray(data.weeks) ? (data.weeks as Week[]) : [];

  const write = (next: Week[]) => update('course_schedule', { ...data, weeks: next });

  return (
    <>
      <p className="muted">
        El término de TFU corre ocho semanas. Las fechas las pone el calendario académico a partir
        del inicio del periodo; aquí se rellena el contenido.
      </p>
      {weeks.length === 0 ? (
        <button
          className="ghost"
          onClick={() =>
            write(Array.from({ length: 8 }, (_, index) => ({ week: index + 1, topic: '', readings: '', activities: '' })))
          }
        >
          Crear las ocho semanas
        </button>
      ) : null}
      {weeks.map((week, index) => (
        <fieldset className="syllabus-repeat" key={index}>
          <legend>Semana {week.week ?? index + 1}</legend>
          <label className="syllabus-field">
            <span>Tema</span>
            <input
              value={week.topic ?? ''}
              onChange={(event) =>
                write(weeks.map((item, i) => (i === index ? { ...item, topic: event.target.value } : item)))
              }
            />
          </label>
          <label className="syllabus-field">
            <span>Lecturas</span>
            <textarea
              rows={2}
              value={week.readings ?? ''}
              onChange={(event) =>
                write(weeks.map((item, i) => (i === index ? { ...item, readings: event.target.value } : item)))
              }
            />
          </label>
          <label className="syllabus-field">
            <span>Actividades</span>
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
  const data = record(content, 'artificial_intelligence');
  // La lista la manda el servidor (§14): cerrada y con su etiqueta. Se acepta
  // también la forma de cadena por si una versión vieja de la API la devuelve así.
  const standards = master.aiStandards.map((item) =>
    typeof item === 'string' ? { value: item, labelEs: item } : item
  );
  return (
    <>
      <label className="syllabus-field">
        <span>Estándar de IA del curso</span>
        <select
          value={text(data.standard)}
          onChange={(event) => updateIn('artificial_intelligence', 'standard', event.target.value)}
        >
          <option value="">Sin definir</option>
          {standards.map((item) => (
            <option key={item.value} value={item.value}>
              {item.labelEs ?? item.value}
            </option>
          ))}
        </select>
        <small className="muted">Lista cerrada. Sin estándar, el sílabo no se publica.</small>
      </label>
      <label className="syllabus-field">
        <span>Indicaciones para el estudiante</span>
        <textarea
          rows={6}
          value={text(data.guidance)}
          onChange={(event) => updateIn('artificial_intelligence', 'guidance', event.target.value)}
          placeholder="Qué se admite, qué hay que declarar y cómo se cita."
        />
      </label>
    </>
  );
}
