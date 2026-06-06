import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import {
  api,
  type CatalogContentDetailResponse,
  type PublicCourseInteractionRecord,
  type LegalPageResponse,
  type MoodleCourseContentResponse,
  type PublicCourseProgressRecord,
  type PublicMyCoursesResponse,
  type PublicSession,
  type WebinarRecord,
  type PodcastRecord,
  type EnterpriseOverviewResponse
} from '../lib/api';
import type { ContentAsset, HomeResponse } from '@pae-u/shared';
import { EnterpriseGroupManager } from './EnterpriseGroupManager';
import { LanguageSwitcher } from './LanguageSwitcher';
import './public.css';

type ViewState =
  | { type: 'home' }
  | { type: 'catalog' }
  | { type: 'detail'; slug: string }
  | { type: 'course'; slug: string }
  | { type: 'my-courses' }
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

function localizeAsset(item: ContentAsset, lang: string): ContentAsset {
  if (lang === 'en' && item.titleEn) {
    return {
      ...item,
      title: item.titleEn,
      summary: item.summaryEn ?? item.summary
    };
  }
  return item;
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
  const { t, i18n: i18nInstance } = useTranslation();
  const currentLang = i18nInstance.language?.startsWith('en') ? 'en' : 'es';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [home, setHome] = useState<HomeResponse | null>(null);
  const [catalog, setCatalog] = useState<ContentAsset[]>([]);
  const [webinars, setWebinars] = useState<WebinarRecord[]>([]);
  const [podcasts, setPodcasts] = useState<PodcastRecord[]>([]);
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

  const localizedCatalog = useMemo(
    () => catalog.map((item) => localizeAsset(item, currentLang)),
    [catalog, currentLang]
  );

  const heroItems = useMemo(() => {
    if (!home) {
      return [] as ContentAsset[];
    }
    const courseItems = localizedCatalog.filter((item) => item.kind === 'course');
    if (courseItems.length === 0) {
      return [] as ContentAsset[];
    }
    const shuffled = [...courseItems].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 5);
  }, [home, localizedCatalog]);

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
      return localizedCatalog;
    }
    return localizedCatalog.filter((item) => {
      return (
        item.title.toLowerCase().includes(query) ||
        toPlainText(item.summary).toLowerCase().includes(query) ||
        item.tags.some((tag) => tag.toLowerCase().includes(query))
      );
    });
  }, [localizedCatalog, search]);

  const catalogGroups = useMemo(() => {
    const values = new Set<string>();
    for (const item of localizedCatalog) {
      values.add(getCourseCategoryLabel(item));
    }
    return [...values].sort((a, b) => a.localeCompare(b, 'es'));
  }, [localizedCatalog]);

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

    const courseItems = localizedCatalog.filter((item) => item.kind === 'course');
    const liveItems = localizedCatalog.filter((item) => item.kind === 'live');

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
        title: t('home.continueLearning'),
        subtitle: t('home.continueLearningSubtitle'),
        items: home.continueLearning.length > 0 ? home.continueLearning : courseItems
      },
      {
        id: 'all-courses',
        title: t('home.allCourses'),
        subtitle: t('home.allCoursesSubtitle'),
        items: courseItems
      }
    ];

    return [...base, ...categoryRowsOrdered].filter((row) => row.items.length > 0);
  }, [home, localizedCatalog, t]);

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
    return localizedCatalog.filter((item) => item.kind === 'course' && enrolledCourseIds.has(getAssetMoodleCourseId(item) ?? -1));
  }, [localizedCatalog, enrolledCourseIds]);

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
    ...(publicSession ? [{ id: 'my-courses-home', title: t('home.myCourses') }] : []),
    ...(sortedLandingWebinars.length > 0 ? [{ id: 'webinars', title: t('home.liveEvents') }] : []),
    ...(landingPodcasts.length > 0 ? [{ id: 'podcasts', title: t('home.podcasts') }] : []),
    ...topMenuCategories
  ];

  return (
    <main className="public-shell netflix-ui">
      <header className="public-topbar netflix-topbar">
        <button className="brand-btn" onClick={() => setView({ type: 'home' })}>
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
              <span className="featured-star">★</span> {t('nav.enterprise')}
            </button>
            <button
              className={view.type === 'catalog' ? 'active' : ''}
              onClick={() => {
                setView({ type: 'catalog' });
                setMobileMenuOpen(false);
                setSectionsMenuOpen(false);
              }}
            >
              {t('nav.catalog')}
            </button>
            {topMenuSectionLinks.length > 0 ? (
              <div className="sections-menu-wrap" ref={sectionsMenuRef}>
                <button
                  className={`category-nav-btn sections-menu-trigger ${sectionsMenuOpen ? 'active' : ''}`}
                  onClick={() => setSectionsMenuOpen((current) => !current)}
                >
                  {t('nav.sections')} <span className={`profile-caret ${sectionsMenuOpen ? 'open' : ''}`}>▾</span>
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
          <LanguageSwitcher compact />
          <button
            className={`mobile-menu-toggle ${mobileMenuOpen ? 'active' : ''}`}
            aria-label={t('nav.menu')}
            title={t('nav.menu')}
            onClick={() => setMobileMenuOpen((current) => !current)}
          >
            {mobileMenuOpen ? t('nav.closeMenu') : t('nav.menu')}
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
                <span className="featured-star">★</span> {t('nav.enterprise')}
              </button>
              <button
                className={view.type === 'catalog' ? 'active' : ''}
                onClick={() => {
                  setView({ type: 'catalog' });
                  setMobileMenuOpen(false);
                }}
              >
                {t('nav.catalog')}
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
              <div className="mobile-lang-switcher">
                <LanguageSwitcher />
              </div>
            </div>
          ) : null}
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
                {publicSession?.user?.fullName?.trim().charAt(0).toUpperCase() || '👤'}
              </span>
              {!publicSession?.token ? <span className="profile-label">{t('nav.login')}</span> : null}
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
                  {t('nav.myCourses')}
                </button>
                <button
                  onClick={() => {
                    setView({ type: 'enterprise' });
                    setAccountMenuOpen(false);
                  }}
                >
                  {t('nav.enterprise')}
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
                  <button onClick={() => openItem(activeHero)}>{activeHero.kind === 'course' ? t('hero.enterCourse') : t('hero.watchNow')}</button>
                  <button className="ghost-btn" onClick={() => setView({ type: 'catalog' })}>
                    {t('hero.exploreCatalog')}
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
              {!myCoursesLoading && myCourseItems.length === 0 ? (
                <div className="my-courses-empty">
                  <p>{t('home.noCoursesEnrolled')}</p>
                  <button className="go-course-btn" onClick={() => setView({ type: 'catalog' })}>
                    {t('home.exploreAndGet')}
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
                        <p className="my-course-progress-text">{t('home.progress')}: {percent}%</p>
                        <div className="my-course-progress-track" aria-hidden="true">
                          <div className="my-course-progress-fill" style={{ width: `${percent}%` }} />
                        </div>
                      </article>
                    );
                  })}
                  <button className="content-tile promo-more-courses" onClick={() => setView({ type: 'my-courses' })}>
                    <div className="promo-more-inner">
                      <span className="public-badge kind-bundle">{t('home.suggested')}</span>
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
                  <h2>{t('home.liveEvents')}</h2>
                  <p className="row-subtitle">{t('home.liveEventsSubtitle')}</p>
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
                            {state === 'live' ? t('home.live') : state === 'upcoming' ? t('home.upcoming') : t('home.ended')}
                          </span>
                          <span className="webinar-platform-chip">{webinar.source_type.toUpperCase()}</span>
                        </div>
                        <h4>{webinar.title}</h4>
                        <p className="webinar-card-subtitle">{webinar.subtitle ?? t('home.exclusive')}</p>
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
                              {t('home.reserveFree')}
                            </a>
                          ) : null}
                          {webinar.vip_reservation_url ? (
                            <a className="tier-vip" href={webinar.vip_reservation_url} target="_blank" rel="noreferrer noopener">
                              {t('home.reserveVip')}
                            </a>
                          ) : (
                            <a href={webinar.source_url} target="_blank" rel="noreferrer noopener">
                              {webinar.cta_label || t('home.openWebinar')}
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
                  <h2>{t('home.podcasts')}</h2>
                  <p className="row-subtitle">{t('home.podcastsSubtitle')}</p>
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
                        <span className="public-badge kind-vod">{t('nav.podcasts')}</span>
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
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="catalog-filters">
              <label>
                {t('catalog.group')}
                <select value={catalogGroupFilter} onChange={(event) => setCatalogGroupFilter(event.target.value)}>
                  <option value="all">{t('catalog.all')}</option>
                  {catalogGroups.map((group) => (
                    <option key={group} value={group}>
                      {group}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('nav.myCourses')}
                <select
                  value={catalogEnrollmentFilter}
                  onChange={(event) => setCatalogEnrollmentFilter(event.target.value as 'all' | 'enrolled' | 'not-enrolled')}
                >
                  <option value="all">{t('catalog.all')}</option>
                  <option value="enrolled">{t('catalog.myCoursesFilter')}</option>
                  <option value="not-enrolled">{t('catalog.notEnrolledFilter')}</option>
                </select>
              </label>
              <label>
                {t('catalog.order')}
                <select value={catalogSort} onChange={(event) => setCatalogSort(event.target.value as 'default' | 'newest' | 'az')}>
                  <option value="default">{t('catalog.relevance')}</option>
                  <option value="newest">{t('catalog.newest')}</option>
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
                {t('catalog.clear')}
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
                          {isEnrolled ? t('catalog.enrolled') : t('catalog.notEnrolled')}
                        </span>
                      ) : null}
                    </div>
                    <h4>{item.title}</h4>
                    {item.kind === 'course' ? (
                      <div className="catalog-progress-wrap">
                        <div className="catalog-progress-track" aria-hidden="true">
                          <div className="catalog-progress-fill" style={{ width: `${isEnrolled ? percent : 0}%` }} />
                        </div>
                        <span>{isEnrolled ? t('catalog.advancePercent', { percent }) : t('catalog.previewAvailable')}</span>
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
                {t('catalog.loadMore')}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {view.type === 'detail' ? (
        <section className="section-block detail-block">
          <button className="back-link" onClick={() => setView({ type: 'home' })}>
            {t('catalog.backHome')}
          </button>

          {loadingDetail || !selectedDetail ? (
            <p>{t('course.contentLoading')}</p>
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
                    {isCurrentCourseAssigned ? t('catalog.enterFullCourse') : t('catalog.viewPreview')}
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
                    {activeModuleIndex >= 0 ? t('course.module', { current: activeModuleIndex + 1, total: flatModules.length }) : t('course.learningPath')}
                  </span>
                  <button className="back-link" onClick={() => setView({ type: 'my-courses' })}>
                    {t('course.goMyCourses')}
                  </button>
                </div>
                <h1>{selectedDetail?.content?.title ?? t('course.enterCourse')}</h1>
                <p>{snippet(selectedDetail?.content?.summary, selectedDetail?.content?.title, 260)}</p>
              </div>
            </div>
            {!isCurrentCourseAssigned ? (
              <div className="course-preview-banner">
                <strong>{t('course.previewMode')}</strong>
                <span>{t('course.previewDesc')}</span>
                <button onClick={() => setView({ type: 'catalog' })}>{t('course.unlockCourse')}</button>
              </div>
            ) : null}
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
                              setInteractionMessage(t('course.locked'));
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
                          <em>{locked ? t('course.moduleLocked') : isDone ? t('course.moduleDone') : t('course.modulePending')}</em>
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
              ) : isModuleLocked(activeModule.module.id) ? (
                <section className="course-paywall-card">
                  <h3>{t('course.continueFullPath')}</h3>
                  <p>{t('course.sawFirstModule')}</p>
                  <div className="interaction-actions">
                    <button onClick={() => setView({ type: 'catalog' })}>{t('course.seeCatalog')}</button>
                    <button className="ghost-btn" onClick={() => setView({ type: 'my-courses' })}>{t('course.goMyCourses')}</button>
                  </div>
                </section>
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
                        <iframe src={activeFileUrl} title="Course file" />
                      </div>
                    ) : null}
                  </section>

                  <section className="interaction-box interaction-box-modern">
                    <div className="interaction-heading">
                      <h3>{isPreviewOnly ? t('course.demoView') : t('course.activityDev')}</h3>
                      {!isPreviewOnly ? <span>{t('course.saveGuide')}</span> : null}
                    </div>
                    {isPreviewOnly ? (
                      <div className="preview-readonly-box">
                        <p>{t('course.previewReadonly')}</p>
                        <button className="go-course-btn" onClick={() => setView({ type: 'catalog' })}>
                          {t('course.purchaseUnlock')}
                        </button>
                      </div>
                    ) : (
                      <>
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
                          {activeModuleCompleted
                            ? t('course.alreadyCompleted')
                            : t('course.completeWhenDone')}
                        </p>
                      </>
                    )}
                    {interactionMessage ? <p className="interaction-feedback">{interactionMessage}</p> : null}
                    {!isPreviewOnly ? (
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
                    ) : null}
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
                <strong>{(myCourses?.localCourses ?? []).filter((course) => course.status === 'active').length}</strong>
              </article>
              <article className="profile-summary-card">
                <span>{t('myCourses.avgProgress')}</span>
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
                <span>{t('myCourses.account')}</span>
                <strong>{publicSession.user.locale.toUpperCase()}</strong>
              </article>
            </div>
          ) : null}
          {myCoursesLoading ? <p>{t('home.loadingCourses')}</p> : null}
          {!myCoursesLoading && (myCourses?.localCourses ?? []).filter((course) => course.status === 'active').length === 0 ? (
            <p>{t('myCourses.empty')}</p>
          ) : null}
          <div className="profile-courses-grid">
            {(myCourses?.localCourses ?? []).filter((course) => course.status === 'active').map((course) => {
              const match = localizedCatalog.find(
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
                        {match ? getCourseCategoryLabel(match) : t('myCourses.syncing')}
                      </span>
                      <span className="profile-progress-pill">{percent}%</span>
                    </div>
                    <h4>{title}</h4>
                    <div className="profile-tile-progress" aria-hidden="true">
                      <div style={{ width: `${percent}%` }} />
                    </div>
                    <span className="profile-tile-cta">{match ? t('myCourses.continueCourse') : t('myCourses.notAvailable')}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
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

          <section className="enterprise-trust-strip">
            <p>{t('enterprise.trustStrip')}</p>
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
                      <a href="mailto:soporte@university.edu">{t('enterprise.needHelp')}</a>
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

                  <article className="card-like enterprise-panel-card">
                    <h3>{t('enterprise.assignCourses')}</h3>
                    <form className="profile-editor-form" onSubmit={onEnterpriseAssignCourse}>
                      <label>
                        {t('enterprise.course')}
                        <select
                          value={enterpriseCourseId}
                          onChange={(event) => setEnterpriseCourseId(event.target.value)}
                          required
                        >
                          <option value="">{t('enterprise.selectCourse')}</option>
                          {localizedCatalog
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
                        {enterpriseSaving ? t('enterprise.assigning') : t('enterprise.assignCourse')}
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
                <h3>{t('enterprise.students')}</h3>
                <div className="simple-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('enterprise.name')}</th>
                        <th>{t('enterprise.email')}</th>
                        <th>{t('enterprise.role')}</th>
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
                  value={registerForm.fullName}
                  onChange={(event) => setRegisterForm((current) => ({ ...current, fullName: event.target.value }))}
                  required
                />
                <input
                  type="email"
                  placeholder={t('auth.email')}
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

      {(view.type === 'terms' || view.type === 'privacy') ? (
        <section className="section-block legal-block">
          <div className="legal-hero">
            <button className="back-link legal-back-btn" onClick={() => setView({ type: 'home' })}>
              {t('legal.back')}
            </button>
            <h1>{t('legal.title')}</h1>
            <div className="legal-switch">
              <button
                className={view.type === 'terms' ? 'active' : ''}
                onClick={() => setView({ type: 'terms' })}
              >
                {t('legal.terms')}
              </button>
              <button
                className={view.type === 'privacy' ? 'active' : ''}
                onClick={() => setView({ type: 'privacy' })}
              >
                {t('legal.privacy')}
              </button>
            </div>
          </div>

          <div className="legal-layout">
            <article className="legal-content-card">
              {loadingLegal ? <p>{t('legal.loadingContent')}</p> : null}
              {!loadingLegal && activeLegalDocument ? (
                <>
                  <h2 dangerouslySetInnerHTML={{ __html: activeLegalDocument.title }} />
                  <div className="legal-content-prose moodle-html" dangerouslySetInnerHTML={{ __html: activeLegalDocument.html }} />
                </>
              ) : null}
            </article>
            <aside className="legal-side-card">
              <h3>{t('legal.infoTitle')}</h3>
              <p>{t('legal.infoDesc')}</p>
              <p>{t('legal.contactDesc')}</p>
              <a href="mailto:soporte@university.edu">soporte@university.edu</a>
            </aside>
          </div>
        </section>
      ) : null}

      <footer className="public-footer">
        <div className="footer-compliance">
          <div className="footer-compliance-links">
            <button className="footer-link-btn" onClick={() => setView({ type: 'terms' })}>{t('footer.terms')}</button>
            <button className="footer-link-btn" onClick={() => setView({ type: 'privacy' })}>{t('footer.privacy')}</button>
            <a className="footer-link-btn" href="mailto:ferpa@university.edu">{t('footer.ferpa')}</a>
            <a className="footer-link-btn" href="mailto:titleix@university.edu">{t('footer.titleIx')}</a>
            <a className="footer-link-btn" href="mailto:ada@university.edu">{t('footer.ada')}</a>
          </div>
          <p className="footer-compliance-notice">
            {t('footer.complianceNotice')}{' '}
            <a href="mailto:ferpa@university.edu">ferpa@university.edu</a>.
          </p>
        </div>
        <div className="footer-bottom">
          <span>{t('footer.copyright', { year: new Date().getFullYear() })}</span>
        </div>
      </footer>
    </main>
  );
}
