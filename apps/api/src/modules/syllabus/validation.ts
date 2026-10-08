/**
 * Validaciones que bloquean la publicación de un sílabo.
 *
 * La Cláusula 6 del contrato las enumera: suma de pesos igual a 100%, bloqueo
 * de componentes por encima del 30%, ningún CLO sin evaluación asociada, campo
 * obligatorio de IA, y mínimo de aprobación aplicado por nivel de curso.
 *
 * Por qué están aquí y no en la ruta: la misma función la usan el `PATCH` (que
 * devuelve los problemas mientras la facultad edita, sin impedir guardar) y el
 * `POST /publish` (que sí impide publicar). Si cada una comprobara por su
 * cuenta acabarían divergiendo, y la divergencia favorable siempre es la que
 * deja publicar algo que no debía.
 *
 * Un borrador INCOMPLETO es legítimo: se guarda con los problemas que tenga.
 * Lo que no se admite es publicarlo.
 */
import {
  AI_STANDARDS,
  ASSESSMENT_CATEGORIES,
  MASTER_SYLLABUS_SECTIONS,
  MAX_SINGLE_COMPONENT_WEIGHT,
  PASSING_MINIMUMS,
  type CourseLevel
} from './master-syllabus.js';

export type ValidationIssue = {
  /** Sección del Master Syllabus donde se arregla. */
  section: string;
  code: string;
  messageEs: string;
  messageEn: string;
  /** `blocking` impide publicar; `warning` no. */
  severity: 'blocking' | 'warning';
};

export type SyllabusContent = {
  [key: string]: unknown;
  learning_outcomes?: {
    outcomes?: Array<{ id?: string; text?: string; assessment?: string }>;
  };
  grading?: {
    weights?: Record<string, number>;
    courseLevel?: CourseLevel;
  };
  artificial_intelligence?: {
    standard?: string;
    guidance?: string;
  };
  instructor_information?: Record<string, unknown>;
  course_schedule?: { weeks?: Array<{ week?: number; topic?: string }> };
};

const AI_VALUES = AI_STANDARDS.map((item) => item.value) as readonly string[];
const CATEGORY_KEYS = ASSESSMENT_CATEGORIES.map((category) => category.key);

/**
 * Comprueba un sílabo completo. Devuelve TODOS los problemas, no sólo el
 * primero: a quien está rellenando el formulario no le sirve que le corrijan
 * de uno en uno.
 */
export function validateSyllabus(content: SyllabusContent): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // --- §3. Todo CLO necesita su evaluación principal. --------------------
  const outcomes = content.learning_outcomes?.outcomes ?? [];
  if (outcomes.length === 0) {
    issues.push({
      section: 'learning_outcomes',
      code: 'clo_missing',
      messageEs: 'El sílabo no declara ningún resultado de aprendizaje.',
      messageEn: 'The syllabus declares no learning outcomes.',
      severity: 'blocking'
    });
  }
  outcomes.forEach((outcome, index) => {
    const label = outcome.id ?? `CLO ${index + 1}`;
    if (!outcome.text || outcome.text.trim().length === 0) {
      issues.push({
        section: 'learning_outcomes',
        code: 'clo_empty_text',
        messageEs: `${label} está vacío.`,
        messageEn: `${label} is empty.`,
        severity: 'blocking'
      });
    }
    if (!outcome.assessment || outcome.assessment.trim().length === 0) {
      issues.push({
        section: 'learning_outcomes',
        code: 'clo_without_assessment',
        messageEs: `${label} no tiene evaluación asociada. El sílabo no se publica con un CLO sin evaluar.`,
        messageEn: `${label} has no associated assessment. The syllabus cannot be published with an unassessed CLO.`,
        severity: 'blocking'
      });
    }
  });

  // --- §7. Pesos de evaluación. ------------------------------------------
  const weights = content.grading?.weights ?? {};
  const declared = Object.entries(weights).filter(([, value]) => typeof value === 'number');

  if (declared.length === 0) {
    issues.push({
      section: 'grading',
      code: 'weights_missing',
      messageEs: 'No se han definido los pesos de evaluación.',
      messageEn: 'Assessment weights have not been defined.',
      severity: 'blocking'
    });
  } else {
    // Se suma con un entero de centésimas para no arrastrar el error de coma
    // flotante: 15 + 25 + 20 + 20 + 20 debe dar 100 exacto, y 0.1 + 0.2 no da
    // 0.3 en binario.
    const totalHundredths = declared.reduce((sum, [, value]) => sum + Math.round((value as number) * 100), 0);
    if (totalHundredths !== 10000) {
      const total = totalHundredths / 100;
      issues.push({
        section: 'grading',
        code: 'weights_not_100',
        messageEs: `Los pesos suman ${total}%, y tienen que sumar 100%.`,
        messageEn: `Weights add up to ${total}%, and must total 100%.`,
        severity: 'blocking'
      });
    }

    for (const [key, value] of declared) {
      const weight = value as number;
      if (weight < 0) {
        issues.push({
          section: 'grading',
          code: 'weight_negative',
          messageEs: `El peso de «${key}» es negativo.`,
          messageEn: `The weight for "${key}" is negative.`,
          severity: 'blocking'
        });
      }
      if (weight > MAX_SINGLE_COMPONENT_WEIGHT) {
        issues.push({
          section: 'grading',
          code: 'weight_over_cap',
          messageEs: `«${key}» pesa ${weight}%, por encima del tope institucional del ${MAX_SINGLE_COMPONENT_WEIGHT}% para una sola pieza de evaluación.`,
          messageEn: `"${key}" is weighted ${weight}%, above the institutional cap of ${MAX_SINGLE_COMPONENT_WEIGHT}% for a single evaluation piece.`,
          severity: 'blocking'
        });
      }
      if (!CATEGORY_KEYS.includes(key as (typeof CATEGORY_KEYS)[number])) {
        // Aviso y no bloqueo: la §7 permite ajustar «alrededor de las
        // barandillas», y una categoría propia del curso cabe en eso mientras
        // la suma y el tope se respeten.
        issues.push({
          section: 'grading',
          code: 'weight_unknown_category',
          messageEs: `«${key}» no es una categoría del Master Syllabus. Se admite, pero conviene revisarlo.`,
          messageEn: `"${key}" is not a Master Syllabus category. It is allowed, but worth reviewing.`,
          severity: 'warning'
        });
      }
    }
  }

  // --- §7. Nivel del curso, que fija el mínimo de aprobación. ------------
  const level = content.grading?.courseLevel;
  if (!level) {
    issues.push({
      section: 'grading',
      code: 'course_level_missing',
      messageEs: 'Falta el nivel del curso. Es lo que determina el mínimo de aprobación que aplica el sistema.',
      messageEn: 'The course level is missing. It determines the passing minimum the system applies.',
      severity: 'blocking'
    });
  } else if (!(level in PASSING_MINIMUMS)) {
    issues.push({
      section: 'grading',
      code: 'course_level_invalid',
      messageEs: `«${level}» no es un nivel de curso válido.`,
      messageEn: `"${level}" is not a valid course level.`,
      severity: 'blocking'
    });
  }

  // --- §14. Estándar de IA, lista cerrada y obligatorio. -----------------
  const aiStandard = content.artificial_intelligence?.standard;
  if (!aiStandard) {
    issues.push({
      section: 'artificial_intelligence',
      code: 'ai_standard_missing',
      messageEs: 'Falta el estándar de IA del curso. Sin ese campo el sílabo no se publica.',
      messageEn: 'The course AI standard is missing. The syllabus cannot be published without it.',
      severity: 'blocking'
    });
  } else if (!AI_VALUES.includes(aiStandard)) {
    issues.push({
      section: 'artificial_intelligence',
      code: 'ai_standard_invalid',
      messageEs: `«${aiStandard}» no está en la lista cerrada de estándares de IA.`,
      messageEn: `"${aiStandard}" is not in the closed list of AI standards.`,
      severity: 'blocking'
    });
  }

  // --- §1. Información del instructor. -----------------------------------
  const instructor = content.instructor_information ?? {};
  for (const field of ['name', 'email'] as const) {
    const value = instructor[field];
    if (typeof value !== 'string' || value.trim().length === 0) {
      issues.push({
        section: 'instructor_information',
        code: `instructor_${field}_missing`,
        messageEs: `Falta ${field === 'name' ? 'el nombre' : 'el correo'} del instructor.`,
        messageEn: `The instructor ${field} is missing.`,
        severity: 'blocking'
      });
    }
  }

  // --- §8. La malla de ocho semanas. -------------------------------------
  const weeks = content.course_schedule?.weeks ?? [];
  if (weeks.length > 0 && weeks.length !== 8) {
    issues.push({
      section: 'course_schedule',
      code: 'schedule_not_eight_weeks',
      messageEs: `El calendario tiene ${weeks.length} semanas y el término de TFU es de ocho.`,
      messageEn: `The schedule has ${weeks.length} weeks; a TFU term runs eight.`,
      severity: 'blocking'
    });
  }
  const sinTema = weeks.filter((week) => !week.topic || week.topic.trim().length === 0).length;
  if (sinTema > 0) {
    issues.push({
      section: 'course_schedule',
      code: 'schedule_week_without_topic',
      messageEs: `${sinTema} semana(s) del calendario no tienen tema.`,
      messageEn: `${sinTema} week(s) in the schedule have no topic.`,
      severity: 'warning'
    });
  }

  // --- Secciones estructuradas que la facultad dejó en blanco. -----------
  for (const section of MASTER_SYLLABUS_SECTIONS) {
    if (section.treatment !== 'faculty') {
      continue;
    }
    const value = content[section.key];
    const empty =
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim().length === 0);
    if (empty) {
      issues.push({
        section: section.key,
        code: 'faculty_section_empty',
        messageEs: `La sección ${section.number}, «${section.labelEs}», está vacía.`,
        messageEn: `Section ${section.number}, "${section.labelEn}", is empty.`,
        severity: 'warning'
      });
    }
  }

  return issues;
}

export function blockingIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.filter((issue) => issue.severity === 'blocking');
}

export function canPublish(content: SyllabusContent): boolean {
  return blockingIssues(validateSyllabus(content)).length === 0;
}

/**
 * Mínimo de aprobación que aplica el sistema según el nivel del curso.
 *
 * Resuelve automáticamente la discrepancia que la Cláusula 8 del contrato
 * dejaba abierta: la escala de la §7 admite la C como nota válida, pero el
 * mínimo de posgrado es B. No son contradictorias —la escala describe las
 * notas, el mínimo describe la aprobación— y la que manda depende del nivel.
 */
export function passingMinimum(level: CourseLevel | undefined): string | null {
  if (!level || !(level in PASSING_MINIMUMS)) {
    return null;
  }
  return PASSING_MINIMUMS[level];
}
