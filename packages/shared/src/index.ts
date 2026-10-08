export type Locale = 'es' | 'en';
export type ContentKind = 'vod' | 'live' | 'course' | 'bundle';
export type AccessModel = 'free' | 'subscription' | 'purchase' | 'code';

export interface TenantBranding {
  logoUrl: string;
  primaryColor: string;
  accentColor: string;
  heroGradient: string;
}

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  locales: Locale[];
  currency: string;
  branding: TenantBranding;
}

export interface UserProfile {
  id: string;
  fullName: string;
  email: string;
  locale: Locale;
  roles: string[];
  tenantId: string;
}

export interface InteractiveEvent {
  id: string;
  type: 'quiz' | 'poll' | 'cta' | 'info';
  startsAtSec: number;
  endsAtSec: number;
  prompt: string;
  options?: string[];
  ctaUrl?: string;
}

export interface ContentAsset {
  id: string;
  slug: string;
  title: string;
  summary: string;
  titleEn?: string;
  summaryEn?: string;
  /**
   * Resumen con el HTML original de Moodle (lema, entradilla y lo que se
   * practica). `summary` sigue siendo la versión en texto plano que pintan las
   * tarjetas; esto es lo que usa la ficha del programa.
   */
  summaryHtml?: string;
  summaryHtmlEn?: string;
  /** Nombre de la categoría de Moodle, ya traducido, para la etiqueta de la tarjeta. */
  categoryName?: string;
  categoryNameEn?: string;
  kind: ContentKind;
  accessModel: AccessModel;
  durationMinutes?: number;
  language: Locale;
  tags: string[];
  heroImage: string;
  playback?: {
    hlsUrl: string;
    drm: boolean;
    subtitles: string[];
    interactiveEvents: InteractiveEvent[];
  };
}

export interface CourseProgress {
  completionRate: number;
  status: 'not_started' | 'in_progress' | 'completed';
  certificateEligible: boolean;
}

export interface Course extends ContentAsset {
  kind: 'course';
  moodleCourseId: string;
  modules: number;
  lessons: number;
  progress: CourseProgress;
}

export interface LiveEvent extends ContentAsset {
  kind: 'live';
  startsAt: string;
  endsAt: string;
  concurrentViewersTarget: number;
}

export interface Offer {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  billingPeriod?: 'monthly' | 'yearly';
  type: 'subscription' | 'purchase' | 'bundle';
}

export interface Entitlement {
  contentId: string;
  granted: boolean;
  reason: 'free' | 'subscription' | 'purchase' | 'code' | 'missing_access';
}

export interface HomeResponse {
  tenant: Tenant;
  user: UserProfile;
  featured: ContentAsset[];
  liveNow: LiveEvent[];
  continueLearning: Course[];
  offers: Offer[];
}

export interface PlatformCapability {
  id: string;
  name: string;
  status: 'mvp' | 'phase_2' | 'phase_3';
  description: string;
}

export interface PlatformBlueprintResponse {
  domains: string[];
  publicApis: string[];
  integrations: string[];
  targetPlatforms: {
    web: string[];
    mobile: string[];
    tv: string[];
  };
  capabilities: PlatformCapability[];
}

const interactiveEvents: InteractiveEvent[] = [
  {
    id: 'ie-quiz-1',
    type: 'quiz',
    startsAtSec: 120,
    endsAtSec: 180,
    prompt: '¿Cuál es el concepto central abordado en este bloque temático?',
    options: ['Teoría del conocimiento', 'Álgebra lineal', 'Metodología de investigación']
  },
  {
    id: 'ie-cta-1',
    type: 'cta',
    startsAtSec: 420,
    endsAtSec: 520,
    prompt: 'Descarga la guía de estudio complementaria para esta lección.',
    ctaUrl: 'https://example.com/guia-estudio'
  }
];

export const demoTenant: Tenant = {
  id: 'tenant-atlas',
  slug: 'university',
  name: 'Atlas Online University',
  locales: ['es', 'en'],
  currency: 'USD',
  branding: {
    logoUrl: 'https://dummyimage.com/200x48/0f172a/ffffff&text=Atlas+Online+University',
    primaryColor: '#1e3a5f',
    accentColor: '#c9a84c',
    heroGradient: 'linear-gradient(135deg, #0a0d17 0%, #1e3a5f 50%, #c9a84c 100%)'
  }
};

export const demoUser: UserProfile = {
  id: 'user-1',
  fullName: 'María González',
  email: 'mgonzalez@atlas.edu',
  locale: 'es',
  roles: ['tenant_admin', 'learner'],
  tenantId: demoTenant.id
};

export const demoCatalog: ContentAsset[] = [
  {
    id: 'vod-1',
    slug: 'introduccion-filosofia-moderna',
    title: 'Introducción a la Filosofía Moderna',
    summary: 'Serie de clases magistrales en video sobre el pensamiento filosófico desde Descartes hasta Kant. Explora el racionalismo, el empirismo y la crítica de la razón pura.',
    titleEn: 'Introduction to Modern Philosophy',
    summaryEn: 'Video lecture series on philosophical thought from Descartes to Kant. Explores rationalism, empiricism and the critique of pure reason.',
    kind: 'vod',
    accessModel: 'subscription',
    durationMinutes: 110,
    language: 'es',
    tags: ['Filosofía', 'Humanidades', 'Historia del pensamiento'],
    heroImage: 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?auto=format&fit=crop&w=1400&q=80',
    playback: {
      hlsUrl: 'https://example.com/hls/introduccion-filosofia-moderna.m3u8',
      drm: true,
      subtitles: ['es', 'en'],
      interactiveEvents
    }
  },
  {
    id: 'vod-2',
    slug: 'historia-del-arte-occidental',
    title: 'Historia del Arte Occidental',
    summary: 'Recorrido visual y analítico desde el arte clásico grecolatino hasta las vanguardias del siglo XX. Incluye análisis de obras, contexto histórico y movimientos artísticos.',
    titleEn: 'History of Western Art',
    summaryEn: 'A visual and analytical journey from classical Greco-Roman art to the 20th-century avant-garde. Includes analysis of works, historical context and artistic movements.',
    kind: 'vod',
    accessModel: 'free',
    durationMinutes: 85,
    language: 'es',
    tags: ['Arte', 'Historia', 'Cultura'],
    heroImage: 'https://images.unsplash.com/photo-1572947650440-e8a97ef053b2?auto=format&fit=crop&w=1400&q=80',
    playback: {
      hlsUrl: 'https://example.com/hls/historia-del-arte-occidental.m3u8',
      drm: false,
      subtitles: ['es'],
      interactiveEvents
    }
  },
  {
    id: 'vod-3',
    slug: 'calculo-diferencial-e-integral',
    title: 'Cálculo Diferencial e Integral',
    summary: 'Curso en video sobre límites, derivadas e integrales. Pensado para estudiantes de ingeniería, ciencias y economía que requieren bases sólidas en análisis matemático.',
    titleEn: 'Differential and Integral Calculus',
    summaryEn: 'Video course on limits, derivatives and integrals. Designed for engineering, science and economics students who need solid foundations in mathematical analysis.',
    kind: 'vod',
    accessModel: 'subscription',
    durationMinutes: 145,
    language: 'es',
    tags: ['Matemáticas', 'Ingeniería', 'Ciencias exactas'],
    heroImage: 'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?auto=format&fit=crop&w=1400&q=80',
    playback: {
      hlsUrl: 'https://example.com/hls/calculo-diferencial-e-integral.m3u8',
      drm: true,
      subtitles: ['es', 'en'],
      interactiveEvents
    }
  },
  {
    id: 'live-1',
    slug: 'conferencia-ciencias-sociales-2026',
    title: 'Conferencia Internacional de Ciencias Sociales 2026',
    summary: 'Evento académico en vivo con ponencias de investigadores de universidades de América Latina, Europa y Estados Unidos. Incluye paneles, preguntas del público y presentación de investigaciones.',
    titleEn: 'International Social Sciences Conference 2026',
    summaryEn: 'Live academic event with talks from researchers at universities across Latin America, Europe and the United States. Includes panels, audience Q&A and research presentations.',
    kind: 'live',
    accessModel: 'free',
    durationMinutes: 240,
    language: 'es',
    tags: ['Conferencia', 'Ciencias sociales', 'Investigación'],
    heroImage: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=1400&q=80',
    playback: {
      hlsUrl: 'https://example.com/hls/conferencia-ciencias-sociales-2026.m3u8',
      drm: false,
      subtitles: ['es', 'en', 'pt'],
      interactiveEvents
    },
    startsAt: '2026-06-15T14:00:00Z',
    endsAt: '2026-06-15T18:00:00Z',
    concurrentViewersTarget: 10000
  } as LiveEvent,
  {
    id: 'live-2',
    slug: 'simposio-inteligencia-artificial-etica',
    title: 'Simposio: Inteligencia Artificial y Ética',
    summary: 'Panel académico en vivo sobre los desafíos éticos, legales y sociales de la inteligencia artificial. Expertos de derecho, filosofía e ingeniería debaten el futuro regulatorio de la IA.',
    titleEn: 'Symposium: Artificial Intelligence and Ethics',
    summaryEn: 'Live academic panel on the ethical, legal and social challenges of artificial intelligence. Experts in law, philosophy and engineering debate the regulatory future of AI.',
    kind: 'live',
    accessModel: 'purchase',
    durationMinutes: 180,
    language: 'es',
    tags: ['IA', 'Ética', 'Tecnología', 'Derecho'],
    heroImage: 'https://images.unsplash.com/photo-1677442135703-1787eea5ce01?auto=format&fit=crop&w=1400&q=80',
    playback: {
      hlsUrl: 'https://example.com/hls/simposio-ia-etica.m3u8',
      drm: true,
      subtitles: ['es', 'en'],
      interactiveEvents
    },
    startsAt: '2026-07-20T17:00:00Z',
    endsAt: '2026-07-20T20:00:00Z',
    concurrentViewersTarget: 5000
  } as LiveEvent,
  {
    id: 'course-1',
    slug: 'fundamentos-de-economia',
    title: 'Fundamentos de Economía',
    summary: 'Curso estructurado sobre microeconomía y macroeconomía. Analiza oferta y demanda, estructuras de mercado, política fiscal, inflación y crecimiento económico con casos reales.',
    titleEn: 'Foundations of Economics',
    summaryEn: 'Structured course on microeconomics and macroeconomics. Analyzes supply and demand, market structures, fiscal policy, inflation and economic growth with real-world cases.',
    kind: 'course',
    accessModel: 'subscription',
    durationMinutes: 720,
    language: 'es',
    tags: ['Economía', 'Ciencias sociales', 'Política pública'],
    heroImage: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=1400&q=80',
    moodleCourseId: 'mdl-2048',
    modules: 10,
    lessons: 42,
    progress: {
      completionRate: 0,
      status: 'not_started',
      certificateEligible: false
    }
  } as Course,
  {
    id: 'course-2',
    slug: 'metodologia-de-la-investigacion',
    title: 'Metodología de la Investigación Científica',
    summary: 'Curso completo sobre diseño de investigación académica: formulación de hipótesis, revisión de literatura, métodos cuantitativos y cualitativos, análisis de datos y redacción de tesis.',
    titleEn: 'Scientific Research Methodology',
    summaryEn: 'Complete course on academic research design: hypothesis formulation, literature review, quantitative and qualitative methods, data analysis and thesis writing.',
    kind: 'course',
    accessModel: 'subscription',
    durationMinutes: 540,
    language: 'es',
    tags: ['Investigación', 'Metodología', 'Tesis', 'Academia'],
    heroImage: 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?auto=format&fit=crop&w=1400&q=80',
    moodleCourseId: 'mdl-2049',
    modules: 8,
    lessons: 32,
    progress: {
      completionRate: 0,
      status: 'not_started',
      certificateEligible: false
    }
  } as Course,
  {
    id: 'course-3',
    slug: 'derecho-constitucional',
    title: 'Derecho Constitucional',
    summary: 'Curso sobre los principios fundamentales del Estado de derecho, derechos fundamentales, separación de poderes, control de constitucionalidad y jurisprudencia comparada.',
    titleEn: 'Constitutional Law',
    summaryEn: 'Course on the fundamental principles of the rule of law, fundamental rights, separation of powers, judicial review and comparative jurisprudence.',
    kind: 'course',
    accessModel: 'purchase',
    durationMinutes: 660,
    language: 'es',
    tags: ['Derecho', 'Constitución', 'Jurisprudencia'],
    heroImage: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=1400&q=80',
    moodleCourseId: 'mdl-2050',
    modules: 9,
    lessons: 38,
    progress: {
      completionRate: 0,
      status: 'not_started',
      certificateEligible: false
    }
  } as Course,
  {
    id: 'course-4',
    slug: 'introduccion-a-la-programacion',
    title: 'Introducción a la Programación',
    summary: 'Curso inicial de ciencias de la computación. Aprende pensamiento algorítmico, estructuras de datos básicas, lógica de programación y resuelve problemas reales usando Python.',
    titleEn: 'Introduction to Programming',
    summaryEn: 'Introductory computer science course. Learn algorithmic thinking, basic data structures, programming logic and solve real problems using Python.',
    kind: 'course',
    accessModel: 'free',
    durationMinutes: 480,
    language: 'es',
    tags: ['Programación', 'Ciencias de la computación', 'Python'],
    heroImage: 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?auto=format&fit=crop&w=1400&q=80',
    moodleCourseId: 'mdl-2051',
    modules: 7,
    lessons: 28,
    progress: {
      completionRate: 0,
      status: 'not_started',
      certificateEligible: false
    }
  } as Course,
  {
    id: 'bundle-1',
    slug: 'programa-ciencias-sociales',
    title: 'Programa de Ciencias Sociales',
    summary: 'Paquete académico que integra Economía, Sociología, Ciencias Políticas e Historia Contemporánea. Ideal para estudiantes que buscan una formación integral en humanidades.',
    titleEn: 'Social Sciences Program',
    summaryEn: 'Academic bundle integrating Economics, Sociology, Political Science and Contemporary History. Ideal for students seeking a comprehensive education in the humanities.',
    kind: 'bundle',
    accessModel: 'purchase',
    durationMinutes: 1800,
    language: 'es',
    tags: ['Programa', 'Ciencias sociales', 'Humanidades'],
    heroImage: 'https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1400&q=80'
  }
];

export const demoOffers: Offer[] = [
  {
    id: 'offer-sub-monthly',
    name: 'Matrícula Mensual',
    description: 'Acceso ilimitado a todos los cursos, clases magistrales en video y eventos académicos en vivo del catálogo de Atlas Online University.',
    price: 29,
    currency: 'USD',
    billingPeriod: 'monthly',
    type: 'subscription'
  },
  {
    id: 'offer-sub-yearly',
    name: 'Matrícula Anual',
    description: 'Acceso completo durante un año académico completo. Incluye certificados digitales, acceso a biblioteca de recursos y soporte académico.',
    price: 249,
    currency: 'USD',
    billingPeriod: 'yearly',
    type: 'subscription'
  },
  {
    id: 'offer-course-pack',
    name: 'Paquete de Certificación',
    description: 'Compra única para acceder a un programa de certificación completo con evaluaciones, proyectos y certificado oficial de Atlas Online University.',
    price: 199,
    currency: 'USD',
    type: 'bundle'
  }
];

export const demoEntitlements: Entitlement[] = demoCatalog.map((content) => ({
  contentId: content.id,
  granted: content.kind === 'vod',
  reason: content.kind === 'vod' ? 'subscription' : 'missing_access'
}));

export const demoHomeResponse: HomeResponse = {
  tenant: demoTenant,
  user: demoUser,
  featured: demoCatalog,
  liveNow: demoCatalog.filter((item): item is LiveEvent => item.kind === 'live') as LiveEvent[],
  continueLearning: demoCatalog.filter((item): item is Course => item.kind === 'course') as Course[],
  offers: demoOffers
};

export const demoBlueprint: PlatformBlueprintResponse = {
  domains: [
    'identity and access',
    'tenant configuration',
    'catalog and editorial',
    'commerce and billing',
    'learning and progress',
    'playback and interactive events',
    'notifications and analytics'
  ],
  publicApis: [
    'GET /v1/home',
    'GET /v1/catalog',
    'GET /v1/catalog/:slug',
    'GET /v1/offers',
    'GET /v1/entitlements',
    'GET /v1/blueprint'
  ],
  integrations: [
    'Moodle core + plugins',
    'Stripe',
    'AWS Media Services or Bitmovin/Mux',
    'GA4 and playback QoE provider',
    'Email/push provider',
    'External IdP'
  ],
  targetPlatforms: {
    web: ['React', 'Vite', 'shared SDK', 'i18n es/en'],
    mobile: ['React Native planned', 'shared API SDK', 'push notifications'],
    tv: ['Android TV planned', 'tvOS planned', 'HLS playback contracts']
  },
  capabilities: [
    {
      id: 'cap-1',
      name: 'Multi-tenant branding and content rules',
      status: 'mvp',
      description: 'Tenant-aware theming, localized catalog and entitlement checks.'
    },
    {
      id: 'cap-2',
      name: 'VoD/live playback with overlays',
      status: 'mvp',
      description: 'HLS playback, subtitles and timed interactive events.'
    },
    {
      id: 'cap-3',
      name: 'Mobile and TV clients',
      status: 'phase_2',
      description: 'Reuse API contracts and shared logic across new clients.'
    }
  ]
};
