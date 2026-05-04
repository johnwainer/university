import { useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  type CatalogContentDetailResponse,
  type PublicCourseInteractionRecord,
  type LegalPageResponse,
  type MoodleCourseContentResponse,
  type PublicCourseProgressRecord,
  type PublicMyCoursesResponse,
  type PublicUserTicketRecord,
  type PublicSession,
  type WebinarRecord,
  type PodcastRecord,
  type ExternalIntegrationEventGroup,
  type EnterpriseOverviewResponse
} from '../lib/api';
import type { ContentAsset, HomeResponse } from '@pae-u/shared';
import { EnterpriseGroupManager } from './EnterpriseGroupManager';
import './public.css';

type ViewState =
  | { type: 'home' }
  | { type: 'catalog' }
  | { type: 'detail'; slug: string }
  | { type: 'course'; slug: string }
  | { type: 'my-courses' }
  | { type: 'my-tickets' }
  | { type: 'profile' }
  | { type: 'enterprise' }
  | { type: 'terms' }
  | { type: 'privacy' };

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
  items: ContentAsset[];
};

const DEFAULT_PROGRESS: CourseProgress = {
  completedModuleIds: [],
  interactionsCount: 0,
  xp: 0,
  lastActivityAt: null,
  totalModules: 0,
  progressPercent: 0
};

const PUBLIC_SESSION_STORAGE = 'pae-u-public-session';
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
  return `pae-u-progress-${courseId}`;
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

function ContentBadge({ kind }: { kind: ContentAsset['kind'] }) {
  return <span className={`public-badge kind-${kind}`}>{kind.toUpperCase()}</span>;
}

function normalizeCourseLabel(value: string): string {
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

function getCourseCategoryLabel(item: ContentAsset): string {
  if (item.kind !== 'course') {
    return item.kind.toUpperCase();
  }
  const asCourse = item as unknown as { categoryName?: string };
  if (asCourse.categoryName && asCourse.categoryName.trim()) {
    return normalizeCourseLabel(asCourse.categoryName);
  }
  const fallback = item.tags.find((tag) => !['course', 'moodle', 'synced'].includes(tag.toLowerCase()));
  return fallback ? normalizeCourseLabel(fallback) : 'Sin categoría';
}

function getAssetMoodleCourseId(item: ContentAsset): number | null {
  const value = Number((item as unknown as { moodleCourseId?: string | number }).moodleCourseId);
  return Number.isInteger(value) && value > 0 ? value : null;
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
  return code ? `https://i.ytimg.com/vi/${code}/hqdefault.jpg` : 'https://picsum.photos/seed/paeu-podcast/640/360';
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

function ContentCard({
  item,
  onOpen
}: {
  item: ContentAsset;
  onOpen: (item: ContentAsset) => void;
}) {
  return (
    <button className="content-tile" onClick={() => onOpen(item)}>
      <img src={item.heroImage} alt={item.title} />
      <div className="tile-overlay">
        <span className={`public-badge kind-${item.kind}`}>{getCourseCategoryLabel(item)}</span>
        <h4>{item.title}</h4>
      </div>
    </button>
  );
}

export function PublicApp() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [home, setHome] = useState<HomeResponse | null>(null);
  const [catalog, setCatalog] = useState<ContentAsset[]>([]);
  const [webinars, setWebinars] = useState<WebinarRecord[]>([]);
  const [podcasts, setPodcasts] = useState<PodcastRecord[]>([]);
  const [externalEventGroups, setExternalEventGroups] = useState<ExternalIntegrationEventGroup[]>([]);
  const [view, setView] = useState<ViewState>({ type: 'home' });
  const [search, setSearch] = useState('');
  const [catalogGroupFilter, setCatalogGroupFilter] = useState('all');
  const [catalogEnrollmentFilter, setCatalogEnrollmentFilter] = useState<'all' | 'enrolled' | 'not-enrolled'>('all');
  const [catalogSort, setCatalogSort] = useState<'default' | 'newest' | 'az'>('default');
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
  const [pendingCourseSlug, setPendingCourseSlug] = useState<string | null>(null);
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
  const [sectionsMenuOpen, setSectionsMenuOpen] = useState(false);
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
  const [myTickets, setMyTickets] = useState<PublicUserTicketRecord[]>([]);
  const [myTicketsLoading, setMyTicketsLoading] = useState(false);
  const [enterpriseOverview, setEnterpriseOverview] = useState<EnterpriseOverviewResponse | null>(null);
  const [enterpriseLoading, setEnterpriseLoading] = useState(false);
  const [enterpriseSaving, setEnterpriseSaving] = useState(false);
  const [enterpriseMemberForm, setEnterpriseMemberForm] = useState({
    fullName: '',
    email: '',
    locale: 'es'
  });
  const [enterpriseCourseId, setEnterpriseCourseId] = useState('');
  const [ticketPreview, setTicketPreview] = useState<{ url: string; title: string } | null>(null);
  const [podcastPreview, setPodcastPreview] = useState<{ title: string; embedUrl: string } | null>(null);
  const [progressByCourseId, setProgressByCourseId] = useState<Record<number, CourseProgress>>({});
  const [legalTerms, setLegalTerms] = useState<LegalPageResponse | null>(null);
  const [legalPrivacy, setLegalPrivacy] = useState<LegalPageResponse | null>(null);
  const [loadingLegal, setLoadingLegal] = useState(false);
  const categorySectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const continueLearningRowRef = useRef<HTMLDivElement | null>(null);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const sectionsMenuRef = useRef<HTMLDivElement | null>(null);
  const [pendingCategoryId, setPendingCategoryId] = useState<string | null>(null);

  useEffect(() => {
    const path = window.location.pathname;
    if (path === '/terminos' || path === '/terminos-y-condiciones') {
      setView({ type: 'terms' });
      return;
    }
    if (path === '/privacidad' || path === '/politica-de-privacidad') {
      setView({ type: 'privacy' });
    }
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
    setSectionsMenuOpen(false);
  }, [view.type]);

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      setError(null);
      try {
        const [homeResponse, catalogResponse, webinarsResponse, podcastsResponse, externalGroupsResponse] = await Promise.all([
          api.home(),
          api.catalog(),
          api.webinars(),
          api.podcasts(),
          api.integrationEventsGrouped().catch(() => [] as ExternalIntegrationEventGroup[])
        ]);
        setHome(homeResponse);
        setCatalog(catalogResponse);
        setWebinars(webinarsResponse);
        setPodcasts(podcastsResponse);
        setExternalEventGroups(externalGroupsResponse);
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
      if (view.type === 'terms') {
        window.history.replaceState(null, '', '/terminos');
        return;
      }
      if (view.type === 'privacy') {
        window.history.replaceState(null, '', '/privacidad');
        return;
      }
      if (window.location.pathname === '/terminos' || window.location.pathname === '/privacidad') {
        window.history.replaceState(null, '', '/');
      }
    };
    updatePath();
  }, [view.type]);

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

  const heroItems = useMemo(() => {
    if (!home) {
      return [] as ContentAsset[];
    }
    const courseItems = catalog.filter((item) => item.kind === 'course');
    if (courseItems.length === 0) {
      return [] as ContentAsset[];
    }
    const shuffled = [...courseItems].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 5);
  }, [home, catalog]);

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
    if (view.type !== 'detail' && view.type !== 'course') {
      setSelectedDetail(null);
      return;
    }

    const loadDetail = async () => {
      setLoadingDetail(true);
      setError(null);
      try {
        const detail = await api.catalogBySlug(view.slug);
        setSelectedDetail(detail);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Error cargando detalle');
      } finally {
        setLoadingDetail(false);
      }
    };

    void loadDetail();
  }, [view]);

  useEffect(() => {
    if (view.type !== 'course' || publicSession?.token) {
      return;
    }
    if (pendingCourseSlug !== view.slug) {
      setPendingCourseSlug(view.slug);
    }
    if (!showAuthModal) {
      setAuthMode('login');
      setShowAuthModal(true);
    }
  }, [view, publicSession?.token, pendingCourseSlug, showAuthModal]);

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

  const loadMyTickets = async (token: string) => {
    setMyTicketsLoading(true);
    try {
      const result = await api.publicAuth.meTickets(token);
      setMyTickets(Array.isArray(result.tickets) ? result.tickets : []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudieron cargar tus tickets');
      setMyTickets([]);
    } finally {
      setMyTicketsLoading(false);
    }
  };

  const hydrateAuthenticatedData = async (session: PublicSession) => {
    await Promise.all([
      loadMyCourses(session.token),
      loadMyTickets(session.token),
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
      setMyTickets([]);
      setEnterpriseOverview(null);
      return;
    }
    void hydrateAuthenticatedData(publicSession);
  }, [publicSession?.token]);

  useEffect(() => {
    if (view.type !== 'terms' && view.type !== 'privacy') {
      return;
    }
    const loadLegal = async () => {
      setLoadingLegal(true);
      setError(null);
      try {
        if (view.type === 'terms') {
          if (!legalTerms) {
            const data = await api.legalTerms();
            setLegalTerms(data);
          }
        } else if (!legalPrivacy) {
          const data = await api.legalPrivacy();
          setLegalPrivacy(data);
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'No se pudo cargar el contenido legal');
      } finally {
        setLoadingLegal(false);
      }
    };
    void loadLegal();
  }, [view, legalTerms, legalPrivacy]);

  useEffect(() => {
    const moodleCourseId = Number(selectedDetail?.content?.moodleCourseId);
    if (!selectedDetail || !Number.isInteger(moodleCourseId) || moodleCourseId <= 0) {
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
        if (message.includes('401') && selectedDetail?.content?.slug) {
          setPublicSession(null);
          localStorage.removeItem(PUBLIC_SESSION_STORAGE);
          requestAuthForCourse(selectedDetail.content.slug);
        }
      } finally {
        setLoadingCourseContent(false);
      }
    };

    void loadCourseContent();
  }, [selectedDetail, publicSession?.token]);

  const filteredCatalog = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return catalog;
    }
    return catalog.filter((item) => {
      return (
        item.title.toLowerCase().includes(query) ||
        toPlainText(item.summary).toLowerCase().includes(query) ||
        item.tags.some((tag) => tag.toLowerCase().includes(query))
      );
    });
  }, [catalog, search]);

  const catalogGroups = useMemo(() => {
    const values = new Set<string>();
    for (const item of catalog) {
      values.add(getCourseCategoryLabel(item));
    }
    return [...values].sort((a, b) => a.localeCompare(b, 'es'));
  }, [catalog]);

  const catalogViewItems = useMemo(() => {
    const enrolledIds = new Set<number>(
      (myCourses?.localCourses ?? [])
        .filter((course) => String(course.status) === 'active')
        .map((course) => Number(course.moodle_course_id))
        .filter((courseId) => Number.isInteger(courseId) && courseId > 0)
    );

    const filtered = filteredCatalog.filter((item) => {
      if (catalogGroupFilter !== 'all' && getCourseCategoryLabel(item) !== catalogGroupFilter) {
        return false;
      }

      if (item.kind === 'course' && catalogEnrollmentFilter !== 'all') {
        const moodleCourseId = getAssetMoodleCourseId(item);
        const isEnrolled = Boolean(moodleCourseId && enrolledIds.has(moodleCourseId));
        if (catalogEnrollmentFilter === 'enrolled' && !isEnrolled) {
          return false;
        }
        if (catalogEnrollmentFilter === 'not-enrolled' && isEnrolled) {
          return false;
        }
      }

      return true;
    });

    const withIndex = filtered.map((item, index) => ({ item, index }));
    withIndex.sort((a, b) => {
      if (catalogSort === 'az') {
        return a.item.title.localeCompare(b.item.title, 'es');
      }
      if (catalogSort === 'newest') {
        const aDateRaw = Number((a.item as unknown as { updatedAt?: string; moodleCourseId?: string }).moodleCourseId ?? 0);
        const bDateRaw = Number((b.item as unknown as { updatedAt?: string; moodleCourseId?: string }).moodleCourseId ?? 0);
        return bDateRaw - aDateRaw;
      }
      return a.index - b.index;
    });
    return withIndex.map((entry) => entry.item);
  }, [filteredCatalog, catalogGroupFilter, catalogEnrollmentFilter, catalogSort, myCourses]);

  const catalogShownItems = useMemo(
    () => catalogViewItems.slice(0, Math.max(1, catalogVisibleCount)),
    [catalogViewItems, catalogVisibleCount]
  );

  useEffect(() => {
    setCatalogVisibleCount(24);
  }, [search, catalogGroupFilter, catalogEnrollmentFilter, catalogSort]);

  const rows = useMemo<ContentRow[]>(() => {
    if (!home) {
      return [];
    }

    const courseItems = catalog.filter((item) => item.kind === 'course');
    const liveItems = catalog.filter((item) => item.kind === 'live');

    const categoryCounter = new Map<string, ContentAsset[]>();
    for (const course of courseItems) {
      const category = getCourseCategoryLabel(course).trim();
      if (!category) {
        continue;
      }
      if (!categoryCounter.has(category)) {
        categoryCounter.set(category, []);
      }
      categoryCounter.get(category)?.push(course);
    }

    const categoryRows = [...categoryCounter.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([category, items]) => ({
        id: toCategoryRowId(category),
        title: normalizeCourseLabel(category),
        items
      }));

    const bestSellersRow = categoryRows.find((row) => row.title === 'Más vendidos');
    const categoryRowsOrdered = categoryRows.filter((row) => row.title !== 'Más vendidos');
    if (bestSellersRow) {
      categoryRowsOrdered.push(bestSellersRow);
    }

    const base: ContentRow[] = [
      {
        id: 'continue-learning',
        title: 'Continuar aprendiendo',
        subtitle: 'Tus cursos más relevantes',
        items: home.continueLearning.length > 0 ? home.continueLearning : courseItems
      },
      {
        id: 'all-courses',
        title: 'Todos los cursos',
        subtitle: 'Descubre programas prácticos para crecer personal y profesionalmente',
        items: courseItems
      }
    ];

    return [...base, ...categoryRowsOrdered].filter((row) => row.items.length > 0);
  }, [home, catalog]);

  const topMenuCategories = useMemo(() => {
    return rows
      .filter((row) => row.id.startsWith('category-') && row.title !== 'Más vendidos')
      .map((row) => ({ id: row.id, title: row.title }));
  }, [rows]);

  const enrolledCourseIds = useMemo(() => {
    const ids = (myCourses?.localCourses ?? [])
      .filter((course) => String(course.status) === 'active')
      .map((course) => Number(course.moodle_course_id))
      .filter((courseId) => Number.isInteger(courseId) && courseId > 0);
    return new Set<number>(ids);
  }, [myCourses]);

  const myCourseItems = useMemo(() => {
    return catalog.filter((item) => item.kind === 'course' && enrolledCourseIds.has(getAssetMoodleCourseId(item) ?? -1));
  }, [catalog, enrolledCourseIds]);

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

  const currentCourseId = Number(selectedDetail?.content?.moodleCourseId);
  const isCurrentCourseAssigned =
    Number.isInteger(currentCourseId) && currentCourseId > 0 ? enrolledCourseIds.has(currentCourseId) : false;
  const isPreviewOnly = view.type === 'course' && !isCurrentCourseAssigned;
  const firstModuleId = flatModules[0]?.module.id ?? null;
  const isModuleLocked = (moduleId: number) => Boolean(isPreviewOnly && firstModuleId !== null && moduleId !== firstModuleId);

  useEffect(() => {
    if (!isPreviewOnly) {
      return;
    }
    setProgress({ ...DEFAULT_PROGRESS });
  }, [isPreviewOnly, currentCourseId]);

  useEffect(() => {
    if (!isPreviewOnly || !firstModuleId) {
      return;
    }
    if (activeModuleId !== firstModuleId) {
      setActiveModuleId(firstModuleId);
      setActiveFileUrl(null);
    }
  }, [isPreviewOnly, firstModuleId, activeModuleId]);

  useEffect(() => {
    const moodleCourseId = Number(selectedDetail?.content?.moodleCourseId);
    if (!Number.isInteger(moodleCourseId) || moodleCourseId <= 0 || flatModules.length === 0 || isPreviewOnly) {
      return;
    }
    const next = {
      ...progress,
      totalModules: flatModules.length
    };
    persistProgress(next);
  }, [flatModules.length, selectedDetail?.content?.moodleCourseId, isPreviewOnly]);

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
    if (isPreviewOnly) {
      return;
    }
    const totalModules = Math.max(next.totalModules, flatModules.length);
    const progressPercent = totalModules > 0 ? Math.min(100, Math.round((next.completedModuleIds.length / totalModules) * 100)) : 0;
    const normalized = {
      ...next,
      totalModules,
      progressPercent
    };
    const moodleCourseId = Number(selectedDetail?.content?.moodleCourseId);
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

  const requestAuthForCourse = (slug: string) => {
    setPendingCourseSlug(slug);
    setAuthMode('login');
    setShowAuthModal(true);
  };

  const openItem = (item: ContentAsset) => {
    if (item.kind === 'course') {
      if (!publicSession?.token) {
        requestAuthForCourse(item.slug);
        return;
      }
      setView({ type: 'course', slug: item.slug });
      return;
    }
    setView({ type: 'detail', slug: item.slug });
  };

  const markModuleComplete = async () => {
    if (isPreviewOnly) {
      setInteractionMessage('Este es un acceso de demostración. Compra el curso para guardar progreso.');
      return;
    }
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
    const moodleCourseId = Number(selectedDetail?.content?.moodleCourseId);
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
    if (isPreviewOnly) {
      setInteractionMessage('El modo preview no guarda actividades. Desbloquea el curso para continuar.');
      return;
    }
    if (!activeModule || !interactionText.trim() || !publicSession?.token) {
      return;
    }
    const moodleCourseId = Number(selectedDetail?.content?.moodleCourseId);
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
      const moodleCourseIdNum = Number(selectedDetail?.content?.moodleCourseId);
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
    if (isModuleLocked(flatModules[nextIndex].module.id)) {
      setInteractionMessage('Este módulo está bloqueado. Compra el curso para desbloquearlo completo.');
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
      setPendingCourseSlug(null);
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
      setPendingCourseSlug(null);
      setView({ type: 'home' });
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
    setMyTickets([]);
    setTicketPreview(null);
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
      setError(reason instanceof Error ? reason.message : 'No se pudo agregar colaborador');
    } finally {
      setEnterpriseSaving(false);
    }
  };

  const loadUsersSafeFromEnterprise = async () => {
    if (!publicSession?.token) {
      return;
    }
    await Promise.all([loadMyCourses(publicSession.token), loadMyTickets(publicSession.token)]).catch(() => undefined);
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
      setError(reason instanceof Error ? reason.message : 'No se pudo actualizar colaborador');
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
      setError(reason instanceof Error ? reason.message : 'No se pudo asignar curso empresarial');
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
      setError(reason instanceof Error ? reason.message : 'No se pudo actualizar curso empresarial');
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
    if (!sectionsMenuOpen) {
      return;
    }
    const onClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (sectionsMenuRef.current && target && !sectionsMenuRef.current.contains(target)) {
        setSectionsMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onClickOutside);
    return () => window.removeEventListener('mousedown', onClickOutside);
  }, [sectionsMenuOpen]);

  const landingEventGroups = useMemo(() => {
    const now = Date.now();
    const toTs = (value: string | null | undefined) => {
      if (!value) {
        return Number.MAX_SAFE_INTEGER;
      }
      const ts = Date.parse(value);
      return Number.isNaN(ts) ? Number.MAX_SAFE_INTEGER : ts;
    };
    return (externalEventGroups ?? [])
      .filter((group) => group.visibleOnLanding && group.isActive && group.events.length > 0)
      .sort((a, b) => {
        const aTs = toTs(a.startsAt);
        const bTs = toTs(b.startsAt);
        const aUpcoming = aTs >= now;
        const bUpcoming = bTs >= now;
        if (aUpcoming && !bUpcoming) {
          return -1;
        }
        if (!aUpcoming && bUpcoming) {
          return 1;
        }
        if (aUpcoming && bUpcoming) {
          return aTs - bTs;
        }
        return bTs - aTs;
      });
  }, [externalEventGroups]);

  const ticketGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        key: string;
        title: string;
        city: string;
        country: string;
        startDate: string;
        hero: string;
        tickets: PublicUserTicketRecord[];
      }
    >();
    for (const ticket of myTickets) {
      const event = ticket.event ?? {};
      const eventId = String(ticket.id_event ?? event.id ?? ticket.code ?? 'ticket');
      if (!groups.has(eventId)) {
        groups.set(eventId, {
          key: eventId,
          title: String(event.name ?? 'Evento con ticket'),
          city: String(event.city ?? ''),
          country: String(event.country ?? ''),
          startDate: String(event.start_date ?? ticket.date ?? ''),
          hero: String(event.banner_frame_url ?? event.ticket_frame_url ?? event.banner_url ?? ''),
          tickets: []
        });
      }
      groups.get(eventId)?.tickets.push(ticket);
    }
    return [...groups.values()].sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate));
  }, [myTickets]);

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
    return <main className="public-shell">Cargando PAE-U...</main>;
  }

  if (error && !home) {
    return <main className="public-shell">Error: {error}</main>;
  }

  const activeLegalDocument = view.type === 'terms' ? legalTerms : view.type === 'privacy' ? legalPrivacy : null;
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
  const enterpriseAvailable = Boolean(enterpriseOverview?.available);
  const enterpriseIsRepresentative = enterpriseOverview?.role === 'representative';
  const topMenuSectionLinks: Array<{ id: string; title: string }> = [
    ...(landingEventGroups.length > 0 ? [{ id: 'events', title: 'Eventos' }] : []),
    ...(publicSession ? [{ id: 'my-courses-home', title: 'Mis cursos' }] : []),
    ...(sortedLandingWebinars.length > 0 ? [{ id: 'webinars', title: 'Webinars' }] : []),
    ...(landingPodcasts.length > 0 ? [{ id: 'podcasts', title: 'Podcasts' }] : []),
    ...topMenuCategories
  ];

  return (
    <main className="public-shell netflix-ui">
      <header className="public-topbar netflix-topbar">
        <button className="brand-btn" onClick={() => setView({ type: 'home' })}>
          <img
            className="brand-logo"
            src="https://www.pasosalexito.com/wp-content/uploads/2024/06/pasos_al_exito_360_light_logo-1-1.webp"
            alt="Pasos al Exito"
          />
          <span className="brand-suffix">University</span>
        </button>
        <nav className="public-nav">
          <div className="public-nav-categories">
            <button
              className={view.type === 'enterprise' ? 'active featured-enterprise-btn' : 'featured-enterprise-btn'}
              onClick={() => {
                setView({ type: 'enterprise' });
                setMobileMenuOpen(false);
                setSectionsMenuOpen(false);
              }}
            >
              <span className="featured-star">★</span> Empresas
            </button>
            <button
              className={view.type === 'catalog' ? 'active' : ''}
              onClick={() => {
                setView({ type: 'catalog' });
                setMobileMenuOpen(false);
                setSectionsMenuOpen(false);
              }}
            >
              Explorar
            </button>
            {topMenuSectionLinks.length > 0 ? (
              <div className="sections-menu-wrap" ref={sectionsMenuRef}>
                <button
                  className={`category-nav-btn sections-menu-trigger ${sectionsMenuOpen ? 'active' : ''}`}
                  onClick={() => setSectionsMenuOpen((current) => !current)}
                >
                  Secciones <span className={`profile-caret ${sectionsMenuOpen ? 'open' : ''}`}>▾</span>
                </button>
                {sectionsMenuOpen ? (
                  <div className="sections-dropdown">
                    {topMenuSectionLinks.map((section) => (
                      <button
                        key={section.id}
                        onClick={() => {
                          goToHomeSection(section.id);
                          setSectionsMenuOpen(false);
                          setMobileMenuOpen(false);
                        }}
                      >
                        {section.title}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <button
            className={`mobile-menu-toggle ${mobileMenuOpen ? 'active' : ''}`}
            aria-label="Abrir menú"
            title="Abrir menú"
            onClick={() => setMobileMenuOpen((current) => !current)}
          >
            {mobileMenuOpen ? 'Cerrar' : 'Menú'}
          </button>
          {mobileMenuOpen ? (
            <div className="mobile-menu-sheet">
              <button
                className={view.type === 'enterprise' ? 'active' : ''}
                onClick={() => {
                  setView({ type: 'enterprise' });
                  setMobileMenuOpen(false);
                }}
              >
                <span className="featured-star">★</span> Empresas
              </button>
              <button
                className={view.type === 'catalog' ? 'active' : ''}
                onClick={() => {
                  setView({ type: 'catalog' });
                  setMobileMenuOpen(false);
                }}
              >
                Explorar
              </button>
              {topMenuSectionLinks.map((section) => (
                <button
                  key={`mobile-${section.id}`}
                  onClick={() => {
                    goToHomeSection(section.id);
                    setMobileMenuOpen(false);
                  }}
                >
                  {section.title}
                </button>
              ))}
            </div>
          ) : null}
          <div className="account-menu-wrap" ref={accountMenuRef}>
            <button
              className={`profile-icon-btn ${publicSession?.token ? 'logged' : 'guest'}`}
              aria-label={publicSession?.token ? 'Perfil' : 'Ingresar'}
              title={publicSession?.token ? 'Perfil' : 'Ingresar'}
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
                {publicSession?.user?.fullName?.trim().charAt(0).toUpperCase() || '👤'}
              </span>
              {!publicSession?.token ? <span className="profile-label">Ingresar</span> : null}
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
                    setView({ type: 'my-courses' });
                    setAccountMenuOpen(false);
                  }}
                >
                  Mis cursos
                </button>
                <button
                  onClick={() => {
                    setView({ type: 'enterprise' });
                    setAccountMenuOpen(false);
                  }}
                >
                  Empresas
                </button>
                {ticketGroups.length > 0 ? (
                  <button
                    onClick={() => {
                      setView({ type: 'my-tickets' });
                      setAccountMenuOpen(false);
                    }}
                  >
                    Mis entradas
                  </button>
                ) : null}
                <button
                  onClick={() => {
                    setView({ type: 'profile' });
                    setAccountMenuOpen(false);
                  }}
                >
                  Mi perfil
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    logoutPublic();
                    setAccountMenuOpen(false);
                  }}
                >
                  Salir
                </button>
              </div>
            ) : null}
          </div>
        </nav>
      </header>

      {error ? <p className="public-error">{error}</p> : null}

      {view.type === 'home' ? (
        <>
          {activeHero ? (
            <section className="hero hero-netflix" style={{ backgroundImage: `url(${activeHero.heroImage})` }}>
              <div className="hero-backdrop" />
              <div className="hero-content">
                <ContentBadge kind={activeHero.kind} />
                <h1>{activeHero.title}</h1>
                <p>{snippet(activeHero.summary, activeHero.title, 260)}</p>
                <div className="hero-actions">
                  <button onClick={() => openItem(activeHero)}>{activeHero.kind === 'course' ? 'Entrar al curso' : 'Ver ahora'}</button>
                  <button className="ghost-btn" onClick={() => setView({ type: 'catalog' })}>
                    Explorar catálogo
                  </button>
                </div>
                <div className="hero-dots">
                  {heroItems.map((_, index) => (
                    <button key={index} className={heroIndex === index ? 'active' : ''} onClick={() => setHeroIndex(index)} />
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          {landingEventGroups.length > 0 ? (
            <section
              className="section-block webinar-list-block category-anchor"
              ref={(node) => {
                categorySectionRefs.current.events = node;
              }}
            >
              <div className="section-header-row">
                <div>
                  <h2>{landingEventGroups.length > 1 ? 'Próximos eventos' : 'Próximo evento'}</h2>
                  <p className="row-subtitle">
                    Reserva tu cupo y vive experiencias en vivo con nuestra comunidad.
                  </p>
                </div>
              </div>
              <div className="content-row-scroll events-row-scroll">
                {landingEventGroups.map((group) => {
                  const startsAtTs = group.startsAt ? Date.parse(group.startsAt) : Number.NaN;
                  const isPast = Number.isFinite(startsAtTs) && startsAtTs < Date.now();
                  const startsAtLabel = group.startsAt ? new Date(group.startsAt).toLocaleString() : 'Fecha por confirmar';
                  const ticketsLabel = group.ticketTypes.length > 0 ? group.ticketTypes.join(' · ').toUpperCase() : 'GENERAL';
                  return (
                    <article key={group.groupKey} className="webinar-card webinar-card-modern">
                      <img src={group.heroImage} alt={group.groupLabel} />
                      <div className="webinar-card-overlay" />
                      <div className="webinar-card-body webinar-card-body-overlay">
                        <div className="webinar-card-top">
                          <span className={`webinar-state-pill ${isPast ? 'state-ended' : 'state-upcoming'}`}>
                            {isPast ? 'Ya pasó' : 'Próximo'}
                          </span>
                          <span className="webinar-platform-chip">{ticketsLabel}</span>
                        </div>
                        <h4>{group.groupLabel}</h4>
                        <p className="webinar-card-subtitle">
                          {group.venue || [group.city, group.country].filter(Boolean).join(', ') || 'Ubicación por confirmar'}
                        </p>
                        <p className="webinar-card-datetime">{startsAtLabel}</p>
                        <div className="webinar-channel-list">
                          <span>{group.events.length} tipo(s) de ticket</span>
                        </div>
                        <div className="webinar-card-actions">
                          {group.siteUrl ? (
                            <a className="tier-vip" href={group.siteUrl} target="_blank" rel="noreferrer noopener">
                              Reservar / Comprar
                            </a>
                          ) : null}
                          <span className="ghost">{group.ticketTypes.join(' · ')}</span>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          {publicSession && ticketGroups.length > 0 ? (
            <section className="section-block tickets-block">
              <div className="section-header-row">
                <div>
                  <h2>Mis entradas</h2>
                  <p className="row-subtitle">Estos son los eventos para los que ya tienes tickets.</p>
                </div>
              </div>
              <div className="content-row-scroll events-row-scroll">
                {ticketGroups.map((group) => (
                  <article key={group.key} className="webinar-card webinar-card-modern">
                    <img src={group.hero || 'https://picsum.photos/seed/paeu-ticket/1600/900'} alt={group.title} />
                    <div className="webinar-card-overlay" />
                    <div className="webinar-card-body webinar-card-body-overlay">
                      <div className="webinar-card-top">
                        <span className="webinar-state-pill state-ended">Ticket activo</span>
                        <span className="webinar-platform-chip">{group.tickets.length} entrada(s)</span>
                      </div>
                      <h4>{group.title}</h4>
                      <p className="webinar-card-subtitle">
                        {[group.city, group.country].filter(Boolean).join(', ') || 'Ubicación por confirmar'}
                      </p>
                      <p className="webinar-card-datetime">
                        {group.startDate ? new Date(group.startDate).toLocaleDateString() : 'Fecha por confirmar'}
                      </p>
                      <div className="webinar-card-actions">
                        {group.tickets.slice(0, 2).map((ticket) => (
                          <button
                            key={`${group.key}-${ticket.code}`}
                            className="tier-free"
                            onClick={() => {
                              if (ticket.ticket_url) {
                                setTicketPreview({
                                  url: String(ticket.ticket_url),
                                  title: `${group.title} · ${ticket.code}`
                                });
                              }
                            }}
                            disabled={!ticket.ticket_url}
                          >
                            {ticket.ticket_url ? `Ver ${ticket.code}` : ticket.code}
                          </button>
                        ))}
                        {group.tickets.length > 2 ? (
                          <span className="ghost">+{group.tickets.length - 2} más</span>
                        ) : null}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : publicSession && myTicketsLoading ? (
            <section className="section-block tickets-block">
              <p>Cargando tus entradas...</p>
            </section>
          ) : null}

          {publicSession ? (
            <section
              className="content-row-block my-courses-home category-anchor"
              ref={(node) => {
                categorySectionRefs.current['my-courses-home'] = node;
              }}
            >
              <div className="section-header-row">
                <div>
                  <h2>Mis cursos</h2>
                  <p className="row-subtitle">Accede rápido a tus cursos asignados y continúa tu progreso.</p>
                </div>
                <button className="ghost-btn" onClick={() => setView({ type: 'my-courses' })}>
                  Ver todos
                </button>
              </div>
              {myCoursesLoading ? <p>Cargando tus cursos...</p> : null}
              {!myCoursesLoading && myCourseItems.length === 0 ? (
                <div className="my-courses-empty">
                  <p>Aún no tienes cursos asignados. Explora el catálogo y desbloquea tu próxima ruta de aprendizaje.</p>
                  <button className="go-course-btn" onClick={() => setView({ type: 'catalog' })}>
                    Explorar y obtener cursos
                  </button>
                </div>
              ) : null}
              {myCourseItems.length > 0 ? (
                <div className={`content-row-scroll my-courses-scroll ${myCourseItems.length <= 2 ? 'few-courses' : ''}`}>
                  {myCourseItems.map((item) => {
                    const moodleCourseId = getAssetMoodleCourseId(item);
                    const savedProgress =
                      moodleCourseId && progressByCourseId[moodleCourseId]
                        ? progressByCourseId[moodleCourseId]
                        : moodleCourseId
                          ? loadCourseProgress(moodleCourseId)
                          : DEFAULT_PROGRESS;
                    const totalModules = savedProgress.totalModules;
                    const completed = savedProgress.completedModuleIds.length;
                    const percent =
                      totalModules > 0
                        ? Math.min(100, Math.round((completed / totalModules) * 100))
                        : savedProgress.progressPercent;
                    return (
                      <article key={`my-${item.id}`} className="my-course-card-wrap">
                        <ContentCard item={item} onOpen={openItem} />
                        <p className="my-course-progress-text">Avance: {percent}%</p>
                        <div className="my-course-progress-track" aria-hidden="true">
                          <div className="my-course-progress-fill" style={{ width: `${percent}%` }} />
                        </div>
                      </article>
                    );
                  })}
                  <button className="content-tile promo-more-courses" onClick={() => setView({ type: 'my-courses' })}>
                    <div className="promo-more-inner">
                      <span className="public-badge kind-bundle">Sugerido</span>
                      <h4>Ver todos mis cursos</h4>
                      <p>Revisa tu progreso completo, retoma módulos y continúa tu ruta.</p>
                      <span className="promo-link">Ir a mis cursos</span>
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
                  {row.items.map((item) => (
                    <ContentCard key={`${row.id}-${item.id}`} item={item} onOpen={openItem} />
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
                  <h2>{sortedLandingWebinars.length > 1 ? 'Webinars destacados' : 'Webinar destacado'}</h2>
                  <p className="row-subtitle">Sesiones prácticas en vivo para acelerar tu aprendizaje.</p>
                </div>
              </div>
              <div className="content-row-scroll">
                {sortedLandingWebinars.map((webinar) => {
                  const state = webinarState(webinar, nowMs);
                  const links = webinarLiveLinks(webinar);
                  const startsAtLabel = new Date(webinar.starts_at).toLocaleString();
                  return (
                    <article key={webinar.id} className="webinar-card webinar-card-modern">
                      <img src={webinar.hero_image} alt={webinar.title} />
                      <div className="webinar-card-overlay" />
                      <div className="webinar-card-body webinar-card-body-overlay">
                        <div className="webinar-card-top">
                          <span className={`webinar-state-pill state-${state}`}>
                            {state === 'live' ? 'En vivo' : state === 'upcoming' ? 'Próximo' : 'Ya pasó'}
                          </span>
                          <span className="webinar-platform-chip">{webinar.source_type.toUpperCase()}</span>
                        </div>
                        <h4>{webinar.title}</h4>
                        <p className="webinar-card-subtitle">{webinar.subtitle ?? 'Webinar exclusivo PAE-U'}</p>
                        <p className="webinar-card-datetime">{startsAtLabel}</p>
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
                              Reservar gratis
                            </a>
                          ) : null}
                          {webinar.vip_reservation_url ? (
                            <a className="tier-vip" href={webinar.vip_reservation_url} target="_blank" rel="noreferrer noopener">
                              Reservar VIP
                            </a>
                          ) : (
                            <a href={webinar.source_url} target="_blank" rel="noreferrer noopener">
                              {webinar.cta_label || 'Abrir webinar'}
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
                  {row.items.map((item) => (
                    <ContentCard key={`${row.id}-${item.id}`} item={item} onOpen={openItem} />
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
                  <h2>Podcasts destacados</h2>
                  <p className="row-subtitle">Conversaciones y enseñanzas para impulsar tu crecimiento.</p>
                </div>
              </div>
              <div className="content-row-scroll">
                {landingPodcasts.map((podcast) => {
                  const embedUrl = youtubeEmbedUrl(podcast.video_url || podcast.video_code);
                  return (
                    <button
                      key={podcast.id}
                      className="content-tile podcast-tile"
                      onClick={() => {
                        if (!embedUrl) {
                          return;
                        }
                        setPodcastPreview({
                          title: podcast.title,
                          embedUrl
                        });
                      }}
                    >
                      <img src={youtubeThumbUrl(podcast.video_url || podcast.video_code)} alt={podcast.title} />
                      <div className="tile-overlay">
                        <span className="public-badge kind-vod">Podcast</span>
                        <h4>{podcast.title}</h4>
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
                {row.items.map((item) => (
                  <ContentCard key={`${row.id}-${item.id}`} item={item} onOpen={openItem} />
                ))}
              </div>
            </section>
          ))}
        </>
      ) : null}

      {view.type === 'catalog' ? (
        <section className="section-block">
          <div className="section-header-row">
            <h2>Catálogo completo</h2>
            <span className="catalog-results-count">
              Mostrando {catalogShownItems.length} de {catalogViewItems.length}
            </span>
          </div>
          <div className="catalog-toolbar">
            <div className="catalog-search-wrap">
              <input
                className="search-input catalog-search-input"
                placeholder="Buscar cursos, live, VoD..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="catalog-filters">
              <label>
                Grupo
                <select value={catalogGroupFilter} onChange={(event) => setCatalogGroupFilter(event.target.value)}>
                  <option value="all">Todos</option>
                  {catalogGroups.map((group) => (
                    <option key={group} value={group}>
                      {group}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Estado
                <select
                  value={catalogEnrollmentFilter}
                  onChange={(event) => setCatalogEnrollmentFilter(event.target.value as 'all' | 'enrolled' | 'not-enrolled')}
                >
                  <option value="all">Todos</option>
                  <option value="enrolled">Mis cursos</option>
                  <option value="not-enrolled">No inscritos</option>
                </select>
              </label>
              <label>
                Orden
                <select value={catalogSort} onChange={(event) => setCatalogSort(event.target.value as 'default' | 'newest' | 'az')}>
                  <option value="default">Relevancia</option>
                  <option value="newest">Más nuevos</option>
                  <option value="az">A-Z</option>
                </select>
              </label>
              <button
                type="button"
                className="ghost-btn catalog-clear-btn"
                onClick={() => {
                  setSearch('');
                  setCatalogGroupFilter('all');
                  setCatalogEnrollmentFilter('all');
                  setCatalogSort('default');
                }}
              >
                Limpiar
              </button>
            </div>
          </div>
          <div className="catalog-grid">
            {catalogShownItems.map((item) => {
              const moodleCourseId = item.kind === 'course' ? getAssetMoodleCourseId(item) : null;
              const isEnrolled = Boolean(moodleCourseId && enrolledCourseIds.has(moodleCourseId));
              const savedProgress =
                moodleCourseId && progressByCourseId[moodleCourseId]
                  ? progressByCourseId[moodleCourseId]
                  : moodleCourseId
                    ? loadCourseProgress(moodleCourseId)
                    : DEFAULT_PROGRESS;
              const totalModules = Math.max(savedProgress.totalModules, 1);
              const percent =
                item.kind === 'course'
                  ? Math.min(100, Math.max(0, Math.round((savedProgress.completedModuleIds.length / totalModules) * 100)))
                  : 0;

              return (
                <button key={item.id} className="content-tile catalog-tile" onClick={() => openItem(item)}>
                  <img src={item.heroImage} alt={item.title} />
                  <div className="tile-overlay catalog-tile-overlay">
                    <div className="catalog-tile-head">
                      <span className={`public-badge kind-${item.kind}`}>{getCourseCategoryLabel(item)}</span>
                      {item.kind === 'course' ? (
                        <span className={`catalog-status-pill ${isEnrolled ? 'enrolled' : 'locked'}`}>
                          {isEnrolled ? 'Inscrito' : 'No inscrito'}
                        </span>
                      ) : null}
                    </div>
                    <h4>{item.title}</h4>
                    {item.kind === 'course' ? (
                      <div className="catalog-progress-wrap">
                        <div className="catalog-progress-track" aria-hidden="true">
                          <div className="catalog-progress-fill" style={{ width: `${isEnrolled ? percent : 0}%` }} />
                        </div>
                        <span>{isEnrolled ? `Avance ${percent}%` : 'Preview disponible'}</span>
                      </div>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
          {catalogShownItems.length < catalogViewItems.length ? (
            <div className="catalog-load-more-wrap">
              <button
                type="button"
                className="ghost-btn"
                onClick={() => setCatalogVisibleCount((current) => current + 24)}
              >
                Ver más
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {view.type === 'detail' ? (
        <section className="section-block detail-block">
          <button className="back-link" onClick={() => setView({ type: 'home' })}>
            Volver a inicio
          </button>

          {loadingDetail || !selectedDetail ? (
            <p>Cargando detalle...</p>
          ) : (
            <article className="detail-cinematic">
              <img src={selectedDetail.content.heroImage} alt={selectedDetail.content.title} />
              <div>
                <ContentBadge kind={selectedDetail.content.kind} />
                <h2>{selectedDetail.content.title}</h2>
                <p>{snippet(selectedDetail.content.summary, selectedDetail.content.title, 420)}</p>
                {'moodleCourseId' in selectedDetail.content ? (
                  <button
                    className="go-course-btn"
                    onClick={() => {
                      if (!publicSession?.token) {
                        requestAuthForCourse(selectedDetail.content.slug);
                        return;
                      }
                      setView({ type: 'course', slug: selectedDetail.content.slug });
                    }}
                  >
                    {isCurrentCourseAssigned ? 'Entrar al curso completo' : 'Ver curso (preview + compra)'}
                  </button>
                ) : null}
              </div>
            </article>
          )}
        </section>
      ) : null}

      {view.type === 'course' ? (
        <section className="course-layout course-layout-modern">
          <div className="course-header course-header-modern">
            <div
              className="course-header-surface"
              style={
                selectedDetail?.content?.heroImage
                  ? { backgroundImage: `url(${selectedDetail.content.heroImage})` }
                  : undefined
              }
            >
              <div className="course-header-backdrop" />
              <div className="course-header-content">
                <div className="course-header-top">
                  <span className="course-stage-pill">
                    {activeModuleIndex >= 0 ? `Módulo ${activeModuleIndex + 1} de ${flatModules.length}` : 'Ruta de aprendizaje'}
                  </span>
                  <button className="back-link" onClick={() => setView({ type: 'my-courses' })}>
                    Ir a mis cursos
                  </button>
                </div>
                <h1>{selectedDetail?.content?.title ?? 'Curso'}</h1>
                <p>{snippet(selectedDetail?.content?.summary, selectedDetail?.content?.title, 260)}</p>
              </div>
            </div>
            {!isCurrentCourseAssigned ? (
              <div className="course-preview-banner">
                <strong>Modo preview activo</strong>
                <span>Solo puedes navegar el primer módulo. Desbloquea el curso para continuar tu ruta completa.</span>
                <button onClick={() => setView({ type: 'catalog' })}>Desbloquear curso</button>
              </div>
            ) : null}
            <div className="progress-row progress-row-modern">
              <div className="progress-pill">
                <span>Progreso</span>
                <strong>{progressPercent}%</strong>
              </div>
              <div className="progress-pill">
                <span>Completados</span>
                <strong>{completedCount}/{flatModules.length}</strong>
              </div>
              <div className="progress-pill">
                <span>XP</span>
                <strong>{progress.xp}</strong>
              </div>
              <div className="progress-pill">
                <span>Nivel</span>
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
                <h3>Plan del curso</h3>
                <span>{flatModules.length} actividades</span>
              </div>
              {loadingCourseContent ? <p>Cargando estructura...</p> : null}
              {courseContentError ? <p className="public-error">{courseContentError}</p> : null}
              {sectionGroups.map(([sectionName, modules], sectionIndex) => (
                <div className="learning-section" key={`${sectionName}-${sectionIndex}`}>
                  <div className="learning-section-title">{sectionName}</div>
                  <div className="learning-section-list">
                    {modules.map((row) => {
                      const isActive = row.module.id === activeModuleId;
                      const isDone = progress.completedModuleIds.includes(row.module.id);
                      const locked = isModuleLocked(row.module.id);
                      return (
                        <button
                          key={row.module.id}
                          className={`module-nav-btn module-nav-modern ${isActive ? 'active' : ''} ${locked ? 'locked' : ''}`}
                          onClick={() => {
                            if (locked) {
                              setInteractionMessage('Este módulo está bloqueado. Compra el curso para desbloquearlo.');
                              return;
                            }
                            setActiveModuleId(row.module.id);
                            setActiveFileUrl(null);
                          }}
                        >
                          <div>
                            <strong>{row.module.name}</strong>
                            <span>{row.module.modname}</span>
                          </div>
                          <em>{locked ? 'Bloqueado' : isDone ? 'Completado' : 'Pendiente'}</em>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </aside>

            <article className="course-main course-main-modern">
              {!activeModule ? (
                <p>Selecciona un módulo para iniciar.</p>
              ) : isModuleLocked(activeModule.module.id) ? (
                <section className="course-paywall-card">
                  <h3>Continúa con la ruta completa</h3>
                  <p>Ya viste el primer módulo. Desbloquea el curso para abrir el resto del contenido y guardar avance.</p>
                  <div className="interaction-actions">
                    <button onClick={() => setView({ type: 'catalog' })}>Ver catálogo</button>
                    <button className="ghost-btn" onClick={() => setView({ type: 'my-courses' })}>Ir a mis cursos</button>
                  </div>
                </section>
              ) : (
                <>
                  <header className="module-headline module-headline-modern">
                    <div>
                      <p className="module-kicker">{activeModule.sectionName}</p>
                      <h2>{activeModule.module.name}</h2>
                      <p>Tipo de actividad: {activeModule.module.modname}</p>
                    </div>
                    <div className="module-actions-top">
                      <button onClick={() => goToNeighborModule(-1)} disabled={activeModuleIndex <= 0}>Anterior</button>
                      <button onClick={() => goToNeighborModule(1)} disabled={activeModuleIndex < 0 || activeModuleIndex >= flatModules.length - 1}>Siguiente</button>
                    </div>
                  </header>

                  <section className="module-content-card module-content-modern">
                    <h3>Clase y material</h3>
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
                      <p className="module-empty-note">No hay archivos adjuntos en esta actividad.</p>
                    ) : null}

                    {!activeModuleVideoUrl && !activeModuleFileVideoUrl && activeFileUrl ? (
                      <div className="file-viewer">
                        <iframe src={activeFileUrl} title="Course file" />
                      </div>
                    ) : null}
                  </section>

                  <section className="interaction-box interaction-box-modern">
                    <div className="interaction-heading">
                      <h3>{isPreviewOnly ? 'Vista de demostración' : 'Desarrollo de actividad'}</h3>
                      {!isPreviewOnly ? <span>Guarda tu respuesta y marca tu avance</span> : null}
                    </div>
                    {isPreviewOnly ? (
                      <div className="preview-readonly-box">
                        <p>Este curso está en preview. Puedes explorar pero no guardar progreso ni respuestas.</p>
                        <button className="go-course-btn" onClick={() => setView({ type: 'catalog' })}>
                          Comprar / desbloquear curso completo
                        </button>
                      </div>
                    ) : (
                      <>
                        <textarea
                          value={interactionText}
                          onChange={(event) => setInteractionText(event.target.value)}
                          placeholder="Escribe aquí tu desarrollo, conclusiones o respuestas..."
                        />
                        <div className="interaction-actions">
                          <button onClick={() => void onSubmitInteraction()} disabled={interactionSaving || !interactionText.trim()}>
                            {interactionSaving ? 'Guardando...' : 'Guardar avance'}
                          </button>
                          <button
                            className={`completion-inline-btn ${activeModuleCompleted ? 'done' : ''}`}
                            onClick={markModuleComplete}
                            disabled={activeModuleCompleted}
                          >
                            {activeModuleCompleted ? 'Completado ✓' : 'Completar módulo +50 XP'}
                          </button>
                        </div>
                        <p className={`completion-inline-hint ${activeModuleCompleted ? 'done' : ''}`}>
                          {activeModuleCompleted
                            ? 'Este módulo ya está completado.'
                            : 'Completa el módulo cuando termines esta actividad.'}
                        </p>
                      </>
                    )}
                    {interactionMessage ? <p className="interaction-feedback">{interactionMessage}</p> : null}
                    {!isPreviewOnly ? (
                      <div className="interaction-history interaction-history-modern">
                        <h4>Histórico de actividad</h4>
                        {interactionHistory.length === 0 ? (
                          <p>Aún no hay registros guardados.</p>
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
                    ) : null}
                  </section>
                </>
              )}
            </article>

            <aside className="gamification-panel gamification-panel-modern">
              <h3>Tu avance</h3>
              <div className="stat-grid">
                <div><span>Módulos</span><strong>{completedCount}/{flatModules.length}</strong></div>
                <div><span>Interacciones</span><strong>{progress.interactionsCount}</strong></div>
                <div><span>XP</span><strong>{progress.xp}</strong></div>
                <div><span>Nivel</span><strong>{level}</strong></div>
              </div>
              <h4>Logros</h4>
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
              <strong>Modulo completado</strong>
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
              <h2>Mis cursos</h2>
              <p className="row-subtitle">
                {publicSession ? `${publicSession.user.fullName} · ${publicSession.user.email}` : 'Inicia sesión para ver tus cursos'}
              </p>
            </div>
            <button className="ghost-btn" onClick={() => setView({ type: 'profile' })}>
              Editar mi perfil
            </button>
          </div>
          {publicSession ? (
            <div className="profile-summary-grid">
              <article className="profile-summary-card">
                <span>Cursos activos</span>
                <strong>{(myCourses?.localCourses ?? []).filter((course) => course.status === 'active').length}</strong>
              </article>
              <article className="profile-summary-card">
                <span>Promedio de avance</span>
                <strong>
                  {(() => {
                    const active = (myCourses?.localCourses ?? []).filter((course) => course.status === 'active');
                    if (active.length === 0) {
                      return '0%';
                    }
                    const total = active.reduce((acc, course) => {
                      const moodleCourseId = Number(course.moodle_course_id);
                      if (!Number.isInteger(moodleCourseId) || moodleCourseId <= 0) {
                        return acc;
                      }
                      const savedProgress = progressByCourseId[moodleCourseId] ?? loadCourseProgress(moodleCourseId);
                      const modules = Math.max(savedProgress.totalModules, 1);
                      const percent = Math.round((savedProgress.completedModuleIds.length / modules) * 100);
                      return acc + Math.min(100, Math.max(0, percent));
                    }, 0);
                    return `${Math.round(total / active.length)}%`;
                  })()}
                </strong>
              </article>
              <article className="profile-summary-card">
                <span>Cuenta</span>
                <strong>{publicSession.user.locale.toUpperCase()}</strong>
              </article>
            </div>
          ) : null}
          {myCoursesLoading ? <p>Cargando tus cursos...</p> : null}
          {!myCoursesLoading && (myCourses?.localCourses ?? []).filter((course) => course.status === 'active').length === 0 ? (
            <p>No tienes cursos asignados aún.</p>
          ) : null}
          <div className="profile-courses-grid">
            {(myCourses?.localCourses ?? []).filter((course) => course.status === 'active').map((course) => {
              const match = catalog.find(
                (item) =>
                  item.kind === 'course' &&
                  String((item as unknown as { moodleCourseId?: string }).moodleCourseId) === String(course.moodle_course_id)
              );
              const moodleCourseId = Number(course.moodle_course_id);
              const savedProgress =
                Number.isInteger(moodleCourseId) && moodleCourseId > 0
                  ? progressByCourseId[moodleCourseId] ?? loadCourseProgress(moodleCourseId)
                  : DEFAULT_PROGRESS;
              const modules = Math.max(savedProgress.totalModules, 1);
              const percent = Math.min(100, Math.max(0, Math.round((savedProgress.completedModuleIds.length / modules) * 100)));
              const title = course.full_name ?? `Curso ${course.moodle_course_id}`;
              return (
                <button
                  key={`${course.moodle_course_id}-${course.enrolled_at}`}
                  className="content-tile profile-course-tile"
                  onClick={() => {
                    if (!match) {
                      return;
                    }
                    setView({ type: 'course', slug: match.slug });
                  }}
                  disabled={!match}
                >
                  <img src={match?.heroImage ?? 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?auto=format&fit=crop&w=1200&q=80'} alt={title} />
                  <div className="tile-overlay profile-tile-overlay">
                    <div className="profile-tile-top">
                      <span className={`public-badge ${match ? 'kind-course' : 'kind-bundle'}`}>
                        {match ? getCourseCategoryLabel(match) : 'Sincronizando'}
                      </span>
                      <span className="profile-progress-pill">{percent}%</span>
                    </div>
                    <h4>{title}</h4>
                    <div className="profile-tile-progress" aria-hidden="true">
                      <div style={{ width: `${percent}%` }} />
                    </div>
                    <span className="profile-tile-cta">{match ? 'Continuar curso' : 'No disponible'}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {view.type === 'my-tickets' ? (
        <section className="section-block profile-block profile-modern">
          <div className="section-header-row">
            <div>
              <h2>Mis entradas</h2>
              <p className="row-subtitle">
                {publicSession ? `${publicSession.user.fullName} · ${publicSession.user.email}` : 'Inicia sesión para ver tus entradas'}
              </p>
            </div>
            <button className="ghost-btn" onClick={() => setView({ type: 'my-courses' })}>
              Ir a mis cursos
            </button>
          </div>
          {myTicketsLoading ? <p>Cargando tus entradas...</p> : null}
          {!myTicketsLoading && ticketGroups.length === 0 ? (
            <p>No encontramos entradas asociadas a tu cuenta.</p>
          ) : null}
          <div className="content-row-scroll events-row-scroll">
            {ticketGroups.map((group) => (
              <article key={group.key} className="webinar-card webinar-card-modern">
                <img src={group.hero || 'https://picsum.photos/seed/paeu-ticket/1600/900'} alt={group.title} />
                <div className="webinar-card-overlay" />
                <div className="webinar-card-body webinar-card-body-overlay">
                  <div className="webinar-card-top">
                    <span className="webinar-state-pill state-ended">Entrada activa</span>
                    <span className="webinar-platform-chip">{group.tickets.length} entrada(s)</span>
                  </div>
                  <h4>{group.title}</h4>
                  <p className="webinar-card-subtitle">
                    {[group.city, group.country].filter(Boolean).join(', ') || 'Ubicación por confirmar'}
                  </p>
                  <p className="webinar-card-datetime">
                    {group.startDate ? new Date(group.startDate).toLocaleDateString() : 'Fecha por confirmar'}
                  </p>
                  <div className="webinar-card-actions">
                    {group.tickets.slice(0, 3).map((ticket) => (
                      <button
                        key={`${group.key}-${ticket.code}`}
                        className="tier-free"
                        onClick={() => {
                          if (ticket.ticket_url) {
                            setTicketPreview({
                              url: String(ticket.ticket_url),
                              title: `${group.title} · ${ticket.code}`
                            });
                          }
                        }}
                        disabled={!ticket.ticket_url}
                      >
                        {ticket.ticket_url ? `Ver ${ticket.code}` : ticket.code}
                      </button>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {view.type === 'profile' ? (
        <section className="section-block profile-editor-block">
          <div className="section-header-row">
            <div>
              <h2>Mi perfil</h2>
              <p className="row-subtitle">Actualiza tus datos. Los cambios se sincronizan en PAE-U y Moodle.</p>
            </div>
            <button className="ghost-btn" onClick={() => setView({ type: 'my-courses' })}>
              Ir a mis cursos
            </button>
          </div>
          {!publicSession ? (
            <p>Inicia sesión para editar tu perfil.</p>
          ) : (
            <form className="profile-editor-form" onSubmit={onSaveProfile}>
              <label>
                Nombre completo
                <input
                  value={profileForm.fullName}
                  onChange={(event) => setProfileForm((current) => ({ ...current, fullName: event.target.value }))}
                  required
                  minLength={3}
                />
              </label>
              <label>
                Correo electrónico
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
                Idioma
                <select
                  value={profileForm.locale}
                  onChange={(event) => setProfileForm((current) => ({ ...current, locale: event.target.value }))}
                >
                  <option value="es">Español</option>
                  <option value="en">English</option>
                </select>
              </label>
              <div className="profile-editor-actions">
                <button type="submit" className="go-course-btn" disabled={profileSaving}>
                  {profileSaving ? 'Guardando...' : 'Guardar cambios'}
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
                  Restablecer
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
              <p className="enterprise-eyebrow">PAE-U Business</p>
              <h2>Capacita equipos que venden, ejecutan y crecen</h2>
              <p>
                Una experiencia empresarial premium para formar colaboradores, asignar rutas y acelerar resultados
                medibles desde una sola plataforma.
              </p>
              <div className="enterprise-hero-actions">
                {!publicSession ? (
                  <button
                    className="go-course-btn"
                    onClick={() => {
                      setAuthMode('login');
                      setShowAuthModal(true);
                    }}
                  >
                    Hablar con un asesor
                  </button>
                ) : (
                  <button className="go-course-btn" onClick={() => setView({ type: 'my-courses' })}>
                    Ir a mis cursos
                  </button>
                )}
                <button className="ghost-btn" onClick={() => setView({ type: 'catalog' })}>
                  Explorar catálogo
                </button>
              </div>
            </div>
          </article>

          <section className="enterprise-trust-strip">
            <p>Empresas que impulsan su talento con PAE-U</p>
            <div className="enterprise-logo-cloud">
              <span>Retail Corp</span>
              <span>Realty Group</span>
              <span>Sales Partners</span>
              <span>Fintech Hub</span>
              <span>Health Network</span>
              <span>Logistics Pro</span>
              <span>EdTech Labs</span>
              <span>Service Alliance</span>
            </div>
          </section>

          <div className="enterprise-value-grid">
            <article className="enterprise-value-card">
              <span>Rutas y contenidos</span>
              <strong>Asignación por equipos y roles</strong>
            </article>
            <article className="enterprise-value-card">
              <span>Seguimiento</span>
              <strong>Visibilidad clara del avance</strong>
            </article>
            <article className="enterprise-value-card">
              <span>Escalabilidad</span>
              <strong>Control central para toda la empresa</strong>
            </article>
          </div>

          {!publicSession ? (
            <section className="enterprise-split">
              <article className="enterprise-explainer">
                <h3>Cómo funciona PAE-U para empresas</h3>
                <p>
                  Activa un representante, integra a tu equipo y define rutas de aprendizaje por rol. La implementación
                  es simple y el impacto se puede medir desde la primera semana.
                </p>
                <ol className="enterprise-steps-list">
                  <li>
                    <strong>Activa tu cuenta corporativa</strong>
                    <span>Un representante administra el entorno empresarial.</span>
                  </li>
                  <li>
                    <strong>Incorpora colaboradores</strong>
                    <span>Crea o invita usuarios y ordénalos por necesidades del negocio.</span>
                  </li>
                  <li>
                    <strong>Asigna y mide rutas</strong>
                    <span>Define programas por equipo y visualiza avance de forma continua.</span>
                  </li>
                </ol>
                <div className="enterprise-example-grid">
                  <article>
                    <p className="kicker">Ejemplo 1</p>
                    <h4>Onboarding comercial</h4>
                    <p>30 ejecutivos nuevos completan una ruta de arranque en 4 semanas.</p>
                  </article>
                  <article>
                    <p className="kicker">Ejemplo 2</p>
                    <h4>Liderazgo regional</h4>
                    <p>Gerentes por ciudad siguen el mismo plan con control de cumplimiento.</p>
                  </article>
                </div>
                <div className="enterprise-simple-cta">
                  <span>¿Listo para implementarlo en tu empresa?</span>
                  <button className="go-course-btn" onClick={() => setAuthMode('register')}>
                    Empezar registro empresarial
                  </button>
                </div>
              </article>

              <article className="enterprise-auth-panel">
                <h3>{authMode === 'register' ? 'Activa tu cuenta empresarial' : 'Acceso empresarial'}</h3>
                <p>
                  {authMode === 'register'
                    ? 'Crea tu cuenta para administrar colaboradores y rutas.'
                    : 'Ingresa para continuar con la gestión de tu empresa.'}
                </p>
                <div className="enterprise-auth-trust">
                  <span>Implementación guiada</span>
                  <span>Soporte dedicado</span>
                  <span>Escalable por equipos</span>
                </div>
                <div className="auth-switch">
                  <button className={authMode === 'register' ? 'active' : ''} onClick={() => setAuthMode('register')}>
                    Registro
                  </button>
                  <button className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>
                    Login
                  </button>
                </div>

                {authMode === 'register' ? (
                  <form className="auth-form enterprise-auth-form" onSubmit={onRegister}>
                    <label className="enterprise-input-label">
                      Nombre completo
                      <input
                        placeholder="Ej: Andrea Ramírez"
                        value={registerForm.fullName}
                        onChange={(event) => setRegisterForm((current) => ({ ...current, fullName: event.target.value }))}
                        required
                      />
                    </label>
                    <label className="enterprise-input-label">
                      Correo corporativo
                      <input
                        type="email"
                        placeholder="nombre@empresa.com"
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
                        placeholder="Contraseña"
                        value={registerForm.password}
                        onChange={(event) => setRegisterForm((current) => ({ ...current, password: event.target.value }))}
                        autoComplete="new-password"
                        required
                      />
                      <button
                        type="button"
                        className="password-toggle"
                        onClick={() => setShowRegisterPassword((current) => !current)}
                        aria-label={showRegisterPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                        title={showRegisterPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      >
                        <PasswordToggleIcon visible={showRegisterPassword} />
                      </button>
                    </div>
                    <label className="enterprise-input-label">
                      Idioma
                      <select
                        value={registerForm.locale}
                        onChange={(event) => setRegisterForm((current) => ({ ...current, locale: event.target.value }))}
                      >
                        <option value="es">Español</option>
                        <option value="en">English</option>
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
                        Generar contraseña segura
                      </button>
                    </div>
                    <div className="password-field">
                      <input
                        type={showRegisterConfirmPassword ? 'text' : 'password'}
                        placeholder="Confirmar contraseña"
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
                        aria-label={showRegisterConfirmPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                        title={showRegisterConfirmPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      >
                        <PasswordToggleIcon visible={showRegisterConfirmPassword} />
                      </button>
                    </div>
                    <div className="enterprise-password-hints">
                      <span className={registerForm.password.length >= 10 ? 'ok' : ''}>Mínimo 10 caracteres</span>
                      <span className={/[A-Z]/.test(registerForm.password) ? 'ok' : ''}>Una mayúscula</span>
                      <span className={/[0-9]/.test(registerForm.password) ? 'ok' : ''}>Un número</span>
                      <span className={/[!@#$%^&*]/.test(registerForm.password) ? 'ok' : ''}>Un símbolo</span>
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
                        Acepto <a href="/terminos" target="_blank" rel="noreferrer">términos y condiciones</a> y{' '}
                        <a href="/privacidad" target="_blank" rel="noreferrer">política de privacidad</a>.
                      </span>
                    </label>
                    <button className="auth-submit" type="submit" disabled={authLoading}>
                      {authLoading ? 'Procesando...' : 'Crear cuenta'}
                    </button>
                    <p className="enterprise-auth-footnote">
                      Al crear tu cuenta podrás gestionar colaboradores, asignar cursos y visualizar progreso por equipo.
                    </p>
                  </form>
                ) : (
                  <form className="auth-form enterprise-auth-form" onSubmit={onLogin}>
                    <label className="enterprise-input-label">
                      Correo corporativo
                      <input
                        type="email"
                        placeholder="nombre@empresa.com"
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
                        placeholder="Contraseña"
                        value={loginForm.password}
                        onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                        autoComplete="current-password"
                        required
                      />
                      <button
                        type="button"
                        className="password-toggle"
                        onClick={() => setShowLoginPassword((current) => !current)}
                        aria-label={showLoginPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                        title={showLoginPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      >
                        <PasswordToggleIcon visible={showLoginPassword} />
                      </button>
                    </div>
                    <div className="enterprise-login-row">
                      <span>Acceso seguro empresarial</span>
                      <a href="mailto:servicio@pasosalexito.com">¿Necesitas ayuda?</a>
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
                        Confirmo que acepto <a href="/terminos" target="_blank" rel="noreferrer">términos y condiciones</a>.
                      </span>
                    </label>
                    <button className="auth-submit" type="submit" disabled={authLoading}>
                      {authLoading ? 'Ingresando...' : 'Ingresar'}
                    </button>
                  </form>
                )}
                {authError ? <p className="public-error">{authError}</p> : null}
              </article>
            </section>
          ) : enterpriseLoading ? (
            <p>Cargando datos empresariales...</p>
          ) : !enterpriseAvailable ? (
            <div className="my-courses-empty">
              <p>
                Tu cuenta aún no está vinculada como representante o colaborador empresarial. Crea la empresa desde el
                admin para activar este módulo.
              </p>
            </div>
          ) : (
            <>
              <article className="card-like enterprise-company-card">
                <h3>{enterpriseOverview?.company?.name ?? 'Empresa'}</h3>
                <p>{enterpriseOverview?.company?.description ?? 'Programa empresarial activo en PAE-U.'}</p>
                <p>
                  Rol actual: <strong>{enterpriseOverview?.role === 'representative' ? 'Representante' : 'Colaborador'}</strong>
                </p>
              </article>

              {enterpriseIsRepresentative && enterpriseOverview?.stats ? (
                <div className="enterprise-stats-grid">
                  <div className="enterprise-stat-box">
                    <span className="stat-label">Total Integrantes</span>
                    <span className="stat-value">{enterpriseOverview.stats.totalMembers}</span>
                  </div>
                  <div className="enterprise-stat-box">
                    <span className="stat-label">Integrantes Activos</span>
                    <span className="stat-value">{enterpriseOverview.stats.activeMembers}</span>
                  </div>
                  <div className="enterprise-stat-box">
                    <span className="stat-label">Matrículas de Curso</span>
                    <span className="stat-value">{enterpriseOverview.stats.totalEnrollments}</span>
                  </div>
                  <div className="enterprise-stat-box">
                    <span className="stat-label">Progreso Promedio</span>
                    <span className="stat-value">{enterpriseOverview.stats.averageProgress}%</span>
                  </div>
                  <div className="enterprise-stat-box">
                    <span className="stat-label">Interacciones</span>
                    <span className="stat-value">{enterpriseOverview.stats.totalInteractions}</span>
                  </div>
                </div>
              ) : null}

              {enterpriseIsRepresentative ? (
                <div className="grid-like-two">
                  <article className="card-like enterprise-panel-card">
                    <h3>Agregar colaborador</h3>
                    <form className="profile-editor-form" onSubmit={onEnterpriseAddMember}>
                      <label>
                        Nombre completo
                        <input
                          value={enterpriseMemberForm.fullName}
                          onChange={(event) =>
                            setEnterpriseMemberForm((current) => ({ ...current, fullName: event.target.value }))
                          }
                          required
                        />
                      </label>
                      <label>
                        Email corporativo
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
                        Idioma
                        <input
                          value={enterpriseMemberForm.locale}
                          onChange={(event) =>
                            setEnterpriseMemberForm((current) => ({ ...current, locale: event.target.value }))
                          }
                        />
                      </label>
                      <button type="submit" className="go-course-btn" disabled={enterpriseSaving}>
                        {enterpriseSaving ? 'Guardando...' : 'Agregar colaborador'}
                      </button>
                    </form>
                  </article>

                  <article className="card-like enterprise-panel-card">
                    <h3>Asignar cursos empresariales</h3>
                    <form className="profile-editor-form" onSubmit={onEnterpriseAssignCourse}>
                      <label>
                        Curso
                        <select
                          value={enterpriseCourseId}
                          onChange={(event) => setEnterpriseCourseId(event.target.value)}
                          required
                        >
                          <option value="">Selecciona curso</option>
                          {catalog
                            .filter((item) => item.kind === 'course')
                            .map((item) => {
                              const courseId = Number((item as { moodleCourseId?: string | number }).moodleCourseId);
                              return Number.isInteger(courseId) && courseId > 0 ? (
                                <option key={`enterprise-course-${courseId}`} value={String(courseId)}>
                                  {item.title}
                                </option>
                              ) : null;
                            })}
                        </select>
                      </label>
                      <button type="submit" className="go-course-btn" disabled={enterpriseSaving}>
                        {enterpriseSaving ? 'Asignando...' : 'Asignar curso'}
                      </button>
                    </form>
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
                <h3>Colaboradores</h3>
                <div className="simple-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Nombre</th>
                        <th>Email</th>
                        <th>Rol</th>
                        <th>Estado</th>
                        {enterpriseIsRepresentative ? <th>Acción</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {(enterpriseOverview?.members ?? []).length === 0 ? (
                        <tr>
                          <td colSpan={enterpriseIsRepresentative ? 5 : 4}>Sin miembros registrados.</td>
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
                                    {member.status === 'active' ? 'Desactivar' : 'Activar'}
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
                <h3>Cursos empresariales activos</h3>
                <div className="simple-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>ID curso</th>
                        <th>Nombre</th>
                        <th>Estado</th>
                        {enterpriseIsRepresentative ? <th>Acción</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {(enterpriseOverview?.courseAccess ?? []).length === 0 ? (
                        <tr>
                          <td colSpan={enterpriseIsRepresentative ? 4 : 3}>No hay cursos asignados.</td>
                        </tr>
                      ) : (
                        (enterpriseOverview?.courseAccess ?? []).map((course) => (
                          <tr key={`enterprise-course-${course.moodle_course_id}`}>
                            <td>{course.moodle_course_id}</td>
                            <td>{course.full_name ?? course.short_name ?? '-'}</td>
                            <td>{course.is_active ? 'activo' : 'inactivo'}</td>
                            {enterpriseIsRepresentative ? (
                              <td>
                                <button
                                  className={course.is_active ? 'ghost danger' : 'ghost'}
                                  onClick={() => void onEnterpriseToggleCourse(Number(course.moodle_course_id), course.is_active)}
                                >
                                  {course.is_active ? 'Desactivar' : 'Activar'}
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
                  <h3>Progreso de Colaboradores</h3>
                  <div className="simple-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Colaborador</th>
                          <th>Curso</th>
                          <th>Progreso</th>
                          <th>Interacciones</th>
                          <th>Última Actividad</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(enterpriseOverview?.memberProgress ?? []).length === 0 ? (
                          <tr>
                            <td colSpan={5}>Aún no hay progreso registrado.</td>
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

      {ticketPreview ? (
        <div className="auth-modal-backdrop">
          <div className="auth-modal ticket-modal" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="auth-close-btn"
              aria-label="Cerrar ticket"
              title="Cerrar ticket"
              onClick={() => setTicketPreview(null)}
            >
              ×
            </button>
            <h3>{ticketPreview.title}</h3>
            <img className="ticket-modal-image" src={ticketPreview.url} alt={ticketPreview.title} />
          </div>
        </div>
      ) : null}

      {podcastPreview ? (
        <div className="auth-modal-backdrop">
          <div className="auth-modal ticket-modal podcast-modal" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="auth-close-btn"
              aria-label="Cerrar podcast"
              title="Cerrar podcast"
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
              aria-label="Cerrar"
              title="Cerrar"
              onClick={() => setShowAuthModal(false)}
            >
              ×
            </button>
            <h3>{authMode === 'register' ? 'Crear cuenta para entrar al curso' : 'Iniciar sesión'}</h3>
            <div className="auth-switch">
              <button className={authMode === 'register' ? 'active' : ''} onClick={() => setAuthMode('register')}>Registro</button>
              <button className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>Login</button>
            </div>

            {authMode === 'register' ? (
              <form className="auth-form" onSubmit={onRegister}>
                <input
                  placeholder="Nombre completo"
                  value={registerForm.fullName}
                  onChange={(event) => setRegisterForm((current) => ({ ...current, fullName: event.target.value }))}
                  required
                />
                <input
                  type="email"
                  placeholder="Correo"
                  value={registerForm.email}
                  onChange={(event) => setRegisterForm((current) => ({ ...current, email: event.target.value }))}
                  autoComplete="email"
                  inputMode="email"
                  required
                />
                <div className="password-field">
                  <input
                    type={showRegisterPassword ? 'text' : 'password'}
                    placeholder="Contraseña"
                    value={registerForm.password}
                    onChange={(event) => setRegisterForm((current) => ({ ...current, password: event.target.value }))}
                    autoComplete="new-password"
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowRegisterPassword((current) => !current)}
                    aria-label={showRegisterPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    title={showRegisterPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
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
                    Generar contraseña segura
                  </button>
                </div>
                <div className="password-field">
                  <input
                    type={showRegisterConfirmPassword ? 'text' : 'password'}
                    placeholder="Confirmar contraseña"
                    value={registerForm.confirmPassword}
                    onChange={(event) => setRegisterForm((current) => ({ ...current, confirmPassword: event.target.value }))}
                    autoComplete="new-password"
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowRegisterConfirmPassword((current) => !current)}
                    aria-label={showRegisterConfirmPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    title={showRegisterConfirmPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
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
                  <span>
                    Acepto <a href="/terminos" target="_blank" rel="noreferrer">términos y condiciones</a> y{' '}
                    <a href="/privacidad" target="_blank" rel="noreferrer">política de privacidad</a>.
                  </span>
                </label>
                <p className="auth-help">La contraseña debe tener mínimo 10 caracteres, mayúscula, minúscula, número y símbolo.</p>
                <button className="auth-submit" type="submit" disabled={authLoading}>
                  {authLoading ? 'Procesando...' : 'Registrarme'}
                </button>
              </form>
            ) : (
              <form className="auth-form" onSubmit={onLogin}>
                <input
                  type="email"
                  placeholder="Correo"
                  value={loginForm.email}
                  onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))}
                  autoComplete="email"
                  inputMode="email"
                  required
                />
                <div className="password-field">
                  <input
                    type={showLoginPassword ? 'text' : 'password'}
                    placeholder="Contraseña"
                    value={loginForm.password}
                    onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowLoginPassword((current) => !current)}
                    aria-label={showLoginPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    title={showLoginPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
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
                  <span>
                    Confirmo que acepto <a href="/terminos" target="_blank" rel="noreferrer">términos y condiciones</a>.
                  </span>
                </label>
                <button className="auth-submit" type="submit" disabled={authLoading}>
                  {authLoading ? 'Ingresando...' : 'Entrar'}
                </button>
              </form>
            )}

            {authError ? <p className="public-error">{authError}</p> : null}
          </div>
        </div>
      ) : null}

      {(view.type === 'terms' || view.type === 'privacy') ? (
        <section className="section-block legal-block">
          <div className="legal-hero">
            <button className="back-link legal-back-btn" onClick={() => setView({ type: 'home' })}>
              Volver a inicio
            </button>
            <h1>Centro legal PAE-U</h1>
            <p>Consulta términos, privacidad y uso de la plataforma educativa conectada al intermediador y Moodle.</p>
            <div className="legal-switch">
              <button
                className={view.type === 'terms' ? 'active' : ''}
                onClick={() => setView({ type: 'terms' })}
              >
                Términos y condiciones
              </button>
              <button
                className={view.type === 'privacy' ? 'active' : ''}
                onClick={() => setView({ type: 'privacy' })}
              >
                Política de privacidad
              </button>
            </div>
          </div>

          <div className="legal-layout">
            <article className="legal-content-card">
              {loadingLegal ? <p>Cargando contenido legal...</p> : null}
              {!loadingLegal && activeLegalDocument ? (
                <>
                  <h2 dangerouslySetInnerHTML={{ __html: activeLegalDocument.title }} />
                  <div className="legal-content-prose moodle-html" dangerouslySetInnerHTML={{ __html: activeLegalDocument.html }} />
                </>
              ) : null}
            </article>
            <aside className="legal-side-card">
              <h3>Información</h3>
              <p>Este contenido se publica desde la API del intermediador y aplica al uso de PAE-U.</p>
              <p>Para dudas legales o solicitudes de datos personales:</p>
              <a href="mailto:servicio@pasosalexito.com">servicio@pasosalexito.com</a>
            </aside>
          </div>
        </section>
      ) : null}

      <footer className="public-footer">
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} PAE-U | Pasos al Éxito 360. Todos los derechos reservados.</span>
        </div>
      </footer>
    </main>
  );
}
