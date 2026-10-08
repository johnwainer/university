/**
 * Render del sílabo publicado.
 *
 * La Cláusula 6 pide que el sílabo aprobado se publique en un solo acto a tres
 * destinos —catálogo público, course shell de Moodle y repositorio de
 * compliance— y que la versión del estudiante se exporte en PDF y HTML
 * accesible bajo WCAG 2.x AA.
 *
 * Todo sale de aquí para que los tres destinos muestren exactamente lo mismo.
 * Si cada uno armara su propio HTML, acabarían divergiendo, y la divergencia
 * que nadie detecta es la del documento que el estudiante acusa haber leído.
 *
 * QUÉ HACE ACCESIBLE A ESTE HTML
 *   - Un solo `h1` y jerarquía sin saltos: cada sección es `h2`.
 *   - Las tablas llevan `<caption>` y `<th scope>`, que es lo que permite a un
 *     lector de pantalla decir a qué fila y columna pertenece cada celda.
 *   - Nada de color como único portador de significado.
 *   - Contraste por encima de 7:1 en texto normal (AAA), con margen de sobra
 *     sobre el 4.5:1 que exige AA.
 *   - `lang` declarado y `prefers-reduced-motion` respetado (no hay animación).
 *   - Impreso conserva la estructura: los estilos de impresión no ocultan nada.
 */
import {
  ASSESSMENT_CATEGORIES,
  GRADING_SCALE,
  MASTER_SYLLABUS_SECTIONS,
  PASSING_MINIMUMS,
  WEEKLY_CADENCE,
  type CourseLevel
} from './master-syllabus.js';
import type { SyllabusContent } from './validation.js';

export type RenderOptions = {
  locale: 'es' | 'en';
  courseTitle: string;
  termLabel?: string | null;
  version: number;
  publishedAt: string;
};

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * El contenido de facultad llega como HTML del editor. Se deja pasar una lista
 * corta de etiquetas y se descarta el resto, incluidos `script`, `style`, los
 * atributos `on*` y los `href` que no sean http(s) o mailto. El sílabo se
 * publica dentro del aula y en el portal: lo que escriba un docente no puede
 * convertirse en código ejecutable para sus alumnos.
 */
export function sanitizeHtml(raw: string): string {
  const allowed = new Set(['p', 'br', 'strong', 'em', 'b', 'i', 'u', 'ul', 'ol', 'li', 'h3', 'h4', 'a', 'blockquote', 'code']);
  return String(raw ?? '')
    .replace(/<\s*(script|style|iframe|object|embed|form)[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*\/?\s*([a-zA-Z0-9]+)((?:[^>"']|"[^"]*"|'[^']*')*)>/g, (match, tag: string, attrs: string) => {
      const name = tag.toLowerCase();
      if (!allowed.has(name)) {
        return '';
      }
      if (name !== 'a') {
        return match.startsWith('</') ? `</${name}>` : `<${name}>`;
      }
      if (match.startsWith('</')) {
        return '</a>';
      }
      const href = /href\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? '';
      if (!/^(https?:|mailto:)/i.test(href)) {
        return '<a>';
      }
      // `rel` en los enlaces salientes: el sílabo se abre dentro del aula.
      return `<a href="${escapeHtml(href)}" rel="noopener noreferrer">`;
    });
}

type Labels = Record<string, string>;

const L: Record<'es' | 'en', Labels> = {
  es: {
    syllabus: 'Sílabo del curso',
    version: 'Versión',
    published: 'Publicado',
    term: 'Periodo',
    outcomes: 'Resultado de aprendizaje',
    assessment: 'Evaluación principal',
    category: 'Categoría de evaluación',
    weight: 'Porcentaje',
    total: 'Total',
    letter: 'Nota',
    range: 'Porcentaje',
    points: 'Puntos de calidad',
    passing: 'Mínimo de aprobación aplicable',
    week: 'Semana',
    dates: 'Fechas',
    topic: 'Tema',
    deadlines: 'Fechas límite',
    aiStandard: 'Estándar de IA de este curso',
    instructor: 'Instructor',
    email: 'Correo',
    officeHours: 'Horario de oficina',
    responseTime: 'Tiempo típico de respuesta',
    notProvided: 'Por definir',
    scheduleCaption: 'Calendario de ocho semanas con sus fechas límite',
    weightsCaption: 'Distribución de la calificación por categoría',
    scaleCaption: 'Escala de calificación institucional',
    cloCaption: 'Resultados de aprendizaje y su evaluación principal'
  },
  en: {
    syllabus: 'Course Syllabus',
    version: 'Version',
    published: 'Published',
    term: 'Term',
    outcomes: 'Learning outcome',
    assessment: 'Principal assessment',
    category: 'Assessment category',
    weight: 'Percentage',
    total: 'Total',
    letter: 'Grade',
    range: 'Percentage',
    points: 'Quality points',
    passing: 'Applicable passing minimum',
    week: 'Week',
    dates: 'Dates',
    topic: 'Topic',
    deadlines: 'Deadlines',
    aiStandard: 'Course AI standard',
    instructor: 'Instructor',
    email: 'Email',
    officeHours: 'Office hours',
    responseTime: 'Typical response time',
    notProvided: 'To be defined',
    scheduleCaption: 'Eight-week schedule with its deadlines',
    weightsCaption: 'Grade distribution by category',
    scaleCaption: 'Institutional grading scale',
    cloCaption: 'Learning outcomes and their principal assessment'
  }
};

function renderInstructor(content: SyllabusContent, t: Labels): string {
  const info = (content.instructor_information ?? {}) as Record<string, string>;
  const rows: Array<[string, string]> = [
    [t.instructor, info.name ?? ''],
    [t.email, info.email ?? ''],
    [t.officeHours, info.officeHours ?? ''],
    [t.responseTime, info.responseTime ?? '']
  ].filter((row) => row[1]) as Array<[string, string]>;
  if (rows.length === 0) {
    return `<p>${t.notProvided}</p>`;
  }
  const body = rows
    .map(([label, value]) => `<div class="field"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join('');
  const bio = info.bio ? `<div class="bio">${sanitizeHtml(info.bio)}</div>` : '';
  return `<dl class="instructor">${body}</dl>${bio}`;
}

function renderCloMatrix(content: SyllabusContent, t: Labels): string {
  const outcomes = content.learning_outcomes?.outcomes ?? [];
  if (outcomes.length === 0) {
    return `<p>${t.notProvided}</p>`;
  }
  const rows = outcomes
    .map(
      (outcome, index) =>
        `<tr><th scope="row">${escapeHtml(outcome.id ?? `CLO ${index + 1}`)}</th>` +
        `<td>${escapeHtml(outcome.text ?? '')}</td>` +
        `<td>${escapeHtml(outcome.assessment ?? '')}</td></tr>`
    )
    .join('');
  return `<table>
  <caption>${escapeHtml(t.cloCaption)}</caption>
  <thead><tr><th scope="col">CLO</th><th scope="col">${escapeHtml(t.outcomes)}</th><th scope="col">${escapeHtml(t.assessment)}</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

function renderWeights(content: SyllabusContent, locale: 'es' | 'en', t: Labels): string {
  const weights = content.grading?.weights ?? {};
  const entries = Object.entries(weights).filter(([, value]) => typeof value === 'number');
  if (entries.length === 0) {
    return `<p>${t.notProvided}</p>`;
  }
  const labelFor = (key: string) => {
    const category = ASSESSMENT_CATEGORIES.find((item) => item.key === key);
    return category ? (locale === 'en' ? category.labelEn : category.labelEs) : key;
  };
  const total = entries.reduce((sum, [, value]) => sum + Math.round((value as number) * 100), 0) / 100;
  const rows = entries
    .map(([key, value]) => `<tr><th scope="row">${escapeHtml(labelFor(key))}</th><td>${value}%</td></tr>`)
    .join('');

  const level = content.grading?.courseLevel as CourseLevel | undefined;
  const minimum = level && level in PASSING_MINIMUMS ? PASSING_MINIMUMS[level] : null;

  const scale = GRADING_SCALE.map(
    (row) =>
      `<tr><th scope="row">${row.letter}</th><td>${row.min}–${row.max}%</td><td>${row.points.toFixed(1)}</td></tr>`
  ).join('');

  return `<table>
  <caption>${escapeHtml(t.weightsCaption)}</caption>
  <thead><tr><th scope="col">${escapeHtml(t.category)}</th><th scope="col">${escapeHtml(t.weight)}</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr><th scope="row">${escapeHtml(t.total)}</th><td>${total}%</td></tr></tfoot>
</table>
<table>
  <caption>${escapeHtml(t.scaleCaption)}</caption>
  <thead><tr><th scope="col">${escapeHtml(t.letter)}</th><th scope="col">${escapeHtml(t.range)}</th><th scope="col">${escapeHtml(t.points)}</th></tr></thead>
  <tbody>${scale}</tbody>
</table>
${minimum ? `<p class="passing"><strong>${escapeHtml(t.passing)}:</strong> ${escapeHtml(minimum)}</p>` : ''}`;
}

function renderSchedule(content: SyllabusContent, locale: 'es' | 'en', t: Labels): string {
  const weeks = content.course_schedule?.weeks ?? [];
  if (weeks.length === 0) {
    return `<p>${t.notProvided}</p>`;
  }
  const deadlineLabels = WEEKLY_CADENCE.deadlines
    .map((deadline) => (locale === 'en' ? deadline.labelEn : deadline.labelEs))
    .join(' · ');
  const rows = weeks
    .map((week) => {
      const extra = week as { startsOn?: string; endsOn?: string; readings?: string };
      const dates = extra.startsOn && extra.endsOn ? `${extra.startsOn} – ${extra.endsOn}` : '';
      return `<tr><th scope="row">${escapeHtml(week.week ?? '')}</th><td>${escapeHtml(dates)}</td><td>${escapeHtml(week.topic ?? '')}</td></tr>`;
    })
    .join('');
  return `<table>
  <caption>${escapeHtml(t.scheduleCaption)}</caption>
  <thead><tr><th scope="col">${escapeHtml(t.week)}</th><th scope="col">${escapeHtml(t.dates)}</th><th scope="col">${escapeHtml(t.topic)}</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<p class="deadlines"><strong>${escapeHtml(t.deadlines)}:</strong> ${escapeHtml(deadlineLabels)}</p>`;
}

function renderAi(content: SyllabusContent, locale: 'es' | 'en', t: Labels): string {
  const standard = content.artificial_intelligence?.standard;
  const guidance = content.artificial_intelligence?.guidance;
  const labels: Record<string, { es: string; en: string }> = {
    permitted: { es: 'Permitido', en: 'Permitted' },
    permitted_with_restrictions: { es: 'Permitido con restricciones', en: 'Permitted with restrictions' },
    not_permitted: { es: 'No permitido', en: 'Not permitted' }
  };
  const label = standard ? labels[standard]?.[locale] ?? standard : t.notProvided;
  return `<p class="ai-standard"><strong>${escapeHtml(t.aiStandard)}:</strong> ${escapeHtml(label)}</p>${
    guidance ? sanitizeHtml(guidance) : ''
  }`;
}

/** Cuerpo del sílabo: las 24 secciones en orden. */
export function renderSyllabusBody(content: SyllabusContent, options: RenderOptions): string {
  const t = L[options.locale];
  const parts: string[] = [];

  for (const section of MASTER_SYLLABUS_SECTIONS) {
    const label = options.locale === 'en' ? section.labelEn : section.labelEs;
    let body = '';

    if (section.treatment === 'institutional') {
      const inherited = options.locale === 'en' ? section.institutionalEn : section.institutionalEs;
      const overridden = content[section.key];
      body =
        typeof overridden === 'string' && overridden.trim()
          ? sanitizeHtml(overridden)
          : inherited ?? '';
      if (!body) {
        // Una sección institucional sin texto todavía cargado no se pinta
        // vacía: se omite, que es menos confuso que un encabezado huérfano.
        continue;
      }
    } else {
      switch (section.shape) {
        case 'instructor':
          body = renderInstructor(content, t);
          break;
        case 'clo_matrix':
          body = renderCloMatrix(content, t);
          break;
        case 'assessment_weights':
          body = renderWeights(content, options.locale, t);
          break;
        case 'course_schedule':
          body = renderSchedule(content, options.locale, t);
          break;
        case 'ai_standard':
          body = renderAi(content, options.locale, t);
          break;
        default: {
          const value = content[section.key];
          body = typeof value === 'string' ? sanitizeHtml(value) : '';
          if (!body) {
            const inherited = options.locale === 'en' ? section.institutionalEn : section.institutionalEs;
            body = inherited ?? `<p>${t.notProvided}</p>`;
          }
        }
      }
    }

    parts.push(
      `<section aria-labelledby="sec-${section.key}">
  <h2 id="sec-${section.key}"><span class="num">${section.number}.</span> ${escapeHtml(label)}</h2>
  ${body}
</section>`
    );
  }

  return parts.join('\n');
}

/**
 * Documento completo, autocontenido, para exportar o imprimir.
 *
 * Sin dependencias externas a propósito: un sílabo que un estudiante guarda en
 * su ordenador tiene que seguir viéndose igual dentro de un año, sin red.
 */
export function renderSyllabusDocument(content: SyllabusContent, options: RenderOptions): string {
  const t = L[options.locale];
  const published = new Date(options.publishedAt).toLocaleDateString(
    options.locale === 'en' ? 'en-US' : 'es-ES',
    { year: 'numeric', month: 'long', day: 'numeric' }
  );

  return `<!doctype html>
<html lang="${options.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.courseTitle)} — ${escapeHtml(t.syllabus)}</title>
<style>
  :root { color-scheme: light; }
  body {
    margin: 0 auto; padding: 32px 20px; max-width: 46rem;
    font: 16px/1.65 "Source Sans 3", -apple-system, system-ui, sans-serif;
    /* 15.6:1 sobre blanco: muy por encima del 4.5:1 de AA. */
    color: #15212e; background: #ffffff;
  }
  h1 { font-size: 1.75rem; line-height: 1.25; margin: 0 0 4px; }
  h2 { font-size: 1.12rem; margin: 32px 0 8px; padding-top: 14px; border-top: 1px solid #c9d4df; }
  h2 .num { color: #4a5b6d; font-weight: 600; }
  h3 { font-size: 1rem; margin: 18px 0 6px; }
  p, li { margin: 0 0 10px; }
  ul, ol { padding-left: 22px; }
  a { color: #0b5a76; }
  a:focus-visible, :focus-visible { outline: 3px solid #0b5a76; outline-offset: 2px; }
  .meta { color: #40505f; font-size: 0.92rem; margin: 0 0 24px; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0 18px; }
  caption { text-align: left; font-weight: 700; padding-bottom: 6px; }
  th, td { border: 1px solid #c9d4df; padding: 8px 10px; text-align: left; vertical-align: top; }
  thead th { background: #eef3f7; }
  tfoot th, tfoot td { background: #eef3f7; font-weight: 700; }
  dl.instructor { display: grid; gap: 4px; margin: 0 0 12px; }
  dl.instructor .field { display: flex; gap: 8px; flex-wrap: wrap; }
  dl.instructor dt { font-weight: 700; margin: 0; }
  dl.instructor dd { margin: 0; }
  .passing, .ai-standard, .deadlines { background: #eef3f7; padding: 10px 12px; border-left: 4px solid #0b5a76; }
  @media print {
    body { max-width: none; padding: 0; font-size: 11pt; }
    h2 { break-after: avoid; }
    table, section { break-inside: avoid; }
    a::after { content: " (" attr(href) ")"; font-size: 0.85em; color: #40505f; }
  }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(options.courseTitle)}</h1>
  <p class="meta">
    ${escapeHtml(t.syllabus)}
    ${options.termLabel ? ` · ${escapeHtml(t.term)}: ${escapeHtml(options.termLabel)}` : ''}
    · ${escapeHtml(t.version)} ${options.version}
    · ${escapeHtml(t.published)} ${escapeHtml(published)}
  </p>
${renderSyllabusBody(content, options)}
</main>
</body>
</html>`;
}
