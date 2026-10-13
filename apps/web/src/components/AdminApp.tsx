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
  type ProgramComposition,
  type UserCoursesResponse,
  type UserProgramEnrollment
} from '../lib/api';
import './styles.css';
// Tema claro del panel; se carga después para poder leerse como una capa.
import './admin-ui.css';
import { CompaniesView } from './admin/views/CompaniesView';
import { SisView } from './admin/views/SisView';
import { RegistrarView } from './admin/views/RegistrarView';
import { CrmView } from './admin/views/CrmView';
import { ComplianceView } from './admin/views/ComplianceView';
import { BackofficeView } from './admin/views/BackofficeView';
import { CredentialsView } from './admin/views/CredentialsView';
import { CieChecklistView } from './admin/views/CieChecklistView';
import { CalendarView } from './admin/views/CalendarView';
import RolesView from './admin/views/RolesView';
import OverviewView from './admin/views/OverviewView';
import ReportsView from './admin/views/ReportsView';
import ProgramsView from './admin/views/ProgramsView';
import { useTranslation } from 'react-i18next';
import { BRAND, BRAND_SHORT } from '../i18n';
import type { AdminIdentity, PermissionLevel } from '../lib/api';

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
  | 'registraduria'
  | 'programs'
  | 'crm'
  | 'compliance'
  | 'cie'
  | 'calendar'
  | 'backoffice'
  | 'credentials'
  | 'routes'
  | 'reports'
  | 'roles';

// La navegación del panel es datos, no dieciséis botones escritos a mano: el
// armazón recorre esta tabla para pintar la barra lateral y para resolver el
// título de la vista activa, así que añadir una sección es añadir una fila.
type NavItem = {
  id: PanelSection;
  label: string;
  hint: string;
  /**
   * Sección del servidor que gobierna esta entrada, cuando no coincide con su
   * `id`. Casi siempre coinciden, pero una vista puede consumir rutas que el
   * servidor ya protege bajo otra sección: entonces el permiso que decide si
   * se muestra tiene que ser el de ESA sección, o el menú ofrecería una
   * pantalla que el servidor responde con 403.
   */
  permiso?: string;
};
type NavGroup = { label: string; items: NavItem[] };

/**
 * La navegación es datos, no botones escritos a mano. Ahora además guarda
 * CLAVES de traducción en vez de texto: el panel lo usan personas que sólo
 * hablan inglés y personas que sólo hablan español, así que el rótulo se
 * resuelve al pintar, no al declarar.
 *
 * El `id` de cada entrada es además el identificador de sección que usa el
 * servidor para los permisos, así que esta tabla y la matriz de roles hablan
 * del mismo vocabulario sin necesidad de traducirlo entre capas.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    label: 'admin.nav.grupos.operacion',
    items: [
      { id: 'overview', label: 'admin.nav.overview.label', hint: 'admin.nav.overview.hint' },
      { id: 'reports', label: 'admin.nav.reports.label', hint: 'admin.nav.reports.hint' },
      // El programa va antes que los usuarios y que las aulas porque es la
      // unidad del modelo: es lo que se ofrece y en lo que se matricula. El
      // orden del menú es la primera cosa que enseña esa jerarquía.
      {
        id: 'programs',
        label: 'admin.nav.programs.label',
        hint: 'admin.nav.programs.hint',
        // `/admin/degree-programs` ya cuelga de `sis` en el catálogo del
        // servidor; no existe una sección 'programs' que pedirle.
        permiso: 'sis'
      },
      { id: 'users', label: 'admin.nav.users.label', hint: 'admin.nav.users.hint' },
      { id: 'enterprise', label: 'admin.nav.enterprise.label', hint: 'admin.nav.enterprise.hint' },
      // Las aulas de Moodle van al final: siguen existiendo como objeto
      // operativo (hay que sincronizarlas y vigilarlas), pero ya no son lo que
      // se ofrece, así que no abren el menú.
      { id: 'courses', label: 'admin.nav.courses.label', hint: 'admin.nav.courses.hint' }
    ]
  },
  {
    label: 'admin.nav.grupos.academico',
    items: [
      { id: 'sis', label: 'admin.nav.sis.label', hint: 'admin.nav.sis.hint' },
      // Registraduría es la sección desde la que se califica. Va pegada al SIS
      // porque escribe en la misma tabla de matrículas, pero tiene sección
      // propia en el catálogo del servidor: quien califica no tiene por qué
      // poder tocar facturas ni bloqueos.
      { id: 'registraduria', label: 'admin.nav.registraduria.label', hint: 'admin.nav.registraduria.hint' },
      { id: 'calendar', label: 'admin.nav.calendar.label', hint: 'admin.nav.calendar.hint' },
      { id: 'compliance', label: 'admin.nav.compliance.label', hint: 'admin.nav.compliance.hint' }
    ]
  },
  {
    label: 'admin.nav.grupos.admisiones',
    items: [{ id: 'crm', label: 'admin.nav.crm.label', hint: 'admin.nav.crm.hint' }]
  },
  {
    label: 'admin.nav.grupos.acreditacion',
    items: [
      { id: 'cie', label: 'admin.nav.cie.label', hint: 'admin.nav.cie.hint' },
      { id: 'credentials', label: 'admin.nav.credentials.label', hint: 'admin.nav.credentials.hint' }
    ]
  },
  {
    label: 'admin.nav.grupos.contenido',
    items: [
      { id: 'webinars', label: 'admin.nav.webinars.label', hint: 'admin.nav.webinars.hint' },
      { id: 'podcasts', label: 'admin.nav.podcasts.label', hint: 'admin.nav.podcasts.hint' }
    ]
  },
  {
    label: 'admin.nav.grupos.sistema',
    items: [
      { id: 'connections', label: 'admin.nav.connections.label', hint: 'admin.nav.connections.hint' },
      { id: 'integrations', label: 'admin.nav.integrations.label', hint: 'admin.nav.integrations.hint' },
      { id: 'backoffice', label: 'admin.nav.backoffice.label', hint: 'admin.nav.backoffice.hint' },
      { id: 'routes', label: 'admin.nav.routes.label', hint: 'admin.nav.routes.hint' },
      { id: 'roles', label: 'admin.nav.roles.label', hint: 'admin.nav.roles.hint' }
    ]
  }
];

const NAV_INDEX: Record<PanelSection, NavItem> = NAV_GROUPS.reduce(
  (acc, group) => {
    group.items.forEach((item) => {
      acc[item.id] = item;
    });
    return acc;
  },
  {} as Record<PanelSection, NavItem>
);

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

const ADMIN_SESSION_STORAGE = 'tfu-admin-session-token';
const PAGE_SIZE = 20;

export function AdminApp() {
  const [sessionToken, setSessionToken] = useState<string>(() => localStorage.getItem(ADMIN_SESSION_STORAGE) ?? '');
  const { t, i18n } = useTranslation();
  /**
   * Quién ha entrado y qué puede tocar. Mientras es null el panel no sabe
   * todavía sus permisos, así que la barra lateral no pinta secciones: es
   * preferible un instante de menú vacío a enseñar secciones que luego
   * desaparecen al llegar la respuesta.
   */
  const [identidad, setIdentidad] = useState<AdminIdentity | null>(null);
  // El campo arrancaba relleno con la cuenta de ejemplo de la plantilla, del
  // producto original: la pantalla de entrada del panel de TFU ofrecía un
  // correo de otra institución ya escrito. Arranca vacío.
  const [loginEmail, setLoginEmail] = useState('');
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
  const [selectedUserCourses, setSelectedUserCourses] = useState<UserCoursesResponse | null>(null);
  /**
   * Matrícula por programa.
   *
   * El programa es la unidad en la que se matricula el estudiante, así que el
   * desplegable guarda el CÓDIGO del programa y no un id de aula: es lo que
   * pide el endpoint y es lo que se lee en los avisos.
   */
  const [programaAMatricular, setProgramaAMatricular] = useState('');
  /** Composición de programas: de aquí salen los activos y sus aulas. */
  const [composicionProgramas, setComposicionProgramas] = useState<ProgramComposition[]>([]);
  /**
   * Si la composición no se pudo leer.
   *
   * Hace falta distinguirlo de «no hay programas»: una lista vacía por un 403
   * y una lista vacía porque la institución no tiene programas piden mensajes
   * distintos, y decir «crea un programa» a quien no tiene permiso para verlos
   * le manda a arreglar algo que no está roto.
   */
  const [composicionNoDisponible, setComposicionNoDisponible] = useState(false);
  /** Programas en los que ya está el usuario seleccionado. */
  const [programasDelUsuario, setProgramasDelUsuario] = useState<UserProgramEnrollment[] | null>(null);
  const [retirandoPrograma, setRetirandoPrograma] = useState<string | null>(null);
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

  /** Nivel que tiene la persona en una sección. */
  const nivelDe = (seccion: string): PermissionLevel => identidad?.permisos?.[seccion] ?? 'none';
  const puedeVer = (seccion: string) => nivelDe(seccion) !== 'none';
  const puedeEditar = (seccion: string) => nivelDe(seccion) === 'edit';

  /** La sección cuyo permiso manda sobre una entrada del menú. */
  const seccionDe = (item: NavItem) => item.permiso ?? item.id;

  /**
   * La barra lateral sólo muestra lo que la persona puede abrir, y los grupos
   * que se quedan sin entradas desaparecen enteros. Esto es presentación: el
   * servidor vuelve a comprobar cada permiso en cada petición, así que ocultar
   * aquí es comodidad, no la medida de seguridad.
   */
  const gruposVisibles = NAV_GROUPS.map((grupo) => ({
    ...grupo,
    items: grupo.items.filter((item) => puedeVer(seccionDe(item)))
  })).filter((grupo) => grupo.items.length > 0);

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

  /**
   * Programas que se pueden ofrecer para matricular: activos y con aulas.
   *
   * Un programa inactivo lo rechaza el servidor, y uno sin aulas devuelve 400.
   * Se filtran aquí los inactivos y se dejan los vacíos DENTRO de la lista,
   * pero deshabilitados: esconderlos haría que alguien buscara un programa que
   * sí existe y no entendiera por qué no aparece.
   */
  const programasActivos = useMemo(
    () => composicionProgramas.filter((programa) => programa.is_active),
    [composicionProgramas]
  );

  /** Los activos que de verdad tienen aulas; son los únicos elegibles. */
  const programasMatriculables = useMemo(
    () => programasActivos.filter((programa) => programa.courses.length > 0),
    [programasActivos]
  );

  /** Códigos de los activos sin aulas, para explicar por qué no se pueden elegir. */
  const programasActivosSinAulas = useMemo(
    () => programasActivos.filter((programa) => programa.courses.length === 0),
    [programasActivos]
  );

  /**
   * De aula de Moodle al programa que la contiene.
   *
   * Se construye en el cliente con la composición porque el listado de aulas no
   * trae el programa, y en todas partes donde se muestre un aula hay que poder
   * decir a qué programa pertenece — o que no pertenece a ninguno, que es
   * justamente lo que hay que vigilar. Se usan TODOS los programas y no sólo
   * los activos: un aula dentro de un programa archivado sí tiene programa.
   */
  const programaPorAula = useMemo(() => {
    const mapa = new Map<number, { codigo: string; nombre: string }>();
    for (const programa of composicionProgramas) {
      for (const curso of programa.courses) {
        mapa.set(curso.moodleCourseId, { codigo: programa.code, nombre: programa.name });
      }
    }
    return mapa;
  }, [composicionProgramas]);

  /** Etiqueta del programa de un aula; el texto de «sin programa» cuando no lo tiene. */
  const etiquetaProgramaDeAula = (moodleCourseId: number): string => {
    const programa = programaPorAula.get(moodleCourseId);
    return programa
      ? t('admin.shell.aulas.programaDe', { codigo: programa.codigo, nombre: programa.nombre })
      : t('admin.shell.aulas.sinPrograma');
  };

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
      const message = reason instanceof Error ? reason.message : t('admin.shell.errores.cargarBase');
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
      setError(reason instanceof Error ? reason.message : t('admin.shell.errores.cargarUsuarios'));
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
      setError(reason instanceof Error ? reason.message : t('admin.shell.errores.cargarCursos'));
    } finally {
      setLoadingCourses(false);
    }
  };


  /**
   * Catálogo de programas con sus aulas.
   *
   * Se pide la composición y no `degreePrograms` porque el formulario de
   * matrícula necesita saber cuántas aulas tiene cada programa: un programa
   * vacío no se puede ofrecer y hay que poder decir por qué.
   */
  const cargarComposicionProgramas = async (token: string) => {
    try {
      const respuesta = await api.admin.programComposition(token);
      setComposicionProgramas(respuesta.programs);
      setComposicionNoDisponible(false);
    } catch {
      // Un rol con acceso a usuarios puede no tenerlo a programas académicos.
      // Si falla, el desplegable sale vacío con su aviso y el resto sigue.
      setComposicionProgramas([]);
      setComposicionNoDisponible(true);
    }
  };

  /** Programas del usuario seleccionado, para la tabla de matrículas vigentes. */
  const cargarProgramasDelUsuario = async (token: string, userId: string) => {
    try {
      const respuesta = await api.admin.userProgramEnrollments(token, userId);
      setProgramasDelUsuario(respuesta.programs);
    } catch (reason) {
      setProgramasDelUsuario(null);
      setError(reason instanceof Error ? reason.message : t('admin.shell.matricula.errorProgramasUsuario'));
    }
  };

  const loadWebinars = async (token: string) => {
    setLoadingWebinars(true);
    try {
      const response = await api.admin.webinars(token);
      setWebinarsData(response);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.shell.errores.cargarWebinars'));
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
      setError(reason instanceof Error ? reason.message : t('admin.shell.errores.cargarPodcasts'));
    } finally {
      setLoadingPodcasts(false);
    }
  };


  useEffect(() => {
    if (!isLoggedIn) {
      return;
    }

    const bootstrap = async () => {
      // Sólo /admin/auth/me decide si la sesión vale. Antes se cargaban aquí
      // los datos de media docena de secciones dentro del mismo try, así que
      // un 403 en CUALQUIERA de ellas cerraba la sesión. Con permisos por rol
      // eso dejaba fuera a todo el que no fuera superadministrador: la persona
      // de contenido entraba y salía despedida porque no puede leer usuarios.
      let sesion;
      try {
        sesion = await api.admin.me(sessionToken);
      } catch {
        onLogout();
        return;
      }

      setIdentidad(sesion.admin);
      // El panel arranca en el idioma de la persona, no en el del navegador.
      if (sesion.admin?.locale) {
        void i18n.changeLanguage(sesion.admin.locale);
      }

      // Cada carga va por su cuenta y se traga su propio fallo: lo que no se
      // pueda leer simplemente no se pinta, y la sesión sigue en pie.
      const permisos = sesion.admin?.permisos ?? {};
      const siPuede = (seccion: string, fn: () => Promise<unknown>) =>
        permisos[seccion] && permisos[seccion] !== 'none'
          ? fn().catch(() => undefined)
          : Promise.resolve();

      await Promise.all([
        siPuede('overview', () => loadBase(sessionToken)),
        siPuede('users', () => loadUsers(sessionToken)),
        siPuede('courses', () => loadCourses(sessionToken)),
        // La composición alimenta la matrícula por programa de la sección de
        // usuarios, así que se pide con el permiso de 'sis', que es el que
        // protege `/admin/degree-programs` en el servidor.
        siPuede('sis', () => cargarComposicionProgramas(sessionToken)),
        siPuede('webinars', () => loadWebinars(sessionToken)),
        siPuede('podcasts', () => loadPodcasts(sessionToken))
      ]);
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
      setIdentidad(session.admin);
      setLoginPassword('');
      setInfo(t('admin.sesion.iniciada', { fecha: new Date(session.expiresAt).toLocaleString() }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.sesion.errorEntrar'));
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
    setProgramaAMatricular('');
    setComposicionProgramas([]);
    setComposicionNoDisponible(false);
    setProgramasDelUsuario(null);
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
      // La composición entra en el refresco general porque de ella sale la
      // columna de programa de la tabla de aulas: refrescar las aulas sin ella
      // dejaría el programa de una aula recién asignada en «sin programa».
      cargarComposicionProgramas(sessionToken),
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
        setInfo(t('admin.shell.webinars.actualizado', { titulo: updated.webinar.title }));
      } else {
        const created = await api.admin.createWebinar(sessionToken, payload);
        setInfo(t('admin.shell.webinars.creado', { titulo: created.webinar.title }));
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
      setError(reason instanceof Error ? reason.message : t('admin.shell.webinars.errorGuardar'));
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
        t('admin.shell.webinars.flagActualizado', {
          titulo: response.webinar.title,
          activo: response.webinar.is_active ? t('admin.shell.comun.si') : t('admin.shell.comun.no'),
          landing: response.webinar.show_on_landing ? t('admin.shell.comun.si') : t('admin.shell.comun.no')
        })
      );
      await Promise.all([loadWebinars(sessionToken), loadBase(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.shell.webinars.errorActualizar'));
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
      setInfo(t('admin.shell.webinars.eliminado'));
      await Promise.all([loadWebinars(sessionToken), loadBase(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.shell.webinars.errorEliminar'));
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
        setInfo(t('admin.shell.podcasts.actualizado', { titulo: updated.podcast.title }));
      } else {
        const created = await api.admin.createPodcast(sessionToken, payload);
        setInfo(t('admin.shell.podcasts.creado', { titulo: created.podcast.title }));
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
      setError(reason instanceof Error ? reason.message : t('admin.shell.podcasts.errorGuardar'));
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
        t('admin.shell.podcasts.flagActualizado', {
          titulo: response.podcast.title,
          activo: response.podcast.is_active ? t('admin.shell.comun.si') : t('admin.shell.comun.no'),
          landing: response.podcast.show_on_landing ? t('admin.shell.comun.si') : t('admin.shell.comun.no')
        })
      );
      await Promise.all([loadPodcasts(sessionToken), loadBase(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.shell.podcasts.errorActualizar'));
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
      setInfo(t('admin.shell.podcasts.eliminado'));
      await Promise.all([loadPodcasts(sessionToken), loadBase(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.shell.podcasts.errorEliminar'));
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
        setInfo(result.error ?? t('admin.shell.sync.falloCursos'));
      } else {
        setInfo(
          t('admin.shell.sync.cursosOk', {
            total: result.totalCourses ?? 0,
            catalogo: result.upsertedCatalogAssets ?? 0
          })
        );
      }
      await Promise.all([loadBase(sessionToken), loadCourses(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.shell.sync.errorCursos'));
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
      setError(t('admin.shell.conexiones.faltaUrl'));
      return;
    }
    if (!moodleConnectionForm.token.trim() && !baseData?.config.moodle.tokenSet) {
      setError(t('admin.shell.conexiones.faltaToken'));
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
      setInfo(t('admin.shell.conexiones.guardada', { url: result.baseUrl }));
      setMoodleConnectionForm((current) => ({ ...current, token: '' }));
      await Promise.all([loadBase(sessionToken), loadCourses(sessionToken), loadUsers(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.shell.conexiones.errorGuardar'));
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
        t('admin.shell.sync.categoriasOk', {
          total: result.totalCategories,
          actualizadas: result.upsertedCategories,
          origen: result.source ? ` (${result.source})` : ''
        })
      );
      await Promise.all([loadBase(sessionToken), loadCourses(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.shell.sync.errorCategorias'));
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
        t('admin.shell.sync.usuariosOk', {
          total: result.totalUsers,
          actualizados: result.upsertedUsers,
          matriculas: result.enrollmentLinks
        })
      );
      await Promise.all([loadBase(sessionToken), loadUsers(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.shell.sync.errorUsuarios'));
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
        t('admin.shell.sync.completoOk', {
          categorias: result.categories.upsertedCategories,
          cursos: result.courses.upsertedCourses ?? 0,
          usuarios: result.users.upsertedUsers
        })
      );
      await Promise.all([loadBase(sessionToken), loadCourses(sessionToken), loadUsers(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.shell.sync.errorCompleto'));
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

      setInfo(
        t('admin.shell.usuarios.creado', {
          nombre: response.user.full_name,
          clave: response.temporaryPassword
        })
      );
      setNewUser({ fullName: '', email: '', locale: 'es' });
      await Promise.all([loadBase(sessionToken), loadUsers(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.shell.usuarios.errorCrear'));
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
      setError(reason instanceof Error ? reason.message : t('admin.shell.usuarios.errorCursos'));
    }
  };

  /**
   * Matricula al usuario en un programa entero.
   *
   * No hay matrícula por aula en el panel: el programa es la unidad que se
   * ofrece y en la que se matricula el estudiante, y el endpoint se encarga de
   * meterlo en todas sus aulas. El resultado puede ser parcial, así que el
   * aviso distingue los tres casos (todo, a medias, nada) en vez de dar un
   * «matriculado» que esconda aulas sin entrar.
   */
  const onMatricularEnPrograma = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionToken || !selectedUserId || !programaAMatricular) {
      return;
    }

    setEnrollingUser(true);
    setError(null);
    setInfo(null);

    try {
      const resultado = await api.admin.enrollUserInProgram(sessionToken, selectedUserId, {
        programCode: programaAMatricular
      });

      const fallidas = resultado.coursesFailed;
      if (fallidas.length === 0) {
        setInfo(
          t('admin.shell.matricula.okPrograma', {
            programa: resultado.programName,
            aulas: resultado.coursesEnrolled.length
          })
        );
      } else {
        // Un parcial se cuenta como error y no como aviso: hay aulas que
        // alguien tiene que reparar, y los ids son lo único que permite
        // encontrarlas.
        setError(
          t('admin.shell.matricula.parcialPrograma', {
            programa: resultado.programName,
            aulas: resultado.coursesEnrolled.length,
            fallidas: fallidas.length,
            ids: fallidas.map((fallo) => fallo.moodleCourseId).join(', ')
          })
        );
      }

      await Promise.all([loadBase(sessionToken), loadUsers(sessionToken)]);
      await Promise.all([
        onLoadUserCourses(selectedUserId),
        cargarProgramasDelUsuario(sessionToken, selectedUserId)
      ]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.shell.matricula.errorPrograma'));
    } finally {
      setEnrollingUser(false);
    }
  };

  /**
   * Retira al usuario de todas las aulas de un programa.
   *
   * Se confirma antes porque toca varias aulas de golpe y el estudiante pierde
   * el acceso a todas ellas: no es una acción que convenga disparar por un
   * clic mal puesto.
   */
  const onRetirarDePrograma = async (codigo: string, nombre: string) => {
    if (!sessionToken || !selectedUserId) {
      return;
    }
    if (!window.confirm(t('admin.shell.matricula.confirmarRetiro', { programa: nombre }))) {
      return;
    }

    setRetirandoPrograma(codigo);
    setError(null);
    setInfo(null);

    try {
      const resultado = await api.admin.unenrollUserFromProgram(sessionToken, selectedUserId, codigo);
      if (resultado.coursesFailed.length === 0) {
        setInfo(t('admin.shell.matricula.retiroOk', { programa: nombre }));
      } else {
        setError(
          t('admin.shell.matricula.retiroParcial', {
            programa: nombre,
            fallidas: resultado.coursesFailed.length,
            ids: resultado.coursesFailed.map((fallo) => fallo.moodleCourseId).join(', ')
          })
        );
      }
      await Promise.all([loadBase(sessionToken), loadUsers(sessionToken)]);
      await Promise.all([
        onLoadUserCourses(selectedUserId),
        cargarProgramasDelUsuario(sessionToken, selectedUserId)
      ]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.shell.matricula.errorRetiro'));
    } finally {
      setRetirandoPrograma(null);
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
      setInfo(
        status === 'inactive'
          ? t('admin.shell.usuarios.desactivado')
          : t('admin.shell.usuarios.activado')
      );
      await Promise.all([loadBase(sessionToken), loadUsers(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.shell.usuarios.errorEstado'));
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
        t(
          status === 'inactive'
            ? 'admin.shell.usuarios.masivoDesactivados'
            : 'admin.shell.usuarios.masivoActivados',
          {
            procesados: response.processed,
            solicitados: response.requested,
            fallos: response.failures.length
          }
        )
      );
      setSelectedUserIds([]);
      await Promise.all([loadBase(sessionToken), loadUsers(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.shell.usuarios.errorMasivo'));
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
          {/* El selector de idioma va también aquí: si alguien no entiende la
              pantalla de acceso, no llega nunca al de dentro. */}
          <div className="admin-idioma" role="group" aria-label={t('admin.idioma.aria')}>
            {(['es', 'en'] as const).map((lng) => (
              <button
                key={lng}
                type="button"
                className={`admin-idioma-btn${i18n.language?.startsWith(lng) ? ' active' : ''}`}
                aria-pressed={i18n.language?.startsWith(lng)}
                onClick={() => void i18n.changeLanguage(lng)}
              >
                {lng.toUpperCase()}
              </button>
            ))}
          </div>
          <p className="eyebrow">{t('admin.sesion.eyebrow')}</p>
          <h1>{t('admin.sesion.titulo')}</h1>
          <p>{t('admin.sesion.intro')}</p>
          <form onSubmit={onLogin} className="login-form">
            <label htmlFor="admin-email">{t('admin.sesion.correo')}</label>
            <input
              id="admin-email"
              type="email"
              value={loginEmail}
              onChange={(event) => setLoginEmail(event.target.value)}
              placeholder="nombre@thefloridianuniversity.com"
              required
            />
            <label htmlFor="admin-password">{t('admin.sesion.contrasena')}</label>
            <input
              id="admin-password"
              type="password"
              value={loginPassword}
              onChange={(event) => setLoginPassword(event.target.value)}
              placeholder="******"
              required
            />
            <button type="submit">{t('admin.sesion.entrar')}</button>
          </form>
          {error ? <p className="error-msg">{error}</p> : null}
        </section>
      </main>
    );
  }

  const currentNav = NAV_INDEX[activeSection];

  return (
    <div className="admin-shell admin-layout">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span className="admin-brand-mark" aria-hidden="true">
            {BRAND_SHORT}
          </span>
          <span className="admin-brand-text">
            <strong>{BRAND}</strong>
            {t('admin.subtitulo')}
          </span>
        </div>

        <nav className="admin-nav" aria-label={t('admin.nav.aria')}>
          {gruposVisibles.map((group) => (
            <div className="admin-nav-group" key={group.label}>
              <p className="admin-nav-group-label">{t(group.label)}</p>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`admin-nav-item${activeSection === item.id ? ' active' : ''}`}
                  aria-current={activeSection === item.id ? 'page' : undefined}
                  onClick={() => setActiveSection(item.id)}
                >
                  <span className="admin-nav-item-label">{t(item.label)}</span>
                  {nivelDe(seccionDe(item)) === 'view' ? (
                    <span className="admin-nav-solo-lectura" title={t('admin.nav.soloLecturaTitulo')}>
                      {t('admin.nav.soloLectura')}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="admin-sidebar-foot">
          {identidad ? (
            <div className="admin-quien">
              {/* La cuenta del .env no tiene nombre de persona: el servidor manda
                  una etiqueta fija, y el rótulo lo pone el panel en su idioma. */}
              <strong>{identidad.isBootstrap ? t('admin.cuentaArranque') : identidad.fullName}</strong>
              <span>{i18n.language === 'en' ? identidad.role.nameEn : identidad.role.nameEs}</span>
            </div>
          ) : null}
          <button type="button" className="admin-nav-item logout" onClick={onLogout}>
            {t('admin.sesion.salir')}
          </button>
        </div>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <div className="admin-topbar-title">
            <h1>{currentNav ? t(currentNav.label) : t('admin.tituloPanel')}</h1>
            {currentNav?.hint ? <p>{t(currentNav.hint)}</p> : null}
          </div>
          <div className="admin-topbar-actions">
            {/* El selector es de dos botones y no un desplegable a propósito:
                con sólo dos idiomas, un desplegable esconde la opción detrás
                de un clic de más, y quien no entiende la interfaz es
                justamente quien necesita encontrarlo rápido. */}
            <div className="admin-idioma" role="group" aria-label={t('admin.idioma.aria')}>
              {(['es', 'en'] as const).map((lng) => (
                <button
                  key={lng}
                  type="button"
                  className={`admin-idioma-btn${i18n.language?.startsWith(lng) ? ' active' : ''}`}
                  aria-pressed={i18n.language?.startsWith(lng)}
                  onClick={() => void i18n.changeLanguage(lng)}
                >
                  {lng.toUpperCase()}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="ghost"
              onClick={() => void onSyncMoodleAll()}
              disabled={syncingMoodleAll || syncingMoodleCourses || syncingMoodleCategories || syncingMoodleUsers}
            >
              {syncingMoodleAll ? t('admin.shell.topbar.sincronizando') : t('admin.shell.topbar.syncMoodle')}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => void refreshAll()}
              disabled={loadingBase || loadingUsers || loadingCourses || loadingWebinars || loadingPodcasts}
            >
              {loadingBase || loadingUsers || loadingCourses || loadingWebinars || loadingPodcasts
                ? t('admin.shell.topbar.actualizando')
                : t('admin.shell.topbar.actualizar')}
            </button>
          </div>
        </header>

      <div className="admin-content">

      {/* Es el único canal de avisos del armazón: por aquí sale, entre otras
          cosas, el parcial de una matrícula por programa. Sin `role`, un lector
          de pantalla no anuncia nada y quien no ve la pantalla se queda
          creyendo que la acción salió bien. */}
      {error ? (
        <p className="error-msg" role="alert">
          {error}
        </p>
      ) : null}
      {info ? (
        <p className="info-msg" role="status">
          {info}
        </p>
      ) : null}

      {!baseData ? (
        <section className="status-card">{t('admin.shell.comun.cargandoPanel')}</section>
      ) : (
        <>
          {activeSection === 'overview' ? (
            <OverviewView token={sessionToken} locale={i18n.language?.startsWith('en') ? 'en' : 'es'} />
          ) : null}

          {activeSection === 'connections' ? (
            <section className="grid-2">
              <article className="card">
                <h2>{t('admin.shell.conexiones.estadoTitulo')}</h2>
                <ul className="clean-list">
                  <li>
                    {t('admin.shell.conexiones.db', {
                      valor: baseData.status.db.connected
                        ? t('admin.shell.comun.si')
                        : t('admin.shell.comun.no')
                    })}
                  </li>
                  <li>
                    {t('admin.shell.conexiones.moodleConfigurado', {
                      valor: baseData.status.moodle.configured
                        ? t('admin.shell.comun.si')
                        : t('admin.shell.comun.no')
                    })}
                  </li>
                  <li>
                    {t('admin.shell.conexiones.moodleConectado', {
                      valor: baseData.status.moodle.connected
                        ? t('admin.shell.comun.si')
                        : t('admin.shell.comun.no')
                    })}
                  </li>
                  <li>
                    {t('admin.shell.conexiones.ultimoSyncCursos', {
                      fecha: baseData.status.moodle.lastCoursesSync?.syncedAt
                        ? new Date(baseData.status.moodle.lastCoursesSync.syncedAt).toLocaleString()
                        : t('admin.shell.comun.nunca')
                    })}
                  </li>
                  <li>
                    {t('admin.shell.conexiones.ultimoSyncUsuarios', {
                      fecha: baseData.status.moodle.lastUsersSync?.syncedAt
                        ? new Date(baseData.status.moodle.lastUsersSync.syncedAt).toLocaleString()
                        : t('admin.shell.comun.nunca')
                    })}
                  </li>
                  <li>
                    {t('admin.shell.conexiones.ultimoSyncCategorias', {
                      fecha: baseData.status.moodle.lastCategoriesSync?.syncedAt
                        ? new Date(baseData.status.moodle.lastCategoriesSync.syncedAt).toLocaleString()
                        : t('admin.shell.comun.nunca')
                    })}
                  </li>
                  <li>
                    {t('admin.shell.conexiones.api', {
                      host: baseData.config.server.host,
                      puerto: baseData.config.server.port
                    })}
                  </li>
                  <li>
                    {t('admin.shell.conexiones.moodleUrl', {
                      url: baseData.config.moodle.baseUrl ?? t('admin.shell.comun.noConfigurado')
                    })}
                  </li>
                </ul>
              </article>

              <article className="card">
                <h2>{t('admin.shell.conexiones.configTitulo')}</h2>
                <form className="login-form" onSubmit={onSaveMoodleConnection}>
                  <label htmlFor="moodle-base-url">{t('admin.shell.conexiones.campoUrl')}</label>
                  <input
                    id="moodle-base-url"
                    value={moodleConnectionForm.baseUrl}
                    onChange={(event) =>
                      setMoodleConnectionForm((current) => ({ ...current, baseUrl: event.target.value }))
                    }
                    placeholder="https://lms.portal.thefloridianuniversity.com"
                    required
                  />
                  <label htmlFor="moodle-token">{t('admin.shell.conexiones.campoToken')}</label>
                  <input
                    id="moodle-token"
                    type="password"
                    value={moodleConnectionForm.token}
                    onChange={(event) =>
                      setMoodleConnectionForm((current) => ({ ...current, token: event.target.value }))
                    }
                    placeholder={
                      baseData.config.moodle.tokenSet
                        ? t('admin.shell.conexiones.tokenGuardado')
                        : t('admin.shell.conexiones.tokenPlaceholder')
                    }
                    required={!baseData.config.moodle.tokenSet}
                  />
                  <button type="submit" disabled={savingMoodleConfig}>
                    {savingMoodleConfig ? t('admin.shell.comun.guardando') : t('admin.shell.conexiones.guardar')}
                  </button>
                </form>
              </article>

              <article className="card scroll-card">
                <h2>{t('admin.shell.tenants.titulo')}</h2>
                <table>
                  <thead>
                    <tr>
                      <th>{t('admin.shell.tenants.colNombre')}</th>
                      <th>{t('admin.shell.tenants.colSlug')}</th>
                      <th>{t('admin.shell.tenants.colLocales')}</th>
                      <th>{t('admin.shell.tenants.colMoneda')}</th>
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
              {/* La rejilla pasó a una columna: la matrícula ya no es un
                  formulario de dos campos al lado del de crear, sino una
                  tarjeta propia con la tabla de programas vigentes debajo. */}
              <section className="grid-1">
                <article className="card">
                  <h2>{t('admin.shell.usuarios.crearTitulo')}</h2>
                  <form className="login-form" onSubmit={onCreateUser}>
                    <label htmlFor="fullName">{t('admin.shell.usuarios.campoNombre')}</label>
                    <input
                      id="fullName"
                      value={newUser.fullName}
                      onChange={(event) => setNewUser((current) => ({ ...current, fullName: event.target.value }))}
                      placeholder={t('admin.shell.usuarios.campoNombrePlaceholder')}
                      required
                    />
                    <label htmlFor="email">{t('admin.shell.usuarios.campoEmail')}</label>
                    <input
                      id="email"
                      type="email"
                      value={newUser.email}
                      onChange={(event) => setNewUser((current) => ({ ...current, email: event.target.value }))}
                      placeholder="nombre@thefloridianuniversity.com"
                      required
                    />
                    <label htmlFor="locale">{t('admin.shell.usuarios.campoIdioma')}</label>
                    <input
                      id="locale"
                      value={newUser.locale}
                      onChange={(event) => setNewUser((current) => ({ ...current, locale: event.target.value }))}
                      placeholder="es"
                      required
                    />
                    <button type="submit" disabled={creatingUser}>
                      {creatingUser ? t('admin.shell.usuarios.creando') : t('admin.shell.usuarios.crear')}
                    </button>
                  </form>
                </article>

              </section>

              {/* ------------------------------------------------------------ *
                * Matrícula por PROGRAMA.
                *
                * El programa es la unidad: nadie se matricula en un aula suelta.
                * Este formulario elige persona + programa y el servidor la mete
                * en todas las aulas que el programa contenga.
                * ------------------------------------------------------------ */}
              <section className="grid-1">
                <div className="ad-card">
                  <div className="ad-card-head">
                    <h2>{t('admin.shell.matricula.titulo')}</h2>
                    <p>{t('admin.shell.matricula.descripcion')}</p>
                  </div>
                  <div className="ad-card-body">
                    <form onSubmit={onMatricularEnPrograma}>
                      <div className="ad-grid ad-grid-2">
                        <div className="ad-field">
                          <label htmlFor="matricula-usuario">{t('admin.shell.matricula.campoUsuario')}</label>
                          <select
                            id="matricula-usuario"
                            className="ad-select"
                            value={selectedUserId}
                            onChange={(event) => {
                              const id = event.target.value;
                              setSelectedUserId(id);
                              // Al cambiar de persona lo de la anterior ya no
                              // vale: se limpia y se vuelve a pedir, para que
                              // nadie lea las matrículas de otro usuario.
                              setProgramasDelUsuario(null);
                              setSelectedUserCourses(null);
                              if (id) {
                                void cargarProgramasDelUsuario(sessionToken, id);
                                void onLoadUserCourses(id);
                              }
                            }}
                          >
                            <option value="">{t('admin.shell.matricula.eligeUsuario')}</option>
                            {currentUsers
                              .filter((user) => user.moodle_user_id)
                              .map((user) => (
                                <option key={user.id} value={user.id}>
                                  {user.full_name} ({user.email})
                                </option>
                              ))}
                          </select>
                        </div>

                        <div className="ad-field">
                          <label htmlFor="matricula-programa">{t('admin.shell.matricula.campoPrograma')}</label>
                          <select
                            id="matricula-programa"
                            className="ad-select"
                            value={programaAMatricular}
                            onChange={(event) => setProgramaAMatricular(event.target.value)}
                          >
                            <option value="">{t('admin.shell.matricula.eligePrograma')}</option>
                            {programasMatriculables.map((programa) => (
                              <option key={programa.id} value={programa.code}>
                                {t('admin.shell.matricula.opcionPrograma', {
                                  codigo: programa.code,
                                  nombre: programa.name,
                                  aulas: programa.courses.length
                                })}
                              </option>
                            ))}
                            {/* Los activos sin aulas se enseñan pero no se
                                pueden elegir: el servidor devolvería 400 y el
                                desplegable explica el porqué sin gastar viaje. */}
                            {programasActivosSinAulas.map((programa) => (
                              <option key={programa.id} value={programa.code} disabled>
                                {t('admin.shell.matricula.opcionProgramaVacio', {
                                  codigo: programa.code,
                                  nombre: programa.name
                                })}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="ad-toolbar">
                        <button
                          type="submit"
                          className="ad-btn ad-btn-primary"
                          disabled={enrollingUser || !selectedUserId || !programaAMatricular}
                        >
                          {enrollingUser
                            ? t('admin.shell.matricula.matriculando')
                            : t('admin.shell.matricula.matricular')}
                        </button>
                      </div>
                    </form>

                    {composicionNoDisponible ? (
                      <p className="ad-note" role="alert">
                        {t('admin.shell.matricula.programasNoDisponibles')}
                      </p>
                    ) : programasActivos.length === 0 ? (
                      <p className="ad-empty">{t('admin.shell.matricula.sinProgramasActivos')}</p>
                    ) : null}
                    {programasActivosSinAulas.length > 0 ? (
                      <p className="ad-note">
                        {t('admin.shell.matricula.avisoProgramasVacios', {
                          count: programasActivosSinAulas.length,
                          programas: programasActivosSinAulas.map((programa) => programa.code).join(', ')
                        })}
                      </p>
                    ) : null}
                    <p className="ad-note">{t('admin.shell.matricula.notaUnidad')}</p>
                  </div>
                </div>
              </section>

              {/* Matrículas vigentes del usuario elegido, por programa. */}
              <section className="grid-1">
                <div className="ad-card">
                  <div className="ad-card-head">
                    <h2>{t('admin.shell.matricula.vigentesTitulo')}</h2>
                    <p>{t('admin.shell.matricula.vigentesDescripcion')}</p>
                  </div>
                  <div className="ad-card-body">
                    {!selectedUserId ? (
                      <p className="ad-empty">{t('admin.shell.matricula.vigentesSinSeleccion')}</p>
                    ) : programasDelUsuario === null ? (
                      <p className="ad-empty">{t('admin.shell.matricula.vigentesCargando')}</p>
                    ) : programasDelUsuario.length === 0 ? (
                      <p className="ad-empty">{t('admin.shell.matricula.vigentesVacio')}</p>
                    ) : (
                      <div className="ad-table-wrap">
                        <table className="ad-table">
                          <thead>
                            <tr>
                              <th scope="col">{t('admin.shell.matricula.colCodigo')}</th>
                              <th scope="col">{t('admin.shell.matricula.colPrograma')}</th>
                              <th scope="col">{t('admin.shell.matricula.colAulas')}</th>
                              <th scope="col">{t('admin.shell.matricula.colCompleta')}</th>
                              <th scope="col">{t('admin.shell.usuarios.colAcciones')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {programasDelUsuario.map((programa) => (
                              <tr key={programa.code}>
                                <th scope="row">{programa.code}</th>
                                <td>{programa.name}</td>
                                <td>
                                  {t('admin.shell.matricula.aulasDe', {
                                    activas: programa.coursesActive,
                                    total: programa.coursesInProgram
                                  })}
                                </td>
                                <td>
                                  <span
                                    className={`ad-semaforo ad-semaforo-${programa.complete ? 'ok' : 'warn'}`}
                                    aria-hidden="true"
                                  />
                                  <span className={`ad-badge ad-badge-${programa.complete ? 'ok' : 'warn'}`}>
                                    {programa.complete
                                      ? t('admin.shell.matricula.completa')
                                      : t('admin.shell.matricula.incompleta')}
                                  </span>
                                </td>
                                <td>
                                  <button
                                    type="button"
                                    className="ad-btn ad-btn-danger"
                                    disabled={retirandoPrograma !== null}
                                    onClick={() => void onRetirarDePrograma(programa.code, programa.name)}
                                  >
                                    {retirandoPrograma === programa.code
                                      ? t('admin.shell.matricula.retirando')
                                      : t('admin.shell.matricula.retirar')}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {programasDelUsuario?.some((programa) => !programa.complete) ? (
                      <p className="ad-note" role="alert">
                        {t('admin.shell.matricula.avisoIncompletas')}
                      </p>
                    ) : null}
                  </div>
                </div>
              </section>

              <section className="grid-1">
                <article className="card">
                  <h2>{t('admin.shell.usuarios.listaTitulo')}</h2>
                  <div className="toolbar-grid">
                    <input
                      value={usersQuery}
                      onChange={(event) => setUsersQuery(event.target.value)}
                      placeholder={t('admin.shell.usuarios.buscarPlaceholder')}
                    />
                    <select
                      value={usersStatusFilter}
                      onChange={(event) => {
                        setUsersStatusFilter(event.target.value as 'all' | 'active' | 'inactive');
                        setUsersPage(1);
                      }}
                    >
                      <option value="all">{t('admin.shell.comun.todos')}</option>
                      <option value="active">{t('admin.shell.usuarios.filtroActivos')}</option>
                      <option value="inactive">{t('admin.shell.usuarios.filtroInactivos')}</option>
                    </select>
                    <button className="ghost" onClick={() => { setUsersPage(1); void loadUsers(sessionToken); }}>
                      {t('admin.shell.comun.buscar')}
                    </button>
                  </div>
                  <div className="inline-actions">
                    <button className="ghost" onClick={toggleSelectCurrentPage}>
                      {allCurrentPageSelected
                        ? t('admin.shell.usuarios.deseleccionarPagina')
                        : t('admin.shell.usuarios.seleccionarPagina')}
                    </button>
                    <button className="danger" disabled={selectedUserIds.length === 0} onClick={() => void updateBulkUsersStatus('inactive')}>
                      {t('admin.shell.usuarios.desactivarSeleccionados')}
                    </button>
                    <button className="ghost" disabled={selectedUserIds.length === 0} onClick={() => void updateBulkUsersStatus('active')}>
                      {t('admin.shell.usuarios.activarSeleccionados')}
                    </button>
                  </div>

                  <table>
                    <thead>
                      <tr>
                        {/* La de la casilla no rotula ninguna columna de datos,
                            así que no lleva `scope`: sólo las que de verdad
                            encabezan una columna. */}
                        <th></th>
                        <th scope="col">{t('admin.shell.usuarios.colNombre')}</th>
                        <th scope="col">{t('admin.shell.usuarios.colEmail')}</th>
                        <th scope="col">{t('admin.shell.usuarios.colEstado')}</th>
                        <th scope="col">{t('admin.shell.usuarios.colMoodleId')}</th>
                        <th scope="col">{t('admin.shell.usuarios.colAulas')}</th>
                        <th scope="col">{t('admin.shell.usuarios.colProgramas')}</th>
                        <th scope="col">{t('admin.shell.usuarios.colAcciones')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loadingUsers ? (
                        <tr>
                          <td colSpan={8}>{t('admin.shell.usuarios.cargando')}</td>
                        </tr>
                      ) : currentUsers.length === 0 ? (
                        <tr>
                          <td colSpan={8}>{t('admin.shell.usuarios.vacio')}</td>
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
                            {/* El número de programas sólo se conoce del usuario
                                que está seleccionado: la lista paginada no lo
                                trae y pedir un endpoint por fila sería una
                                llamada por usuario. Para el resto se deja el
                                guion en vez de inventar un conteo. */}
                            <td>
                              {selectedUserId === user.id && programasDelUsuario !== null
                                ? programasDelUsuario.length
                                : '-'}
                            </td>
                            <td>
                              <button
                                className="ghost"
                                onClick={() => {
                                  setSelectedUserId(user.id);
                                  void onLoadUserCourses(user.id);
                                  void cargarProgramasDelUsuario(sessionToken, user.id);
                                  requestAnimationFrame(() => {
                                    userCoursesSectionRef.current?.scrollIntoView({
                                      behavior: 'smooth',
                                      block: 'start'
                                    });
                                  });
                                }}
                              >
                                {t('admin.shell.usuarios.irACursos')}
                              </button>
                              {user.status === 'active' ? (
                                <button className="danger" onClick={() => void updateSingleUserStatus(user.id, 'inactive')}>
                                  {t('admin.shell.comun.desactivar')}
                                </button>
                              ) : (
                                <button className="ghost" onClick={() => void updateSingleUserStatus(user.id, 'active')}>
                                  {t('admin.shell.comun.activar')}
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
                      {t('admin.shell.comun.anterior')}
                    </button>
                    <span>
                      {t('admin.shell.comun.paginacion', {
                        pagina: usersData?.pagination.page ?? 1,
                        paginas: usersData?.pagination.totalPages ?? 1,
                        total: usersData?.pagination.total ?? 0
                      })}
                    </span>
                    <button
                      className="ghost"
                      onClick={() => setUsersPage((page) => page + 1)}
                      disabled={(usersData?.pagination.page ?? 1) >= (usersData?.pagination.totalPages ?? 1)}
                    >
                      {t('admin.shell.comun.siguiente')}
                    </button>
                  </div>
                </article>
              </section>

              <section className="grid-1" ref={userCoursesSectionRef}>
                <article className="card scroll-card">
                  <h2>{t('admin.shell.cursosUsuario.titulo')}</h2>
                  <p>{t('admin.shell.cursosUsuario.descripcion')}</p>
                  {!selectedUserCourses ? (
                    <p>{t('admin.shell.cursosUsuario.sinSeleccion')}</p>
                  ) : (
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">{t('admin.shell.cursosUsuario.colId')}</th>
                          <th scope="col">{t('admin.shell.cursosUsuario.colNombre')}</th>
                          {/* Un aula se muestra siempre con su programa: es lo
                              que dice si esa matrícula pertenece a algo. */}
                          <th scope="col">{t('admin.shell.aulas.colPrograma')}</th>
                          <th scope="col">{t('admin.shell.cursosUsuario.colEstado')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedUserCourses.localCourses.length === 0 ? (
                          <tr>
                            <td colSpan={4}>{t('admin.shell.cursosUsuario.vacio')}</td>
                          </tr>
                        ) : (
                          selectedUserCourses.localCourses.map((course) => (
                            <tr key={`${selectedUserCourses.user.id}-${course.moodle_course_id}`}>
                              <td>{course.moodle_course_id}</td>
                              <td>{course.full_name ?? course.short_name ?? t('admin.shell.comun.sinNombre')}</td>
                              <td>{etiquetaProgramaDeAula(course.moodle_course_id)}</td>
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
                <h2>{t('admin.shell.sync.titulo')}</h2>
                <div className="inline-actions">
                  <button
                    onClick={() => void onSyncMoodleAll()}
                    disabled={syncingMoodleAll || loadingCourses || loadingUsers}
                  >
                    {syncingMoodleAll ? t('admin.shell.sync.sincronizandoTodo') : t('admin.shell.sync.botonCompleto')}
                  </button>
                  <button
                    onClick={() => void onSyncMoodleCategories()}
                    disabled={syncingMoodleCategories || loadingCourses}
                  >
                    {syncingMoodleCategories
                      ? t('admin.shell.sync.sincronizandoCategorias')
                      : t('admin.shell.sync.botonCategorias')}
                  </button>
                  <button onClick={() => void onSyncMoodleCourses()} disabled={syncingMoodleCourses || loadingCourses}>
                    {syncingMoodleCourses ? t('admin.shell.sync.sincronizandoCursos') : t('admin.shell.sync.botonCursos')}
                  </button>
                  <button onClick={() => void onSyncMoodleUsers()} disabled={syncingMoodleUsers || loadingUsers}>
                    {syncingMoodleUsers ? t('admin.shell.sync.sincronizandoUsuarios') : t('admin.shell.sync.botonUsuarios')}
                  </button>
                  
                </div>
              </article>
              <article className="card scroll-card">
                <h2>{t('admin.shell.cursos.titulo')}</h2>
                <p>{t('admin.shell.cursos.descripcion')}</p>
                {/* Sin composición cargada la columna de programa saldría
                    diciendo «sin programa» de todo, que es falso. Se avisa en
                    vez de dejar que se lea como un dato. */}
                {composicionNoDisponible ? (
                  <p className="ad-note" role="alert">
                    {t('admin.shell.aulas.programaNoDisponible')}
                  </p>
                ) : null}
                <div className="toolbar-grid">
                  <input
                    value={coursesQuery}
                    onChange={(event) => setCoursesQuery(event.target.value)}
                    placeholder={t('admin.shell.cursos.buscarPlaceholder')}
                  />
                  <select
                    value={coursesVisibleFilter}
                    onChange={(event) => {
                      setCoursesVisibleFilter(event.target.value as 'all' | 'visible' | 'hidden');
                      setCoursesPage(1);
                    }}
                  >
                    <option value="all">{t('admin.shell.comun.todos')}</option>
                    <option value="visible">{t('admin.shell.cursos.filtroVisibles')}</option>
                    <option value="hidden">{t('admin.shell.cursos.filtroOcultos')}</option>
                  </select>
                  <button className="ghost" onClick={() => { setCoursesPage(1); void loadCourses(sessionToken); }}>
                    {t('admin.shell.comun.buscar')}
                  </button>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">{t('admin.shell.cursos.colId')}</th>
                      <th scope="col">{t('admin.shell.cursos.colNombre')}</th>
                      <th scope="col">{t('admin.shell.cursos.colNombreCorto')}</th>
                      {/* El programa va antes que lo operativo: es lo que dice
                          si el aula forma parte de algo que se ofrece. */}
                      <th scope="col">{t('admin.shell.aulas.colPrograma')}</th>
                      <th scope="col">{t('admin.shell.cursos.colVisible')}</th>
                      <th scope="col">{t('admin.shell.cursos.colSincronizado')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingCourses ? (
                      <tr>
                        <td colSpan={6}>{t('admin.shell.cursos.cargando')}</td>
                      </tr>
                    ) : (coursesData?.items.length ?? 0) === 0 ? (
                      <tr>
                        <td colSpan={6}>{t('admin.shell.cursos.vacio')}</td>
                      </tr>
                    ) : (
                      (coursesData?.items ?? []).map((course) => (
                        <tr key={course.moodle_course_id}>
                          <td>{course.moodle_course_id}</td>
                          <td>{course.full_name}</td>
                          <td>{course.short_name}</td>
                          <td>
                            {programaPorAula.has(course.moodle_course_id) ? (
                              etiquetaProgramaDeAula(course.moodle_course_id)
                            ) : (
                              // Un aula sin programa no la ve ni la cursa
                              // nadie: se marca para que destaque en la lista.
                              <span className="ad-badge ad-badge-warn">
                                {t('admin.shell.aulas.sinPrograma')}
                              </span>
                            )}
                          </td>
                          <td>{course.visible ? t('admin.shell.comun.si') : t('admin.shell.comun.no')}</td>
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
                    {t('admin.shell.comun.anterior')}
                  </button>
                  <span>
                    {t('admin.shell.comun.paginacion', {
                      pagina: coursesData?.pagination.page ?? 1,
                      paginas: coursesData?.pagination.totalPages ?? 1,
                      total: coursesData?.pagination.total ?? 0
                    })}
                  </span>
                  <button
                    className="ghost"
                    onClick={() => setCoursesPage((page) => page + 1)}
                    disabled={(coursesData?.pagination.page ?? 1) >= (coursesData?.pagination.totalPages ?? 1)}
                  >
                    {t('admin.shell.comun.siguiente')}
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

          {activeSection === 'roles' ? (
            <RolesView
              token={sessionToken}
              puedeEditar={puedeEditar('roles')}
              locale={i18n.language?.startsWith('en') ? 'en' : 'es'}
            />
          ) : null}

          {activeSection === 'reports' ? (
            <ReportsView
              token={sessionToken}
              locale={i18n.language?.startsWith('en') ? 'en' : 'es'}
              puedeEditar={puedeEditar('reports')}
            />
          ) : null}

          {activeSection === 'sis' ? (
            <SisView sessionToken={sessionToken} setError={setError} setInfo={setInfo} />
          ) : null}

          {activeSection === 'registraduria' ? (
            <RegistrarView
              token={sessionToken}
              puedeEditar={puedeEditar('registraduria')}
              locale={i18n.language?.startsWith('en') ? 'en' : 'es'}
            />
          ) : null}

          {/* Las rutas de composición cuelgan de `/admin/degree-programs`, que el
              servidor asigna a la sección `sis`: el permiso que decide si esto
              es editable tiene que ser el de `sis` o el panel ofrecería botones
              que el servidor responde con 403. */}
          {activeSection === 'programs' ? (
            <ProgramsView
              token={sessionToken}
              puedeEditar={puedeEditar('sis')}
              locale={i18n.language?.startsWith('en') ? 'en' : 'es'}
            />
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
                <h2>{t('admin.shell.rutas.titulo')}</h2>
                <span>
                  {t('admin.shell.rutas.resumen', {
                    total: baseData.routes.count,
                    get: routeSummary.get,
                    post: routeSummary.post,
                    otros: routeSummary.others
                  })}
                </span>
              </article>
              <article className="card scroll-card">
                <table>
                  <thead>
                    <tr>
                      <th>{t('admin.shell.rutas.colMetodo')}</th>
                      <th>{t('admin.shell.rutas.colUrl')}</th>
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
                <h2>{editingWebinarId ? t('admin.shell.webinars.editarTitulo') : t('admin.shell.webinars.crearTitulo')}</h2>
                <form className="login-form" onSubmit={onSubmitWebinar}>
                  <label>{t('admin.shell.webinars.campoSlug')}</label>
                  <input
                    value={webinarForm.slug}
                    onChange={(event) => setWebinarForm((current) => ({ ...current, slug: event.target.value }))}
                    placeholder={t('admin.shell.webinars.campoSlugPlaceholder')}
                    required
                  />
                  <label>{t('admin.shell.webinars.campoTitulo')}</label>
                  <input
                    value={webinarForm.title}
                    onChange={(event) => setWebinarForm((current) => ({ ...current, title: event.target.value }))}
                    placeholder={t('admin.shell.webinars.campoTituloPlaceholder')}
                    required
                  />
                  <label>{t('admin.shell.webinars.campoSubtitulo')}</label>
                  <input
                    value={webinarForm.subtitle}
                    onChange={(event) => setWebinarForm((current) => ({ ...current, subtitle: event.target.value }))}
                    placeholder={t('admin.shell.webinars.campoSubtituloPlaceholder')}
                  />
                  <label>{t('admin.shell.webinars.campoDescripcion')}</label>
                  <input
                    value={webinarForm.description}
                    onChange={(event) => setWebinarForm((current) => ({ ...current, description: event.target.value }))}
                    placeholder={t('admin.shell.webinars.campoDescripcionPlaceholder')}
                  />
                  <label>{t('admin.shell.webinars.campoHero')}</label>
                  <input
                    value={webinarForm.heroImage}
                    onChange={(event) => setWebinarForm((current) => ({ ...current, heroImage: event.target.value }))}
                    placeholder="https://..."
                    required
                  />
                  <label>{t('admin.shell.webinars.campoFuente')}</label>
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
                    <option value="external">{t('admin.shell.webinars.fuenteExterna')}</option>
                  </select>
                  <label>{t('admin.shell.webinars.campoUrlLive')}</label>
                  <input
                    value={webinarForm.sourceUrl}
                    onChange={(event) => setWebinarForm((current) => ({ ...current, sourceUrl: event.target.value }))}
                    placeholder="https://..."
                    required
                  />
                  <label>{t('admin.shell.webinars.campoReservaFree')}</label>
                  <input
                    value={webinarForm.freeReservationUrl}
                    onChange={(event) =>
                      setWebinarForm((current) => ({ ...current, freeReservationUrl: event.target.value }))
                    }
                    placeholder={t('admin.shell.webinars.campoReservaFreePlaceholder')}
                  />
                  <label>{t('admin.shell.webinars.campoReservaVip')}</label>
                  <input
                    value={webinarForm.vipReservationUrl}
                    onChange={(event) =>
                      setWebinarForm((current) => ({ ...current, vipReservationUrl: event.target.value }))
                    }
                    placeholder={t('admin.shell.webinars.campoReservaVipPlaceholder')}
                  />
                  <label>{t('admin.shell.webinars.campoMultiplataforma')}</label>
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
                              placeholder={t('admin.shell.webinars.urlPara', { plataforma: platform })}
                            />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  <label>{t('admin.shell.webinars.campoReplay')}</label>
                  <input
                    value={webinarForm.replayUrl}
                    onChange={(event) => setWebinarForm((current) => ({ ...current, replayUrl: event.target.value }))}
                    placeholder="https://..."
                  />
                  <label>{t('admin.shell.webinars.campoInicio')}</label>
                  <input
                    type="datetime-local"
                    value={webinarForm.startsAt}
                    onChange={(event) => setWebinarForm((current) => ({ ...current, startsAt: event.target.value }))}
                    required
                  />
                  <label>{t('admin.shell.webinars.campoFin')}</label>
                  <input
                    type="datetime-local"
                    value={webinarForm.endsAt}
                    onChange={(event) => setWebinarForm((current) => ({ ...current, endsAt: event.target.value }))}
                  />
                  <label>{t('admin.shell.webinars.campoTimezone')}</label>
                  <input
                    value={webinarForm.timezone}
                    onChange={(event) => setWebinarForm((current) => ({ ...current, timezone: event.target.value }))}
                  />
                  <label>{t('admin.shell.webinars.campoCta')}</label>
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
                    {t('admin.shell.webinars.activo')}
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={webinarForm.showOnLanding}
                      onChange={(event) =>
                        setWebinarForm((current) => ({ ...current, showOnLanding: event.target.checked }))
                      }
                    />{' '}
                    {t('admin.shell.comun.mostrarEnLanding')}
                  </label>
                  <button type="submit" disabled={creatingWebinar}>
                    {creatingWebinar
                      ? t('admin.shell.webinars.guardando')
                      : editingWebinarId
                        ? t('admin.shell.comun.guardarCambios')
                        : t('admin.shell.webinars.crearTitulo')}
                  </button>
                  {editingWebinarId ? (
                    <button type="button" className="ghost" onClick={onCancelWebinarEdit}>
                      {t('admin.shell.comun.cancelarEdicion')}
                    </button>
                  ) : null}
                </form>
              </article>

              <article className="card scroll-card">
                <h2>{t('admin.shell.webinars.listaTitulo')}</h2>
                {loadingWebinars ? <p>{t('admin.shell.webinars.cargando')}</p> : null}
                <table>
                  <thead>
                    <tr>
                      <th>{t('admin.shell.webinars.colTitulo')}</th>
                      <th>{t('admin.shell.webinars.colInicio')}</th>
                      <th>{t('admin.shell.webinars.colFuente')}</th>
                      <th>{t('admin.shell.comun.colActivo')}</th>
                      <th>{t('admin.shell.comun.colLanding')}</th>
                      <th>{t('admin.shell.webinars.colCanales')}</th>
                      <th>{t('admin.shell.comun.colAcciones')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {webinarsData.length === 0 ? (
                      <tr>
                        <td colSpan={7}>{t('admin.shell.webinars.vacio')}</td>
                      </tr>
                    ) : (
                      webinarsData.map((webinar) => (
                        <tr key={webinar.id}>
                          <td>{webinar.title}</td>
                          <td>{new Date(webinar.starts_at).toLocaleString()}</td>
                          <td>{webinar.source_type}</td>
                          <td>{webinar.is_active ? t('admin.shell.comun.si') : t('admin.shell.comun.no')}</td>
                          <td>
                            {webinar.show_on_landing ? t('admin.shell.comun.si') : t('admin.shell.comun.no')}
                          </td>
                          <td>{webinar.webinar_links?.length ?? 0}</td>
                          <td>
                            <button
                              className="ghost"
                              onClick={() => void onToggleWebinarFlag(webinar.id, { isActive: !webinar.is_active })}
                            >
                              {webinar.is_active ? t('admin.shell.comun.desactivar') : t('admin.shell.comun.activar')}
                            </button>
                            <button
                              className="ghost"
                              onClick={() =>
                                void onToggleWebinarFlag(webinar.id, {
                                  showOnLanding: !webinar.show_on_landing
                                })
                              }
                            >
                              {webinar.show_on_landing
                                ? t('admin.shell.comun.ocultarLanding')
                                : t('admin.shell.comun.mostrarLanding')}
                            </button>
                            <button className="ghost" onClick={() => onEditWebinar(webinar)}>
                              {t('admin.shell.comun.editar')}
                            </button>
                            <button className="danger" onClick={() => void onDeleteWebinar(webinar.id)}>
                              {t('admin.shell.comun.eliminar')}
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
                <h2>{editingPodcastId ? t('admin.shell.podcasts.editarTitulo') : t('admin.shell.podcasts.crearTitulo')}</h2>
                <form className="login-form" onSubmit={onSubmitPodcast}>
                  <label>{t('admin.shell.podcasts.campoTitulo')}</label>
                  <input
                    value={podcastForm.title}
                    onChange={(event) => setPodcastForm((current) => ({ ...current, title: event.target.value }))}
                    placeholder={t('admin.shell.podcasts.campoTituloPlaceholder')}
                    required
                  />
                  <label>{t('admin.shell.podcasts.campoVideo')}</label>
                  <input
                    value={podcastForm.video}
                    onChange={(event) => setPodcastForm((current) => ({ ...current, video: event.target.value }))}
                    placeholder={t('admin.shell.podcasts.campoVideoPlaceholder')}
                    required
                  />
                  <label>{t('admin.shell.podcasts.campoFecha')}</label>
                  <input
                    type="datetime-local"
                    value={podcastForm.publishedAt}
                    onChange={(event) => setPodcastForm((current) => ({ ...current, publishedAt: event.target.value }))}
                    required
                  />
                  <label>{t('admin.shell.podcasts.campoOrden')}</label>
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
                    {t('admin.shell.podcasts.activo')}
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={podcastForm.showOnLanding}
                      onChange={(event) =>
                        setPodcastForm((current) => ({ ...current, showOnLanding: event.target.checked }))
                      }
                    />{' '}
                    {t('admin.shell.comun.mostrarEnLanding')}
                  </label>
                  <button type="submit" disabled={creatingPodcast}>
                    {creatingPodcast
                      ? t('admin.shell.podcasts.guardando')
                      : editingPodcastId
                        ? t('admin.shell.comun.guardarCambios')
                        : t('admin.shell.podcasts.crearTitulo')}
                  </button>
                  {editingPodcastId ? (
                    <button type="button" className="ghost" onClick={onCancelPodcastEdit}>
                      {t('admin.shell.comun.cancelarEdicion')}
                    </button>
                  ) : null}
                </form>
              </article>

              <article className="card scroll-card">
                <h2>{t('admin.shell.podcasts.listaTitulo')}</h2>
                {loadingPodcasts ? <p>{t('admin.shell.podcasts.cargando')}</p> : null}
                <table>
                  <thead>
                    <tr>
                      <th>{t('admin.shell.podcasts.colTitulo')}</th>
                      <th>{t('admin.shell.podcasts.colFecha')}</th>
                      <th>{t('admin.shell.podcasts.colOrden')}</th>
                      <th>{t('admin.shell.comun.colActivo')}</th>
                      <th>{t('admin.shell.comun.colLanding')}</th>
                      <th>{t('admin.shell.comun.colAcciones')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {podcastsData.length === 0 ? (
                      <tr>
                        <td colSpan={6}>{t('admin.shell.podcasts.vacio')}</td>
                      </tr>
                    ) : (
                      podcastsData.map((podcast) => (
                        <tr key={podcast.id}>
                          <td>{podcast.title}</td>
                          <td>{new Date(podcast.published_at).toLocaleString()}</td>
                          <td>{podcast.display_order}</td>
                          <td>{podcast.is_active ? t('admin.shell.comun.si') : t('admin.shell.comun.no')}</td>
                          <td>
                            {podcast.show_on_landing ? t('admin.shell.comun.si') : t('admin.shell.comun.no')}
                          </td>
                          <td>
                            <button
                              className="ghost"
                              onClick={() => void onTogglePodcastFlag(podcast.id, { isActive: !podcast.is_active })}
                            >
                              {podcast.is_active ? t('admin.shell.comun.desactivar') : t('admin.shell.comun.activar')}
                            </button>
                            <button
                              className="ghost"
                              onClick={() =>
                                void onTogglePodcastFlag(podcast.id, {
                                  showOnLanding: !podcast.show_on_landing
                                })
                              }
                            >
                              {podcast.show_on_landing
                                ? t('admin.shell.comun.ocultarLanding')
                                : t('admin.shell.comun.mostrarLanding')}
                            </button>
                            <button className="ghost" onClick={() => onEditPodcast(podcast)}>
                              {t('admin.shell.comun.editar')}
                            </button>
                            <button className="danger" onClick={() => void onDeletePodcast(podcast.id)}>
                              {t('admin.shell.comun.eliminar')}
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
      </div>
      </div>
    </div>
  );
}
