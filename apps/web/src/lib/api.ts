import type {
  ContentAsset,
  Entitlement,
  HomeResponse,
  Offer,
  PlatformBlueprintResponse
} from '@atlas/shared';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api';

type AuthContext = {
  token?: string;
  adminKey?: string;
};

type RequestOptions = {
  method?: string;
  body?: unknown;
  auth?: AuthContext;
};

function buildHeaders(options?: RequestOptions): Record<string, string> {
  const headers: Record<string, string> = {};
  const auth = options?.auth;

  if (auth?.token) {
    headers.Authorization = `Bearer ${auth.token}`;
  }
  if (auth?.adminKey) {
    headers['x-admin-key'] = auth.adminKey;
  }
  if (options?.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
}

async function fetchJson<T>(path: string, options?: RequestOptions): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: options?.method ?? 'GET',
    headers: buildHeaders(options),
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
          if (detail) {
            message = `${message} - ${detail}`;
          }
        } catch {
          message = `${message} - ${raw}`;
        }
      }
    } catch {
      // ignore body parsing failures and keep status-only message
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export type AdminSession = {
  token: string;
  admin: {
    email: string;
  };
  createdAt: string;
  expiresAt: string;
  authenticated: true;
};

export type MoodleLastSync = {
  syncedAt: string;
  total: number;
  upsertedCatalogAssets?: number;
} | null;

export type AdminStatus = {
  platform: string;
  timestamp: string;
  uptimeSec: number;
  routes: {
    total: number;
    public: number;
    admin: number;
  };
  db: {
    connected: boolean;
    database: string | null;
    activeSessions: number;
    pool: {
      total: number;
      idle: number;
      waiting: number;
    };
    entities: {
      tenants: number;
      users: number;
      offers: number;
      entitlements: number;
      moodleCourses: number;
      moodleCategories: number;
      userEnrollments: number;
      companies: number;
      companyMembers: number;
      webinars: number;
      podcasts: number;
      catalogByKind: Array<{ kind: string; count: number }>;
    };
  };
  moodle: {
    configured: boolean;
    connected: boolean;
    baseUrl: string | null;
    tokenSet: boolean;
    error: string | null;
    siteInfo: Record<string, unknown> | null;
    lastCoursesSync: MoodleLastSync;
    lastUsersSync:
    | {
      syncedAt: string;
      totalUsers: number;
      upsertedUsers: number;
      enrollmentLinks: number;
      warningsCount: number;
    }
    | null;
    lastCategoriesSync:
    | {
      syncedAt: string;
      total: number;
      source?: string;
    }
    | null;
  };
};

export type AdminRouteRegistry = {
  count: number;
  routes: Array<{ method: string; url: string }>;
};

export type AdminConfig = {
  server: { host: string; port: number };
  db: { urlSet: boolean };
  moodle: { configured: boolean; baseUrl: string | null; tokenSet: boolean };
};

export type MoodleCoursesResponse = {
  items: Array<{
    moodle_course_id: number;
    full_name: string;
    short_name: string;
    category_id: number | null;
    visible: boolean;
    start_date: string | null;
    end_date: string | null;
    synced_at: string;
  }>;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export type MoodleSyncResponse = {
  synced: boolean;
  totalCourses?: number;
  upsertedCourses?: number;
  upsertedCatalogAssets?: number;
  error?: string;
};

export type MoodleUsersSyncResponse = {
  synced: boolean;
  totalUsers: number;
  upsertedUsers: number;
  enrollmentLinks: number;
  warnings: string[];
};

export type MoodleCategoriesSyncResponse = {
  synced: boolean;
  totalCategories: number;
  upsertedCategories: number;
  source?: string;
};

export type MoodleSyncAllResponse = {
  synced: boolean;
  categories: MoodleCategoriesSyncResponse;
  courses: MoodleSyncResponse;
  users: MoodleUsersSyncResponse;
};

export type AdminUser = {
  id: string;
  full_name: string;
  email: string;
  locale: string;
  roles: string[];
  tenant_id: string;
  moodle_user_id: number | null;
  status: string;
  created_at: string;
  enrolled_courses: number;
};

export type PaginatedAdminUsersResponse = {
  items: AdminUser[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export type CreateAdminUserResponse = {
  created: boolean;
  moodleUserId: number;
  temporaryPassword: string;
  user: AdminUser;
};

export type UserCoursesResponse = {
  user: AdminUser;
  localCourses: Array<{
    moodle_course_id: number;
    status: string;
    enrolled_at: string;
    synced_at: string;
    full_name: string | null;
    short_name: string | null;
    visible: boolean | null;
  }>;
  moodleCourses: Array<Record<string, unknown>>;
};

export type CatalogContentDetailResponse = {
  content: ContentAsset & Record<string, unknown>;
  entitlement: Entitlement | null;
};

export type MoodleCourseContentResponse = {
  moodleCourseId: number;
  available: boolean;
  error?: string;
  sections: Array<{
    id: number;
    name: string;
    summary?: string;
    summaryformat?: number;
    section?: number;
    visible?: number;
    modules?: Array<{
      id: number;
      name: string;
      modname: string;
      modplural?: string;
      url?: string;
      description?: string;
      visible?: number;
      availabilityinfo?: string;
      contents?: Array<{
        type?: string;
        filename?: string;
        filepath?: string;
        filesize?: number;
        fileurl?: string;
        timemodified?: number;
        mimetype?: string;
      }>;
    }>;
  }>;
};

export type PublicCourseInteractionResponse = {
  saved: boolean;
  interaction: {
    id: string;
    moodle_course_id: number;
    module_id: number;
    module_name: string;
    module_type: string;
    response: Record<string, unknown>;
    created_at: string;
  };
  progress?: PublicCourseProgressRecord | null;
};

export type PublicCourseProgressRecord = {
  user_id: string;
  moodle_course_id: number;
  completed_module_ids: number[];
  interactions_count: number;
  xp: number;
  total_modules: number;
  progress_percent: number;
  last_activity_at: string | null;
  updated_at: string;
};

export type PublicCourseInteractionRecord = {
  id: string;
  user_id: string;
  moodle_course_id: number;
  module_id: number;
  module_name: string;
  module_type: string;
  response: Record<string, unknown>;
  created_at: string;
};

export type PublicSession = {
  token: string;
  expiresAt: string;
  user: {
    id: string;
    fullName: string;
    email: string;
    locale: string;
    moodleUserId?: number | null;
  };
};

export type PublicProfileUpdateResponse = {
  updated: boolean;
  user: {
    id: string;
    fullName: string;
    email: string;
    locale: string;
    moodleUserId: number | null;
  };
  expiresAt: string;
};

export type PublicMyCoursesResponse = {
  user: {
    id: string;
    fullName: string;
    email: string;
    locale: string;
    moodleUserId: number | null;
  };
  localCourses: Array<{
    moodle_course_id: number;
    status: string;
    enrolled_at: string;
    synced_at: string;
    full_name: string | null;
    short_name: string | null;
    visible: boolean | null;
  }>;
  moodleCourses: Array<Record<string, unknown>>;
  progressRecords: PublicCourseProgressRecord[];
};


export type LegalPageResponse = {
  id: number;
  slug: string;
  title: string;
  html: string;
  modifiedAt: string | null;
  sourceUrl: string | null;
};

export type WebinarRecord = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  hero_image: string;
  source_type: 'youtube' | 'external' | 'hls' | 'vimeo' | 'zoom';
  source_url: string;
  replay_url: string | null;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  cta_label: string;
  is_active: boolean;
  show_on_landing: boolean;
  webinar_links: Array<{
    platform: string;
    url: string;
  }>;
  free_reservation_url: string | null;
  vip_reservation_url: string | null;
  /**
   * Traducción al inglés. La API la devuelve con COALESCE sobre el campo en
   * español, así que nunca llega vacía aunque nadie la haya rellenado.
   */
  title_en: string;
  subtitle_en: string | null;
  description_en: string | null;
  cta_label_en: string;
  created_at: string;
  updated_at: string;
};

export type PodcastRecord = {
  id: string;
  title: string;
  /** Igual que en los webinars: viene con COALESCE sobre el título español. */
  title_en: string;
  video_code: string;
  video_url: string;
  published_at: string;
  is_active: boolean;
  show_on_landing: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
};

export type CompanyRecord = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  contact_email: string | null;
  tenant_id: string;
  representative_user_id: string | null;
  representative_name?: string | null;
  representative_email?: string | null;
  is_active: boolean;
  members_total?: number;
  created_at: string;
  updated_at: string;
};

export type CompanyMemberRecord = {
  company_id: string;
  user_id: string;
  member_role: 'representative' | 'collaborator';
  status: 'active' | 'inactive';
  full_name: string;
  email: string;
  locale: string;
  roles: string[];
  moodle_user_id: number | null;
  created_at: string;
  updated_at: string;
  assigned_groups: { id: string; name: string }[];
  assigned_courses: { id: number; name: string }[];
};

export type CompanyCourseAccessRecord = {
  company_id: string;
  moodle_course_id: number;
  is_active: boolean;
  assigned_by_user_id: string | null;
  full_name: string | null;
  short_name: string | null;
  visible: boolean | null;
  created_at: string;
  updated_at: string;
};

export type CompanyDashboardStats = {
  totalMembers: number;
  activeMembers: number;
  totalEnrollments: number;
  averageProgress: number;
  totalInteractions: number;
  lastActivity: string | null;
};

export type CompanyUserProgressRecord = {
  user_id: string;
  full_name: string;
  email: string;
  member_status: string;
  moodle_course_id: number;
  course_name: string;
  progress_percent: number;
  interactions_count: number;
  last_activity_at: string | null;
};

export type CompanyCourseGroup = {
  id: string;
  company_id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  items: { moodle_course_id: number; full_name?: string; short_name?: string }[];
};

export type MemberCourseGroupAssoc = {
  id: string;
  name: string;
  description: string;
};

export type MemberCourseAssoc = {
  moodle_course_id: number;
  full_name?: string;
  short_name?: string;
};
export type EnterpriseOverviewResponse = {
  available: boolean;
  role: 'representative' | 'collaborator' | null;
  company: CompanyRecord | null;
  members: CompanyMemberRecord[];
  courseAccess: CompanyCourseAccessRecord[];
  stats?: CompanyDashboardStats;
  memberProgress?: CompanyUserProgressRecord[];
};

export type AcademicTermRecord = {
  id: string;
  name: string;
  code: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  created_at: string;
};

export type DepartmentRecord = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  dean_name: string | null;
  created_at: string;
};

export type DegreeProgram = {
  id: string;
  name: string;
  code: string;
  degree_level: 'certificate' | 'associate' | 'bachelor' | 'master' | 'doctoral' | 'professional';
  credit_hours_required: number;
  description: string | null;
  is_active: boolean;
  department_name: string | null;
};

export type TranscriptRecord = {
  id: string;
  moodle_course_id: number;
  status: 'enrolled' | 'withdrawn' | 'completed' | 'auditing';
  grade: string | null;
  grade_points: number | null;
  credit_hours: number;
  enrolled_at: string;
  completed_at: string | null;
  term_name: string;
  term_code: string;
  course_name: string | null;
};

export type GpaRecord = {
  cumulative_gpa: number | null;
  completed_credits: number;
  total_enrollments: number;
};

export type BillingLedgerEntry = {
  id: string;
  kind: string;
  description: string;
  amount_cents: number | string;
  currency: string;
  balance_cents: number | string;
  term_id: string | null;
  created_at: string;
};

export type BillingInvoice = {
  id: string;
  term_id: string | null;
  status: string;
  total_cents: number | string;
  currency: string;
  stripe_invoice_id: string | null;
  due_date: string | null;
  created_at: string;
};

export type BillingHold = {
  id: string;
  hold_type: string;
  reason: string;
  active: boolean;
  created_at: string;
  released_at: string | null;
};

export type BillingResponse = {
  balanceCents: number;
  currency: string;
  ledger: BillingLedgerEntry[];
  invoices: BillingInvoice[];
  holds: BillingHold[];
};

export type CertificateRecord = {
  id: string;
  title: string;
  kind: string;
  serial: string;
  verification_code: string;
  moodle_course_id: number | null;
  degree_program_id: string | null;
  issued_at: string;
  course_name: string | null;
  degree_program_name: string | null;
};

export type CompetencyRecord = {
  id: string;
  competency_id: string;
  status: 'not_started' | 'in_progress' | 'mastered' | string;
  evidence: string | null;
  achieved_at: string | null;
  competency_name: string;
  competency_code: string;
  description: string | null;
};

/**
 * Etapa I — Programa del catálogo público, servido por `GET /v1/programs`.
 * Sale de `degree_programs`, que tiene un único `name` (no un par ES/EN).
 */
export type PublicProgram = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  degreeLevel: string;
  creditHours: number | null;
};

export type PublicProgramsResponse = {
  locale: 'es' | 'en';
  programs: PublicProgram[];
};

export type ContactSubmitPayload = {
  fullName: string;
  email: string;
  phone?: string | null;
  programId?: string | null;
  subject?: string | null;
  message: string;
  locale?: 'es' | 'en';
  /** Honeypot: la API descarta el envío si llega con contenido. */
  company?: string;
};

export type ContactSubmitResponse = {
  received: boolean;
  id: string;
};

export const api = {
  home: () => fetchJson<HomeResponse>('/v1/home'),
  catalog: () => fetchJson<ContentAsset[]>('/v1/catalog'),
  webinars: () => fetchJson<WebinarRecord[]>('/v1/webinars'),
  podcasts: () => fetchJson<PodcastRecord[]>('/v1/podcasts'),
  catalogBySlug: (slug: string) => fetchJson<CatalogContentDetailResponse>(`/v1/catalog/${encodeURIComponent(slug)}`),
  terms: () => fetchJson<AcademicTermRecord[]>('/v1/terms'),
  degrees: () => fetchJson<DegreeProgram[]>('/v1/degrees'),
  publicPrograms: (locale: 'es' | 'en') =>
    fetchJson<PublicProgramsResponse>(`/v1/programs?locale=${encodeURIComponent(locale)}`),
  submitContact: (payload: ContactSubmitPayload) =>
    fetchJson<ContactSubmitResponse>('/v1/contact', { method: 'POST', body: payload }),
  publicAuth: {
    register: (payload: { fullName: string; email: string; password: string; locale?: string }) =>
      fetchJson<{
        registered: boolean;
        token: string;
        expiresAt: string;
        user: {
          id: string;
          fullName: string;
          email: string;
          locale: string;
          moodleUserId: number | null;
        };
      }>('/v1/auth/register', {
        method: 'POST',
        body: payload
      }),
    login: (payload: { email: string; password: string }) =>
      fetchJson<{
        authenticated: boolean;
        token: string;
        expiresAt: string;
        user: {
          id: string;
          fullName: string;
          email: string;
          locale: string;
        };
      }>('/v1/auth/login', {
        method: 'POST',
        body: payload
      }),
    me: (token: string) =>
      fetchJson<{
        authenticated: boolean;
        user: {
          id: string;
          fullName: string;
          email: string;
          locale: string;
        };
        expiresAt: string;
      }>('/v1/auth/me', {
        auth: { token }
      }),
    updateMe: (
      token: string,
      payload: {
        fullName?: string;
        email?: string;
        locale?: string;
      }
    ) =>
      fetchJson<PublicProfileUpdateResponse>('/v1/auth/me', {
        method: 'PATCH',
        body: payload,
        auth: { token }
      }),
    meCourses: (token: string) =>
      fetchJson<PublicMyCoursesResponse>('/v1/me/courses', {
        auth: { token }
      }),
    enterpriseOverview: (token: string) =>
      fetchJson<EnterpriseOverviewResponse>('/v1/enterprise/overview', {
        auth: { token }
      }),
    enterpriseCreateMember: (
      token: string,
      payload: {
        userId?: string;
        fullName?: string;
        email?: string;
        locale?: string;
        role?: 'representative' | 'collaborator';
      }
    ) =>
      fetchJson<{
        created: boolean;
        member: CompanyMemberRecord;
        user: {
          id: string;
          full_name: string;
          email: string;
          locale: string;
          moodle_user_id: number | null;
        };
      }>('/v1/enterprise/members', {
        method: 'POST',
        auth: { token },
        body: payload
      }),
    enterpriseUpdateMemberStatus: (
      token: string,
      userId: string,
      payload: { status: 'active' | 'inactive' }
    ) =>
      fetchJson<{ updated: boolean; member: CompanyMemberRecord }>(`/v1/enterprise/members/${encodeURIComponent(userId)}/status`, {
        method: 'PATCH',
        auth: { token },
        body: payload
      }),
    enterpriseUpsertCourseAccess: (
      token: string,
      moodleCourseId: number,
      payload: { isActive?: boolean }
    ) =>
      fetchJson<{ updated: boolean; access: CompanyCourseAccessRecord }>(
        `/v1/enterprise/courses/${moodleCourseId}`,
        {
          method: 'PUT',
          auth: { token },
          body: payload
        }
      ),
    enterpriseRemoveCourseAccess: (token: string, moodleCourseId: number) =>
      fetchJson<{ deleted: boolean }>(`/v1/enterprise/courses/${moodleCourseId}`, {
        method: 'DELETE',
        auth: { token }
      }),
    enterpriseGroups: (token: string) =>
      fetchJson<CompanyCourseGroup[]>('/v1/enterprise/groups', {
        auth: { token }
      }),
    enterpriseCreateGroup: (token: string, payload: { name: string; description?: string }) =>
      fetchJson<CompanyCourseGroup>('/v1/enterprise/groups', {
        method: 'POST',
        auth: { token },
        body: payload
      }),
    enterpriseUpdateGroup: (token: string, groupId: string, payload: { name?: string; description?: string }) =>
      fetchJson<{ success: boolean }>(`/v1/enterprise/groups/${encodeURIComponent(groupId)}`, {
        method: 'PUT',
        auth: { token },
        body: payload
      }),
    enterpriseDeleteGroup: (token: string, groupId: string) =>
      fetchJson<{ deleted: boolean }>(`/v1/enterprise/groups/${encodeURIComponent(groupId)}`, {
        method: 'DELETE',
        auth: { token }
      }),
    enterpriseAddCourseToGroup: (token: string, groupId: string, moodleCourseId: number) =>
      fetchJson<{ success: boolean }>(
        `/v1/enterprise/groups/${encodeURIComponent(groupId)}/courses/${moodleCourseId}`,
        {
          method: 'POST',
          auth: { token }
        }
      ),
    enterpriseRemoveCourseFromGroup: (token: string, groupId: string, moodleCourseId: number) =>
      fetchJson<{ removed: boolean }>(
        `/v1/enterprise/groups/${encodeURIComponent(groupId)}/courses/${moodleCourseId}`,
        {
          method: 'DELETE',
          auth: { token }
        }
      ),
    enterpriseMemberGroups: (token: string, userId: string) =>
      fetchJson<MemberCourseGroupAssoc[]>(`/v1/enterprise/members/${encodeURIComponent(userId)}/groups`, {
        auth: { token }
      }),
    enterpriseAddGroupToMember: (token: string, userId: string, groupId: string) =>
      fetchJson<{ success: boolean }>(
        `/v1/enterprise/members/${encodeURIComponent(userId)}/groups/${encodeURIComponent(groupId)}`,
        {
          method: 'POST',
          auth: { token }
        }
      ),
    enterpriseRemoveGroupFromMember: (token: string, userId: string, groupId: string) =>
      fetchJson<{ removed: boolean }>(
        `/v1/enterprise/members/${encodeURIComponent(userId)}/groups/${encodeURIComponent(groupId)}`,
        {
          method: 'DELETE',
          auth: { token }
        }
      ),
    enterpriseMemberCourses: (token: string, userId: string) =>
      fetchJson<MemberCourseAssoc[]>(`/v1/enterprise/members/${encodeURIComponent(userId)}/courses`, {
        auth: { token }
      }),
    enterpriseAddCourseToMember: (token: string, userId: string, moodleCourseId: number) =>
      fetchJson<{ success: boolean }>(
        `/v1/enterprise/members/${encodeURIComponent(userId)}/courses/${moodleCourseId}`,
        {
          method: 'POST',
          auth: { token }
        }
      ),
    enterpriseRemoveCourseFromMember: (token: string, userId: string, moodleCourseId: number) =>
      fetchJson<{ removed: boolean }>(
        `/v1/enterprise/members/${encodeURIComponent(userId)}/courses/${moodleCourseId}`,
        {
          method: 'DELETE',
          auth: { token }
        }
      ),
    transcript: (token: string) =>
      fetchJson<TranscriptRecord[]>('/v1/me/transcript', { auth: { token } }),
    gpa: (token: string) =>
      fetchJson<GpaRecord>('/v1/me/gpa', { auth: { token } }),
    billing: (token: string) =>
      fetchJson<BillingResponse>('/v1/me/billing', { auth: { token } }),
    pay: (token: string, payload: { amountCents?: number; invoiceId?: string; currency?: string }) =>
      fetchJson<{ clientSecret?: string; paymentId?: string; configured?: boolean; message?: string }>(
        '/v1/me/pay',
        { method: 'POST', body: payload, auth: { token } }
      ),
    certificates: (token: string) =>
      fetchJson<CertificateRecord[]>('/v1/me/certificates', { auth: { token } }),
    competencies: (token: string) =>
      fetchJson<CompetencyRecord[]>('/v1/me/competencies', { auth: { token } })
  },
  courseContent: (moodleCourseId: number, token: string) =>
    fetchJson<MoodleCourseContentResponse>(`/v1/courses/${moodleCourseId}/content`, {
      auth: { token }
    }),
  moodleFileUrl: (url: string, token: string) =>
    `${API_URL}/v1/moodle/file?url=${encodeURIComponent(url)}&authToken=${encodeURIComponent(token)}`,
  submitPublicCourseInteraction: (
    moodleCourseId: number,
    moduleId: number,
    payload: {
      moduleName: string;
      moduleType: string;
      response: Record<string, unknown>;
      progress?: {
        completedModuleIds: number[];
        interactionsCount: number;
        xp: number;
        totalModules: number;
        progressPercent: number;
        lastActivityAt?: string;
      };
    },
    token: string
  ) =>
    fetchJson<PublicCourseInteractionResponse>(`/v1/courses/${moodleCourseId}/modules/${moduleId}/respond`, {
      method: 'POST',
      body: payload,
      auth: { token }
    }),
  courseProgress: (moodleCourseId: number, token: string) =>
    fetchJson<{ found: boolean; progress: PublicCourseProgressRecord | null }>(`/v1/courses/${moodleCourseId}/progress`, {
      auth: { token }
    }),
  saveCourseProgress: (
    moodleCourseId: number,
    payload: {
      completedModuleIds: number[];
      interactionsCount: number;
      xp: number;
      totalModules: number;
      progressPercent: number;
      lastActivityAt?: string;
    },
    token: string
  ) =>
    fetchJson<{ saved: boolean; progress: PublicCourseProgressRecord }>(`/v1/courses/${moodleCourseId}/progress`, {
      method: 'PUT',
      body: payload,
      auth: { token }
    }),
  completeCourseModule: (
    moodleCourseId: number,
    moduleId: number,
    payload: {
      completedModuleIds: number[];
      interactionsCount: number;
      xp: number;
      totalModules: number;
      progressPercent: number;
      lastActivityAt?: string;
    },
    token: string
  ) =>
    fetchJson<{ saved: boolean; progress: PublicCourseProgressRecord; moodleCompletionSynced: boolean }>(
      `/v1/courses/${moodleCourseId}/modules/${moduleId}/complete`,
      {
        method: 'POST',
        body: payload,
        auth: { token }
      }
    ),
  courseInteractions: (moodleCourseId: number, token: string) =>
    fetchJson<{ moodleCourseId: number; interactions: PublicCourseInteractionRecord[] }>(
      `/v1/courses/${moodleCourseId}/interactions`,
      {
        auth: { token }
      }
    ),
  offers: () => fetchJson<Offer[]>('/v1/offers'),
  entitlements: () => fetchJson<Entitlement[]>('/v1/entitlements'),
  blueprint: () => fetchJson<PlatformBlueprintResponse>('/v1/blueprint'),
  legalTerms: () => fetchJson<LegalPageResponse>('/v1/legal/terms'),
  legalPrivacy: () => fetchJson<LegalPageResponse>('/v1/legal/privacy'),
  admin: {
    login: (email: string, password: string) =>
      fetchJson<AdminSession>('/admin/auth/login', {
        method: 'POST',
        body: { email, password }
      }),
    me: (token: string) =>
      fetchJson<Omit<AdminSession, 'token'>>('/admin/auth/me', {
        auth: { token }
      }),
    logout: (token: string) =>
      fetchJson<{ loggedOut: boolean }>('/admin/auth/logout', {
        method: 'POST',
        auth: { token }
      }),
    config: (token: string) => fetchJson<AdminConfig>('/admin/config', { auth: { token } }),
    status: (token: string) => fetchJson<AdminStatus>('/admin/status', { auth: { token } }),
    routes: (token: string) => fetchJson<AdminRouteRegistry>('/admin/routes', { auth: { token } }),
    tenants: (token: string) =>
      fetchJson<
        Array<{
          id: string;
          slug: string;
          name: string;
          locales: string[];
          currency: string;
          created_at: string;
        }>
      >('/admin/tenants', { auth: { token } }),
    moodleCourses: (token: string) => fetchJson<MoodleCoursesResponse>('/admin/moodle/courses', { auth: { token } }),
    moodleCoursesPage: (
      token: string,
      input: { page: number; pageSize: number; q?: string; visible?: boolean }
    ) => {
      const params = new URLSearchParams();
      params.set('page', String(input.page));
      params.set('pageSize', String(input.pageSize));
      if (input.q) {
        params.set('q', input.q);
      }
      if (typeof input.visible === 'boolean') {
        params.set('visible', input.visible ? 'true' : 'false');
      }
      return fetchJson<MoodleCoursesResponse>(`/admin/moodle/courses?${params.toString()}`, { auth: { token } });
    },
    moodleSyncCourses: (token: string) =>
      fetchJson<MoodleSyncResponse>('/admin/moodle/sync/courses', { method: 'POST', auth: { token } }),
    moodleSyncUsers: (token: string) =>
      fetchJson<MoodleUsersSyncResponse>('/admin/moodle/sync/users', { method: 'POST', auth: { token } }),
    moodleSyncEnterprise: (token: string) =>
      fetchJson<{ synced: boolean; upsertedMembers: number; error: string | null }>('/admin/moodle/sync/enterprise', { method: 'POST', auth: { token } }),
    moodleSyncCategories: (token: string) =>
      fetchJson<MoodleCategoriesSyncResponse>('/admin/moodle/sync/categories', { method: 'POST', auth: { token } }),
    moodleSyncAll: (token: string) =>
      fetchJson<MoodleSyncAllResponse>('/admin/moodle/sync/all', { method: 'POST', auth: { token } }),
    moodleConfig: (token: string) =>
      fetchJson<{ configured: boolean; baseUrl: string | null; tokenSet: boolean }>('/admin/moodle/config', {
        auth: { token }
      }),
    updateMoodleConfig: (token: string, payload: { baseUrl: string; token?: string }) =>
      fetchJson<{ updated: boolean; configured: boolean; connected: boolean; baseUrl: string; siteInfo?: Record<string, unknown> }>(
        '/admin/moodle/config',
        { method: 'PUT', auth: { token }, body: payload }
      ),
    usersPage: (
      token: string,
      input: { page: number; pageSize: number; q?: string; status?: 'active' | 'inactive' }
    ) => {
      const params = new URLSearchParams();
      params.set('page', String(input.page));
      params.set('pageSize', String(input.pageSize));
      if (input.q) {
        params.set('q', input.q);
      }
      if (input.status) {
        params.set('status', input.status);
      }
      return fetchJson<PaginatedAdminUsersResponse>(`/admin/users?${params.toString()}`, { auth: { token } });
    },
    createUser: (
      token: string,
      payload: { fullName: string; email: string; locale: string; roles: string[]; tenantId?: string }
    ) =>
      fetchJson<CreateAdminUserResponse>('/admin/users', {
        method: 'POST',
        auth: { token },
        body: payload
      }),
    enrollUserInCourse: (
      token: string,
      userId: string,
      payload: { moodleCourseId: number; roleId?: number }
    ) =>
      fetchJson<{ enrolled: boolean; userId: string; moodleCourseId: number }>(
        `/admin/users/${userId}/enrollments`,
        {
          method: 'POST',
          auth: { token },
          body: payload
        }
      ),
    userCourses: (token: string, userId: string) =>
      fetchJson<UserCoursesResponse>(`/admin/users/${userId}/courses`, { auth: { token } }),
    updateUserStatus: (
      token: string,
      userId: string,
      payload: { status: 'active' | 'inactive'; syncMoodle?: boolean }
    ) =>
      fetchJson<{
        updated: boolean;
        userId: string;
        status: 'active' | 'inactive';
        updatedUsers: number;
        updatedEnrollments: number;
      }>(`/admin/users/${userId}/status`, {
        method: 'PATCH',
        auth: { token },
        body: payload
      }),
    bulkUpdateUserStatus: (
      token: string,
      payload: { userIds: string[]; status: 'active' | 'inactive'; syncMoodle?: boolean }
    ) =>
      fetchJson<{
        processed: number;
        requested: number;
        status: 'active' | 'inactive';
        failures: Array<{ userId: string; reason: string }>;
        updatedUsers: number;
        updatedEnrollments: number;
      }>('/admin/users/status/bulk', {
        method: 'POST',
        auth: { token },
        body: payload
      }),
    webinars: (token: string) => fetchJson<WebinarRecord[]>('/admin/webinars', { auth: { token } }),
    podcasts: (token: string) => fetchJson<PodcastRecord[]>('/admin/podcasts', { auth: { token } }),
    createWebinar: (
      token: string,
      payload: {
        slug: string;
        title: string;
        subtitle?: string;
        description?: string;
        heroImage: string;
        sourceType: 'youtube' | 'external' | 'hls' | 'vimeo' | 'zoom';
        sourceUrl: string;
        replayUrl?: string;
        startsAt: string;
        endsAt?: string;
        timezone?: string;
        ctaLabel?: string;
        isActive?: boolean;
        showOnLanding?: boolean;
        webinarLinks?: Array<{ platform: string; url: string }>;
        freeReservationUrl?: string;
        vipReservationUrl?: string;
      }
    ) =>
      fetchJson<{ created: boolean; webinar: WebinarRecord }>('/admin/webinars', {
        method: 'POST',
        auth: { token },
        body: payload
      }),
    updateWebinar: (
      token: string,
      webinarId: string,
      payload: Partial<{
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
      }>
    ) =>
      fetchJson<{ updated: boolean; webinar: WebinarRecord }>(`/admin/webinars/${webinarId}`, {
        method: 'PATCH',
        auth: { token },
        body: payload
      }),
    deleteWebinar: (token: string, webinarId: string) =>
      fetchJson<{ deleted: boolean }>(`/admin/webinars/${webinarId}`, {
        method: 'DELETE',
        auth: { token }
      }),
    createPodcast: (
      token: string,
      payload: {
        title: string;
        video: string;
        publishedAt: string;
        isActive?: boolean;
        showOnLanding?: boolean;
        displayOrder?: number;
      }
    ) =>
      fetchJson<{ created: boolean; podcast: PodcastRecord }>('/admin/podcasts', {
        method: 'POST',
        auth: { token },
        body: payload
      }),
    updatePodcast: (
      token: string,
      podcastId: string,
      payload: Partial<{
        title: string;
        video: string;
        publishedAt: string;
        isActive: boolean;
        showOnLanding: boolean;
        displayOrder: number;
      }>
    ) =>
      fetchJson<{ updated: boolean; podcast: PodcastRecord }>(`/admin/podcasts/${podcastId}`, {
        method: 'PATCH',
        auth: { token },
        body: payload
      }),
    deletePodcast: (token: string, podcastId: string) =>
      fetchJson<{ deleted: boolean }>(`/admin/podcasts/${podcastId}`, {
        method: 'DELETE',
        auth: { token }
      }),
    companies: (token: string) => fetchJson<CompanyRecord[]>('/admin/companies', { auth: { token } }),
    createCompany: (
      token: string,
      payload: {
        slug?: string;
        name: string;
        description?: string;
        contactEmail?: string;
        representativeUserId: string;
        tenantId?: string;
        isActive?: boolean;
      }
    ) =>
      fetchJson<{ created: boolean; company: CompanyRecord }>('/admin/companies', {
        method: 'POST',
        auth: { token },
        body: payload
      }),
    updateCompany: (
      token: string,
      companyId: string,
      payload: Partial<{
        slug: string;
        name: string;
        description: string | null;
        contactEmail: string | null;
        representativeUserId: string | null;
        isActive: boolean;
      }>
    ) =>
      fetchJson<{ updated: boolean; company: CompanyRecord }>(`/admin/companies/${encodeURIComponent(companyId)}`, {
        method: 'PATCH',
        auth: { token },
        body: payload
      }),
    deleteCompany: (token: string, companyId: string) =>
      fetchJson<{ deleted: boolean }>(`/admin/companies/${encodeURIComponent(companyId)}`, {
        method: 'DELETE',
        auth: { token }
      }),
    companyMembers: (token: string, companyId: string) =>
      fetchJson<CompanyMemberRecord[]>(`/admin/companies/${encodeURIComponent(companyId)}/members`, {
        auth: { token }
      }),
    addCompanyMember: (
      token: string,
      companyId: string,
      payload: {
        userId?: string;
        fullName?: string;
        email?: string;
        locale?: string;
        role?: 'representative' | 'collaborator';
      }
    ) =>
      fetchJson<{
        created: boolean;
        member: CompanyMemberRecord;
        user: {
          id: string;
          full_name: string;
          email: string;
          locale: string;
          moodle_user_id: number | null;
        };
      }>(`/admin/companies/${encodeURIComponent(companyId)}/members`, {
        method: 'POST',
        auth: { token },
        body: payload
      }),
    updateCompanyMember: (
      token: string,
      companyId: string,
      userId: string,
      payload: { status?: 'active' | 'inactive'; fullName?: string; email?: string; role?: 'representative' | 'collaborator' }
    ) =>
      fetchJson<{ updated: boolean; member: CompanyMemberRecord }>(
        `/admin/companies/${encodeURIComponent(companyId)}/members/${encodeURIComponent(userId)}`,
        {
          method: 'PATCH',
          auth: { token },
          body: payload
        }
      ),
    deleteCompanyMember: (token: string, companyId: string, userId: string) =>
      fetchJson<{ deleted: boolean }>(
        `/admin/companies/${encodeURIComponent(companyId)}/members/${encodeURIComponent(userId)}`,
        {
          method: 'DELETE',
          auth: { token }
        }
      ),
    companyCourseAccess: (token: string, companyId: string) =>
      fetchJson<CompanyCourseAccessRecord[]>(`/admin/companies/${encodeURIComponent(companyId)}/courses`, {
        auth: { token }
      }),
    companyStats: (token: string, companyId: string) =>
      fetchJson<{ stats: CompanyDashboardStats; memberProgress: CompanyUserProgressRecord[] }>(
        `/admin/companies/${encodeURIComponent(companyId)}/stats`,
        { auth: { token } }
      ),
    upsertCompanyCourseAccess: (
      token: string,
      companyId: string,
      moodleCourseId: number,
      payload: { isActive?: boolean }
    ) =>
      fetchJson<{ updated: boolean; access: CompanyCourseAccessRecord }>(
        `/admin/companies/${encodeURIComponent(companyId)}/courses/${moodleCourseId}`,
        {
          method: 'PUT',
          auth: { token },
          body: payload
        }
      ),
    deleteCompanyCourseAccess: (token: string, companyId: string, moodleCourseId: number) =>
      fetchJson<{ deleted: boolean }>(
        `/admin/companies/${encodeURIComponent(companyId)}/courses/${moodleCourseId}`,
        {
          method: 'DELETE',
          auth: { token }
        }
      ),

    companyCourseGroups: (token: string, companyId: string) =>
      fetchJson<CompanyCourseGroup[]>(`/admin/companies/${encodeURIComponent(companyId)}/groups`, { auth: { token } }),
    createCompanyCourseGroup: (token: string, companyId: string, payload: { name: string; description?: string }) =>
      fetchJson<{ created: CompanyCourseGroup }>(`/admin/companies/${encodeURIComponent(companyId)}/groups`, {
        method: 'POST',
        auth: { token },
        body: payload
      }),
    updateCompanyCourseGroup: (token: string, companyId: string, groupId: string, payload: { name?: string; description?: string }) =>
      fetchJson<{ updated: CompanyCourseGroup }>(`/admin/companies/${encodeURIComponent(companyId)}/groups/${encodeURIComponent(groupId)}`, {
        method: 'PATCH',
        auth: { token },
        body: payload
      }),
    deleteCompanyCourseGroup: (token: string, companyId: string, groupId: string) =>
      fetchJson<{ deleted: boolean }>(`/admin/companies/${encodeURIComponent(companyId)}/groups/${encodeURIComponent(groupId)}`, {
        method: 'DELETE',
        auth: { token }
      }),
    addCourseToCompanyGroup: (token: string, companyId: string, groupId: string, moodleCourseId: number) =>
      fetchJson<{ added: boolean }>(`/admin/companies/${encodeURIComponent(companyId)}/groups/${encodeURIComponent(groupId)}/courses/${moodleCourseId}`, {
        method: 'PUT',
        auth: { token }
      }),
    removeCourseFromCompanyGroup: (token: string, companyId: string, groupId: string, moodleCourseId: number) =>
      fetchJson<{ deleted: boolean }>(`/admin/companies/${encodeURIComponent(companyId)}/groups/${encodeURIComponent(groupId)}/courses/${moodleCourseId}`, {
        method: 'DELETE',
        auth: { token }
      }),
    companyMemberAssignments: (token: string, companyId: string, userId: string) =>
      fetchJson<{ groups: MemberCourseGroupAssoc[], courses: MemberCourseAssoc[] }>(`/admin/companies/${encodeURIComponent(companyId)}/members/${encodeURIComponent(userId)}/assignments`, { auth: { token } }),
    addGroupToCompanyMember: (token: string, companyId: string, userId: string, groupId: string) =>
      fetchJson<{ added: boolean }>(`/admin/companies/${encodeURIComponent(companyId)}/members/${encodeURIComponent(userId)}/groups/${encodeURIComponent(groupId)}`, {
        method: 'PUT',
        auth: { token }
      }),
    removeGroupFromCompanyMember: (token: string, companyId: string, userId: string, groupId: string) =>
      fetchJson<{ deleted: boolean }>(`/admin/companies/${encodeURIComponent(companyId)}/members/${encodeURIComponent(userId)}/groups/${encodeURIComponent(groupId)}`, {
        method: 'DELETE',
        auth: { token }
      }),
    addCourseToCompanyMember: (token: string, companyId: string, userId: string, moodleCourseId: number) =>
      fetchJson<{ added: boolean }>(`/admin/companies/${encodeURIComponent(companyId)}/members/${encodeURIComponent(userId)}/courses/${moodleCourseId}`, {
        method: 'PUT',
        auth: { token }
      }),
    removeCourseFromCompanyMember: (token: string, companyId: string, userId: string, moodleCourseId: number) =>
      fetchJson<{ deleted: boolean }>(`/admin/companies/${encodeURIComponent(companyId)}/members/${encodeURIComponent(userId)}/courses/${moodleCourseId}`, {
        method: 'DELETE',
        auth: { token }
      }),
    terms: (token: string) =>
      fetchJson<AcademicTermRecord[]>('/admin/terms', { auth: { token } }),
    createTerm: (token: string, payload: { name: string; code: string; startDate: string; endDate: string; isActive?: boolean }) =>
      fetchJson<AcademicTermRecord>('/admin/terms', { method: 'POST', auth: { token }, body: payload }),
    departments: (token: string) =>
      fetchJson<DepartmentRecord[]>('/admin/departments', { auth: { token } }),
    createDepartment: (token: string, payload: { name: string; code: string; description?: string; deanName?: string }) =>
      fetchJson<DepartmentRecord>('/admin/departments', { method: 'POST', auth: { token }, body: payload }),
    degreePrograms: (token: string) =>
      fetchJson<DegreeProgram[]>('/admin/degree-programs', { auth: { token } }),
    createDegreeProgram: (token: string, payload: { name: string; code: string; degreeLevel: string; departmentId?: string; creditHoursRequired?: number; description?: string }) =>
      fetchJson<DegreeProgram>('/admin/degree-programs', { method: 'POST', auth: { token }, body: payload })
  }
};
