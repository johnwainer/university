/**
 * Idioma del contenido del aula.
 *
 * El problema que resuelve este archivo, dicho con precisión: `core_course_get_contents`
 * devuelve el texto de Moodle SIN pasar por los filtros (§9.5 del traspaso), y
 * `/v1/courses/:id/content` lo entregaba tal cual. Consecuencia para quien
 * estudia: el nombre de la sección, el de la actividad y su descripción salían
 * con el marcado multiidioma crudo o con las dos versiones pegadas, y el
 * conmutador de idioma del portal no los movía — porque no había nada que
 * mover, el texto venía ya decidido por Moodle.
 *
 * TFU lo reportó como «the translation button does not work on content».
 *
 * La pieza que faltaba no era nueva: `parseMultilang` ya separaba los dos
 * idiomas para el catálogo, en las dos sintaxis que conviven en esta
 * instalación (el `<span lang=".." class="multilang">` del núcleo y el
 * `{mlang ..}` del plugin multilang2). Aquí se aplica al contenido del aula.
 *
 * Reglas deliberadas:
 *
 *   - Un texto sin marcado se devuelve igual. Una actividad escrita en un solo
 *     idioma sigue viéndose; no se vacía por no estar traducida.
 *   - Sólo se tocan los campos de TEXTO VISIBLE. Nada de urls, ids, mimetypes
 *     ni nombres de módulo: el front decide con `modname` y romperlo sería
 *     romper el aula entera.
 *   - La estructura se conserva campo a campo. Si Moodle añade claves nuevas
 *     en una versión futura, viajan intactas en vez de perderse.
 */
import { parseMultilang } from '../../db.js';
import type { MoodleCourseSection } from '../../moodle.js';

export type LocaleAula = 'es' | 'en';

function enIdioma(valor: string | undefined, locale: LocaleAula): string | undefined {
  if (typeof valor !== 'string' || valor.length === 0) {
    return valor;
  }
  const partes = parseMultilang(valor);
  return locale === 'en' ? partes.en : partes.es;
}

/**
 * Devuelve las secciones con el texto visible resuelto al idioma pedido.
 *
 * No muta la respuesta de Moodle: se construyen objetos nuevos. La respuesta
 * original se reutiliza más adelante en la misma petición para habilitar los
 * ficheros de la sesión (`rememberCourseFiles`), y mutarla aquí haría que esa
 * comprobación trabajase sobre datos ya transformados.
 */
export function localizarContenidoDelAula(
  secciones: MoodleCourseSection[],
  locale: LocaleAula
): MoodleCourseSection[] {
  return secciones.map((seccion) => ({
    ...seccion,
    name: enIdioma(seccion.name, locale) ?? seccion.name,
    summary: enIdioma(seccion.summary, locale),
    modules: (seccion.modules ?? []).map((modulo) => ({
      ...modulo,
      name: enIdioma(modulo.name, locale) ?? modulo.name,
      description: enIdioma(modulo.description, locale),
      // `modplural` es el nombre del tipo en plural que escribe Moodle
      // («Archivos», «Tareas»); también puede llevar marcado.
      modplural: enIdioma(modulo.modplural, locale),
      availabilityinfo: enIdioma(modulo.availabilityinfo, locale)
    }))
  }));
}
