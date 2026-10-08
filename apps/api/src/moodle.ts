import { getMoodleConfig, hasMoodleConfig } from './config.js';

export interface MoodleCallResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export type MoodleCourse = {
  id: number;
  fullname: string;
  shortname: string;
  idnumber?: string;
  categoryid?: number;
  visible?: number;
  startdate?: number;
  enddate?: number;
  summary?: string;
  lang?: string;
  timemodified?: number;
};

export type MoodleUser = {
  id: number;
  username: string;
  firstname: string;
  lastname: string;
  fullname?: string;
  email: string;
  suspended?: number;
  deleted?: number;
  lang?: string;
};

export type MoodleCategory = {
  id: number;
  name: string;
  idnumber?: string;
  parent?: number;
  depth?: number;
  path?: string;
  visible?: number;
};

export type MoodleCourseSection = {
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
      isexternalfile?: boolean;
      userid?: number;
      author?: string;
      license?: string;
      timecreated?: number;
      sortorder?: number;
    }>;
  }>;
};

export type MoodleCompletionStatus = {
  cmid?: number;
  state?: number;
  timecompleted?: number;
};

export type MoodleCompletionResponse = {
  statuses?: MoodleCompletionStatus[];
  warnings?: Array<Record<string, unknown>>;
};

export type MoodleNote = {
  id?: number;
  userid?: number;
  courseid?: number;
  content?: string;
  created?: number;
  [key: string]: unknown;
};

export type MoodleNotesResponse = {
  notes?: MoodleNote[];
  warnings?: Array<Record<string, unknown>>;
};

async function callMoodle<T>(
  wsfunction: string,
  extraParams: Record<string, string> = {},
  method: 'GET' | 'POST' = 'GET'
): Promise<MoodleCallResult<T>> {
  if (!hasMoodleConfig()) {
    return {
      ok: false,
      error: 'Moodle is not configured. Set MOODLE_BASE_URL and MOODLE_TOKEN.'
    };
  }

  try {
    const moodle = getMoodleConfig();
    const url = new URL('/webservice/rest/server.php', moodle.baseUrl);
    url.searchParams.set('wstoken', moodle.token);
    url.searchParams.set('moodlewsrestformat', 'json');
    url.searchParams.set('wsfunction', wsfunction);

    const requestParams = new URLSearchParams();
    for (const [key, value] of Object.entries(extraParams)) {
      if (method === 'GET') {
        url.searchParams.set(key, value);
      } else {
        requestParams.set(key, value);
      }
    }

    const response = await fetch(url.toString(), {
      method,
      headers: method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
      body: method === 'POST' ? requestParams.toString() : undefined
    });

    const text = await response.text();
    const parsed: unknown = text ? JSON.parse(text) : {};
    const body = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;

    if (!response.ok) {
      return { ok: false, error: `Moodle HTTP ${response.status}` };
    }

    if (body && (typeof body.exception === 'string' || typeof body.errorcode === 'string')) {
      return {
        ok: false,
        error: String(body.message ?? body.exception ?? body.errorcode ?? 'Moodle error')
      };
    }

    return { ok: true, data: parsed as T };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown Moodle error'
    };
  }
}

export async function getMoodleSiteInfo() {
  return callMoodle<Record<string, unknown>>('core_webservice_get_site_info');
}

export async function getMoodleCourses() {
  return callMoodle<MoodleCourse[]>('core_course_get_courses');
}

export async function getMoodleCategories() {
  return callMoodle<MoodleCategory[]>('core_course_get_categories');
}

export async function createMoodleCategory(input: {
  name: string;
  idnumber?: string;
  description?: string;
  parent?: number;
}): Promise<MoodleCallResult<Array<{ id: number }>>> {
  return callMoodle<Array<{ id: number }>>(
    'core_course_create_categories',
    {
      'categories[0][name]': input.name,
      'categories[0][idnumber]': input.idnumber ?? '',
      'categories[0][description]': input.description ?? '',
      'categories[0][parent]': String(input.parent ?? 0)
    },
    'POST'
  );
}

export async function createMoodleCourse(input: {
  fullname: string;
  shortname: string;
  idnumber?: string;
  categoryid: number;
  summary?: string;
  visible?: boolean;
}): Promise<MoodleCallResult<Array<{ id: number }>>> {
  return callMoodle<Array<{ id: number }>>(
    'core_course_create_courses',
    {
      'courses[0][fullname]': input.fullname,
      'courses[0][shortname]': input.shortname,
      'courses[0][idnumber]': input.idnumber ?? '',
      'courses[0][categoryid]': String(input.categoryid),
      'courses[0][summary]': input.summary ?? '',
      'courses[0][summaryformat]': '1',
      'courses[0][visible]': input.visible === false ? '0' : '1',
      'courses[0][format]': 'topics'
    },
    'POST'
  );
}

export async function updateMoodleCourse(input: {
  id: number;
  fullname: string;
  shortname: string;
  idnumber?: string;
  categoryid: number;
  summary?: string;
  visible?: boolean;
}): Promise<MoodleCallResult<unknown>> {
  return callMoodle<unknown>(
    'core_course_update_courses',
    {
      'courses[0][id]': String(input.id),
      'courses[0][fullname]': input.fullname,
      'courses[0][shortname]': input.shortname,
      'courses[0][idnumber]': input.idnumber ?? '',
      'courses[0][categoryid]': String(input.categoryid),
      'courses[0][summary]': input.summary ?? '',
      'courses[0][summaryformat]': '1',
      'courses[0][visible]': input.visible === false ? '0' : '1',
      'courses[0][format]': 'topics'
    },
    'POST'
  );
}

export async function createMoodleUser(input: {
  username: string;
  firstname: string;
  lastname: string;
  email: string;
  password: string;
}): Promise<MoodleCallResult<Array<{ id: number }>>> {
  return callMoodle<Array<{ id: number }>>(
    'core_user_create_users',
    {
      'users[0][username]': input.username,
      'users[0][firstname]': input.firstname,
      'users[0][lastname]': input.lastname,
      'users[0][email]': input.email,
      'users[0][password]': input.password,
      'users[0][auth]': 'manual'
    },
    'POST'
  );
}

export async function getMoodleUsersByEmail(email: string): Promise<MoodleCallResult<MoodleUser[]>> {
  return callMoodle<MoodleUser[]>(
    'core_user_get_users_by_field',
    {
      field: 'email',
      'values[0]': email
    },
    'POST'
  );
}

export async function enrolMoodleUser(input: {
  userId: number;
  courseId: number;
  roleId?: number;
}): Promise<MoodleCallResult<unknown>> {
  return callMoodle<unknown>(
    'enrol_manual_enrol_users',
    {
      'enrolments[0][roleid]': String(input.roleId ?? 5),
      'enrolments[0][userid]': String(input.userId),
      'enrolments[0][courseid]': String(input.courseId)
    },
    'POST'
  );
}

export async function unenrolMoodleUser(input: {
  userId: number;
  courseId: number;
  roleId?: number;
}): Promise<MoodleCallResult<unknown>> {
  return callMoodle<unknown>(
    'enrol_manual_unenrol_users',
    {
      'enrolments[0][roleid]': String(input.roleId ?? 5),
      'enrolments[0][userid]': String(input.userId),
      'enrolments[0][courseid]': String(input.courseId)
    },
    'POST'
  );
}

export async function getMoodleUserCourses(userId: number): Promise<MoodleCallResult<MoodleCourse[]>> {
  return callMoodle<MoodleCourse[]>(
    'core_enrol_get_users_courses',
    {
      userid: String(userId)
    },
    'POST'
  );
}

export async function getMoodleUsers(): Promise<MoodleCallResult<{ users: MoodleUser[] }>> {
  return callMoodle<{ users: MoodleUser[] }>(
    'core_user_get_users',
    {
      'criteria[0][key]': 'email',
      'criteria[0][value]': '%'
    },
    'POST'
  );
}

export async function getMoodleEnrolledUsers(courseId: number): Promise<MoodleCallResult<MoodleUser[]>> {
  return callMoodle<MoodleUser[]>(
    'core_enrol_get_enrolled_users',
    {
      courseid: String(courseId)
    },
    'POST'
  );
}

/**
 * Profesores de un curso.
 *
 * Se filtra por el shortname del rol y no por el nombre visible, que depende
 * del idioma del sitio y se puede renombrar desde la administración.
 */
export async function getMoodleCourseTeachers(
  courseId: number
): Promise<Array<{ fullname?: string; email?: string }>> {
  const result = await getMoodleEnrolledUsers(courseId);
  if (!result.ok || !Array.isArray(result.data)) {
    return [];
  }
  const docentes = new Set(['editingteacher', 'teacher']);
  return (result.data as Array<MoodleUser & { roles?: Array<{ shortname?: string }> }>)
    .filter((user) => (user.roles ?? []).some((role) => docentes.has(role.shortname ?? '')))
    .map((user) => ({ fullname: user.fullname, email: user.email }));
}

export async function getMoodleCourseContents(courseId: number): Promise<MoodleCallResult<MoodleCourseSection[]>> {
  return callMoodle<MoodleCourseSection[]>(
    'core_course_get_contents',
    {
      courseid: String(courseId)
    },
    'POST'
  );
}

export async function updateMoodleUserStatus(input: {
  userId: number;
  suspended: boolean;
}): Promise<MoodleCallResult<unknown>> {
  return callMoodle<unknown>(
    'core_user_update_users',
    {
      'users[0][id]': String(input.userId),
      'users[0][suspended]': input.suspended ? '1' : '0'
    },
    'POST'
  );
}

export async function updateMoodleUserProfile(input: {
  userId: number;
  firstname: string;
  lastname: string;
  email: string;
  lang?: string;
}): Promise<MoodleCallResult<unknown>> {
  return callMoodle<unknown>(
    'core_user_update_users',
    {
      'users[0][id]': String(input.userId),
      'users[0][firstname]': input.firstname,
      'users[0][lastname]': input.lastname,
      'users[0][email]': input.email,
      'users[0][lang]': input.lang ?? 'es'
    },
    'POST'
  );
}

export async function updateMoodleActivityCompletion(input: {
  cmid: number;
  completed: boolean;
}): Promise<MoodleCallResult<unknown>> {
  return callMoodle<unknown>(
    'core_completion_update_activity_completion_status',
    {
      cmid: String(input.cmid),
      completed: input.completed ? '1' : '0'
    },
    'POST'
  );
}

export async function getMoodleActivitiesCompletionStatus(input: {
  courseId: number;
  userId: number;
}): Promise<MoodleCallResult<MoodleCompletionResponse>> {
  return callMoodle<MoodleCompletionResponse>(
    'core_completion_get_activities_completion_status',
    {
      courseid: String(input.courseId),
      userid: String(input.userId)
    },
    'POST'
  );
}

export async function createMoodleNote(input: {
  userId: number;
  courseId: number;
  text: string;
}): Promise<MoodleCallResult<Array<{ noteid?: number; id?: number }>>> {
  return callMoodle<Array<{ noteid?: number; id?: number }>>(
    'core_notes_create_notes',
    {
      'notes[0][userid]': String(input.userId),
      'notes[0][publishstate]': 'site',
      'notes[0][courseid]': String(input.courseId),
      'notes[0][text]': input.text,
      'notes[0][format]': '1'
    },
    'POST'
  );
}

export async function getMoodleNotes(input: {
  userId: number;
  courseId: number;
}): Promise<MoodleCallResult<MoodleNotesResponse>> {
  return callMoodle<MoodleNotesResponse>(
    'core_notes_get_notes',
    {
      'notes[0][userid]': String(input.userId),
      'notes[0][courseid]': String(input.courseId)
    },
    'POST'
  );
}

/**
 * Empuja las fechas de la malla a un curso de Moodle.
 *
 * Es la otra mitad de la regla de arquitectura del contrato: «las reglas de
 * apertura y cierre se configuran desde la plataforma y se propagan a Moodle;
 * el aula no se administra a mano». Aquí se escribe el inicio y el fin del
 * curso, y los plazos de cada foro y cada tarea semanal.
 *
 * Moodle no expone una función de web service para mover la fecha de una
 * actividad concreta, así que lo que sí se puede hacer por aquí es ajustar el
 * curso; las fechas de actividad las aplica el script CLI de la instancia,
 * que es el mismo camino por el que se crean. Esta función devuelve cuántas
 * fechas quedaron sincronizadas para que el panel lo informe sin mentir.
 */
export async function pushTermDatesToCourse(
  courseId: number,
  grid: { grid: { termStartsOn: string; termEndsOn: string }; revision: number } | null
): Promise<{ ok: boolean; updated: number; error?: string }> {
  if (!grid) {
    return { ok: false, updated: 0, error: 'No hay malla generada para este periodo' };
  }
  // Mediodía UTC para que la fecha civil no se desplace un día al convertir.
  const toEpoch = (civil: string) => Math.floor(Date.parse(`${civil}T12:00:00Z`) / 1000);

  const result = await callMoodle<unknown>(
    'core_course_update_courses',
    {
      'courses[0][id]': String(courseId),
      'courses[0][startdate]': String(toEpoch(grid.grid.termStartsOn)),
      'courses[0][enddate]': String(toEpoch(grid.grid.termEndsOn))
    },
    'POST'
  );

  if (!result.ok) {
    return { ok: false, updated: 0, error: result.error ?? 'Moodle rechazó la actualización' };
  }
  return { ok: true, updated: 2 };
}

/**
 * Publica el HTML de un sílabo dentro del course shell.
 *
 * Es el segundo de los tres destinos de la Cláusula 6. El contenido va al
 * resumen del curso (`summary`), que es lo único que el web service del núcleo
 * permite escribir: no hay función para editar el cuerpo de una página de
 * curso. El aula modelo deja además una página «Sílabo del curso» en la
 * sección cero como destino definitivo; el script CLI de la instancia es el
 * que la rellena, por el mismo camino por el que se crea.
 *
 * Se devuelve `placed: 'summary'` para que el panel pueda decir exactamente
 * dónde quedó, en vez de afirmar que está «en el aula» sin más.
 */
/**
 * Marcadores del bloque del sílabo dentro del resumen del curso.
 *
 * Existen para que republicar REEMPLACE el bloque en vez de acumular uno nuevo
 * cada vez, y para que la sincronización del catálogo pueda quitarlo del texto
 * comercial (lo hace `stripSyllabusBlock`, en db.ts).
 */
export const SYLLABUS_BLOCK_START = '<!-- tfu-silabo:inicio -->';
export const SYLLABUS_BLOCK_END = '<!-- tfu-silabo:fin -->';

/**
 * Quita el bloque del sílabo de un resumen de curso de Moodle.
 *
 * Se buscan dos marcas, y por una razón aprendida en producción: Moodle limpia
 * el HTML que entra por el servicio web y **borra los comentarios**, así que
 * los delimitadores `<!-- tfu-silabo:… -->` no sobreviven al viaje. Si sólo se
 * mirasen esos, cada republicación añadiría un bloque más en vez de sustituir
 * el anterior. La marca que sí sobrevive es la clase del contenedor.
 */
export function stripSyllabusBlock(summary: string): string {
  let out = summary;

  // 1. Delimitadores por comentario, para los resúmenes que los conserven.
  for (;;) {
    const start = out.indexOf(SYLLABUS_BLOCK_START);
    if (start === -1) break;
    const end = out.indexOf(SYLLABUS_BLOCK_END, start);
    out = out.slice(0, start) + (end === -1 ? '' : out.slice(end + SYLLABUS_BLOCK_END.length));
  }

  // 2. El contenedor por clase. El bloque no anida divs, así que el primer
  //    `</div>` posterior es el que lo cierra.
  for (;;) {
    const start = out.search(/<div[^>]*class="[^"]*tfu-silabo[^"]*"[^>]*>/i);
    if (start === -1) break;
    const close = out.indexOf('</div>', start);
    out = out.slice(0, start) + (close === -1 ? '' : out.slice(close + '</div>'.length));
  }

  return out.trim();
}

export type SyllabusPublication = {
  /** Enlace al HTML accesible, que es la versión canónica. */
  htmlUrl: string;
  /** Enlace al PDF etiquetado. Puede faltar si el servidor no tiene navegador. */
  pdfUrl?: string;
  version: number;
  publishedAt: string;
};

/**
 * Publica el sílabo en el course shell de Moodle.
 *
 * Lo que se escribe es un bloque con el enlace al sílabo accesible, no el
 * documento entero, y por dos razones.
 *
 * La primera es que el destino natural —la página «Sílabo» de la sección 0 que
 * dejan preparadas las aulas modelo— no se puede escribir desde aquí: el
 * servicio web de este Moodle expone 21 funciones y ninguna toca módulos ni
 * resúmenes de sección (`core_course_update_courses` sólo llega al curso), así
 * que rellenarla requiere el CLI de Moodle, es decir acceso de shell a esa
 * instancia. Queda apuntado en la guía de operación.
 *
 * La segunda es que copiar el documento duplicaría la fuente: el sílabo cambia
 * de versión, y una copia pegada en Moodle envejece sin avisar. El enlace
 * siempre resuelve a la versión vigente, en HTML accesible y en PDF etiquetado.
 *
 * El resumen del curso se preserva: se lee, se le quita el bloque anterior si
 * lo había y se vuelve a escribir con el nuevo al final. Antes esta función
 * sustituía el resumen completo por el HTML del sílabo, que borraba el texto
 * del catálogo.
 */
export async function publishSyllabusToCourse(
  courseId: number,
  publication: SyllabusPublication
): Promise<{ ok: boolean; placed?: string; error?: string }> {
  const current = await callMoodle<Array<{ id: number; summary?: string }>>(
    'core_course_get_courses',
    { 'options[ids][0]': String(courseId) },
    'POST'
  );
  if (!current.ok) {
    return { ok: false, error: current.error ?? 'No se pudo leer el curso en Moodle' };
  }
  const course = Array.isArray(current.data)
    ? current.data.find((item) => Number(item.id) === courseId)
    : undefined;
  if (!course) {
    return { ok: false, error: `Moodle no devolvió el curso ${courseId}` };
  }

  const base = stripSyllabusBlock(course.summary ?? '');
  const published = new Date(publication.publishedAt).toLocaleDateString('es-ES', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  const pdf = publication.pdfUrl
    ? ` · <a href="${publication.pdfUrl}">PDF etiquetado</a>`
    : '';
  const block = [
    SYLLABUS_BLOCK_START,
    '<div class="tfu-silabo">',
    '<h3>Sílabo del curso</h3>',
    `<p><a href="${publication.htmlUrl}">Sílabo accesible (HTML)</a>${pdf}</p>`,
    `<p><small>Versión ${publication.version} · publicado el ${published}</small></p>`,
    '</div>',
    SYLLABUS_BLOCK_END
  ].join('');

  const summary = base ? `${base}\n${block}` : block;
  const result = await callMoodle<unknown>(
    'core_course_update_courses',
    {
      'courses[0][id]': String(courseId),
      'courses[0][summary]': summary,
      'courses[0][summaryformat]': '1'
    },
    'POST'
  );
  if (!result.ok) {
    return { ok: false, error: result.error ?? 'Moodle rechazó la publicación del sílabo' };
  }
  return { ok: true, placed: 'bloque de enlace en el resumen del curso' };
}

