import {
  createMoodleCategory,
  createMoodleCourse,
  getMoodleCategories,
  getMoodleCourses,
  updateMoodleCourse,
  type MoodleCategory,
  type MoodleCourse
} from '../moodle.js';
import { config } from '../config.js';

type WpCourse = {
  id: number;
  slug: string;
  link: string;
  title?: { rendered?: string };
  excerpt?: { rendered?: string };
  content?: { rendered?: string };
  ['categoria-cursos']?: number[];
  _embedded?: {
    ['wp:featuredmedia']?: Array<{
      source_url?: string;
    }>;
  };
};

type WpCategory = {
  id: number;
  name: string;
  slug: string;
};

const WP_BASE = 'https://www.pasosalexito.com/wp-json/wp/v2';

function decodeHtml(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripHtml(input: string): string {
  return decodeHtml(input)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toShortname(slug: string, wpId: number): string {
  const base = slug
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return `PAEU_${base || 'CURSO'}_${wpId}`.slice(0, 80);
}

function buildSummary(course: WpCourse, categoryNames: string[]): string {
  const title = decodeHtml(course.title?.rendered ?? `Curso ${course.id}`);
  const excerptHtml = course.excerpt?.rendered?.trim();
  const fallbackText = stripHtml(course.content?.rendered ?? '').slice(0, 500);
  const image = course._embedded?.['wp:featuredmedia']?.[0]?.source_url;
  const categories =
    categoryNames.length > 0
      ? `<p><strong>Categorías:</strong> ${categoryNames.map((name) => decodeHtml(name)).join(', ')}</p>`
      : '';
  const description = excerptHtml || (fallbackText ? `<p>${fallbackText}</p>` : '<p>Curso demo importado desde Pasos al Éxito.</p>');
  const source = `<p><a href="${course.link}" target="_blank" rel="noreferrer noopener">Ver curso en Pasos al Éxito</a></p>`;
  const cover = image ? `<p><img src="${image}" alt="${title}" style="max-width:100%;height:auto;" /></p>` : '';
  return `${categories}${description}${source}${cover}`;
}

async function fetchAllCourses(): Promise<WpCourse[]> {
  const firstUrl = `${WP_BASE}/curso?per_page=100&page=1&_embed=1`;
  const firstResponse = await fetch(firstUrl);
  if (!firstResponse.ok) {
    throw new Error(`WordPress cursos fetch failed (${firstResponse.status}) at page 1`);
  }
  const firstRows = (await firstResponse.json()) as WpCourse[];
  const totalPages = Math.max(1, Number(firstResponse.headers.get('x-wp-totalpages') ?? 1));
  if (totalPages === 1) {
    return firstRows;
  }

  const results = [...firstRows];
  for (let page = 2; page <= totalPages; page += 1) {
    const response = await fetch(`${WP_BASE}/curso?per_page=100&page=${page}&_embed=1`);
    if (!response.ok) {
      throw new Error(`WordPress cursos fetch failed (${response.status}) at page ${page}`);
    }
    const rows = (await response.json()) as WpCourse[];
    results.push(...rows);
  }
  return results;
}

async function fetchAllCategories(): Promise<WpCategory[]> {
  const response = await fetch(`${WP_BASE}/categoria-cursos?per_page=100`);
  if (!response.ok) {
    throw new Error(`WordPress categorías fetch failed (${response.status})`);
  }
  return (await response.json()) as WpCategory[];
}

function pickPrimaryCategoryId(course: WpCourse, categoryMap: Map<number, WpCategory>): number | null {
  const ids = (course['categoria-cursos'] ?? []).filter((id) => categoryMap.has(id));
  return ids.length > 0 ? ids[0] : null;
}

async function run() {
  console.log('Importando cursos demo desde Pasos al Éxito...');

  const [wpCourses, wpCategories, moodleCategoriesResult, moodleCoursesResult] = await Promise.all([
    fetchAllCourses(),
    fetchAllCategories(),
    getMoodleCategories(),
    getMoodleCourses()
  ]);

  if (!moodleCategoriesResult.ok) {
    throw new Error(`No se pudo leer categorías Moodle: ${moodleCategoriesResult.error ?? 'unknown error'}`);
  }
  if (!moodleCoursesResult.ok) {
    throw new Error(`No se pudo leer cursos Moodle: ${moodleCoursesResult.error ?? 'unknown error'}`);
  }

  const wpCategoryMap = new Map(wpCategories.map((cat) => [cat.id, cat]));
  const moodleCategories = moodleCategoriesResult.data ?? [];
  const moodleCourses = moodleCoursesResult.data ?? [];

  const moodleCategoryByIdnumber = new Map<string, MoodleCategory>(
    moodleCategories.filter((row) => row.idnumber).map((row) => [String(row.idnumber), row])
  );

  const categoryIdByWpTerm = new Map<number, number>();
  for (const wpCategory of wpCategories) {
    const idnumber = `pasos-cat-${wpCategory.id}`;
    let moodleCategory = moodleCategoryByIdnumber.get(idnumber);
    if (!moodleCategory) {
      const created = await createMoodleCategory({
        name: decodeHtml(wpCategory.name),
        idnumber,
        description: `Categoría importada desde Pasos al Éxito (${wpCategory.slug})`
      });
      if (!created.ok || !created.data?.[0]?.id) {
        throw new Error(`No se pudo crear categoría Moodle ${wpCategory.name}: ${created.error ?? 'unknown error'}`);
      }
      moodleCategory = {
        id: created.data[0].id,
        name: decodeHtml(wpCategory.name),
        idnumber
      };
      moodleCategoryByIdnumber.set(idnumber, moodleCategory);
    }
    categoryIdByWpTerm.set(wpCategory.id, moodleCategory.id);
  }

  const moodleCourseByIdnumber = new Map<string, MoodleCourse>(
    moodleCourses.filter((row) => row.idnumber).map((row) => [String(row.idnumber), row])
  );

  let createdCount = 0;
  let updatedCount = 0;

  for (const wpCourse of wpCourses) {
    const idnumber = `pasos-curso-${wpCourse.id}`;
    const title = decodeHtml(wpCourse.title?.rendered ?? `Curso ${wpCourse.id}`).trim();
    const shortname = toShortname(wpCourse.slug, wpCourse.id);
    const wpCatIds = (wpCourse['categoria-cursos'] ?? []).filter((id) => wpCategoryMap.has(id));
    const primaryWpCatId = pickPrimaryCategoryId(wpCourse, wpCategoryMap);
    const moodleCategoryId = primaryWpCatId ? categoryIdByWpTerm.get(primaryWpCatId) : undefined;
    const categoryNames = wpCatIds.map((id) => wpCategoryMap.get(id)?.name ?? '').filter(Boolean);
    const summary = buildSummary(wpCourse, categoryNames);

    const payload = {
      fullname: title,
      shortname,
      idnumber,
      categoryid: moodleCategoryId ?? 1,
      summary,
      visible: true
    };

    const existing = moodleCourseByIdnumber.get(idnumber);
    if (!existing) {
      const created = await createMoodleCourse(payload);
      if (!created.ok || !created.data?.[0]?.id) {
        console.warn(`No se pudo crear curso ${title}: ${created.error ?? 'unknown error'}`);
        continue;
      }
      createdCount += 1;
      continue;
    }

    const updated = await updateMoodleCourse({
      id: existing.id,
      ...payload
    });
    if (!updated.ok) {
      console.warn(`No se pudo actualizar curso ${title}: ${updated.error ?? 'unknown error'}`);
      continue;
    }
    updatedCount += 1;
  }

  const legacyCourses = moodleCourses.filter((course) =>
    /^(PAE-U Demo Course|PAE-U Course 101|SaaS Operator Certification)/i.test(course.fullname)
  );
  let hiddenLegacy = 0;
  for (const course of legacyCourses) {
    const hidden = await updateMoodleCourse({
      id: course.id,
      fullname: course.fullname,
      shortname: course.shortname,
      idnumber: course.idnumber ?? '',
      categoryid: Number(course.categoryid ?? 1),
      summary: course.summary ?? '',
      visible: false
    });
    if (hidden.ok) {
      hiddenLegacy += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        sourceCourses: wpCourses.length,
        sourceCategories: wpCategories.length,
        createdCourses: createdCount,
        updatedCourses: updatedCount,
        hiddenLegacyCourses: hiddenLegacy
      },
      null,
      2
    )
  );

  if (config.admin.apiKey) {
    try {
      await fetch(`http://localhost:${config.server.port}/admin/moodle/sync/courses`, {
        method: 'POST',
        headers: {
          'x-admin-key': config.admin.apiKey
        }
      });
      console.log('Sincronización del intermediador ejecutada.');
    } catch (error) {
      console.warn(`No se pudo disparar sync en intermediador: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
