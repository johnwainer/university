import { useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  type AdminConfig,
  type AdminRouteRegistry,
  type AdminStatus,
  type WebinarRecord,
  type PodcastRecord,
  type CompanyRecord,
  type CompanyMemberRecord,
  type CompanyCourseAccessRecord,
  type CompanyDashboardStats,
  type CompanyUserProgressRecord,
  type PaginatedAdminUsersResponse,
  type MoodleCoursesResponse,
  type UserCoursesResponse
} from '../lib/api';
import './styles.css';
import { CompaniesView } from './admin/views/CompaniesView';
import { SisView } from './admin/views/SisView';
import { CrmView } from './admin/views/CrmView';
import { ComplianceView } from './admin/views/ComplianceView';
import { BackofficeView } from './admin/views/BackofficeView';
import { CredentialsView } from './admin/views/CredentialsView';
import { CieChecklistView } from './admin/views/CieChecklistView';
import { CalendarView } from './admin/views/CalendarView';

type AdminDashboardBase = {
  config: AdminConfig;
  status: AdminStatus;
  routes: AdminRouteRegistry;
  tenants: Array<{
    id: string;
    slug: string;
    name: string;
    locales: string[];
    currency: string;
    created_at: string;
  }>;
};

type PanelSection =
  | 'overview'
  | 'connections'
  | 'users'
  | 'courses'
  | 'enterprise'
  | 'webinars'
  | 'podcasts'
  | 'integrations'
  | 'sis'
  | 'crm'
  | 'compliance'
  | 'cie'
  | 'calendar'
  | 'backoffice'
  | 'credentials'
  | 'routes';

type WebinarFormState = {
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  heroImage: string;
  sourceType: 'youtube' | 'external' | 'hls' | 'vimeo' | 'zoom';
  sourceUrl: string;
  replayUrl: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  ctaLabel: string;
  isActive: boolean;
  showOnLanding: boolean;
  webinarLinks: Array<{ platform: string; url: string }>;
  freeReservationUrl: string;
  vipReservationUrl: string;
};

type PodcastFormState = {
  title: string;
  video: string;
  publishedAt: string;
  displayOrder: string;
  isActive: boolean;
  showOnLanding: boolean;
};

const webinarPlatformOptions = [
  'youtube',
  'zoom',
  'vimeo',
  'hls',
  'facebook',
  'instagram',
  'linkedin',
  'x',
  'tiktok',
  'external'
] as const;

const ADMIN_SESSION_STORAGE = 'atlas-admin-session-token';
const PAGE_SIZE = 20;

export function AdminApp() {
  const [sessionToken, setSessionToken] = useState<string>(() => localStorage.getItem(ADMIN_SESSION_STORAGE) ?? '');
  const [loginEmail, setLoginEmail] = useState('admin@atlas.edu');
  const [loginPassword, setLoginPassword] = useState('');
  const [activeSection, setActiveSection] = useState<PanelSection>('overview');
  const [loadingBase, setLoadingBase] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [loadingWebinars, setLoadingWebinars] = useState(false);
  const [loadingPodcasts, setLoadingPodcasts] = useState(false);
  const [syncingMoodleCourses, setSyncingMoodleCourses] = useState(false);
  const [syncingMoodleCategories, setSyncingMoodleCategories] = useState(false);
  const [syncingMoodleUsers, setSyncingMoodleUsers] = useState(false);
  
  const [syncingMoodleAll, setSyncingMoodleAll] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [enrollingUser, setEnrollingUser] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [baseData, setBaseData] = useState<AdminDashboardBase | null>(null);
  const [usersData, setUsersData] = useState<PaginatedAdminUsersResponse | null>(null);
  const [coursesData, setCoursesData] = useState<MoodleCoursesResponse | null>(null);
  const [webinarsData, setWebinarsData] = useState<WebinarRecord[]>([]);
  const [podcastsData, setPodcastsData] = useState<PodcastRecord[]>([]);
  const [savingMoodleConfig, setSavingMoodleConfig] = useState(false);
  
  
  
  const [moodleConnectionForm, setMoodleConnectionForm] = useState<{ baseUrl: string; token: string }>({
    baseUrl: '',
    token: ''
  });

  const [usersPage, setUsersPage] = useState(1);
  const [usersQuery, setUsersQuery] = useState('');
  const [usersStatusFilter, setUsersStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  const [coursesPage, setCoursesPage] = useState(1);
  const [coursesQuery, setCoursesQuery] = useState('');
  const [coursesVisibleFilter, setCoursesVisibleFilter] = useState<'all' | 'visible' | 'hidden'>('all');

  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [selectedUserCourses, setSelectedUserCourses] = useState<UserCoursesResponse | null>(null);
  const [newUser, setNewUser] = useState({ fullName: '', email: '', locale: 'es' });
  
  
  
  
  
  
  
  const [creatingWebinar, setCreatingWebinar] = useState(false);
  const [editingWebinarId, setEditingWebinarId] = useState<string | null>(null);
  const [creatingPodcast, setCreatingPodcast] = useState(false);
  const [editingPodcastId, setEditingPodcastId] = useState<string | null>(null);
  const [webinarForm, setWebinarForm] = useState<WebinarFormState>({
    slug: '',
    title: '',
    subtitle: '',
    description: '',
    heroImage:
      'https://images.unsplash.com/photo-1515168833906-d2a3b82b302a?auto=format&fit=crop&w=1600&q=80',
    sourceType: 'youtube' as const,
    sourceUrl: '',
    replayUrl: '',
    startsAt: '',
    endsAt: '',
    timezone: 'America/Bogota',
    ctaLabel: 'Inscribirse',
    isActive: true,
    showOnLanding: true,
    webinarLinks: [],
    freeReservationUrl: '',
    vipReservationUrl: ''
  });
  const [podcastForm, setPodcastForm] = useState<PodcastFormState>({
    title: '',
    video: '',
    publishedAt: '',
    displayOrder: '0',
    isActive: true,
    showOnLanding: true
  });
  const userCoursesSectionRef = useRef<HTMLElement | null>(null);

  const toDatetimeLocal = (iso: string | null | undefined): string => {
    if (!iso) {
      return '';
    }
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
      date.getMinutes()
    )}`;
  };

  const isLoggedIn = sessionToken.length > 0;

  const routeSummary = useMemo(() => {
    if (!baseData) {
      return { get: 0, post: 0, others: 0 };
    }

    return baseData.routes.routes.reduce(
      (acc, route) => {
        if (route.method === 'GET') {
          acc.get += 1;
        } else if (route.method === 'POST') {
          acc.post += 1;
        } else {
          acc.others += 1;
        }
        return acc;
      },
      { get: 0, post: 0, others: 0 }
    );
  }, [baseData]);

  const currentUsers = usersData?.items ?? [];
  const allCurrentPageSelected =
    currentUsers.length > 0 && currentUsers.every((user) => selectedUserIds.includes(user.id));

  const loadBase = async (token: string) => {
    setLoadingBase(true);
    setError(null);

    try {
      const [config, status, routes, tenants] = await Promise.all([
        api.admin.config(token),
        api.admin.status(token),
        api.admin.routes(token),
        api.admin.tenants(token)
      ]);

      setBaseData({ config, status, routes, tenants });
      setMoodleConnectionForm((current) => ({
        baseUrl: current.baseUrl || config.moodle.baseUrl || '',
        token: current.token
      }));
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Error cargando datos del admin';
      setError(message);
      if (message.includes('401')) {
        onLogout();
      }
    } finally {
      setLoadingBase(false);
    }
  };

  const loadUsers = async (token: string) => {
    setLoadingUsers(true);
    try {
      const response = await api.admin.usersPage(token, {
        page: usersPage,
        pageSize: PAGE_SIZE,
        q: usersQuery.trim() || undefined,
        status: usersStatusFilter === 'all' ? undefined : usersStatusFilter
      });
      setUsersData(response);
      setSelectedUserIds((current) => current.filter((id) => response.items.some((user) => user.id === id)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Error cargando usuarios');
    } finally {
      setLoadingUsers(false);
    }
  };

  const loadCourses = async (token: string) => {
    setLoadingCourses(true);
    try {
      const response = await api.admin.moodleCoursesPage(token, {
        page: coursesPage,
        pageSize: PAGE_SIZE,
        q: coursesQuery.trim() || undefined,
        visible:
          coursesVisibleFilter === 'all'
            ? undefined
            : coursesVisibleFilter === 'visible'
              ? true
              : false
      });
      setCoursesData(response);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Error cargando cursos');
    } finally {
      setLoadingCourses(false);
    }
  };


  const loadWebinars = async (token: string) => {
    setLoadingWebinars(true);
    try {
      const response = await api.admin.webinars(token);
      setWebinarsData(response);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Error cargando webinars');
    } finally {
      setLoadingWebinars(false);
    }
  };

  const loadPodcasts = async (token: string) => {
    setLoadingPodcasts(true);
    try {
      const response = await api.admin.podcasts(token);
      setPodcastsData(response);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Error cargando podcasts');
    } finally {
      setLoadingPodcasts(false);
    }
  };


  useEffect(() => {
    if (!isLoggedIn) {
      return;
    }

    const bootstrap = async () => {
      try {
        await api.admin.me(sessionToken);
        await Promise.all([
          loadBase(sessionToken),
          loadUsers(sessionToken),
          loadCourses(sessionToken),

          
          loadWebinars(sessionToken),
          loadPodcasts(sessionToken)
        ]);
      } catch {
        onLogout();
      }
    };

    void bootstrap();
  }, [sessionToken]);

  useEffect(() => {
    if (!sessionToken) {
      return;
    }
    void loadUsers(sessionToken);
  }, [sessionToken, usersPage, usersStatusFilter]);

  useEffect(() => {
    if (!sessionToken) {
      return;
    }
    void loadCourses(sessionToken);
  }, [sessionToken, coursesPage, coursesVisibleFilter]);

  const onLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setInfo(null);

    try {
      const session = await api.admin.login(loginEmail.trim(), loginPassword);
      localStorage.setItem(ADMIN_SESSION_STORAGE, session.token);
      setSessionToken(session.token);
      setLoginPassword('');
      setInfo(`Sesión iniciada. Expira: ${new Date(session.expiresAt).toLocaleString()}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Error de inicio de sesión');
    }
  };

  const onLogout = () => {
    if (sessionToken) {
      void api.admin.logout(sessionToken).catch(() => undefined);
    }
    localStorage.removeItem(ADMIN_SESSION_STORAGE);
    setSessionToken('');
    setBaseData(null);
    setUsersData(null);
    setCoursesData(null);
    setWebinarsData([]);
    setPodcastsData([]);
    setError(null);
    setInfo(null);
    setSelectedUserCourses(null);
    setSelectedUserId('');
    setSelectedCourseId('');
    setSelectedUserIds([]);
    setActiveSection('overview');
  };

  const refreshAll = async () => {
    if (!sessionToken) {
      return;
    }
    await Promise.all([
      loadBase(sessionToken),
      loadUsers(sessionToken),
      loadCourses(sessionToken),

      
      loadWebinars(sessionToken),
      loadPodcasts(sessionToken)
    ]);
  };

  const onSubmitWebinar = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionToken) {
      return;
    }
    setCreatingWebinar(true);
    setError(null);
    setInfo(null);
    try {
      const payload = {
        slug: webinarForm.slug.trim(),
        title: webinarForm.title.trim(),
        subtitle: webinarForm.subtitle.trim() || undefined,
        description: webinarForm.description.trim() || undefined,
        heroImage: webinarForm.heroImage.trim(),
        sourceType: webinarForm.sourceType,
        sourceUrl: webinarForm.sourceUrl.trim(),
        replayUrl: webinarForm.replayUrl.trim() || undefined,
        startsAt: new Date(webinarForm.startsAt).toISOString(),
        endsAt: webinarForm.endsAt ? new Date(webinarForm.endsAt).toISOString() : undefined,
        timezone: webinarForm.timezone.trim() || 'America/Bogota',
        ctaLabel: webinarForm.ctaLabel.trim() || 'Inscribirse',
        isActive: webinarForm.isActive,
        showOnLanding: webinarForm.showOnLanding,
        webinarLinks: webinarForm.webinarLinks.filter((link) => link.platform.trim() && link.url.trim()),
        freeReservationUrl: webinarForm.freeReservationUrl.trim() || undefined,
        vipReservationUrl: webinarForm.vipReservationUrl.trim() || undefined
      };
      if (editingWebinarId) {
        const updated = await api.admin.updateWebinar(sessionToken, editingWebinarId, payload);
        setInfo(`Seminario actualizado: ${updated.webinar.title}`);
      } else {
        const created = await api.admin.createWebinar(sessionToken, payload);
        setInfo(`Seminario creado: ${created.webinar.title}`);
      }
      setWebinarForm((current) => ({
        ...current,
        slug: '',
        title: '',
        subtitle: '',
        description: '',
        sourceUrl: '',
        replayUrl: '',
        startsAt: '',
        endsAt: '',
        webinarLinks: [],
        freeReservationUrl: '',
        vipReservationUrl: ''
      }));
      setEditingWebinarId(null);
      await Promise.all([loadWebinars(sessionToken), loadBase(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar el webinar');
    } finally {
      setCreatingWebinar(false);
    }
  };

  const onEditWebinar = (webinar: WebinarRecord) => {
    setEditingWebinarId(webinar.id);
    setWebinarForm({
      slug: webinar.slug,
      title: webinar.title,
      subtitle: webinar.subtitle ?? '',
      description: webinar.description ?? '',
      heroImage: webinar.hero_image,
      sourceType: webinar.source_type,
      sourceUrl: webinar.source_url,
      replayUrl: webinar.replay_url ?? '',
      startsAt: toDatetimeLocal(webinar.starts_at),
      endsAt: toDatetimeLocal(webinar.ends_at),
      timezone: webinar.timezone ?? 'America/Bogota',
      ctaLabel: webinar.cta_label ?? 'Inscribirse',
      isActive: webinar.is_active,
      showOnLanding: webinar.show_on_landing,
      webinarLinks: Array.isArray(webinar.webinar_links)
        ? webinar.webinar_links.map((link) => ({ platform: String(link.platform), url: String(link.url) }))
        : [],
      freeReservationUrl: webinar.free_reservation_url ?? '',
      vipReservationUrl: webinar.vip_reservation_url ?? ''
    });
  };

  const onCancelWebinarEdit = () => {
    setEditingWebinarId(null);
    setWebinarForm({
      slug: '',
      title: '',
      subtitle: '',
      description: '',
      heroImage:
        'https://images.unsplash.com/photo-1515168833906-d2a3b82b302a?auto=format&fit=crop&w=1600&q=80',
      sourceType: 'youtube',
      sourceUrl: '',
      replayUrl: '',
      startsAt: '',
      endsAt: '',
      timezone: 'America/Bogota',
      ctaLabel: 'Inscribirse',
      isActive: true,
      showOnLanding: true,
      webinarLinks: [],
      freeReservationUrl: '',
      vipReservationUrl: ''
    });
  };

  const onToggleWebinarFlag = async (
    webinarId: string,
    payload: { isActive?: boolean; showOnLanding?: boolean }
  ) => {
    if (!sessionToken) {
      return;
    }
    setError(null);
    setInfo(null);
    try {
      const response = await api.admin.updateWebinar(sessionToken, webinarId, payload);
      setInfo(
        `Seminario actualizado: ${response.webinar.title} · activo=${response.webinar.is_active ? 'sí' : 'no'} · landing=${response.webinar.show_on_landing ? 'sí' : 'no'
        }`
      );
      await Promise.all([loadWebinars(sessionToken), loadBase(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo actualizar webinar');
    }
  };

  const onDeleteWebinar = async (webinarId: string) => {
    if (!sessionToken) {
      return;
    }
    setError(null);
    setInfo(null);
    try {
      await api.admin.deleteWebinar(sessionToken, webinarId);
      setInfo('Seminario eliminado.');
      await Promise.all([loadWebinars(sessionToken), loadBase(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo eliminar webinar');
    }
  };

  const onSubmitPodcast = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionToken) {
      return;
    }
    setCreatingPodcast(true);
    setError(null);
    setInfo(null);
    try {
      const payload = {
        title: podcastForm.title.trim(),
        video: podcastForm.video.trim(),
        publishedAt: new Date(podcastForm.publishedAt).toISOString(),
        isActive: podcastForm.isActive,
        showOnLanding: podcastForm.showOnLanding,
        displayOrder: Number.parseInt(podcastForm.displayOrder, 10) || 0
      };
      if (editingPodcastId) {
        const updated = await api.admin.updatePodcast(sessionToken, editingPodcastId, payload);
        setInfo(`Podcast actualizado: ${updated.podcast.title}`);
      } else {
        const created = await api.admin.createPodcast(sessionToken, payload);
        setInfo(`Podcast creado: ${created.podcast.title}`);
      }
      setPodcastForm({
        title: '',
        video: '',
        publishedAt: '',
        displayOrder: '0',
        isActive: true,
        showOnLanding: true
      });
      setEditingPodcastId(null);
      await Promise.all([loadPodcasts(sessionToken), loadBase(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar el podcast');
    } finally {
      setCreatingPodcast(false);
    }
  };

  const onEditPodcast = (podcast: PodcastRecord) => {
    setEditingPodcastId(podcast.id);
    setPodcastForm({
      title: podcast.title,
      video: podcast.video_url || podcast.video_code,
      publishedAt: toDatetimeLocal(podcast.published_at),
      displayOrder: String(podcast.display_order ?? 0),
      isActive: podcast.is_active,
      showOnLanding: podcast.show_on_landing
    });
  };

  const onCancelPodcastEdit = () => {
    setEditingPodcastId(null);
    setPodcastForm({
      title: '',
      video: '',
      publishedAt: '',
      displayOrder: '0',
      isActive: true,
      showOnLanding: true
    });
  };

  const onTogglePodcastFlag = async (
    podcastId: string,
    payload: { isActive?: boolean; showOnLanding?: boolean }
  ) => {
    if (!sessionToken) {
      return;
    }
    setError(null);
    setInfo(null);
    try {
      const response = await api.admin.updatePodcast(sessionToken, podcastId, payload);
      setInfo(
        `Podcast actualizado: ${response.podcast.title} · activo=${response.podcast.is_active ? 'sí' : 'no'} · landing=${response.podcast.show_on_landing ? 'sí' : 'no'
        }`
      );
      await Promise.all([loadPodcasts(sessionToken), loadBase(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo actualizar podcast');
    }
  };

  const onDeletePodcast = async (podcastId: string) => {
    if (!sessionToken) {
      return;
    }
    setError(null);
    setInfo(null);
    try {
      await api.admin.deletePodcast(sessionToken, podcastId);
      setInfo('Podcast eliminado.');
      await Promise.all([loadPodcasts(sessionToken), loadBase(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo eliminar podcast');
    }
  };

  const onSyncMoodleCourses = async () => {
    if (!sessionToken) {
      return;
    }

    setSyncingMoodleCourses(true);
    setError(null);
    setInfo(null);

    try {
      const result = await api.admin.moodleSyncCourses(sessionToken);
      if (!result.synced) {
        setInfo(result.error ?? 'Fallo de sincronización de cursos');
      } else {
        setInfo(
          `Cursos sincronizados: ${result.totalCourses ?? 0}, catálogo actualizado: ${result.upsertedCatalogAssets ?? 0}.`
        );
      }
      await Promise.all([loadBase(sessionToken), loadCourses(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Error sync cursos');
    } finally {
      setSyncingMoodleCourses(false);
    }
  };

  const onSaveMoodleConnection = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionToken) {
      return;
    }
    if (!moodleConnectionForm.baseUrl.trim()) {
      setError('Debes indicar la URL base de Moodle.');
      return;
    }
    if (!moodleConnectionForm.token.trim() && !baseData?.config.moodle.tokenSet) {
      setError('Debes indicar el token de Moodle.');
      return;
    }
    setSavingMoodleConfig(true);
    setError(null);
    setInfo(null);
    try {
      const result = await api.admin.updateMoodleConfig(sessionToken, {
        baseUrl: moodleConnectionForm.baseUrl.trim(),
        token: moodleConnectionForm.token.trim() || undefined
      });
      setInfo(`Conexión Moodle actualizada: ${result.baseUrl}`);
      setMoodleConnectionForm((current) => ({ ...current, token: '' }));
      await Promise.all([loadBase(sessionToken), loadCourses(sessionToken), loadUsers(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo actualizar conexión Moodle');
    } finally {
      setSavingMoodleConfig(false);
    }
  };

  const onSyncMoodleCategories = async () => {
    if (!sessionToken) {
      return;
    }
    setSyncingMoodleCategories(true);
    setError(null);
    setInfo(null);
    try {
      const result = await api.admin.moodleSyncCategories(sessionToken);
      setInfo(
        `Categorías sincronizadas: ${result.totalCategories}, actualizadas: ${result.upsertedCategories}${result.source ? ` (${result.source})` : ''
        }.`
      );
      await Promise.all([loadBase(sessionToken), loadCourses(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Error sync categorías');
    } finally {
      setSyncingMoodleCategories(false);
    }
  };

  const onSyncMoodleUsers = async () => {
    if (!sessionToken) {
      return;
    }

    setSyncingMoodleUsers(true);
    setError(null);
    setInfo(null);

    try {
      const result = await api.admin.moodleSyncUsers(sessionToken);
      setInfo(
        `Usuarios sincronizados: ${result.totalUsers}, actualizados: ${result.upsertedUsers}, matrículas: ${result.enrollmentLinks}.`
      );
      await Promise.all([loadBase(sessionToken), loadUsers(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Error sync usuarios');
    } finally {
      setSyncingMoodleUsers(false);
    }
  };

  const onSyncMoodleAll = async () => {
    if (!sessionToken) {
      return;
    }
    setSyncingMoodleAll(true);
    setError(null);
    setInfo(null);
    try {
      const result = await api.admin.moodleSyncAll(sessionToken);
      setInfo(
        `Sync completo OK. Categorías: ${result.categories.upsertedCategories}, cursos: ${result.courses.upsertedCourses ?? 0
        }, usuarios: ${result.users.upsertedUsers}.`
      );
      await Promise.all([loadBase(sessionToken), loadCourses(sessionToken), loadUsers(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Error en sync completo');
    } finally {
      setSyncingMoodleAll(false);
    }
  };

  const onCreateUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionToken) {
      return;
    }

    setCreatingUser(true);
    setError(null);
    setInfo(null);

    try {
      const response = await api.admin.createUser(sessionToken, {
        fullName: newUser.fullName,
        email: newUser.email,
        locale: newUser.locale,
        roles: ['learner']
      });

      setInfo(`Usuario creado: ${response.user.full_name}. Clave temporal Moodle: ${response.temporaryPassword}`);
      setNewUser({ fullName: '', email: '', locale: 'es' });
      await Promise.all([loadBase(sessionToken), loadUsers(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo crear el usuario');
    } finally {
      setCreatingUser(false);
    }
  };

  const onLoadUserCourses = async (userIdOverride?: string) => {
    const targetUserId = userIdOverride ?? selectedUserId;
    if (!sessionToken || !targetUserId) {
      return;
    }

    try {
      const response = await api.admin.userCourses(sessionToken, targetUserId);
      setSelectedUserCourses(response);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudieron cargar cursos del usuario');
    }
  };

  const onEnrollUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionToken || !selectedUserId || !selectedCourseId) {
      return;
    }

    setEnrollingUser(true);
    setError(null);
    setInfo(null);

    try {
      await api.admin.enrollUserInCourse(sessionToken, selectedUserId, {
        moodleCourseId: Number(selectedCourseId),
        roleId: 5
      });
      setInfo('Matrícula aplicada correctamente.');
      await Promise.all([loadBase(sessionToken), loadUsers(sessionToken)]);
      await onLoadUserCourses();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo matricular el usuario');
    } finally {
      setEnrollingUser(false);
    }
  };

  const updateSingleUserStatus = async (userId: string, status: 'active' | 'inactive') => {
    if (!sessionToken) {
      return;
    }

    setError(null);
    setInfo(null);

    try {
      await api.admin.updateUserStatus(sessionToken, userId, { status, syncMoodle: true });
      setInfo(`Usuario ${status === 'inactive' ? 'desactivado' : 'activado'} y sincronizado con Moodle.`);
      await Promise.all([loadBase(sessionToken), loadUsers(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo actualizar el estado del usuario');
    }
  };

  const updateBulkUsersStatus = async (status: 'active' | 'inactive') => {
    if (!sessionToken || selectedUserIds.length === 0) {
      return;
    }

    setError(null);
    setInfo(null);

    try {
      const response = await api.admin.bulkUpdateUserStatus(sessionToken, {
        userIds: selectedUserIds,
        status,
        syncMoodle: true
      });
      setInfo(
        `Proceso masivo: ${response.processed}/${response.requested} usuarios ${status === 'inactive' ? 'desactivados' : 'activados'
        }. Fallos: ${response.failures.length}.`
      );
      setSelectedUserIds([]);
      await Promise.all([loadBase(sessionToken), loadUsers(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo actualizar usuarios en bulk');
    }
  };

  const toggleUserSelection = (userId: string) => {
    setSelectedUserIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]
    );
  };

  const toggleSelectCurrentPage = () => {
    if (allCurrentPageSelected) {
      setSelectedUserIds([]);
      return;
    }
    setSelectedUserIds(currentUsers.map((user) => user.id));
  };

  if (!isLoggedIn) {
    return (
      <main className="admin-shell">
        <section className="login-card">
          <p className="eyebrow">UNIVERSITY ADMIN</p>
          <h1>Iniciar sesión</h1>
          <p>Panel central del intermediador. Desde aquí se administra usuarios, cursos, rutas y conexiones con Moodle.</p>
          <form onSubmit={onLogin} className="login-form">
            <label htmlFor="admin-email">Correo admin</label>
            <input
              id="admin-email"
              type="email"
              value={loginEmail}
              onChange={(event) => setLoginEmail(event.target.value)}
              placeholder="admin@atlas.edu"
              required
            />
            <label htmlFor="admin-password">Contraseña</label>
            <input
              id="admin-password"
              type="password"
              value={loginPassword}
              onChange={(event) => setLoginPassword(event.target.value)}
              placeholder="******"
              required
            />
            <button type="submit">Entrar</button>
          </form>
          {error ? <p className="error-msg">{error}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">UNIVERSITY</p>
          <h1>Panel Administrativo</h1>
        </div>
        <div className="topbar-actions">
          <button
            className="ghost"
            onClick={() => void onSyncMoodleAll()}
            disabled={syncingMoodleAll || syncingMoodleCourses || syncingMoodleCategories || syncingMoodleUsers}
          >
            {syncingMoodleAll ? 'Sync completo...' : 'Sync completo'}
          </button>
          <button
            className="ghost"
            onClick={() => void refreshAll()}
            disabled={loadingBase || loadingUsers || loadingCourses || loadingWebinars || loadingPodcasts}
          >
            {loadingBase || loadingUsers || loadingCourses || loadingWebinars || loadingPodcasts ? 'Actualizando...' : 'Actualizar'}
          </button>
          <button className="ghost danger" onClick={onLogout}>
            Cerrar sesión
          </button>
        </div>
      </header>

      <nav className="section-tabs">
        <button className={activeSection === 'overview' ? 'active' : ''} onClick={() => setActiveSection('overview')}>
          Resumen
        </button>
        <button
          className={activeSection === 'connections' ? 'active' : ''}
          onClick={() => setActiveSection('connections')}
        >
          Conexiones
        </button>
        <button className={activeSection === 'users' ? 'active' : ''} onClick={() => setActiveSection('users')}>
          Usuarios
        </button>
        <button className={activeSection === 'courses' ? 'active' : ''} onClick={() => setActiveSection('courses')}>
          Cursos
        </button>
        <button
          className={activeSection === 'enterprise' ? 'active' : ''}
          onClick={() => setActiveSection('enterprise')}
        >
          Departamentos
        </button>
        <button className={activeSection === 'webinars' ? 'active' : ''} onClick={() => setActiveSection('webinars')}>
          Seminarios
        </button>
        <button className={activeSection === 'podcasts' ? 'active' : ''} onClick={() => setActiveSection('podcasts')}>
          Podcasts
        </button>
        <button className={activeSection === 'integrations' ? 'active' : ''} onClick={() => setActiveSection('integrations')}>
          Integraciones
        </button>
        <button className={activeSection === 'sis' ? 'active' : ''} onClick={() => setActiveSection('sis')}>
          SIS / Académico
        </button>
        <button className={activeSection === 'crm' ? 'active' : ''} onClick={() => setActiveSection('crm')}>
          CRM / Admisión
        </button>
        <button className={activeSection === 'compliance' ? 'active' : ''} onClick={() => setActiveSection('compliance')}>
          Cumplimiento
        </button>
        <button className={activeSection === 'cie' ? 'active' : ''} onClick={() => setActiveSection('cie')}>
          Checklist CIE
        </button>
        <button className={activeSection === 'calendar' ? 'active' : ''} onClick={() => setActiveSection('calendar')}>
          Calendario y aulas
        </button>
        <button className={activeSection === 'backoffice' ? 'active' : ''} onClick={() => setActiveSection('backoffice')}>
          Back-office
        </button>
        <button className={activeSection === 'credentials' ? 'active' : ''} onClick={() => setActiveSection('credentials')}>
          Credenciales
        </button>
        <button className={activeSection === 'routes' ? 'active' : ''} onClick={() => setActiveSection('routes')}>
          Rutas API
        </button>
      </nav>

      {error ? <p className="error-msg">{error}</p> : null}
      {info ? <p className="info-msg">{info}</p> : null}

      {!baseData ? (
        <section className="status-card">Cargando panel...</section>
      ) : (
        <>
          {activeSection === 'overview' ? (
            <section className="grid-4">
              <article className="card metric">
                <h2>Rutas registradas</h2>
                <strong>{baseData.status.routes.total}</strong>
                <span>
                  GET {routeSummary.get} | POST {routeSummary.post} | OTROS {routeSummary.others}
                </span>
              </article>
              <article className="card metric">
                <h2>Base de datos</h2>
                <strong>{baseData.status.db.database ?? 'n/a'}</strong>
                <span>Sesiones activas: {baseData.status.db.activeSessions}</span>
              </article>
              <article className="card metric">
                <h2>Moodle</h2>
                <strong>{baseData.status.moodle.connected ? 'Conectado' : 'Sin conexión'}</strong>
                <span>{baseData.status.moodle.error ?? 'Sin errores reportados'}</span>
              </article>
              <article className="card metric">
                <h2>Usuarios</h2>
                <strong>{baseData.status.db.entities.users}</strong>
                <span>Matrículas: {baseData.status.db.entities.userEnrollments}</span>
              </article>
              <article className="card metric">
                <h2>Cursos y categorías</h2>
                <strong>{baseData.status.db.entities.moodleCourses}</strong>
                <span>Categorías Moodle: {baseData.status.db.entities.moodleCategories}</span>
              </article>
              <article className="card metric">
                <h2>Seminarios</h2>
                <strong>{baseData.status.db.entities.webinars}</strong>
                <span>Configurables desde este panel</span>
              </article>
              <article className="card metric">
                <h2>Clases magistrales</h2>
                <strong>{baseData.status.db.entities.podcasts}</strong>
                <span>Videos de YouTube en landing</span>
              </article>
              <article className="card metric">
                <h2>Departamentos</h2>
                <strong>{baseData.status.db.entities.companies}</strong>
                <span>Estudiantes activos: {baseData.status.db.entities.companyMembers}</span>
              </article>
              <article className="card metric">
                <h2>Último sync</h2>
                <strong>
                  {baseData.status.moodle.lastCoursesSync?.syncedAt
                    ? new Date(baseData.status.moodle.lastCoursesSync.syncedAt).toLocaleString()
                    : 'nunca'}
                </strong>
                <span>
                  Cat: {baseData.status.moodle.lastCategoriesSync?.syncedAt
                    ? new Date(baseData.status.moodle.lastCategoriesSync.syncedAt).toLocaleString()
                    : 'nunca'}
                </span>
              </article>
            </section>
          ) : null}

          {activeSection === 'connections' ? (
            <section className="grid-2">
              <article className="card">
                <h2>Estado de conexiones</h2>
                <ul className="clean-list">
                  <li>DB conectada: {baseData.status.db.connected ? 'sí' : 'no'}</li>
                  <li>Moodle configurado: {baseData.status.moodle.configured ? 'sí' : 'no'}</li>
                  <li>Moodle conectado: {baseData.status.moodle.connected ? 'sí' : 'no'}</li>
                  <li>
                    Último sync cursos:{' '}
                    {baseData.status.moodle.lastCoursesSync?.syncedAt
                      ? new Date(baseData.status.moodle.lastCoursesSync.syncedAt).toLocaleString()
                      : 'nunca'}
                  </li>
                  <li>
                    Último sync usuarios:{' '}
                    {baseData.status.moodle.lastUsersSync?.syncedAt
                      ? new Date(baseData.status.moodle.lastUsersSync.syncedAt).toLocaleString()
                      : 'nunca'}
                  </li>
                  <li>
                    Último sync categorías:{' '}
                    {baseData.status.moodle.lastCategoriesSync?.syncedAt
                      ? new Date(baseData.status.moodle.lastCategoriesSync.syncedAt).toLocaleString()
                      : 'nunca'}
                  </li>
                  <li>
                    API: {baseData.config.server.host}:{baseData.config.server.port}
                  </li>
                  <li>Moodle URL: {baseData.config.moodle.baseUrl ?? 'no configurado'}</li>
                </ul>
              </article>

              <article className="card">
                <h2>Configuración de Moodle</h2>
                <form className="login-form" onSubmit={onSaveMoodleConnection}>
                  <label htmlFor="moodle-base-url">URL base Moodle</label>
                  <input
                    id="moodle-base-url"
                    value={moodleConnectionForm.baseUrl}
                    onChange={(event) =>
                      setMoodleConnectionForm((current) => ({ ...current, baseUrl: event.target.value }))
                    }
                    placeholder="http://localhost:8081"
                    required
                  />
                  <label htmlFor="moodle-token">Token Moodle</label>
                  <input
                    id="moodle-token"
                    type="password"
                    value={moodleConnectionForm.token}
                    onChange={(event) =>
                      setMoodleConnectionForm((current) => ({ ...current, token: event.target.value }))
                    }
                    placeholder={baseData.config.moodle.tokenSet ? '•••••••• (dejar vacío para mantener actual)' : 'token webservice'}
                    required={!baseData.config.moodle.tokenSet}
                  />
                  <button type="submit" disabled={savingMoodleConfig}>
                    {savingMoodleConfig ? 'Guardando...' : 'Guardar conexión'}
                  </button>
                </form>
              </article>

              <article className="card scroll-card">
                <h2>Tenants activos</h2>
                <table>
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>Slug</th>
                      <th>Locales</th>
                      <th>Moneda</th>
                    </tr>
                  </thead>
                  <tbody>
                    {baseData.tenants.map((tenant) => (
                      <tr key={tenant.id}>
                        <td>{tenant.name}</td>
                        <td>{tenant.slug}</td>
                        <td>{tenant.locales.join(', ')}</td>
                        <td>{tenant.currency}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </article>
            </section>
          ) : null}

          {activeSection === 'users' ? (
            <>
              <section className="grid-2">
                <article className="card">
                  <h2>Crear usuario</h2>
                  <form className="login-form" onSubmit={onCreateUser}>
                    <label htmlFor="fullName">Nombre completo</label>
                    <input
                      id="fullName"
                      value={newUser.fullName}
                      onChange={(event) => setNewUser((current) => ({ ...current, fullName: event.target.value }))}
                      placeholder="Ana Pérez"
                      required
                    />
                    <label htmlFor="email">Email</label>
                    <input
                      id="email"
                      type="email"
                      value={newUser.email}
                      onChange={(event) => setNewUser((current) => ({ ...current, email: event.target.value }))}
                      placeholder="ana@university.edu"
                      required
                    />
                    <label htmlFor="locale">Idioma</label>
                    <input
                      id="locale"
                      value={newUser.locale}
                      onChange={(event) => setNewUser((current) => ({ ...current, locale: event.target.value }))}
                      placeholder="es"
                      required
                    />
                    <button type="submit" disabled={creatingUser}>
                      {creatingUser ? 'Creando...' : 'Crear usuario'}
                    </button>
                  </form>
                </article>

                <article className="card">
                  <h2>Matrícula de usuario</h2>
                  <form className="login-form" onSubmit={onEnrollUser}>
                    <label htmlFor="userSelect">Usuario</label>
                    <select id="userSelect" value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>
                      <option value="">Selecciona usuario</option>
                      {currentUsers
                        .filter((user) => user.moodle_user_id)
                        .map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.full_name} ({user.email})
                          </option>
                        ))}
                    </select>
                    <label htmlFor="courseSelect">Curso</label>
                    <select
                      id="courseSelect"
                      value={selectedCourseId}
                      onChange={(event) => setSelectedCourseId(event.target.value)}
                    >
                      <option value="">Selecciona curso</option>
                      {(coursesData?.items ?? []).map((course) => (
                        <option key={course.moodle_course_id} value={String(course.moodle_course_id)}>
                          {course.full_name}
                        </option>
                      ))}
                    </select>
                    <button type="submit" disabled={enrollingUser}>
                      {enrollingUser ? 'Matriculando...' : 'Matricular'}
                    </button>
                  </form>
                </article>
              </section>

              <section className="grid-1">
                <article className="card">
                  <h2>Listado de usuarios</h2>
                  <div className="toolbar-grid">
                    <input
                      value={usersQuery}
                      onChange={(event) => setUsersQuery(event.target.value)}
                      placeholder="Buscar por nombre o email"
                    />
                    <select
                      value={usersStatusFilter}
                      onChange={(event) => {
                        setUsersStatusFilter(event.target.value as 'all' | 'active' | 'inactive');
                        setUsersPage(1);
                      }}
                    >
                      <option value="all">Todos</option>
                      <option value="active">Activos</option>
                      <option value="inactive">Inactivos</option>
                    </select>
                    <button className="ghost" onClick={() => { setUsersPage(1); void loadUsers(sessionToken); }}>
                      Buscar
                    </button>
                  </div>
                  <div className="inline-actions">
                    <button className="ghost" onClick={toggleSelectCurrentPage}>
                      {allCurrentPageSelected ? 'Deseleccionar página' : 'Seleccionar página'}
                    </button>
                    <button className="danger" disabled={selectedUserIds.length === 0} onClick={() => void updateBulkUsersStatus('inactive')}>
                      Desactivar seleccionados
                    </button>
                    <button className="ghost" disabled={selectedUserIds.length === 0} onClick={() => void updateBulkUsersStatus('active')}>
                      Activar seleccionados
                    </button>
                  </div>

                  <table>
                    <thead>
                      <tr>
                        <th></th>
                        <th>Nombre</th>
                        <th>Email</th>
                        <th>Estado</th>
                        <th>Moodle ID</th>
                        <th>Cursos</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loadingUsers ? (
                        <tr>
                          <td colSpan={7}>Cargando usuarios...</td>
                        </tr>
                      ) : currentUsers.length === 0 ? (
                        <tr>
                          <td colSpan={7}>No hay usuarios para este filtro.</td>
                        </tr>
                      ) : (
                        currentUsers.map((user) => (
                          <tr key={user.id}>
                            <td>
                              <input
                                type="checkbox"
                                checked={selectedUserIds.includes(user.id)}
                                onChange={() => toggleUserSelection(user.id)}
                              />
                            </td>
                            <td>{user.full_name}</td>
                            <td>{user.email}</td>
                            <td>{user.status}</td>
                            <td>{user.moodle_user_id ?? '-'}</td>
                            <td>{user.enrolled_courses}</td>
                            <td>
                              <button
                                className="ghost"
                                onClick={() => {
                                  setSelectedUserId(user.id);
                                  void onLoadUserCourses(user.id);
                                  requestAnimationFrame(() => {
                                    userCoursesSectionRef.current?.scrollIntoView({
                                      behavior: 'smooth',
                                      block: 'start'
                                    });
                                  });
                                }}
                              >
                                Ir a cursos
                              </button>
                              {user.status === 'active' ? (
                                <button className="danger" onClick={() => void updateSingleUserStatus(user.id, 'inactive')}>
                                  Desactivar
                                </button>
                              ) : (
                                <button className="ghost" onClick={() => void updateSingleUserStatus(user.id, 'active')}>
                                  Activar
                                </button>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>

                  <div className="pager">
                    <button
                      className="ghost"
                      onClick={() => setUsersPage((page) => Math.max(1, page - 1))}
                      disabled={(usersData?.pagination.page ?? 1) <= 1}
                    >
                      Anterior
                    </button>
                    <span>
                      Página {usersData?.pagination.page ?? 1} / {usersData?.pagination.totalPages ?? 1} | Total:{' '}
                      {usersData?.pagination.total ?? 0}
                    </span>
                    <button
                      className="ghost"
                      onClick={() => setUsersPage((page) => page + 1)}
                      disabled={(usersData?.pagination.page ?? 1) >= (usersData?.pagination.totalPages ?? 1)}
                    >
                      Siguiente
                    </button>
                  </div>
                </article>
              </section>

              <section className="grid-1" ref={userCoursesSectionRef}>
                <article className="card scroll-card">
                  <h2>Cursos por usuario</h2>
                  {!selectedUserCourses ? (
                    <p>Selecciona un usuario para ver sus cursos.</p>
                  ) : (
                    <table>
                      <thead>
                        <tr>
                          <th>ID curso</th>
                          <th>Nombre</th>
                          <th>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedUserCourses.localCourses.length === 0 ? (
                          <tr>
                            <td colSpan={3}>Sin matrículas locales aún.</td>
                          </tr>
                        ) : (
                          selectedUserCourses.localCourses.map((course) => (
                            <tr key={`${selectedUserCourses.user.id}-${course.moodle_course_id}`}>
                              <td>{course.moodle_course_id}</td>
                              <td>{course.full_name ?? course.short_name ?? 'Sin nombre'}</td>
                              <td>{course.status}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  )}
                </article>
              </section>
            </>
          ) : null}

          {activeSection === 'courses' ? (
            <section className="grid-1">
              <article className="card">
                <h2>Sincronización Moodle</h2>
                <div className="inline-actions">
                  <button
                    onClick={() => void onSyncMoodleAll()}
                    disabled={syncingMoodleAll || loadingCourses || loadingUsers}
                  >
                    {syncingMoodleAll ? 'Sincronizando todo...' : 'Sync completo'}
                  </button>
                  <button
                    onClick={() => void onSyncMoodleCategories()}
                    disabled={syncingMoodleCategories || loadingCourses}
                  >
                    {syncingMoodleCategories ? 'Sincronizando categorías...' : 'Sync categorías'}
                  </button>
                  <button onClick={() => void onSyncMoodleCourses()} disabled={syncingMoodleCourses || loadingCourses}>
                    {syncingMoodleCourses ? 'Sincronizando cursos...' : 'Sync cursos'}
                  </button>
                  <button onClick={() => void onSyncMoodleUsers()} disabled={syncingMoodleUsers || loadingUsers}>
                    {syncingMoodleUsers ? 'Sincronizando usuarios...' : 'Sync usuarios'}
                  </button>
                  
                </div>
              </article>
              <article className="card scroll-card">
                <h2>Cursos sincronizados desde Moodle</h2>
                <div className="toolbar-grid">
                  <input
                    value={coursesQuery}
                    onChange={(event) => setCoursesQuery(event.target.value)}
                    placeholder="Buscar curso"
                  />
                  <select
                    value={coursesVisibleFilter}
                    onChange={(event) => {
                      setCoursesVisibleFilter(event.target.value as 'all' | 'visible' | 'hidden');
                      setCoursesPage(1);
                    }}
                  >
                    <option value="all">Todos</option>
                    <option value="visible">Visibles</option>
                    <option value="hidden">Ocultos</option>
                  </select>
                  <button className="ghost" onClick={() => { setCoursesPage(1); void loadCourses(sessionToken); }}>
                    Buscar
                  </button>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Nombre</th>
                      <th>Nombre corto</th>
                      <th>Visible</th>
                      <th>Sincronizado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingCourses ? (
                      <tr>
                        <td colSpan={5}>Cargando cursos...</td>
                      </tr>
                    ) : (coursesData?.items.length ?? 0) === 0 ? (
                      <tr>
                        <td colSpan={5}>Sin cursos para este filtro.</td>
                      </tr>
                    ) : (
                      (coursesData?.items ?? []).map((course) => (
                        <tr key={course.moodle_course_id}>
                          <td>{course.moodle_course_id}</td>
                          <td>{course.full_name}</td>
                          <td>{course.short_name}</td>
                          <td>{course.visible ? 'sí' : 'no'}</td>
                          <td>{new Date(course.synced_at).toLocaleString()}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>

                <div className="pager">
                  <button
                    className="ghost"
                    onClick={() => setCoursesPage((page) => Math.max(1, page - 1))}
                    disabled={(coursesData?.pagination.page ?? 1) <= 1}
                  >
                    Anterior
                  </button>
                  <span>
                    Página {coursesData?.pagination.page ?? 1} / {coursesData?.pagination.totalPages ?? 1} | Total:{' '}
                    {coursesData?.pagination.total ?? 0}
                  </span>
                  <button
                    className="ghost"
                    onClick={() => setCoursesPage((page) => page + 1)}
                    disabled={(coursesData?.pagination.page ?? 1) >= (coursesData?.pagination.totalPages ?? 1)}
                  >
                    Siguiente
                  </button>
                </div>
              </article>
            </section>
          ) : null}

                    {activeSection === 'enterprise' ? (
            <CompaniesView 
              sessionToken={sessionToken} 
              setError={setError} 
              setInfo={setInfo} 
              currentUsers={usersData?.items || []} 
              loadUsers={loadUsers} 
              loadBase={loadBase} 
            />
          ) : null}

          {activeSection === 'sis' ? (
            <SisView sessionToken={sessionToken} setError={setError} setInfo={setInfo} />
          ) : null}

          {activeSection === 'crm' ? (
            <CrmView sessionToken={sessionToken} setError={setError} setInfo={setInfo} />
          ) : null}

          {activeSection === 'compliance' ? (
            <ComplianceView sessionToken={sessionToken} setError={setError} setInfo={setInfo} />
          ) : null}

          {activeSection === 'cie' ? (
            <CieChecklistView sessionToken={sessionToken} setError={setError} setInfo={setInfo} />
          ) : null}

          {activeSection === 'calendar' ? (
            <CalendarView sessionToken={sessionToken} setError={setError} setInfo={setInfo} />
          ) : null}

          {activeSection === 'backoffice' ? (
            <BackofficeView sessionToken={sessionToken} setError={setError} setInfo={setInfo} />
          ) : null}

          {activeSection === 'credentials' ? (
            <CredentialsView sessionToken={sessionToken} setError={setError} setInfo={setInfo} />
          ) : null}

          {activeSection === 'routes' ? (
            <section className="grid-1">
              <article className="card metric">
                <h2>Rutas registradas en el intermediador</h2>
                <span>
                  Total: {baseData.routes.count}. GET: {routeSummary.get}. POST: {routeSummary.post}. Otros:{' '}
                  {routeSummary.others}.
                </span>
              </article>
              <article className="card scroll-card">
                <table>
                  <thead>
                    <tr>
                      <th>Método</th>
                      <th>URL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {baseData.routes.routes.map((route) => (
                      <tr key={`${route.method}-${route.url}`}>
                        <td>{route.method}</td>
                        <td>{route.url}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </article>
            </section>
          ) : null}

          {activeSection === 'webinars' ? (
            <section className="grid-2">
              <article className="card">
                <h2>{editingWebinarId ? 'Editar seminario' : 'Crear seminario'}</h2>
                <form className="login-form" onSubmit={onSubmitWebinar}>
                  <label>Slug</label>
                  <input
                    value={webinarForm.slug}
                    onChange={(event) => setWebinarForm((current) => ({ ...current, slug: event.target.value }))}
                    placeholder="seminario-investigacion-marzo"
                    required
                  />
                  <label>Título</label>
                  <input
                    value={webinarForm.title}
                    onChange={(event) => setWebinarForm((current) => ({ ...current, title: event.target.value }))}
                    placeholder="Seminario en Vivo: Introducción a la Investigación"
                    required
                  />
                  <label>Subtítulo</label>
                  <input
                    value={webinarForm.subtitle}
                    onChange={(event) => setWebinarForm((current) => ({ ...current, subtitle: event.target.value }))}
                    placeholder="Masterclass mensual"
                  />
                  <label>Descripción</label>
                  <input
                    value={webinarForm.description}
                    onChange={(event) => setWebinarForm((current) => ({ ...current, description: event.target.value }))}
                    placeholder="Resumen del evento"
                  />
                  <label>Hero image URL</label>
                  <input
                    value={webinarForm.heroImage}
                    onChange={(event) => setWebinarForm((current) => ({ ...current, heroImage: event.target.value }))}
                    placeholder="https://..."
                    required
                  />
                  <label>Fuente</label>
                  <select
                    value={webinarForm.sourceType}
                    onChange={(event) =>
                      setWebinarForm((current) => ({
                        ...current,
                        sourceType: event.target.value as 'youtube' | 'external' | 'hls' | 'vimeo' | 'zoom'
                      }))
                    }
                  >
                    <option value="youtube">YouTube</option>
                    <option value="zoom">Zoom</option>
                    <option value="vimeo">Vimeo</option>
                    <option value="hls">HLS</option>
                    <option value="external">URL externa</option>
                  </select>
                  <label>URL live</label>
                  <input
                    value={webinarForm.sourceUrl}
                    onChange={(event) => setWebinarForm((current) => ({ ...current, sourceUrl: event.target.value }))}
                    placeholder="https://..."
                    required
                  />
                  <label>Reserva Free (opcional)</label>
                  <input
                    value={webinarForm.freeReservationUrl}
                    onChange={(event) =>
                      setWebinarForm((current) => ({ ...current, freeReservationUrl: event.target.value }))
                    }
                    placeholder="https://.../registro-free"
                  />
                  <label>Reserva VIP (opcional)</label>
                  <input
                    value={webinarForm.vipReservationUrl}
                    onChange={(event) =>
                      setWebinarForm((current) => ({ ...current, vipReservationUrl: event.target.value }))
                    }
                    placeholder="https://.../registro-vip"
                  />
                  <label>Multiplataforma (selecciona canales y URL por canal)</label>
                  <div className="webinar-links-builder">
                    {webinarPlatformOptions.map((platform) => {
                      const currentLink = webinarForm.webinarLinks.find((item) => item.platform === platform);
                      const checked = Boolean(currentLink);
                      return (
                        <div key={platform} className="webinar-link-row">
                          <label>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => {
                                const enabled = event.target.checked;
                                setWebinarForm((state) => {
                                  if (enabled) {
                                    if (state.webinarLinks.some((item) => item.platform === platform)) {
                                      return state;
                                    }
                                    return {
                                      ...state,
                                      webinarLinks: [...state.webinarLinks, { platform, url: '' }]
                                    };
                                  }
                                  return {
                                    ...state,
                                    webinarLinks: state.webinarLinks.filter((item) => item.platform !== platform)
                                  };
                                });
                              }}
                            />{' '}
                            {platform}
                          </label>
                          {checked ? (
                            <input
                              value={currentLink?.url ?? ''}
                              onChange={(event) => {
                                const value = event.target.value;
                                setWebinarForm((state) => ({
                                  ...state,
                                  webinarLinks: state.webinarLinks.map((item) =>
                                    item.platform === platform ? { ...item, url: value } : item
                                  )
                                }));
                              }}
                              placeholder={`URL para ${platform}`}
                            />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  <label>URL replay (opcional)</label>
                  <input
                    value={webinarForm.replayUrl}
                    onChange={(event) => setWebinarForm((current) => ({ ...current, replayUrl: event.target.value }))}
                    placeholder="https://..."
                  />
                  <label>Inicio</label>
                  <input
                    type="datetime-local"
                    value={webinarForm.startsAt}
                    onChange={(event) => setWebinarForm((current) => ({ ...current, startsAt: event.target.value }))}
                    required
                  />
                  <label>Fin</label>
                  <input
                    type="datetime-local"
                    value={webinarForm.endsAt}
                    onChange={(event) => setWebinarForm((current) => ({ ...current, endsAt: event.target.value }))}
                  />
                  <label>Timezone</label>
                  <input
                    value={webinarForm.timezone}
                    onChange={(event) => setWebinarForm((current) => ({ ...current, timezone: event.target.value }))}
                  />
                  <label>Texto CTA</label>
                  <input
                    value={webinarForm.ctaLabel}
                    onChange={(event) => setWebinarForm((current) => ({ ...current, ctaLabel: event.target.value }))}
                  />
                  <label>
                    <input
                      type="checkbox"
                      checked={webinarForm.isActive}
                      onChange={(event) => setWebinarForm((current) => ({ ...current, isActive: event.target.checked }))}
                    />{' '}
                    Seminario activo
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={webinarForm.showOnLanding}
                      onChange={(event) =>
                        setWebinarForm((current) => ({ ...current, showOnLanding: event.target.checked }))
                      }
                    />{' '}
                    Mostrar en landing pública
                  </label>
                  <button type="submit" disabled={creatingWebinar}>
                    {creatingWebinar ? 'Guardando seminario...' : editingWebinarId ? 'Guardar cambios' : 'Crear seminario'}
                  </button>
                  {editingWebinarId ? (
                    <button type="button" className="ghost" onClick={onCancelWebinarEdit}>
                      Cancelar edición
                    </button>
                  ) : null}
                </form>
              </article>

              <article className="card scroll-card">
                <h2>Seminarios configurados</h2>
                {loadingWebinars ? <p>Cargando seminarios...</p> : null}
                <table>
                  <thead>
                    <tr>
                      <th>Título</th>
                      <th>Inicio</th>
                      <th>Fuente</th>
                      <th>Activo</th>
                      <th>Landing</th>
                      <th>Canales</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {webinarsData.length === 0 ? (
                      <tr>
                        <td colSpan={7}>No hay seminarios creados.</td>
                      </tr>
                    ) : (
                      webinarsData.map((webinar) => (
                        <tr key={webinar.id}>
                          <td>{webinar.title}</td>
                          <td>{new Date(webinar.starts_at).toLocaleString()}</td>
                          <td>{webinar.source_type}</td>
                          <td>{webinar.is_active ? 'sí' : 'no'}</td>
                          <td>{webinar.show_on_landing ? 'sí' : 'no'}</td>
                          <td>{webinar.webinar_links?.length ?? 0}</td>
                          <td>
                            <button
                              className="ghost"
                              onClick={() => void onToggleWebinarFlag(webinar.id, { isActive: !webinar.is_active })}
                            >
                              {webinar.is_active ? 'Desactivar' : 'Activar'}
                            </button>
                            <button
                              className="ghost"
                              onClick={() =>
                                void onToggleWebinarFlag(webinar.id, {
                                  showOnLanding: !webinar.show_on_landing
                                })
                              }
                            >
                              {webinar.show_on_landing ? 'Ocultar landing' : 'Mostrar landing'}
                            </button>
                            <button className="ghost" onClick={() => onEditWebinar(webinar)}>
                              Editar
                            </button>
                            <button className="danger" onClick={() => void onDeleteWebinar(webinar.id)}>
                              Eliminar
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </article>
            </section>
          ) : null}

          {activeSection === 'podcasts' ? (
            <section className="grid-2">
              <article className="card">
                <h2>{editingPodcastId ? 'Editar podcast' : 'Crear podcast'}</h2>
                <form className="login-form" onSubmit={onSubmitPodcast}>
                  <label>Título</label>
                  <input
                    value={podcastForm.title}
                    onChange={(event) => setPodcastForm((current) => ({ ...current, title: event.target.value }))}
                    placeholder="Clase magistral: Introducción a la Economía"
                    required
                  />
                  <label>Video YouTube (URL o código)</label>
                  <input
                    value={podcastForm.video}
                    onChange={(event) => setPodcastForm((current) => ({ ...current, video: event.target.value }))}
                    placeholder="https://www.youtube.com/watch?v=... o dQw4w9WgXcQ"
                    required
                  />
                  <label>Fecha</label>
                  <input
                    type="datetime-local"
                    value={podcastForm.publishedAt}
                    onChange={(event) => setPodcastForm((current) => ({ ...current, publishedAt: event.target.value }))}
                    required
                  />
                  <label>Orden</label>
                  <input
                    type="number"
                    min={0}
                    max={999}
                    value={podcastForm.displayOrder}
                    onChange={(event) => setPodcastForm((current) => ({ ...current, displayOrder: event.target.value }))}
                  />
                  <label>
                    <input
                      type="checkbox"
                      checked={podcastForm.isActive}
                      onChange={(event) => setPodcastForm((current) => ({ ...current, isActive: event.target.checked }))}
                    />{' '}
                    Podcast activo
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={podcastForm.showOnLanding}
                      onChange={(event) =>
                        setPodcastForm((current) => ({ ...current, showOnLanding: event.target.checked }))
                      }
                    />{' '}
                    Mostrar en landing pública
                  </label>
                  <button type="submit" disabled={creatingPodcast}>
                    {creatingPodcast ? 'Guardando podcast...' : editingPodcastId ? 'Guardar cambios' : 'Crear podcast'}
                  </button>
                  {editingPodcastId ? (
                    <button type="button" className="ghost" onClick={onCancelPodcastEdit}>
                      Cancelar edición
                    </button>
                  ) : null}
                </form>
              </article>

              <article className="card scroll-card">
                <h2>Podcasts configurados</h2>
                {loadingPodcasts ? <p>Cargando podcasts...</p> : null}
                <table>
                  <thead>
                    <tr>
                      <th>Título</th>
                      <th>Fecha</th>
                      <th>Orden</th>
                      <th>Activo</th>
                      <th>Landing</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {podcastsData.length === 0 ? (
                      <tr>
                        <td colSpan={6}>No hay podcasts creados.</td>
                      </tr>
                    ) : (
                      podcastsData.map((podcast) => (
                        <tr key={podcast.id}>
                          <td>{podcast.title}</td>
                          <td>{new Date(podcast.published_at).toLocaleString()}</td>
                          <td>{podcast.display_order}</td>
                          <td>{podcast.is_active ? 'sí' : 'no'}</td>
                          <td>{podcast.show_on_landing ? 'sí' : 'no'}</td>
                          <td>
                            <button
                              className="ghost"
                              onClick={() => void onTogglePodcastFlag(podcast.id, { isActive: !podcast.is_active })}
                            >
                              {podcast.is_active ? 'Desactivar' : 'Activar'}
                            </button>
                            <button
                              className="ghost"
                              onClick={() =>
                                void onTogglePodcastFlag(podcast.id, {
                                  showOnLanding: !podcast.show_on_landing
                                })
                              }
                            >
                              {podcast.show_on_landing ? 'Ocultar landing' : 'Mostrar landing'}
                            </button>
                            <button className="ghost" onClick={() => onEditPodcast(podcast)}>
                              Editar
                            </button>
                            <button className="danger" onClick={() => void onDeletePodcast(podcast.id)}>
                              Eliminar
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </article>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
