/**
 * La malla de ocho semanas del sílabo, traída del calendario académico.
 *
 * TFU preguntó: «when the syllabus is uploaded, does the calendar synchronize
 * with it?». La respuesta honesta era que no, y además al revés de como lo
 * prometía la propia plantilla: la §8 del Master Syllabus dice que el
 * calendario de ocho semanas «lo genera el calendario académico a partir de la
 * fecha de inicio del término», pero nada lo hacía. La facultad tecleaba las
 * ocho filas a mano y la validación sólo comprobaba que fueran ocho.
 *
 * Qué hace este archivo: toma la malla del término —que ya resuelve semana
 * lectiva de martes a lunes, los tres plazos, el horario de verano y los
 * festivos que desplazan fechas— y la convierte en las filas del sílabo.
 *
 * QUÉ NO HACE, a propósito: no toca el calendario. Las fechas tienen UNA
 * fuente, el término, y el sílabo las refleja. Si un sílabo pudiera mover el
 * calendario, dos cursos del mismo término acabarían con semanas distintas y
 * la Cláusula 7 —un festivo desplaza los plazos de todas las secciones— se
 * volvería imposible de cumplir.
 *
 * El contenido de la facultad se conserva SIEMPRE: tema, lecturas y
 * actividades de una semana que ya estaba escrita no se pisan.
 */
import type { TermGrid } from '../calendar/cadence.js';

export type SemanaSilabo = {
  week: number;
  /** Martes de inicio, fecha civil. */
  startsOn?: string;
  /** Lunes de cierre, fecha civil. */
  endsOn?: string;
  /** Cierto si un festivo movió algún plazo de esa semana. */
  shifted?: boolean;
  topic?: string;
  readings?: string;
  activities?: string;
};

export function construirSemanasDesdeMalla(
  grid: TermGrid,
  semanasActuales: SemanaSilabo[] = []
): SemanaSilabo[] {
  const porNumero = new Map<number, SemanaSilabo>();
  semanasActuales.forEach((semana, indice) => {
    // Una fila sin número se empareja por posición: los sílabos escritos a
    // mano antes de esto no siempre lo traen.
    porNumero.set(Number(semana.week ?? indice + 1), semana);
  });

  return grid.weeks.map((semanaDelTermino) => {
    const previa: SemanaSilabo = porNumero.get(semanaDelTermino.week) ?? { week: semanaDelTermino.week };
    return {
      week: semanaDelTermino.week,
      startsOn: semanaDelTermino.startsOn,
      endsOn: semanaDelTermino.endsOn,
      shifted: semanaDelTermino.shifted,
      // Lo que escribió la facultad manda sobre lo que había: estas tres
      // claves nunca se rellenan solas ni se borran.
      topic: previa.topic ?? '',
      readings: previa.readings ?? '',
      activities: previa.activities ?? ''
    };
  });
}

/** Cierto si la malla del sílabo ya está alineada con la del término. */
export function semanasAlineadas(grid: TermGrid, semanas: SemanaSilabo[]): boolean {
  if (semanas.length !== grid.weeks.length) {
    return false;
  }
  return grid.weeks.every((semanaDelTermino, i) => {
    const semana = semanas[i];
    return (
      Number(semana?.week) === semanaDelTermino.week &&
      semana?.startsOn === semanaDelTermino.startsOn &&
      semana?.endsOn === semanaDelTermino.endsOn
    );
  });
}
