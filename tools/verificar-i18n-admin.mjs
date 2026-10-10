#!/usr/bin/env node
/**
 * Comprobación 3: paridad exacta ES/EN y que toda clave usada exista.
 *
 * Son dos fallos distintos que se detectan igual de tarde: una clave que falta
 * en un idioma sale en pantalla como su propio nombre, y una clave usada que no
 * existe en ninguno hace lo mismo. Las dos sólo se ven si alguien abre esa
 * pantalla en ese idioma, así que se comprueban aquí.
 *
 * Uso: node tools/verificar-i18n-admin.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(RAIZ, 'apps/web/src');

const es = JSON.parse(readFileSync(join(WEB, 'locales/es.json'), 'utf8'));
const en = JSON.parse(readFileSync(join(WEB, 'locales/en.json'), 'utf8'));

/** Aplana el árbol a rutas con punto, que es como las escribe `t()`. */
function aplanar(nodo, prefijo = '', salida = new Map()) {
  for (const [clave, valor] of Object.entries(nodo)) {
    const ruta = prefijo ? `${prefijo}.${clave}` : clave;
    if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
      aplanar(valor, ruta, salida);
    } else {
      salida.set(ruta, valor);
    }
  }
  return salida;
}

const planoEs = aplanar(es);
const planoEn = aplanar(en);

/* ---- 1. Paridad exacta del árbol completo ---- */
const soloEs = [...planoEs.keys()].filter((k) => !planoEn.has(k));
const soloEn = [...planoEn.keys()].filter((k) => !planoEs.has(k));

/* Un valor vacío es tan invisible como una clave que falta. */
const vacias = [];
for (const [mapa, idioma] of [[planoEs, 'es'], [planoEn, 'en']]) {
  for (const [k, v] of mapa) {
    if (typeof v !== 'string' || v.trim() === '') vacias.push(`${idioma}: ${k}`);
  }
}

/* Las interpolaciones tienen que coincidir: una {{variable}} que falta en un
   idioma deja el hueco sin rellenar en esa pantalla. */
const interpolaciones = [];
for (const [clave, valorEs] of planoEs) {
  const valorEn = planoEn.get(clave);
  if (typeof valorEs !== 'string' || typeof valorEn !== 'string') continue;
  const vars = (texto) =>
    [...texto.matchAll(/\{\{\s*([\w.]+)/g)].map((m) => m[1]).sort().join(',');
  if (vars(valorEs) !== vars(valorEn)) {
    interpolaciones.push(`${clave} → es:[${vars(valorEs)}] en:[${vars(valorEn)}]`);
  }
}

/* ---- 2. Toda clave usada en el panel existe en los dos idiomas ---- */
function archivosFuente(dir, acc = []) {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) archivosFuente(ruta, acc);
    else if (/\.tsx?$/.test(nombre)) acc.push(ruta);
  }
  return acc;
}

/**
 * Claves que se arman al pintar, con una plantilla.
 *
 * `t(`admin.overview.real.tiles.${tile.clave}`)` no se puede resolver
 * estáticamente, así que se comprueba que exista al menos un descendiente de
 * ese prefijo en los dos idiomas, que es lo que de verdad falla si el bloque
 * entero no se tradujo.
 */
const prefijosDinamicos = new Set();
const clavesUsadas = new Set();

for (const archivo of archivosFuente(WEB)) {
  const fuente = readFileSync(archivo, 'utf8');
  for (const m of fuente.matchAll(/\bt\(\s*'([^']+)'/g)) clavesUsadas.add(m[1]);
  for (const m of fuente.matchAll(/\bt\(\s*"([^"]+)"/g)) clavesUsadas.add(m[1]);
  for (const m of fuente.matchAll(/\bt\(\s*`([^`]*)`/g)) {
    const plantilla = m[1];
    if (plantilla.includes('${')) {
      const prefijo = plantilla.slice(0, plantilla.indexOf('${')).replace(/\.$/, '');
      if (prefijo) prefijosDinamicos.add(prefijo);
    } else if (plantilla) {
      clavesUsadas.add(plantilla);
    }
  }
}

const faltantes = [];
for (const clave of [...clavesUsadas].sort()) {
  // i18next resuelve el plural con sufijo, así que una clave con `count`
  // existe como `_one`/`_other` y no con su nombre pelado.
  const existe = (mapa) =>
    mapa.has(clave) || mapa.has(`${clave}_one`) || mapa.has(`${clave}_other`);
  if (!existe(planoEs)) faltantes.push(`es: ${clave}`);
  if (!existe(planoEn)) faltantes.push(`en: ${clave}`);
}

const prefijosSinNada = [];
for (const prefijo of [...prefijosDinamicos].sort()) {
  const tiene = (mapa) => [...mapa.keys()].some((k) => k.startsWith(`${prefijo}.`));
  if (!tiene(planoEs)) prefijosSinNada.push(`es: ${prefijo}.*`);
  if (!tiene(planoEn)) prefijosSinNada.push(`en: ${prefijo}.*`);
}

/* ---- Informe ---- */
const bloques = [
  ['Claves sólo en es.json', soloEs],
  ['Claves sólo en en.json', soloEn],
  ['Valores vacíos', vacias],
  ['Interpolaciones que no coinciden', interpolaciones],
  ['Claves usadas que no existen', faltantes],
  ['Prefijos dinámicos sin ninguna clave', prefijosSinNada]
];

let fallo = false;
for (const [titulo, lista] of bloques) {
  if (lista.length === 0) {
    console.log(`OK   ${titulo}: ninguna`);
  } else {
    fallo = true;
    console.log(`FALLO ${titulo}: ${lista.length}`);
    for (const linea of lista) console.log(`       - ${linea}`);
  }
}

console.log(
  `\nes.json: ${planoEs.size} claves · en.json: ${planoEn.size} claves · ` +
    `usadas en el código: ${clavesUsadas.size} literales y ${prefijosDinamicos.size} prefijos dinámicos`
);

process.exit(fallo ? 1 : 0);
