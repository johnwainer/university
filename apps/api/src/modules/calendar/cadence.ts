/**
 * Motor de cadencia del aula.
 *
 * El calendario académico no es un listado de fechas institucionales: es la
 * regla que decide qué se abre y qué se cierra cada semana (Cláusula 7). Este
 * archivo calcula la malla; `schema.ts` la guarda y `moodle-sync.ts` la empuja
 * al aula.
 *
 * LAS FECHAS SALEN DEL MASTER SYLLABUS, NO DEL RESUMEN DEL CONTRATO.
 * La Cláusula 7 nombra las tres fechas límite sin decir en qué día caen. La
 * §10 del Master Syllabus sí lo dice, y la Cláusula 2 le da precedencia:
 *
 *   semana lectiva   martes 00:00 → lunes 23:59 (hora del Este)
 *   respuesta inicial  MARTES   23:59
 *   respuesta a pares  JUEVES   23:59
 *   entrega semanal    LUNES    23:59
 *
 * HORARIO DE VERANO. Un término de ocho semanas que arranque en octubre cruza
 * el fin del horario de verano, así que las fechas NO pueden calcularse
 * sumando milisegundos a un instante: 7 × 24 h desde un martes de EDT cae una
 * hora antes del martes siguiente en EST. Se calcula sobre la fecha civil y se
 * convierte a instante con la zona puesta, que es lo que mantiene el "23:59
 * hora del Este" en las dieciséis semanas.
 */
import { WEEKLY_CADENCE } from '../syllabus/master-syllabus.js';

export const TERM_WEEKS = 8;
const TZ = WEEKLY_CADENCE.timezone;

export type WeeklyDeadline = {
  key: string;
  labelEs: string;
  labelEn: string;
  /** Instante exacto en UTC. */
  dueAt: string;
};

export type TermWeek = {
  week: number;
  /** Martes de inicio, fecha civil YYYY-MM-DD. */
  startsOn: string;
  /** Lunes de cierre, fecha civil. */
  endsOn: string;
  /** Instante en que cierra la semana (lunes 23:59 del Este). */
  closesAt: string;
  /** Viernes anterior: cuando el alumno ve la semana entrante. */
  opensAt: string;
  /** Jueves 10:00 previo al martes: corte de aula lista (§8). */
  shellReadyBy: string;
  deadlines: WeeklyDeadline[];
  /** Festivos institucionales que caen dentro de la semana. */
  holidays: string[];
  /** Cierto si algún plazo se desplazó por un festivo. */
  shifted: boolean;
};

export type TermGrid = {
  termStartsOn: string;
  termEndsOn: string;
  weeks: TermWeek[];
};

/* -------------------------------------------------------------------------- */
/* Fechas civiles                                                             */
/* -------------------------------------------------------------------------- */

/** YYYY-MM-DD → [año, mes, día], sin pasar por Date para no coger la zona local. */
function parseCivil(date: string): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!match) {
    throw new Error(`Fecha civil inválida: "${date}". Se espera YYYY-MM-DD.`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function civilToUtcNoon(date: string): Date {
  const [y, m, d] = parseCivil(date);
  // Mediodía UTC: lejos de cualquier salto de medianoche, así que sumar días
  // nunca cruza de fecha por el desfase de zona.
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

function utcNoonToCivil(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = civilToUtcNoon(date);
  d.setUTCDate(d.getUTCDate() + days);
  return utcNoonToCivil(d);
}

/** Día de la semana de una fecha civil, 0 domingo … 6 sábado. */
export function civilWeekday(date: string): number {
  return civilToUtcNoon(date).getUTCDay();
}

/**
 * Convierte una fecha civil y una hora local del Este al instante UTC correcto.
 *
 * No hay API nativa para "esta hora local en esta zona → instante", así que se
 * resuelve midiendo el desfase real de la zona en ese momento y corrigiendo.
 * Dos pasadas bastan: la primera da un desfase aproximado y la segunda lo
 * confirma con el desfase ya correcto, que es lo que importa en los días del
 * cambio de horario.
 */
export function easternToInstant(date: string, hour: number, minute: number): Date {
  const [y, m, d] = parseCivil(date);
  let guess = new Date(Date.UTC(y, m - 1, d, hour, minute, 0));
  for (let pass = 0; pass < 2; pass += 1) {
    const offsetMinutes = zoneOffsetMinutes(guess);
    const corrected = new Date(Date.UTC(y, m - 1, d, hour, minute, 0) - offsetMinutes * 60000);
    if (corrected.getTime() === guess.getTime()) {
      return corrected;
    }
    guess = corrected;
  }
  return guess;
}

/** Desfase de la zona respecto de UTC, en minutos, en ese instante. */
function zoneOffsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return (asUtc - instant.getTime()) / 60000;
}

/* -------------------------------------------------------------------------- */
/* La malla                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Primer martes en o después de la fecha dada.
 *
 * El término siempre arranca en martes porque la semana lectiva lo hace. Si
 * alguien fija el inicio en jueves, se corre al martes siguiente en vez de
 * generar una primera semana coja.
 */
export function firstTuesdayOnOrAfter(date: string): string {
  const weekday = civilWeekday(date);
  const delta = (WEEKLY_CADENCE.weekStartsOn - weekday + 7) % 7;
  return addDays(date, delta);
}

export type Holiday = { date: string; nameEs: string; nameEn: string };

/**
 * Construye la malla de ocho semanas de un término.
 *
 * Los festivos NO mueven el inicio ni el fin de la semana —eso descuadraría el
 * término entero—: mueven el plazo que cae ese día al siguiente día hábil,
 * que es lo que la Cláusula 7 pide cuando habla de desplazar las fechas
 * afectadas.
 */
export function buildTermGrid(startDate: string, holidays: Holiday[] = []): TermGrid {
  const termStart = firstTuesdayOnOrAfter(startDate);
  const holidayByDate = new Map(holidays.map((holiday) => [holiday.date, holiday]));

  const weeks: TermWeek[] = [];
  for (let week = 1; week <= TERM_WEEKS; week += 1) {
    const weekStart = addDays(termStart, (week - 1) * 7);
    const weekEnd = addDays(weekStart, 6);

    let shifted = false;
    const deadlines: WeeklyDeadline[] = WEEKLY_CADENCE.deadlines.map((deadline) => {
      let dueOn = addDays(weekStart, deadline.dayOffset);
      // Desplazar al siguiente día que no sea festivo, sin salirse de la
      // semana: si el festivo es el lunes de cierre, el plazo se queda ahí
      // —correrlo movería la entrega a la semana siguiente—.
      let guard = 0;
      while (holidayByDate.has(dueOn) && dueOn !== weekEnd && guard < 7) {
        dueOn = addDays(dueOn, 1);
        shifted = true;
        guard += 1;
      }
      return {
        key: deadline.key,
        labelEs: deadline.labelEs,
        labelEn: deadline.labelEn,
        dueAt: easternToInstant(
          dueOn,
          WEEKLY_CADENCE.closingTime.hour,
          WEEKLY_CADENCE.closingTime.minute
        ).toISOString()
      };
    });

    const weekHolidays = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const day = addDays(weekStart, offset);
      if (holidayByDate.has(day)) {
        weekHolidays.push(day);
      }
    }

    weeks.push({
      week,
      startsOn: weekStart,
      endsOn: weekEnd,
      closesAt: easternToInstant(weekEnd, 23, 59).toISOString(),
      // Viernes anterior al martes de inicio: tres días antes.
      opensAt: easternToInstant(addDays(weekStart, -4), 0, 0).toISOString(),
      // §8: jueves 10:00 antes del martes de inicio.
      shellReadyBy: easternToInstant(
        addDays(weekStart, WEEKLY_CADENCE.shellReadyCheckpoint.dayOffsetBeforeStart),
        WEEKLY_CADENCE.shellReadyCheckpoint.hour,
        WEEKLY_CADENCE.shellReadyCheckpoint.minute
      ).toISOString(),
      deadlines,
      holidays: weekHolidays,
      shifted
    });
  }

  return {
    termStartsOn: termStart,
    termEndsOn: weeks[weeks.length - 1].endsOn,
    weeks
  };
}

/**
 * Semana del término en la que cae un instante, o null si está fuera.
 * Lo usa el punto de control de aulas listas para saber qué semana mirar.
 */
export function weekFor(grid: TermGrid, instant: Date = new Date()): TermWeek | null {
  const time = instant.getTime();
  for (const week of grid.weeks) {
    const opens = easternToInstant(week.startsOn, 0, 0).getTime();
    const closes = Date.parse(week.closesAt);
    if (time >= opens && time <= closes) {
      return week;
    }
  }
  return null;
}

/** La semana que viene, para el corte de preparación del jueves. */
export function upcomingWeek(grid: TermGrid, instant: Date = new Date()): TermWeek | null {
  const time = instant.getTime();
  return (
    grid.weeks.find((week) => easternToInstant(week.startsOn, 0, 0).getTime() > time) ?? null
  );
}
