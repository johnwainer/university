/**
 * Datos de contacto institucionales del sitio público.
 *
 * Estaban escritos a mano como `mailto:ferpa@atlas.edu`, `titleix@atlas.edu` y
 * `soporte@atlas.edu` —un dominio heredado de la plantilla que no es el de la
 * institución—, repartidos por el pie de página, la vista legal y el panel
 * enterprise. Aquí se resuelven una sola vez, desde el entorno de build, con
 * el dominio real como valor por defecto.
 *
 * Deben coincidir con los que usa la API al generar las páginas
 * institucionales (apps/api/src/modules/pages/schema.ts) y las cláusulas
 * heredadas del sílabo.
 */
const DOMINIO = import.meta.env.VITE_INSTITUTION_DOMAIN ?? 'thefloridianuniversity.com';

export const INSTITUTION_CONTACTS = {
  general: import.meta.env.VITE_CONTACT_EMAIL ?? `info@${DOMINIO}`,
  admissions: import.meta.env.VITE_ADMISSIONS_EMAIL ?? `admissions@${DOMINIO}`,
  ferpa: import.meta.env.VITE_FERPA_EMAIL ?? `ferpa@${DOMINIO}`,
  titleIx: import.meta.env.VITE_TITLE_IX_EMAIL ?? `titleix@${DOMINIO}`,
  ada: import.meta.env.VITE_ADA_EMAIL ?? `accessibility@${DOMINIO}`
} as const;
