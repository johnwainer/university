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
