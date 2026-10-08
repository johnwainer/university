import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { SitePageRow } from './schema.js';

/**
 * Etapa I — Páginas institucionales del sitio público.
 *
 * Públicas : GET /api/v1/pages          (índice para el menú y el pie)
 *            GET /api/v1/pages/:slug    (una página, en el idioma pedido)
 *            GET /api/v1/legal/:slug    (alias heredado; ver nota abajo)
 * Admin    : GET /api/admin/pages, PUT /api/admin/pages/:slug
 */

export interface PagesContext {
  pool: Pool;
  /** Lanza 401 si la petición no trae credenciales admin válidas. */
  ensureAdmin: (request: any) => unknown;
}

const localeSchema = z.enum(['es', 'en']).catch('es');

const updateSchema = z.object({
  titleEs: z.string().min(1).max(200),
  titleEn: z.string().min(1).max(200),
  bodyEs: z.string().min(1),
  bodyEn: z.string().min(1),
  isPublished: z.boolean().optional()
});

function toPublic(row: SitePageRow, locale: 'es' | 'en') {
  return {
    slug: row.slug,
    locale,
    title: locale === 'en' ? row.title_en : row.title_es,
    html: locale === 'en' ? row.body_en : row.body_es,
    updatedAt: row.updated_at
  };
}

export function registerPagesRoutes(app: FastifyInstance, ctx: PagesContext): void {
  const { pool, ensureAdmin } = ctx;

  app.get('/v1/pages', async (request) => {
    const locale = localeSchema.parse((request.query as { locale?: string }).locale);
    const result = await pool.query<SitePageRow>(
      `SELECT * FROM site_pages WHERE is_published ORDER BY display_order ASC, slug ASC`
    );
    return result.rows.map((row) => ({
      slug: row.slug,
      title: locale === 'en' ? row.title_en : row.title_es
    }));
  });

  app.get('/v1/pages/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const locale = localeSchema.parse((request.query as { locale?: string }).locale);
    const result = await pool.query<SitePageRow>(
      `SELECT * FROM site_pages WHERE slug = $1 AND is_published LIMIT 1`,
      [slug]
    );
    const row = result.rows[0];
    if (!row) {
      return reply.notFound(`Page ${slug} was not found`);
    }
    return toPublic(row, locale);
  });

  /**
   * Alias heredado. El front ya llamaba a /v1/legal/terms y /v1/legal/privacy
   * antes de que existiera nada que respondiera: esas rutas devolvían 404 y
   * las páginas de Términos y Privacidad salían en blanco en producción. Se
   * mantiene el camino antiguo para no romper ninguna versión del SPA todavía
   * cacheada en un navegador.
   */
  app.get('/v1/legal/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const locale = localeSchema.parse((request.query as { locale?: string }).locale);
    const result = await pool.query<SitePageRow>(
      `SELECT * FROM site_pages WHERE slug = $1 AND is_published LIMIT 1`,
      [slug]
    );
    const row = result.rows[0];
    if (!row) {
      return reply.notFound(`Legal page ${slug} was not found`);
    }
    return toPublic(row, locale);
  });

  app.get('/admin/pages', async (request) => {
    ensureAdmin(request);
    const result = await pool.query<SitePageRow>(
      `SELECT * FROM site_pages ORDER BY display_order ASC, slug ASC`
    );
    return { pages: result.rows };
  });

  app.put('/admin/pages/:slug', async (request, reply) => {
    ensureAdmin(request);
    const { slug } = request.params as { slug: string };
    const input = updateSchema.parse(request.body);
    const result = await pool.query<SitePageRow>(
      `UPDATE site_pages
          SET title_es = $2, title_en = $3, body_es = $4, body_en = $5,
              is_published = COALESCE($6, is_published), updated_at = NOW()
        WHERE slug = $1
        RETURNING *`,
      [slug, input.titleEs, input.titleEn, input.bodyEs, input.bodyEn, input.isPublished ?? null]
    );
    const row = result.rows[0];
    if (!row) {
      return reply.notFound(`Page ${slug} was not found`);
    }
    return { page: row };
  });
}
