#!/usr/bin/env node
/**
 * Comprueba dos cosas distintas que suelen romperse juntas:
 *
 *   1. Que toda clave `t('...')` literal que usan AdminApp y ProgramsView
 *      existe en ES y en EN. Una clave que falta no revienta en i18next: el
 *      panel pinta la clave cruda ("admin.programs.titulo") y eso llega a
 *      producción sin que nadie lo note.
 *
 *   2. Que los dos ficheros de traducción tienen el MISMO árbol completo, no
 *      sólo las ramas nuevas. Una rama que exista sólo en ES hace que la
 *      versión inglesa caiga al fallback español en mitad de una pantalla.
 *
 * Las claves plurales de i18next (`clave_one` / `clave_other`) se tratan como
 * la misma clave base, porque en el código se llama a `t('clave', { count })`
 * y el sufijo lo resuelve la librería.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ruta = (p) => resolve(raiz, p);

const es = JSON.parse(readFileSync(ruta('apps/web/src/locales/es.json'), 'utf8'));
const en = JSON.parse(readFileSync(ruta('apps/web/src/locales/en.json'), 'utf8'));

/** Todas las rutas hoja del árbol, en notación de puntos. */
function hojas(nodo, prefijo = '', acc = new Set()) {
  for (const [clave, valor] of Object.entries(nodo)) {
    const ruta = prefijo ? `${prefijo}.${clave}` : clave;
    if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
      hojas(valor, ruta, acc);
    } else {
      acc.add(ruta);
    }
  }
  return acc;
}

/** Quita el sufijo plural de i18next para comparar con lo que pide el código. */
const SUFIJOS = ['_zero', '_one', '_two', '_few', '_many', '_other'];
function base(ruta) {
  for (const sufijo of SUFIJOS) {
    if (ruta.endsWith(sufijo)) return ruta.slice(0, -sufijo.length);
  }
  return ruta;
}

function resolubles(arbol) {
  const set = new Set();
  for (const hoja of hojas(arbol)) {
    set.add(hoja);
    set.add(base(hoja));
  }
  return set;
}

const FICHEROS = [
  'apps/web/src/components/admin/views/ProgramsView.tsx',
  'apps/web/src/components/AdminApp.tsx'
];

/**
 * Claves que el código pide de forma literal.
 *
 * Sólo se recogen las escritas enteras entre comillas: una clave compuesta en
 * tiempo de ejecución no se puede verificar estáticamente y un falso positivo
 * aquí sería peor que no mirar.
 */
const pedidas = new Map();
for (const fichero of FICHEROS) {
  const fuente = readFileSync(ruta(fichero), 'utf8');
  for (const m of fuente.matchAll(/t\(\s*'((?:admin|[a-z])[A-Za-z0-9_.]*)'/g)) {
    if (!pedidas.has(m[1])) pedidas.set(m[1], fichero);
  }
  // En AdminApp las claves de navegación viajan como datos en NAV_GROUPS y se
  // resuelven con t(item.label), así que el patrón de arriba no las ve.
  for (const m of fuente.matchAll(/(?:label|hint):\s*'(admin\.nav\.[A-Za-z0-9_.]+)'/g)) {
    if (!pedidas.has(m[1])) pedidas.set(m[1], fichero);
  }
}

const resolublesEs = resolubles(es);
const resolublesEn = resolubles(en);

const faltanEs = [];
const faltanEn = [];
for (const [clave, fichero] of pedidas) {
  if (!resolublesEs.has(clave)) faltanEs.push(`${clave}  (${fichero})`);
  if (!resolublesEn.has(clave)) faltanEn.push(`${clave}  (${fichero})`);
}

const hojasEs = hojas(es);
const hojasEn = hojas(en);
const soloEs = [...hojasEs].filter((k) => !hojasEn.has(k)).sort();
const soloEn = [...hojasEn].filter((k) => !hojasEs.has(k)).sort();

const lineas = [];
lineas.push(`Claves literales encontradas en el codigo: ${pedidas.size}`);
lineas.push(`Hojas en es.json: ${hojasEs.size}   Hojas en en.json: ${hojasEn.size}`);
lineas.push('');

function bloque(titulo, items) {
  if (items.length === 0) {
    lineas.push(`OK  ${titulo}: ninguno`);
    return 0;
  }
  lineas.push(`FALLO  ${titulo}: ${items.length}`);
  for (const item of items) lineas.push(`       ${item}`);
  return 1;
}

let fallos = 0;
fallos += bloque('claves usadas por el codigo que faltan en es.json', faltanEs);
fallos += bloque('claves usadas por el codigo que faltan en en.json', faltanEn);
fallos += bloque('claves presentes solo en es.json', soloEs);
fallos += bloque('claves presentes solo en en.json', soloEn);

lineas.push('');
lineas.push(fallos === 0 ? 'RESULTADO: paridad exacta y todas las claves resueltas.' : `RESULTADO: ${fallos} comprobacion(es) fallida(s).`);

console.log(lineas.join('\n'));
process.exit(fallos === 0 ? 0 : 1);
