/**
 * Master Syllabus TFU — modelo de datos de las 24 secciones.
 *
 * La Cláusula 2 del contrato pone este documento POR ENCIMA de cualquier
 * descripción general de la propuesta: lo que diga aquí manda. Importa porque
 * el resumen de la Cláusula 7 nombra las tres fechas límite semanales sin decir
 * en qué día caen, y la §10 del Master Syllabus sí lo dice —y no coincide con
 * lo que se supondría—: la respuesta inicial es el MARTES y la respuesta a
 * compañeros el JUEVES, no jueves y sábado.
 *
 * Cada sección se clasifica en uno de los tres tratamientos de la Cláusula 6:
 *
 *   institutional  Texto heredado, no editable por el docente. Una edición a
 *                  nivel institución se propaga a todos los sílabos vigentes.
 *   faculty        Campo libre que la facultad redacta por curso.
 *   structured     Campo con forma y validación automática previa a publicar.
 *
 * Las reglas que BLOQUEAN la publicación viven en `validation.ts`; aquí sólo
 * está la forma del documento.
 */

export type SectionTreatment = 'institutional' | 'faculty' | 'structured';

export type MasterSection = {
  /** Número de sección tal y como aparece en el documento de TFU. */
  number: number;
  key: string;
  labelEs: string;
  labelEn: string;
  treatment: SectionTreatment;
  /** Guía corta para la facultad; no se publica. */
  helpEs?: string;
  /** Contenido heredado, sólo para secciones institucionales. */
  institutionalEs?: string;
  institutionalEn?: string;
  /** Forma esperada del dato, sólo para secciones estructuradas. */
  shape?:
    | 'instructor'
    | 'clo_matrix'
    | 'assessment_weights'
    | 'grading_scale'
    | 'course_schedule'
    | 'ai_standard'
    | 'resources'
    | 'acknowledgment';
};

/**
 * Pesos institucionales de la §7. Son el punto de partida de todo sílabo; la
 * facultad puede moverlos "alrededor de las barandillas de este calendario
 * maestro", pero la suma sigue teniendo que dar 100 y ninguna pieza puede
 * pasar del 30%.
 */
export const ASSESSMENT_CATEGORIES = [
  { key: 'discussions', labelEs: 'Discusiones semanales y participación, incluidas las reflexiones', labelEn: 'Weekly Discussions and Participation, including reflections', defaultWeight: 15 },
  { key: 'assignments', labelEs: 'Asignaciones individuales', labelEn: 'Individual Assignments', defaultWeight: 25 },
  { key: 'quizzes', labelEs: 'Cuestionarios o exámenes', labelEn: 'Quizzes or Examinations', defaultWeight: 20 },
  { key: 'applied_project', labelEs: 'Proyecto aplicado o estudio de caso', labelEn: 'Applied Project or Case Study', defaultWeight: 20 },
  { key: 'final', labelEs: 'Proyecto final, examen o presentación', labelEn: 'Final Project, Examination, or Presentation', defaultWeight: 20 }
] as const;

/** §7. Escala institucional. No es editable por la facultad. */
export const GRADING_SCALE = [
  { letter: 'A', min: 90, max: 100, points: 4.0 },
  { letter: 'B', min: 80, max: 89, points: 3.0 },
  { letter: 'C', min: 70, max: 79, points: 2.0 },
  { letter: 'D', min: 60, max: 69, points: 1.0 },
  { letter: 'F', min: 0, max: 59, points: 0.0 }
] as const;

/**
 * §7. Mínimo de aprobación por nivel de curso. El sistema lo aplica
 * automáticamente: es lo que resuelve la discrepancia que la Cláusula 8 del
 * contrato dejaba abierta entre la C como nota válida de la escala y la B como
 * mínimo de posgrado.
 */
export const PASSING_MINIMUMS = {
  undergraduate: 'D',
  graduate: 'B',
  transfer_undergraduate: 'C',
  transfer_graduate: 'B'
} as const;

export type CourseLevel = keyof typeof PASSING_MINIMUMS;

/** §7. GPA mínimo de graduación por tipo de programa. */
export const GRADUATION_GPA = { undergraduate: 2.0, master: 3.0 } as const;

/** Tope institucional: ninguna pieza de evaluación pasa de este porcentaje. */
export const MAX_SINGLE_COMPONENT_WEIGHT = 30;

/** §14. Lista cerrada. Sin este campo el sílabo no se publica. */
export const AI_STANDARDS = [
  { value: 'permitted', labelEs: 'Permitido', labelEn: 'Permitted' },
  { value: 'permitted_with_restrictions', labelEs: 'Permitido con restricciones', labelEn: 'Permitted with restrictions' },
  { value: 'not_permitted', labelEs: 'No permitido', labelEn: 'Not permitted' }
] as const;

/**
 * §8 y §10. Cadencia del aula, en un solo sitio, porque la consume tanto el
 * sílabo como el motor de calendario.
 *
 * `dayOffset` cuenta desde el martes de inicio de la semana (0 = martes).
 */
export const WEEKLY_CADENCE = {
  /** La semana lectiva va de martes 00:00 a lunes 23:59, hora del Este. */
  weekStartsOn: 2 as const, // martes, en la convención de Date.getDay()
  timezone: 'America/New_York',
  closingTime: { hour: 23, minute: 59 },
  deadlines: [
    { key: 'initial_post', dayOffset: 0, labelEs: 'Respuesta inicial a la discusión', labelEn: 'Initial discussion response' },
    { key: 'peer_response', dayOffset: 2, labelEs: 'Respuestas a compañeros', labelEn: 'Responses to classmates' },
    { key: 'weekly_assignment', dayOffset: 6, labelEs: 'Entrega semanal', labelEn: 'Weekly assignment' }
  ],
  /** El alumno ve la semana entrante a partir del viernes anterior. */
  nextWeekOpensOn: { dayOffset: 3, hour: 0, minute: 0 },
  /** §8: el aula debe estar lista el jueves a las 10:00, antes del martes. */
  shellReadyCheckpoint: { dayOffsetBeforeStart: -5, hour: 10, minute: 0 },
  /** §9: mínimo de publicaciones públicas por semana para contar asistencia. */
  minimumPublicPostsPerWeek: 3,
  /** §10: longitudes exigidas. */
  wordCounts: { originalPostMin: 100, originalPostMax: 150, responseMin: 50, responseMax: 100, absoluteMax: 150 }
} as const;

/** §8. Secciones fijas del course shell, en su orden. */
export const COURSE_SHELL_SECTIONS = [
  { key: 'discussion_forum', labelEs: 'Foro de discusión', labelEn: 'Discussion Forum', countsAsAttendance: true },
  { key: 'submission', labelEs: 'Entregas', labelEn: 'Submission', countsAsAttendance: true },
  { key: 'checkup_reflection', labelEs: 'Punto de control y reflexión', labelEn: 'Checkup Point & Reflection', countsAsAttendance: true },
  { key: 'learning_resources', labelEs: 'Recursos de aprendizaje', labelEn: 'Learning Resources', countsAsAttendance: false },
  { key: 'contact', labelEs: 'Contacto', labelEn: 'Contact', countsAsAttendance: false }
] as const;

/** §6. Estructura de asignaciones del término. */
export const ASSIGNMENT_RULES = {
  totalPerCourse: 8,
  focusedOnCourseMaterial: { min: 4, max: 6 },
  week1: 'student_bios',
  week8: 'final_reflection',
  /** La pieza más exigente no se asigna más tarde del lunes de la semana 7. */
  heaviestAssignmentLatestWeek: 7
} as const;

const POLICY_URL = (slug: string) => `https://portal.thefloridianuniversity.com/${slug}`;

/**
 * Las 24 secciones.
 *
 * El texto institucional que se hereda está resumido respecto del documento de
 * TFU: lo que se guarda aquí es la versión que se publica al estudiante, y la
 * institución la edita desde el panel sin desplegar. Las secciones 12 a 22 son
 * bloques heredados que no edita la facultad, tal y como fija la Cláusula 6.
 */
export const MASTER_SYLLABUS_SECTIONS: MasterSection[] = [
  {
    number: 1,
    key: 'instructor_information',
    labelEs: 'Información del instructor',
    labelEn: 'Instructor Information',
    treatment: 'structured',
    shape: 'instructor',
    helpEs:
      'Se autocompleta desde el expediente de faculty del repositorio de compliance: nombre y credenciales, correo TFU, horario de oficina con zona horaria y enlace de reserva, tiempo típico de respuesta y biografía.'
  },
  {
    number: 2,
    key: 'course_description',
    labelEs: 'Descripción del curso',
    labelEn: 'Course Description',
    treatment: 'institutional',
    helpEs: 'Se hereda del catálogo institucional, en solo lectura. Debe coincidir literalmente con el catálogo.'
  },
  {
    number: 3,
    key: 'learning_outcomes',
    labelEs: 'Resultados de aprendizaje, competencias y alineación de evaluación',
    labelEn: 'Learning Outcomes, Competencies, and Assessment Alignment',
    treatment: 'structured',
    shape: 'clo_matrix',
    helpEs:
      'Lista repetible de resultados medibles. Cada CLO necesita su evaluación principal asociada; si alguno queda sin ella, el sílabo no se publica.'
  },
  {
    number: 4,
    key: 'instructional_methods',
    labelEs: 'Métodos de instrucción',
    labelEn: 'Instructional Methods',
    treatment: 'institutional',
    institutionalEs:
      '<p>Todos los cursos de TFU usan un formato en línea asincrónico que da flexibilidad a adultos que trabajan. La facultad y los estudiantes pueden además programar sesiones sincrónicas no obligatorias para reunirse, crear red y discutir temas relevantes. Se recomienda al menos una sesión sincrónica por curso.</p>',
    institutionalEn:
      '<p>All TFU courses use an online, asynchronous format to provide working adults with flexibility. Faculty and learners are also encouraged to schedule non-required synchronous sessions to meet, network, and discuss important topics. At least one synchronous session should be scheduled per course.</p>'
  },
  {
    number: 5,
    key: 'learning_resources',
    labelEs: 'Recursos de aprendizaje',
    labelEn: 'Learning Resources',
    treatment: 'structured',
    shape: 'resources',
    helpEs: 'Bloque obligatorio de bibliografía y tecnología requerida, con selección institucional más las adiciones propias del curso.'
  },
  {
    number: 6,
    key: 'assignments',
    labelEs: 'Asignaciones y evaluaciones del curso',
    labelEn: 'Course Assignments and Assessments',
    treatment: 'institutional',
    institutionalEs:
      '<p>Cada curso tiene 8 asignaciones en total, de las cuales entre 4 y 6 se centran en el material del curso. En la semana 1 la biografía del estudiante cuenta como asignación; en la semana 8 cuenta la reflexión final. La pieza más exigente no se asigna más tarde del lunes a las 11:59 p.m. de la semana 7.</p>',
    institutionalEn:
      '<p>There are 8 assignments in total for each course, of which 4 to 6 focus on course material. For Week 1, student bios count as the assignment; for Week 8, the Final Reflection counts. The most robust assignment is not assigned later than Monday, 11:59 PM of Week 7.</p>'
  },
  {
    number: 7,
    key: 'grading',
    labelEs: 'Calificación y evaluación',
    labelEn: 'Grading and Evaluation',
    treatment: 'structured',
    shape: 'assessment_weights',
    helpEs:
      'Los pesos parten de los institucionales y pueden ajustarse, pero la suma tiene que dar 100% y ninguna pieza puede superar el 30%. La escala y los mínimos de aprobación no son editables.'
  },
  {
    number: 8,
    key: 'course_schedule',
    labelEs: 'Calendario del curso',
    labelEn: 'Course Schedule',
    treatment: 'structured',
    shape: 'course_schedule',
    helpEs:
      'Malla de ocho semanas con tema, lecturas y actividades. La genera el calendario académico a partir de la fecha de inicio del término; la facultad rellena tema y lecturas.'
  },
  {
    number: 9,
    key: 'attendance',
    labelEs: 'Asistencia del estudiante',
    labelEn: 'Learner Attendance',
    treatment: 'institutional',
    institutionalEs:
      '<p>La asistencia en un curso en línea se demuestra con actividad académica, no con el mero ingreso al LMS. Se esperan al menos tres publicaciones públicas por semana. Los mensajes directos al profesor o a otros estudiantes no cuentan para la asistencia.</p><p>Cuentan como actividad académica: responder la pregunta de discusión, responder a compañeros, entregar una asignación, participar sustantivamente en una discusión académica, completar un cuestionario o examen, participar en una actividad dirigida por el instructor, realizar un tutorial o simulación asignados, y participar en una sesión sincrónica.</p>',
    institutionalEn:
      '<p>Attendance in an online course is demonstrated through academically related activity rather than merely logging into the LMS. Learners should have at least three public posts per week to be present. Direct messages to the instructor or other learners do not count toward attendance.</p><p>Activities counting as attendance include: answering the discussion question, responding to classmates, submitting an assignment, participating substantively in an academic discussion, completing a quiz or examination, participating in an instructor-led academic activity, engaging in an assigned tutorial or simulation, and participating in a synchronous session.</p>'
  },
  {
    number: 10,
    key: 'participation',
    labelEs: 'Expectativas de participación semanal',
    labelEn: 'Weekly Participation Expectations',
    treatment: 'institutional',
    institutionalEs:
      '<p>Salvo indicación contraria: la semana lectiva comienza el martes a las 12:00 a.m. y termina el lunes a las 11:59 p.m., hora del Este. Las respuestas iniciales a la discusión vencen el martes a las 11:59 p.m. Las respuestas a compañeros vencen el jueves a las 11:59 p.m. Las entregas semanales vencen el lunes a las 11:59 p.m.</p><p>Se exigen al menos 3 publicaciones públicas por semana. La publicación original debe tener entre 100 y 150 palabras; las respuestas, entre 50 y 100, con un máximo de 150.</p><p>Una contribución sustantiva hace avanzar la conversación académica: aplica conceptos del curso, analiza evidencia, aporta ejemplos, formula preguntas pertinentes o responde de forma constructiva a otro estudiante. Debe integrar teoría y experiencia, incluir ejemplos concretos, mantenerse en el tema, cuidar ortografía y tono profesional, y citar las fuentes en formato APA cuando corresponda.</p>',
    institutionalEn:
      '<p>Unless otherwise stated: the instructional week begins Tuesday at 12:00 AM and ends Monday at 11:59 PM, Eastern time. Initial discussion responses are due Tuesday by 11:59 PM. Responses to classmates are due Thursday by 11:59 PM. Weekly assignments are due Monday by 11:59 PM.</p><p>Learners must post publicly at least 3 times each week. The original post must be 100 to 150 words; responses, 50 to 100 words, with a maximum of 150.</p><p>A substantive contribution advances the academic conversation: it applies course concepts, analyzes evidence, provides examples, asks relevant questions, or constructively responds to another learner. It should integrate theory and experience, include specific examples, stay on topic, demonstrate proper spelling and professional tone, and cite sources in APA format where appropriate.</p>'
  },
  {
    number: 11,
    key: 'late_work',
    labelEs: 'Trabajo tardío y evaluaciones no presentadas',
    labelEn: 'Late Work and Missed Assessments',
    treatment: 'institutional'
  },
  {
    number: 12,
    key: 'submission_standards',
    labelEs: 'Normas de entrega',
    labelEn: 'Assignment Submission Standards',
    treatment: 'institutional'
  },
  {
    number: 13,
    key: 'academic_integrity',
    labelEs: 'Integridad académica',
    labelEn: 'Academic Integrity',
    treatment: 'institutional'
  },
  {
    number: 14,
    key: 'artificial_intelligence',
    labelEs: 'Uso de inteligencia artificial',
    labelEn: 'Use of Artificial Intelligence',
    treatment: 'structured',
    shape: 'ai_standard',
    helpEs:
      'El bloque institucional es fijo. La facultad debe elegir el estándar del curso —permitido, permitido con restricciones o no permitido— y añadir la guía por asignación. Sin ese campo el sílabo no se publica.',
    institutionalEs:
      '<p><strong>Usos permitidos.</strong> Salvo prohibición en una asignación concreta, se pueden usar herramientas de IA aprobadas para lluvia de ideas, esquemas preliminares, revisión de lenguaje, exploración de explicaciones alternativas, generación de preguntas de práctica, organización de ideas e investigación de fuentes.</p><p><strong>Usos restringidos.</strong> No se puede usar IA para completar una asignación destinada a medir conocimiento individual, generar trabajo final y presentarlo como propio, fabricar fuentes, citas, datos o hallazgos, completar cuestionarios o exámenes, suplantar al estudiante, ni cargar información confidencial o personal en sistemas no autorizados.</p><p>Cuando el uso de IA está permitido, debe declararse y citarse según las instrucciones del instructor. El estudiante sigue siendo responsable de la exactitud, originalidad, uso ético y calidad de todo el trabajo entregado.</p>',
    institutionalEn:
      '<p><strong>Permitted uses.</strong> Unless prohibited for a specific assignment, learners may use approved AI tools for brainstorming, preliminary outlines, language feedback, exploring alternative explanations, generating practice questions, organizing ideas, and researching sources.</p><p><strong>Restricted uses.</strong> Learners may not use AI to complete an assignment intended to measure individual knowledge, generate final work and represent it as entirely their own, fabricate sources, quotations, data or findings, complete quizzes or examinations, impersonate the learner, or upload confidential or personally identifiable information into an unauthorized system.</p><p>Where AI use is permitted, learners must disclose and cite it per the instructor\'s instructions. The learner remains responsible for the accuracy, originality, ethical use, and quality of all submitted work.</p>'
  },
  {
    number: 15,
    key: 'identity_verification',
    labelEs: 'Verificación de identidad y seguridad de la evaluación',
    labelEn: 'Identity Verification and Assessment Security',
    treatment: 'institutional'
  },
  {
    number: 16,
    key: 'netiquette',
    labelEs: 'Comunicación profesional y netiqueta',
    labelEn: 'Professional Communication and Netiquette',
    treatment: 'institutional'
  },
  {
    number: 17,
    key: 'accessibility',
    labelEs: 'Accesibilidad y ajustes razonables',
    labelEn: 'Accessibility and Reasonable Accommodations',
    treatment: 'institutional'
  },
  {
    number: 18,
    key: 'learner_support',
    labelEs: 'Apoyo académico y al estudiante',
    labelEn: 'Academic and Learner Support',
    treatment: 'institutional'
  },
  {
    number: 19,
    key: 'library',
    labelEs: 'Biblioteca y expectativas de investigación',
    labelEn: 'Library and Research Expectations',
    treatment: 'institutional'
  },
  {
    number: 20,
    key: 'copyright',
    labelEs: 'Derechos de autor y materiales del curso',
    labelEn: 'Copyright and Course Materials',
    treatment: 'institutional'
  },
  {
    number: 21,
    key: 'privacy_recording',
    labelEs: 'Privacidad y grabación',
    labelEn: 'Privacy and Recording',
    treatment: 'institutional'
  },
  {
    number: 22,
    key: 'institutional_policies',
    labelEs: 'Políticas institucionales',
    labelEn: 'Institutional Policies',
    treatment: 'institutional',
    institutionalEs: `<p>Aplican las políticas institucionales vigentes de TFU, disponibles en el portal: <a href="${POLICY_URL('terminos')}">términos y condiciones</a>, <a href="${POLICY_URL('privacidad')}">privacidad</a>, <a href="${POLICY_URL('ferpa')}">aviso FERPA</a>, <a href="${POLICY_URL('title-ix')}">Título IX</a> y <a href="${POLICY_URL('accesibilidad')}">accesibilidad</a>.</p>`,
    institutionalEn: `<p>TFU's current institutional policies apply, available on the portal: <a href="${POLICY_URL('terminos')}">terms and conditions</a>, <a href="${POLICY_URL('privacidad')}">privacy</a>, <a href="${POLICY_URL('ferpa')}">FERPA notice</a>, <a href="${POLICY_URL('title-ix')}">Title IX</a> and <a href="${POLICY_URL('accesibilidad')}">accessibility</a>.</p>`
  },
  {
    number: 23,
    key: 'right_to_modify',
    labelEs: 'Derecho del instructor y de la institución a modificar',
    labelEn: 'Instructor and Institutional Right to Modify',
    treatment: 'institutional',
    institutionalEs:
      '<p>El instructor puede ajustar actividades, lecturas y fechas cuando sea necesario para el aprendizaje, notificando a los estudiantes. No pueden modificarse sin aprobación institucional: el título o la descripción aprobados del curso, las horas crédito, las competencias requeridas, los resultados de aprendizaje, la escala de calificación ni las políticas institucionales. Los cambios curriculares de fondo requieren revisión y aprobación por el proceso de gobierno académico de TFU.</p>',
    institutionalEn:
      '<p>The instructor may adjust activities, readings and dates where necessary for learning, with notice to learners. The following may not be modified without institutional approval: the approved course title or description, credit hours, required competencies, course learning outcomes, the grading scale, and institutional policies. Material curricular changes require review and approval through TFU\'s academic governance process.</p>'
  },
  {
    number: 24,
    key: 'learner_acknowledgment',
    labelEs: 'Acuse del estudiante',
    labelEn: 'Learner Acknowledgment',
    treatment: 'structured',
    shape: 'acknowledgment',
    helpEs:
      'Al permanecer matriculado y participar, el estudiante acusa haber revisado el sílabo, el compromiso de ética e integridad, el calendario del curso y los anuncios del LMS. Cada acuse queda registrado en el log de accesos FERPA.',
    institutionalEs:
      '<p>Al permanecer matriculado y participar en este curso, el estudiante reconoce su responsabilidad de revisar: este sílabo, el compromiso de ética e integridad académica, el calendario del curso y los anuncios del LMS.</p>',
    institutionalEn:
      '<p>By remaining enrolled and participating in this course, the learner acknowledges responsibility for reviewing: this syllabus, the Learner Ethics and Academic Integrity Pledge, the course schedule, and LMS announcements.</p>'
  }
];

/** Las secciones que la facultad no puede tocar, para la UI y la validación. */
export const LOCKED_SECTION_KEYS = MASTER_SYLLABUS_SECTIONS.filter(
  (section) => section.treatment === 'institutional'
).map((section) => section.key);

export function masterSection(key: string): MasterSection | undefined {
  return MASTER_SYLLABUS_SECTIONS.find((section) => section.key === key);
}
