import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  demoCatalog,
  demoEntitlements,
  demoOffers,
  demoTenant,
  demoUser,
  type ContentAsset,
  type Entitlement,
  type Offer
} from '@pae-u/shared';
import { config } from './config.js';

export const pool = new Pool({ connectionString: config.db.url });

type MoodleCourseRow = {
  id: number;
  fullname: string;
  shortname: string;
  categoryid?: number;
  visible?: number;
  startdate?: number;
  enddate?: number;
  summary?: string;
  lang?: string;
  timemodified?: number;
};

type MoodleCategoryRow = {
  id: number;
  name: string;
  idnumber?: string;
  parent?: number;
  depth?: number;
  path?: string;
  visible?: number;
};

type MoodleUserRow = {
  id: number;
  username: string;
  firstname: string;
  lastname: string;
  fullname?: string;
  email?: string;
  suspended?: number;
  deleted?: number;
  lang?: string;
};

type WebinarInput = {
  slug: string;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  heroImage: string;
  sourceType: 'youtube' | 'external' | 'hls' | 'vimeo' | 'zoom';
  sourceUrl: string;
  replayUrl?: string | null;
  startsAt: string;
  endsAt?: string | null;
  timezone?: string | null;
  ctaLabel?: string | null;
  isActive?: boolean;
  showOnLanding?: boolean;
  webinarLinks?: Array<{
    platform: string;
    url: string;
  }>;
  freeReservationUrl?: string | null;
  vipReservationUrl?: string | null;
};

type PodcastInput = {
  title: string;
  videoCode: string;
  videoUrl: string;
  publishedAt: string;
  isActive?: boolean;
  showOnLanding?: boolean;
  displayOrder?: number;
};

type ExternalIntegrationEventInput = {
  externalEventId: string;
  title: string;
  description?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  isActive: boolean;
  eventUrl?: string | null;
  venue?: string | null;
  modality?: string | null;
  bannerUrl?: string | null;
  bannerFrameUrl?: string | null;
  emailBannerUrl?: string | null;
  ticketFrameUrl?: string | null;
  disclaimerUrl?: string | null;
  groupKey: string;
  groupLabel: string;
  tier: 'general' | 'vip' | 'virtual' | 'diamante' | 'other';
  visibleOnLanding?: boolean;
  displayOrder?: number;
  raw: Record<string, unknown>;
};

function toSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

const courseHeroPool = [
  'https://images.unsplash.com/photo-1513258496099-48168024aec0?auto=format&fit=crop&w=1400&q=80',
  'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=1400&q=80',
  'https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1400&q=80',
  'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?auto=format&fit=crop&w=1400&q=80',
  'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1400&q=80',
  'https://images.unsplash.com/photo-1542744173-8e7e53415bb0?auto=format&fit=crop&w=1400&q=80',
  'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1400&q=80',
  'https://images.unsplash.com/photo-1497633762265-9d179a990aa6?auto=format&fit=crop&w=1400&q=80',
  'https://images.unsplash.com/photo-1529070538774-1843cb3265df?auto=format&fit=crop&w=1400&q=80',
  'https://images.unsplash.com/photo-1461749280684-dccba630e2f6?auto=format&fit=crop&w=1400&q=80',
  'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1400&q=80',
  'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?auto=format&fit=crop&w=1400&q=80'
];

const courseThemePool = [
  'Ruta práctica con clases cortas, actividades aplicadas y retos semanales.',
  'Entrenamiento intensivo orientado a resultados y desarrollo progresivo.',
  'Serie guiada para dominar fundamentos, práctica y evaluación final.',
  'Programa modular con contenidos accionables y avance por hitos.',
  'Aprendizaje enfocado en casos reales, ejercicios y feedback continuo.',
  'Trayecto de especialización con recursos descargables y actividades interactivas.'
];

async function createSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      locales TEXT[] NOT NULL,
      currency TEXT NOT NULL,
      branding JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      locale TEXT NOT NULL,
      roles TEXT[] NOT NULL,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS content_assets (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      kind TEXT NOT NULL,
      access_model TEXT NOT NULL,
      duration_minutes INTEGER,
      language TEXT NOT NULL,
      tags TEXT[] NOT NULL,
      hero_image TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS offers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      price NUMERIC(12,2) NOT NULL,
      currency TEXT NOT NULL,
      billing_period TEXT,
      type TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS entitlements (
      content_id TEXT PRIMARY KEY REFERENCES content_assets(id),
      granted BOOLEAN NOT NULL,
      reason TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS integration_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS moodle_courses (
      moodle_course_id BIGINT PRIMARY KEY,
      full_name TEXT NOT NULL,
      short_name TEXT NOT NULL,
      category_id BIGINT,
      visible BOOLEAN NOT NULL DEFAULT true,
      start_date TIMESTAMPTZ,
      end_date TIMESTAMPTZ,
      raw JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS moodle_categories (
      moodle_category_id BIGINT PRIMARY KEY,
      name TEXT NOT NULL,
      idnumber TEXT,
      parent_id BIGINT,
      depth INTEGER,
      path TEXT,
      visible BOOLEAN NOT NULL DEFAULT true,
      raw JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_course_enrollments (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      moodle_course_id BIGINT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, moodle_course_id)
    );

    CREATE TABLE IF NOT EXISTS public_course_interactions (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      moodle_course_id BIGINT NOT NULL,
      module_id BIGINT NOT NULL,
      module_name TEXT NOT NULL,
      module_type TEXT NOT NULL,
      response JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public_course_progress (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      moodle_course_id BIGINT NOT NULL,
      completed_module_ids BIGINT[] NOT NULL DEFAULT '{}',
      interactions_count INTEGER NOT NULL DEFAULT 0,
      xp INTEGER NOT NULL DEFAULT 0,
      total_modules INTEGER NOT NULL DEFAULT 0,
      progress_percent INTEGER NOT NULL DEFAULT 0,
      last_activity_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, moodle_course_id)
    );

    CREATE TABLE IF NOT EXISTS public_user_auth (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS webinars (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT,
      description TEXT,
      hero_image TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_url TEXT NOT NULL,
      replay_url TEXT,
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ,
      timezone TEXT NOT NULL DEFAULT 'America/Bogota',
      cta_label TEXT NOT NULL DEFAULT 'Reservar cupo',
      is_active BOOLEAN NOT NULL DEFAULT true,
      show_on_landing BOOLEAN NOT NULL DEFAULT true,
      webinar_links JSONB NOT NULL DEFAULT '[]'::jsonb,
      free_reservation_url TEXT,
      vip_reservation_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS webinars_starts_at_idx ON webinars(starts_at DESC);
    CREATE INDEX IF NOT EXISTS webinars_active_idx ON webinars(is_active, show_on_landing);
    ALTER TABLE webinars ADD COLUMN IF NOT EXISTS webinar_links JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE webinars ADD COLUMN IF NOT EXISTS free_reservation_url TEXT;
    ALTER TABLE webinars ADD COLUMN IF NOT EXISTS vip_reservation_url TEXT;

    CREATE TABLE IF NOT EXISTS podcasts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      video_code TEXT NOT NULL,
      video_url TEXT NOT NULL,
      published_at TIMESTAMPTZ NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      show_on_landing BOOLEAN NOT NULL DEFAULT true,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS podcasts_published_at_idx ON podcasts(published_at DESC);
    CREATE INDEX IF NOT EXISTS podcasts_active_idx ON podcasts(is_active, show_on_landing);
    ALTER TABLE podcasts ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;

    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      contact_email TEXT,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      representative_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS companies_tenant_idx ON companies(tenant_id, is_active);
    CREATE INDEX IF NOT EXISTS companies_rep_idx ON companies(representative_user_id);

    CREATE TABLE IF NOT EXISTS company_members (
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      member_role TEXT NOT NULL DEFAULT 'collaborator',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (company_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS company_members_user_idx ON company_members(user_id, status);

    CREATE TABLE IF NOT EXISTS company_course_access (
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      moodle_course_id BIGINT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      assigned_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (company_id, moodle_course_id)
    );
    CREATE INDEX IF NOT EXISTS company_course_access_active_idx ON company_course_access(company_id, is_active);

    CREATE TABLE IF NOT EXISTS company_course_groups (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS company_course_group_items (
      group_id TEXT NOT NULL REFERENCES company_course_groups(id) ON DELETE CASCADE,
      moodle_course_id BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (group_id, moodle_course_id)
    );

    CREATE TABLE IF NOT EXISTS company_member_courses (
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      moodle_course_id BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (company_id, user_id, moodle_course_id)
    );

    CREATE TABLE IF NOT EXISTS company_member_groups (
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      group_id TEXT NOT NULL REFERENCES company_course_groups(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (company_id, user_id, group_id)
    );

    CREATE TABLE IF NOT EXISTS external_integration_events (
      external_event_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      starts_at TIMESTAMPTZ,
      ends_at TIMESTAMPTZ,
      is_active BOOLEAN NOT NULL DEFAULT true,
      event_url TEXT,
      venue TEXT,
      modality TEXT,
      banner_url TEXT,
      banner_frame_url TEXT,
      email_banner_url TEXT,
      ticket_frame_url TEXT,
      disclaimer_url TEXT,
      group_key TEXT NOT NULL,
      group_label TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'other',
      visible_on_landing BOOLEAN NOT NULL DEFAULT true,
      display_order INTEGER NOT NULL DEFAULT 0,
      raw JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS external_integration_events_group_idx
      ON external_integration_events(group_key, tier, display_order, starts_at DESC);
    CREATE INDEX IF NOT EXISTS external_integration_events_active_idx
      ON external_integration_events(is_active, visible_on_landing);
    ALTER TABLE external_integration_events ADD COLUMN IF NOT EXISTS banner_url TEXT;
    ALTER TABLE external_integration_events ADD COLUMN IF NOT EXISTS banner_frame_url TEXT;
    ALTER TABLE external_integration_events ADD COLUMN IF NOT EXISTS email_banner_url TEXT;
    ALTER TABLE external_integration_events ADD COLUMN IF NOT EXISTS ticket_frame_url TEXT;
    ALTER TABLE external_integration_events ADD COLUMN IF NOT EXISTS disclaimer_url TEXT;

    ALTER TABLE public_course_interactions ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

    ALTER TABLE users ADD COLUMN IF NOT EXISTS moodle_user_id BIGINT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON users(email);
    CREATE UNIQUE INDEX IF NOT EXISTS users_moodle_user_id_unique_idx ON users(moodle_user_id)
      WHERE moodle_user_id IS NOT NULL;
  `);
}

async function seedTenantAndUser(): Promise<void> {
  await pool.query(
    `
      INSERT INTO tenants (id, slug, name, locales, currency, branding)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE
      SET slug = EXCLUDED.slug,
          name = EXCLUDED.name,
          locales = EXCLUDED.locales,
          currency = EXCLUDED.currency,
          branding = EXCLUDED.branding
    `,
    [
      demoTenant.id,
      demoTenant.slug,
      demoTenant.name,
      demoTenant.locales,
      demoTenant.currency,
      JSON.stringify(demoTenant.branding)
    ]
  );

  await pool.query(
    `
      INSERT INTO users (id, full_name, email, locale, roles, tenant_id, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE
      SET full_name = EXCLUDED.full_name,
          email = EXCLUDED.email,
          locale = EXCLUDED.locale,
          roles = EXCLUDED.roles,
          tenant_id = EXCLUDED.tenant_id,
          status = EXCLUDED.status
    `,
    [demoUser.id, demoUser.fullName, demoUser.email, demoUser.locale, demoUser.roles, demoUser.tenantId, 'active']
  );
}

async function upsertContentAsset(asset: ContentAsset): Promise<void> {
  await pool.query(
    `
      INSERT INTO content_assets
        (id, slug, title, summary, kind, access_model, duration_minutes, language, tags, hero_image, payload)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO UPDATE
      SET slug = EXCLUDED.slug,
          title = EXCLUDED.title,
          summary = EXCLUDED.summary,
          kind = EXCLUDED.kind,
          access_model = EXCLUDED.access_model,
          duration_minutes = EXCLUDED.duration_minutes,
          language = EXCLUDED.language,
          tags = EXCLUDED.tags,
          hero_image = EXCLUDED.hero_image,
          payload = EXCLUDED.payload
    `,
    [
      asset.id,
      asset.slug,
      asset.title,
      asset.summary,
      asset.kind,
      asset.accessModel,
      asset.durationMinutes ?? null,
      asset.language,
      asset.tags,
      asset.heroImage,
      JSON.stringify(asset)
    ]
  );
}

async function upsertOffer(offer: Offer): Promise<void> {
  await pool.query(
    `
      INSERT INTO offers (id, name, description, price, currency, billing_period, type)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          description = EXCLUDED.description,
          price = EXCLUDED.price,
          currency = EXCLUDED.currency,
          billing_period = EXCLUDED.billing_period,
          type = EXCLUDED.type
    `,
    [offer.id, offer.name, offer.description, offer.price, offer.currency, offer.billingPeriod ?? null, offer.type]
  );
}

async function upsertEntitlement(entitlement: Entitlement): Promise<void> {
  await pool.query(
    `
      INSERT INTO entitlements (content_id, granted, reason)
      VALUES ($1, $2, $3)
      ON CONFLICT (content_id) DO UPDATE
      SET granted = EXCLUDED.granted,
          reason = EXCLUDED.reason,
          updated_at = NOW()
    `,
    [entitlement.contentId, entitlement.granted, entitlement.reason]
  );
}

async function seedBaseData(): Promise<void> {
  await seedTenantAndUser();

  for (const asset of demoCatalog) {
    await upsertContentAsset(asset);
  }

  for (const offer of demoOffers) {
    await upsertOffer(offer);
  }

  for (const entitlement of demoEntitlements) {
    await upsertEntitlement(entitlement);
  }

  const hasWebinar = await pool.query(`SELECT id FROM webinars LIMIT 1`);
  if (!hasWebinar.rows[0]) {
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    nextMonth.setDate(15);
    nextMonth.setHours(19, 0, 0, 0);
    const endsAt = new Date(nextMonth.getTime() + 90 * 60000);
    await createWebinar({
      slug: 'webinar-mentalidad-ventas',
      title: 'Webinar en Vivo: Mentalidad y Ventas de Alto Impacto',
      subtitle: 'Masterclass mensual PAE-U',
      description:
        'Una sesión en vivo con estrategias accionables para mejorar conversión, energía comercial y foco de ejecución.',
      heroImage:
        'https://images.unsplash.com/photo-1515168833906-d2a3b82b302a?auto=format&fit=crop&w=1600&q=80',
      sourceType: 'youtube',
      sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      replayUrl: '',
      startsAt: nextMonth.toISOString(),
      endsAt: endsAt.toISOString(),
      timezone: 'America/Bogota',
      ctaLabel: 'Reservar cupo',
      isActive: true,
      showOnLanding: true,
      webinarLinks: [
        {
          platform: 'youtube',
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
        }
      ],
      freeReservationUrl: 'https://www.pasosalexito.com/',
      vipReservationUrl: ''
    });
  }

  const hasPodcast = await pool.query(`SELECT id FROM podcasts LIMIT 1`);
  if (!hasPodcast.rows[0]) {
    await createPodcast({
      title: 'Podcast PAE-U: Mentalidad, ventas y ejecución',
      videoCode: 'dQw4w9WgXcQ',
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      publishedAt: new Date().toISOString(),
      isActive: true,
      showOnLanding: true,
      displayOrder: 0
    });
  }
}

export async function initDb(): Promise<void> {
  await createSchema();
  await seedBaseData();
}

export async function getTenantAndUser() {
  const tenantResult = await pool.query(
    `SELECT id, slug, name, locales, currency, branding FROM tenants ORDER BY created_at DESC LIMIT 1`
  );
  const userResult = await pool.query(
    `SELECT id, full_name, email, locale, roles, tenant_id FROM users WHERE id = $1 LIMIT 1`,
    [demoUser.id]
  );

  return {
    tenant: tenantResult.rows[0]
      ? {
        id: tenantResult.rows[0].id,
        slug: tenantResult.rows[0].slug,
        name: tenantResult.rows[0].name,
        locales: tenantResult.rows[0].locales,
        currency: tenantResult.rows[0].currency,
        branding: tenantResult.rows[0].branding
      }
      : null,
    user: userResult.rows[0]
      ? {
        id: userResult.rows[0].id,
        fullName: userResult.rows[0].full_name,
        email: userResult.rows[0].email,
        locale: userResult.rows[0].locale,
        roles: userResult.rows[0].roles,
        tenantId: userResult.rows[0].tenant_id
      }
      : null
  };
}

export async function getCatalog(): Promise<ContentAsset[]> {
  const result = await pool.query(`SELECT payload FROM content_assets ORDER BY created_at DESC`);
  return result.rows.map((row) => row.payload as ContentAsset);
}

export async function getContentBySlug(slug: string): Promise<ContentAsset | null> {
  const result = await pool.query(`SELECT payload FROM content_assets WHERE slug = $1 LIMIT 1`, [slug]);
  return result.rows[0]?.payload ?? null;
}

export async function getOffers(): Promise<Offer[]> {
  const result = await pool.query(
    `SELECT id, name, description, price, currency, billing_period, type FROM offers ORDER BY created_at DESC`
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    currency: row.currency,
    billingPeriod: row.billing_period ?? undefined,
    type: row.type
  }));
}

export async function getEntitlements() {
  const result = await pool.query(`SELECT content_id, granted, reason FROM entitlements ORDER BY content_id`);
  return result.rows.map((row) => ({
    contentId: row.content_id,
    granted: row.granted,
    reason: row.reason
  }));
}

export async function saveIntegrationSetting(key: string, value: unknown): Promise<void> {
  await pool.query(
    `
      INSERT INTO integration_settings (key, value)
      VALUES ($1, $2)
      ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value,
          updated_at = NOW()
    `,
    [key, JSON.stringify(value)]
  );
}

export async function getIntegrationSetting<T = unknown>(key: string): Promise<T | null> {
  const result = await pool.query(`SELECT value FROM integration_settings WHERE key = $1 LIMIT 1`, [key]);
  return (result.rows[0]?.value as T | undefined) ?? null;
}

function epochToIso(value?: number): string | undefined {
  if (!value || value <= 0) {
    return undefined;
  }
  return new Date(value * 1000).toISOString();
}

function extractCategoryFromSummary(summary?: string): string | null {
  if (!summary) {
    return null;
  }
  const htmlMatch = summary.match(/categor(?:í|i)as?\s*:<\/strong>\s*([^<]+)/i);
  if (htmlMatch?.[1]) {
    const value = htmlMatch[1]
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)[0];
    if (value) {
      return value.slice(0, 90).trim();
    }
  }
  const cleaned = summary
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
  const match = cleaned.match(/categor(?:í|i)as?\s*:\s*([^.|]+)(?:[.|]|$)/i);
  if (!match?.[1]) {
    return null;
  }
  const first = match[1]
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)[0];
  return first ? first.slice(0, 90).trim() : null;
}

export async function syncMoodleCourses(courses: MoodleCourseRow[]): Promise<{
  upsertedCourses: number;
  upsertedCatalogAssets: number;
}> {
  return syncMoodleCoursesWithCategories(courses, {});
}

export async function syncMoodleCoursesWithCategories(
  courses: MoodleCourseRow[],
  categoryNameById: Record<number, string>
): Promise<{
  upsertedCourses: number;
  upsertedCatalogAssets: number;
}> {
  let upsertedCourses = 0;
  let upsertedCatalogAssets = 0;

  for (const course of courses) {
    const language = course.lang === 'es' ? 'es' : 'en';
    const shortname = course.shortname || `course-${course.id}`;
    const slugBase = toSlug(shortname) || `course-${course.id}`;
    const title = course.fullname || shortname;
    const summary = course.summary?.trim() || 'Course synchronized from Moodle';
    const heroImage = `https://picsum.photos/seed/paeu-course-${course.id}/1400/800`;
    const themedSummary = `${summary} ${courseThemePool[Math.abs(Number(course.id)) % courseThemePool.length]}`.trim();
    const categoryName =
      (typeof course.categoryid === 'number' ? categoryNameById[course.categoryid] : undefined) ??
      extractCategoryFromSummary(course.summary) ??
      (course.categoryid ? `Categoria ${course.categoryid}` : 'Sin categoría');

    await pool.query(
      `
        INSERT INTO moodle_courses
          (moodle_course_id, full_name, short_name, category_id, visible, start_date, end_date, raw, synced_at)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (moodle_course_id) DO UPDATE
        SET full_name = EXCLUDED.full_name,
            short_name = EXCLUDED.short_name,
            category_id = EXCLUDED.category_id,
            visible = EXCLUDED.visible,
            start_date = EXCLUDED.start_date,
            end_date = EXCLUDED.end_date,
            raw = EXCLUDED.raw,
            synced_at = NOW()
      `,
      [
        course.id,
        title,
        shortname,
        course.categoryid ?? null,
        course.visible !== 0,
        epochToIso(course.startdate) ?? null,
        epochToIso(course.enddate) ?? null,
        JSON.stringify(course)
      ]
    );
    upsertedCourses += 1;

    const moodleCourseAsset = {
      id: `moodle-course-${course.id}`,
      slug: `moodle-${slugBase}-${course.id}`,
      title,
      summary: themedSummary,
      kind: 'course',
      accessModel: 'purchase',
      durationMinutes: 120,
      language,
      tags: [categoryName, 'Moodle'],
      heroImage,
      categoryName,
      moodleCourseId: String(course.id),
      modules: 1,
      lessons: 1,
      progress: {
        completionRate: 0,
        status: 'not_started',
        certificateEligible: false
      }
    };

    await pool.query(
      `
        INSERT INTO content_assets
          (id, slug, title, summary, kind, access_model, duration_minutes, language, tags, hero_image, payload)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (id) DO UPDATE
        SET slug = EXCLUDED.slug,
            title = EXCLUDED.title,
            summary = EXCLUDED.summary,
            kind = EXCLUDED.kind,
            access_model = EXCLUDED.access_model,
            duration_minutes = EXCLUDED.duration_minutes,
            language = EXCLUDED.language,
            tags = EXCLUDED.tags,
            hero_image = EXCLUDED.hero_image,
            payload = EXCLUDED.payload
      `,
      [
        moodleCourseAsset.id,
        moodleCourseAsset.slug,
        moodleCourseAsset.title,
        moodleCourseAsset.summary,
        moodleCourseAsset.kind,
        moodleCourseAsset.accessModel,
        moodleCourseAsset.durationMinutes,
        moodleCourseAsset.language,
        moodleCourseAsset.tags,
        moodleCourseAsset.heroImage,
        JSON.stringify(moodleCourseAsset)
      ]
    );
    upsertedCatalogAssets += 1;
  }

  return { upsertedCourses, upsertedCatalogAssets };
}

export async function syncMoodleCategories(categories: MoodleCategoryRow[]): Promise<{ upsertedCategories: number }> {
  let upsertedCategories = 0;
  for (const category of categories) {
    if (!Number.isInteger(Number(category.id)) || Number(category.id) <= 0) {
      continue;
    }
    await pool.query(
      `
        INSERT INTO moodle_categories
          (moodle_category_id, name, idnumber, parent_id, depth, path, visible, raw, synced_at)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (moodle_category_id) DO UPDATE
        SET name = EXCLUDED.name,
            idnumber = EXCLUDED.idnumber,
            parent_id = EXCLUDED.parent_id,
            depth = EXCLUDED.depth,
            path = EXCLUDED.path,
            visible = EXCLUDED.visible,
            raw = EXCLUDED.raw,
            synced_at = NOW()
      `,
      [
        category.id,
        category.name,
        category.idnumber ?? null,
        category.parent ?? null,
        category.depth ?? null,
        category.path ?? null,
        category.visible !== 0,
        JSON.stringify(category)
      ]
    );
    upsertedCategories += 1;
  }
  return { upsertedCategories };
}

export async function getMoodleCategoryNameMap(): Promise<Record<number, string>> {
  const result = await pool.query(
    `
      SELECT moodle_category_id, name
      FROM moodle_categories
      WHERE visible = true
      ORDER BY moodle_category_id
    `
  );
  const out: Record<number, string> = {};
  for (const row of result.rows) {
    const id = Number(row.moodle_category_id);
    if (Number.isInteger(id) && typeof row.name === 'string') {
      out[id] = row.name;
    }
  }
  return out;
}

export async function listMoodleCategories() {
  const result = await pool.query(
    `
      SELECT moodle_category_id, name, idnumber, parent_id, depth, path, visible, synced_at
      FROM moodle_categories
      ORDER BY name ASC
    `
  );
  return result.rows;
}

export async function listMoodleCoursesPage(input?: {
  page?: number;
  pageSize?: number;
  search?: string;
  visible?: boolean;
}) {
  const page = Math.max(1, input?.page ?? 1);
  const pageSize = Math.min(10000, Math.max(1, input?.pageSize ?? 20));
  const offset = (page - 1) * pageSize;
  const values: Array<string | number | boolean> = [];
  const where: string[] = [];

  if (input?.search?.trim()) {
    values.push(`%${input.search.trim().toLowerCase()}%`);
    where.push(`(LOWER(full_name) LIKE $${values.length} OR LOWER(short_name) LIKE $${values.length})`);
  }
  if (typeof input?.visible === 'boolean') {
    values.push(input.visible);
    where.push(`visible = $${values.length}`);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countQuery = `SELECT COUNT(*)::int AS count FROM moodle_courses ${whereSql}`;
  const listQuery = `
      SELECT moodle_course_id, full_name, short_name, category_id, visible, start_date, end_date, synced_at
      FROM moodle_courses
      ${whereSql}
      ORDER BY synced_at DESC
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}
    `;

  const [countResult, listResult] = await Promise.all([
    pool.query(countQuery, values),
    pool.query(listQuery, [...values, pageSize, offset])
  ]);

  return {
    items: listResult.rows,
    pagination: {
      page,
      pageSize,
      total: countResult.rows[0]?.count ?? 0,
      totalPages: Math.max(1, Math.ceil((countResult.rows[0]?.count ?? 0) / pageSize))
    }
  };
}

export async function listMoodleCourses(limit = 100) {
  const result = await pool.query(
    `
      SELECT moodle_course_id, full_name, short_name, category_id, visible, start_date, end_date, synced_at
      FROM moodle_courses
      ORDER BY synced_at DESC
      LIMIT $1
    `,
    [limit]
  );
  return result.rows;
}

export async function listPlatformUsersPage(input?: {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: 'active' | 'inactive';
}) {
  const page = Math.max(1, input?.page ?? 1);
  const pageSize = Math.min(10000, Math.max(1, input?.pageSize ?? 20));
  const offset = (page - 1) * pageSize;
  const values: Array<string | number> = [];
  const where: string[] = [];

  if (input?.search?.trim()) {
    values.push(`%${input.search.trim().toLowerCase()}%`);
    where.push(`(LOWER(u.full_name) LIKE $${values.length} OR LOWER(u.email) LIKE $${values.length})`);
  }
  if (input?.status) {
    values.push(input.status);
    where.push(`u.status = $${values.length}`);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countQuery = `SELECT COUNT(*)::int AS count FROM users u ${whereSql}`;
  const listQuery = `
      SELECT
        u.id,
        u.full_name,
        u.email,
        u.locale,
        u.roles,
        u.tenant_id,
        u.moodle_user_id,
        u.status,
        u.created_at,
        COUNT(e.moodle_course_id)::int AS enrolled_courses
      FROM users u
      LEFT JOIN user_course_enrollments e ON e.user_id = u.id AND e.status = 'active'
      ${whereSql}
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}
    `;

  const [countResult, listResult] = await Promise.all([
    pool.query(countQuery, values),
    pool.query(listQuery, [...values, pageSize, offset])
  ]);

  return {
    items: listResult.rows,
    pagination: {
      page,
      pageSize,
      total: countResult.rows[0]?.count ?? 0,
      totalPages: Math.max(1, Math.ceil((countResult.rows[0]?.count ?? 0) / pageSize))
    }
  };
}

export async function listPlatformUsers() {
  const result = await pool.query(
    `
      SELECT
        u.id,
        u.full_name,
        u.email,
        u.locale,
        u.roles,
        u.tenant_id,
        u.moodle_user_id,
        u.status,
        u.created_at,
        COUNT(e.moodle_course_id)::int AS enrolled_courses
      FROM users u
      LEFT JOIN user_course_enrollments e ON e.user_id = u.id AND e.status = 'active'
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `
  );

  return result.rows;
}

export async function listMoodleBackedUsers() {
  const result = await pool.query(
    `
      SELECT id, full_name, email, locale, roles, tenant_id, moodle_user_id, status, created_at
      FROM users
      WHERE moodle_user_id IS NOT NULL
      ORDER BY created_at DESC
    `
  );
  return result.rows;
}

export async function getPlatformUserById(userId: string) {
  const result = await pool.query(
    `
      SELECT id, full_name, email, locale, roles, tenant_id, moodle_user_id, status, created_at
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );
  return result.rows[0] ?? null;
}

export async function getPlatformUserByEmail(email: string) {
  const result = await pool.query(
    `
      SELECT id, full_name, email, locale, roles, tenant_id, moodle_user_id, status, created_at
      FROM users
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1
    `,
    [email]
  );
  return result.rows[0] ?? null;
}

export async function getPlatformUsersByIds(userIds: string[]) {
  if (userIds.length === 0) {
    return [];
  }
  const result = await pool.query(
    `
      SELECT id, full_name, email, locale, roles, tenant_id, moodle_user_id, status, created_at
      FROM users
      WHERE id = ANY($1::text[])
      ORDER BY created_at DESC
    `,
    [userIds]
  );
  return result.rows;
}

export async function createPlatformUser(input: {
  id: string;
  fullName: string;
  email: string;
  locale: string;
  roles: string[];
  tenantId: string;
  moodleUserId: number | null;
}) {
  const result = await pool.query(
    `
      INSERT INTO users (id, full_name, email, locale, roles, tenant_id, moodle_user_id, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
      RETURNING id, full_name, email, locale, roles, tenant_id, moodle_user_id, status, created_at
    `,
    [input.id, input.fullName, input.email, input.locale, input.roles, input.tenantId, input.moodleUserId]
  );

  return result.rows[0];
}

export async function updatePlatformUserProfile(input: {
  userId: string;
  fullName: string;
  email: string;
  locale: string;
}) {
  const result = await pool.query(
    `
      UPDATE users
      SET full_name = $2,
          email = $3,
          locale = $4
      WHERE id = $1
      RETURNING id, full_name, email, locale, roles, tenant_id, moodle_user_id, status, created_at
    `,
    [input.userId, input.fullName, input.email, input.locale]
  );
  return result.rows[0] ?? null;
}

export async function setPlatformUsersStatus(
  userIds: string[],
  status: 'active' | 'inactive'
): Promise<{ updatedUsers: number; updatedEnrollments: number }> {
  if (userIds.length === 0) {
    return { updatedUsers: 0, updatedEnrollments: 0 };
  }

  const userUpdate = await pool.query(
    `
      UPDATE users
      SET status = $2
      WHERE id = ANY($1::text[])
    `,
    [userIds, status]
  );

  let enrollmentUpdateCount = 0;
  if (status === 'inactive') {
    const enrollmentUpdate = await pool.query(
      `
        UPDATE user_course_enrollments
        SET status = 'inactive',
            synced_at = NOW()
        WHERE user_id = ANY($1::text[])
      `,
      [userIds]
    );
    enrollmentUpdateCount = enrollmentUpdate.rowCount ?? 0;
  }

  return {
    updatedUsers: userUpdate.rowCount ?? 0,
    updatedEnrollments: enrollmentUpdateCount
  };
}

export async function upsertPlatformUserFromMoodle(input: {
  moodleUser: MoodleUserRow;
  tenantId: string;
}) {
  const moodleUserId = Number(input.moodleUser.id);
  const fullName =
    input.moodleUser.fullname?.trim() ||
    `${input.moodleUser.firstname ?? ''} ${input.moodleUser.lastname ?? ''}`.trim() ||
    input.moodleUser.username;
  const email = input.moodleUser.email?.trim().toLowerCase();
  const locale = input.moodleUser.lang || 'en';
  const status = input.moodleUser.suspended || input.moodleUser.deleted ? 'inactive' : 'active';

  if (!email) {
    return null;
  }

  const byMoodleId = await pool.query(
    `
      UPDATE users
      SET full_name = $2,
          email = $3,
          locale = $4,
          status = $5,
          tenant_id = $6
      WHERE moodle_user_id = $1
      RETURNING id, moodle_user_id
    `,
    [moodleUserId, fullName, email, locale, status, input.tenantId]
  );

  if (byMoodleId.rows[0]) {
    return byMoodleId.rows[0];
  }

  const byEmail = await pool.query(
    `
      UPDATE users
      SET moodle_user_id = $1,
          full_name = $2,
          locale = $3,
          status = $4,
          tenant_id = $5
      WHERE email = $6
      RETURNING id, moodle_user_id
    `,
    [moodleUserId, fullName, locale, status, input.tenantId, email]
  );

  if (byEmail.rows[0]) {
    return byEmail.rows[0];
  }

  const created = await pool.query(
    `
      INSERT INTO users (id, full_name, email, locale, roles, tenant_id, moodle_user_id, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, moodle_user_id
    `,
    [randomUUID(), fullName, email, locale, ['learner'], input.tenantId, moodleUserId, status]
  );

  return created.rows[0];
}

export async function mapLocalUsersByMoodleId() {
  const result = await pool.query(
    `
      SELECT id, moodle_user_id
      FROM users
      WHERE moodle_user_id IS NOT NULL
    `
  );
  return new Map<number, string>(result.rows.map((row) => [Number(row.moodle_user_id), row.id as string]));
}

export async function deactivateEnrollmentsForMoodleUsers(moodleUserIds: number[]) {
  if (moodleUserIds.length === 0) {
    return;
  }
  await pool.query(
    `
      UPDATE user_course_enrollments e
      SET status = 'inactive',
          synced_at = NOW()
      WHERE e.user_id IN (
        SELECT id FROM users WHERE moodle_user_id = ANY($1::bigint[])
      )
    `,
    [moodleUserIds]
  );
}

export async function upsertUserCourseEnrollment(input: {
  userId: string;
  moodleCourseId: number;
  status?: string;
}) {
  await pool.query(
    `
      INSERT INTO user_course_enrollments (user_id, moodle_course_id, status, enrolled_at, synced_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (user_id, moodle_course_id) DO UPDATE
      SET status = EXCLUDED.status,
          synced_at = NOW()
    `,
    [input.userId, input.moodleCourseId, input.status ?? 'active']
  );
}

export async function listUserCourses(userId: string) {
  const result = await pool.query(
    `
      SELECT
        e.moodle_course_id,
        e.status,
        e.enrolled_at,
        e.synced_at,
        c.full_name,
        c.short_name,
        c.visible
      FROM user_course_enrollments e
      LEFT JOIN moodle_courses c ON c.moodle_course_id = e.moodle_course_id
      WHERE e.user_id = $1
      ORDER BY e.enrolled_at DESC
    `,
    [userId]
  );
  return result.rows;
}

export async function listTenants() {
  const result = await pool.query(
    `SELECT id, slug, name, locales, currency, created_at FROM tenants ORDER BY created_at DESC`
  );
  return result.rows;
}

export async function createCompany(input: {
  slug: string;
  name: string;
  description?: string | null;
  contactEmail?: string | null;
  representativeUserId?: string | null;
  tenantId: string;
  isActive?: boolean;
}) {
  const id = randomUUID();
  const result = await pool.query(
    `
      INSERT INTO companies
        (id, slug, name, description, contact_email, tenant_id, representative_user_id, is_active)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `,
    [
      id,
      input.slug,
      input.name,
      input.description ?? null,
      input.contactEmail ?? null,
      input.tenantId,
      input.representativeUserId ?? null,
      input.isActive ?? true
    ]
  );
  return result.rows[0];
}

export async function updateCompany(
  companyId: string,
  input: Partial<{
    slug: string;
    name: string;
    description: string | null;
    contactEmail: string | null;
    representativeUserId: string | null;
    isActive: boolean;
  }>
) {
  const fields: string[] = [];
  const values: Array<string | boolean | null> = [];
  if (input.slug !== undefined) {
    values.push(input.slug);
    fields.push(`slug = $${values.length}`);
  }
  if (input.name !== undefined) {
    values.push(input.name);
    fields.push(`name = $${values.length}`);
  }
  if (input.description !== undefined) {
    values.push(input.description ?? null);
    fields.push(`description = $${values.length}`);
  }
  if (input.contactEmail !== undefined) {
    values.push(input.contactEmail ?? null);
    fields.push(`contact_email = $${values.length}`);
  }
  if (input.representativeUserId !== undefined) {
    values.push(input.representativeUserId ?? null);
    fields.push(`representative_user_id = $${values.length}`);
  }
  if (input.isActive !== undefined) {
    values.push(input.isActive);
    fields.push(`is_active = $${values.length}`);
  }
  if (fields.length === 0) {
    const existing = await pool.query(`SELECT * FROM companies WHERE id = $1 LIMIT 1`, [companyId]);
    return existing.rows[0] ?? null;
  }
  values.push(companyId);
  const result = await pool.query(
    `
      UPDATE companies
      SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${values.length}
      RETURNING *
    `,
    values
  );
  return result.rows[0] ?? null;
}

export async function listCompanies() {
  const result = await pool.query(
    `
      SELECT
        c.*,
        u.full_name AS representative_name,
        u.email AS representative_email,
        COUNT(cm.user_id)::int AS members_total
      FROM companies c
      LEFT JOIN users u ON u.id = c.representative_user_id
      LEFT JOIN company_members cm ON cm.company_id = c.id AND cm.status = 'active'
      GROUP BY c.id, u.full_name, u.email
      ORDER BY c.created_at DESC
    `
  );
  return result.rows;
}

export async function deleteCompany(companyId: string) {
  const result = await pool.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  return (result.rowCount ?? 0) > 0;
}

export async function getCompanyById(companyId: string) {
  const result = await pool.query(
    `
      SELECT c.*, u.full_name AS representative_name, u.email AS representative_email
      FROM companies c
      LEFT JOIN users u ON u.id = c.representative_user_id
      WHERE c.id = $1
      LIMIT 1
    `,
    [companyId]
  );
  return result.rows[0] ?? null;
}

export async function getCompanyByRepresentativeUserId(userId: string) {
  const result = await pool.query(
    `
      SELECT c.*, u.full_name AS representative_name, u.email AS representative_email
      FROM companies c
      LEFT JOIN users u ON u.id = c.representative_user_id
      WHERE c.representative_user_id = $1 AND c.is_active = true
      LIMIT 1
    `,
    [userId]
  );
  return result.rows[0] ?? null;
}

export async function getCompanyByMemberUserId(userId: string) {
  const result = await pool.query(
    `
      SELECT
        c.*,
        u.full_name AS representative_name,
        u.email AS representative_email,
        cm.member_role,
        cm.status AS membership_status
      FROM company_members cm
      INNER JOIN companies c ON c.id = cm.company_id
      LEFT JOIN users u ON u.id = c.representative_user_id
      WHERE cm.user_id = $1
      ORDER BY
        CASE WHEN cm.member_role = 'representative' THEN 0 ELSE 1 END,
        c.updated_at DESC
      LIMIT 1
    `,
    [userId]
  );
  return result.rows[0] ?? null;
}

export async function getCompanyMembership(input: {
  companyId: string;
  userId: string;
}) {
  const result = await pool.query(
    `
      SELECT company_id, user_id, member_role, status, created_at, updated_at
      FROM company_members
      WHERE company_id = $1 AND user_id = $2
      LIMIT 1
    `,
    [input.companyId, input.userId]
  );
  return result.rows[0] ?? null;
}

export async function upsertCompanyMember(input: {
  companyId: string;
  userId: string;
  memberRole?: 'representative' | 'collaborator';
  status?: 'active' | 'inactive';
}) {
  const result = await pool.query(
    `
      INSERT INTO company_members
        (company_id, user_id, member_role, status, updated_at)
      VALUES
        ($1, $2, $3, $4, NOW())
      ON CONFLICT (company_id, user_id) DO UPDATE
      SET member_role = EXCLUDED.member_role,
          status = EXCLUDED.status,
          updated_at = NOW()
      RETURNING company_id, user_id, member_role, status, created_at, updated_at
    `,
    [input.companyId, input.userId, input.memberRole ?? 'collaborator', input.status ?? 'active']
  );
  return result.rows[0];
}

export async function setCompanyMemberStatus(input: {
  companyId: string;
  userId: string;
  status: 'active' | 'inactive';
}) {
  const result = await pool.query(
    `
      UPDATE company_members
      SET status = $3,
          updated_at = NOW()
      WHERE company_id = $1 AND user_id = $2
      RETURNING company_id, user_id, member_role, status, created_at, updated_at
    `,
    [input.companyId, input.userId, input.status]
  );
  return result.rows[0] ?? null;
}

export async function removeCompanyMember(companyId: string, userId: string) {
  const result = await pool.query(
    `DELETE FROM company_members WHERE company_id = $1 AND user_id = $2`,
    [companyId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listCompanyMembers(companyId: string) {
  const result = await pool.query(
    `
      SELECT
        cm.company_id,
        cm.user_id,
        cm.member_role,
        cm.status,
        cm.created_at,
        cm.updated_at,
        u.full_name,
        u.email,
        u.locale,
        u.roles,
        u.moodle_user_id,
        (
          SELECT COALESCE(json_agg(json_build_object('id', cg.id, 'name', cg.name)), '[]'::json)
          FROM company_member_groups cmg
          JOIN company_course_groups cg ON cg.id = cmg.group_id
          WHERE cmg.company_id = cm.company_id AND cmg.user_id = cm.user_id
        ) AS assigned_groups,
        (
          SELECT COALESCE(json_agg(json_build_object('id', cmc.moodle_course_id, 'name', mc.full_name)), '[]'::json)
          FROM company_member_courses cmc
          LEFT JOIN moodle_courses mc ON mc.moodle_course_id = cmc.moodle_course_id
          WHERE cmc.company_id = cm.company_id AND cmc.user_id = cm.user_id
        ) AS assigned_courses
      FROM company_members cm
      INNER JOIN users u ON u.id = cm.user_id
      WHERE cm.company_id = $1
      ORDER BY cm.member_role DESC, cm.created_at ASC
    `,
    [companyId]
  );
  return result.rows;
}

export async function listCompanyActiveMembersWithMoodle(companyId: string) {
  const result = await pool.query(
    `
      SELECT
        cm.user_id,
        u.moodle_user_id
      FROM company_members cm
      INNER JOIN users u ON u.id = cm.user_id
      WHERE cm.company_id = $1
        AND cm.status = 'active'
        AND u.status = 'active'
        AND u.moodle_user_id IS NOT NULL
      ORDER BY cm.created_at ASC
    `,
    [companyId]
  );
  return result.rows;
}

export async function upsertCompanyCourseAccess(input: {
  companyId: string;
  moodleCourseId: number;
  isActive?: boolean;
  assignedByUserId?: string | null;
}) {
  const result = await pool.query(
    `
      INSERT INTO company_course_access
        (company_id, moodle_course_id, is_active, assigned_by_user_id, updated_at)
      VALUES
        ($1, $2, $3, $4, NOW())
      ON CONFLICT (company_id, moodle_course_id) DO UPDATE
      SET is_active = EXCLUDED.is_active,
          assigned_by_user_id = EXCLUDED.assigned_by_user_id,
          updated_at = NOW()
      RETURNING *
    `,
    [input.companyId, input.moodleCourseId, input.isActive ?? true, input.assignedByUserId ?? null]
  );
  return result.rows[0];
}

export async function deleteCompanyCourseAccess(input: {
  companyId: string;
  moodleCourseId: number;
}) {
  const result = await pool.query(
    `
      DELETE FROM company_course_access
      WHERE company_id = $1 AND moodle_course_id = $2
    `,
    [input.companyId, input.moodleCourseId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listCompanyCourseAccess(companyId: string) {
  const result = await pool.query(
    `
      SELECT
        cca.company_id,
        cca.moodle_course_id,
        cca.is_active,
        cca.assigned_by_user_id,
        cca.created_at,
        cca.updated_at,
        c.full_name,
        c.short_name,
        c.visible
      FROM company_course_access cca
      LEFT JOIN moodle_courses c ON c.moodle_course_id = cca.moodle_course_id
      WHERE cca.company_id = $1
      ORDER BY cca.is_active DESC, cca.updated_at DESC
    `,
    [companyId]
  );
  return result.rows;
}

export async function listCompanyActiveCourseAccess(companyId: string) {
  const result = await pool.query(
    `
      SELECT moodle_course_id
      FROM company_course_access
      WHERE company_id = $1 AND is_active = true
      ORDER BY updated_at DESC
    `,
    [companyId]
  );
  return result.rows.map((row) => Number(row.moodle_course_id)).filter((value) => Number.isInteger(value) && value > 0);
}

export async function setUserCourseEnrollmentStatusForUsers(input: {
  userIds: string[];
  moodleCourseId: number;
  status: 'active' | 'inactive';
}) {
  if (input.userIds.length === 0) {
    return 0;
  }
  const result = await pool.query(
    `
      UPDATE user_course_enrollments
      SET status = $3,
          synced_at = NOW()
      WHERE user_id = ANY($1::text[]) AND moodle_course_id = $2
    `,
    [input.userIds, input.moodleCourseId, input.status]
  );
  return result.rowCount ?? 0;
}

export async function getAdminSnapshot() {
  const [
    dbResult,
    tenantsResult,
    usersResult,
    contentResult,
    offersResult,
    entitlementsResult,
    sessionsResult,
    moodleCoursesResult,
    moodleCategoriesResult,
    enrollmentsResult,
    companiesResult,
    companyMembersResult,
    webinarsResult,
    podcastsResult,
    externalEventsResult
  ] = await Promise.all([
    pool.query(`SELECT current_database() AS database, NOW() AS now`),
    pool.query(`SELECT COUNT(*)::int AS count FROM tenants`),
    pool.query(`SELECT COUNT(*)::int AS count FROM users WHERE status = 'active'`),
    pool.query(`SELECT kind, COUNT(*)::int AS count FROM content_assets GROUP BY kind ORDER BY kind`),
    pool.query(`SELECT COUNT(*)::int AS count FROM offers`),
    pool.query(`SELECT COUNT(*)::int AS count FROM entitlements`),
    pool.query(`SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE datname = current_database()`),
    pool.query(`SELECT COUNT(*)::int AS count FROM moodle_courses`),
    pool.query(`SELECT COUNT(*)::int AS count FROM moodle_categories`),
    pool.query(`SELECT COUNT(*)::int AS count FROM user_course_enrollments WHERE status = 'active'`),
    pool.query(`SELECT COUNT(*)::int AS count FROM companies WHERE is_active = true`),
    pool.query(`SELECT COUNT(*)::int AS count FROM company_members WHERE status = 'active'`),
    pool.query(`SELECT COUNT(*)::int AS count FROM webinars`),
    pool.query(`SELECT COUNT(*)::int AS count FROM podcasts`),
    pool.query(`SELECT COUNT(*)::int AS count FROM external_integration_events`)
  ]);

  return {
    database: dbResult.rows[0]?.database ?? null,
    now: dbResult.rows[0]?.now ?? null,
    tenants: tenantsResult.rows[0]?.count ?? 0,
    users: usersResult.rows[0]?.count ?? 0,
    catalogByKind: contentResult.rows.map((row) => ({ kind: row.kind as string, count: row.count as number })),
    offers: offersResult.rows[0]?.count ?? 0,
    entitlements: entitlementsResult.rows[0]?.count ?? 0,
    activeDbSessions: sessionsResult.rows[0]?.count ?? 0,
    moodleCourses: moodleCoursesResult.rows[0]?.count ?? 0,
    moodleCategories: moodleCategoriesResult.rows[0]?.count ?? 0,
    userEnrollments: enrollmentsResult.rows[0]?.count ?? 0,
    companies: companiesResult.rows[0]?.count ?? 0,
    companyMembers: companyMembersResult.rows[0]?.count ?? 0,
    webinars: webinarsResult.rows[0]?.count ?? 0,
    podcasts: podcastsResult.rows[0]?.count ?? 0,
    externalEvents: externalEventsResult.rows[0]?.count ?? 0
  };
}

export async function upsertExternalIntegrationEvents(events: ExternalIntegrationEventInput[]): Promise<number> {
  let total = 0;
  for (const event of events) {
    await pool.query(
      `
        INSERT INTO external_integration_events (
          external_event_id,
          title,
          description,
          starts_at,
          ends_at,
          is_active,
          event_url,
          venue,
          modality,
          banner_url,
          banner_frame_url,
          email_banner_url,
          ticket_frame_url,
          disclaimer_url,
          group_key,
          group_label,
          tier,
          visible_on_landing,
          display_order,
          raw,
          synced_at,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20::jsonb, NOW(), NOW()
        )
        ON CONFLICT (external_event_id) DO UPDATE
        SET title = EXCLUDED.title,
            description = EXCLUDED.description,
            starts_at = EXCLUDED.starts_at,
            ends_at = EXCLUDED.ends_at,
            is_active = EXCLUDED.is_active,
            event_url = EXCLUDED.event_url,
            venue = EXCLUDED.venue,
            modality = EXCLUDED.modality,
            banner_url = EXCLUDED.banner_url,
            banner_frame_url = EXCLUDED.banner_frame_url,
            email_banner_url = EXCLUDED.email_banner_url,
            ticket_frame_url = EXCLUDED.ticket_frame_url,
            disclaimer_url = EXCLUDED.disclaimer_url,
            group_key = external_integration_events.group_key,
            group_label = external_integration_events.group_label,
            tier = external_integration_events.tier,
            visible_on_landing = external_integration_events.visible_on_landing,
            display_order = external_integration_events.display_order,
            raw = EXCLUDED.raw,
            synced_at = NOW(),
            updated_at = NOW()
      `,
      [
        event.externalEventId,
        event.title,
        event.description ?? null,
        event.startsAt ?? null,
        event.endsAt ?? null,
        event.isActive,
        event.eventUrl ?? null,
        event.venue ?? null,
        event.modality ?? null,
        event.bannerUrl ?? null,
        event.bannerFrameUrl ?? null,
        event.emailBannerUrl ?? null,
        event.ticketFrameUrl ?? null,
        event.disclaimerUrl ?? null,
        event.groupKey,
        event.groupLabel,
        event.tier,
        event.visibleOnLanding ?? true,
        event.displayOrder ?? 0,
        JSON.stringify(event.raw)
      ]
    );
    total += 1;
  }
  return total;
}

export async function listExternalIntegrationEvents(input?: {
  activeOnly?: boolean;
  landingOnly?: boolean;
}) {
  const values: Array<boolean> = [];
  const where: string[] = [];
  if (input?.activeOnly) {
    values.push(true);
    where.push(`is_active = $${values.length}`);
  }
  if (input?.landingOnly) {
    values.push(true);
    where.push(`visible_on_landing = $${values.length}`);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const result = await pool.query(
    `
      SELECT
        external_event_id,
        title,
        description,
        starts_at,
        ends_at,
        is_active,
        event_url,
        venue,
        modality,
        banner_url,
        banner_frame_url,
        email_banner_url,
        ticket_frame_url,
        disclaimer_url,
        group_key,
        group_label,
        tier,
        visible_on_landing,
        display_order,
        raw,
        synced_at,
        created_at,
        updated_at
      FROM external_integration_events
      ${whereSql}
      ORDER BY group_key ASC, display_order ASC, starts_at DESC NULLS LAST, title ASC
    `,
    values
  );
  return result.rows;
}

export async function updateExternalIntegrationEvent(
  eventId: string,
  input: Partial<{
    groupKey: string;
    groupLabel: string;
    tier: 'general' | 'vip' | 'virtual' | 'diamante' | 'other';
    isActive: boolean;
    visibleOnLanding: boolean;
    displayOrder: number;
  }>
) {
  const existing = await pool.query(`SELECT * FROM external_integration_events WHERE external_event_id = $1 LIMIT 1`, [eventId]);
  const row = existing.rows[0];
  if (!row) {
    return null;
  }
  const result = await pool.query(
    `
      UPDATE external_integration_events
      SET group_key = $2,
          group_label = $3,
          tier = $4,
          is_active = $5,
          visible_on_landing = $6,
          display_order = $7,
          updated_at = NOW()
      WHERE external_event_id = $1
      RETURNING *
    `,
    [
      eventId,
      input.groupKey ?? row.group_key,
      input.groupLabel ?? row.group_label,
      input.tier ?? row.tier,
      input.isActive ?? row.is_active,
      input.visibleOnLanding ?? row.visible_on_landing,
      input.displayOrder ?? row.display_order
    ]
  );
  return result.rows[0] ?? null;
}

export async function listGroupedExternalIntegrationEvents(input?: {
  activeOnly?: boolean;
  landingOnly?: boolean;
}) {
  const rows = await listExternalIntegrationEvents(input);
  const groups = new Map<
    string,
    {
      groupKey: string;
      groupLabel: string;
      displayOrder: number;
      startsAt: string | null;
      visibleOnLanding: boolean;
      isActive: boolean;
      events: Array<Record<string, unknown>>;
    }
  >();

  for (const row of rows) {
    const key = String(row.group_key);
    if (!groups.has(key)) {
      groups.set(key, {
        groupKey: key,
        groupLabel: String(row.group_label ?? key),
        displayOrder: Number(row.display_order ?? 0),
        startsAt: row.starts_at ? new Date(row.starts_at).toISOString() : null,
        visibleOnLanding: Boolean(row.visible_on_landing),
        isActive: Boolean(row.is_active),
        events: []
      });
    }
    const group = groups.get(key)!;
    if (row.starts_at) {
      const candidate = new Date(row.starts_at).toISOString();
      if (!group.startsAt || Date.parse(candidate) < Date.parse(group.startsAt)) {
        group.startsAt = candidate;
      }
    }
    const candidateOrder = Number(row.display_order ?? 0);
    if (Number.isFinite(candidateOrder)) {
      group.displayOrder = Math.min(group.displayOrder, candidateOrder);
    }
    group.visibleOnLanding = group.visibleOnLanding || Boolean(row.visible_on_landing);
    group.isActive = group.isActive || Boolean(row.is_active);
    group.events.push(row);
  }

  return [...groups.values()].sort((a, b) => {
    const aTs = a.startsAt ? Date.parse(a.startsAt) : Number.MAX_SAFE_INTEGER;
    const bTs = b.startsAt ? Date.parse(b.startsAt) : Number.MAX_SAFE_INTEGER;
    return aTs - bTs;
  });
}

export async function updateExternalIntegrationGroup(
  groupKey: string,
  input: Partial<{
    groupLabel: string;
    displayOrder: number;
    visibleOnLanding: boolean;
    isActive: boolean;
  }>
) {
  const result = await pool.query(
    `
      UPDATE external_integration_events
      SET group_label = COALESCE($2, group_label),
          display_order = COALESCE($3, display_order),
          visible_on_landing = COALESCE($4, visible_on_landing),
          is_active = COALESCE($5, is_active),
          updated_at = NOW()
      WHERE group_key = $1
      RETURNING external_event_id
    `,
    [groupKey, input.groupLabel ?? null, input.displayOrder ?? null, input.visibleOnLanding ?? null, input.isActive ?? null]
  );
  return result.rowCount ?? 0;
}

export async function createTenant(input: {
  id: string;
  slug: string;
  name: string;
  locales: string[];
  currency: string;
  branding: Record<string, unknown>;
}) {
  const result = await pool.query(
    `
      INSERT INTO tenants (id, slug, name, locales, currency, branding)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, slug, name, locales, currency, branding, created_at
    `,
    [input.id, input.slug, input.name, input.locales, input.currency, JSON.stringify(input.branding)]
  );

  return result.rows[0];
}

export async function savePublicCourseInteraction(input: {
  userId?: string;
  moodleCourseId: number;
  moduleId: number;
  moduleName: string;
  moduleType: string;
  response: Record<string, unknown>;
}) {
  const id = randomUUID();
  const result = await pool.query(
    `
      INSERT INTO public_course_interactions
        (id, user_id, moodle_course_id, module_id, module_name, module_type, response)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, user_id, moodle_course_id, module_id, module_name, module_type, response, created_at
    `,
    [
      id,
      input.userId ?? null,
      input.moodleCourseId,
      input.moduleId,
      input.moduleName,
      input.moduleType,
      JSON.stringify(input.response)
    ]
  );

  return result.rows[0];
}

export async function listPublicCourseInteractions(input: {
  userId: string;
  moodleCourseId: number;
  limit?: number;
}) {
  const limit = Math.max(1, Math.min(100, input.limit ?? 50));
  const result = await pool.query(
    `
      SELECT id, user_id, moodle_course_id, module_id, module_name, module_type, response, created_at
      FROM public_course_interactions
      WHERE user_id = $1 AND moodle_course_id = $2
      ORDER BY created_at DESC
      LIMIT $3
    `,
    [input.userId, input.moodleCourseId, limit]
  );
  return result.rows;
}

export async function getPublicCourseProgress(input: {
  userId: string;
  moodleCourseId: number;
}) {
  const result = await pool.query(
    `
      SELECT
        user_id,
        moodle_course_id,
        completed_module_ids,
        interactions_count,
        xp,
        total_modules,
        progress_percent,
        last_activity_at,
        updated_at
      FROM public_course_progress
      WHERE user_id = $1 AND moodle_course_id = $2
      LIMIT 1
    `,
    [input.userId, input.moodleCourseId]
  );
  return result.rows[0] ?? null;
}

export async function listPublicCourseProgressByUser(userId: string) {
  const result = await pool.query(
    `
      SELECT
        user_id,
        moodle_course_id,
        completed_module_ids,
        interactions_count,
        xp,
        total_modules,
        progress_percent,
        last_activity_at,
        updated_at
      FROM public_course_progress
      WHERE user_id = $1
      ORDER BY updated_at DESC
    `,
    [userId]
  );
  return result.rows;
}

export async function upsertPublicCourseProgress(input: {
  userId: string;
  moodleCourseId: number;
  completedModuleIds: number[];
  interactionsCount: number;
  xp: number;
  totalModules: number;
  progressPercent: number;
  lastActivityAt?: string | null;
}) {
  const result = await pool.query(
    `
      INSERT INTO public_course_progress
        (user_id, moodle_course_id, completed_module_ids, interactions_count, xp, total_modules, progress_percent, last_activity_at, updated_at)
      VALUES
        ($1, $2, $3::bigint[], $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (user_id, moodle_course_id) DO UPDATE
      SET completed_module_ids = EXCLUDED.completed_module_ids,
          interactions_count = EXCLUDED.interactions_count,
          xp = EXCLUDED.xp,
          total_modules = EXCLUDED.total_modules,
          progress_percent = EXCLUDED.progress_percent,
          last_activity_at = EXCLUDED.last_activity_at,
          updated_at = NOW()
      RETURNING
        user_id,
        moodle_course_id,
        completed_module_ids,
        interactions_count,
        xp,
        total_modules,
        progress_percent,
        last_activity_at,
        updated_at
    `,
    [
      input.userId,
      input.moodleCourseId,
      input.completedModuleIds.map((value) => Number(value)),
      Math.max(0, Math.trunc(input.interactionsCount)),
      Math.max(0, Math.trunc(input.xp)),
      Math.max(0, Math.trunc(input.totalModules)),
      Math.max(0, Math.min(100, Math.trunc(input.progressPercent))),
      input.lastActivityAt ?? null
    ]
  );
  return result.rows[0];
}

export async function upsertPublicUserAuth(input: { userId: string; passwordHash: string }) {
  await pool.query(
    `
      INSERT INTO public_user_auth (user_id, password_hash)
      VALUES ($1, $2)
      ON CONFLICT (user_id) DO UPDATE
      SET password_hash = EXCLUDED.password_hash,
          updated_at = NOW()
    `,
    [input.userId, input.passwordHash]
  );
}

export async function getPublicUserAuthByEmail(email: string) {
  const result = await pool.query(
    `
      SELECT
        u.id,
        u.full_name,
        u.email,
        u.locale,
        u.roles,
        u.tenant_id,
        u.moodle_user_id,
        u.status,
        u.created_at,
        a.password_hash
      FROM users u
      INNER JOIN public_user_auth a ON a.user_id = u.id
      WHERE LOWER(u.email) = LOWER($1)
      LIMIT 1
    `,
    [email]
  );
  return result.rows[0] ?? null;
}

export async function listWebinars(input?: {
  activeOnly?: boolean;
  landingOnly?: boolean;
}) {
  const where: string[] = [];
  const values: Array<boolean> = [];
  if (input?.activeOnly) {
    values.push(true);
    where.push(`is_active = $${values.length}`);
  }
  if (input?.landingOnly) {
    values.push(true);
    where.push(`show_on_landing = $${values.length}`);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const result = await pool.query(
    `
      SELECT
        id,
        slug,
        title,
        subtitle,
        description,
        hero_image,
        source_type,
        source_url,
        replay_url,
        starts_at,
        ends_at,
        timezone,
        cta_label,
        is_active,
        show_on_landing,
        webinar_links,
        free_reservation_url,
        vip_reservation_url,
        created_at,
        updated_at
      FROM webinars
      ${whereSql}
      ORDER BY starts_at ASC
    `,
    values
  );
  return result.rows;
}

export async function createWebinar(input: WebinarInput) {
  const id = randomUUID();
  const result = await pool.query(
    `
      INSERT INTO webinars
        (
          id, slug, title, subtitle, description, hero_image, source_type, source_url, replay_url,
          starts_at, ends_at, timezone, cta_label, is_active, show_on_landing, webinar_links, free_reservation_url, vip_reservation_url
        )
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING *
    `,
    [
      id,
      input.slug,
      input.title,
      input.subtitle ?? null,
      input.description ?? null,
      input.heroImage,
      input.sourceType,
      input.sourceUrl,
      input.replayUrl ?? null,
      input.startsAt,
      input.endsAt ?? null,
      input.timezone ?? 'America/Bogota',
      input.ctaLabel ?? 'Reservar cupo',
      input.isActive ?? true,
      input.showOnLanding ?? true,
      JSON.stringify(input.webinarLinks ?? []),
      input.freeReservationUrl ?? null,
      input.vipReservationUrl ?? null
    ]
  );
  return result.rows[0];
}

export async function updateWebinar(
  webinarId: string,
  input: Partial<WebinarInput>
) {
  const fields: string[] = [];
  const values: Array<string | boolean | null> = [];
  if (input.slug !== undefined) {
    values.push(input.slug);
    fields.push(`slug = $${values.length}`);
  }
  if (input.title !== undefined) {
    values.push(input.title);
    fields.push(`title = $${values.length}`);
  }
  if (input.subtitle !== undefined) {
    values.push(input.subtitle ?? null);
    fields.push(`subtitle = $${values.length}`);
  }
  if (input.description !== undefined) {
    values.push(input.description ?? null);
    fields.push(`description = $${values.length}`);
  }
  if (input.heroImage !== undefined) {
    values.push(input.heroImage);
    fields.push(`hero_image = $${values.length}`);
  }
  if (input.sourceType !== undefined) {
    values.push(input.sourceType);
    fields.push(`source_type = $${values.length}`);
  }
  if (input.sourceUrl !== undefined) {
    values.push(input.sourceUrl);
    fields.push(`source_url = $${values.length}`);
  }
  if (input.replayUrl !== undefined) {
    values.push(input.replayUrl ?? null);
    fields.push(`replay_url = $${values.length}`);
  }
  if (input.startsAt !== undefined) {
    values.push(input.startsAt);
    fields.push(`starts_at = $${values.length}`);
  }
  if (input.endsAt !== undefined) {
    values.push(input.endsAt ?? null);
    fields.push(`ends_at = $${values.length}`);
  }
  if (input.timezone !== undefined) {
    values.push(input.timezone ?? 'America/Bogota');
    fields.push(`timezone = $${values.length}`);
  }
  if (input.ctaLabel !== undefined) {
    values.push(input.ctaLabel ?? 'Reservar cupo');
    fields.push(`cta_label = $${values.length}`);
  }
  if (input.isActive !== undefined) {
    values.push(input.isActive);
    fields.push(`is_active = $${values.length}`);
  }
  if (input.showOnLanding !== undefined) {
    values.push(input.showOnLanding);
    fields.push(`show_on_landing = $${values.length}`);
  }
  if (input.webinarLinks !== undefined) {
    values.push(JSON.stringify(input.webinarLinks));
    fields.push(`webinar_links = $${values.length}::jsonb`);
  }
  if (input.freeReservationUrl !== undefined) {
    values.push(input.freeReservationUrl ?? null);
    fields.push(`free_reservation_url = $${values.length}`);
  }
  if (input.vipReservationUrl !== undefined) {
    values.push(input.vipReservationUrl ?? null);
    fields.push(`vip_reservation_url = $${values.length}`);
  }

  if (fields.length === 0) {
    const existing = await pool.query(`SELECT * FROM webinars WHERE id = $1 LIMIT 1`, [webinarId]);
    return existing.rows[0] ?? null;
  }

  values.push(webinarId);
  const result = await pool.query(
    `
      UPDATE webinars
      SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${values.length}
      RETURNING *
    `,
    values
  );
  return result.rows[0] ?? null;
}

export async function deleteWebinar(webinarId: string) {
  const result = await pool.query(`DELETE FROM webinars WHERE id = $1`, [webinarId]);
  return (result.rowCount ?? 0) > 0;
}

export async function listPodcasts(input?: {
  activeOnly?: boolean;
  landingOnly?: boolean;
}) {
  const where: string[] = [];
  const values: Array<boolean> = [];
  if (input?.activeOnly) {
    values.push(true);
    where.push(`is_active = $${values.length}`);
  }
  if (input?.landingOnly) {
    values.push(true);
    where.push(`show_on_landing = $${values.length}`);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const result = await pool.query(
    `
      SELECT
        id,
        title,
        video_code,
        video_url,
        published_at,
        is_active,
        show_on_landing,
        display_order,
        created_at,
        updated_at
      FROM podcasts
      ${whereSql}
      ORDER BY display_order ASC, published_at DESC
    `,
    values
  );
  return result.rows;
}

export async function createPodcast(input: PodcastInput) {
  const id = randomUUID();
  const result = await pool.query(
    `
      INSERT INTO podcasts
      (
        id, title, video_code, video_url, published_at, is_active, show_on_landing, display_order
      )
      VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `,
    [
      id,
      input.title,
      input.videoCode,
      input.videoUrl,
      input.publishedAt,
      input.isActive ?? true,
      input.showOnLanding ?? true,
      Number.isInteger(input.displayOrder) ? Number(input.displayOrder) : 0
    ]
  );
  return result.rows[0];
}

export async function updatePodcast(
  podcastId: string,
  input: Partial<PodcastInput>
) {
  const fields: string[] = [];
  const values: Array<string | boolean | number> = [];
  if (input.title !== undefined) {
    values.push(input.title);
    fields.push(`title = $${values.length}`);
  }
  if (input.videoCode !== undefined) {
    values.push(input.videoCode);
    fields.push(`video_code = $${values.length}`);
  }
  if (input.videoUrl !== undefined) {
    values.push(input.videoUrl);
    fields.push(`video_url = $${values.length}`);
  }
  if (input.publishedAt !== undefined) {
    values.push(input.publishedAt);
    fields.push(`published_at = $${values.length}`);
  }
  if (input.isActive !== undefined) {
    values.push(input.isActive);
    fields.push(`is_active = $${values.length}`);
  }
  if (input.showOnLanding !== undefined) {
    values.push(input.showOnLanding);
    fields.push(`show_on_landing = $${values.length}`);
  }
  if (input.displayOrder !== undefined) {
    values.push(Math.max(0, Math.trunc(input.displayOrder)));
    fields.push(`display_order = $${values.length}`);
  }

  if (fields.length === 0) {
    const existing = await pool.query(`SELECT * FROM podcasts WHERE id = $1 LIMIT 1`, [podcastId]);
    return existing.rows[0] ?? null;
  }

  values.push(podcastId);
  const result = await pool.query(
    `
      UPDATE podcasts
      SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${values.length}
      RETURNING *
    `,
    values
  );
  return result.rows[0] ?? null;
}

export async function deletePodcast(podcastId: string) {
  const result = await pool.query(`DELETE FROM podcasts WHERE id = $1`, [podcastId]);
  return (result.rowCount ?? 0) > 0;
}

export async function createCompanyCourseGroup(input: {
  id: string;
  companyId: string;
  name: string;
  description?: string;
}) {
  const result = await pool.query(
    `
      INSERT INTO company_course_groups
        (id, company_id, name, description, updated_at)
      VALUES
        ($1, $2, $3, $4, NOW())
      RETURNING *
    `,
    [input.id, input.companyId, input.name, input.description || null]
  );
  return result.rows[0];
}

export async function updateCompanyCourseGroup(input: { id: string; name?: string; description?: string }) {
  const fields: string[] = [];
  const values: unknown[] = [input.id];
  let idx = 2;

  if (input.name !== undefined) {
    fields.push(`name = $${idx++}`);
    values.push(input.name);
  }
  if (input.description !== undefined) {
    fields.push(`description = $${idx++}`);
    values.push(input.description);
  }

  if (fields.length === 0) return true;
  fields.push(`updated_at = NOW()`);

  const result = await pool.query(
    `UPDATE company_course_groups SET ${fields.join(', ')} WHERE id = $1 RETURNING *`,
    values
  );
  return result.rows[0];
}

export async function deleteCompanyCourseGroup(id: string) {
  const result = await pool.query(`DELETE FROM company_course_groups WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function listCompanyCourseGroups(companyId: string) {
  const result = await pool.query(
    `
      SELECT
        cg.id,
        cg.company_id,
        cg.name,
        cg.description,
        cg.created_at,
        cg.updated_at,
        COALESCE(
          (SELECT json_agg(json_build_object('moodle_course_id', cgi.moodle_course_id, 'full_name', mc.full_name, 'short_name', mc.short_name))
           FROM company_course_group_items cgi
           LEFT JOIN moodle_courses mc ON mc.moodle_course_id = cgi.moodle_course_id
           WHERE cgi.group_id = cg.id),
          '[]'::json
        ) AS items
      FROM company_course_groups cg
      WHERE cg.company_id = $1
      ORDER BY cg.created_at ASC
    `,
    [companyId]
  );
  return result.rows;
}

export async function assignCourseToGroup(input: { groupId: string; moodleCourseId: number }) {
  const result = await pool.query(
    `
      INSERT INTO company_course_group_items (group_id, moodle_course_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
      RETURNING *
    `,
    [input.groupId, input.moodleCourseId]
  );
  return result.rows[0] ?? null;
}

export async function removeCourseFromGroup(input: { groupId: string; moodleCourseId: number }) {
  const result = await pool.query(
    `DELETE FROM company_course_group_items WHERE group_id = $1 AND moodle_course_id = $2`,
    [input.groupId, input.moodleCourseId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function assignGroupToMember(input: { companyId: string; userId: string; groupId: string }) {
  const result = await pool.query(
    `
      INSERT INTO company_member_groups (company_id, user_id, group_id)
      VALUES ($1, $2, $3)
      ON CONFLICT DO NOTHING
      RETURNING *
    `,
    [input.companyId, input.userId, input.groupId]
  );
  return result.rows[0] ?? null;
}

export async function removeGroupFromMember(input: { companyId: string; userId: string; groupId: string }) {
  const result = await pool.query(
    `DELETE FROM company_member_groups WHERE company_id = $1 AND user_id = $2 AND group_id = $3`,
    [input.companyId, input.userId, input.groupId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listCompanyMemberGroups(companyId: string, userId: string) {
  const result = await pool.query(
    `
      SELECT cg.id, cg.name, cg.description
      FROM company_member_groups cmg
      INNER JOIN company_course_groups cg ON cg.id = cmg.group_id
      WHERE cmg.company_id = $1 AND cmg.user_id = $2
    `,
    [companyId, userId]
  );
  return result.rows;
}

export async function listCompanyMemberCourses(companyId: string, userId: string) {
  const result = await pool.query(
    `
      SELECT cmc.moodle_course_id, mc.full_name, mc.short_name
      FROM company_member_courses cmc
      LEFT JOIN moodle_courses mc ON mc.moodle_course_id = cmc.moodle_course_id
      WHERE cmc.company_id = $1 AND cmc.user_id = $2
    `,
    [companyId, userId]
  );
  return result.rows;
}

export async function getMemberActiveMoodleCourseIds(companyId: string, userId: string) {
  const result = await pool.query(
    `
      SELECT DISTINCT moodle_course_id
      FROM (
        SELECT moodle_course_id FROM company_member_courses WHERE company_id = $1 AND user_id = $2
        UNION
        SELECT cgi.moodle_course_id
        FROM company_member_groups cmg
        INNER JOIN company_course_group_items cgi ON cgi.group_id = cmg.group_id
        WHERE cmg.company_id = $1 AND cmg.user_id = $2
      ) AS combined
    `,
    [companyId, userId]
  );
  return result.rows.map((row) => Number(row.moodle_course_id));
}

export async function getGroupMembers(groupId: string) {
  const result = await pool.query(
    `
      SELECT user_id, company_id
      FROM company_member_groups
      WHERE group_id = $1
    `,
    [groupId]
  );
  return result.rows;
}

export async function assignCourseToMember(input: { companyId: string; userId: string; moodleCourseId: number }) {
  const result = await pool.query(
    `
      INSERT INTO company_member_courses (company_id, user_id, moodle_course_id)
      VALUES ($1, $2, $3)
      ON CONFLICT DO NOTHING
      RETURNING *
    `,
    [input.companyId, input.userId, input.moodleCourseId]
  );
  return result.rows[0] ?? null;
}

export async function removeCourseFromMember(input: { companyId: string; userId: string; moodleCourseId: number }) {
  const result = await pool.query(
    `DELETE FROM company_member_courses WHERE company_id = $1 AND user_id = $2 AND moodle_course_id = $3`,
    [input.companyId, input.userId, input.moodleCourseId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getCompanyDashboardStats(companyId: string) {
  const result = await pool.query(
    `
      SELECT
        (SELECT COUNT(*)::int FROM company_members WHERE company_id = $1) AS "totalMembers",
        (SELECT COUNT(*)::int FROM company_members WHERE company_id = $1 AND status = 'active') AS "activeMembers",
        (SELECT COUNT(*)::int FROM company_course_access cca INNER JOIN company_members cm ON cm.company_id = cca.company_id WHERE cca.company_id = $1) AS "totalEnrollments",
        (
          SELECT COALESCE(AVG(progress_percent), 0)::int
          FROM public_course_progress pcp
          INNER JOIN company_members cm ON cm.user_id = pcp.user_id
          WHERE cm.company_id = $1
        ) AS "averageProgress",
        (
          SELECT COALESCE(SUM(interactions_count), 0)::int
          FROM public_course_progress pcp
          INNER JOIN company_members cm ON cm.user_id = pcp.user_id
          WHERE cm.company_id = $1
        ) AS "totalInteractions",
        (
          SELECT MAX(last_activity_at)
          FROM public_course_progress pcp
          INNER JOIN company_members cm ON cm.user_id = pcp.user_id
          WHERE cm.company_id = $1
        ) AS "lastActivity"
    `,
    [companyId]
  );
  return {
    totalMembers: result.rows[0].totalMembers ?? 0,
    activeMembers: result.rows[0].activeMembers ?? 0,
    totalEnrollments: result.rows[0].totalEnrollments ?? 0,
    averageProgress: result.rows[0].averageProgress ?? 0,
    totalInteractions: result.rows[0].totalInteractions ?? 0,
    lastActivity: result.rows[0].lastActivity ?? null
  };
}

export async function getCompanyUserProgress(companyId: string) {
  const result = await pool.query(
    `
      SELECT
        cm.user_id,
        u.full_name,
        u.email,
        cm.status AS member_status,
        mc.moodle_course_id,
        mc.full_name AS course_name,
        COALESCE(pcp.progress_percent, 0) AS progress_percent,
        COALESCE(pcp.interactions_count, 0) AS interactions_count,
        pcp.last_activity_at
      FROM company_members cm
      INNER JOIN users u ON u.id = cm.user_id
      LEFT JOIN (
        SELECT company_id, user_id, moodle_course_id FROM company_member_courses
        UNION
        SELECT cmg.company_id, cmg.user_id, cgi.moodle_course_id
        FROM company_member_groups cmg
        INNER JOIN company_course_group_items cgi ON cgi.group_id = cmg.group_id
      ) AS user_courses ON user_courses.company_id = cm.company_id AND user_courses.user_id = cm.user_id
      LEFT JOIN moodle_courses mc ON mc.moodle_course_id = user_courses.moodle_course_id
      LEFT JOIN public_course_progress pcp ON pcp.user_id = cm.user_id AND pcp.moodle_course_id = user_courses.moodle_course_id
      WHERE cm.company_id = $1
      ORDER BY u.full_name ASC, mc.full_name ASC
    `,
    [companyId]
  );
  return result.rows;
}
