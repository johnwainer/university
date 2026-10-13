/**
 * Escala de calificación y registro de notas.
 *
 * Antes de esto la nota no existía en ninguna parte del sistema. La columna
 * `student_enrollments.grade` estaba declarada desde el principio y no tenía un
 * solo escritor: ni ruta de API, ni pantalla de panel, ni sincronización. Y no
 * se puede traer del libro de calificaciones de Moodle porque de las 21
 * funciones que expone el servicio web de esta instalación ninguna es
 * `gradereport_*`. Así que la nota se registra aquí, en la plataforma, y Moodle
 * sigue siendo donde ocurre el trabajo del aula.
 *
 * SOBRE LA ESCALA — esto es importante y está pendiente del lado de TFU.
 * La que sigue es la escala estadounidense estándar de 4,0. **TFU todavía no ha
 * confirmado la suya**, igual que no ha confirmado el nivel ni los créditos de
 * los trece programas. No se inventa una escala «de TFU»: se usa la estándar,
 * se dice que es la estándar, y el panel lo muestra como tal para que nadie la
 * tome por aprobada. Cuando TFU confirme la suya se cambia aquí, en un solo
 * sitio.
 *
 * Las marcas no punitivas (I, W, P, NP) no llevan puntos: entran en el
 * expediente pero quedan fuera del promedio. El cálculo del promedio ya
 * descartaba los `grade_points` nulos, así que basta con no ponerles valor.
 */

/** Una entrada de la escala: la letra, sus puntos y si cuenta para el promedio. */
export interface NotaDeEscala {
  letra: string;
  puntos: number | null;
  /** Una nota sin puntos entra en el expediente y no en el promedio. */
  cuentaParaPromedio: boolean;
  /** Si cerrar la matrícula con esta nota la deja como cursada y aprobada. */
  completa: boolean;
  descripcionEs: string;
  descripcionEn: string;
}

/**
 * Escala estándar de 4,0 con tercios (A-, B+, …), más las marcas no punitivas.
 * Pendiente de que TFU confirme la suya.
 */
export const ESCALA_ESTANDAR_4_0: NotaDeEscala[] = [
  { letra: 'A',  puntos: 4.0, cuentaParaPromedio: true,  completa: true,  descripcionEs: 'Excelente',              descripcionEn: 'Excellent' },
  { letra: 'A-', puntos: 3.7, cuentaParaPromedio: true,  completa: true,  descripcionEs: 'Excelente',              descripcionEn: 'Excellent' },
  { letra: 'B+', puntos: 3.3, cuentaParaPromedio: true,  completa: true,  descripcionEs: 'Notable',                descripcionEn: 'Good' },
  { letra: 'B',  puntos: 3.0, cuentaParaPromedio: true,  completa: true,  descripcionEs: 'Notable',                descripcionEn: 'Good' },
  { letra: 'B-', puntos: 2.7, cuentaParaPromedio: true,  completa: true,  descripcionEs: 'Notable',                descripcionEn: 'Good' },
  { letra: 'C+', puntos: 2.3, cuentaParaPromedio: true,  completa: true,  descripcionEs: 'Suficiente',             descripcionEn: 'Satisfactory' },
  { letra: 'C',  puntos: 2.0, cuentaParaPromedio: true,  completa: true,  descripcionEs: 'Suficiente',             descripcionEn: 'Satisfactory' },
  { letra: 'C-', puntos: 1.7, cuentaParaPromedio: true,  completa: false, descripcionEs: 'Suficiente, no aprueba', descripcionEn: 'Satisfactory, not passing' },
  { letra: 'D',  puntos: 1.0, cuentaParaPromedio: true,  completa: false, descripcionEs: 'Deficiente',             descripcionEn: 'Poor' },
  { letra: 'F',  puntos: 0.0, cuentaParaPromedio: true,  completa: false, descripcionEs: 'Reprobado',              descripcionEn: 'Failing' },
  { letra: 'P',  puntos: null, cuentaParaPromedio: false, completa: true,  descripcionEs: 'Aprobado sin nota',     descripcionEn: 'Pass' },
  { letra: 'NP', puntos: null, cuentaParaPromedio: false, completa: false, descripcionEs: 'No aprobado sin nota',  descripcionEn: 'No pass' },
  { letra: 'I',  puntos: null, cuentaParaPromedio: false, completa: false, descripcionEs: 'Incompleto',            descripcionEn: 'Incomplete' },
  { letra: 'W',  puntos: null, cuentaParaPromedio: false, completa: false, descripcionEs: 'Retirado',              descripcionEn: 'Withdrawn' }
];

export const LETRAS_VALIDAS = ESCALA_ESTANDAR_4_0.map((n) => n.letra);

/**
 * Las letras con las que el curso queda aprobado.
 *
 * Existe aparte del estado de la matrícula porque son dos preguntas distintas
 * y confundirlas producía un dato falso: `status = 'completed'` significa que el
 * curso TERMINÓ, y una `F` también termina el curso. Lo que decide si el
 * requisito del programa queda cumplido y si los créditos se ganan es si la
 * nota aprueba, y eso es esto. Con la tabla vacía de notas el error no se veía;
 * en cuanto se registra la primera `F` sí se vería.
 */
export const LETRAS_APROBATORIAS = ESCALA_ESTANDAR_4_0.filter((n) => n.completa).map((n) => n.letra);

/** Si una nota aprueba el curso. Una matrícula sin nota todavía no aprueba. */
export function esAprobatoria(letra: string | null | undefined): boolean {
  if (!letra) return false;
  return LETRAS_APROBATORIAS.includes(letra.trim().toUpperCase());
}

/** Busca una letra en la escala. Devuelve null si no está. */
export function notaDeEscala(letra: string): NotaDeEscala | null {
  const normalizada = letra.trim().toUpperCase();
  return ESCALA_ESTANDAR_4_0.find((n) => n.letra === normalizada) ?? null;
}

/**
 * Estado de la matrícula que corresponde a una nota.
 *
 * Se deriva en vez de pedirlo aparte para que la nota y el estado no puedan
 * contradecirse: una matrícula con `A` y estado `enrolled` sería un dato
 * inconsistente que luego rompe la auditoría de grado, que cuenta como
 * completados sólo los `completed`.
 */
export function estadoParaNota(letra: string): 'enrolled' | 'completed' | 'withdrawn' {
  const nota = notaDeEscala(letra);
  if (!nota) return 'enrolled';
  if (nota.letra === 'W') return 'withdrawn';
  // `I` (incompleto) deja la matrícula abierta: es precisamente lo que significa.
  if (nota.letra === 'I') return 'enrolled';
  // Cualquier otra nota definitiva cierra el curso, aprobado o no: una `F`
  // también es un curso cursado. Que apruebe o no lo dice `esAprobatoria`, que
  // es lo que miran la auditoría de grado y los créditos ganados.
  return 'completed';
}
