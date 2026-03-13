import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
const CONTAINER = 'pae-u-moodle-1';

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

async function fetchAllCourses(): Promise<WpCourse[]> {
  const first = await fetch(`${WP_BASE}/curso?per_page=100&page=1&_embed=1`);
  if (!first.ok) {
    throw new Error(`WordPress cursos fetch failed (${first.status})`);
  }
  const firstRows = (await first.json()) as WpCourse[];
  const totalPages = Math.max(1, Number(first.headers.get('x-wp-totalpages') ?? 1));
  const all = [...firstRows];
  for (let page = 2; page <= totalPages; page += 1) {
    const response = await fetch(`${WP_BASE}/curso?per_page=100&page=${page}&_embed=1`);
    if (!response.ok) {
      throw new Error(`WordPress cursos fetch failed (${response.status}) at page ${page}`);
    }
    const rows = (await response.json()) as WpCourse[];
    all.push(...rows);
  }
  return all;
}

async function fetchAllCategories(): Promise<WpCategory[]> {
  const response = await fetch(`${WP_BASE}/categoria-cursos?per_page=100`);
  if (!response.ok) {
    throw new Error(`WordPress categorías fetch failed (${response.status})`);
  }
  return (await response.json()) as WpCategory[];
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

function toShortname(slug: string, wpId: number): string {
  const base = slug
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return `PAEU_${base || 'CURSO'}_${wpId}`.slice(0, 80);
}

function runDocker(args: string[]) {
  return execFileSync('docker', args, { encoding: 'utf8' });
}

async function run() {
  console.log('Importando cursos Pasos al Éxito -> Moodle (vía docker CLI)...');
  const [categories, courses] = await Promise.all([fetchAllCategories(), fetchAllCourses()]);
  const categoryMap = new Map(categories.map((cat) => [cat.id, cat]));

  const normalizedCourses = courses.map((course) => {
    const catIds = (course['categoria-cursos'] ?? []).filter((id) => categoryMap.has(id));
    const catNames = catIds.map((id) => categoryMap.get(id)?.name ?? '').filter(Boolean);
    const primaryCategoryId = catIds[0] ?? null;
    return {
      wpId: course.id,
      slug: course.slug,
      link: course.link,
      title: decodeHtml(course.title?.rendered ?? `Curso ${course.id}`),
      shortname: toShortname(course.slug, course.id),
      idnumber: `pasos-curso-${course.id}`,
      primaryCategoryId,
      categoryNames: catNames,
      summary: buildSummary(course, catNames)
    };
  });

  const payload = {
    categories: categories.map((cat) => ({
      wpId: cat.id,
      name: decodeHtml(cat.name),
      slug: cat.slug,
      idnumber: `pasos-cat-${cat.id}`
    })),
    courses: normalizedCourses
  };

  const outDir = resolve(process.cwd(), '../../.data');
  mkdirSync(outDir, { recursive: true });
  const jsonFile = resolve(outDir, 'pasos-import.json');
  const phpFile = resolve(outDir, 'import-pasos.php');
  writeFileSync(jsonFile, JSON.stringify(payload, null, 2), 'utf8');

  const php = `<?php
define('CLI_SCRIPT', true);
require('/var/www/html/config.php');
require_once($CFG->dirroot . '/course/lib.php');
require_once($CFG->dirroot . '/course/classes/category.php');
global $DB;
$admin = get_admin();
if ($admin) {
  \\core\\session\\manager::set_user($admin);
}
$data = json_decode(file_get_contents('/tmp/pasos-import.json'), true);
if (!$data) {
  throw new Exception('Invalid JSON input.');
}
$catMap = [];
foreach ($data['categories'] as $cat) {
  $existing = $DB->get_record('course_categories', ['idnumber' => $cat['idnumber']]);
  if ($existing) {
    if ($existing->name !== $cat['name']) {
      $existing->name = $cat['name'];
      $existing->timemodified = time();
      $DB->update_record('course_categories', $existing);
    }
    $catMap[$cat['wpId']] = (int)$existing->id;
    continue;
  }
  $created = core_course_category::create([
    'name' => $cat['name'],
    'idnumber' => $cat['idnumber'],
    'description' => 'Categoría importada desde Pasos al Éxito (' . $cat['slug'] . ')',
    'descriptionformat' => 1,
    'parent' => 0
  ]);
  $catMap[$cat['wpId']] = (int)$created->id;
}
$createdCount = 0;
$updatedCount = 0;
foreach ($data['courses'] as $course) {
  $categoryId = 1;
  if (!empty($course['primaryCategoryId']) && isset($catMap[$course['primaryCategoryId']])) {
    $categoryId = (int)$catMap[$course['primaryCategoryId']];
  }
  $existing = $DB->get_record('course', ['idnumber' => $course['idnumber']]);
  $record = (object)[
    'fullname' => $course['title'],
    'shortname' => $course['shortname'],
    'idnumber' => $course['idnumber'],
    'category' => $categoryId,
    'summary' => $course['summary'],
    'summaryformat' => 1,
    'visible' => 1,
    'format' => 'topics'
  ];
  if ($existing) {
    $record->id = (int)$existing->id;
    update_course($record);
    $updatedCount++;
  } else {
    create_course($record);
    $createdCount++;
  }
}
$legacy = $DB->get_records_select('course',
  'fullname LIKE :a OR fullname LIKE :b OR fullname LIKE :c',
  ['a' => 'PAE-U Demo Course%', 'b' => 'PAE-U Course 101%', 'c' => 'SaaS Operator Certification%']);
$hidden = 0;
foreach ($legacy as $old) {
  if ((int)$old->visible === 0) {
    continue;
  }
  $old->visible = 0;
  $DB->update_record('course', $old);
  $hidden++;
}
echo json_encode([
  'createdCourses' => $createdCount,
  'updatedCourses' => $updatedCount,
  'hiddenLegacyCourses' => $hidden,
  'importedFromSource' => count($data['courses'])
], JSON_PRETTY_PRINT) . PHP_EOL;
`;

  writeFileSync(phpFile, php, 'utf8');

  runDocker(['cp', jsonFile, `${CONTAINER}:/tmp/pasos-import.json`]);
  runDocker(['cp', phpFile, `${CONTAINER}:/tmp/import-pasos.php`]);
  const result = runDocker(['exec', CONTAINER, 'php', '/tmp/import-pasos.php']);
  console.log(result.trim());

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
      console.warn(`No se pudo disparar sync: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
