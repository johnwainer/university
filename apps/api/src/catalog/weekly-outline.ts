/**
 * Títulos de las ocho semanas de cada programa.
 *
 * Por qué viven aquí y no en Moodle: las secciones del aula se llaman
 * «Semana 1 · Week 1 (13 Oct – 19 Oct)», que es el rótulo que generan las
 * aulas modelo. Sirve dentro del aula, donde lo que importa son las fechas,
 * pero en la ficha pública del programa no dice nada de lo que se estudia esa
 * semana. Renombrar esas secciones desde aquí no es posible: el servicio web
 * de esta instalación de Moodle expone 21 funciones y ninguna toca secciones
 * ni módulos, y haría falta el CLI de Moodle, es decir acceso de shell.
 *
 * De dónde sale el contenido, que es lo importante: NO está inventado. Las
 * semanas centrales son, literalmente, las competencias que el propio catálogo
 * declara para ese programa —las mismas que la ficha lista en «Lo que
 * aprenderás y practicarás»—, y las tres restantes siguen la estructura que
 * fija el Master Syllabus de TFU: la semana 1 abre con la presentación y el
 * diagnóstico, y la 8 cierra con la reflexión final (§6 del manual: «en la
 * semana 1 la biografía del estudiante cuenta como asignación; en la semana 8
 * cuenta la reflexión final»).
 *
 * Son títulos provisionales de andamiaje: la facultad los ajusta cuando
 * redacta el sílabo del curso. Quedan marcados como derivados para que nadie
 * los confunda con un temario aprobado.
 */
import { peregrineProgram } from './peregrine-catalog.js';

export type WeekTitle = { es: string; en: string };

const APERTURA: WeekTitle = {
  es: 'Orientación, presentación y diagnóstico inicial',
  en: 'Orientation, introductions and initial diagnosis'
};

const CIERRE: WeekTitle[] = [
  { es: 'Aplicación integrada', en: 'Integrated application' },
  { es: 'Proyecto aplicado', en: 'Applied project' },
  { es: 'Reflexión final y plan de acción', en: 'Final reflection and action plan' }
];

/** Pasa «DESCUBRIMIENTO CONSULTIVO:» a «Descubrimiento consultivo». */
function titular(etiqueta: string): string {
  const limpio = etiqueta
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/:\s*$/, '')
    .trim()
    .toLocaleLowerCase('es');
  return limpio.charAt(0).toLocaleUpperCase('es') + limpio.slice(1);
}

/**
 * Las competencias de un programa, tal y como el catálogo las declara.
 *
 * Hay dos formas en el catálogo y las dos se contemplan: unos programas
 * etiquetan cada punto («<strong>DESCUBRIMIENTO CONSULTIVO:</strong> …») y
 * otros lo escriben como una frase completa. En el segundo caso el título de
 * la semana es esa frase recortada por su primer corte natural, no un resumen
 * inventado.
 */
function competencias(html: string): string[] {
  const conEtiqueta = [...html.matchAll(/<li><strong>([^<]+)<\/strong>/g)].map((match) => titular(match[1]));
  if (conEtiqueta.length > 0) {
    return conEtiqueta;
  }
  return [...html.matchAll(/<li>([^<]+)</g)]
    .map((match) => recortar(match[1]))
    .filter((texto) => texto.length > 0);
}

/**
 * Recorta una frase a un título legible.
 *
 * Corta primero por la coma, que en estas frases separa la idea principal de
 * sus matices, y sólo si no hay coma útil por el último espacio. Después quita
 * las palabras de enlace que quedan colgando al final —«con», «y», «para»,
 * «and», «to»—, que es lo que hacía que un título terminara en el aire.
 */
const CONECTORES = new Set([
  'con', 'y', 'e', 'de', 'del', 'para', 'por', 'en', 'a', 'al', 'la', 'el', 'los', 'las', 'un', 'una',
  'and', 'to', 'for', 'with', 'the', 'of', 'in', 'on', 'or', 'a', 'an',
  // Relativos e interrogativos: dejaban el título colgando en «…y dónde».
  'que', 'donde', 'dónde', 'cómo', 'como', 'cuándo', 'cuando', 'quién', 'quien',
  'that', 'which', 'where', 'how', 'when', 'who'
]);

function recortar(frase: string): string {
  const limpio = frase.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\.\s*$/, '').trim();
  if (limpio.length <= 58) {
    return limpio;
  }
  const coma = limpio.indexOf(',');
  let corte = coma >= 24 && coma <= 62 ? limpio.slice(0, coma) : '';
  if (!corte) {
    const trozo = limpio.slice(0, 58);
    const espacio = trozo.lastIndexOf(' ');
    corte = espacio > 28 ? trozo.slice(0, espacio) : trozo;
  }
  const palabras = corte.trim().split(/\s+/);
  while (palabras.length > 3 && CONECTORES.has(palabras[palabras.length - 1].toLocaleLowerCase('es'))) {
    palabras.pop();
  }
  return palabras.join(' ').replace(/[,;:]$/, '');
}

/**
 * Ocho títulos para un programa del catálogo, o `null` si el programa no es
 * de Peregrine y por tanto no tiene competencias declaradas.
 *
 * Con cuatro competencias quedan: apertura, las cuatro, y los tres cierres.
 * Con tres, el hueco lo ocupa un cierre más, nunca un relleno vacío.
 */
export function weeklyOutline(shortname: string | undefined | null): WeekTitle[] | null {
  const program = peregrineProgram(shortname);
  if (!program) {
    return null;
  }
  const es = competencias(program.summaryHtml.es);
  const en = competencias(program.summaryHtml.en);
  if (es.length === 0) {
    return null;
  }

  const centrales: WeekTitle[] = es.map((titulo, index) => ({
    es: titulo,
    en: en[index] ?? titulo
  }));

  const semanas: WeekTitle[] = [APERTURA, ...centrales];
  // El cierre se recorta o se estira hasta completar ocho, siempre terminando
  // en la reflexión final que pide el Master Syllabus.
  const faltan = 8 - semanas.length;
  const cola = CIERRE.slice(Math.max(0, CIERRE.length - faltan));
  while (semanas.length + cola.length < 8) {
    cola.unshift({ es: 'Práctica guiada', en: 'Guided practice' });
  }
  return [...semanas, ...cola].slice(0, 8);
}
