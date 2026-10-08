import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { z, ZodError } from 'zod';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { demoBlueprint } from '@atlas/shared';
import { config, getMoodleConfig, hasMoodleConfig, setMoodleConfig } from './config.js';
// University OS modules (Fases 1-5) — wired below after initDb() and before app.listen()
import { migrateSis } from './modules/sis/schema.js';
import { registerSisRoutes } from './modules/sis/routes.js';
import { migrateCrm } from './modules/crm/schema.js';
import { registerCrmRoutes } from './modules/crm/routes.js';
import { migrateSyllabus } from './modules/syllabus/schema.js';
import { registerSyllabusRoutes } from './modules/syllabus/routes.js';
import { migrateBackoffice } from './modules/backoffice/schema.js';
import { registerBackofficeRoutes } from './modules/backoffice/routes.js';
import { migrateCredentials } from './modules/credentials/schema.js';
import { registerCredentialsRoutes } from './modules/credentials/routes.js';
import { migrateCie } from './modules/cie/schema.js';
import { registerCieRoutes } from './modules/cie/routes.js';
import { migrateSitePages } from './modules/pages/schema.js';
import { registerPagesRoutes } from './modules/pages/routes.js';
import { migrateCalendar } from './modules/calendar/schema.js';
import { registerCalendarRoutes } from './modules/calendar/routes.js';
import {
  createCompany,
  createPodcast,
  createWebinar,
  createPlatformUser,
  createTenant,
  deleteCompanyCourseAccess,
  deletePodcast,
  deleteWebinar,
  deactivateEnrollmentsForMoodleUsers,
  getAdminSnapshot,
  getMoodleCategoryNameMap,
  getCatalog,
  getContentBySlug,
  getEntitlements,
  getIntegrationSetting,
  getCompanyById,
  getCompanyByMemberUserId,
  getCompanyByRepresentativeUserId,
  getCompanyMembership,
  getPlatformUserByEmail,
  getPlatformUserById,
  getPublicCourseProgress,
  getPublicUserAuthByEmail,
  getOffers,
  getTenantAndUser,
  initDb,
  listCompanies,
  listCompanyActiveCourseAccess,
  listCompanyActiveMembersWithMoodle,
  listCompanyCourseAccess,
  listCompanyMembers,
  deleteCompany,
  removeCompanyMember,
  getCompanyDashboardStats,
  getCompanyUserProgress,
  createCompanyCourseGroup,
  updateCompanyCourseGroup,
  deleteCompanyCourseGroup,
  listCompanyCourseGroups,
  assignCourseToGroup,
  removeCourseFromGroup,
  assignGroupToMember,
  removeGroupFromMember,
  listCompanyMemberGroups,
  listCompanyMemberCourses,
  getMemberActiveMoodleCourseIds,
  assignCourseToMember,
  removeCourseFromMember,
  getGroupMembers,
  listMoodleBackedUsers,
  listMoodleCategories,
  listMoodleCoursesPage,
  listPlatformUsers,
  listPlatformUsersPage,
  listPodcasts,
  listWebinars,
  listPublicCourseInteractions,
  listPublicCourseProgressByUser,
  getPlatformUsersByIds,
  getActiveEnrolledCourseIds,
  listUserCourses,
  listMoodleCourses,
  listTenants,
  mapLocalUsersByMoodleId,
  pool,
  savePublicCourseInteraction,
  saveIntegrationSetting,
  setCompanyMemberStatus,
  setPlatformUsersStatus,
  setUserCourseEnrollmentStatusForUsers,
  syncMoodleCategories,
  syncMoodleCoursesWithCategories,
  upsertCompanyCourseAccess,
  upsertCompanyMember,
  updateCompany,
  updatePlatformUserProfile,
  updatePodcast,
  updateWebinar,
  upsertPublicUserAuth,
  upsertPlatformUserFromMoodle,
  upsertPublicCourseProgress,
  upsertUserCourseEnrollment
} from './db.js';
import {
  createMoodleNote,
  createMoodleUser,
  enrolMoodleUser,
  getMoodleActivitiesCompletionStatus,
  getMoodleCategories,
  getMoodleEnrolledUsers,
  getMoodleNotes,
  getMoodleCourseContents,
  pushTermDatesToCourse,
  getMoodleCourses,
  getMoodleSiteInfo,
  getMoodleUserCourses,
  getMoodleUsers,
  getMoodleUsersByEmail,
  unenrolMoodleUser,
  updateMoodleActivityCompletion,
  updateMoodleUserProfile,
  updateMoodleUserStatus
} from './moodle.js';

const app = Fastify({
  logger: true,
  rewriteUrl: (req) => {
    const rawUrl = req.url ?? '/';
    if (rawUrl === '/api') {
      return '/';
    }
    if (rawUrl.startsWith('/api/')) {
      return rawUrl.slice(4) || '/';
    }
    return rawUrl;
  }
});
const routeRegistry: Array<{ method: string; url: string }> = [];
const autoSyncIntervalMs = Math.max(30, Number(process.env.AUTO_SYNC_INTERVAL_SEC ?? 180)) * 1000;
const publicSyncMaxAgeMs = Math.max(30, Number(process.env.PUBLIC_SYNC_MAX_AGE_SEC ?? 120)) * 1000;
type AdminAuthSession = {
  token: string;
  email: string;
  createdAt: string;
  expiresAt: string;
};
const adminSessions = new Map<string, AdminAuthSession>();
type PublicAuthSession = {
  token: string;
  userId: string;
  email: string;
  fullName: string;
  locale: string;
  createdAt: string;
  expiresAt: string;
  /**
   * Ficheros de Moodle que esta sesión puede pedir por el proxy.
   *
   * Se llena cuando el usuario carga legítimamente el contenido de un curso en
   * el que está matriculado, y el proxy sólo sirve lo que esté aquí. Antes el
   * proxy aceptaba cualquier ruta pluginfile.php del host de Moodle y le ponía
   * el token de servicio: con una sesión de alumno se podían descargar las
   * entregas de tareas de otros alumnos y áreas draftfile.php ajenas.
   */
  allowedFileUrls: Set<string>;
};
const publicSessions = new Map<string, PublicAuthSession>();
const publicSessionTtlMinutes = Math.max(60, Number(process.env.PUBLIC_SESSION_TTL_MINUTES ?? 43200));
let moodleSyncInFlight: Promise<void> | null = null;
const moodleInteractionPrefix = 'ATLAS_INTERACTION::';

const demoVideoCandidates = [
  process.env.DEMO_VIDEO_PATH,
  resolve(process.cwd(), '.data/demo-course.mp4'),
  resolve(process.cwd(), '../../.data/demo-course.mp4')
].filter((value): value is string => Boolean(value));

const demoVideoPath = demoVideoCandidates.find((candidate) => existsSync(candidate)) ?? null;

type NormalizedMoodleCategory = {
  id: number;
  name: string;
  idnumber?: string;
  parent?: number;
  depth?: number;
  path?: string;
  visible?: number;
};

app.addHook('onRoute', (route) => {
  const methods = Array.isArray(route.method) ? route.method : [route.method];
  for (const method of methods) {
    routeRegistry.push({ method: String(method), url: route.url });
  }
});

await app.register(cors, {
  origin: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key']
});
await app.register(sensible);

/**
 * Manejador global de errores.
 *
 * Sin esto, cualquier `schema.parse()` que falle sale como HTTP 500 con el
 * volcado interno de Zod — incluidas las rutas preexistentes
 * `/v1/auth/register`, `/v1/auth/login` y `/admin/auth/login`. Aquí se
 * traduce cada familia de error al código que le corresponde y el detalle de
 * los 5xx se queda en el log, nunca en la respuesta.
 */
app.setErrorHandler((error, request, reply) => {
  if (error instanceof ZodError) {
    const fields = error.issues.map((issue) => ({
      field: issue.path.join('.') || '(body)',
      message: issue.message
    }));
    request.log.info({ fields }, 'request rejected by schema validation');
    return reply.code(400).send({
      statusCode: 400,
      error: 'Bad Request',
      message: `Validation failed: ${fields.map((f) => `${f.field} ${f.message}`).join('; ')}`,
      fields
    });
  }

  const pgCode = (error as { code?: string }).code;
  if (pgCode === '23505') {
    request.log.info({ pgCode }, 'unique constraint violation');
    return reply.code(409).send({
      statusCode: 409,
      error: 'Conflict',
      message: 'That record already exists.'
    });
  }
  if (pgCode === '23503' || pgCode === '23514' || pgCode === '22P02') {
    request.log.info({ pgCode }, 'constraint violation rejected');
    return reply.code(400).send({
      statusCode: 400,
      error: 'Bad Request',
      message: 'The request references data that does not exist or is not allowed.'
    });
  }

  // Errores ya tipados por @fastify/sensible u otro codigo explicito (4xx).
  // El narrowing de `instanceof ZodError` deja `error` como unknown en esta
  // rama, asi que se reafirma la forma minima que se necesita leer.
  const typed = error as { name?: string; message?: string; statusCode?: number };
  const statusCode = Number(typed.statusCode ?? 500);
  if (statusCode >= 400 && statusCode < 500) {
    return reply.code(statusCode).send({
      statusCode,
      error: typed.name || 'Error',
      message: typed.message || 'Request rejected.'
    });
  }

  // 5xx: el detalle se queda en el log del servidor, nunca en la respuesta.
  request.log.error({ err: error }, 'unhandled error');
  return reply.code(500).send({
    statusCode: 500,
    error: 'Internal Server Error',
    message: 'Unexpected error. The incident was logged.'
  });
});

await initDb();

// University OS module migrations (idempotent CREATE TABLE IF NOT EXISTS)
await migrateSis(pool);
await migrateCrm(pool);
await migrateSyllabus(pool);
await migrateBackoffice(pool);
await migrateCredentials(pool);
await migrateCie(pool);
await migrateSitePages(pool);
await migrateCalendar(pool);

async function loadPersistedMoodleConnection(): Promise<void> {
  const stored = await getIntegrationSetting<{ baseUrl?: string; token?: string }>('moodle.connection');
  if (!stored) {
    return;
  }
  const baseUrl = typeof stored.baseUrl === 'string' ? stored.baseUrl.trim() : '';
  const token = typeof stored.token === 'string' ? stored.token.trim() : '';
  if (!baseUrl || !token) {
    return;
  }
  setMoodleConfig({ baseUrl, token });
}

await loadPersistedMoodleConnection();

function cleanExpiredAdminSessions(): void {
  const now = Date.now();
  for (const [token, session] of adminSessions.entries()) {
    if (Date.parse(session.expiresAt) <= now) {
      adminSessions.delete(token);
    }
  }
}

function cleanExpiredPublicSessions(): void {
  const now = Date.now();
  for (const [token, session] of publicSessions.entries()) {
    if (Date.parse(session.expiresAt) <= now) {
      publicSessions.delete(token);
    }
  }
}

function getBearerToken(headers: Record<string, unknown>): string | null {
  const authorization = headers.authorization;
  if (typeof authorization !== 'string' || authorization.length < 8) {
    return null;
  }

  const [scheme, value] = authorization.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) {
    return null;
  }

  return value.trim();
}

function createPublicSession(input: {
  userId: string;
  email: string;
  fullName: string;
  locale: string;
}): PublicAuthSession {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + publicSessionTtlMinutes * 60000);
  const token = randomBytes(32).toString('hex');
  const session: PublicAuthSession = {
    token,
    userId: input.userId,
    email: input.email,
    fullName: input.fullName,
    locale: input.locale,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    allowedFileUrls: new Set<string>()
  };
  publicSessions.set(token, session);
  return session;
}

/**
 * Normaliza una URL de fichero de Moodle para compararla.
 *
 * El front reescribe el HTML del aula y puede añadir o quitar el parámetro
 * `token`/`forcedownload`, así que la comparación tiene que hacerse sobre
 * origen + ruta + el resto de la query, no sobre la cadena literal.
 */
function fileAccessKey(rawUrl: URL): string {
  const copy = new URL(rawUrl.toString());
  copy.searchParams.delete('token');
  copy.searchParams.delete('forcedownload');
  copy.hash = '';
  return copy.toString();
}

/**
 * Apunta en la sesión los ficheros que vienen dentro del contenido de un curso
 * que el usuario sí puede ver, para que el proxy pueda servirlos después.
 */
function rememberCourseFiles(session: PublicAuthSession, sections: unknown): void {
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') {
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if ((key === 'fileurl' || key === 'url') && typeof value === 'string' && value.includes('://')) {
        try {
          session.allowedFileUrls.add(fileAccessKey(new URL(value)));
        } catch {
          // Una URL malformada en el contenido no debe tumbar la respuesta.
        }
        continue;
      }
      visit(value);
    }
  };
  visit(sections);
}

/**
 * Comparación de secretos en tiempo constante.
 *
 * `!==` corta en el primer byte distinto, así que el tiempo de respuesta filtra
 * cuántos caracteres del principio acertó quien prueba. Con una ruta sin límite
 * de intentos eso es explotable byte a byte.
 */
function secretEquals(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  // timingSafeEqual exige la misma longitud; comparar hashes la iguala sin
  // revelar por la vía rápida si la longitud coincide.
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

function getPublicSessionFromRequest(request: { headers: Record<string, unknown> }) {
  cleanExpiredPublicSessions();
  const token = getBearerToken(request.headers);
  return getPublicSessionByToken(token);
}

function getPublicSessionByToken(token: string | null) {
  cleanExpiredPublicSessions();
  if (!token) {
    throw app.httpErrors.unauthorized('Public session is required');
  }
  const session = publicSessions.get(token);
  if (!session) {
    throw app.httpErrors.unauthorized('Invalid public session');
  }
  if (Date.parse(session.expiresAt) <= Date.now()) {
    publicSessions.delete(token);
    throw app.httpErrors.unauthorized('Expired public session');
  }
  return session;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) {
    return false;
  }
  const derived = scryptSync(password, salt, 64).toString('hex');
  return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derived, 'hex'));
}

function parseMoodleInteractionNote(
  rawContent: unknown,
  fallback: { moodleCourseId: number; moduleId: number; createdAt: string; noteId: string }
): {
  id: string;
  moodle_course_id: number;
  module_id: number;
  module_name: string;
  module_type: string;
  response: Record<string, unknown>;
  created_at: string;
} | null {
  if (typeof rawContent !== 'string' || !rawContent.startsWith(moodleInteractionPrefix)) {
    return null;
  }
  try {
    const payload = JSON.parse(rawContent.slice(moodleInteractionPrefix.length)) as Record<string, unknown>;
    const moduleId = Number(payload.moduleId ?? fallback.moduleId);
    const createdAt = typeof payload.createdAt === 'string' ? payload.createdAt : fallback.createdAt;
    return {
      id: String(payload.id ?? fallback.noteId),
      moodle_course_id: Number(payload.moodleCourseId ?? fallback.moodleCourseId),
      module_id: Number.isInteger(moduleId) && moduleId > 0 ? moduleId : fallback.moduleId,
      module_name: typeof payload.moduleName === 'string' ? payload.moduleName : 'Actividad',
      module_type: typeof payload.moduleType === 'string' ? payload.moduleType : 'activity',
      response: (payload.response && typeof payload.response === 'object' ? payload.response : { text: String(rawContent) }) as Record<
        string,
        unknown
      >,
      created_at: createdAt
    };
  } catch {
    return null;
  }
}

async function buildMoodleCourseProgress(input: {
  localUserId: string;
  moodleUserId: number;
  moodleCourseId: number;
}) {
  const [completionResult, notesResult, cachedProgress, cachedInteractions] = await Promise.all([
    getMoodleActivitiesCompletionStatus({
      courseId: input.moodleCourseId,
      userId: input.moodleUserId
    }),
    getMoodleNotes({
      userId: input.moodleUserId,
      courseId: input.moodleCourseId
    }),
    getPublicCourseProgress({
      userId: input.localUserId,
      moodleCourseId: input.moodleCourseId
    }),
    listPublicCourseInteractions({
      userId: input.localUserId,
      moodleCourseId: input.moodleCourseId,
      limit: 100
    })
  ]);

  if (!completionResult.ok && !notesResult.ok) {
    return {
      progress: cachedProgress,
      interactions: cachedInteractions
    };
  }

  const statuses = completionResult.ok && completionResult.data?.statuses ? completionResult.data.statuses : [];
  const completedModuleIds = statuses
    .filter((status) => Number(status.state) > 0 && Number.isInteger(Number(status.cmid)))
    .map((status) => Number(status.cmid))
    .filter((value, index, array) => value > 0 && array.indexOf(value) === index);
  const totalModules = statuses.filter((status) => Number.isInteger(Number(status.cmid))).length;

  const moodleInteractions = (notesResult.ok ? notesResult.data?.notes ?? [] : [])
    .map((note) =>
      parseMoodleInteractionNote(note.content, {
        moodleCourseId: input.moodleCourseId,
        moduleId: 0,
        createdAt:
          typeof note.created === 'number' && Number.isFinite(note.created)
            ? new Date(note.created * 1000).toISOString()
            : new Date().toISOString(),
        noteId: `moodle-note-${note.id ?? randomUUID()}`
      })
    )
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  const cachedCompleted = Array.isArray(cachedProgress?.completed_module_ids)
    ? cachedProgress.completed_module_ids
      .map((value: unknown) => Number(value))
      .filter((value: number) => Number.isInteger(value) && value > 0)
    : [];
  const mergedCompletedModuleIds = Array.from(new Set([...cachedCompleted, ...completedModuleIds])).sort((a, b) => a - b);

  const interactionById = new Map<string, (typeof moodleInteractions)[number]>();
  for (const item of cachedInteractions) {
    if (!item || !item.id) {
      continue;
    }
    interactionById.set(String(item.id), {
      id: String(item.id),
      moodle_course_id: Number(item.moodle_course_id),
      module_id: Number(item.module_id),
      module_name: String(item.module_name ?? 'Actividad'),
      module_type: String(item.module_type ?? 'activity'),
      response:
        item.response && typeof item.response === 'object'
          ? (item.response as Record<string, unknown>)
          : ({ text: '' } as Record<string, unknown>),
      created_at:
        typeof item.created_at === 'string'
          ? item.created_at
          : new Date(item.created_at as Date).toISOString()
    });
  }
  for (const item of moodleInteractions) {
    interactionById.set(String(item.id), item);
  }
  const mergedInteractions = [...interactionById.values()].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  const mergedTotalModules = Math.max(Number(cachedProgress?.total_modules ?? 0), totalModules);
  const interactionsCount = mergedInteractions.length;
  const computedXp = mergedCompletedModuleIds.length * 50 + interactionsCount * 10;
  const xp = Math.max(computedXp, Number(cachedProgress?.xp ?? 0));
  const progressPercent =
    mergedTotalModules > 0 ? Math.min(100, Math.round((mergedCompletedModuleIds.length / mergedTotalModules) * 100)) : 0;

  const moodleLastActivityAt =
    moodleInteractions[0]?.created_at ??
    (statuses
      .map((status) => Number(status.timecompleted))
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((a, b) => b - a)
      .map((value) => new Date(value * 1000).toISOString())[0] ??
      null);
  const lastActivityAt = [moodleLastActivityAt, cachedProgress?.last_activity_at]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;

  const mirroredProgress = await upsertPublicCourseProgress({
    userId: input.localUserId,
    moodleCourseId: input.moodleCourseId,
    completedModuleIds: mergedCompletedModuleIds,
    interactionsCount,
    xp,
    totalModules: mergedTotalModules,
    progressPercent,
    lastActivityAt
  });

  return {
    progress: mirroredProgress,
    interactions: mergedInteractions
  };
}

function ensureAdmin(request: { headers: Record<string, unknown> }) {
  cleanExpiredAdminSessions();
  const apiKey = request.headers['x-admin-key'];
  if (!apiKey || !secretEquals(String(apiKey), config.admin.apiKey)) {
    const token = getBearerToken(request.headers);
    if (!token) {
      throw app.httpErrors.unauthorized('Missing admin credentials');
    }

    const session = adminSessions.get(token);
    if (!session) {
      throw app.httpErrors.unauthorized('Invalid admin session');
    }

    if (Date.parse(session.expiresAt) <= Date.now()) {
      adminSessions.delete(token);
      throw app.httpErrors.unauthorized('Expired admin session');
    }
    return session;
  }
  return {
    token: 'api-key',
    email: config.admin.email,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + config.admin.sessionTtlMinutes * 60000).toISOString()
  };
}

function loadMoodleCategoriesFromDockerFallback(): NormalizedMoodleCategory[] {
  try {
    const raw = execFileSync(
      'docker',
      [
        'exec',
        'atlas-moodle-db',
        'mariadb',
        '-N',
        '-umoodle',
        '-pmoodle',
        'moodle',
        '-e',
        "SELECT id,name,IFNULL(idnumber,''),parent,depth,IFNULL(path,''),visible FROM mdl_course_categories;"
      ],
      { encoding: 'utf8' }
    );
    const rows = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split('\t'));
    return rows
      .map((parts) => ({
        id: Number(parts[0]),
        name: String(parts[1] ?? ''),
        idnumber: String(parts[2] ?? '') || undefined,
        parent: Number(parts[3] ?? 0),
        depth: Number(parts[4] ?? 0),
        path: String(parts[5] ?? '') || undefined,
        visible: Number(parts[6] ?? 1)
      }))
      .filter((item) => Number.isInteger(item.id) && item.id > 0 && item.name.length > 0);
  } catch (error) {
    app.log.warn({ error }, 'Docker category fallback failed');
    return [];
  }
}

async function loadMoodleCategoriesForSync(): Promise<{
  categories: NormalizedMoodleCategory[];
  source: 'webservice' | 'docker' | 'cache';
}> {
  const categoriesResult = await getMoodleCategories();
  if (categoriesResult.ok) {
    const categories = (categoriesResult.data ?? [])
      .filter((category) => Number.isInteger(Number(category.id)) && typeof category.name === 'string')
      .map((category) => ({
        id: Number(category.id),
        name: String(category.name),
        idnumber: category.idnumber,
        parent: typeof category.parent === 'number' ? category.parent : undefined,
        depth: typeof category.depth === 'number' ? category.depth : undefined,
        path: category.path,
        visible: typeof category.visible === 'number' ? category.visible : undefined
      }));
    return { categories, source: 'webservice' };
  }

  const dockerCategories = loadMoodleCategoriesFromDockerFallback();
  if (dockerCategories.length > 0) {
    return { categories: dockerCategories, source: 'docker' };
  }

  const cached = await listMoodleCategories();
  const categories = cached
    .map((row) => ({
      id: Number(row.moodle_category_id),
      name: String(row.name),
      idnumber: row.idnumber ?? undefined,
      parent: typeof row.parent_id === 'number' ? row.parent_id : undefined,
      depth: typeof row.depth === 'number' ? row.depth : undefined,
      path: row.path ?? undefined,
      visible: row.visible === false ? 0 : 1
    }))
    .filter((row) => Number.isInteger(row.id) && row.id > 0 && row.name.length > 0);
  return { categories, source: 'cache' };
}

async function runCoursesSyncInternal() {
  const [coursesResult, categoriesBundle] = await Promise.all([getMoodleCourses(), loadMoodleCategoriesForSync()]);
  if (!coursesResult.ok) {
    return {
      synced: false as const,
      error: coursesResult.error ?? 'Unable to fetch courses from Moodle'
    };
  }

  const normalizedCategories = categoriesBundle.categories;
  await syncMoodleCategories(normalizedCategories);
  const categoryNameById =
    normalizedCategories.length > 0
      ? Object.fromEntries(normalizedCategories.map((category) => [Number(category.id), String(category.name)]))
      : await getMoodleCategoryNameMap();

  const courses = (coursesResult.data ?? []).filter((course) => Number(course.id) > 1);
  const syncResult = await syncMoodleCoursesWithCategories(courses, categoryNameById);
  await saveIntegrationSetting('moodle.last_courses_sync', {
    syncedAt: new Date().toISOString(),
    total: courses.length,
    upsertedCatalogAssets: syncResult.upsertedCatalogAssets,
    prunedCourses: syncResult.prunedCourses,
    prunedCatalogAssets: syncResult.prunedCatalogAssets,
    categoriesSource: categoriesBundle.source
  });

  return {
    synced: true as const,
    totalCourses: courses.length,
    upsertedCourses: syncResult.upsertedCourses,
    upsertedCatalogAssets: syncResult.upsertedCatalogAssets,
    prunedCourses: syncResult.prunedCourses,
    prunedCatalogAssets: syncResult.prunedCatalogAssets
  };
}

async function runCategoriesSyncInternal() {
  const categoriesBundle = await loadMoodleCategoriesForSync();
  const categories = categoriesBundle.categories;
  if (categories.length === 0) {
    return {
      synced: false as const,
      error: 'Unable to fetch categories from Moodle'
    };
  }
  const syncResult = await syncMoodleCategories(categories);
  await saveIntegrationSetting('moodle.last_categories_sync', {
    syncedAt: new Date().toISOString(),
    total: categories.length,
    source: categoriesBundle.source
  });
  return {
    synced: true as const,
    totalCategories: categories.length,
    upsertedCategories: syncResult.upsertedCategories,
    source: categoriesBundle.source
  };
}

async function runUsersSyncInternal() {
  const usersResult = await getMoodleUsers();
  if (!usersResult.ok) {
    return {
      synced: false as const,
      error: usersResult.error ?? 'Unable to fetch users from Moodle'
    };
  }

  const tenantId = (await getTenantAndUser()).tenant?.id;
  if (!tenantId) {
    return {
      synced: false as const,
      error: 'No tenant available for user sync'
    };
  }

  const moodleUsers = (usersResult.data?.users ?? []).filter(
    (user) => Number(user.id) > 0 && user.username !== 'guest'
  );

  let upsertedUsers = 0;
  for (const moodleUser of moodleUsers) {
    const synced = await upsertPlatformUserFromMoodle({
      moodleUser,
      tenantId
    });
    if (synced) {
      upsertedUsers += 1;
    }
  }

  const moodleUserIds = moodleUsers.map((user) => Number(user.id));
  await deactivateEnrollmentsForMoodleUsers(moodleUserIds);

  const localUserMap = await mapLocalUsersByMoodleId();
  const courses = await listMoodleCourses(5000);

  let enrollmentLinks = 0;
  const warnings: string[] = [];

  for (const course of courses) {
    const courseId = Number(course.moodle_course_id);
    const enrolledResult = await getMoodleEnrolledUsers(courseId);

    if (!enrolledResult.ok) {
      warnings.push(`course ${courseId}: ${enrolledResult.error ?? 'enrolled users fetch failed'}`);
      continue;
    }

    for (const enrolledUser of enrolledResult.data ?? []) {
      const localUserId = localUserMap.get(Number(enrolledUser.id));
      if (!localUserId) {
        continue;
      }

      await upsertUserCourseEnrollment({
        userId: localUserId,
        moodleCourseId: courseId,
        status: 'active'
      });
      enrollmentLinks += 1;
    }
  }

  await saveIntegrationSetting('moodle.last_users_sync', {
    syncedAt: new Date().toISOString(),
    totalUsers: moodleUsers.length,
    upsertedUsers,
    enrollmentLinks,
    warningsCount: warnings.length
  });

  return {
    synced: true as const,
    totalUsers: moodleUsers.length,
    upsertedUsers,
    enrollmentLinks,
    warnings
  };
}

async function runEnterpriseSyncInternal() {
  const companies = await listCompanies();
  if (companies.length === 0) {
    return { synced: true, upsertedMembers: 0, error: null };
  }
  let updatedCount = 0;
  for (const company of companies) {
    const members = await listCompanyMembers(String(company.id));
    for (const member of members) {
      if (!member.moodle_user_id) continue;
      await syncCompanyCoursesForMember({
        companyId: String(company.id),
        userId: String(member.user_id),
        moodleUserId: Number(member.moodle_user_id)
      });
      updatedCount += 1;
    }
  }
  return { synced: true, upsertedMembers: updatedCount, error: null };
}

async function runFullMoodleSync(trigger: string): Promise<void> {
  if (!hasMoodleConfig()) {
    return;
  }
  if (moodleSyncInFlight) {
    await moodleSyncInFlight;
    return;
  }

  moodleSyncInFlight = (async () => {
    app.log.info({ trigger }, 'Starting full Moodle sync');
    const courseSync = await runCoursesSyncInternal();
    if (!courseSync.synced) {
      app.log.warn({ trigger, error: courseSync.error }, 'Courses sync failed');
      return;
    }

    const userSync = await runUsersSyncInternal();
    if (!userSync.synced) {
      app.log.warn({ trigger, error: userSync.error }, 'Users sync failed');
      return;
    }
    app.log.info(
      {
        trigger,
        courses: courseSync.totalCourses,
        users: userSync.totalUsers,
        enrollmentLinks: userSync.enrollmentLinks
      },
      'Full Moodle sync completed'
    );
  })();

  try {
    await moodleSyncInFlight;
  } finally {
    moodleSyncInFlight = null;
  }
}


async function ensureFreshPublicData(): Promise<void> {
  if (!hasMoodleConfig()) {
    return;
  }
  const lastSync = await getIntegrationSetting<{ syncedAt: string }>('moodle.last_courses_sync');
  if (!lastSync?.syncedAt) {
    await runFullMoodleSync('public-bootstrap');
    return;
  }

  const ageMs = Date.now() - Date.parse(lastSync.syncedAt);
  if (Number.isNaN(ageMs) || ageMs > publicSyncMaxAgeMs) {
    await runFullMoodleSync('public-stale-check');
  }
}

async function syncUserEnrollmentsFromMoodle(userId: string, moodleUserId: number): Promise<{
  synced: boolean;
  moodleCourses: unknown[];
  error?: string;
}> {
  const moodleCoursesResult = await getMoodleUserCourses(moodleUserId);
  if (!moodleCoursesResult.ok) {
    return {
      synced: false,
      moodleCourses: [],
      error: moodleCoursesResult.error ?? 'Unable to fetch Moodle user courses'
    };
  }

  const moodleCourses = moodleCoursesResult.data ?? [];
  const activeCourseIds = moodleCourses
    .map((course) => Number((course as { id?: unknown }).id))
    .filter((courseId) => Number.isInteger(courseId) && courseId > 0);

  await pool.query(
    `
      UPDATE user_course_enrollments
      SET status = 'inactive',
          synced_at = NOW()
      WHERE user_id = $1
    `,
    [userId]
  );

  for (const moodleCourseId of activeCourseIds) {
    await upsertUserCourseEnrollment({
      userId,
      moodleCourseId,
      status: 'active'
    });
  }

  return {
    synced: true,
    moodleCourses
  };
}

app.get('/health', async () => {
  const db = await pool.query('SELECT NOW() AS now');

  return {
    status: 'ok',
    service: 'api',
    timestamp: new Date().toISOString(),
    db: db.rows[0]?.now ?? null,
    moodleConfigured: hasMoodleConfig()
  };
});

app.get('/v1/home', async () => {
  await ensureFreshPublicData();
  const [identity, featured, offers] = await Promise.all([getTenantAndUser(), getCatalog(), getOffers()]);

  if (!identity.tenant || !identity.user) {
    throw app.httpErrors.internalServerError('Tenant or user data not available');
  }

  return {
    tenant: identity.tenant,
    user: identity.user,
    featured,
    liveNow: featured.filter((item) => item.kind === 'live'),
    continueLearning: featured.filter((item) => item.kind === 'course'),
    offers
  };
});

app.get('/v1/catalog', async () => {
  await ensureFreshPublicData();
  return getCatalog();
});
app.get('/v1/webinars', async () => listWebinars({ activeOnly: true }));
app.get('/v1/podcasts', async () => listPodcasts({ activeOnly: true, landingOnly: true }));
app.get('/v1/offers', async () => getOffers());
app.get('/v1/entitlements', async () => getEntitlements());
app.get('/v1/blueprint', async () => demoBlueprint);


app.get('/v1/media/demo.mp4', async (request, reply) => {
  if (!demoVideoPath || !existsSync(demoVideoPath)) {
    return reply.notFound('Demo video not available');
  }

  const stats = statSync(demoVideoPath);
  const rangeHeader = request.headers.range;
  if (typeof rangeHeader === 'string') {
    const [startRaw, endRaw] = rangeHeader.replace(/bytes=/, '').split('-');
    const start = Number(startRaw);
    const end = endRaw ? Number(endRaw) : stats.size - 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= stats.size) {
      reply.header('Content-Range', `bytes */${stats.size}`);
      return reply.code(416).send();
    }
    reply
      .code(206)
      .header('Content-Type', 'video/mp4')
      .header('Accept-Ranges', 'bytes')
      .header('Content-Length', String(end - start + 1))
      .header('Content-Range', `bytes ${start}-${end}/${stats.size}`)
      .header('Cache-Control', 'public, max-age=86400');
    return reply.send(createReadStream(demoVideoPath, { start, end }));
  }

  reply
    .header('Content-Type', 'video/mp4')
    .header('Accept-Ranges', 'bytes')
    .header('Content-Length', String(stats.size))
    .header('Cache-Control', 'public, max-age=86400');
  return reply.send(createReadStream(demoVideoPath));
});

const publicRegisterSchema = z.object({
  fullName: z.string().min(3),
  email: z.string().email(),
  password: z.string().min(8),
  locale: z.string().default('es')
});

const publicLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const publicProfileUpdateSchema = z
  .object({
    fullName: z.string().min(3).max(120).optional(),
    email: z.string().email().optional(),
    locale: z.string().min(2).max(10).optional()
  })
  .refine((input) => Boolean(input.fullName || input.email || input.locale), {
    message: 'At least one profile field is required'
  });

app.post('/v1/auth/register', async (request, reply) => {
  const payload = publicRegisterSchema.parse(request.body);
  const email = payload.email.trim().toLowerCase();

  const existingLocal = await getPlatformUserByEmail(email);
  if (existingLocal) {
    const existingAuth = await getPublicUserAuthByEmail(email);
    if (existingAuth) {
      return reply.conflict('Email already exists. Please login.');
    }

    // Existing Moodle-synced user without web credentials: activate web access.
    const updatedUser = await updatePlatformUserProfile({
      userId: String(existingLocal.id),
      fullName: payload.fullName.trim(),
      email,
      locale: payload.locale.trim().toLowerCase()
    });
    if (!updatedUser) {
      return reply.internalServerError('Unable to activate web access');
    }

    await upsertPublicUserAuth({
      userId: String(updatedUser.id),
      passwordHash: hashPassword(payload.password)
    });

    const session = createPublicSession({
      userId: String(updatedUser.id),
      email: String(updatedUser.email),
      fullName: String(updatedUser.full_name),
      locale: String(updatedUser.locale)
    });

    return {
      registered: true,
      activated: true,
      token: session.token,
      expiresAt: session.expiresAt,
      user: {
        id: updatedUser.id,
        fullName: updatedUser.full_name,
        email: updatedUser.email,
        locale: updatedUser.locale,
        moodleUserId: updatedUser.moodle_user_id
      }
    };
  }

  const existingMoodle = await getMoodleUsersByEmail(email);
  if (existingMoodle.ok && (existingMoodle.data?.length ?? 0) > 0) {
    return reply.conflict('Email already exists in Moodle. Contact support for migration.');
  }

  const tenantId = (await getTenantAndUser()).tenant?.id;
  if (!tenantId) {
    return reply.internalServerError('No tenant available');
  }

  const { firstname, lastname } = splitName(payload.fullName);
  const username = normalizeUsername(email);
  const createMoodle = await createMoodleUser({
    username,
    firstname,
    lastname,
    email,
    password: payload.password
  });

  if (!createMoodle.ok || !createMoodle.data?.[0]?.id) {
    return reply.badRequest(`Moodle registration failed: ${createMoodle.error ?? 'unknown error'}`);
  }

  const user = await createPlatformUser({
    id: randomUUID(),
    fullName: payload.fullName,
    email,
    locale: payload.locale,
    roles: ['learner'],
    tenantId,
    moodleUserId: Number(createMoodle.data[0].id)
  });

  await upsertPublicUserAuth({
    userId: String(user.id),
    passwordHash: hashPassword(payload.password)
  });

  const session = createPublicSession({
    userId: String(user.id),
    email: String(user.email),
    fullName: String(user.full_name),
    locale: String(user.locale)
  });

  return {
    registered: true,
    token: session.token,
    expiresAt: session.expiresAt,
    user: {
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      locale: user.locale,
      moodleUserId: user.moodle_user_id
    }
  };
});

app.post('/v1/auth/login', async (request, reply) => {
  const payload = publicLoginSchema.parse(request.body);
  const email = payload.email.trim().toLowerCase();
  const authUser = await getPublicUserAuthByEmail(email);
  if (!authUser) {
    const existingUser = await getPlatformUserByEmail(email);
    if (existingUser) {
      return reply.conflict('Cuenta existente sin acceso web. Usa Registro para activarla.');
    }
    return reply.unauthorized('Invalid credentials');
  }

  if (!verifyPassword(payload.password, String(authUser.password_hash))) {
    return reply.unauthorized('Invalid credentials');
  }

  const session = createPublicSession({
    userId: String(authUser.id),
    email: String(authUser.email),
    fullName: String(authUser.full_name),
    locale: String(authUser.locale)
  });

  return {
    authenticated: true,
    token: session.token,
    expiresAt: session.expiresAt,
    user: {
      id: authUser.id,
      fullName: authUser.full_name,
      email: authUser.email,
      locale: authUser.locale
    }
  };
});

app.get('/v1/auth/me', async (request) => {
  const session = getPublicSessionFromRequest(request);
  return {
    authenticated: true,
    user: {
      id: session.userId,
      fullName: session.fullName,
      email: session.email,
      locale: session.locale
    },
    expiresAt: session.expiresAt
  };
});

app.patch('/v1/auth/me', async (request, reply) => {
  const session = getPublicSessionFromRequest(request);
  const payload = publicProfileUpdateSchema.parse(request.body);
  const user = await getPlatformUserById(session.userId);
  if (!user) {
    return reply.notFound('User not found');
  }

  const nextFullName = (payload.fullName ?? String(user.full_name)).trim();
  const nextEmail = (payload.email ?? String(user.email)).trim().toLowerCase();
  const nextLocale = (payload.locale ?? String(user.locale)).trim().toLowerCase();
  if (!nextFullName || !nextEmail || !nextLocale) {
    return reply.badRequest('Invalid profile payload');
  }

  if (nextEmail !== String(user.email).toLowerCase()) {
    const existing = await getPlatformUserByEmail(nextEmail);
    if (existing && String(existing.id) !== String(user.id)) {
      return reply.conflict('Email already exists. Use another email.');
    }
  }

  if (user.moodle_user_id) {
    const { firstname, lastname } = splitName(nextFullName);
    const moodleResult = await updateMoodleUserProfile({
      userId: Number(user.moodle_user_id),
      firstname,
      lastname,
      email: nextEmail,
      lang: nextLocale
    });
    if (!moodleResult.ok) {
      return reply.badRequest(`Moodle profile update failed: ${moodleResult.error ?? 'unknown error'}`);
    }
  }

  const updated = await updatePlatformUserProfile({
    userId: String(user.id),
    fullName: nextFullName,
    email: nextEmail,
    locale: nextLocale
  });
  if (!updated) {
    return reply.internalServerError('Profile update failed');
  }

  const currentSession = publicSessions.get(session.token);
  if (currentSession) {
    currentSession.fullName = String(updated.full_name);
    currentSession.email = String(updated.email);
    currentSession.locale = String(updated.locale);
    publicSessions.set(session.token, currentSession);
  }

  return {
    updated: true,
    user: {
      id: updated.id,
      fullName: updated.full_name,
      email: updated.email,
      locale: updated.locale,
      moodleUserId: updated.moodle_user_id
    },
    expiresAt: session.expiresAt
  };
});

app.get('/v1/me/courses', async (request) => {
  await ensureFreshPublicData();
  const session = getPublicSessionFromRequest(request);
  const user = await getPlatformUserById(session.userId);
  if (!user) {
    throw app.httpErrors.notFound('User not found');
  }

  let moodleCourses: unknown[] = [];
  if (user.moodle_user_id) {
    const syncResult = await syncUserEnrollmentsFromMoodle(String(user.id), Number(user.moodle_user_id));
    if (syncResult.synced) {
      moodleCourses = syncResult.moodleCourses;
    } else {
      app.log.warn(
        {
          userId: String(user.id),
          moodleUserId: Number(user.moodle_user_id),
          error: syncResult.error
        },
        'Public user enrollment sync failed'
      );
    }
  }
  const localCourses = (await listUserCourses(String(user.id))).filter((course) => String(course.status) === 'active');
  const progressRecords = await listPublicCourseProgressByUser(String(user.id));

  return {
    user: {
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      locale: user.locale,
      moodleUserId: user.moodle_user_id
    },
    localCourses,
    moodleCourses,
    progressRecords
  };
});


app.get('/v1/enterprise/overview', async (request) => {
  const session = getPublicSessionFromRequest(request);
  const context = await getEnterpriseContextForUser(session.userId);
  if (!context.company || !context.role) {
    return {
      available: false,
      role: null,
      company: null,
      members: [],
      courseAccess: []
    };
  }
  const companyId = String(context.company.id);
  if (context.role === 'representative') {
    const [members, courseAccess, stats, memberProgress] = await Promise.all([
      listCompanyMembers(companyId),
      listCompanyCourseAccess(companyId),
      getCompanyDashboardStats(companyId),
      getCompanyUserProgress(companyId)
    ]);
    return {
      available: true,
      role: context.role,
      company: context.company,
      members,
      courseAccess,
      stats,
      memberProgress
    };
  }
  const [allMembers, courseAccess] = await Promise.all([listCompanyMembers(companyId), listCompanyCourseAccess(companyId)]);
  const membership = allMembers.find((member) => String(member.user_id) === session.userId) ?? null;
  return {
    available: true,
    role: context.role,
    company: context.company,
    members: membership ? [membership] : [],
    courseAccess: courseAccess.filter((item) => item.is_active)
  };
});

app.post('/v1/enterprise/members', async (request, reply) => {
  const { company } = await ensureRepresentativeCompanyFromSession(request);
  const payload = createCompanyMemberSchema.parse(request.body);
  const companyId = String(String(company.id));
  const user = await resolveOrCreateCompanyUser({
    tenantId: String(company.tenant_id),
    userId: payload.userId,
    fullName: payload.fullName,
    email: payload.email,
    locale: payload.locale
  });
  const member = await upsertCompanyMember({
    companyId,
    userId: String(user.id),
    memberRole: 'collaborator',
    status: 'active'
  });
  if (user.moodle_user_id) {
    await updateMoodleUserStatus({
      userId: Number(user.moodle_user_id),
      suspended: false
    });
    await syncCompanyCoursesForMember({
      companyId,
      userId: String(user.id),
      moodleUserId: Number(user.moodle_user_id)
    });
  }
  const members = await listCompanyMembers(companyId);
  const hydrated = members.find((item) => String(item.user_id) === String(user.id));
  return reply.code(201).send({
    created: true,
    member: hydrated ?? member,
    user
  });
});

app.patch('/v1/enterprise/members/:userId/status', async (request, reply) => {
  const { session, company } = await ensureRepresentativeCompanyFromSession(request);
  const { userId } = request.params as { userId: string };
  const payload = updateCompanyMemberSchema.parse(request.body);
  const companyId = String(String(company.id));
  if (userId === session.userId) {
    return reply.badRequest('Representative cannot change own member status');
  }
  const membership = await getCompanyMembership({ companyId, userId });
  if (!membership) {
    return reply.notFound('Member not found in company');
  }
  const newStatus = payload.status ?? (membership.status as 'active' | 'inactive');
  const updated = await setCompanyMemberStatus({
    companyId,
    userId,
    status: newStatus
  });
  if (!updated) {
    return reply.notFound('Member not found in company');
  }
  const user = await getPlatformUserById(userId);
  if (user?.moodle_user_id) {
    const moodleUserId = Number(user.moodle_user_id);
    await updateMoodleUserStatus({
      userId: moodleUserId,
      suspended: newStatus === 'inactive'
    });
    if (payload.status === 'active') {
      await syncCompanyCoursesForMember({
        companyId,
        userId,
        moodleUserId
      });
    } else {
      const activeCourseIds = await listCompanyActiveCourseAccess(companyId);
      for (const courseId of activeCourseIds) {
        await unenrolMoodleUser({
          userId: moodleUserId,
          courseId
        });
      }
      await Promise.all(
        activeCourseIds.map((courseId) =>
          setUserCourseEnrollmentStatusForUsers({
            userIds: [userId],
            moodleCourseId: courseId,
            status: 'inactive'
          })
        )
      );
    }
  }
  const members = await listCompanyMembers(companyId);
  const hydrated = members.find((item) => String(item.user_id) === String(userId));
  return {
    updated: true,
    member: hydrated ?? updated
  };
});

app.put('/v1/enterprise/courses/:moodleCourseId', async (request, reply) => {
  const { session, company } = await ensureRepresentativeCompanyFromSession(request);
  const { moodleCourseId } = request.params as { moodleCourseId: string };
  const payload = upsertCompanyCourseSchema.parse({
    ...((request.body as Record<string, unknown>) ?? {}),
    moodleCourseId: Number(moodleCourseId)
  });
  const companyId = String(String(company.id));
  const access = await upsertCompanyCourseAccess({
    companyId,
    moodleCourseId: payload.moodleCourseId,
    isActive: payload.isActive ?? true,
    assignedByUserId: session.userId
  });
  await syncCompanyCourseToMembers({
    companyId,
    moodleCourseId: payload.moodleCourseId,
    isActive: payload.isActive ?? true
  });
  return {
    updated: true,
    access
  };
});

app.delete('/v1/enterprise/courses/:moodleCourseId', async (request, reply) => {
  const { company } = await ensureRepresentativeCompanyFromSession(request);
  const { moodleCourseId } = request.params as { moodleCourseId: string };
  const parsedCourseId = Number(moodleCourseId);
  if (!Number.isInteger(parsedCourseId) || parsedCourseId <= 0) {
    return reply.badRequest('Invalid moodleCourseId');
  }
  const companyId = String(String(company.id));
  await syncCompanyCourseToMembers({
    companyId,
    moodleCourseId: parsedCourseId,
    isActive: false
  });
  const deleted = await deleteCompanyCourseAccess({
    companyId,
    moodleCourseId: parsedCourseId
  });
  return { deleted };
});

app.post('/v1/enterprise/groups', async (request, reply) => {
  const { company } = await ensureRepresentativeCompanyFromSession(request);
  const { name, description } = request.body as { name: string; description?: string };
  if (!name || name.trim().length === 0) {
    return reply.badRequest('A name is required for the group');
  }
  const group = await createCompanyCourseGroup({
    id: randomUUID(),
    companyId: String(company.id),
    name: name.trim(),
    description: description?.trim() || ''
  });
  return group;
});

app.get('/v1/enterprise/groups', async (request) => {
  const { company } = await ensureRepresentativeCompanyFromSession(request);
  return listCompanyCourseGroups(String(company.id));
});

app.put('/v1/enterprise/groups/:groupId', async (request, reply) => {
  await ensureRepresentativeCompanyFromSession(request);
  const { groupId } = request.params as { groupId: string };
  const { name, description } = request.body as { name?: string; description?: string };
  const updated = await updateCompanyCourseGroup({
    id: groupId,
    name: name?.trim(),
    description: description?.trim()
  });
  if (!updated) return reply.notFound('Group not found');
  return { success: true };
});

app.delete('/v1/enterprise/groups/:groupId', async (request, reply) => {
  const { company } = await ensureRepresentativeCompanyFromSession(request);
  const { groupId } = request.params as { groupId: string };

  // Before deleting the group, get its members to sync later
  const groupMembers = await getGroupMembers(groupId);

  const deleted = await deleteCompanyCourseGroup(groupId);
  if (deleted) {
    // Sync each member who was part of this group
    for (const member of groupMembers) {
      if (member.company_id === String(company.id)) {
        const user = await getPlatformUserById(member.user_id);
        if (user && user.moodle_user_id) {
          await syncCompanyCoursesForMember({
            companyId: String(company.id),
            userId: member.user_id,
            moodleUserId: user.moodle_user_id
          });
        }
      }
    }
  }
  return { deleted };
});

app.post('/v1/enterprise/groups/:groupId/courses/:moodleCourseId', async (request, reply) => {
  const { company } = await ensureRepresentativeCompanyFromSession(request);
  const { groupId, moodleCourseId } = request.params as { groupId: string; moodleCourseId: string };
  const parsedCourseId = Number(moodleCourseId);
  if (!Number.isInteger(parsedCourseId)) return reply.badRequest('Invalid moodleCourseId');

  const assigned = await assignCourseToGroup({ groupId, moodleCourseId: parsedCourseId });
  if (assigned) {
    const groupMembers = await getGroupMembers(groupId);
    for (const member of groupMembers) {
      if (member.company_id === String(company.id)) {
        const user = await getPlatformUserById(member.user_id);
        if (user && user.moodle_user_id) {
          await syncCompanyCoursesForMember({
            companyId: String(company.id),
            userId: member.user_id,
            moodleUserId: user.moodle_user_id
          });
        }
      }
    }
  }
  return { success: true };
});

app.delete('/v1/enterprise/groups/:groupId/courses/:moodleCourseId', async (request, reply) => {
  const { company } = await ensureRepresentativeCompanyFromSession(request);
  const { groupId, moodleCourseId } = request.params as { groupId: string; moodleCourseId: string };
  const parsedCourseId = Number(moodleCourseId);
  const removed = await removeCourseFromGroup({ groupId, moodleCourseId: parsedCourseId });
  if (removed) {
    const groupMembers = await getGroupMembers(groupId);
    for (const member of groupMembers) {
      if (member.company_id === String(company.id)) {
        const user = await getPlatformUserById(member.user_id);
        if (user && user.moodle_user_id) {
          await syncCompanyCoursesForMember({
            companyId: String(company.id),
            userId: member.user_id,
            moodleUserId: user.moodle_user_id
          });
        }
      }
    }
  }
  return { removed };
});

app.get('/v1/enterprise/members/:userId/groups', async (request) => {
  const { company } = await ensureRepresentativeCompanyFromSession(request);
  const { userId } = request.params as { userId: string };
  return listCompanyMemberGroups(String(company.id), userId);
});

app.post('/v1/enterprise/members/:userId/groups/:groupId', async (request, reply) => {
  const { company } = await ensureRepresentativeCompanyFromSession(request);
  const { userId, groupId } = request.params as { userId: string; groupId: string };
  const assigned = await assignGroupToMember({ companyId: String(company.id), userId, groupId });
  if (assigned) {
    const user = await getPlatformUserById(userId);
    if (user && user.moodle_user_id) {
      await syncCompanyCoursesForMember({
        companyId: String(company.id),
        userId: userId,
        moodleUserId: user.moodle_user_id
      });
    }
  }
  return { success: !!assigned };
});

app.delete('/v1/enterprise/members/:userId/groups/:groupId', async (request, reply) => {
  const { company } = await ensureRepresentativeCompanyFromSession(request);
  const { userId, groupId } = request.params as { userId: string; groupId: string };
  const removed = await removeGroupFromMember({ companyId: String(company.id), userId, groupId });
  if (removed) {
    const user = await getPlatformUserById(userId);
    if (user && user.moodle_user_id) {
      await syncCompanyCoursesForMember({
        companyId: String(company.id),
        userId: userId,
        moodleUserId: user.moodle_user_id
      });
    }
  }
  return { removed };
});

app.get('/v1/enterprise/members/:userId/courses', async (request) => {
  const { company } = await ensureRepresentativeCompanyFromSession(request);
  const { userId } = request.params as { userId: string };
  return listCompanyMemberCourses(String(company.id), userId);
});

app.post('/v1/enterprise/members/:userId/courses/:moodleCourseId', async (request, reply) => {
  const { company } = await ensureRepresentativeCompanyFromSession(request);
  const { userId, moodleCourseId } = request.params as { userId: string; moodleCourseId: string };
  const parsedCourseId = Number(moodleCourseId);
  if (!Number.isInteger(parsedCourseId)) return reply.badRequest('Invalid Moodle course');

  const assigned = await assignCourseToMember({ companyId: String(company.id), userId, moodleCourseId: parsedCourseId });
  if (assigned) {
    const user = await getPlatformUserById(userId);
    if (user && user.moodle_user_id) {
      await syncCompanyCoursesForMember({
        companyId: String(company.id),
        userId: userId,
        moodleUserId: user.moodle_user_id
      });
    }
  }
  return { success: !!assigned };
});

app.delete('/v1/enterprise/members/:userId/courses/:moodleCourseId', async (request, reply) => {
  const { company } = await ensureRepresentativeCompanyFromSession(request);
  const { userId, moodleCourseId } = request.params as { userId: string; moodleCourseId: string };
  const parsedCourseId = Number(moodleCourseId);
  const removed = await removeCourseFromMember({ companyId: String(company.id), userId, moodleCourseId: parsedCourseId });
  if (removed) {
    const user = await getPlatformUserById(userId);
    if (user && user.moodle_user_id) {
      await syncCompanyCoursesForMember({
        companyId: String(company.id),
        userId: userId,
        moodleUserId: user.moodle_user_id
      });
    }
  }
  return { removed };
});

app.get('/v1/catalog/:slug', async (request, reply) => {
  await ensureFreshPublicData();
  const { slug } = request.params as { slug: string };
  const [content, entitlements] = await Promise.all([getContentBySlug(slug), getEntitlements()]);

  if (!content) {
    return reply.notFound(`Content with slug ${slug} was not found`);
  }

  return {
    content,
    entitlement: entitlements.find((item) => item.contentId === content.id) ?? null
  };
});

app.get('/v1/courses/:moodleCourseId/content', async (request, reply) => {
  // Antes esta ruta llamaba a getPublicSessionFromRequest() y DESCARTABA el
  // resultado: bastaba con estar registrado para leer el contenido íntegro de
  // cualquier curso recorriendo el id. Eso es acceso a material de aula ajeno,
  // y con FERPA de por medio no es un detalle.
  const session = getPublicSessionFromRequest(request);
  const { moodleCourseId } = request.params as { moodleCourseId: string };
  const courseId = Number(moodleCourseId);
  if (!Number.isInteger(courseId) || courseId <= 0) {
    return reply.badRequest('Invalid moodleCourseId');
  }

  const enrolled = await getActiveEnrolledCourseIds(session.userId);
  if (!enrolled.has(courseId)) {
    // 403 y no 404: el curso existe y su ficha es pública; lo que falta es la
    // matrícula. Decirlo con claridad evita que el front lo trate como un
    // curso inexistente y lo saque del catálogo.
    return reply.forbidden('No active enrollment for this course');
  }

  const result = await getMoodleCourseContents(courseId);
  if (!result.ok) {
    return {
      moodleCourseId: courseId,
      available: false,
      error: result.error ?? 'Moodle content fetch failed',
      sections: []
    };
  }

  // El usuario tiene matrícula activa, así que los ficheros de este contenido
  // quedan habilitados para su sesión y el proxy podrá servirlos.
  rememberCourseFiles(session, result.data ?? []);

  return {
    moodleCourseId: courseId,
    available: true,
    sections: result.data ?? []
  };
});

app.get('/v1/moodle/file', async (request, reply) => {
  const query = request.query as { url?: string; authToken?: string };
  const bearerToken = getBearerToken(request.headers);
  const session = getPublicSessionByToken(query.authToken ?? bearerToken);
  if (!query.url) {
    return reply.badRequest('Missing url query param');
  }
  if (!hasMoodleConfig()) {
    return reply.serviceUnavailable('Moodle is not configured');
  }
  const moodle = getMoodleConfig();

  const moodleBase = new URL(moodle.baseUrl);
  let targetUrl: URL;
  try {
    targetUrl = new URL(query.url);
  } catch {
    if (!query.url.startsWith('/')) {
      return reply.badRequest('Invalid file url');
    }
    targetUrl = new URL(query.url, moodleBase);
  }
  if (targetUrl.host !== moodleBase.host) {
    return reply.badRequest('Invalid file host');
  }

  const validMoodleFilePath =
    targetUrl.pathname.includes('/pluginfile.php') ||
    targetUrl.pathname.includes('/webservice/pluginfile.php') ||
    targetUrl.pathname.includes('/draftfile.php');

  if (!validMoodleFilePath) {
    return reply.badRequest('Invalid Moodle file path');
  }

  // Validar host y ruta no basta: con eso, cualquier sesión podía pedir
  // cualquier fichero del almacén de Moodle —entregas de otros alumnos
  // incluidas— porque a continuación se le añade el token de servicio, que es
  // de administrador. El fichero tiene que venir del contenido de un curso que
  // esta misma sesión haya cargado con matrícula activa.
  if (!session.allowedFileUrls.has(fileAccessKey(targetUrl))) {
    return reply.forbidden('File is not part of a course this session can access');
  }

  targetUrl.searchParams.set('token', moodle.token);
  const incomingRange = request.headers.range;
  const fileResponse = await fetch(targetUrl.toString(), {
    headers: incomingRange ? { Range: incomingRange } : undefined
  });
  if (!fileResponse.ok) {
    return reply.status(fileResponse.status).send({
      ok: false,
      error: `Unable to fetch Moodle file (${fileResponse.status})`
    });
  }

  const contentType = fileResponse.headers.get('content-type');
  const contentDisposition = fileResponse.headers.get('content-disposition');
  const contentRange = fileResponse.headers.get('content-range');
  const contentLength = fileResponse.headers.get('content-length');
  const acceptRanges = fileResponse.headers.get('accept-ranges');
  if (contentType) {
    reply.header('Content-Type', contentType);
  }
  if (contentDisposition) {
    reply.header('Content-Disposition', contentDisposition);
  }
  if (contentRange) {
    reply.header('Content-Range', contentRange);
  }
  if (contentLength) {
    reply.header('Content-Length', contentLength);
  }
  if (acceptRanges) {
    reply.header('Accept-Ranges', acceptRanges);
  }
  if (fileResponse.status === 206) {
    reply.code(206);
  }
  const buffer = Buffer.from(await fileResponse.arrayBuffer());
  return reply.send(buffer);
});

const publicInteractionSchema = z.object({
  moduleName: z.string().min(1),
  moduleType: z.string().min(1),
  response: z.record(z.unknown()),
  progress: z
    .object({
      completedModuleIds: z.array(z.number().int().positive()),
      interactionsCount: z.number().int().min(0),
      xp: z.number().int().min(0),
      totalModules: z.number().int().min(0),
      progressPercent: z.number().int().min(0).max(100),
      lastActivityAt: z.string().optional()
    })
    .optional()
});

const publicProgressSchema = z.object({
  completedModuleIds: z.array(z.number().int().positive()),
  interactionsCount: z.number().int().min(0),
  xp: z.number().int().min(0),
  totalModules: z.number().int().min(0),
  progressPercent: z.number().int().min(0).max(100),
  lastActivityAt: z.string().optional()
});

app.post('/v1/courses/:moodleCourseId/modules/:moduleId/respond', async (request, reply) => {
  const session = getPublicSessionFromRequest(request);
  const { moodleCourseId, moduleId } = request.params as { moodleCourseId: string; moduleId: string };
  const payload = publicInteractionSchema.parse(request.body);
  const user = await getPlatformUserById(session.userId);
  if (!user) {
    return reply.notFound('User not found');
  }
  const parsedCourseId = Number(moodleCourseId);
  const parsedModuleId = Number(moduleId);
  if (!Number.isInteger(parsedCourseId) || parsedCourseId <= 0) {
    return reply.badRequest('Invalid moodleCourseId');
  }
  if (!Number.isInteger(parsedModuleId) || parsedModuleId <= 0) {
    return reply.badRequest('Invalid moduleId');
  }

  const moodleInteractionPayload = {
    id: randomUUID(),
    moodleCourseId: parsedCourseId,
    moduleId: parsedModuleId,
    moduleName: payload.moduleName,
    moduleType: payload.moduleType,
    response: payload.response,
    createdAt: new Date().toISOString()
  };
  let moodleNoteId: number | null = null;
  if (user.moodle_user_id) {
    const noteResult = await createMoodleNote({
      userId: Number(user.moodle_user_id),
      courseId: parsedCourseId,
      text: `${moodleInteractionPrefix}${JSON.stringify(moodleInteractionPayload)}`
    });
    if (noteResult.ok) {
      const createdNote = Array.isArray(noteResult.data) ? noteResult.data[0] : null;
      moodleNoteId = Number(createdNote?.noteid ?? createdNote?.id ?? 0) || null;
    }
  }

  const saved = await savePublicCourseInteraction({
    userId: session.userId,
    moodleCourseId: parsedCourseId,
    moduleId: parsedModuleId,
    moduleName: payload.moduleName,
    moduleType: payload.moduleType,
    response: {
      ...payload.response,
      moodleNoteId
    }
  });

  let savedProgress: unknown = null;
  if (user.moodle_user_id) {
    const moodleState = await buildMoodleCourseProgress({
      localUserId: session.userId,
      moodleUserId: Number(user.moodle_user_id),
      moodleCourseId: parsedCourseId
    });
    savedProgress = moodleState.progress;
  } else if (payload.progress) {
    savedProgress = await upsertPublicCourseProgress({
      userId: session.userId,
      moodleCourseId: parsedCourseId,
      completedModuleIds: payload.progress.completedModuleIds,
      interactionsCount: payload.progress.interactionsCount,
      xp: payload.progress.xp,
      totalModules: payload.progress.totalModules,
      progressPercent: payload.progress.progressPercent,
      lastActivityAt: payload.progress.lastActivityAt ?? new Date().toISOString()
    });
  }

  return {
    saved: true,
    interaction: saved,
    progress: savedProgress,
    moodleSynced: Boolean(moodleNoteId)
  };
});

app.get('/v1/courses/:moodleCourseId/progress', async (request, reply) => {
  const session = getPublicSessionFromRequest(request);
  const { moodleCourseId } = request.params as { moodleCourseId: string };
  const parsedCourseId = Number(moodleCourseId);
  if (!Number.isInteger(parsedCourseId) || parsedCourseId <= 0) {
    return reply.badRequest('Invalid moodleCourseId');
  }

  const user = await getPlatformUserById(session.userId);
  let progress = null;
  if (user?.moodle_user_id) {
    const moodleState = await buildMoodleCourseProgress({
      localUserId: session.userId,
      moodleUserId: Number(user.moodle_user_id),
      moodleCourseId: parsedCourseId
    });
    progress = moodleState.progress;
  } else {
    progress = await getPublicCourseProgress({
      userId: session.userId,
      moodleCourseId: parsedCourseId
    });
  }

  return {
    found: Boolean(progress),
    progress
  };
});

app.get('/v1/courses/:moodleCourseId/interactions', async (request, reply) => {
  const session = getPublicSessionFromRequest(request);
  const { moodleCourseId } = request.params as { moodleCourseId: string };
  const parsedCourseId = Number(moodleCourseId);
  if (!Number.isInteger(parsedCourseId) || parsedCourseId <= 0) {
    return reply.badRequest('Invalid moodleCourseId');
  }

  const user = await getPlatformUserById(session.userId);
  let interactions = await listPublicCourseInteractions({
    userId: session.userId,
    moodleCourseId: parsedCourseId,
    limit: 100
  });
  if (user?.moodle_user_id) {
    const moodleState = await buildMoodleCourseProgress({
      localUserId: session.userId,
      moodleUserId: Number(user.moodle_user_id),
      moodleCourseId: parsedCourseId
    });
    interactions = moodleState.interactions.map((item) => ({
      ...item,
      user_id: session.userId
    }));
  }

  return {
    moodleCourseId: parsedCourseId,
    interactions
  };
});

app.put('/v1/courses/:moodleCourseId/progress', async (request, reply) => {
  const session = getPublicSessionFromRequest(request);
  const { moodleCourseId } = request.params as { moodleCourseId: string };
  const parsedCourseId = Number(moodleCourseId);
  if (!Number.isInteger(parsedCourseId) || parsedCourseId <= 0) {
    return reply.badRequest('Invalid moodleCourseId');
  }
  const payload = publicProgressSchema.parse(request.body);

  const saved = await upsertPublicCourseProgress({
    userId: session.userId,
    moodleCourseId: parsedCourseId,
    completedModuleIds: payload.completedModuleIds,
    interactionsCount: payload.interactionsCount,
    xp: payload.xp,
    totalModules: payload.totalModules,
    progressPercent: payload.progressPercent,
    lastActivityAt: payload.lastActivityAt ?? new Date().toISOString()
  });

  return {
    saved: true,
    progress: saved
  };
});

app.post('/v1/courses/:moodleCourseId/modules/:moduleId/complete', async (request, reply) => {
  const session = getPublicSessionFromRequest(request);
  const { moodleCourseId, moduleId } = request.params as { moodleCourseId: string; moduleId: string };
  const parsedCourseId = Number(moodleCourseId);
  const parsedModuleId = Number(moduleId);
  if (!Number.isInteger(parsedCourseId) || parsedCourseId <= 0) {
    return reply.badRequest('Invalid moodleCourseId');
  }
  if (!Number.isInteger(parsedModuleId) || parsedModuleId <= 0) {
    return reply.badRequest('Invalid moduleId');
  }

  const payload = publicProgressSchema.parse(request.body);
  const user = await getPlatformUserById(session.userId);
  if (!user) {
    return reply.notFound('User not found');
  }

  let moodleCompletionSynced = false;
  if (user.moodle_user_id) {
    // Persist client-side state first so Moodle reads cannot regress progress on transient failures.
    await upsertPublicCourseProgress({
      userId: session.userId,
      moodleCourseId: parsedCourseId,
      completedModuleIds: payload.completedModuleIds,
      interactionsCount: payload.interactionsCount,
      xp: payload.xp,
      totalModules: payload.totalModules,
      progressPercent: payload.progressPercent,
      lastActivityAt: payload.lastActivityAt ?? new Date().toISOString()
    });

    const completionResult = await updateMoodleActivityCompletion({
      cmid: parsedModuleId,
      completed: true
    });
    moodleCompletionSynced = completionResult.ok;
  }

  let saved;
  if (user.moodle_user_id) {
    const moodleState = await buildMoodleCourseProgress({
      localUserId: session.userId,
      moodleUserId: Number(user.moodle_user_id),
      moodleCourseId: parsedCourseId
    });
    saved = moodleState.progress;
  } else {
    saved = await upsertPublicCourseProgress({
      userId: session.userId,
      moodleCourseId: parsedCourseId,
      completedModuleIds: payload.completedModuleIds,
      interactionsCount: payload.interactionsCount,
      xp: payload.xp,
      totalModules: payload.totalModules,
      progressPercent: payload.progressPercent,
      lastActivityAt: payload.lastActivityAt ?? new Date().toISOString()
    });
  }
  if (!saved) {
    saved = await upsertPublicCourseProgress({
      userId: session.userId,
      moodleCourseId: parsedCourseId,
      completedModuleIds: payload.completedModuleIds,
      interactionsCount: payload.interactionsCount,
      xp: payload.xp,
      totalModules: payload.totalModules,
      progressPercent: payload.progressPercent,
      lastActivityAt: payload.lastActivityAt ?? new Date().toISOString()
    });
  }

  return {
    saved: true,
    progress: saved,
    moodleCompletionSynced
  };
});

app.get('/admin', async (request, reply) => {
  ensureAdmin(request);

  const routeRows = routeRegistry
    .map((entry) => `<tr><td>${entry.method}</td><td>${entry.url}</td></tr>`)
    .join('');

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>University Admin</title>
    <style>
      body { font-family: Arial, sans-serif; background: #0b1220; color: #e2e8f0; margin: 0; padding: 24px; }
      .card { background: #111827; border: 1px solid #334155; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; border-bottom: 1px solid #334155; padding: 8px; font-size: 14px; }
      h1, h2 { margin-top: 0; }
      code { color: #fcd34d; }
    </style>
  </head>
  <body>
    <h1>University Admin Gateway</h1>
    <div class="card">
      <h2>Status</h2>
      <p>Admin API key is required in header <code>x-admin-key</code>.</p>
      <p>Moodle configured: <strong>${hasMoodleConfig() ? 'yes' : 'no'}</strong></p>
    </div>
    <div class="card">
      <h2>Routes</h2>
      <table>
        <thead><tr><th>Method</th><th>URL</th></tr></thead>
        <tbody>${routeRows}</tbody>
      </table>
    </div>
  </body>
</html>`;

  reply.type('text/html').send(html);
});

app.get('/admin/routes', async (request) => {
  ensureAdmin(request);
  return {
    count: routeRegistry.length,
    routes: routeRegistry
  };
});

const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

app.post('/admin/auth/login', async (request, reply) => {
  const payload = adminLoginSchema.parse(request.body);
  if (payload.email !== config.admin.email || payload.password !== config.admin.password) {
    return reply.unauthorized('Invalid credentials');
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.admin.sessionTtlMinutes * 60000);
  const token = randomBytes(32).toString('hex');
  const session: AdminAuthSession = {
    token,
    email: config.admin.email,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString()
  };
  adminSessions.set(token, session);

  return {
    authenticated: true,
    token: session.token,
    admin: {
      email: session.email
    },
    createdAt: session.createdAt,
    expiresAt: session.expiresAt
  };
});

app.get('/admin/auth/me', async (request) => {
  const session = ensureAdmin(request);
  return {
    authenticated: true,
    admin: {
      email: session.email
    },
    createdAt: session.createdAt,
    expiresAt: session.expiresAt
  };
});

app.post('/admin/auth/logout', async (request) => {
  const token = getBearerToken(request.headers);
  if (token) {
    adminSessions.delete(token);
  }
  return { loggedOut: true };
});

app.get('/admin/config', async (request) => {
  ensureAdmin(request);
  const moodle = getMoodleConfig();
  return {
    server: config.server,
    db: { urlSet: Boolean(config.db.url) },
    moodle: {
      configured: hasMoodleConfig(),
      baseUrl: moodle.baseUrl || null,
      tokenSet: Boolean(moodle.token)
    }
  };
});

app.get('/admin/status', async (request) => {
  ensureAdmin(request);
  const moodle = getMoodleConfig();

  const [snapshot, moodleSiteInfo, lastCoursesSync, lastUsersSync, lastCategoriesSync] = await Promise.all([
    getAdminSnapshot(),
    getMoodleSiteInfo(),
    getIntegrationSetting<{ syncedAt: string; total: number; upsertedCatalogAssets?: number }>(
      'moodle.last_courses_sync'
    ),
    getIntegrationSetting<{
      syncedAt: string;
      totalUsers: number;
      upsertedUsers: number;
      enrollmentLinks: number;
      warningsCount: number;
    }>('moodle.last_users_sync'),
    getIntegrationSetting<{ syncedAt: string; total: number; source?: string }>('moodle.last_categories_sync')
  ]);

  const publicRoutes = routeRegistry.filter((route) => route.url.startsWith('/v1/')).length;
  const adminRoutes = routeRegistry.filter((route) => route.url.startsWith('/admin')).length;

  return {
    platform: 'University',
    timestamp: new Date().toISOString(),
    uptimeSec: process.uptime(),
    routes: {
      total: routeRegistry.length,
      public: publicRoutes,
      admin: adminRoutes
    },
    db: {
      connected: true,
      database: snapshot.database,
      activeSessions: snapshot.activeDbSessions,
      pool: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount
      },
      entities: {
        tenants: snapshot.tenants,
        users: snapshot.users,
        offers: snapshot.offers,
        entitlements: snapshot.entitlements,
        catalogByKind: snapshot.catalogByKind,
        moodleCourses: snapshot.moodleCourses,
        moodleCategories: snapshot.moodleCategories,
        userEnrollments: snapshot.userEnrollments,
        companies: snapshot.companies,
        companyMembers: snapshot.companyMembers,
        webinars: snapshot.webinars,
        podcasts: snapshot.podcasts,
      }
    },
    moodle: {
      configured: hasMoodleConfig(),
      connected: moodleSiteInfo.ok,
      error: moodleSiteInfo.ok ? null : moodleSiteInfo.error ?? null,
      siteInfo: moodleSiteInfo.ok ? moodleSiteInfo.data : null,
      baseUrl: moodle.baseUrl || null,
      tokenSet: Boolean(moodle.token),
      lastCoursesSync,
      lastUsersSync,
      lastCategoriesSync
    }
  };
});

app.get('/admin/tenants', async (request) => {
  ensureAdmin(request);
  return listTenants();
});

app.get('/admin/webinars', async (request) => {
  ensureAdmin(request);
  return listWebinars();
});

app.get('/admin/podcasts', async (request) => {
  ensureAdmin(request);
  return listPodcasts();
});

app.post('/admin/webinars', async (request, reply) => {
  ensureAdmin(request);
  const payload = createWebinarSchema.parse(request.body);
  const created = await createWebinar({
    slug: payload.slug,
    title: payload.title,
    subtitle: payload.subtitle ?? null,
    description: payload.description ?? null,
    heroImage: payload.heroImage,
    sourceType: payload.sourceType,
    sourceUrl: payload.sourceUrl,
    replayUrl: payload.replayUrl && payload.replayUrl.trim() ? payload.replayUrl.trim() : null,
    startsAt: payload.startsAt,
    endsAt: payload.endsAt?.trim() ? payload.endsAt.trim() : null,
    timezone: payload.timezone ?? 'America/Bogota',
    ctaLabel: payload.ctaLabel ?? 'Reservar cupo',
    isActive: payload.isActive ?? true,
    showOnLanding: payload.showOnLanding ?? true,
    webinarLinks: payload.webinarLinks ?? [],
    freeReservationUrl:
      payload.freeReservationUrl && payload.freeReservationUrl.trim() ? payload.freeReservationUrl.trim() : null,
    vipReservationUrl:
      payload.vipReservationUrl && payload.vipReservationUrl.trim() ? payload.vipReservationUrl.trim() : null
  });
  return reply.code(201).send({ created: true, webinar: created });
});

app.patch('/admin/webinars/:webinarId', async (request, reply) => {
  ensureAdmin(request);
  const { webinarId } = request.params as { webinarId: string };
  const payload = updateWebinarSchema.parse(request.body);
  const updated = await updateWebinar(webinarId, {
    slug: payload.slug,
    title: payload.title,
    subtitle: payload.subtitle,
    description: payload.description,
    heroImage: payload.heroImage,
    sourceType: payload.sourceType,
    sourceUrl: payload.sourceUrl,
    replayUrl: payload.replayUrl,
    startsAt: payload.startsAt,
    endsAt: payload.endsAt,
    timezone: payload.timezone,
    ctaLabel: payload.ctaLabel,
    isActive: payload.isActive,
    showOnLanding: payload.showOnLanding,
    webinarLinks: payload.webinarLinks,
    freeReservationUrl: payload.freeReservationUrl,
    vipReservationUrl: payload.vipReservationUrl
  });
  if (!updated) {
    return reply.notFound('Webinar not found');
  }
  return { updated: true, webinar: updated };
});

app.delete('/admin/webinars/:webinarId', async (request, reply) => {
  ensureAdmin(request);
  const { webinarId } = request.params as { webinarId: string };
  const deleted = await deleteWebinar(webinarId);
  if (!deleted) {
    return reply.notFound('Webinar not found');
  }
  return { deleted: true };
});

app.post('/admin/podcasts', async (request, reply) => {
  ensureAdmin(request);
  const payload = createPodcastSchema.parse(request.body);
  const normalizedVideo = normalizeYouTubeInput(payload.video);
  if (!normalizedVideo) {
    return reply.badRequest('Invalid YouTube URL/code');
  }
  const created = await createPodcast({
    title: payload.title.trim(),
    videoCode: normalizedVideo.code,
    videoUrl: normalizedVideo.url,
    publishedAt: payload.publishedAt,
    isActive: payload.isActive ?? true,
    showOnLanding: payload.showOnLanding ?? true,
    displayOrder: payload.displayOrder ?? 0
  });
  return reply.code(201).send({ created: true, podcast: created });
});

app.patch('/admin/podcasts/:podcastId', async (request, reply) => {
  ensureAdmin(request);
  const { podcastId } = request.params as { podcastId: string };
  const payload = updatePodcastSchema.parse(request.body);
  const normalizedVideo = payload.video ? normalizeYouTubeInput(payload.video) : null;
  if (payload.video && !normalizedVideo) {
    return reply.badRequest('Invalid YouTube URL/code');
  }
  const updated = await updatePodcast(podcastId, {
    title: payload.title?.trim(),
    videoCode: normalizedVideo?.code,
    videoUrl: normalizedVideo?.url,
    publishedAt: payload.publishedAt,
    isActive: payload.isActive,
    showOnLanding: payload.showOnLanding,
    displayOrder: payload.displayOrder
  });
  if (!updated) {
    return reply.notFound('Podcast not found');
  }
  return { updated: true, podcast: updated };
});

app.delete('/admin/podcasts/:podcastId', async (request, reply) => {
  ensureAdmin(request);
  const { podcastId } = request.params as { podcastId: string };
  const deleted = await deletePodcast(podcastId);
  if (!deleted) {
    return reply.notFound('Podcast not found');
  }
  return { deleted: true };
});

const updateMoodleConnectionSchema = z.object({
  baseUrl: z.string().url(),
  token: z.string().min(8).optional()
});

const createTenantSchema = z.object({
  id: z.string().min(2),
  slug: z.string().min(2),
  name: z.string().min(2),
  locales: z.array(z.string()).min(1),
  currency: z.string().min(3),
  branding: z.object({
    logoUrl: z.string().url(),
    primaryColor: z.string(),
    accentColor: z.string(),
    heroGradient: z.string()
  })
});

app.post('/admin/tenants', async (request) => {
  ensureAdmin(request);
  const payload = createTenantSchema.parse(request.body);
  const tenant = await createTenant(payload);
  return { created: true, tenant };
});

const createUserSchema = z.object({
  fullName: z.string().min(3),
  email: z.string().email(),
  locale: z.string().default('en'),
  roles: z.array(z.string()).default(['learner']),
  tenantId: z.string().optional()
});

const enrolUserSchema = z.object({
  moodleCourseId: z.number().int().positive(),
  roleId: z.number().int().positive().optional()
});

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(10000).default(20),
  q: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  visible: z.enum(['true', 'false']).optional()
});

const setUserStatusSchema = z.object({
  status: z.enum(['active', 'inactive']),
  syncMoodle: z.boolean().optional().default(true)
});

const setBulkUsersStatusSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1),
  status: z.enum(['active', 'inactive']),
  syncMoodle: z.boolean().optional().default(true)
});

const webinarSourceTypeSchema = z.enum(['youtube', 'external', 'hls', 'vimeo', 'zoom']);
const webinarLinkSchema = z.object({
  platform: z.string().min(2),
  url: z.string().url()
});

const createWebinarSchema = z.object({
  slug: z
    .string()
    .min(3)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Invalid slug format'),
  title: z.string().min(5),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  heroImage: z.string().url(),
  sourceType: webinarSourceTypeSchema,
  sourceUrl: z.string().url(),
  replayUrl: z.string().url().optional().or(z.literal('')),
  startsAt: z.string(),
  endsAt: z.string().optional(),
  timezone: z.string().optional(),
  ctaLabel: z.string().optional(),
  isActive: z.boolean().optional(),
  showOnLanding: z.boolean().optional(),
  webinarLinks: z.array(webinarLinkSchema).optional(),
  freeReservationUrl: z.string().url().optional().or(z.literal('')),
  vipReservationUrl: z.string().url().optional().or(z.literal(''))
});

const updateWebinarSchema = createWebinarSchema.partial();

const createPodcastSchema = z.object({
  title: z.string().min(5),
  video: z.string().min(6),
  publishedAt: z.string(),
  isActive: z.boolean().optional(),
  showOnLanding: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(999).optional()
});

const updatePodcastSchema = createPodcastSchema.partial();

const enterpriseMemberRoleSchema = z.enum(['representative', 'collaborator']);

const createCompanySchema = z.object({
  slug: z.string().min(3).optional(),
  name: z.string().min(3),
  description: z.string().optional(),
  contactEmail: z.string().email().optional(),
  representativeUserId: z.string().uuid(),
  tenantId: z.string().optional(),
  isActive: z.boolean().optional()
});

const updateCompanySchema = z
  .object({
    slug: z.string().min(3).optional(),
    name: z.string().min(3).optional(),
    description: z.string().optional(),
    contactEmail: z.string().email().optional().nullable(),
    representativeUserId: z.string().uuid().optional().nullable(),
    isActive: z.boolean().optional()
  })
  .partial();

const createCompanyMemberSchema = z.object({
  userId: z.string().uuid().optional(),
  fullName: z.string().min(3).optional(),
  email: z.string().email().optional(),
  locale: z.string().default('es'),
  role: enterpriseMemberRoleSchema.default('collaborator')
});

const updateCompanyMemberSchema = z.object({
  status: z.enum(['active', 'inactive']).optional(),
  fullName: z.string().min(3).optional(),
  email: z.string().email().optional(),
  role: enterpriseMemberRoleSchema.optional()
});

const upsertCompanyCourseSchema = z.object({
  moodleCourseId: z.number().int().positive(),
  isActive: z.boolean().optional().default(true)
});

function normalizeYouTubeInput(input: string): { code: string; url: string } | null {
  const raw = input.trim();
  if (!raw) {
    return null;
  }

  const isCode = /^[A-Za-z0-9_-]{11}$/.test(raw);
  if (isCode) {
    return {
      code: raw,
      url: `https://www.youtube.com/watch?v=${raw}`
    };
  }

  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    let code = '';
    if (host.includes('youtu.be')) {
      code = url.pathname.replace(/\//g, '');
    } else if (host.includes('youtube.com')) {
      code = url.searchParams.get('v') ?? '';
      if (!code && url.pathname.startsWith('/shorts/')) {
        code = url.pathname.split('/')[2] ?? '';
      }
      if (!code && url.pathname.startsWith('/embed/')) {
        code = url.pathname.split('/')[2] ?? '';
      }
    }
    if (!/^[A-Za-z0-9_-]{11}$/.test(code)) {
      return null;
    }
    return {
      code,
      url: `https://www.youtube.com/watch?v=${code}`
    };
  } catch {
    return null;
  }
}

function normalizeUsername(email: string): string {
  const candidate = email.split('@')[0]?.toLowerCase().replace(/[^a-z0-9_.-]/g, '') ?? 'user';
  return candidate.slice(0, 40) || 'user';
}

function splitName(fullName: string): { firstname: string; lastname: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) {
    return { firstname: parts[0], lastname: 'User' };
  }
  return {
    firstname: parts[0],
    lastname: parts.slice(1).join(' ')
  };
}

function generateTemporaryPassword(): string {
  return `Atlas!${Math.random().toString(36).slice(2, 7)}${Date.now().toString().slice(-4)}`;
}

function normalizeCompanySlug(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function syncCompanyCourseToMembers(input: {
  companyId: string;
  moodleCourseId: number;
  isActive: boolean;
}) {
  const members = await listCompanyActiveMembersWithMoodle(input.companyId);
  for (const member of members) {
    const moodleUserId = Number(member.moodle_user_id);
    const localUserId = String(member.user_id);
    if (!Number.isInteger(moodleUserId) || moodleUserId <= 0) {
      continue;
    }
    if (input.isActive) {
      // Do not auto-enroll everyone when a course is added to the company.
      // Representatives manage access via groups and individual assignments.
    } else {
      await unenrolMoodleUser({
        userId: moodleUserId,
        courseId: input.moodleCourseId,
        roleId: 5
      });
      await setUserCourseEnrollmentStatusForUsers({
        userIds: [localUserId],
        moodleCourseId: input.moodleCourseId,
        status: 'inactive'
      });
    }
  }
}

export async function syncCompanyCoursesForMember(input: {
  companyId: string;
  userId: string;
  moodleUserId: number;
}) {
  const allCompanyCourseIds = await listCompanyActiveCourseAccess(input.companyId);
  const memberActiveCourseIds = await getMemberActiveMoodleCourseIds(input.companyId, input.userId);

  for (const moodleCourseId of allCompanyCourseIds) {
    if (memberActiveCourseIds.includes(moodleCourseId)) {
      const enrolResult = await enrolMoodleUser({
        userId: input.moodleUserId,
        courseId: moodleCourseId,
        roleId: 5
      });
      if (enrolResult.ok) {
        await upsertUserCourseEnrollment({
          userId: input.userId,
          moodleCourseId,
          status: 'active'
        });
      }
    } else {
      await unenrolMoodleUser({
        userId: input.moodleUserId,
        courseId: moodleCourseId,
        roleId: 5
      });
      await setUserCourseEnrollmentStatusForUsers({
        userIds: [input.userId],
        moodleCourseId,
        status: 'inactive'
      });
    }
  }
}

async function resolveOrCreateCompanyUser(input: {
  tenantId: string;
  userId?: string;
  fullName?: string;
  email?: string;
  locale?: string;
}) {
  if (input.userId) {
    const existingById = await getPlatformUserById(input.userId);
    if (!existingById) {
      throw app.httpErrors.notFound('User not found');
    }
    return existingById;
  }

  const email = String(input.email ?? '').trim().toLowerCase();
  const fullName = String(input.fullName ?? '').trim();
  const locale = String(input.locale ?? 'es').trim().toLowerCase() || 'es';
  if (!email || !fullName) {
    throw app.httpErrors.badRequest('fullName and email are required when userId is not provided');
  }

  const existingByEmail = await getPlatformUserByEmail(email);
  if (existingByEmail) {
    return existingByEmail;
  }

  const moodleByEmail = await getMoodleUsersByEmail(email);
  if (moodleByEmail.ok && (moodleByEmail.data?.length ?? 0) > 0) {
    const moodleUser = moodleByEmail.data?.[0];
    if (moodleUser) {
      const upserted = await upsertPlatformUserFromMoodle({
        moodleUser,
        tenantId: input.tenantId
      });
      if (upserted?.id) {
        const local = await getPlatformUserById(String(upserted.id));
        if (local) {
          return local;
        }
      }
    }
  }

  const { firstname, lastname } = splitName(fullName);
  const username = normalizeUsername(email);
  const tempPassword = generateTemporaryPassword();
  const createResult = await createMoodleUser({
    username,
    firstname,
    lastname,
    email,
    password: tempPassword
  });
  if (!createResult.ok || !createResult.data?.[0]?.id) {
    throw app.httpErrors.badRequest(`Moodle user creation failed: ${createResult.error ?? 'unknown error'}`);
  }

  const user = await createPlatformUser({
    id: randomUUID(),
    fullName,
    email,
    locale,
    roles: ['learner'],
    tenantId: input.tenantId,
    moodleUserId: Number(createResult.data[0].id)
  });
  return user;
}

async function getEnterpriseContextForUser(userId: string): Promise<{
  company: Record<string, unknown> | null;
  role: 'representative' | 'collaborator' | null;
}> {
  const asRepresentative = await getCompanyByRepresentativeUserId(userId);
  if (asRepresentative) {
    return {
      company: asRepresentative as Record<string, unknown>,
      role: 'representative'
    };
  }
  const asMember = await getCompanyByMemberUserId(userId);
  if (asMember && String(asMember.membership_status ?? 'active') === 'active' && asMember.is_active !== false) {
    return {
      company: asMember as Record<string, unknown>,
      role: String(asMember.member_role) === 'representative' ? 'representative' : 'collaborator'
    };
  }
  return {
    company: null,
    role: null
  };
}

async function ensureRepresentativeCompanyFromSession(request: { headers: Record<string, unknown> }) {
  const session = getPublicSessionFromRequest(request);
  const context = await getEnterpriseContextForUser(session.userId);
  if (!context.company || context.role !== 'representative') {
    throw app.httpErrors.forbidden('Representative account required');
  }
  return {
    session,
    company: context.company
  };
}

app.get('/admin/users', async (request) => {
  ensureAdmin(request);
  const query = paginationQuerySchema.parse(request.query);
  return listPlatformUsersPage({
    page: query.page,
    pageSize: query.pageSize,
    search: query.q,
    status: query.status
  });
});

app.patch('/admin/users/:userId/status', async (request, reply) => {
  ensureAdmin(request);
  const { userId } = request.params as { userId: string };
  const payload = setUserStatusSchema.parse(request.body);

  const user = await getPlatformUserById(userId);
  if (!user) {
    return reply.notFound('User not found');
  }

  if (payload.syncMoodle && user.moodle_user_id) {
    const moodleResult = await updateMoodleUserStatus({
      userId: Number(user.moodle_user_id),
      suspended: payload.status === 'inactive'
    });
    if (!moodleResult.ok) {
      return reply.badRequest(`Moodle update failed: ${moodleResult.error ?? 'unknown error'}`);
    }
  }

  const localUpdate = await setPlatformUsersStatus([userId], payload.status);

  return {
    updated: true,
    userId,
    status: payload.status,
    updatedUsers: localUpdate.updatedUsers,
    updatedEnrollments: localUpdate.updatedEnrollments
  };
});

app.post('/admin/users/status/bulk', async (request) => {
  ensureAdmin(request);
  const payload = setBulkUsersStatusSchema.parse(request.body);
  const users = await getPlatformUsersByIds(payload.userIds);
  const usersById = new Map(users.map((user) => [String(user.id), user]));
  const processedIds: string[] = [];
  const failures: Array<{ userId: string; reason: string }> = [];

  for (const userId of payload.userIds) {
    const user = usersById.get(userId);
    if (!user) {
      failures.push({ userId, reason: 'User not found' });
      continue;
    }

    if (payload.syncMoodle && user.moodle_user_id) {
      const moodleResult = await updateMoodleUserStatus({
        userId: Number(user.moodle_user_id),
        suspended: payload.status === 'inactive'
      });
      if (!moodleResult.ok) {
        failures.push({
          userId,
          reason: `Moodle update failed: ${moodleResult.error ?? 'unknown error'}`
        });
        continue;
      }
    }

    processedIds.push(userId);
  }

  const localUpdate = await setPlatformUsersStatus(processedIds, payload.status);

  return {
    processed: processedIds.length,
    requested: payload.userIds.length,
    status: payload.status,
    failures,
    updatedUsers: localUpdate.updatedUsers,
    updatedEnrollments: localUpdate.updatedEnrollments
  };
});

app.get('/admin/users/:userId/courses', async (request, reply) => {
  ensureAdmin(request);
  const { userId } = request.params as { userId: string };
  const user = await getPlatformUserById(userId);

  if (!user) {
    return reply.notFound('User not found');
  }

  let moodleCourses: unknown[] = [];

  if (user.moodle_user_id) {
    const syncResult = await syncUserEnrollmentsFromMoodle(userId, Number(user.moodle_user_id));
    if (syncResult.synced) {
      moodleCourses = syncResult.moodleCourses;
    } else {
      app.log.warn(
        {
          userId,
          moodleUserId: Number(user.moodle_user_id),
          error: syncResult.error
        },
        'Admin user enrollment sync failed'
      );
    }
  }
  const localCourses = await listUserCourses(userId);

  return {
    user,
    localCourses,
    moodleCourses
  };
});

app.get('/admin/companies', async (request) => {
  ensureAdmin(request);
  return listCompanies();
});

app.post('/admin/companies', async (request, reply) => {
  ensureAdmin(request);
  const payload = createCompanySchema.parse(request.body);
  const tenantId = payload.tenantId ?? (await getTenantAndUser()).tenant?.id;
  if (!tenantId) {
    return reply.internalServerError('No tenant available for company creation');
  }
  const representative = await getPlatformUserById(payload.representativeUserId);
  if (!representative) {
    return reply.notFound('Representative user not found');
  }
  const created = await createCompany({
    slug: normalizeCompanySlug(payload.slug ?? payload.name),
    name: payload.name.trim(),
    description: payload.description?.trim() || null,
    contactEmail: payload.contactEmail?.trim().toLowerCase() || null,
    representativeUserId: payload.representativeUserId,
    tenantId,
    isActive: payload.isActive ?? true
  });
  await upsertCompanyMember({
    companyId: String(created.id),
    userId: String(payload.representativeUserId),
    memberRole: 'representative',
    status: 'active'
  });
  const refreshed = await getCompanyById(String(created.id));
  return reply.code(201).send({
    created: true,
    company: refreshed ?? created
  });
});

app.patch('/admin/companies/:companyId', async (request, reply) => {
  ensureAdmin(request);
  const { companyId } = request.params as { companyId: string };
  const payload = updateCompanySchema.parse(request.body);
  const existing = await getCompanyById(companyId);
  if (!existing) {
    return reply.notFound('Company not found');
  }
  const updated = await updateCompany(companyId, {
    slug: payload.slug ? normalizeCompanySlug(payload.slug) : undefined,
    name: payload.name?.trim(),
    description:
      payload.description === undefined
        ? undefined
        : payload.description === null
          ? null
          : payload.description.trim(),
    contactEmail: payload.contactEmail ? payload.contactEmail.trim().toLowerCase() : payload.contactEmail,
    representativeUserId: payload.representativeUserId,
    isActive: payload.isActive
  });
  if (!updated) {
    return reply.notFound('Company not found');
  }
  if (payload.representativeUserId) {
    await upsertCompanyMember({
      companyId,
      userId: payload.representativeUserId,
      memberRole: 'representative',
      status: 'active'
    });
  }
  const refreshed = await getCompanyById(companyId);
  return { updated: true, company: refreshed ?? updated };
});

app.delete('/admin/companies/:companyId', async (request, reply) => {
  ensureAdmin(request);
  const { companyId } = request.params as { companyId: string };
  const existing = await getCompanyById(companyId);
  if (!existing) {
    return reply.notFound('Company not found');
  }
  const deleted = await deleteCompany(companyId);
  if (!deleted) {
    return reply.status(500).send({ error: 'Failed to delete company' });
  }
  return { deleted: true };
});

app.get('/admin/companies/:companyId/members', async (request, reply) => {
  ensureAdmin(request);
  const { companyId } = request.params as { companyId: string };
  const company = await getCompanyById(companyId);
  if (!company) {
    return reply.notFound('Company not found');
  }
  return listCompanyMembers(companyId);
});

app.get('/admin/companies/:companyId/stats', async (request, reply) => {
  ensureAdmin(request);
  const { companyId } = request.params as { companyId: string };
  const company = await getCompanyById(companyId);
  if (!company) {
    return reply.notFound('Company not found');
  }
  const [stats, memberProgress] = await Promise.all([
    getCompanyDashboardStats(companyId),
    getCompanyUserProgress(companyId)
  ]);
  return { stats, memberProgress };
});

app.post('/admin/companies/:companyId/members', async (request, reply) => {
  ensureAdmin(request);
  const { companyId } = request.params as { companyId: string };
  const payload = createCompanyMemberSchema.parse(request.body);
  const company = await getCompanyById(companyId);
  if (!company) {
    return reply.notFound('Company not found');
  }

  const user = await resolveOrCreateCompanyUser({
    tenantId: String(company.tenant_id),
    userId: payload.userId,
    fullName: payload.fullName,
    email: payload.email,
    locale: payload.locale
  });

  const member = await upsertCompanyMember({
    companyId,
    userId: String(user.id),
    memberRole: payload.role,
    status: 'active'
  });

  if (String(payload.role) === 'representative') {
    await updateCompany(companyId, {
      representativeUserId: String(user.id)
    });
  }

  if (user.moodle_user_id) {
    await syncCompanyCoursesForMember({
      companyId,
      userId: String(user.id),
      moodleUserId: Number(user.moodle_user_id)
    });
  }

  const members = await listCompanyMembers(companyId);
  const hydrated = members.find((item) => String(item.user_id) === String(user.id));
  return reply.code(201).send({
    created: true,
    member: hydrated ?? member,
    user
  });
});

app.patch('/admin/companies/:companyId/members/:userId', async (request, reply) => {
  ensureAdmin(request);
  const { companyId, userId } = request.params as { companyId: string; userId: string };
  const payload = updateCompanyMemberSchema.parse(request.body);
  const company = await getCompanyById(companyId);
  if (!company) {
    return reply.notFound('Company not found');
  }
  const membership = await getCompanyMembership({ companyId, userId });
  if (!membership) {
    return reply.notFound('Member not found in company');
  }

  const newStatus = payload.status ?? membership.status;
  const newRole = payload.role ?? membership.member_role;

  const updated = await upsertCompanyMember({
    companyId,
    userId,
    status: newStatus as 'active' | 'inactive',
    memberRole: newRole as 'representative' | 'collaborator'
  });
  if (!updated) {
    return reply.notFound('Member not found in company');
  }
  const user = await getPlatformUserById(userId);
  if (user) {
    if (payload.fullName || payload.email) {
      await updatePlatformUserProfile({
        userId,
        fullName: payload.fullName ?? user.full_name,
        email: payload.email ?? user.email,
        locale: user.locale
      });
    }

    if (user.moodle_user_id) {
      const moodleUserId = Number(user.moodle_user_id);

      if (payload.fullName || payload.email) {
        const { firstname, lastname } = splitName(payload.fullName ?? user.full_name);
        await updateMoodleUserProfile({
          userId: moodleUserId,
          firstname,
          lastname,
          email: payload.email ?? user.email
        });
      }

      if (payload.status) {
        await updateMoodleUserStatus({
          userId: moodleUserId,
          suspended: payload.status === 'inactive'
        });
        if (payload.status === 'active') {
          await syncCompanyCoursesForMember({
            companyId,
            userId,
            moodleUserId
          });
        } else {
          const activeCourseIds = await listCompanyActiveCourseAccess(companyId);
          for (const courseId of activeCourseIds) {
            await unenrolMoodleUser({
              userId: moodleUserId,
              courseId
            });
          }
          await Promise.all(
            activeCourseIds.map((courseId) =>
              setUserCourseEnrollmentStatusForUsers({
                userIds: [userId],
                moodleCourseId: courseId,
                status: 'inactive'
              })
            )
          );
        }
      }
    }
  }

  const members = await listCompanyMembers(companyId);
  const hydrated = members.find((item) => String(item.user_id) === String(userId));
  return { updated: true, member: hydrated ?? updated };
});

app.delete('/admin/companies/:companyId/members/:userId', async (request, reply) => {
  ensureAdmin(request);
  const { companyId, userId } = request.params as { companyId: string; userId: string };
  const company = await getCompanyById(companyId);
  if (!company) {
    return reply.notFound('Company not found');
  }
  const membership = await getCompanyMembership({ companyId, userId });
  if (!membership) {
    return reply.notFound('Member not found in company');
  }
  const user = await getPlatformUserById(userId);
  if (user?.moodle_user_id) {
    const moodleUserId = Number(user.moodle_user_id);
    const activeCourseIds = await listCompanyActiveCourseAccess(companyId);
    for (const courseId of activeCourseIds) {
      await unenrolMoodleUser({
        userId: moodleUserId,
        courseId
      });
    }
    await Promise.all(
      activeCourseIds.map((courseId) =>
        setUserCourseEnrollmentStatusForUsers({
          userIds: [userId],
          moodleCourseId: courseId,
          status: 'inactive'
        })
      )
    );
  }
  const deleted = await removeCompanyMember(companyId, userId);
  return { deleted };
});

app.get('/admin/companies/:companyId/courses', async (request, reply) => {
  ensureAdmin(request);
  const { companyId } = request.params as { companyId: string };
  const company = await getCompanyById(companyId);
  if (!company) {
    return reply.notFound('Company not found');
  }
  return listCompanyCourseAccess(companyId);
});

app.put('/admin/companies/:companyId/courses/:moodleCourseId', async (request, reply) => {
  ensureAdmin(request);
  const { companyId, moodleCourseId } = request.params as { companyId: string; moodleCourseId: string };
  const payload = upsertCompanyCourseSchema.parse({
    ...((request.body as Record<string, unknown>) ?? {}),
    moodleCourseId: Number(moodleCourseId)
  });
  const company = await getCompanyById(companyId);
  if (!company) {
    return reply.notFound('Company not found');
  }
  const access = await upsertCompanyCourseAccess({
    companyId,
    moodleCourseId: payload.moodleCourseId,
    isActive: payload.isActive ?? true,
    assignedByUserId: company.representative_user_id ? String(company.representative_user_id) : null
  });
  await syncCompanyCourseToMembers({
    companyId,
    moodleCourseId: payload.moodleCourseId,
    isActive: payload.isActive ?? true
  });
  return { updated: true, access };
});

app.delete('/admin/companies/:companyId/courses/:moodleCourseId', async (request, reply) => {
  ensureAdmin(request);
  const { companyId, moodleCourseId } = request.params as { companyId: string; moodleCourseId: string };
  const parsedCourseId = Number(moodleCourseId);
  if (!Number.isInteger(parsedCourseId) || parsedCourseId <= 0) {
    return reply.badRequest('Invalid moodleCourseId');
  }
  const company = await getCompanyById(companyId);
  if (!company) {
    return reply.notFound('Company not found');
  }
  await syncCompanyCourseToMembers({
    companyId,
    moodleCourseId: parsedCourseId,
    isActive: false
  });
  const deleted = await deleteCompanyCourseAccess({
    companyId,
    moodleCourseId: parsedCourseId
  });
  return { deleted };
});

app.get('/admin/companies/:companyId/groups', async (request, reply) => {
  ensureAdmin(request);
  const { companyId } = request.params as { companyId: string };
  return listCompanyCourseGroups(companyId);
});

app.post('/admin/companies/:companyId/groups', async (request, reply) => {
  ensureAdmin(request);
  const { companyId } = request.params as { companyId: string };
  const payload = z.object({ name: z.string(), description: z.string().optional() }).parse(request.body);
  const created = await createCompanyCourseGroup({
    id: randomUUID(),
    companyId,
    name: payload.name,
    description: payload.description
  });
  return { created };
});

app.patch('/admin/companies/:companyId/groups/:groupId', async (request, reply) => {
  ensureAdmin(request);
  const { groupId } = request.params as { groupId: string };
  const payload = z.object({ name: z.string().optional(), description: z.string().optional() }).parse(request.body);
  const updated = await updateCompanyCourseGroup({ id: groupId, name: payload.name, description: payload.description });
  return { updated };
});

app.delete('/admin/companies/:companyId/groups/:groupId', async (request, reply) => {
  ensureAdmin(request);
  const { groupId } = request.params as { groupId: string };
  const members = await getGroupMembers(groupId);
  const deleted = await deleteCompanyCourseGroup(groupId);
  for (const m of members) {
     const dbMember = await getPlatformUserById(m.user_id);
     if (dbMember?.moodle_user_id) {
        await syncCompanyCoursesForMember({ companyId: m.company_id, userId: m.user_id, moodleUserId: Number(dbMember.moodle_user_id) });
     }
  }
  return { deleted };
});

app.put('/admin/companies/:companyId/groups/:groupId/courses/:moodleCourseId', async (request, reply) => {
  ensureAdmin(request);
  const { groupId, moodleCourseId } = request.params as { groupId: string, moodleCourseId: string };
  const parsedCourseId = parseInt(moodleCourseId, 10);
  const added = await assignCourseToGroup({ groupId, moodleCourseId: parsedCourseId });
  const members = await getGroupMembers(groupId);
  for (const m of members) {
     const dbMember = await getPlatformUserById(m.user_id);
     if (dbMember?.moodle_user_id) {
        await syncCompanyCoursesForMember({ companyId: m.company_id, userId: m.user_id, moodleUserId: Number(dbMember.moodle_user_id) });
     }
  }
  return { added };
});

app.delete('/admin/companies/:companyId/groups/:groupId/courses/:moodleCourseId', async (request, reply) => {
  ensureAdmin(request);
  const { groupId, moodleCourseId } = request.params as { groupId: string, moodleCourseId: string };
  const parsedCourseId = parseInt(moodleCourseId, 10);
  const deleted = await removeCourseFromGroup({ groupId, moodleCourseId: parsedCourseId });
  const members = await getGroupMembers(groupId);
  for (const m of members) {
     const dbMember = await getPlatformUserById(m.user_id);
     if (dbMember?.moodle_user_id) {
        await syncCompanyCoursesForMember({ companyId: m.company_id, userId: m.user_id, moodleUserId: Number(dbMember.moodle_user_id) });
     }
  }
  return { deleted };
});

app.get('/admin/companies/:companyId/members/:userId/assignments', async (request, reply) => {
  ensureAdmin(request);
  const { companyId, userId } = request.params as { companyId: string, userId: string };
  const groups = await listCompanyMemberGroups(companyId, userId);
  const courses = await listCompanyMemberCourses(companyId, userId);
  return { groups, courses };
});

app.put('/admin/companies/:companyId/members/:userId/groups/:groupId', async (request, reply) => {
  ensureAdmin(request);
  const { companyId, userId, groupId } = request.params as { companyId: string, userId: string, groupId: string };
  const added = await assignGroupToMember({ companyId, userId, groupId });
  const dbMember = await getPlatformUserById(userId);
  if (dbMember?.moodle_user_id) {
     await syncCompanyCoursesForMember({ companyId, userId, moodleUserId: Number(dbMember.moodle_user_id) });
  }
  return { added };
});

app.delete('/admin/companies/:companyId/members/:userId/groups/:groupId', async (request, reply) => {
  ensureAdmin(request);
  const { companyId, userId, groupId } = request.params as { companyId: string, userId: string, groupId: string };
  const deleted = await removeGroupFromMember({ companyId, userId, groupId });
  const dbMember = await getPlatformUserById(userId);
  if (dbMember?.moodle_user_id) {
     await syncCompanyCoursesForMember({ companyId, userId, moodleUserId: Number(dbMember.moodle_user_id) });
  }
  return { deleted };
});

app.put('/admin/companies/:companyId/members/:userId/courses/:moodleCourseId', async (request, reply) => {
  ensureAdmin(request);
  const { companyId, userId, moodleCourseId } = request.params as { companyId: string, userId: string, moodleCourseId: string };
  const parsedCourseId = parseInt(moodleCourseId, 10);
  const added = await assignCourseToMember({ companyId, userId, moodleCourseId: parsedCourseId });
  const dbMember = await getPlatformUserById(userId);
  if (dbMember?.moodle_user_id) {
     await syncCompanyCoursesForMember({ companyId, userId, moodleUserId: Number(dbMember.moodle_user_id) });
  }
  return { added };
});

app.delete('/admin/companies/:companyId/members/:userId/courses/:moodleCourseId', async (request, reply) => {
  ensureAdmin(request);
  const { companyId, userId, moodleCourseId } = request.params as { companyId: string, userId: string, moodleCourseId: string };
  const parsedCourseId = parseInt(moodleCourseId, 10);
  const deleted = await removeCourseFromMember({ companyId, userId, moodleCourseId: parsedCourseId });
  const dbMember = await getPlatformUserById(userId);
  if (dbMember?.moodle_user_id) {
     await syncCompanyCoursesForMember({ companyId, userId, moodleUserId: Number(dbMember.moodle_user_id) });
  }
  return { deleted };
});

app.post('/admin/users', async (request, reply) => {
  ensureAdmin(request);
  const payload = createUserSchema.parse(request.body);

  const existing = await getMoodleUsersByEmail(payload.email);
  if (existing.ok && (existing.data?.length ?? 0) > 0) {
    return reply.conflict('A Moodle user with this email already exists');
  }

  const tempPassword = generateTemporaryPassword();
  const { firstname, lastname } = splitName(payload.fullName);
  const username = normalizeUsername(payload.email);
  const createResult = await createMoodleUser({
    username,
    firstname,
    lastname,
    email: payload.email,
    password: tempPassword
  });

  if (!createResult.ok || !createResult.data?.[0]?.id) {
    return reply.badRequest(`Moodle user creation failed: ${createResult.error ?? 'unknown error'}`);
  }

  const tenantId = payload.tenantId ?? (await getTenantAndUser()).tenant?.id;
  if (!tenantId) {
    return reply.internalServerError('No tenant available for user creation');
  }

  const user = await createPlatformUser({
    id: randomUUID(),
    fullName: payload.fullName,
    email: payload.email,
    locale: payload.locale,
    roles: payload.roles,
    tenantId,
    moodleUserId: Number(createResult.data[0].id)
  });

  return {
    created: true,
    user,
    moodleUserId: Number(createResult.data[0].id),
    temporaryPassword: tempPassword
  };
});

app.post('/admin/users/:userId/enrollments', async (request, reply) => {
  ensureAdmin(request);
  const { userId } = request.params as { userId: string };
  const payload = enrolUserSchema.parse(request.body);

  const user = await getPlatformUserById(userId);
  if (!user) {
    return reply.notFound('User not found');
  }

  if (!user.moodle_user_id) {
    return reply.badRequest('User is missing moodle_user_id');
  }

  const enrolResult = await enrolMoodleUser({
    userId: Number(user.moodle_user_id),
    courseId: payload.moodleCourseId,
    roleId: payload.roleId
  });

  if (!enrolResult.ok) {
    return reply.badRequest(`Moodle enrollment failed: ${enrolResult.error ?? 'unknown error'}`);
  }

  await upsertUserCourseEnrollment({
    userId,
    moodleCourseId: payload.moodleCourseId,
    status: 'active'
  });

  return {
    enrolled: true,
    userId,
    moodleCourseId: payload.moodleCourseId
  };
});

app.get('/admin/moodle/config', async (request) => {
  ensureAdmin(request);
  const moodle = getMoodleConfig();
  return {
    configured: hasMoodleConfig(),
    baseUrl: moodle.baseUrl || null,
    tokenSet: Boolean(moodle.token)
  };
});

app.put('/admin/moodle/config', async (request, reply) => {
  ensureAdmin(request);
  const payload = updateMoodleConnectionSchema.parse(request.body);
  const current = getMoodleConfig();
  const effectiveToken = (payload.token ?? '').trim() || current.token;
  if (!effectiveToken) {
    return reply.badRequest('Token Moodle is required');
  }
  setMoodleConfig({
    baseUrl: payload.baseUrl,
    token: effectiveToken
  });
  await saveIntegrationSetting('moodle.connection', {
    baseUrl: payload.baseUrl.trim(),
    token: effectiveToken,
    updatedAt: new Date().toISOString()
  });
  const siteInfo = await getMoodleSiteInfo();
  if (!siteInfo.ok) {
    return reply.badRequest(`Moodle connection saved but validation failed: ${siteInfo.error ?? 'unknown error'}`);
  }
  return {
    updated: true,
    configured: hasMoodleConfig(),
    connected: true,
    siteInfo: siteInfo.data,
    baseUrl: getMoodleConfig().baseUrl
  };
});

app.get('/admin/moodle/status', async (request) => {
  ensureAdmin(request);
  const [siteInfo, lastCoursesSync, lastUsersSync, lastCategoriesSync] = await Promise.all([
    getMoodleSiteInfo(),
    getIntegrationSetting<{ syncedAt: string; total: number; upsertedCatalogAssets?: number }>(
      'moodle.last_courses_sync'
    ),
    getIntegrationSetting<{
      syncedAt: string;
      totalUsers: number;
      upsertedUsers: number;
      enrollmentLinks: number;
      warningsCount: number;
    }>('moodle.last_users_sync'),
    getIntegrationSetting<{ syncedAt: string; total: number }>('moodle.last_categories_sync')
  ]);
  return {
    configured: hasMoodleConfig(),
    siteInfo,
    lastCoursesSync,
    lastUsersSync,
    lastCategoriesSync
  };
});

app.get('/admin/moodle/courses', async (request) => {
  ensureAdmin(request);
  const query = paginationQuerySchema.parse(request.query);
  const visible = query.visible ? query.visible === 'true' : undefined;
  const pageData = await listMoodleCoursesPage({
    page: query.page,
    pageSize: query.pageSize,
    search: query.q,
    visible
  });
  return {
    items: pageData.items,
    pagination: pageData.pagination
  };
});

app.get('/admin/moodle/users', async (request) => {
  ensureAdmin(request);
  return listMoodleBackedUsers();
});

app.get('/admin/moodle/categories', async (request) => {
  ensureAdmin(request);
  return listMoodleCategories();
});

app.post('/admin/moodle/sync/courses', async (request) => {
  ensureAdmin(request);
  return runCoursesSyncInternal();
});

app.post('/admin/moodle/sync/categories', async (request, reply) => {
  ensureAdmin(request);
  const result = await runCategoriesSyncInternal();
  if (!result.synced) {
    return reply.badRequest(`Moodle categories sync failed: ${result.error ?? 'unknown error'}`);
  }
  return result;
});

app.post('/admin/moodle/sync/users', async (request, reply) => {
  ensureAdmin(request);
  const result = await runUsersSyncInternal();
  if (!result.synced) {
    return reply.badRequest(`Moodle users sync failed: ${result.error ?? 'unknown error'}`);
  }
  return result;
});

app.post('/admin/moodle/sync/enterprise', async (request, reply) => {
  ensureAdmin(request);
  const result = await runEnterpriseSyncInternal();
  if (!result.synced) {
    return reply.badRequest(`Moodle enterprise sync failed: ${result.error ?? 'unknown error'}`);
  }
  return result;
});

app.post('/admin/moodle/sync/all', async (request, reply) => {
  ensureAdmin(request);
  const categories = await runCategoriesSyncInternal();
  if (!categories.synced) {
    return reply.badRequest(`Moodle categories sync failed: ${categories.error ?? 'unknown error'}`);
  }

  const courses = await runCoursesSyncInternal();
  if (!courses.synced) {
    return reply.badRequest(`Moodle courses sync failed: ${courses.error ?? 'unknown error'}`);
  }

  const users = await runUsersSyncInternal();
  if (!users.synced) {
    return reply.badRequest(`Moodle users sync failed: ${users.error ?? 'unknown error'}`);
  }

  return {
    synced: true,
    categories,
    courses,
    users
  };
});

// --- Academic endpoints ---

app.get('/v1/terms', async () => {
  const result = await pool.query(
    `SELECT id, name, code, start_date, end_date, is_active, created_at FROM academic_terms ORDER BY start_date DESC`
  );
  return result.rows;
});

app.get('/v1/degrees', async () => {
  const result = await pool.query(
    `SELECT d.id, d.name, d.code, d.degree_level, d.credit_hours_required, d.description, d.is_active,
            dep.name AS department_name
     FROM degree_programs d
     LEFT JOIN departments dep ON d.department_id = dep.id
     WHERE d.is_active = true
     ORDER BY d.name`
  );
  return result.rows;
});

app.get('/v1/me/transcript', async (request, reply) => {
  const session = getPublicSessionFromRequest(request);
  if (!session) return reply.unauthorized('Not authenticated');
  const result = await pool.query(
    `SELECT se.id, se.moodle_course_id, se.status, se.grade, se.grade_points, se.credit_hours,
            se.enrolled_at, se.completed_at,
            t.name AS term_name, t.code AS term_code,
            mc.full_name AS course_name
     FROM student_enrollments se
     JOIN academic_terms t ON se.term_id = t.id
     LEFT JOIN moodle_courses mc ON se.moodle_course_id = mc.moodle_course_id
     WHERE se.user_id = $1
     ORDER BY t.start_date DESC, se.enrolled_at DESC`,
    [session.userId]
  );
  return result.rows;
});

app.get('/v1/me/gpa', async (request, reply) => {
  const session = getPublicSessionFromRequest(request);
  if (!session) return reply.unauthorized('Not authenticated');
  const result = await pool.query(
    `SELECT
       ROUND(
         SUM(se.grade_points * se.credit_hours) / NULLIF(SUM(CASE WHEN se.grade_points IS NOT NULL THEN se.credit_hours ELSE 0 END), 0),
         2
       ) AS cumulative_gpa,
       SUM(CASE WHEN se.status = 'completed' THEN se.credit_hours ELSE 0 END) AS completed_credits,
       COUNT(*) AS total_enrollments
     FROM student_enrollments se
     WHERE se.user_id = $1`,
    [session.userId]
  );
  return result.rows[0] ?? { cumulative_gpa: null, completed_credits: 0, total_enrollments: 0 };
});

app.get('/admin/terms', async (request) => {
  ensureAdmin(request);
  const result = await pool.query(
    `SELECT id, name, code, start_date, end_date, is_active, created_at FROM academic_terms ORDER BY start_date DESC`
  );
  return result.rows;
});

app.post('/admin/terms', async (request, reply) => {
  ensureAdmin(request);
  const body = z.object({
    name: z.string().min(1),
    code: z.string().min(1),
    startDate: z.string(),
    endDate: z.string(),
    isActive: z.boolean().optional()
  }).parse(request.body);
  const result = await pool.query(
    `INSERT INTO academic_terms (name, code, start_date, end_date, is_active)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [body.name, body.code, body.startDate, body.endDate, body.isActive ?? false]
  );
  return reply.status(201).send(result.rows[0]);
});

app.get('/admin/departments', async (request) => {
  ensureAdmin(request);
  const result = await pool.query(
    `SELECT id, name, code, description, dean_name, created_at FROM departments ORDER BY name`
  );
  return result.rows;
});

app.post('/admin/departments', async (request, reply) => {
  ensureAdmin(request);
  const body = z.object({
    name: z.string().min(1),
    code: z.string().min(1),
    description: z.string().optional(),
    deanName: z.string().optional()
  }).parse(request.body);
  const result = await pool.query(
    `INSERT INTO departments (name, code, description, dean_name)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [body.name, body.code, body.description ?? null, body.deanName ?? null]
  );
  return reply.status(201).send(result.rows[0]);
});

app.get('/admin/degree-programs', async (request) => {
  ensureAdmin(request);
  const result = await pool.query(
    `SELECT d.id, d.name, d.code, d.degree_level, d.credit_hours_required, d.description, d.is_active,
            dep.name AS department_name
     FROM degree_programs d
     LEFT JOIN departments dep ON d.department_id = dep.id
     ORDER BY d.name`
  );
  return result.rows;
});

app.post('/admin/degree-programs', async (request, reply) => {
  ensureAdmin(request);
  const body = z.object({
    name: z.string().min(1),
    code: z.string().min(1),
    degreeLevel: z.enum(['certificate','associate','bachelor','master','doctoral','professional']),
    departmentId: z.string().optional(),
    creditHoursRequired: z.number().int().optional(),
    description: z.string().optional()
  }).parse(request.body);
  const result = await pool.query(
    `INSERT INTO degree_programs (name, code, degree_level, department_id, credit_hours_required, description)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [body.name, body.code, body.degreeLevel, body.departmentId ?? null, body.creditHoursRequired ?? 120, body.description ?? null]
  );
  return reply.status(201).send(result.rows[0]);
});

/**
 * Actualiza un programa, incluido `is_active`.
 *
 * Por que existe: `is_active` es el denominador del checklist CIE de la Etapa I
 * — cada programa activo exige su propia evidencia (Master Syllabus, malla,
 * resultados de aprendizaje, acta de aprobacion). Sin esta ruta, un programa
 * creado por error inflaba para siempre la evidencia exigida y no habia forma
 * de sacarlo del conteo.
 *
 * No se expone DELETE a proposito: `degree_programs` es referenciada por
 * matriculas, solicitudes de admision y expedientes de faculty. Desactivar es
 * la operacion correcta en un SIS; borrar arrastraria historia academica.
 */
app.patch('/admin/degree-programs/:programId', async (request, reply) => {
  ensureAdmin(request);
  const { programId } = request.params as { programId: string };
  const body = z
    .object({
      name: z.string().min(1).optional(),
      code: z.string().min(1).optional(),
      degreeLevel: z
        .enum(['certificate', 'associate', 'bachelor', 'master', 'doctoral', 'professional'])
        .optional(),
      departmentId: z.string().nullable().optional(),
      creditHoursRequired: z.number().int().min(0).optional(),
      description: z.string().nullable().optional(),
      isActive: z.boolean().optional()
    })
    .parse(request.body);

  const result = await pool.query(
    `UPDATE degree_programs SET
       name                  = COALESCE($2, name),
       code                  = COALESCE($3, code),
       degree_level          = COALESCE($4, degree_level),
       department_id         = COALESCE($5, department_id),
       credit_hours_required = COALESCE($6, credit_hours_required),
       description           = COALESCE($7, description),
       is_active             = COALESCE($8, is_active)
     WHERE id = $1
     RETURNING *`,
    [
      programId,
      body.name ?? null,
      body.code ?? null,
      body.degreeLevel ?? null,
      body.departmentId ?? null,
      body.creditHoursRequired ?? null,
      body.description ?? null,
      body.isActive ?? null
    ]
  );

  if (!result.rows[0]) {
    return reply.notFound('Degree program not found');
  }
  return result.rows[0];
});

setInterval(() => {
  if (!hasMoodleConfig()) {
    return;
  }
  void runFullMoodleSync('auto-interval').catch((error) => {
    app.log.warn({ error }, 'Auto Moodle sync failed');
  });
}, autoSyncIntervalMs);

if (hasMoodleConfig()) {
  void runFullMoodleSync('startup').catch((error) => {
    app.log.warn({ error }, 'Startup Moodle sync failed');
  });
}

// University OS module routes (Fases 1-5)
registerSisRoutes(app, {
  pool,
  ensureAdmin,
  resolvePublicUser: (req) => {
    const s = getPublicSessionFromRequest(req);
    return { userId: s.userId, email: s.email };
  }
});
registerCrmRoutes(app, { pool, ensureAdmin });
registerSyllabusRoutes(app, { pool, ensureAdmin });
registerBackofficeRoutes(app, { pool, ensureAdmin });
registerCredentialsRoutes(app, {
  pool,
  ensureAdmin,
  getPublicSession: (req) => getPublicSessionFromRequest(req)
});
// Etapa I — CIE Readiness: checklist documental, expedientes de faculty y
// formulario de contacto público.
registerCieRoutes(app, { pool, ensureAdmin });
registerPagesRoutes(app, { pool, ensureAdmin });
registerCalendarRoutes(app, {
  pool,
  ensureAdmin,
  getCourseContents: (courseId) => getMoodleCourseContents(courseId),
  pushDatesToMoodle: (courseId, grid) => pushTermDatesToCourse(courseId, grid)
});

const port = config.server.port;
const host = config.server.host;

app.listen({ port, host }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
