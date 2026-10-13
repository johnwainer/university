import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import {
  api,
  type CatalogContentDetailResponse,
  type CursoDelPrograma,
  type ProgramaPublico,
  type PublicCourseInteractionRecord,
  type LegalPageResponse,
  type SitePageSummary,
  type MoodleCourseContentResponse,
  type PublicCourseProgressRecord,
  type PublicHomeResponse,
  type PublicMyCoursesResponse,
  type PublicSession,
  type WebinarRecord,
  type PodcastRecord,
  type EnterpriseOverviewResponse
} from '../lib/api';
import { EnterpriseGroupManager } from './EnterpriseGroupManager';
import { BRAND, BRAND_SHORT } from '../i18n';
import { INSTITUTION_CONTACTS } from '../institution';
import { StudentAcademics } from './StudentAcademics';
import { StudentProgram } from './StudentProgram';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ContactSection } from './public/ContactSection';
import { AdmissionsForm } from './public/AdmissionsForm';
import './public.css';
// Después de public.css a propósito: añade y afina sobre esas piezas.
import './catalog-system.css';
// Capa de rediseño de las vistas internas; va la última a propósito.
import './internas.css';
import './programa.css';

type ViewState =
  | { type: 'home' }
  | { type: 'catalog' }
  | { type: 'detail'; slug: string }
  /**
   * Aula de un curso del estudiante.
   *
   * Se identifica por el id de Moodle y no por un slug porque al aula sólo se
   * llega desde «Mis cursos», que es la lista de matrículas y sí trae el id. El
   * sitio público ya no tiene slug de curso: el catálogo devuelve programas, y
   * sus cursos viajan sin identificador justamente para que no exista una ruta
   * por la que entrar a uno suelto. El título viaja con la vista porque es el
   * de la matrícula; la API de contenido no lo devuelve.
   */
  | { type: 'course'; moodleCourseId: number; titulo: string }
  /**
   * Programa del estudiante: la vista con la que se entra a la plataforma.
   * Es la que faltaba para que el portal hablara de programas, igual que ya
   * hacen el catálogo y el panel.
   */
  | { type: 'my-program' }
  | { type: 'my-courses' }
  | { type: 'academics' }
  | { type: 'profile' }
  | { type: 'enterprise' }
  | { type: 'contact' }
  // Una sola vista para todas las páginas institucionales (Quiénes somos,
  // Admisiones, Términos, Privacidad, FERPA, Título IX, Accesibilidad). El
  // contenido vive en la API y lo edita el panel, así que añadir una página
  // más no toca este tipo.
  | { type: 'page'; slug: string };

type CourseModule = NonNullable<MoodleCourseContentResponse['sections'][number]['modules']>[number];

type FlatModule = {
  sectionName: string;
  module: CourseModule;
};

type CourseProgress = {
  completedModuleIds: number[];
  interactionsCount: number;
  xp: number;
  lastActivityAt: string | null;
  totalModules: number;
  progressPercent: number;
};

type ContentRow = {
  id: string;
  title: string;
  subtitle?: string;
  items: ProgramaPublico[];
};

const DEFAULT_PROGRESS: CourseProgress = {
  completedModuleIds: [],
  interactionsCount: 0,
  xp: 0,
  lastActivityAt: null,
  totalModules: 0,
  progressPercent: 0
};

const PUBLIC_SESSION_STORAGE = 'atlas-public-session';
const EMAIL_REGEX_FALLBACK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

function toPlainText(html?: string): string {
  if (!html) {
    return '';
  }
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s\-_]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim();
}

function toCategoryRowId(category: string): string {
  return `category-${category
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')}`;
}

function snippet(html?: string, title?: string, max = 160): string {
  let text = toPlainText(html);
  if (title && text) {
    const normalizedTitle = normalizeText(title);
    const normalizedText = normalizeText(text);
    if (normalizedTitle && normalizedText.startsWith(normalizedTitle)) {
      text = text.slice(title.length).replace(/^[:\-–—\s]+/, '').trim();
    }
  }
  if (!text) {
    return 'Sin descripción.';
  }
  return text.length > max ? `${text.slice(0, max).trim()}...` : text;
}

function progressStorageKey(courseId: number): string {
  return `atlas-progress-${courseId}`;
}

function loadCourseProgress(courseId: number): CourseProgress {
  const raw = localStorage.getItem(progressStorageKey(courseId));
  if (!raw) {
    return { ...DEFAULT_PROGRESS };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<CourseProgress>;
    return {
      completedModuleIds: Array.isArray(parsed.completedModuleIds)
        ? parsed.completedModuleIds.filter((id): id is number => typeof id === 'number')
        : [],
      interactionsCount: typeof parsed.interactionsCount === 'number' ? parsed.interactionsCount : 0,
      xp: typeof parsed.xp === 'number' ? parsed.xp : 0,
      lastActivityAt: typeof parsed.lastActivityAt === 'string' ? parsed.lastActivityAt : null,
      totalModules: typeof parsed.totalModules === 'number' && parsed.totalModules > 0 ? parsed.totalModules : 0,
      progressPercent:
        typeof parsed.progressPercent === 'number' && parsed.progressPercent >= 0 ? parsed.progressPercent : 0
    };
  } catch {
    return { ...DEFAULT_PROGRESS };
  }
}

function saveCourseProgress(courseId: number, progress: CourseProgress): void {
  localStorage.setItem(progressStorageKey(courseId), JSON.stringify(progress));
}

function fromApiProgress(record: PublicCourseProgressRecord): CourseProgress {
  const completedModuleIds = Array.isArray(record.completed_module_ids)
    ? record.completed_module_ids
      .map((id) => Number(id))
      .filter((id): id is number => Number.isInteger(id) && id > 0)
    : [];
  return {
    completedModuleIds,
    interactionsCount: Number(record.interactions_count ?? 0),
    xp: Number(record.xp ?? 0),
    totalModules: Number(record.total_modules ?? 0),
    progressPercent: Number(record.progress_percent ?? 0),
    lastActivityAt: record.last_activity_at ?? null
  };
}

function toApiProgress(progress: CourseProgress) {
  return {
    completedModuleIds: progress.completedModuleIds,
    interactionsCount: progress.interactionsCount,
    xp: progress.xp,
    totalModules: progress.totalModules,
    progressPercent: progress.progressPercent,
    lastActivityAt: progress.lastActivityAt ?? undefined
  };
}

/**
 * Páginas institucionales que tienen URL propia.
 *
 * Son las rutas que el CDN sirve como alias del index (ver SPA_FALLBACK_ROUTES
 * en infra/deploy/00-config.sh): si se añade una aquí hay que añadirla allí, o
 * el enlace directo devuelve 403 de S3.
 */
const PAGE_PATH_BY_SLUG: Record<string, string> = {
  about: '/about',
  admissions: '/admissions',
  'campus-life': '/vida-estudiantil',
  athletics: '/atletismo',
  'news-events': '/noticias',
  terms: '/terminos',
  privacy: '/privacidad',
  ferpa: '/ferpa',
  'title-ix': '/title-ix',
  accessibility: '/accesibilidad'
};

/**
 * Vistas propias del SPA —no páginas editables— que también tienen URL.
 *
 * El catálogo y el contacto se alcanzaban sólo haciendo clic: escribir
 * /programas o /contact en la barra de direcciones caía en la portada, porque
 * sólo las páginas institucionales resolvían su ruta. Los alias ya existen en
 * el CDN (SPA_FALLBACK_ROUTES), así que faltaba únicamente el mapa.
 */
const VIEW_PATHS: Record<'catalog' | 'contact', string> = {
  catalog: '/programas',
  contact: '/contact'
};

const VIEW_BY_PATH: Record<string, 'catalog' | 'contact'> = {
  '/programas': 'catalog',
  '/contact': 'contact'
};

/**
 * Ruta de la ficha de un programa.
 *
 * Es /programas/<slug>. El CDN de Lightsail no tiene reescritura comodín —sólo
 * un objeto por ruta—, así que el despliegue publica un alias por cada programa
 * del catálogo (PROGRAM_FALLBACK_SLUGS en infra/deploy/00-config.sh). Un slug
 * nuevo en Moodle necesita su alias allí, o el enlace directo devuelve 403.
 */
const PROGRAM_PATH_PREFIX = '/programas/';

function programSlugFromPath(pathname: string): string | null {
  if (!pathname.startsWith(PROGRAM_PATH_PREFIX)) {
    return null;
  }
  const slug = pathname.slice(PROGRAM_PATH_PREFIX.length).replace(/\/$/, '');
  return slug.length > 0 ? slug : null;
}

const PAGE_SLUG_BY_PATH: Record<string, string> = {
  '/about': 'about',
  '/quienes-somos': 'about',
  '/admissions': 'admissions',
  '/admisiones': 'admissions',
  '/vida-estudiantil': 'campus-life',
  '/campus-life': 'campus-life',
  '/atletismo': 'athletics',
  '/athletics': 'athletics',
  '/noticias': 'news-events',
  '/news-events': 'news-events',
  '/terminos': 'terms',
  '/terminos-y-condiciones': 'terms',
  '/privacidad': 'privacy',
  '/politica-de-privacidad': 'privacy',
  '/ferpa': 'ferpa',
  '/title-ix': 'title-ix',
  '/titulo-ix': 'title-ix',
  '/accesibilidad': 'accessibility',
  '/accessibility': 'accessibility'
};

/**
 * Navegación principal.
 *
 * Los seis destinos son los del mockup de web del manual de marca. Tres ya
 * existían como vistas (catálogo, acerca, admisiones) y tres se añadieron como
 * páginas institucionales editables desde el panel: vida estudiantil,
 * atletismo y noticias. Están publicadas y vacías de afirmaciones: dicen lo
 * que hoy es cierto y señalan lo que TFU aún no ha definido, en vez de
 * anunciar equipos o clubes que no existen.
 *
 * Se declara como dato y no como seis bloques de JSX porque la misma lista
 * alimenta la barra de escritorio y la hoja del móvil; duplicarla garantizaría
 * que un día dejaran de coincidir.
 */
type NavItem = { key: string; view: ViewState };

const TOP_NAV: NavItem[] = [
  { key: 'nav.navAbout', view: { type: 'page', slug: 'about' } },
  { key: 'nav.navAcademics', view: { type: 'catalog' } },
  { key: 'nav.navAdmissions', view: { type: 'page', slug: 'admissions' } },
  { key: 'nav.navCampusLife', view: { type: 'page', slug: 'campus-life' } },
  { key: 'nav.navAthletics', view: { type: 'page', slug: 'athletics' } },
  { key: 'nav.navNews', view: { type: 'page', slug: 'news-events' } }
];

/**
 * La navegación de quien ya está dentro.
 *
 * El menú de arriba es el de un visitante que todavía está decidiendo:
 * «Acerca de», «Admisiones», «Vida estudiantil», «Postular ahora». A un
 * estudiante matriculado no le sirve ninguno —ya postuló, ya entró— y, peor,
 * le esconde lo único que viene a hacer: ver su programa, entrar al aula y
 * mirar sus notas. Con sesión iniciada el menú se cambia entero por el suyo.
 *
 * «Oferta académica» se queda al final a propósito: el catálogo sigue siendo
 * útil dentro —es donde se ve qué más ofrece TFU— y es la puerta de vuelta al
 * sitio público sin tener que cerrar sesión.
 */
const STUDENT_NAV: NavItem[] = [
  { key: 'nav.myProgram', view: { type: 'my-program' } },
  { key: 'nav.myCourses', view: { type: 'my-courses' } },
  { key: 'nav.academics', view: { type: 'academics' } },
  { key: 'nav.profile', view: { type: 'profile' } },
  { key: 'nav.catalog', view: { type: 'catalog' } }
];

function isNavActive(view: ViewState, item: NavItem): boolean {
  if (item.view.type === 'page') {
    return view.type === 'page' && view.slug === item.view.slug;
  }
  return view.type === item.view.type;
}

/** Las que van en el pie, en orden. El resto se enlazan desde el menú. */
const FOOTER_PAGE_SLUGS = ['terms', 'privacy', 'ferpa', 'title-ix', 'accessibility'];

/**
 * Elige el idioma de un programa y de los cursos de su temario.
 *
 * Se resuelve aquí y no en la plantilla porque el programa se pinta en cuatro
 * sitios (portada, catálogo, ficha y bloque de similares) y en cada uno habría
 * que repetir el `?? `: basta con que uno se olvide para que una tarjeta salga
 * a medio traducir. Cuando no hay versión inglesa se deja el español, que es
 * contenido real, antes que un hueco.
 */
function localizarPrograma(programa: ProgramaPublico, lang: string): ProgramaPublico {
  if (lang !== 'en') {
    return programa;
  }
  return {
    ...programa,
    title: programa.titleEn ?? programa.title,
    summary: programa.summaryEn ?? programa.summary,
    courses: programa.courses.map((curso) => ({
      ...curso,
      titulo: curso.tituloEn ?? curso.titulo,
      resumen: curso.resumenEn ?? curso.resumen
    }))
  };
}

/**
 * Cada familia de programas tiene su propio acento dentro de la paleta de
 * Peregrine. Sin esto las cinco categorías se pintaban con el mismo cian y el
 * catálogo se leía como una sola masa.
 *
 * El emparejamiento se hace contra la raíz del nombre y no contra el nombre
 * completo, para que funcione igual en español y en inglés sin mantener dos
 * listas ("Ventas y Crecimiento..." / "Sales and Revenue Growth").
 */
const CATEGORY_ACCENTS: Array<{ match: RegExp; key: string }> = [
  { match: /\b(sales|ventas)\b/i, key: 'sales' },
  { match: /(customer|cliente)/i, key: 'cx' },
  { match: /(leadership|liderazgo)/i, key: 'leadership' },
  { match: /(\bai\b|\bia\b|artificial)/i, key: 'ai' },
  { match: /(education|educativa|school|escuela)/i, key: 'education' }
];

function categoryAccentKey(label: string): string {
  return CATEGORY_ACCENTS.find((entry) => entry.match.test(label))?.key ?? 'neutral';
}

/**
 * Los eventos en vivo guardan su traducción en columnas aparte (title_en, ...).
 * La API las devuelve con COALESCE sobre el español, así que aquí basta con
 * elegir la columna y nunca sale una tarjeta a medio traducir.
 */
function localizeWebinar(webinar: WebinarRecord, lang: string) {
  const en = lang === 'en';
  return {
    title: en ? webinar.title_en : webinar.title,
    subtitle: en ? webinar.subtitle_en : webinar.subtitle,
    description: en ? webinar.description_en : webinar.description,
    ctaLabel: en ? webinar.cta_label_en : webinar.cta_label
  };
}

/**
 * Fecha del evento en su propia zona horaria y con ella escrita: un webinar a
 * las 16:00 no significa nada si el lector no sabe de dónde son esas 16:00.
 */
function webinarWhen(webinar: WebinarRecord, lang: string): string {
  const locale = lang === 'en' ? 'en-US' : 'es-ES';
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: webinar.timezone || 'UTC',
      timeZoneName: 'short'
    }).format(new Date(webinar.starts_at));
  } catch {
    // Una zona horaria inválida guardada desde el admin no debe tumbar la portada.
    return new Date(webinar.starts_at).toLocaleString(locale);
  }
}

function normalizarEtiquetaArea(value: string): string {
  const trimmed = value.trim();
  const normalized = trimmed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (
    ['certification', 'certifications', 'certificacion', 'certificaciones'].includes(normalized) ||
    normalized.includes('mas vendidos')
  ) {
    return 'Más vendidos';
  }
  return trimmed;
}

/**
 * El área del programa: `tags[0]`, que es de donde tira el filtro del catálogo.
 *
 * El área viene del primer curso del programa en Moodle, así que un programa
 * cuyas aulas no estén categorizadas puede llegar sin ella. Se devuelve cadena
 * vacía en ese caso y quien la pinta la omite, en vez de escribir «Sin
 * categoría» en la tarjeta, que es texto que nadie ha decidido mostrar.
 */
function areaDelPrograma(programa: ProgramaPublico): string {
  const area = programa.tags.find((tag) => tag.trim().length > 0);
  return area ? normalizarEtiquetaArea(area) : '';
}

function isMoodleProtectedFileUrl(url: string): boolean {
  return (
    url.includes('/pluginfile.php') ||
    url.includes('/webservice/pluginfile.php') ||
    url.includes('/draftfile.php')
  );
}

function proxifyMoodleHtml(html: string, token: string): string {
  if (!html || !token) {
    return html;
  }
  return html.replace(/\b(href|src)=["']([^"']+)["']/gi, (full, attr, rawUrl) => {
    const normalized = String(rawUrl).replace(/&amp;/g, '&').trim();
    const isRelativeProtected =
      normalized.startsWith('/pluginfile.php') ||
      normalized.startsWith('/webservice/pluginfile.php') ||
      normalized.startsWith('/draftfile.php');
    if (isMoodleProtectedFileUrl(normalized) || isRelativeProtected) {
      const proxied = api.moodleFileUrl(normalized, token);
      return `${attr}="${proxied}"`;
    }
    return full;
  });
}

function isVideoContentFile(input: { mimetype?: string; filename?: string }): boolean {
  const mime = (input.mimetype ?? '').toLowerCase();
  if (mime.startsWith('video/')) {
    return true;
  }
  const filename = (input.filename ?? '').toLowerCase();
  return ['.mp4', '.m4v', '.webm', '.ogg', '.mov'].some((ext) => filename.endsWith(ext));
}

function webinarState(webinar: WebinarRecord, now = Date.now()): 'upcoming' | 'live' | 'ended' {
  const start = Date.parse(webinar.starts_at);
  const end = webinar.ends_at ? Date.parse(webinar.ends_at) : start + 90 * 60000;
  if (Number.isFinite(start) && now < start) {
    return 'upcoming';
  }
  if (Number.isFinite(start) && Number.isFinite(end) && now >= start && now <= end) {
    return 'live';
  }
  return 'ended';
}

function webinarLiveLinks(webinar: WebinarRecord): Array<{ platform: string; url: string }> {
  const links = Array.isArray(webinar.webinar_links)
    ? webinar.webinar_links.filter(
      (item): item is { platform: string; url: string } =>
        Boolean(item && typeof item.platform === 'string' && typeof item.url === 'string' && item.url.trim())
    )
    : [];
  if (links.length > 0) {
    return links;
  }
  return [{ platform: webinar.source_type, url: webinar.source_url }];
}

function extractYouTubeCode(input: string): string | null {
  const raw = input.trim();
  if (!raw) {
    return null;
  }
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) {
    return raw;
  }
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (host.includes('youtu.be')) {
      const value = url.pathname.replace(/\//g, '');
      return /^[A-Za-z0-9_-]{11}$/.test(value) ? value : null;
    }
    if (host.includes('youtube.com')) {
      const fromQuery = url.searchParams.get('v');
      if (fromQuery && /^[A-Za-z0-9_-]{11}$/.test(fromQuery)) {
        return fromQuery;
      }
      if (url.pathname.startsWith('/shorts/') || url.pathname.startsWith('/embed/')) {
        const fromPath = url.pathname.split('/')[2] ?? '';
        return /^[A-Za-z0-9_-]{11}$/.test(fromPath) ? fromPath : null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function youtubeEmbedUrl(input: string): string | null {
  const code = extractYouTubeCode(input);
  return code ? `https://www.youtube.com/embed/${code}?rel=0&modestbranding=1` : null;
}

function youtubeThumbUrl(input: string): string {
  const code = extractYouTubeCode(input);
  return code ? `https://i.ytimg.com/vi/${code}/hqdefault.jpg` : 'https://picsum.photos/seed/atlas-podcast/640/360';
}

function generateStrongPassword(length = 14): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*';
  const all = `${upper}${lower}${digits}${symbols}`;
  const pick = (alphabet: string) => alphabet[Math.floor(Math.random() * alphabet.length)];
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < length) {
    chars.push(pick(all));
  }
  return chars.sort(() => Math.random() - 0.5).join('');
}

function getPasswordValidation(password: string): string[] {
  const issues: string[] = [];
  if (password.length < 10) {
    issues.push('mínimo 10 caracteres');
  }
  if (!/[A-Z]/.test(password)) {
    issues.push('al menos una mayúscula');
  }
  if (!/[a-z]/.test(password)) {
    issues.push('al menos una minúscula');
  }
  if (!/[0-9]/.test(password)) {
    issues.push('al menos un número');
  }
  if (!/[!@#$%^&*]/.test(password)) {
    issues.push('al menos un símbolo !@#$%^&*');
  }
  return issues;
}

function isValidEmail(value: string): boolean {
  const email = value.trim();
  if (!email) {
    return false;
  }
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const probe = document.createElement('input');
    probe.type = 'email';
    probe.value = email;
    if (!probe.checkValidity()) {
      return false;
    }
  }
  return EMAIL_REGEX_FALLBACK.test(email);
}

function PasswordToggleIcon({ visible }: { visible: boolean }) {
  if (visible) {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          d="M3 3l18 18M10.58 10.58A2 2 0 0012 14a2 2 0 001.42-.58M9.88 5.09A9.77 9.77 0 0112 5c5 0 9 5 9 7a11.8 11.8 0 01-2.21 3.13M6.09 6.09C3.58 7.74 2 10.06 2 12c0 2 4 7 10 7 1.94 0 3.69-.52 5.2-1.34"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

/**
 * Tarjeta de programa de las filas de la portada.
 *
 * Abre la ficha del programa, nunca un curso: los cursos de un programa no
 * tienen página propia. Bajo el nombre indica cuántos cursos incluye, que es
 * lo que antes ocupaban las horas del curso.
 */
function TarjetaPrograma({
  programa,
  onAbrir,
  etiquetaCursos
}: {
  programa: ProgramaPublico;
  onAbrir: (programa: ProgramaPublico) => void;
  etiquetaCursos: (total: number) => string;
}) {
  const area = areaDelPrograma(programa);
  return (
    <button
      className="content-tile"
      data-accent={categoryAccentKey(area)}
      onClick={() => onAbrir(programa)}
    >
      {programa.heroImage ? <img src={programa.heroImage} alt={programa.title} loading="lazy" /> : null}
      <div className="tile-overlay">
        {area ? <span className="category-chip">{area}</span> : null}
        <h4>{programa.title}</h4>
        {programa.courseCount > 0 ? <p className="tile-meta">{etiquetaCursos(programa.courseCount)}</p> : null}
      </div>
    </button>
  );
}

export function PublicApp() {
  const { t, i18n: i18nInstance } = useTranslation();
  const currentLang = i18nInstance.language?.startsWith('en') ? 'en' : 'es';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [home, setHome] = useState<PublicHomeResponse | null>(null);
  const [catalog, setCatalog] = useState<ProgramaPublico[]>([]);
  const [webinars, setWebinars] = useState<WebinarRecord[]>([]);
  const [podcasts, setPodcasts] = useState<PodcastRecord[]>([]);
  const [view, setView] = useState<ViewState>({ type: 'home' });
  const [search, setSearch] = useState('');
  const [catalogGroupFilter, setCatalogGroupFilter] = useState('all');
  const [catalogSort, setCatalogSort] = useState<'default' | 'az'>('default');
  const [catalogVisibleCount, setCatalogVisibleCount] = useState(24);

  const [publicSession, setPublicSession] = useState<PublicSession | null>(() => {
    try {
      const raw = localStorage.getItem(PUBLIC_SESSION_STORAGE);
      return raw ? (JSON.parse(raw) as PublicSession) : null;
    } catch {
      return null;
    }
  });
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('register');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [registerForm, setRegisterForm] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    locale: 'es',
    acceptedTerms: false
  });
  const [loginForm, setLoginForm] = useState({ email: '', password: '', acceptedTerms: false });
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showRegisterConfirmPassword, setShowRegisterConfirmPassword] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileForm, setProfileForm] = useState({ fullName: '', email: '', locale: 'es' });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [selectedDetail, setSelectedDetail] = useState<CatalogContentDetailResponse | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [courseContent, setCourseContent] = useState<MoodleCourseContentResponse | null>(null);
  const [loadingCourseContent, setLoadingCourseContent] = useState(false);
  const [courseContentError, setCourseContentError] = useState<string | null>(null);

  const [activeModuleId, setActiveModuleId] = useState<number | null>(null);
  const [activeFileUrl, setActiveFileUrl] = useState<string | null>(null);
  const [interactionText, setInteractionText] = useState('');
  const [interactionSaving, setInteractionSaving] = useState(false);
  const [interactionMessage, setInteractionMessage] = useState<string | null>(null);
  const [interactionHistory, setInteractionHistory] = useState<PublicCourseInteractionRecord[]>([]);
  const [victoryState, setVictoryState] = useState<{ moduleName: string; xp: number } | null>(null);

  const [progress, setProgress] = useState<CourseProgress>({ ...DEFAULT_PROGRESS });
  const [heroIndex, setHeroIndex] = useState(0);
  const [myCourses, setMyCourses] = useState<PublicMyCoursesResponse | null>(null);
  const [myCoursesLoading, setMyCoursesLoading] = useState(false);
  const [enterpriseOverview, setEnterpriseOverview] = useState<EnterpriseOverviewResponse | null>(null);
  const [enterpriseLoading, setEnterpriseLoading] = useState(false);
  const [enterpriseSaving, setEnterpriseSaving] = useState(false);
  const [enterpriseMemberForm, setEnterpriseMemberForm] = useState({
    fullName: '',
    email: '',
    locale: 'es'
  });
  const [enterpriseCourseId, setEnterpriseCourseId] = useState('');
  const [podcastPreview, setPodcastPreview] = useState<{ title: string; embedUrl: string } | null>(null);
  const [progressByCourseId, setProgressByCourseId] = useState<Record<number, CourseProgress>>({});
  // Caché por slug+idioma: la misma página en dos idiomas son dos documentos.
  const [sitePages, setSitePages] = useState<Record<string, LegalPageResponse>>({});
  const [pageIndex, setPageIndex] = useState<SitePageSummary[]>([]);
  const [loadingLegal, setLoadingLegal] = useState(false);
  const categorySectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const continueLearningRowRef = useRef<HTMLDivElement | null>(null);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const [pendingCategoryId, setPendingCategoryId] = useState<string | null>(null);

  useEffect(() => {
    const path = window.location.pathname;
    const slug = PAGE_SLUG_BY_PATH[path];
    if (slug) {
      setView({ type: 'page', slug });
      return;
    }
    const viewType = VIEW_BY_PATH[path];
    if (viewType) {
      setView({ type: viewType });
      return;
    }
    const programSlug = programSlugFromPath(path);
    if (programSlug) {
      setView({ type: 'detail', slug: programSlug });
    }
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [view.type]);

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      setError(null);
      try {
        const [homeResponse, catalogResponse, webinarsResponse, podcastsResponse] = await Promise.all([
          api.home(),
          api.catalog(),
          api.webinars(),
          api.podcasts()
        ]);
        setHome(homeResponse);
        setCatalog(catalogResponse);
        setWebinars(webinarsResponse);
        setPodcasts(podcastsResponse);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Error cargando la plataforma');
      } finally {
        setLoading(false);
      }
    };

    void bootstrap();
  }, []);

  useEffect(() => {
    const updatePath = () => {
      if (view.type === 'page') {
        window.history.replaceState(null, '', PAGE_PATH_BY_SLUG[view.slug] ?? `/${view.slug}`);
        return;
      }
      if (view.type === 'catalog' || view.type === 'contact') {
        window.history.replaceState(null, '', VIEW_PATHS[view.type]);
        return;
      }
      if (view.type === 'detail') {
        window.history.replaceState(null, '', `${PROGRAM_PATH_PREFIX}${view.slug}`);
        return;
      }
      if (
        PAGE_SLUG_BY_PATH[window.location.pathname] ||
        VIEW_BY_PATH[window.location.pathname] ||
        programSlugFromPath(window.location.pathname)
      ) {
        window.history.replaceState(null, '', '/');
      }
    };
    updatePath();
    // El slug entra en las dependencias: entre dos fichas de programa —o entre
    // dos páginas institucionales— cambia el slug y no el tipo, y sin esto la
    // barra de direcciones se quedaba en la anterior.
  }, [view.type, 'slug' in view ? view.slug : null]);

  useEffect(() => {
    if (!publicSession?.token) {
      return;
    }
    void api.publicAuth
      .me(publicSession.token)
      .then((result) => {
        setPublicSession((current) =>
          current
            ? {
              ...current,
              user: {
                ...current.user,
                fullName: result.user.fullName,
                email: result.user.email,
                locale: result.user.locale
              },
              expiresAt: result.expiresAt
            }
            : current
        );
      })
      .catch(() => {
        setPublicSession(null);
        localStorage.removeItem(PUBLIC_SESSION_STORAGE);
      });
  }, []);

  useEffect(() => {
    if (!publicSession) {
      setProfileForm({ fullName: '', email: '', locale: 'es' });
      return;
    }
    setProfileForm({
      fullName: publicSession.user.fullName ?? '',
      email: publicSession.user.email ?? '',
      locale: publicSession.user.locale ?? 'es'
    });
  }, [publicSession?.user.fullName, publicSession?.user.email, publicSession?.user.locale, publicSession]);

  const programasLocalizados = useMemo(
    () => catalog.map((programa) => localizarPrograma(programa, currentLang)),
    [catalog, currentLang]
  );

  /**
   * Plural de «curso» para las tarjetas. Se envuelve aquí porque lo piden la
   * tarjeta de portada, la del catálogo y la de programas similares, y así el
   * contador de cursos se escribe en un solo sitio.
   */
  const etiquetaCursosIncluidos = (total: number) => t('catalog.includesCourses', { count: total });

  const heroItems = useMemo(() => {
    if (!home || programasLocalizados.length === 0) {
      return [] as ProgramaPublico[];
    }
    const mezclados = [...programasLocalizados].sort(() => Math.random() - 0.5);
    return mezclados.slice(0, 5);
  }, [home, programasLocalizados]);

  useEffect(() => {
    setHeroIndex(0);
  }, [heroItems.length]);

  useEffect(() => {
    if (view.type !== 'home' || heroItems.length <= 1) {
      return;
    }
    const timer = setInterval(() => {
      setHeroIndex((current) => (current + 1) % heroItems.length);
    }, 5500);
    return () => clearInterval(timer);
  }, [view.type, heroItems.length]);

  const activeHero = heroItems[heroIndex] ?? null;

  useEffect(() => {
    if (view.type !== 'detail') {
      setSelectedDetail(null);
      return;
    }

    const cargarFicha = async () => {
      setLoadingDetail(true);
      setError(null);
      try {
        // El idioma va en la petición porque el plan de ocho semanas lo traduce
        // la API; el resto del programa se localiza aquí.
        const detail = await api.catalogBySlug(view.slug, currentLang);
        const programa = localizarPrograma(detail.program ?? detail.content, currentLang);
        setSelectedDetail({
          ...detail,
          content: programa,
          program: programa,
          related: (detail.related ?? []).map((item) => localizarPrograma(item, currentLang))
        });
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Error cargando detalle');
      } finally {
        setLoadingDetail(false);
      }
    };

    void cargarFicha();
  }, [view, currentLang]);

  useEffect(() => {
    // Al aula sólo se llega desde «Mis cursos», que ya exige sesión; si la
    // sesión caducó mientras el aula estaba abierta, se pide de nuevo.
    if (view.type !== 'course' || publicSession?.token) {
      return;
    }
    if (!showAuthModal) {
      setAuthMode('login');
      setShowAuthModal(true);
    }
  }, [view, publicSession?.token, showAuthModal]);

  const loadMyCourses = async (token: string) => {
    setMyCoursesLoading(true);
    try {
      const result = await api.publicAuth.meCourses(token);
      setMyCourses(result);
      const mapped: Record<number, CourseProgress> = {};
      for (const row of result.progressRecords ?? []) {
        const courseId = Number(row.moodle_course_id);
        if (Number.isInteger(courseId) && courseId > 0) {
          mapped[courseId] = fromApiProgress(row);
        }
      }
      setProgressByCourseId(mapped);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudieron cargar tus cursos');
    } finally {
      setMyCoursesLoading(false);
    }
  };

  const hydrateAuthenticatedData = async (session: PublicSession) => {
    await Promise.all([
      loadMyCourses(session.token),
      loadEnterpriseOverview(session.token)
    ]);
  };

  const loadEnterpriseOverview = async (token: string) => {
    setEnterpriseLoading(true);
    try {
      const result = await api.publicAuth.enterpriseOverview(token);
      setEnterpriseOverview(result);
    } catch {
      setEnterpriseOverview(null);
    } finally {
      setEnterpriseLoading(false);
    }
  };

  useEffect(() => {
    if (!publicSession?.token) {
      setMyCourses(null);
      setEnterpriseOverview(null);
      return;
    }
    void hydrateAuthenticatedData(publicSession);
  }, [publicSession?.token]);

  useEffect(() => {
    // El índice alimenta los títulos del pie y del menú; se recarga al cambiar
    // de idioma porque los títulos vienen ya traducidos de la API.
    void api
      .sitePages(currentLang)
      .then(setPageIndex)
      .catch(() => setPageIndex([]));
  }, [currentLang]);

  useEffect(() => {
    if (view.type !== 'page') {
      return;
    }
    const cacheKey = `${view.slug}:${currentLang}`;
    if (sitePages[cacheKey]) {
      return;
    }
    const loadPage = async () => {
      setLoadingLegal(true);
      setError(null);
      try {
        const data = await api.sitePage(view.slug, currentLang);
        setSitePages((current) => ({ ...current, [cacheKey]: data }));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'No se pudo cargar la página');
      } finally {
        setLoadingLegal(false);
      }
    };
    void loadPage();
  }, [view, currentLang, sitePages]);

  /**
   * Curso del aula abierta. Sale de la vista y no de la ficha del programa:
   * la ficha es pública y sus cursos no llevan identificador de Moodle, así
   * que la única fuente del id es la matrícula con la que se abrió el aula.
   */
  const cursoAbiertoId = view.type === 'course' ? view.moodleCourseId : null;

  useEffect(() => {
    const moodleCourseId = Number(cursoAbiertoId);
    if (!Number.isInteger(moodleCourseId) || moodleCourseId <= 0) {
      setCourseContent(null);
      setCourseContentError(null);
      setActiveModuleId(null);
      return;
    }

    if (!publicSession?.token) {
      setCourseContent(null);
      setCourseContentError('Debes registrarte o iniciar sesión para entrar al curso.');
      return;
    }

    const loadCourseContent = async () => {
      setLoadingCourseContent(true);
      setCourseContentError(null);
      setInteractionMessage(null);
      try {
        const [response, remoteProgress, interactionsResult] = await Promise.all([
          api.courseContent(moodleCourseId, publicSession.token),
          api.courseProgress(moodleCourseId, publicSession.token),
          api.courseInteractions(moodleCourseId, publicSession.token)
        ]);
        setCourseContent(response);
        setInteractionHistory(interactionsResult.interactions ?? []);
        if (remoteProgress.found && remoteProgress.progress) {
          const mapped = fromApiProgress(remoteProgress.progress);
          setProgress(mapped);
          setProgressByCourseId((current) => ({
            ...current,
            [moodleCourseId]: mapped
          }));
        } else if (progressByCourseId[moodleCourseId]) {
          setProgress(progressByCourseId[moodleCourseId]);
        } else {
          setProgress({ ...DEFAULT_PROGRESS });
        }
        if (!response.available) {
          setCourseContentError(response.error ?? 'El contenido detallado de Moodle no está disponible.');
        }
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : 'Error cargando contenido del curso';
        setCourseContentError(message);
        if (message.includes('401')) {
          // La sesión caducó dentro del aula: se limpia y se vuelve a pedir.
          setPublicSession(null);
          localStorage.removeItem(PUBLIC_SESSION_STORAGE);
          setAuthMode('login');
          setShowAuthModal(true);
        }
      } finally {
        setLoadingCourseContent(false);
      }
    };

    void loadCourseContent();
  }, [cursoAbiertoId, publicSession?.token]);

  /**
   * La búsqueda mira también los cursos del temario: alguien que busca
   * «objeciones» espera encontrar el programa que lo enseña, aunque esa palabra
   * sólo aparezca en el nombre de uno de sus cursos y no en el del programa.
   */
  const programasFiltrados = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return programasLocalizados;
    }
    return programasLocalizados.filter((programa) => {
      return (
        programa.title.toLowerCase().includes(query) ||
        toPlainText(programa.summary ?? '').toLowerCase().includes(query) ||
        programa.tags.some((tag) => tag.toLowerCase().includes(query)) ||
        programa.courses.some(
          (curso) =>
            curso.titulo.toLowerCase().includes(query) ||
            toPlainText(curso.resumen ?? '').toLowerCase().includes(query)
        )
      );
    });
  }, [programasLocalizados, search]);

  /** Las áreas presentes en el catálogo, para el filtro. */
  const areasDelCatalogo = useMemo(() => {
    const values = new Set<string>();
    for (const programa of programasLocalizados) {
      const area = areaDelPrograma(programa);
      if (area) {
        values.add(area);
      }
    }
    return [...values].sort((a, b) => a.localeCompare(b, 'es'));
  }, [programasLocalizados]);

  const catalogViewItems = useMemo(() => {
    const filtered = programasFiltrados.filter(
      (programa) => catalogGroupFilter === 'all' || areaDelPrograma(programa) === catalogGroupFilter
    );

    const withIndex = filtered.map((programa, index) => ({ programa, index }));
    withIndex.sort((a, b) => {
      if (catalogSort === 'az') {
        return a.programa.title.localeCompare(b.programa.title, 'es');
      }
      return a.index - b.index;
    });
    return withIndex.map((entry) => entry.programa);
  }, [programasFiltrados, catalogGroupFilter, catalogSort]);

  const catalogShownItems = useMemo(
    () => catalogViewItems.slice(0, Math.max(1, catalogVisibleCount)),
    [catalogViewItems, catalogVisibleCount]
  );

  useEffect(() => {
    setCatalogVisibleCount(24);
  }, [search, catalogGroupFilter, catalogSort]);

  const rows = useMemo<ContentRow[]>(() => {
    if (!home) {
      return [];
    }

    const porArea = new Map<string, ProgramaPublico[]>();
    for (const programa of programasLocalizados) {
      const area = areaDelPrograma(programa);
      if (!area) {
        continue;
      }
      if (!porArea.has(area)) {
        porArea.set(area, []);
      }
      porArea.get(area)?.push(programa);
    }

    const filasPorArea = [...porArea.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([area, items]) => ({
        id: toCategoryRowId(area),
        title: area,
        items
      }));

    const filaMasVendidos = filasPorArea.find((row) => row.title === 'Más vendidos');
    const filasOrdenadas = filasPorArea.filter((row) => row.title !== 'Más vendidos');
    if (filaMasVendidos) {
      filasOrdenadas.push(filaMasVendidos);
    }

    const base: ContentRow[] = [
      {
        id: 'continue-learning',
        title: t('home.continueLearning'),
        subtitle: t('home.continueLearningSubtitle'),
        items:
          home.continueLearning.length > 0
            ? home.continueLearning.map((programa) => localizarPrograma(programa, currentLang))
            : programasLocalizados
      },
      {
        id: 'all-programs',
        title: t('home.allPrograms'),
        subtitle: t('home.allProgramsSubtitle'),
        items: programasLocalizados
      }
    ];

    return [...base, ...filasOrdenadas].filter((row) => row.items.length > 0);
  }, [home, programasLocalizados, currentLang, t]);

  const topMenuCategories = useMemo(() => {
    return rows
      .filter((row) => row.id.startsWith('category-') && row.title !== 'Más vendidos')
      .map((row) => ({ id: row.id, title: row.title }));
  }, [rows]);

  /**
   * Los cursos del estudiante salen de sus matrículas, no del catálogo público.
   *
   * Antes se cruzaba la matrícula con el catálogo para sacar la portada y el
   * título de cada curso. Ya no se puede ni se debe: el catálogo devuelve
   * programas y sus cursos no llevan identificador de Moodle. La matrícula trae
   * el nombre del aula, que es el dato autoritativo de todas formas.
   */
  const misCursos = useMemo(() => {
    return (myCourses?.localCourses ?? [])
      .filter((curso) => String(curso.status) === 'active')
      .map((curso) => ({
        moodleCourseId: Number(curso.moodle_course_id),
        titulo: curso.full_name ?? curso.short_name ?? '',
        matriculadoEn: curso.enrolled_at
      }))
      .filter((curso) => Number.isInteger(curso.moodleCourseId) && curso.moodleCourseId > 0);
  }, [myCourses]);

  const flatModules = useMemo<FlatModule[]>(() => {
    if (!courseContent?.available) {
      return [];
    }
    const modules: FlatModule[] = [];
    for (const section of courseContent.sections) {
      const sectionName = section.name || `Sección ${section.section ?? ''}`;
      for (const module of section.modules ?? []) {
        modules.push({ sectionName, module });
      }
    }
    return modules;
  }, [courseContent]);

  useEffect(() => {
    if (flatModules.length === 0) {
      setActiveModuleId(null);
      return;
    }
    const exists = flatModules.some((row) => row.module.id === activeModuleId);
    if (!exists) {
      const firstIncomplete = flatModules.find((row) => !progress.completedModuleIds.includes(row.module.id));
      setActiveModuleId(firstIncomplete?.module.id ?? flatModules[0].module.id);
      setActiveFileUrl(null);
    }
  }, [flatModules, activeModuleId, progress.completedModuleIds]);

  const activeModule = useMemo(() => {
    return flatModules.find((row) => row.module.id === activeModuleId) ?? null;
  }, [flatModules, activeModuleId]);

  const activeModuleDescriptionHtml = useMemo(() => {
    const html = activeModule?.module.description ?? '';
    if (!publicSession?.token) {
      return html;
    }
    return proxifyMoodleHtml(html, publicSession.token);
  }, [activeModule, publicSession?.token]);

  const activeModuleVideoUrl = useMemo(() => {
    if (!activeModule || activeModule.module.modname !== 'url') {
      return null;
    }
    const urlContent = (activeModule.module.contents ?? []).find(
      (content) => typeof content.fileurl === 'string' && /^https?:\/\//i.test(content.fileurl)
    );
    const raw = urlContent?.fileurl ?? null;
    if (!raw) {
      return null;
    }
    if (publicSession?.token && isMoodleProtectedFileUrl(raw)) {
      return api.moodleFileUrl(raw, publicSession.token);
    }
    return raw;
  }, [activeModule, publicSession?.token]);

  const activeModuleFileVideoUrl = useMemo(() => {
    if (!activeModule) {
      return null;
    }
    const videoFile = (activeModule.module.contents ?? []).find(
      (content) => typeof content.fileurl === 'string' && isVideoContentFile(content)
    );
    const raw = videoFile?.fileurl ?? null;
    if (!raw) {
      return null;
    }
    if (publicSession?.token && isMoodleProtectedFileUrl(raw)) {
      return api.moodleFileUrl(raw, publicSession.token);
    }
    return raw;
  }, [activeModule, publicSession?.token]);

  const activeModuleIndex = useMemo(() => {
    return flatModules.findIndex((row) => row.module.id === activeModuleId);
  }, [flatModules, activeModuleId]);

  /*
   * Ya no hay modo preview.
   *
   * Existía para quien llegaba al aula sin matrícula: le abría el primer módulo
   * y candaba el resto. Al aula sólo se llega desde «Mis cursos», que son las
   * matrículas activas, y la API responde 403 a cualquier otro; un visitante no
   * puede entrar a un curso suelto, así que no queda nadie a quien mostrarle
   * media aula.
   */

  useEffect(() => {
    const moodleCourseId = Number(cursoAbiertoId);
    if (!Number.isInteger(moodleCourseId) || moodleCourseId <= 0 || flatModules.length === 0) {
      return;
    }
    const next = {
      ...progress,
      totalModules: flatModules.length
    };
    persistProgress(next);
  }, [flatModules.length, cursoAbiertoId]);

  const completedCount = progress.completedModuleIds.filter((id) => flatModules.some((row) => row.module.id === id)).length;
  const progressPercent = flatModules.length > 0 ? Math.round((completedCount / flatModules.length) * 100) : 0;
  const level = Math.max(1, Math.floor(progress.xp / 250) + 1);
  const activeModuleCompleted = Boolean(activeModule && progress.completedModuleIds.includes(activeModule.module.id));

  const achievements = useMemo(() => {
    return [
      {
        id: 'first-step',
        title: 'Primer paso',
        unlocked: completedCount >= 1,
        description: 'Completaste tu primer módulo.'
      },
      {
        id: 'consistent',
        title: 'Consistente',
        unlocked: completedCount >= 5,
        description: 'Completaste 5 módulos.'
      },
      {
        id: 'engaged',
        title: 'Participativo',
        unlocked: progress.interactionsCount >= 3,
        description: 'Registraste 3 interacciones.'
      },
      {
        id: 'finisher',
        title: 'Finalizador',
        unlocked: flatModules.length > 0 && completedCount >= flatModules.length,
        description: 'Completaste el curso completo.'
      }
    ];
  }, [completedCount, progress.interactionsCount, flatModules.length]);

  const sectionGroups = useMemo(() => {
    const grouped = new Map<string, FlatModule[]>();
    for (const row of flatModules) {
      if (!grouped.has(row.sectionName)) {
        grouped.set(row.sectionName, []);
      }
      grouped.get(row.sectionName)?.push(row);
    }
    return [...grouped.entries()];
  }, [flatModules]);

  useEffect(() => {
    if (!victoryState) {
      return;
    }
    const timer = window.setTimeout(() => setVictoryState(null), 2600);
    return () => window.clearTimeout(timer);
  }, [victoryState]);

  const persistProgress = (next: CourseProgress) => {
    const totalModules = Math.max(next.totalModules, flatModules.length);
    const progressPercent = totalModules > 0 ? Math.min(100, Math.round((next.completedModuleIds.length / totalModules) * 100)) : 0;
    const normalized = {
      ...next,
      totalModules,
      progressPercent
    };
    const moodleCourseId = Number(cursoAbiertoId);
    setProgress(normalized);
    if (Number.isInteger(moodleCourseId) && moodleCourseId > 0) {
      setProgressByCourseId((current) => ({
        ...current,
        [moodleCourseId]: normalized
      }));
      saveCourseProgress(moodleCourseId, normalized);
      if (publicSession?.token) {
        void api.saveCourseProgress(moodleCourseId, toApiProgress(normalized), publicSession.token).catch(() => undefined);
      }
    }
  };

  /**
   * Abrir un programa es abrir su ficha, y nunca nada más.
   *
   * Antes esta función saltaba al aula del curso cuando había sesión abierta.
   * Ya no existe ese salto: el programa es lo que se navega, y a los cursos
   * sólo se entra desde «Mis cursos», que son las matrículas.
   */
  const abrirPrograma = (programa: ProgramaPublico) => {
    setView({ type: 'detail', slug: programa.slug });
  };

  /** Entrar al aula de un curso matriculado. Sólo se llama desde «Mis cursos». */
  const abrirAula = (moodleCourseId: number, titulo: string) => {
    setView({ type: 'course', moodleCourseId, titulo });
  };

  const markModuleComplete = async () => {
    if (!activeModule) {
      return;
    }
    if (progress.completedModuleIds.includes(activeModule.module.id)) {
      return;
    }
    const next = {
      ...progress,
      completedModuleIds: [...progress.completedModuleIds, activeModule.module.id],
      xp: progress.xp + 50,
      lastActivityAt: new Date().toISOString()
    };
    persistProgress(next);
    const moodleCourseId = Number(cursoAbiertoId);
    if (!publicSession?.token || !Number.isInteger(moodleCourseId) || moodleCourseId <= 0) {
      setInteractionMessage('Módulo completado. +50 XP');
      return;
    }
    try {
      const result = await api.completeCourseModule(
        moodleCourseId,
        activeModule.module.id,
        toApiProgress({
          ...next,
          totalModules: Math.max(next.totalModules, flatModules.length),
          progressPercent:
            flatModules.length > 0
              ? Math.min(100, Math.round((next.completedModuleIds.length / flatModules.length) * 100))
              : next.progressPercent
        }),
        publicSession.token
      );
      const mapped = fromApiProgress(result.progress);
      setProgress(mapped);
      setProgressByCourseId((current) => ({ ...current, [moodleCourseId]: mapped }));
      setVictoryState({ moduleName: activeModule.module.name, xp: 50 });
      setInteractionMessage(result.moodleCompletionSynced ? 'Módulo completado y sincronizado con Moodle. +50 XP' : 'Módulo completado. +50 XP');
    } catch {
      setVictoryState({ moduleName: activeModule.module.name, xp: 50 });
      setInteractionMessage('Módulo completado localmente. Se reintentará sincronizar con Moodle.');
    }
  };

  const onSubmitInteraction = async () => {
    if (!activeModule || !interactionText.trim() || !publicSession?.token) {
      return;
    }
    const moodleCourseId = Number(cursoAbiertoId);
    if (!Number.isInteger(moodleCourseId) || moodleCourseId <= 0) {
      return;
    }

    setInteractionSaving(true);
    setInteractionMessage(null);
    try {
      const result = await api.submitPublicCourseInteraction(
        moodleCourseId,
        activeModule.module.id,
        {
          moduleName: activeModule.module.name,
          moduleType: activeModule.module.modname,
          response: {
            text: interactionText.trim(),
            submittedAt: new Date().toISOString()
          },
          progress: toApiProgress({
            ...progress,
            interactionsCount: progress.interactionsCount + 1,
            xp: progress.xp + 10,
            lastActivityAt: new Date().toISOString(),
            totalModules: Math.max(progress.totalModules, flatModules.length),
            progressPercent: flatModules.length > 0 ? Math.round((completedCount / flatModules.length) * 100) : 0
          })
        },
        publicSession.token
      );

      const next: CourseProgress = {
        ...progress,
        interactionsCount: progress.interactionsCount + 1,
        xp: progress.xp + 10,
        lastActivityAt: new Date().toISOString()
      };
      setInteractionHistory((current) => [
        { ...result.interaction, user_id: publicSession.user.id },
        ...current.filter((entry) => entry.id !== result.interaction.id)
      ]);
      if (result.progress) {
        const mapped = fromApiProgress(result.progress);
        setProgress(mapped);
        setProgressByCourseId((current) => ({ ...current, [moodleCourseId]: mapped }));
      } else {
        persistProgress(next);
      }
      const moodleCourseIdNum = Number(cursoAbiertoId);
      if (publicSession?.token && Number.isInteger(moodleCourseIdNum) && moodleCourseIdNum > 0) {
        try {
          const latest = await api.courseInteractions(moodleCourseIdNum, publicSession.token);
          setInteractionHistory(latest.interactions ?? []);
        } catch {
          // Keep optimistic history entry when refresh fails.
        }
      }
      setInteractionText('');
      setInteractionMessage(`Interacción guardada (${result.interaction.id}). +10 XP`);
    } catch (reason) {
      setInteractionMessage(reason instanceof Error ? reason.message : 'No se pudo guardar la interacción');
    } finally {
      setInteractionSaving(false);
    }
  };

  const goToNeighborModule = (direction: -1 | 1) => {
    if (activeModuleIndex < 0) {
      return;
    }
    const nextIndex = activeModuleIndex + direction;
    if (nextIndex < 0 || nextIndex >= flatModules.length) {
      return;
    }
    setActiveModuleId(flatModules[nextIndex].module.id);
    setActiveFileUrl(null);
    setInteractionMessage(null);
  };

  const onRegister = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    try {
      const email = registerForm.email.trim().toLowerCase();
      if (!isValidEmail(email)) {
        throw new Error('Correo inválido. Verifica el formato (ejemplo@dominio.com).');
      }
      if (registerForm.password !== registerForm.confirmPassword) {
        throw new Error('Las contraseñas no coinciden.');
      }
      const passwordIssues = getPasswordValidation(registerForm.password);
      if (passwordIssues.length > 0) {
        throw new Error(`Contraseña insegura: ${passwordIssues.join(', ')}.`);
      }
      if (!registerForm.acceptedTerms) {
        throw new Error('Debes aceptar términos y condiciones para continuar.');
      }

      const response = await api.publicAuth.register({
        fullName: registerForm.fullName.trim(),
        email,
        password: registerForm.password,
        locale: registerForm.locale
      });
      const session: PublicSession = {
        token: response.token,
        expiresAt: response.expiresAt,
        user: response.user
      };
      setPublicSession(session);
      localStorage.setItem(PUBLIC_SESSION_STORAGE, JSON.stringify(session));
      void hydrateAuthenticatedData(session);
      setShowAuthModal(false);
      setView({ type: 'home' });
    } catch (reason) {
      setAuthError(reason instanceof Error ? reason.message : 'No se pudo registrar');
    } finally {
      setAuthLoading(false);
    }
  };

  const onLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    try {
      const email = loginForm.email.trim().toLowerCase();
      if (!isValidEmail(email)) {
        throw new Error('Correo inválido. Verifica el formato (ejemplo@dominio.com).');
      }
      if (!loginForm.acceptedTerms) {
        throw new Error('Debes aceptar términos y condiciones para iniciar sesión.');
      }
      const response = await api.publicAuth.login({
        email,
        password: loginForm.password
      });
      const session: PublicSession = {
        token: response.token,
        expiresAt: response.expiresAt,
        user: response.user
      };
      setPublicSession(session);
      localStorage.setItem(PUBLIC_SESSION_STORAGE, JSON.stringify(session));
      void hydrateAuthenticatedData(session);
      setShowAuthModal(false);
      // Quien inicia sesión aterriza en su programa, que es su plataforma: su
      // plan de estudios, sus notas y sus plazos. Antes caía en la portada
      // pública, la misma que ve un visitante sin cuenta.
      setView({ type: 'my-program' });
    } catch (reason) {
      setAuthError(reason instanceof Error ? reason.message : 'No se pudo iniciar sesión');
    } finally {
      setAuthLoading(false);
    }
  };

  const logoutPublic = () => {
    setPublicSession(null);
    localStorage.removeItem(PUBLIC_SESSION_STORAGE);
    setMyCourses(null);
    if (view.type === 'course') {
      setView({ type: 'home' });
    }
  };

  const onSaveProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!publicSession?.token) {
      setProfileError('Debes iniciar sesión para editar tu perfil.');
      return;
    }
    setProfileSaving(true);
    setProfileMessage(null);
    setProfileError(null);
    try {
      const fullName = profileForm.fullName.trim();
      const email = profileForm.email.trim().toLowerCase();
      const locale = profileForm.locale.trim().toLowerCase();
      if (fullName.length < 3) {
        throw new Error('El nombre debe tener al menos 3 caracteres.');
      }
      if (!isValidEmail(email)) {
        throw new Error('Correo inválido. Verifica el formato.');
      }
      const response = await api.publicAuth.updateMe(publicSession.token, {
        fullName,
        email,
        locale
      });
      const nextSession: PublicSession = {
        ...publicSession,
        expiresAt: response.expiresAt,
        user: {
          ...publicSession.user,
          ...response.user
        }
      };
      setPublicSession(nextSession);
      localStorage.setItem(PUBLIC_SESSION_STORAGE, JSON.stringify(nextSession));
      setProfileMessage('Perfil actualizado y sincronizado con Moodle.');
    } catch (reason) {
      setProfileError(reason instanceof Error ? reason.message : 'No se pudo actualizar el perfil');
    } finally {
      setProfileSaving(false);
    }
  };

  const onEnterpriseAddMember = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!publicSession?.token) {
      return;
    }
    setEnterpriseSaving(true);
    setError(null);
    try {
      await api.publicAuth.enterpriseCreateMember(publicSession.token, {
        fullName: enterpriseMemberForm.fullName.trim(),
        email: enterpriseMemberForm.email.trim().toLowerCase(),
        locale: enterpriseMemberForm.locale.trim().toLowerCase() || 'es'
      });
      setEnterpriseMemberForm({ fullName: '', email: '', locale: 'es' });
      await Promise.all([loadEnterpriseOverview(publicSession.token), loadUsersSafeFromEnterprise()]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo agregar miembro al departamento');
    } finally {
      setEnterpriseSaving(false);
    }
  };

  const loadUsersSafeFromEnterprise = async () => {
    if (!publicSession?.token) {
      return;
    }
    await loadMyCourses(publicSession.token).catch(() => undefined);
  };

  const onEnterpriseToggleMember = async (userId: string, nextStatus: 'active' | 'inactive') => {
    if (!publicSession?.token) {
      return;
    }
    setEnterpriseSaving(true);
    setError(null);
    try {
      await api.publicAuth.enterpriseUpdateMemberStatus(publicSession.token, userId, {
        status: nextStatus
      });
      await loadEnterpriseOverview(publicSession.token);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo actualizar miembro');
    } finally {
      setEnterpriseSaving(false);
    }
  };

  const onEnterpriseAssignCourse = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!publicSession?.token || !enterpriseCourseId) {
      return;
    }
    setEnterpriseSaving(true);
    setError(null);
    try {
      await api.publicAuth.enterpriseUpsertCourseAccess(publicSession.token, Number(enterpriseCourseId), {
        isActive: true
      });
      setEnterpriseCourseId('');
      await Promise.all([loadEnterpriseOverview(publicSession.token), loadMyCourses(publicSession.token)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo asignar curso al departamento');
    } finally {
      setEnterpriseSaving(false);
    }
  };

  const onEnterpriseToggleCourse = async (moodleCourseId: number, isActive: boolean) => {
    if (!publicSession?.token) {
      return;
    }
    setEnterpriseSaving(true);
    setError(null);
    try {
      await api.publicAuth.enterpriseUpsertCourseAccess(publicSession.token, moodleCourseId, {
        isActive: !isActive
      });
      await Promise.all([loadEnterpriseOverview(publicSession.token), loadMyCourses(publicSession.token)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo actualizar curso del departamento');
    } finally {
      setEnterpriseSaving(false);
    }
  };

  const scrollToHomeSectionById = (sectionId: string): boolean => {
    const target = categorySectionRefs.current[sectionId];
    if (!target) {
      return false;
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return true;
  };

  const goToHomeSection = (sectionId: string) => {
    if (view.type !== 'home') {
      setPendingCategoryId(sectionId);
      setView({ type: 'home' });
      return;
    }
    if (!scrollToHomeSectionById(sectionId)) {
      setPendingCategoryId(sectionId);
    }
  };

  useEffect(() => {
    if (view.type !== 'home' || !pendingCategoryId) {
      return;
    }
    const timer = window.setTimeout(() => {
      if (scrollToHomeSectionById(pendingCategoryId)) {
        setPendingCategoryId(null);
      }
    }, 30);
    return () => window.clearTimeout(timer);
  }, [view.type, pendingCategoryId, rows]);

  useEffect(() => {
    if (!accountMenuOpen) {
      return;
    }
    const onClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (accountMenuRef.current && target && !accountMenuRef.current.contains(target)) {
        setAccountMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onClickOutside);
    return () => window.removeEventListener('mousedown', onClickOutside);
  }, [accountMenuOpen]);

  useEffect(() => {
    if (view.type !== 'home') {
      return;
    }
    const row = continueLearningRowRef.current;
    if (!row) {
      return;
    }
    if (row.scrollWidth <= row.clientWidth + 8) {
      return;
    }

    const timer = window.setInterval(() => {
      const card = row.querySelector<HTMLElement>('.content-tile');
      const step = (card?.offsetWidth ?? 260) + 10;
      const maxScroll = row.scrollWidth - row.clientWidth;
      const nextScroll = row.scrollLeft + step;
      row.scrollTo({
        left: nextScroll >= maxScroll - 4 ? 0 : nextScroll,
        behavior: 'smooth'
      });
    }, 5200);

    return () => window.clearInterval(timer);
  }, [view.type, rows]);

  if (loading) {
    return <main className="public-shell">{t('nav.loading')}</main>;
  }

  if (error && !home) {
    return <main className="public-shell">{t('nav.error')}: {error}</main>;
  }

  /**
   * Título de una página institucional para menús y pie.
   *
   * Usa el del índice que sirve la API cuando ya llegó (así el nombre lo
   * controla quien edita la página) y cae a la traducción local mientras
   * tanto, para que el pie no parpadee en blanco en la primera carga.
   */
  const pageTitle = (slug: string): string =>
    pageIndex.find((page) => page.slug === slug)?.title ?? t(`pages.${slug}`);

  const activeLegalDocument =
    view.type === 'page' ? (sitePages[`${view.slug}:${currentLang}`] ?? null) : null;
  const nowMs = Date.now();
  const landingWebinars = webinars.filter((webinar) => webinar.is_active && webinar.show_on_landing);
  const landingPodcasts = podcasts.filter((podcast) => podcast.is_active && podcast.show_on_landing);
  const sortedLandingWebinars = [...landingWebinars].sort((a, b) => {
    const aState = webinarState(a, nowMs);
    const bState = webinarState(b, nowMs);
    const rank = (value: 'live' | 'upcoming' | 'ended') => (value === 'live' ? 0 : value === 'upcoming' ? 1 : 2);
    const byState = rank(aState) - rank(bState);
    if (byState !== 0) {
      return byState;
    }
    const aTs = Date.parse(a.starts_at);
    const bTs = Date.parse(b.starts_at);
    if (aState === 'ended' && bState === 'ended') {
      return bTs - aTs;
    }
    return aTs - bTs;
  });
  const bestSellersRowIndex = rows.findIndex((row) => row.title === 'Más vendidos');
  const rowsBeforeBestSellers = bestSellersRowIndex >= 0 ? rows.slice(1, bestSellersRowIndex) : rows.slice(1);
  const rowsFromBestSellers = bestSellersRowIndex >= 0 ? rows.slice(bestSellersRowIndex) : [];
  /**
   * Cursos que el departamento tiene habilitados pero desactivados.
   *
   * Es la única lista de cursos con id de Moodle a la que el portal público
   * tiene acceso legítimo, y sólo la ve el representante de la empresa sobre
   * los cursos de su propio departamento.
   */
  const cursosDepartamentoInactivos = (enterpriseOverview?.courseAccess ?? []).filter((curso) => !curso.is_active);
  const enterpriseAvailable = Boolean(enterpriseOverview?.available);
  const enterpriseIsRepresentative = enterpriseOverview?.role === 'representative';

  /**
   * El menú que toca: el del visitante o el del estudiante.
   *
   * Se resuelve una sola vez y lo usan la navegación de escritorio y la hoja
   * móvil, para que no puedan discrepar. Antes la hoja móvil repetía la lista
   * a mano, que es como se acaba con dos menús distintos en la misma página.
   */
  const navActual = publicSession ? STUDENT_NAV : TOP_NAV;

  return (
    <main className={`public-shell netflix-ui${publicSession ? ' portal-estudiante' : ''}`}>
      {/* Primer elemento enfocable de la página: deja saltar la barra superior,
          que repite una decena de controles en todas las vistas. */}
      <a className="skip-to-content" href="#contenido-principal">
        {t('nav.skipToContent')}
      </a>
      {/* Cabecera de dos bandas, como el mockup del manual de marca (§05) y el
          sitio corporativo hermano: arriba lo utilitario —idioma, empresas,
          cuenta—, abajo la navegación académica y la llamada a la acción.
          Separarlas es lo que permite que la navegación respire: antes los
          diez controles competían en una sola fila de 56 píxeles. */}
      <header className="tfu-header">
        <div className="tfu-utility">
          <div className="tfu-utility-inner">
            {/* Rótulo del portal. Sin él la cabecera es idéntica a la pública y
                nada le dice al estudiante en qué sitio está. */}
            {publicSession ? (
              <span className="tfu-portal-rotulo">{t('nav.studentPortal')}</span>
            ) : null}
            <a className="tfu-utility-link" href={`mailto:${INSTITUTION_CONTACTS.general}`}>
              {INSTITUTION_CONTACTS.general}
            </a>
            {/* «Para empresas» es captación: no se le ofrece a quien ya es
                estudiante. Contacto sí se queda, que es su vía de soporte. */}
            {!publicSession ? (
              <button
                className="tfu-utility-link"
                onClick={() => {
                  setView({ type: 'enterprise' });
                  setMobileMenuOpen(false);
                }}
              >
                {t('nav.utilityEnterprise')}
              </button>
            ) : null}
            <button
              className="tfu-utility-link"
              onClick={() => {
                setView({ type: 'contact' });
                setMobileMenuOpen(false);
              }}
            >
              {t('nav.utilityContact')}
            </button>
            <LanguageSwitcher compact />
            <div className="account-menu-wrap" ref={accountMenuRef}>
              <button
                className={`profile-icon-btn ${publicSession?.token ? 'logged' : 'guest'}`}
                aria-label={publicSession?.token ? t('nav.account') : t('nav.login')}
                title={publicSession?.token ? t('nav.account') : t('nav.login')}
                onClick={() => {
                  if (!publicSession?.token) {
                    setAuthMode('login');
                    setShowAuthModal(true);
                    return;
                  }
                  setMobileMenuOpen(false);
                  setAccountMenuOpen((current) => !current);
                }}
              >
                <span className={`profile-avatar ${publicSession?.token ? 'user' : 'guest'}`}>
                  {publicSession?.user?.fullName?.trim().charAt(0).toUpperCase() || '\u{1F464}'}
                </span>
                {!publicSession?.token ? <span className="profile-label">{t('nav.login')}</span> : null}
                {/* Con sesión se muestra el nombre, no sólo la inicial: es lo
                    que distingue «estoy en mi portal» de «estoy en la web». Se
                    corta al primer nombre para que la barra no crezca. */}
                {publicSession?.token ? (
                  <span className="profile-label profile-nombre">
                    {publicSession.user.fullName.trim().split(/\s+/)[0]}
                  </span>
                ) : null}
                {publicSession?.token ? <span className={`profile-caret ${accountMenuOpen ? 'open' : ''}`}>▾</span> : null}
              </button>
              {publicSession && accountMenuOpen ? (
                <div className="account-dropdown">
                  <div className="account-dropdown-head">
                    <strong>{publicSession.user.fullName}</strong>
                    <span>{publicSession.user.email}</span>
                  </div>
                  <button
                    onClick={() => {
                      setView({ type: 'my-program' });
                      setAccountMenuOpen(false);
                    }}
                  >
                    {t('nav.myProgram')}
                  </button>
                  <button
                    onClick={() => {
                      setView({ type: 'my-courses' });
                      setAccountMenuOpen(false);
                    }}
                  >
                    {t('nav.myCourses')}
                  </button>
                  <button
                    onClick={() => {
                      setView({ type: 'academics' });
                      setAccountMenuOpen(false);
                    }}
                  >
                    {t('nav.academics')}
                  </button>
                  <button
                    onClick={() => {
                      setView({ type: 'profile' });
                      setAccountMenuOpen(false);
                    }}
                  >
                    {t('nav.profile')}
                  </button>
                  <button
                    className="danger"
                    onClick={() => {
                      logoutPublic();
                      setAccountMenuOpen(false);
                    }}
                  >
                    {t('nav.logout')}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="tfu-main-bar">
          <div className="tfu-main-inner">
            {/* Con sesión, el logotipo es el «inicio» del portal, que es su
                programa, no la portada de captación. */}
            <button
              className="tfu-brand"
              onClick={() => setView(publicSession ? { type: 'my-program' } : { type: 'home' })}
              aria-label={`${BRAND} — ${publicSession ? t('nav.myProgram') : t('nav.home')}`}
            >
              {/* El lockup viene del propio manual de marca; el texto queda en
                  `alt` para que el lector de pantalla y el buscador lo lean. */}
              <img src="/brand/tfu-lockup.png" alt={BRAND} className="tfu-lockup" width={382} height={66} />
            </button>

            <nav className="tfu-nav" aria-label={publicSession ? t('nav.studentPortal') : t('nav.menu')}>
              {navActual.map((item) => (
                <button
                  key={item.key}
                  className={isNavActive(view, item) ? 'tfu-nav-link active' : 'tfu-nav-link'}
                  aria-current={isNavActive(view, item) ? 'page' : undefined}
                  onClick={() => {
                    setView(item.view);
                    setMobileMenuOpen(false);
                  }}
                >
                  {t(item.key)}
                </button>
              ))}
            </nav>

            {/* «Postular ahora» es la llamada a la acción de un visitante y
                desaparece con la sesión iniciada. No se sustituye por nada: el
                sitio evidente al que vuelve un estudiante es su programa, y a
                eso ya llevan el logotipo y el primer ítem del menú. Un tercer
                control para lo mismo en la misma barra es ruido. */}
            {!publicSession ? (
              <button
                className="tfu-apply"
                onClick={() => {
                  setView({ type: 'page', slug: 'admissions' });
                  setMobileMenuOpen(false);
                }}
              >
                {t('nav.applyNow')}
              </button>
            ) : null}

            <button
              className={`tfu-burger ${mobileMenuOpen ? 'active' : ''}`}
              aria-label={mobileMenuOpen ? t('nav.closeMenu') : t('nav.openMenu')}
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen((current) => !current)}
            >
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span aria-hidden="true" />
            </button>
          </div>

          {mobileMenuOpen ? (
            <div className="tfu-mobile-sheet">
              {navActual.map((item) => (
                <button
                  key={`m-${item.key}`}
                  className={isNavActive(view, item) ? 'active' : ''}
                  onClick={() => {
                    setView(item.view);
                    setMobileMenuOpen(false);
                  }}
                >
                  {t(item.key)}
                </button>
              ))}
              {!publicSession ? (
                <button
                  onClick={() => {
                    setView({ type: 'enterprise' });
                    setMobileMenuOpen(false);
                  }}
                >
                  {t('nav.utilityEnterprise')}
                </button>
              ) : null}
              <button
                onClick={() => {
                  setView({ type: 'contact' });
                  setMobileMenuOpen(false);
                }}
              >
                {t('nav.utilityContact')}
              </button>
              {/* Cerrar sesión también desde el móvil: el menú de cuenta es un
                  desplegable de la barra superior y en móvil queda escondido. */}
              {publicSession ? (
                <button
                  className="mobile-logout"
                  onClick={() => {
                    logoutPublic();
                    setMobileMenuOpen(false);
                  }}
                >
                  {t('nav.logout')}
                </button>
              ) : null}
              <div className="mobile-lang-switcher">
                <LanguageSwitcher />
              </div>
            </div>
          ) : null}
        </div>
      </header>

      {/* role="alert" para que el lector anuncie el fallo: antes era un párrafo
          que aparecía en silencio. */}
      {error ? (
        <p className="public-error" role="alert">
          {error}
        </p>
      ) : null}

      <div id="contenido-principal" tabIndex={-1} />

      {view.type === 'home' ? (
        <>
          {activeHero ? (
            <section
              className="hero hero-netflix"
              data-accent={categoryAccentKey(areaDelPrograma(activeHero))}
            >
              {/* Una capa por diapositiva, encadenadas por opacidad.
                  Antes la imagen era el fondo de la propia sección y cambiarla
                  era un corte seco; así se funden. Las capas inactivas quedan
                  montadas, de modo que la imagen ya está descargada cuando le
                  toca el turno y no aparece en blanco. */}
              {heroItems.map((item, index) => (
                <div
                  key={item.id}
                  className={`hero-layer ${index === heroIndex ? 'active' : ''}`}
                  style={{ backgroundImage: `url(${item.heroImage})` }}
                  aria-hidden="true"
                />
              ))}
              <div className="hero-backdrop" />
              <div className="hero-content">
                <div className="hero-meta-row">
                  <span className="public-badge kind-program">{t('badges.program')}</span>
                  {areaDelPrograma(activeHero) ? (
                    <span className="category-chip">{areaDelPrograma(activeHero)}</span>
                  ) : null}
                  {activeHero.courseCount > 0 ? (
                    <span className="hero-duration">{etiquetaCursosIncluidos(activeHero.courseCount)}</span>
                  ) : null}
                </div>
                <h1>{activeHero.title}</h1>
                <p>{snippet(activeHero.summary ?? '', activeHero.title, 260)}</p>
                <div className="hero-actions">
                  {/* Lleva a la ficha del programa, que es lo que se navega. */}
                  <button onClick={() => abrirPrograma(activeHero)}>{t('hero.viewProgram')}</button>
                  <button className="ghost-btn" onClick={() => setView({ type: 'catalog' })}>
                    {t('hero.exploreCatalog')}
                  </button>
                </div>
                {/* Eran N botones vacíos: para un lector de pantalla, N
                    controles sin etiqueta y sin forma de saber cuál está
                    activo. */}
                <div className="hero-dots" role="tablist" aria-label={t('hero.slidesLabel')}>
                  {heroItems.map((item, index) => (
                    <button
                      key={item.id}
                      role="tab"
                      className={heroIndex === index ? 'active' : ''}
                      aria-selected={heroIndex === index}
                      aria-label={t('hero.goToSlide', { n: index + 1, total: heroItems.length })}
                      onClick={() => setHeroIndex(index)}
                    />
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          {/* Banda de promesa de marca, pegada bajo el hero como la fila de
              columnas del mockup. El lema y los tres bloques salen del manual
              de marca de TFU; no es texto de relleno. */}
          <section className="tfu-promise" aria-labelledby="promesa-marca">
            <div className="tfu-promise-inner">
              <p className="tfu-promise-lead">
                <span className="tfu-promise-slogan" id="promesa-marca">
                  {t('nav.brandTagline')}
                </span>
                <span className="tfu-promise-claim">{t('home.promiseClaim')}</span>
              </p>
              <div className="tfu-promise-grid">
                <div className="tfu-promise-item">
                  <h3>{t('home.purposeWhatTitle')}</h3>
                  <p>{t('home.purposeWhatBody')}</p>
                </div>
                <div className="tfu-promise-item">
                  <h3>{t('home.purposeHowTitle')}</h3>
                  <p>{t('home.purposeHowBody')}</p>
                </div>
                <div className="tfu-promise-item">
                  <h3>{t('home.purposeWhyTitle')}</h3>
                  <p>{t('home.purposeWhyBody')}</p>
                </div>
              </div>
            </div>
          </section>

          {publicSession ? (
            <section
              className="content-row-block my-courses-home category-anchor"
              ref={(node) => {
                categorySectionRefs.current['my-courses-home'] = node;
              }}
            >
              <div className="section-header-row">
                <div>
                  <h2>{t('home.myCourses')}</h2>
                  <p className="row-subtitle">{t('home.myCoursesSubtitle')}</p>
                </div>
                <button className="ghost-btn" onClick={() => setView({ type: 'my-courses' })}>
                  {t('home.viewAll')}
                </button>
              </div>
              {myCoursesLoading ? <p>{t('home.loadingCourses')}</p> : null}
              {!myCoursesLoading && misCursos.length === 0 ? (
                <div className="my-courses-empty">
                  <p>{t('home.noCoursesEnrolled')}</p>
                  <button className="go-course-btn" onClick={() => setView({ type: 'catalog' })}>
                    {t('home.exploreAndGet')}
                  </button>
                </div>
              ) : null}
              {misCursos.length > 0 ? (
                <div className={`content-row-scroll my-courses-scroll ${misCursos.length <= 2 ? 'few-courses' : ''}`}>
                  {/* Tarjeta de aula del estudiante matriculado: entra a su
                      curso. No es catálogo, es su matrícula. */}
                  {misCursos.map((curso) => {
                    const savedProgress =
                      progressByCourseId[curso.moodleCourseId] ?? loadCourseProgress(curso.moodleCourseId);
                    const totalModules = savedProgress.totalModules;
                    const completed = savedProgress.completedModuleIds.length;
                    const percent =
                      totalModules > 0
                        ? Math.min(100, Math.round((completed / totalModules) * 100))
                        : savedProgress.progressPercent;
                    return (
                      <article key={`my-${curso.moodleCourseId}`} className="my-course-card-wrap">
                        <button
                          className="content-tile aula-tile"
                          onClick={() => abrirAula(curso.moodleCourseId, curso.titulo)}
                        >
                          <div className="tile-overlay">
                            <span className="category-chip">{t('myCourses.myClassroom')}</span>
                            <h4>{curso.titulo}</h4>
                            <p className="tile-meta">{t('myCourses.continueCourse')}</p>
                          </div>
                        </button>
                        <p className="my-course-progress-text">{t('home.progress')}: {percent}%</p>
                        <div className="my-course-progress-track" aria-hidden="true">
                          <div className="my-course-progress-fill" style={{ width: `${percent}%` }} />
                        </div>
                      </article>
                    );
                  })}
                  <button className="content-tile promo-more-courses" onClick={() => setView({ type: 'my-courses' })}>
                    <div className="promo-more-inner">
                      <span className="public-badge kind-program">{t('home.suggested')}</span>
                      <h4>{t('home.viewAllMyCourses')}</h4>
                      <p>{t('home.myCoursesSubtitle')}</p>
                      <span className="promo-link">{t('course.goMyCourses')}</span>
                    </div>
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}

          {rows
            .filter((row) => row.id === 'continue-learning')
            .map((row) => (
              <section
                key={row.id}
                className={`content-row-block ${row.id.startsWith('category-') ? 'category-anchor' : ''}`}
                ref={(node) => {
                  if (row.id.startsWith('category-')) {
                    categorySectionRefs.current[row.id] = node;
                  }
                }}
              >
                <div className="section-header-row">
                  <div>
                    <h2>{row.title}</h2>
                    {row.subtitle ? <p className="row-subtitle">{row.subtitle}</p> : null}
                  </div>
                </div>
                <div className="content-row-scroll" ref={row.id === 'continue-learning' ? continueLearningRowRef : undefined}>
                  {row.items.map((programa) => (
                    <TarjetaPrograma
                      key={`${row.id}-${programa.id}`}
                      programa={programa}
                      onAbrir={abrirPrograma}
                      etiquetaCursos={etiquetaCursosIncluidos}
                    />
                  ))}
                </div>
              </section>
            ))}

          {sortedLandingWebinars.length > 0 ? (
            <section
              className="section-block webinar-list-block category-anchor"
              ref={(node) => {
                categorySectionRefs.current.webinars = node;
              }}
            >
              <div className="section-header-row">
                <div>
                  <h2>{t('home.liveEvents')}</h2>
                  <p className="row-subtitle">{t('home.liveEventsSubtitle')}</p>
                </div>
              </div>
              <div className="content-row-scroll">
                {sortedLandingWebinars.map((webinar) => {
                  const state = webinarState(webinar, nowMs);
                  const links = webinarLiveLinks(webinar);
                  const localized = localizeWebinar(webinar, currentLang);
                  const startsAtLabel = webinarWhen(webinar, currentLang);
                  return (
                    <article key={webinar.id} className="webinar-card webinar-card-modern">
                      <img src={webinar.hero_image} alt={localized.title} loading="lazy" />
                      <div className="webinar-card-overlay" />
                      <div className="webinar-card-body webinar-card-body-overlay">
                        <div className="webinar-card-top">
                          <span className={`webinar-state-pill state-${state}`}>
                            {state === 'live' ? t('home.live') : state === 'upcoming' ? t('home.upcoming') : t('home.ended')}
                          </span>
                          <span
                            className={`webinar-platform-chip ${
                              webinar.source_type === 'external' ? '' : 'platform-meaningful'
                            }`}
                          >
                            {webinar.source_type.toUpperCase()}
                          </span>
                        </div>
                        <h4>{localized.title}</h4>
                        <p className="webinar-card-subtitle">{localized.subtitle ?? t('home.exclusive')}</p>
                        <p className="webinar-card-datetime">{startsAtLabel}</p>
                        {localized.description ? (
                          <p className="webinar-card-description">{localized.description}</p>
                        ) : null}
                        <div className="webinar-channel-list">
                          {links.slice(0, 3).map((link) => (
                            <a key={`${webinar.id}-${link.platform}-${link.url}`} href={link.url} target="_blank" rel="noreferrer noopener">
                              {link.platform}
                            </a>
                          ))}
                        </div>
                        <div className="webinar-card-actions">
                          {webinar.free_reservation_url ? (
                            <a className="tier-free" href={webinar.free_reservation_url} target="_blank" rel="noreferrer noopener">
                              {t('home.reserveFree')}
                            </a>
                          ) : null}
                          {webinar.vip_reservation_url ? (
                            <a className="tier-vip" href={webinar.vip_reservation_url} target="_blank" rel="noreferrer noopener">
                              {t('home.reserveVip')}
                            </a>
                          ) : (
                            <a href={webinar.source_url} target="_blank" rel="noreferrer noopener">
                              {localized.ctaLabel || t('home.openWebinar')}
                            </a>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          {rowsBeforeBestSellers
            .map((row) => (
              <section
                key={row.id}
                className={`content-row-block ${row.id.startsWith('category-') ? 'category-anchor' : ''}`}
                ref={(node) => {
                  if (row.id.startsWith('category-')) {
                    categorySectionRefs.current[row.id] = node;
                  }
                }}
              >
                <div className="section-header-row">
                  <div>
                    <h2>{row.title}</h2>
                    {row.subtitle ? <p className="row-subtitle">{row.subtitle}</p> : null}
                  </div>
                </div>
                <div className="content-row-scroll">
                  {row.items.map((programa) => (
                    <TarjetaPrograma
                      key={`${row.id}-${programa.id}`}
                      programa={programa}
                      onAbrir={abrirPrograma}
                      etiquetaCursos={etiquetaCursosIncluidos}
                    />
                  ))}
                </div>
              </section>
            ))}

          {landingPodcasts.length > 0 ? (
            <section
              className="section-block webinar-list-block category-anchor"
              ref={(node) => {
                categorySectionRefs.current.podcasts = node;
              }}
            >
              <div className="section-header-row">
                <div>
                  <h2>{t('home.podcasts')}</h2>
                  <p className="row-subtitle">{t('home.podcastsSubtitle')}</p>
                </div>
              </div>
              <div className="content-row-scroll">
                {landingPodcasts.map((podcast) => {
                  const embedUrl = youtubeEmbedUrl(podcast.video_url || podcast.video_code);
                  const podcastTitle = currentLang === 'en' ? podcast.title_en : podcast.title;
                  return (
                    <button
                      key={podcast.id}
                      className="content-tile podcast-tile"
                      onClick={() => {
                        if (!embedUrl) {
                          return;
                        }
                        setPodcastPreview({
                          title: podcastTitle,
                          embedUrl
                        });
                      }}
                    >
                      <img
                        src={youtubeThumbUrl(podcast.video_url || podcast.video_code)}
                        alt={podcastTitle}
                        loading="lazy"
                      />
                      <div className="tile-overlay">
                        <span className="public-badge kind-vod">{t('nav.podcasts')}</span>
                        <h4>{podcastTitle}</h4>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          {rowsFromBestSellers.map((row) => (
            <section
              key={row.id}
              className={`content-row-block ${row.id.startsWith('category-') ? 'category-anchor' : ''}`}
              ref={(node) => {
                if (row.id.startsWith('category-')) {
                  categorySectionRefs.current[row.id] = node;
                }
              }}
            >
              <div className="section-header-row">
                <div>
                  <h2>{row.title}</h2>
                  {row.subtitle ? <p className="row-subtitle">{row.subtitle}</p> : null}
                </div>
              </div>
              <div className="content-row-scroll">
                {row.items.map((programa) => (
                  <TarjetaPrograma
                    key={`${row.id}-${programa.id}`}
                    programa={programa}
                    onAbrir={abrirPrograma}
                    etiquetaCursos={etiquetaCursosIncluidos}
                  />
                ))}
              </div>
            </section>
          ))}
        </>
      ) : null}

      {view.type === 'catalog' ? (
        <section className="section-block">
          <div className="section-header-row">
            <h2>{t('catalog.title')}</h2>
            <span className="catalog-results-count">
              {t('catalog.showing', { shown: catalogShownItems.length, total: catalogViewItems.length })}
            </span>
          </div>
          <div className="catalog-toolbar">
            <div className="catalog-search-wrap">
              <input
                className="search-input catalog-search-input"
                placeholder={t('catalog.search')}
                  aria-label={t('catalog.search')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            {/* Se quitaron dos filtros. El de matrícula cruzaba el catálogo con
                los cursos del estudiante, y el catálogo ya no tiene cursos ni
                expone matrícula de programa. El de «más nuevos» ordenaba por id
                de Moodle del curso, que ya no viaja y que tampoco era una
                fecha. Quedan el área y la A-Z, que sí salen del dato. */}
            <div className="catalog-filters">
              <label>
                {t('catalog.area')}
                <select value={catalogGroupFilter} onChange={(event) => setCatalogGroupFilter(event.target.value)}>
                  <option value="all">{t('catalog.all')}</option>
                  {areasDelCatalogo.map((area) => (
                    <option key={area} value={area}>
                      {area}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('catalog.order')}
                <select value={catalogSort} onChange={(event) => setCatalogSort(event.target.value as 'default' | 'az')}>
                  <option value="default">{t('catalog.relevance')}</option>
                  <option value="az">A-Z</option>
                </select>
              </label>
              <button
                type="button"
                className="ghost-btn catalog-clear-btn"
                onClick={() => {
                  setSearch('');
                  setCatalogGroupFilter('all');
                  setCatalogSort('default');
                }}
              >
                {t('catalog.clear')}
              </button>
            </div>
          </div>
          {/* Tarjetas de PROGRAMA. Antes llevaban el estado de matrícula y la
              barra de avance del curso; ambos eran del curso y no del programa,
              y el catálogo público ya no sabe de matrículas. Lo que queda es lo
              que el programa sí trae: su área y cuántos cursos incluye. */}
          <div className="catalog-grid">
            {catalogShownItems.map((programa) => {
              const area = areaDelPrograma(programa);
              return (
                <button
                  key={programa.id}
                  className="content-tile catalog-tile"
                  data-accent={categoryAccentKey(area)}
                  onClick={() => abrirPrograma(programa)}
                >
                  {programa.heroImage ? (
                    <img src={programa.heroImage} alt={programa.title} loading="lazy" />
                  ) : null}
                  <div className="tile-overlay catalog-tile-overlay">
                    <div className="catalog-tile-head">
                      {area ? <span className="category-chip">{area}</span> : null}
                      {programa.courseCount > 0 ? (
                        <span className="catalog-status-pill programa">
                          {etiquetaCursosIncluidos(programa.courseCount)}
                        </span>
                      ) : null}
                    </div>
                    <h4>{programa.title}</h4>
                    {programa.summary ? (
                      <p className="tile-meta">{snippet(programa.summary, programa.title, 110)}</p>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
          {catalogShownItems.length === 0 ? <p className="catalog-empty">{t('catalog.noResults')}</p> : null}
          {catalogShownItems.length < catalogViewItems.length ? (
            <div className="catalog-load-more-wrap">
              <button
                type="button"
                className="ghost-btn"
                onClick={() => setCatalogVisibleCount((current) => current + 24)}
              >
                {t('catalog.loadMore')}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Ficha de programa, con la estructura del sitio corporativo hermano:
          hero a sangre con migas y entradilla, índice pegajoso de secciones,
          y luego sobre el programa, lo que se practica, el plan semanal real
          del aula, el formato y los programas de la misma área.

          El plan semanal NO es texto de marketing: sale del índice del aula en
          Moodle (`outline`), que la API devuelve con los títulos de las
          secciones y cuántas actividades tiene cada una, sin materiales ni
          enlaces. Es el índice que cualquier universidad publica. */}
      {view.type === 'detail' ? (
        <section className="program-page">
          {loadingDetail || !selectedDetail ? (
            <p className="program-loading">{t('course.contentLoading')}</p>
          ) : (
            <article data-accent={categoryAccentKey(areaDelPrograma(selectedDetail.program))}>
              <header
                className="program-hero"
                style={
                  selectedDetail.program.heroImage
                    ? { backgroundImage: `url(${selectedDetail.program.heroImage})` }
                    : undefined
                }
              >
                <div className="program-hero-veil" />
                <div className="program-hero-inner">
                  <nav className="program-breadcrumb" aria-label={t('program.breadcrumbPrograms')}>
                    <button onClick={() => setView({ type: 'home' })}>{t('program.breadcrumbHome')}</button>
                    <span aria-hidden="true">/</span>
                    <button onClick={() => setView({ type: 'catalog' })}>{t('program.breadcrumbPrograms')}</button>
                    {areaDelPrograma(selectedDetail.program) ? (
                      <>
                        <span aria-hidden="true">/</span>
                        <span className="program-breadcrumb-current">{areaDelPrograma(selectedDetail.program)}</span>
                      </>
                    ) : null}
                  </nav>
                  <p className="program-eyebrow">{t('program.eyebrow')}</p>
                  <h1>{selectedDetail.program.title}</h1>
                  {selectedDetail.program.summary ? (
                    <p className="program-lead">
                      {snippet(selectedDetail.program.summary, selectedDetail.program.title, 300)}
                    </p>
                  ) : null}
                  {/* Datos del programa que SÍ vienen de la API. Los que no
                      vengan se omiten, y si no viene ninguno no se pinta ni el
                      párrafo: un <p> vacío deja un hueco en el hero. */}
                  {selectedDetail.program.courseCount > 0 || selectedDetail.program.creditHours ? (
                    <p className="program-hours">
                      {selectedDetail.program.courseCount > 0 ? (
                        <strong>{etiquetaCursosIncluidos(selectedDetail.program.courseCount)}</strong>
                      ) : null}
                      {selectedDetail.program.creditHours ? (
                        <span>{t('program.creditHours', { count: selectedDetail.program.creditHours })}</span>
                      ) : null}
                    </p>
                  ) : null}
                </div>
              </header>

              <nav className="program-section-nav" aria-label={t('nav.sections')}>
                <div className="program-section-nav-inner">
                  <a href="#programa-sobre">{t('program.navAbout')}</a>
                  {selectedDetail.program.courses.length > 0 ? (
                    <a href="#programa-temario">{t('program.navSyllabus')}</a>
                  ) : null}
                  {(selectedDetail.outline?.length ?? 0) > 0 ? (
                    <a href="#programa-plan">{t('program.navPlan')}</a>
                  ) : null}
                  <a href="#programa-formato">{t('program.navFormat')}</a>
                  {(selectedDetail.related?.length ?? 0) > 0 ? (
                    <a href="#programa-similares">{t('program.navSimilar')}</a>
                  ) : null}
                </div>
              </nav>

              <section className="program-band" id="programa-sobre">
                <div className="program-band-inner program-about">
                  <div>
                    <h2 className="program-h2">{t('program.aboutTitle')}</h2>
                    {/* Texto plano del registro del programa, que es el dato
                        institucional. Ya no se inyecta HTML: el resumen
                        enriquecido era del curso de Moodle. */}
                    {selectedDetail.program.summary ? (
                      <p className="program-prose">{selectedDetail.program.summary}</p>
                    ) : null}
                  </div>
                  <aside className="program-cta-card">
                    <p className="program-cta-kicker">{t('program.ctaTitle')}</p>
                    <p className="program-cta-body">{t('program.ctaBody')}</p>
                    {/* Un único destino: admisiones. Aquí había un segundo
                        botón que abría el aula del curso —o su vista previa— y
                        era justamente la puerta al curso suelto que se cierra.
                        Quien ya está matriculado entra desde «Mis cursos». */}
                    <button
                      className="program-cta-btn"
                      onClick={() => setView({ type: 'page', slug: 'admissions' })}
                    >
                      {t('program.ctaButton')}
                    </button>
                  </aside>
                </div>
              </section>

              {/* TEMARIO: los cursos que incluye el programa.
                  Se lee como un índice y no como una lista de accesos. Cada
                  entrada es un <li> con texto: ni enlace, ni botón, ni nada
                  pulsable, porque un curso no se cursa por separado y ofrecer
                  algo que lleva a una puerta cerrada es peor que no ofrecerlo.
                  Quien quiera cursarlo se matricula en el programa. */}
              {selectedDetail.program.courses.length > 0 ? (
                <section className="program-band alt" id="programa-temario">
                  <div className="program-band-inner">
                    <h2 className="program-h2">{t('program.syllabusTitle')}</h2>
                    <p className="program-band-lead">{t('program.syllabusLead')}</p>
                    <ol className="programa-temario">
                      {selectedDetail.program.courses.map((curso: CursoDelPrograma, indice: number) => (
                        <li key={`${curso.titulo}-${indice}`}>
                          <span className="temario-n" aria-hidden="true">
                            {String(indice + 1).padStart(2, '0')}
                          </span>
                          <div className="temario-cuerpo">
                            <h3 className="temario-titulo">{curso.titulo}</h3>
                            {curso.resumen ? <p className="temario-resumen">{curso.resumen}</p> : null}
                            {/* `modulos` es null cuando el aula no está
                                montada; en ese caso no se escribe nada. */}
                            {curso.modulos ? (
                              <p className="temario-modulos">{t('program.courseModules', { count: curso.modulos })}</p>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ol>
                    <p className="programa-temario-nota">{t('program.syllabusNoAccess')}</p>
                  </div>
                </section>
              ) : null}

              {(selectedDetail.outline?.length ?? 0) > 0 ? (
                <section className="program-band" id="programa-plan">
                  <div className="program-band-inner">
                    <h2 className="program-h2">{t('program.planTitle')}</h2>
                    <p className="program-band-lead">{t('program.planLead')}</p>
                    <ol className="program-weeks">
                      {selectedDetail.outline?.map((week) => (
                        <li key={week.week}>
                          <span className="program-week-n">{String(week.week).padStart(2, '0')}</span>
                          <span className="program-week-title">{week.title}</span>
                          {week.activities > 0 ? (
                            <span className="program-week-count">
                              {t('program.planActivities', { count: week.activities })}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  </div>
                </section>
              ) : null}

              <section className="program-band alt" id="programa-formato">
                <div className="program-band-inner">
                  <h2 className="program-h2">{t('program.formatTitle')}</h2>
                  <div className="program-format">
                    <div className="program-format-card">
                      <h3>{t('program.formatOnlineTitle')}</h3>
                      <p>{t('program.formatOnlineBody')}</p>
                    </div>
                    <div className="program-format-card">
                      <h3>{t('program.formatCadenceTitle')}</h3>
                      <p>{t('program.formatCadenceBody')}</p>
                    </div>
                    <div className="program-format-card">
                      <h3>{t('program.formatBilingualTitle')}</h3>
                      <p>{t('program.formatBilingualBody')}</p>
                    </div>
                  </div>
                </div>
              </section>

              {(selectedDetail.related?.length ?? 0) > 0 ? (
                <section className="program-band" id="programa-similares">
                  <div className="program-band-inner">
                    <h2 className="program-h2">{t('program.similarTitle')}</h2>
                    <div className="program-similar">
                      {selectedDetail.related?.map((similar) => {
                        const area = areaDelPrograma(similar);
                        return (
                          <button
                            key={similar.id}
                            className="program-similar-card"
                            data-accent={categoryAccentKey(area)}
                            onClick={() => abrirPrograma(similar)}
                          >
                            {similar.heroImage ? <img src={similar.heroImage} alt="" loading="lazy" /> : null}
                            {area ? <span className="program-similar-cat">{area}</span> : null}
                            <span className="program-similar-title">{similar.title}</span>
                            {similar.courseCount > 0 ? (
                              <span className="program-similar-meta">{etiquetaCursosIncluidos(similar.courseCount)}</span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </section>
              ) : null}
            </article>
          )}
        </section>
      ) : null}

      {view.type === 'course' ? (
        <section className="course-layout course-layout-modern">
          <div className="course-header course-header-modern">
            {/* El aula ya no tiene portada ni entradilla: salían de la ficha
                del curso en el catálogo público, que ahora es de programas. El
                título es el de la matrícula, que es el dato autoritativo. */}
            <div className="course-header-surface">
              <div className="course-header-backdrop" />
              <div className="course-header-content">
                <div className="course-header-top">
                  <span className="course-stage-pill">
                    {activeModuleIndex >= 0 ? t('course.module', { current: activeModuleIndex + 1, total: flatModules.length }) : t('course.learningPath')}
                  </span>
                  <button className="back-link" onClick={() => setView({ type: 'my-courses' })}>
                    {t('course.goMyCourses')}
                  </button>
                </div>
                <h1>{view.titulo || t('course.enterCourse')}</h1>
              </div>
            </div>
            <div className="progress-row progress-row-modern">
              <div className="progress-pill">
                <span>{t('course.progressLabel')}</span>
                <strong>{progressPercent}%</strong>
              </div>
              <div className="progress-pill">
                <span>{t('course.completedLabel')}</span>
                <strong>{completedCount}/{flatModules.length}</strong>
              </div>
              <div className="progress-pill">
                <span>XP</span>
                <strong>{progress.xp}</strong>
              </div>
              <div className="progress-pill">
                <span>{t('course.level')}</span>
                <strong>{level}</strong>
              </div>
            </div>
            <div className="progress-bar-track progress-bar-track-modern">
              <div className="progress-bar-fill" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>

          <div className="course-grid course-grid-modern">
            <aside className="course-sidebar course-sidebar-modern">
              <div className="learning-map-head">
                <h3>{t('course.plan')}</h3>
                <span>{t('course.activities', { count: flatModules.length })}</span>
              </div>
              {loadingCourseContent ? <p>{t('course.loadingStructure')}</p> : null}
              {courseContentError ? <p className="public-error">{courseContentError}</p> : null}
              {sectionGroups.map(([sectionName, modules], sectionIndex) => (
                <div className="learning-section" key={`${sectionName}-${sectionIndex}`}>
                  <div className="learning-section-title">{sectionName}</div>
                  <div className="learning-section-list">
                    {/* Sin módulos candados: al aula se entra con matrícula
                        activa, así que todos los módulos están disponibles. */}
                    {modules.map((row) => {
                      const isActive = row.module.id === activeModuleId;
                      const isDone = progress.completedModuleIds.includes(row.module.id);
                      return (
                        <button
                          key={row.module.id}
                          className={`module-nav-btn module-nav-modern ${isActive ? 'active' : ''}`}
                          onClick={() => {
                            setActiveModuleId(row.module.id);
                            setActiveFileUrl(null);
                          }}
                        >
                          <div>
                            <strong>{row.module.name}</strong>
                            <span>{row.module.modname}</span>
                          </div>
                          <em>{isDone ? t('course.moduleDone') : t('course.modulePending')}</em>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </aside>

            <article className="course-main course-main-modern">
              {!activeModule ? (
                <p>{t('course.selectModule')}</p>
              ) : (
                <>
                  <header className="module-headline module-headline-modern">
                    <div>
                      <p className="module-kicker">{activeModule.sectionName}</p>
                      <h2>{activeModule.module.name}</h2>
                      <p>{t('course.activityType')} {activeModule.module.modname}</p>
                    </div>
                    <div className="module-actions-top">
                      <button onClick={() => goToNeighborModule(-1)} disabled={activeModuleIndex <= 0}>{t('course.prev')}</button>
                      <button onClick={() => goToNeighborModule(1)} disabled={activeModuleIndex < 0 || activeModuleIndex >= flatModules.length - 1}>{t('course.next')}</button>
                    </div>
                  </header>

                  <section className="module-content-card module-content-modern">
                    <h3>{t('course.classAndMaterial')}</h3>
                    <div className="moodle-html" dangerouslySetInnerHTML={{ __html: activeModuleDescriptionHtml }} />
                    {activeModuleVideoUrl || activeModuleFileVideoUrl ? (
                      <div className="inline-video-player">
                        <video controls preload="metadata" src={activeModuleVideoUrl ?? activeModuleFileVideoUrl ?? undefined} />
                      </div>
                    ) : null}

                    {!activeModuleVideoUrl && !activeModuleFileVideoUrl && (activeModule.module.contents ?? []).length > 0 ? (
                      <div className="file-list">
                        {(activeModule.module.contents ?? []).map((file, index) => {
                          const fileUrl = file.fileurl;
                          if (!fileUrl || !publicSession?.token) {
                            return null;
                          }
                          const proxiedUrl = api.moodleFileUrl(fileUrl, publicSession.token);
                          return (
                            <button
                              key={`${activeModule.module.id}-${index}`}
                              className={`file-btn ${activeFileUrl === proxiedUrl ? 'active' : ''}`}
                              onClick={() => setActiveFileUrl(proxiedUrl)}
                            >
                              {file.filename ?? file.filepath ?? `Archivo ${index + 1}`}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}

                    {!activeModuleVideoUrl && !activeModuleFileVideoUrl && (activeModule.module.contents ?? []).length === 0 ? (
                      <p className="module-empty-note">{t('course.noAttachments')}</p>
                    ) : null}

                    {!activeModuleVideoUrl && !activeModuleFileVideoUrl && activeFileUrl ? (
                      <div className="file-viewer">
                        <iframe src={activeFileUrl} title={t('course.fileTitle')} />
                      </div>
                    ) : null}
                  </section>

                  <section className="interaction-box interaction-box-modern">
                    <div className="interaction-heading">
                      <h3>{t('course.activityDev')}</h3>
                      <span>{t('course.saveGuide')}</span>
                    </div>
                    <textarea
                      value={interactionText}
                      onChange={(event) => setInteractionText(event.target.value)}
                      placeholder={t('course.writeHere')}
                    />
                    <div className="interaction-actions">
                      <button onClick={() => void onSubmitInteraction()} disabled={interactionSaving || !interactionText.trim()}>
                        {interactionSaving ? t('course.saving') : t('course.saveProgress')}
                      </button>
                      <button
                        className={`completion-inline-btn ${activeModuleCompleted ? 'done' : ''}`}
                        onClick={markModuleComplete}
                        disabled={activeModuleCompleted}
                      >
                        {activeModuleCompleted ? `${t('course.completed')} ✓` : t('course.markComplete')}
                      </button>
                    </div>
                    <p className={`completion-inline-hint ${activeModuleCompleted ? 'done' : ''}`}>
                      {activeModuleCompleted ? t('course.alreadyCompleted') : t('course.completeWhenDone')}
                    </p>
                    {interactionMessage ? <p className="interaction-feedback">{interactionMessage}</p> : null}
                    <div className="interaction-history interaction-history-modern">
                        <h4>{t('course.activityHistory')}</h4>
                        {interactionHistory.length === 0 ? (
                          <p>{t('course.noHistory')}</p>
                        ) : (
                          <ul>
                            {interactionHistory.slice(0, 10).map((entry) => {
                              const textValue =
                                typeof entry.response?.text === 'string'
                                  ? entry.response.text
                                  : JSON.stringify(entry.response);
                              return (
                                <li key={entry.id}>
                                  <div>
                                    <strong>{entry.module_name}</strong>
                                    <span>{new Date(entry.created_at).toLocaleString()}</span>
                                  </div>
                                  <p>{textValue}</p>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                    </div>
                  </section>
                </>
              )}
            </article>

            <aside className="gamification-panel gamification-panel-modern">
              <h3>{t('course.yourProgress')}</h3>
              <div className="stat-grid">
                <div><span>{t('course.modules')}</span><strong>{completedCount}/{flatModules.length}</strong></div>
                <div><span>{t('course.interactions')}</span><strong>{progress.interactionsCount}</strong></div>
                <div><span>XP</span><strong>{progress.xp}</strong></div>
                <div><span>{t('course.level')}</span><strong>{level}</strong></div>
              </div>
              <h4>{t('course.achievements')}</h4>
              <ul className="achievement-list">
                {achievements.map((achievement) => (
                  <li key={achievement.id} className={achievement.unlocked ? 'unlocked' : ''}>
                    <strong>{achievement.title}</strong>
                    <span>{achievement.description}</span>
                  </li>
                ))}
              </ul>
            </aside>
          </div>
          <div className={`victory-toast ${victoryState ? 'show' : ''}`} role="status" aria-live="polite">
            <div className="victory-toast-body">
              <strong>{t('course.moduleCompleted')}</strong>
              <p>{victoryState?.moduleName ?? ''}</p>
              <span>+{victoryState?.xp ?? 0} XP</span>
            </div>
            <div className="victory-sparks" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
          </div>
        </section>
      ) : null}

      {view.type === 'my-courses' ? (
        <section className="section-block profile-block profile-modern">
          <div className="section-header-row">
            <div>
              <h2>{t('myCourses.title')}</h2>
              <p className="row-subtitle">
                {publicSession ? `${publicSession.user.fullName} · ${publicSession.user.email}` : t('myCourses.loginRequired')}
              </p>
            </div>
            <button className="ghost-btn" onClick={() => setView({ type: 'profile' })}>
              {t('myCourses.editProfile')}
            </button>
          </div>
          {publicSession ? (
            <div className="profile-summary-grid">
              <article className="profile-summary-card">
                <span>{t('myCourses.activeCourses')}</span>
                <strong>{misCursos.length}</strong>
              </article>
              <article className="profile-summary-card">
                <span>{t('myCourses.avgProgress')}</span>
                <strong>
                  {(() => {
                    if (misCursos.length === 0) {
                      return '0%';
                    }
                    const total = misCursos.reduce((acc, curso) => {
                      const savedProgress =
                        progressByCourseId[curso.moodleCourseId] ?? loadCourseProgress(curso.moodleCourseId);
                      const modules = Math.max(savedProgress.totalModules, 1);
                      const percent = Math.round((savedProgress.completedModuleIds.length / modules) * 100);
                      return acc + Math.min(100, Math.max(0, percent));
                    }, 0);
                    return `${Math.round(total / misCursos.length)}%`;
                  })()}
                </strong>
              </article>
              <article className="profile-summary-card">
                <span>{t('myCourses.account')}</span>
                <strong>{publicSession.user.locale.toUpperCase()}</strong>
              </article>
            </div>
          ) : null}
          {myCoursesLoading ? <p>{t('home.loadingCourses')}</p> : null}
          {!myCoursesLoading && misCursos.length === 0 ? <p>{t('myCourses.empty')}</p> : null}
          {/* Los cursos del estudiante salen de sus matrículas y entran al
              aula con el id de Moodle. Antes se buscaba el curso en el catálogo
              público para sacar portada y slug, y si no aparecía la tarjeta se
              quedaba inerte («No disponible»). El catálogo ya no tiene cursos,
              y la matrícula trae todo lo que hace falta para entrar. */}
          <div className="profile-courses-grid">
            {misCursos.map((curso) => {
              const savedProgress =
                progressByCourseId[curso.moodleCourseId] ?? loadCourseProgress(curso.moodleCourseId);
              const modules = Math.max(savedProgress.totalModules, 1);
              const percent = Math.min(100, Math.max(0, Math.round((savedProgress.completedModuleIds.length / modules) * 100)));
              const titulo = curso.titulo || t('myCourses.myClassroom');
              return (
                <button
                  key={`${curso.moodleCourseId}-${curso.matriculadoEn}`}
                  className="content-tile profile-course-tile aula-tile"
                  onClick={() => abrirAula(curso.moodleCourseId, titulo)}
                >
                  <div className="tile-overlay profile-tile-overlay">
                    <div className="profile-tile-top">
                      <span className="public-badge kind-course">{t('myCourses.myClassroom')}</span>
                      <span className="profile-progress-pill">{percent}%</span>
                    </div>
                    <h4>{titulo}</h4>
                    <div className="profile-tile-progress" aria-hidden="true">
                      <div style={{ width: `${percent}%` }} />
                    </div>
                    <span className="profile-tile-cta">{t('myCourses.continueCourse')}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {view.type === 'my-program' ? (
        publicSession?.token ? (
          <StudentProgram
            token={publicSession.token}
            onAbrirAula={abrirAula}
            onGoCatalog={() => setView({ type: 'catalog' })}
          />
        ) : (
          <section className="section-block">
            <p>{t('myProgram.loginRequired')}</p>
          </section>
        )
      ) : null}

      {view.type === 'academics' ? (
        publicSession?.token ? (
          <StudentAcademics token={publicSession.token} onGoMyCourses={() => setView({ type: 'my-courses' })} />
        ) : (
          <section className="section-block">
            <p>{t('profile.loginRequired')}</p>
          </section>
        )
      ) : null}

      {view.type === 'profile' ? (
        <section className="section-block profile-editor-block">
          <div className="section-header-row">
            <div>
              <h2>{t('profile.title')}</h2>
              <p className="row-subtitle">{t('profile.subtitle')}</p>
            </div>
            <button className="ghost-btn" onClick={() => setView({ type: 'my-courses' })}>
              {t('profile.goMyCourses')}
            </button>
          </div>
          {!publicSession ? (
            <p>{t('profile.loginRequired')}</p>
          ) : (
            <form className="profile-editor-form" onSubmit={onSaveProfile}>
              <label>
                {t('profile.fullName')}
                <input
                  value={profileForm.fullName}
                  onChange={(event) => setProfileForm((current) => ({ ...current, fullName: event.target.value }))}
                  required
                  minLength={3}
                />
              </label>
              <label>
                {t('profile.email')}
                <input
                  type="email"
                  value={profileForm.email}
                  onChange={(event) => setProfileForm((current) => ({ ...current, email: event.target.value }))}
                  autoComplete="email"
                  inputMode="email"
                  required
                />
              </label>
              <label>
                {t('profile.language')}
                <select
                  value={profileForm.locale}
                  onChange={(event) => setProfileForm((current) => ({ ...current, locale: event.target.value }))}
                >
                  <option value="es">{t('language.es')}</option>
                  <option value="en">{t('language.en')}</option>
                </select>
              </label>
              <div className="profile-editor-actions">
                <button type="submit" className="go-course-btn" disabled={profileSaving}>
                  {profileSaving ? t('profile.saving') : t('profile.save')}
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() =>
                    setProfileForm({
                      fullName: publicSession.user.fullName ?? '',
                      email: publicSession.user.email ?? '',
                      locale: publicSession.user.locale ?? 'es'
                    })
                  }
                  disabled={profileSaving}
                >
                  {t('profile.reset')}
                </button>
              </div>
              {profileMessage ? <p className="profile-editor-feedback success">{profileMessage}</p> : null}
              {profileError ? <p className="profile-editor-feedback error">{profileError}</p> : null}
            </form>
          )}
        </section>
      ) : null}

      {view.type === 'enterprise' ? (
        <section className="section-block enterprise-landing">
          <article className="enterprise-hero">
            <div className="enterprise-hero-backdrop" />
            <div className="enterprise-hero-content">
              <p className="enterprise-eyebrow">{t('enterprise.eyebrow')}</p>
              <h2>{t('enterprise.title')}</h2>
              <p>{t('enterprise.subtitle')}</p>
              <div className="enterprise-hero-actions">
                {!publicSession ? (
                  <button
                    className="go-course-btn"
                    onClick={() => {
                      setAuthMode('login');
                      setShowAuthModal(true);
                    }}
                  >
                    {t('enterprise.talkToAdvisor')}
                  </button>
                ) : (
                  <button className="go-course-btn" onClick={() => setView({ type: 'my-courses' })}>
                    {t('enterprise.goToCourses')}
                  </button>
                )}
                <button className="ghost-btn" onClick={() => setView({ type: 'catalog' })}>
                  {t('enterprise.exploreCatalog')}
                </button>
              </div>
            </div>
          </article>

          {/* Aquí había una franja titulada «Instituciones que forman a sus
              equipos con TFU» con ocho nombres de empresa escritos a mano:
              Retail Corp, Realty Group, Sales Partners, Fintech Hub, Health
              Network, Logistics Pro, EdTech Labs y Service Alliance. Ninguna
              es cliente de TFU: venían de la plantilla del producto original.
              Era una afirmación de clientela inventada, publicada en el sitio
              de una universidad real.

              Si TFU llega a tener instituciones cliente que autoricen aparecer,
              esto vuelve con sus nombres reales y su permiso, no antes. */}

          <div className="enterprise-value-grid">
            <article className="enterprise-value-card">
              <span>{t('enterprise.valueGrid.programs')}</span>
              <strong>{t('enterprise.valueGrid.programsDesc')}</strong>
            </article>
            <article className="enterprise-value-card">
              <span>{t('enterprise.valueGrid.tracking')}</span>
              <strong>{t('enterprise.valueGrid.trackingDesc')}</strong>
            </article>
            <article className="enterprise-value-card">
              <span>{t('enterprise.valueGrid.governance')}</span>
              <strong>{t('enterprise.valueGrid.governanceDesc')}</strong>
            </article>
          </div>

          {!publicSession ? (
            <section className="enterprise-split">
              <article className="enterprise-explainer">
                <h3>{t('enterprise.howItWorks')}</h3>
                <p>{t('enterprise.howItWorksDesc')}</p>
                <ol className="enterprise-steps-list">
                  <li>
                    <strong>{t('enterprise.steps.activate')}</strong>
                    <span>{t('enterprise.steps.activateDesc')}</span>
                  </li>
                  <li>
                    <strong>{t('enterprise.steps.enroll')}</strong>
                    <span>{t('enterprise.steps.enrollDesc')}</span>
                  </li>
                  <li>
                    <strong>{t('enterprise.steps.assign')}</strong>
                    <span>{t('enterprise.steps.assignDesc')}</span>
                  </li>
                </ol>
                <div className="enterprise-example-grid">
                  <article>
                    <p className="kicker">{t('enterprise.case1')}</p>
                    <h4>{t('enterprise.case1Title')}</h4>
                    <p>{t('enterprise.case1Desc')}</p>
                  </article>
                  <article>
                    <p className="kicker">{t('enterprise.case2')}</p>
                    <h4>{t('enterprise.case2Title')}</h4>
                    <p>{t('enterprise.case2Desc')}</p>
                  </article>
                </div>
                <div className="enterprise-simple-cta">
                  <span>{t('enterprise.ctaText')}</span>
                  <button className="go-course-btn" onClick={() => setAuthMode('register')}>
                    {t('enterprise.ctaButton')}
                  </button>
                </div>
              </article>

              <article className="enterprise-auth-panel">
                <h3>{authMode === 'register' ? t('enterprise.authTitle.register') : t('enterprise.authTitle.login')}</h3>
                <p>
                  {authMode === 'register'
                    ? t('enterprise.authSubtitle.register')
                    : t('enterprise.authSubtitle.login')}
                </p>
                <div className="enterprise-auth-trust">
                  <span>{t('enterprise.authTrust.guided')}</span>
                  <span>{t('enterprise.authTrust.support')}</span>
                  <span>{t('enterprise.authTrust.scalable')}</span>
                </div>
                <div className="auth-switch">
                  <button className={authMode === 'register' ? 'active' : ''} onClick={() => setAuthMode('register')}>
                    {t('enterprise.register')}
                  </button>
                  <button className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>
                    {t('enterprise.loginTab')}
                  </button>
                </div>

                {authMode === 'register' ? (
                  <form className="auth-form enterprise-auth-form" onSubmit={onRegister}>
                    <label className="enterprise-input-label">
                      {t('enterprise.fullName')}
                      <input
                        placeholder={t('auth.fullNamePlaceholder')}
                  aria-label={t('auth.fullNamePlaceholder')}
                        value={registerForm.fullName}
                        onChange={(event) => setRegisterForm((current) => ({ ...current, fullName: event.target.value }))}
                        required
                      />
                    </label>
                    <label className="enterprise-input-label">
                      {t('enterprise.institutionalEmail')}
                      <input
                        type="email"
                        placeholder={t('enterprise.emailPlaceholder')}
                  aria-label={t('enterprise.emailPlaceholder')}
                        value={registerForm.email}
                        onChange={(event) => setRegisterForm((current) => ({ ...current, email: event.target.value }))}
                        autoComplete="email"
                        inputMode="email"
                        required
                      />
                    </label>
                    <div className="password-field">
                      <input
                        type={showRegisterPassword ? 'text' : 'password'}
                        placeholder={t('auth.password')}
                  aria-label={t('auth.password')}
                        value={registerForm.password}
                        onChange={(event) => setRegisterForm((current) => ({ ...current, password: event.target.value }))}
                        autoComplete="new-password"
                        required
                      />
                      <button
                        type="button"
                        className="password-toggle"
                        onClick={() => setShowRegisterPassword((current) => !current)}
                        aria-label={showRegisterPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                        title={showRegisterPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                      >
                        <PasswordToggleIcon visible={showRegisterPassword} />
                      </button>
                    </div>
                    <label className="enterprise-input-label">
                      {t('enterprise.language')}
                      <select
                        value={registerForm.locale}
                        onChange={(event) => setRegisterForm((current) => ({ ...current, locale: event.target.value }))}
                      >
                        <option value="es">{t('language.es')}</option>
                        <option value="en">{t('language.en')}</option>
                      </select>
                    </label>
                    <div className="auth-inline-actions">
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => {
                          const generated = generateStrongPassword();
                          setRegisterForm((current) => ({
                            ...current,
                            password: generated,
                            confirmPassword: generated
                          }));
                        }}
                      >
                        {t('auth.generatePassword')}
                      </button>
                    </div>
                    <div className="password-field">
                      <input
                        type={showRegisterConfirmPassword ? 'text' : 'password'}
                        placeholder={t('auth.confirmPassword')}
                  aria-label={t('auth.confirmPassword')}
                        value={registerForm.confirmPassword}
                        onChange={(event) =>
                          setRegisterForm((current) => ({ ...current, confirmPassword: event.target.value }))
                        }
                        autoComplete="new-password"
                        required
                      />
                      <button
                        type="button"
                        className="password-toggle"
                        onClick={() => setShowRegisterConfirmPassword((current) => !current)}
                        aria-label={showRegisterConfirmPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                        title={showRegisterConfirmPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                      >
                        <PasswordToggleIcon visible={showRegisterConfirmPassword} />
                      </button>
                    </div>
                    <div className="enterprise-password-hints">
                      <span className={registerForm.password.length >= 10 ? 'ok' : ''}>{t('auth.minChars')}</span>
                      <span className={/[A-Z]/.test(registerForm.password) ? 'ok' : ''}>{t('auth.oneUppercase')}</span>
                      <span className={/[0-9]/.test(registerForm.password) ? 'ok' : ''}>{t('auth.oneNumber')}</span>
                      <span className={/[!@#$%^&*]/.test(registerForm.password) ? 'ok' : ''}>{t('auth.oneSymbol')}</span>
                    </div>
                    <label className="auth-terms">
                      <input
                        type="checkbox"
                        checked={registerForm.acceptedTerms}
                        onChange={(event) =>
                          setRegisterForm((current) => ({ ...current, acceptedTerms: event.target.checked }))
                        }
                        required
                      />
                      <span>
                        {t('auth.acceptTerms')}
                      </span>
                    </label>
                    <button className="auth-submit" type="submit" disabled={authLoading}>
                      {authLoading ? t('auth.processing') : t('auth.registerButton')}
                    </button>
                  </form>
                ) : (
                  <form className="auth-form enterprise-auth-form" onSubmit={onLogin}>
                    <label className="enterprise-input-label">
                      {t('enterprise.institutionalEmail')}
                      <input
                        type="email"
                        placeholder={t('enterprise.emailPlaceholder')}
                  aria-label={t('enterprise.emailPlaceholder')}
                        value={loginForm.email}
                        onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))}
                        autoComplete="email"
                        inputMode="email"
                        required
                      />
                    </label>
                    <div className="password-field">
                      <input
                        type={showLoginPassword ? 'text' : 'password'}
                        placeholder={t('auth.password')}
                  aria-label={t('auth.password')}
                        value={loginForm.password}
                        onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                        autoComplete="current-password"
                        required
                      />
                      <button
                        type="button"
                        className="password-toggle"
                        onClick={() => setShowLoginPassword((current) => !current)}
                        aria-label={showLoginPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                        title={showLoginPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                      >
                        <PasswordToggleIcon visible={showLoginPassword} />
                      </button>
                    </div>
                    <div className="enterprise-login-row">
                      <span>{t('enterprise.secureAccess')}</span>
                      <a href={`mailto:${INSTITUTION_CONTACTS.general}`}>{t('enterprise.needHelp')}</a>
                    </div>
                    <label className="auth-terms">
                      <input
                        type="checkbox"
                        checked={loginForm.acceptedTerms}
                        onChange={(event) =>
                          setLoginForm((current) => ({ ...current, acceptedTerms: event.target.checked }))
                        }
                        required
                      />
                      <span>
                        {t('auth.acceptTerms')}
                      </span>
                    </label>
                    <button className="auth-submit" type="submit" disabled={authLoading}>
                      {authLoading ? t('auth.loggingIn') : t('auth.loginButton')}
                    </button>
                  </form>
                )}
                {authError ? <p className="public-error">{authError}</p> : null}
              </article>
            </section>
          ) : enterpriseLoading ? (
            <p>{t('enterprise.loadingData')}</p>
          ) : !enterpriseAvailable ? (
            <div className="my-courses-empty">
              <p>{t('enterprise.notLinked')}</p>
            </div>
          ) : (
            <>
              <article className="card-like enterprise-company-card">
                <h3>{enterpriseOverview?.company?.name ?? t('enterprise.department')}</h3>
                <p>{enterpriseOverview?.company?.description ?? t('enterprise.activeProgram')}</p>
                <p>
                  {t('enterprise.role.label')} <strong>{enterpriseOverview?.role === 'representative' ? t('enterprise.role.representative') : t('enterprise.role.collaborator')}</strong>
                </p>
              </article>

              {enterpriseIsRepresentative && enterpriseOverview?.stats ? (
                <div className="enterprise-stats-grid">
                  <div className="enterprise-stat-box">
                    <span className="stat-label">{t('enterprise.stats.totalMembers')}</span>
                    <span className="stat-value">{enterpriseOverview.stats.totalMembers}</span>
                  </div>
                  <div className="enterprise-stat-box">
                    <span className="stat-label">{t('enterprise.stats.activeMembers')}</span>
                    <span className="stat-value">{enterpriseOverview.stats.activeMembers}</span>
                  </div>
                  <div className="enterprise-stat-box">
                    <span className="stat-label">{t('enterprise.stats.enrollments')}</span>
                    <span className="stat-value">{enterpriseOverview.stats.totalEnrollments}</span>
                  </div>
                  <div className="enterprise-stat-box">
                    <span className="stat-label">{t('enterprise.stats.avgProgress')}</span>
                    <span className="stat-value">{enterpriseOverview.stats.averageProgress}%</span>
                  </div>
                  <div className="enterprise-stat-box">
                    <span className="stat-label">{t('enterprise.stats.interactions')}</span>
                    <span className="stat-value">{enterpriseOverview.stats.totalInteractions}</span>
                  </div>
                </div>
              ) : null}

              {enterpriseIsRepresentative ? (
                <div className="grid-like-two">
                  <article className="card-like enterprise-panel-card">
                    <h3>{t('enterprise.addStudent')}</h3>
                    <form className="profile-editor-form" onSubmit={onEnterpriseAddMember}>
                      <label>
                        {t('enterprise.fullName')}
                        <input
                          value={enterpriseMemberForm.fullName}
                          onChange={(event) =>
                            setEnterpriseMemberForm((current) => ({ ...current, fullName: event.target.value }))
                          }
                          required
                        />
                      </label>
                      <label>
                        {t('enterprise.email')}
                        <input
                          type="email"
                          value={enterpriseMemberForm.email}
                          onChange={(event) =>
                            setEnterpriseMemberForm((current) => ({ ...current, email: event.target.value }))
                          }
                          required
                        />
                      </label>
                      <label>
                        {t('enterprise.language')}
                        <input
                          value={enterpriseMemberForm.locale}
                          onChange={(event) =>
                            setEnterpriseMemberForm((current) => ({ ...current, locale: event.target.value }))
                          }
                        />
                      </label>
                      <button type="submit" className="go-course-btn" disabled={enterpriseSaving}>
                        {enterpriseSaving ? t('enterprise.addingStudent') : t('enterprise.addStudent')}
                      </button>
                    </form>
                  </article>

                  {/* Reactivar un curso que el departamento ya tiene habilitado.
                      Antes este desplegable listaba los trece cursos del
                      catálogo público, de donde sacaba su id de Moodle. Ese
                      catálogo ya no tiene cursos, y los programas no traen el
                      id a propósito, así que la única lista legítima aquí es la
                      de los cursos que el departamento ya tiene (courseAccess).
                      Habilitar un curso NUEVO es una operación de la
                      institución y se hace desde el panel de administración,
                      que sí lista las aulas de Moodle. */}
                  <article className="card-like enterprise-panel-card">
                    <h3>{t('enterprise.reactivateCourses')}</h3>
                    {cursosDepartamentoInactivos.length === 0 ? (
                      <p>{t('enterprise.noInactiveCourses')}</p>
                    ) : (
                      <form className="profile-editor-form" onSubmit={onEnterpriseAssignCourse}>
                        <label>
                          {t('enterprise.course')}
                          <select
                            value={enterpriseCourseId}
                            onChange={(event) => setEnterpriseCourseId(event.target.value)}
                            required
                          >
                            <option value="">{t('enterprise.selectCourse')}</option>
                            {cursosDepartamentoInactivos.map((curso) => (
                              <option
                                key={`enterprise-course-${curso.moodle_course_id}`}
                                value={String(curso.moodle_course_id)}
                              >
                                {curso.full_name ?? curso.short_name ?? String(curso.moodle_course_id)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button type="submit" className="go-course-btn" disabled={enterpriseSaving}>
                          {enterpriseSaving ? t('enterprise.assigning') : t('enterprise.activate')}
                        </button>
                      </form>
                    )}
                  </article>
                </div>
              ) : null}

              {enterpriseIsRepresentative && enterpriseOverview?.courseAccess && (
                <EnterpriseGroupManager
                  token={publicSession!.token}
                  overview={enterpriseOverview}
                  onRefresh={() => loadEnterpriseOverview(publicSession!.token)}
                />
              )}

              <article className="card-like enterprise-panel-card">
                <h3>{t('enterprise.students')}</h3>
                <div className="simple-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('enterprise.name')}</th>
                        <th>{t('enterprise.email')}</th>
                        <th>{t('enterprise.role.columna')}</th>
                        <th>{t('enterprise.status')}</th>
                        {enterpriseIsRepresentative ? <th>{t('enterprise.action')}</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {(enterpriseOverview?.members ?? []).length === 0 ? (
                        <tr>
                          <td colSpan={enterpriseIsRepresentative ? 5 : 4}>{t('enterprise.noStudents')}</td>
                        </tr>
                      ) : (
                        (enterpriseOverview?.members ?? []).map((member) => (
                          <tr key={`enterprise-member-${member.user_id}`}>
                            <td>{member.full_name ?? member.user_id}</td>
                            <td>{member.email ?? '-'}</td>
                            <td>{member.member_role}</td>
                            <td>{member.status}</td>
                            {enterpriseIsRepresentative ? (
                              <td>
                                {member.member_role === 'representative' ? (
                                  <span>-</span>
                                ) : (
                                  <button
                                    className={member.status === 'active' ? 'ghost danger' : 'ghost'}
                                    onClick={() =>
                                      void onEnterpriseToggleMember(
                                        member.user_id,
                                        member.status === 'active' ? 'inactive' : 'active'
                                      )
                                    }
                                  >
                                    {member.status === 'active' ? t('enterprise.deactivate') : t('enterprise.activate')}
                                  </button>
                                )}
                              </td>
                            ) : null}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </article>

              <article className="card-like enterprise-panel-card">
                <h3>{t('enterprise.departmentCourses')}</h3>
                <div className="simple-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('enterprise.courseId')}</th>
                        <th>{t('enterprise.courseName')}</th>
                        <th>{t('enterprise.status')}</th>
                        {enterpriseIsRepresentative ? <th>{t('enterprise.action')}</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {(enterpriseOverview?.courseAccess ?? []).length === 0 ? (
                        <tr>
                          <td colSpan={enterpriseIsRepresentative ? 4 : 3}>{t('enterprise.noCourses')}</td>
                        </tr>
                      ) : (
                        (enterpriseOverview?.courseAccess ?? []).map((course) => (
                          <tr key={`enterprise-course-${course.moodle_course_id}`}>
                            <td>{course.moodle_course_id}</td>
                            <td>{course.full_name ?? course.short_name ?? '-'}</td>
                            <td>{course.is_active ? t('enterprise.active') : t('enterprise.inactive')}</td>
                            {enterpriseIsRepresentative ? (
                              <td>
                                <button
                                  className={course.is_active ? 'ghost danger' : 'ghost'}
                                  onClick={() => void onEnterpriseToggleCourse(Number(course.moodle_course_id), course.is_active)}
                                >
                                  {course.is_active ? t('enterprise.deactivate') : t('enterprise.activate')}
                                </button>
                              </td>
                            ) : null}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </article>

              {enterpriseIsRepresentative ? (
                <article className="card-like enterprise-panel-card">
                  <h3>{t('enterprise.studentProgress')}</h3>
                  <div className="simple-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>{t('enterprise.student')}</th>
                          <th>{t('enterprise.course')}</th>
                          <th>{t('enterprise.progress')}</th>
                          <th>{t('enterprise.interactions')}</th>
                          <th>{t('enterprise.lastActivity')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(enterpriseOverview?.memberProgress ?? []).length === 0 ? (
                          <tr>
                            <td colSpan={5}>{t('enterprise.noProgress')}</td>
                          </tr>
                        ) : (
                          (enterpriseOverview?.memberProgress ?? []).map((progress, idx) => (
                            <tr key={`enterprise-progress-${progress.user_id}-${progress.moodle_course_id}-${idx}`}>
                              <td>
                                {progress.full_name}
                                <br />
                                <small style={{ color: 'var(--text-muted)' }}>{progress.email}</small>
                              </td>
                              <td>{progress.course_name}</td>
                              <td>
                                <div className="progress-bar-wrap" style={{ width: '100px', background: 'var(--border-color)', height: '8px', borderRadius: '4px', overflow: 'hidden', display: 'inline-block', verticalAlign: 'middle', marginRight: '8px' }}>
                                  <div style={{ width: `${progress.progress_percent}%`, background: 'var(--primary-color)', height: '100%' }}></div>
                                </div>
                                {progress.progress_percent}%
                              </td>
                              <td>{progress.interactions_count}</td>
                              <td>
                                {progress.last_activity_at
                                  ? new Date(progress.last_activity_at).toLocaleDateString('es')
                                  : '-'}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </article>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {podcastPreview ? (
        <div className="auth-modal-backdrop">
          <div className="auth-modal ticket-modal podcast-modal" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="auth-close-btn"
              aria-label={t('home.closePodcast')}
              title={t('home.closePodcast')}
              onClick={() => setPodcastPreview(null)}
            >
              ×
            </button>
            <h3>{podcastPreview.title}</h3>
            <div className="podcast-embed-wrap">
              <iframe
                src={podcastPreview.embedUrl}
                title={podcastPreview.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      ) : null}

      {showAuthModal ? (
        <div className="auth-modal-backdrop">
          <div className="auth-modal" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="auth-close-btn"
              aria-label={t('auth.closeModal')}
              title={t('auth.closeModal')}
              onClick={() => setShowAuthModal(false)}
            >
              ×
            </button>
            <h3>{authMode === 'register' ? t('auth.createAccountForCourse') : t('auth.login')}</h3>
            <div className="auth-switch">
              <button className={authMode === 'register' ? 'active' : ''} onClick={() => setAuthMode('register')}>{t('auth.registerTab')}</button>
              <button className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>{t('auth.loginTab')}</button>
            </div>

            {authMode === 'register' ? (
              <form className="auth-form" onSubmit={onRegister}>
                <input
                  placeholder={t('auth.fullName')}
                  aria-label={t('auth.fullName')}
                  value={registerForm.fullName}
                  onChange={(event) => setRegisterForm((current) => ({ ...current, fullName: event.target.value }))}
                  required
                />
                <input
                  type="email"
                  placeholder={t('auth.email')}
                  aria-label={t('auth.email')}
                  value={registerForm.email}
                  onChange={(event) => setRegisterForm((current) => ({ ...current, email: event.target.value }))}
                  autoComplete="email"
                  inputMode="email"
                  required
                />
                <div className="password-field">
                  <input
                    type={showRegisterPassword ? 'text' : 'password'}
                    placeholder={t('auth.password')}
                  aria-label={t('auth.password')}
                    value={registerForm.password}
                    onChange={(event) => setRegisterForm((current) => ({ ...current, password: event.target.value }))}
                    autoComplete="new-password"
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowRegisterPassword((current) => !current)}
                    aria-label={showRegisterPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                    title={showRegisterPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                  >
                    <PasswordToggleIcon visible={showRegisterPassword} />
                  </button>
                </div>
                <div className="auth-inline-actions">
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => {
                      const generated = generateStrongPassword();
                      setRegisterForm((current) => ({
                        ...current,
                        password: generated,
                        confirmPassword: generated
                      }));
                    }}
                  >
                    {t('auth.generatePassword')}
                  </button>
                </div>
                <div className="password-field">
                  <input
                    type={showRegisterConfirmPassword ? 'text' : 'password'}
                    placeholder={t('auth.confirmPassword')}
                  aria-label={t('auth.confirmPassword')}
                    value={registerForm.confirmPassword}
                    onChange={(event) => setRegisterForm((current) => ({ ...current, confirmPassword: event.target.value }))}
                    autoComplete="new-password"
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowRegisterConfirmPassword((current) => !current)}
                    aria-label={showRegisterConfirmPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                    title={showRegisterConfirmPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                  >
                    <PasswordToggleIcon visible={showRegisterConfirmPassword} />
                  </button>
                </div>
                <label className="auth-terms">
                  <input
                    type="checkbox"
                    checked={registerForm.acceptedTerms}
                    onChange={(event) =>
                      setRegisterForm((current) => ({ ...current, acceptedTerms: event.target.checked }))
                    }
                    required
                  />
                  <span>{t('auth.acceptTerms')}</span>
                </label>
                <p className="auth-help">{t('auth.passwordHint')}</p>
                <button className="auth-submit" type="submit" disabled={authLoading}>
                  {authLoading ? t('auth.processing') : t('auth.registerButton')}
                </button>
              </form>
            ) : (
              <form className="auth-form" onSubmit={onLogin}>
                <input
                  type="email"
                  placeholder={t('auth.email')}
                  aria-label={t('auth.email')}
                  value={loginForm.email}
                  onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))}
                  autoComplete="email"
                  inputMode="email"
                  required
                />
                <div className="password-field">
                  <input
                    type={showLoginPassword ? 'text' : 'password'}
                    placeholder={t('auth.password')}
                  aria-label={t('auth.password')}
                    value={loginForm.password}
                    onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowLoginPassword((current) => !current)}
                    aria-label={showLoginPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                    title={showLoginPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                  >
                    <PasswordToggleIcon visible={showLoginPassword} />
                  </button>
                </div>
                <label className="auth-terms">
                  <input
                    type="checkbox"
                    checked={loginForm.acceptedTerms}
                    onChange={(event) => setLoginForm((current) => ({ ...current, acceptedTerms: event.target.checked }))}
                    required
                  />
                  <span>{t('auth.acceptTerms')}</span>
                </label>
                <button className="auth-submit" type="submit" disabled={authLoading}>
                  {authLoading ? t('auth.loggingIn') : t('auth.enter')}
                </button>
              </form>
            )}

            {authError ? <p className="public-error">{authError}</p> : null}
          </div>
        </div>
      ) : null}

      {view.type === 'contact' ? (
        <section className="section-block contact-main">
          <button className="back-link" onClick={() => setView({ type: 'home' })}>
            {t('legal.back')}
          </button>
          <ContactSection />
        </section>
      ) : null}

      {view.type === 'page' ? (
        <section className="section-block legal-block">
          <div className="legal-hero">
            <button className="back-link legal-back-btn" onClick={() => setView({ type: 'home' })}>
              {t('legal.back')}
            </button>
            <h1>{activeLegalDocument?.title ?? t('legal.title')}</h1>
            {/* El conmutador sólo tiene sentido entre las políticas; en
                Quiénes somos o Admisiones sería un menú fuera de lugar. */}
            {FOOTER_PAGE_SLUGS.includes(view.slug) ? (
              <div className="legal-switch">
                {FOOTER_PAGE_SLUGS.map((slug) => (
                  <button
                    key={slug}
                    className={view.slug === slug ? 'active' : ''}
                    aria-current={view.slug === slug ? 'page' : undefined}
                    onClick={() => setView({ type: 'page', slug })}
                  >
                    {pageTitle(slug)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="legal-layout">
            <article className="legal-content-card">
              {loadingLegal ? <p>{t('legal.loadingContent')}</p> : null}
              {!loadingLegal && activeLegalDocument ? (
                <div
                  className="legal-content-prose moodle-html"
                  dangerouslySetInnerHTML={{ __html: activeLegalDocument.html }}
                />
              ) : null}
              {/* La página de Admisiones no es sólo texto: lleva el
                  formulario debajo, para que el visitante no tenga que
                  buscarlo en otra parte después de leer el proceso. */}
              {!loadingLegal && view.slug === 'admissions' ? <AdmissionsForm /> : null}
              {!loadingLegal && activeLegalDocument ? (
                <p className="legal-updated">
                  {t('legal.updatedAt', {
                    date: new Date(activeLegalDocument.updatedAt).toLocaleDateString(
                      currentLang === 'en' ? 'en-US' : 'es-ES',
                      { year: 'numeric', month: 'long', day: 'numeric' }
                    )
                  })}
                </p>
              ) : null}
            </article>
            <aside className="legal-side-card">
              <h2>{t('legal.infoTitle')}</h2>
              <p>{t('legal.infoDesc')}</p>
              <p>{t('legal.contactDesc')}</p>
              <a href={`mailto:${INSTITUTION_CONTACTS.general}`}>{INSTITUTION_CONTACTS.general}</a>
            </aside>
          </div>
        </section>
      ) : null}

      {/* Pie con la marca, como el del sitio corporativo: el lockup y el lema
          a la izquierda, y tres columnas de enlaces. Antes era una tira de
          enlaces legales y una línea de copyright, sin identidad ninguna. */}
      <footer className="public-footer">
        <div className="footer-top">
          <div className="footer-brand">
            <img
              src="/brand/tfu-lockup.png"
              alt={BRAND}
              className="footer-lockup"
              width={382}
              height={66}
              loading="lazy"
            />
            <p className="footer-slogan">{t('nav.brandTagline')}</p>
            <a className="footer-mail" href={`mailto:${INSTITUTION_CONTACTS.general}`}>
              {INSTITUTION_CONTACTS.general}
            </a>
          </div>

          <nav className="footer-links" aria-label={t('nav.menu')}>
            {/* Las dos primeras columnas son de captación —admisiones, vida
                estudiantil, noticias, atletismo, para empresas— y no le sirven
                a quien ya está matriculado. Con sesión, el pie se reduce a lo
                que sí le corresponde a un estudiante: su portal, el contacto de
                soporte y las políticas, que son las que le dan derechos (FERPA,
                Título IX, accesibilidad). */}
            {!publicSession ? (
              <>
                <div className="footer-links-col">
                  <h3>{t('nav.navAcademics')}</h3>
                  <button className="footer-link-btn" onClick={() => setView({ type: 'catalog' })}>
                    {t('nav.catalog')}
                  </button>
                  <button className="footer-link-btn" onClick={() => setView({ type: 'page', slug: 'admissions' })}>
                    {t('nav.navAdmissions')}
                  </button>
                  <button className="footer-link-btn" onClick={() => setView({ type: 'page', slug: 'campus-life' })}>
                    {t('nav.navCampusLife')}
                  </button>
                </div>

                <div className="footer-links-col">
                  <h3>{t('nav.navAbout')}</h3>
                  <button className="footer-link-btn" onClick={() => setView({ type: 'page', slug: 'about' })}>
                    {t('nav.navAbout')}
                  </button>
                  <button className="footer-link-btn" onClick={() => setView({ type: 'page', slug: 'news-events' })}>
                    {t('nav.navNews')}
                  </button>
                  <button className="footer-link-btn" onClick={() => setView({ type: 'page', slug: 'athletics' })}>
                    {t('nav.navAthletics')}
                  </button>
                  <button className="footer-link-btn" onClick={() => setView({ type: 'enterprise' })}>
                    {t('nav.utilityEnterprise')}
                  </button>
                  <button className="footer-link-btn" onClick={() => setView({ type: 'contact' })}>
                    {t('nav.utilityContact')}
                  </button>
                </div>
              </>
            ) : (
              <div className="footer-links-col">
                <h3>{t('nav.studentPortal')}</h3>
                {STUDENT_NAV.map((item) => (
                  <button key={`f-${item.key}`} className="footer-link-btn" onClick={() => setView(item.view)}>
                    {t(item.key)}
                  </button>
                ))}
                <button className="footer-link-btn" onClick={() => setView({ type: 'contact' })}>
                  {t('nav.utilityContact')}
                </button>
              </div>
            )}

            <div className="footer-links-col">
              <h3>{t('footer.policies')}</h3>
              {FOOTER_PAGE_SLUGS.map((slug) => (
                <button
                  key={slug}
                  className="footer-link-btn"
                  onClick={() => setView({ type: 'page', slug })}
                >
                  {pageTitle(slug)}
                </button>
              ))}
            </div>
          </nav>
        </div>

        <div className="footer-compliance">
          <p className="footer-compliance-notice">
            {t('footer.complianceNotice')}{' '}
            <a href={`mailto:${INSTITUTION_CONTACTS.ferpa}`}>{INSTITUTION_CONTACTS.ferpa}</a>.
          </p>
        </div>
        <div className="footer-bottom">
          <span>{t('footer.copyright', { year: new Date().getFullYear() })}</span>
        </div>
      </footer>
    </main>
  );
}
