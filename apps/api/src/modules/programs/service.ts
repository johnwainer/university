import type { Pool } from 'pg';

/**
 * Programas para el sitio público.
 *
 * El programa es la unidad que se navega y en la que uno se matricula. Los
 * cursos viven dentro y no tienen página propia ni enlace.
 *
 * Decisión deliberada: este payload NO lleva el identificador de Moodle de los
 * cursos. La regla «no se ve ni se cursa un curso suelto» se aplica en el
 * servidor negando el contenido sin matrícula, pero si aquí viajara el id, el
 * front podría construir una ruta al curso y la interfaz volvería a ofrecer
 * justo lo que queremos quitar. Omitirlo lo hace imposible por construcción,
 * que es más robusto que confiar en que nadie lo use.
 */

export type CursoDelPrograma = {
  titulo: string;
  tituloEn: string | null;
  resumen: string | null;
  resumenEn: string | null;
  /** Número de módulos del aula, cuando se conoce. Nunca se inventa. */
  modulos: number | null;
};

export type ProgramaPublico = {
  id: string;
  kind: 'program';
  slug: string;
  code: string;
  title: string;
  titleEn: string | null;
  summary: string | null;
  summaryEn: string | null;
  heroImage: string | null;
  tags: string[];
  language: string;
  degreeLevel: string | null;
  creditHours: number | null;
  courseCount: number;
  courses: CursoDelPrograma[];
};

/** El código del programa en minúsculas es el slug público: TFU-SALES-EXC -> tfu-sales-exc. */
export function slugDePrograma(code: string): string {
  return code.toLowerCase();
}

const SQL_PROGRAMAS = `
  SELECT dp.id,
         dp.code,
         dp.name,
         dp.description,
         dp.degree_level,
         dp.credit_hours_required,
         COALESCE(
           json_agg(
             json_build_object(
               'moodleCourseId', mc.moodle_course_id,
               'payload', ca.payload,
               'orden', dr.sort_order,
               'fullName', mc.full_name
             )
             ORDER BY dr.sort_order, mc.moodle_course_id
           ) FILTER (WHERE mc.moodle_course_id IS NOT NULL),
           '[]'
         ) AS cursos
    FROM degree_programs dp
    LEFT JOIN degree_requirements dr
           ON dr.degree_program_id = dp.id
          AND dr.requirement_type = 'course'
          AND dr.moodle_course_id IS NOT NULL
    LEFT JOIN moodle_courses mc
           ON mc.moodle_course_id = dr.moodle_course_id
          AND mc.visible
    LEFT JOIN content_assets ca
           ON ca.payload->>'id' = 'moodle-course-' || mc.moodle_course_id::text
          AND ca.is_published
   WHERE dp.is_active
   GROUP BY dp.id, dp.code, dp.name, dp.description, dp.degree_level, dp.credit_hours_required
   ORDER BY dp.code
`;

type FilaCurso = {
  moodleCourseId: number | null;
  payload: Record<string, unknown> | null;
  orden: number | null;
  fullName: string | null;
};

function construirPrograma(fila: Record<string, any>): ProgramaPublico {
  const cursos: FilaCurso[] = Array.isArray(fila.cursos) ? fila.cursos : [];

  // La presentación (imagen y área) se toma del primer curso del programa,
  // que es de donde Moodle la trae. El nombre y la descripción NO: esos son
  // del registro del programa, que es el dato institucional autoritativo.
  const primero = cursos[0]?.payload ?? null;
  const tags: string[] = Array.isArray(primero?.tags)
    ? (primero!.tags as string[]).filter((t) => t !== 'Moodle')
    : [];

  return {
    id: `program-${fila.code}`,
    kind: 'program',
    slug: slugDePrograma(fila.code),
    code: fila.code,
    title: fila.name,
    titleEn: (primero?.titleEn as string | undefined) ?? null,
    summary: fila.description ?? null,
    summaryEn: (primero?.summaryEn as string | undefined) ?? null,
    heroImage: (primero?.heroImage as string | undefined) ?? null,
    tags,
    language: (primero?.language as string | undefined) ?? 'es',
    degreeLevel: fila.degree_level ?? null,
    creditHours: fila.credit_hours_required ?? null,
    courseCount: cursos.length,
    courses: cursos.map((c) => {
      const p = c.payload ?? {};
      return {
        titulo: (p.title as string | undefined) ?? c.fullName ?? '',
        tituloEn: (p.titleEn as string | undefined) ?? null,
        resumen: (p.summary as string | undefined) ?? null,
        resumenEn: (p.summaryEn as string | undefined) ?? null,
        // Si el aula aún no está montada, este dato no existe. Se devuelve
        // null en vez de un cero que parecería «un aula vacía».
        modulos: typeof p.modules === 'number' ? (p.modules as number) : null
      };
    })
  };
}

export async function listarProgramasPublicos(pool: Pool): Promise<ProgramaPublico[]> {
  const { rows } = await pool.query(SQL_PROGRAMAS);
  return rows.map(construirPrograma);
}

/**
 * Busca un programa por su slug.
 *
 * Acepta además el slug antiguo del curso (`moodle-pcl-sales-exc-12`), que es
 * el que quedó publicado en los alias del CDN y en cualquier enlace que ya
 * esté circulando. En vez de devolver un 404 que rompería esos enlaces, se
 * resuelve al programa que contiene ese curso.
 */
export async function buscarProgramaPorSlug(pool: Pool, slug: string): Promise<ProgramaPublico | null> {
  const limpio = slug.trim().toLowerCase();
  const todos = await listarProgramasPublicos(pool);

  const directo = todos.find((p) => p.slug === limpio);
  if (directo) return directo;

  const legado = limpio.match(/^moodle-pcl-(.+)-(\d+)$/);
  if (legado) {
    const porCodigo = todos.find((p) => p.slug === `tfu-${legado[1]}`);
    if (porCodigo) return porCodigo;
  }
  return null;
}

/**
 * Identificadores de Moodle de los cursos de un programa.
 *
 * Es lo que necesita la matrícula: matricular a alguien en un programa es
 * matricularlo en todos sus cursos. Se mantiene fuera del payload público a
 * propósito.
 */
export async function cursosDelPrograma(pool: Pool, programCode: string): Promise<number[]> {
  const { rows } = await pool.query(
    `SELECT dr.moodle_course_id
       FROM degree_requirements dr
       JOIN degree_programs dp ON dp.id = dr.degree_program_id
      WHERE dp.code = $1 AND dr.requirement_type = 'course' AND dr.moodle_course_id IS NOT NULL
      ORDER BY dr.sort_order, dr.moodle_course_id`,
    [programCode]
  );
  return rows.map((r) => Number(r.moodle_course_id));
}
