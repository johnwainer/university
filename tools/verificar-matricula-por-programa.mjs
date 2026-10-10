#!/usr/bin/env node
/**
 * Comprobación 4: el panel ya no ofrece matricular por curso.
 *
 * El modelo es que el programa es la unidad que se matricula. Que el cliente
 * `lib/api.ts` siga exponiendo `enrollUserInCourse` no es el problema — el
 * endpoint del servidor sigue existiendo y lo usan otros flujos —; el problema
 * sería que alguna pantalla del panel volviera a ofrecer ese formulario. Esto
 * comprueba justo eso: que ningún componente lo invoque, y que la matrícula por
 * programa sí esté cableada.
 *
 * Uso: node tools/verificar-matricula-por-programa.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(RAIZ, 'apps/web/src');
const CLIENTE = join(WEB, 'lib/api.ts');

function archivosFuente(dir, acc = []) {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) archivosFuente(ruta, acc);
    else if (/\.tsx?$/.test(nombre)) acc.push(ruta);
  }
  return acc;
}

/**
 * Lo que se audita es el PANEL administrativo.
 *
 * `AdminApp.tsx` más todo lo de `components/admin/`. Se deja fuera el cliente
 * compartido, porque seguir declarando el método no es el problema, y se deja
 * fuera el sitio público, que tiene su propio flujo de paquetes de aulas para
 * departamentos y no es la matrícula de la que habla esta comprobación.
 */
const interfaz = archivosFuente(WEB).filter(
  (ruta) =>
    ruta !== CLIENTE &&
    (ruta.endsWith(join('components', 'AdminApp.tsx')) ||
      ruta.includes(join('components', 'admin')))
);
if (interfaz.length === 0) {
  console.log('FALLO No se encontró ningún archivo del panel que auditar');
  process.exit(1);
}

const problemas = [];
const hallazgos = [];

/* ---- 1. Ninguna pantalla invoca la matrícula por curso ---- */
const invocaciones = [];
for (const archivo of interfaz) {
  const lineas = readFileSync(archivo, 'utf8').split('\n');
  lineas.forEach((linea, i) => {
    if (/enrollUserInCourse\s*\(/.test(linea)) {
      invocaciones.push(`${relative(RAIZ, archivo)}:${i + 1}: ${linea.trim()}`);
    }
  });
}
if (invocaciones.length > 0) {
  problemas.push(['La interfaz todavía invoca enrollUserInCourse', invocaciones]);
} else {
  hallazgos.push('Ninguna pantalla del panel invoca enrollUserInCourse');
}

/* ---- 2. Tampoco quedan rastros del formulario viejo ---- */
const restos = [];
for (const archivo of interfaz) {
  const fuente = readFileSync(archivo, 'utf8');
  for (const patron of [
    // Estado y claves i18n que sólo existían para elegir un curso al matricular.
    /selectedCourseId/,
    /admin\.shell\.matricula\.campoCurso/,
    /admin\.shell\.matricula\.eligeCurso/,
    /\/enrollments['"`]/
  ]) {
    if (patron.test(fuente)) {
      restos.push(`${relative(RAIZ, archivo)}: ${patron}`);
    }
  }
}
if (restos.length > 0) {
  problemas.push(['Quedan restos del formulario de matrícula por curso', restos]);
} else {
  hallazgos.push('No quedan restos del formulario de matrícula por curso');
}

/* ---- 3. La matrícula por programa sí está cableada ---- */
const esperadas = [
  'enrollUserInProgram',
  'userProgramEnrollments',
  'unenrollUserFromProgram'
];
const sinUsar = [];
for (const metodo of esperadas) {
  const usadoEn = interfaz.filter((archivo) =>
    new RegExp(`${metodo}\\s*\\(`).test(readFileSync(archivo, 'utf8'))
  );
  if (usadoEn.length === 0) sinUsar.push(metodo);
}
if (sinUsar.length > 0) {
  problemas.push(['Métodos de matrícula por programa que la interfaz no usa', sinUsar]);
} else {
  hallazgos.push(`La interfaz usa los tres métodos por programa: ${esperadas.join(', ')}`);
}

/* ---- 4. Los tres métodos existen en el cliente, con su endpoint ---- */
const cliente = readFileSync(CLIENTE, 'utf8');
const rutasEsperadas = [
  ['enrollUserInProgram', '/program-enrollments'],
  ['userProgramEnrollments', '/program-enrollments'],
  ['unenrollUserFromProgram', '/program-enrollments/']
];
const faltanEnCliente = [];
for (const [metodo, ruta] of rutasEsperadas) {
  if (!cliente.includes(`${metodo}:`)) faltanEnCliente.push(`${metodo} no está en lib/api.ts`);
  else if (!cliente.includes(ruta)) faltanEnCliente.push(`${metodo} no apunta a ${ruta}`);
}
if (faltanEnCliente.length > 0) {
  problemas.push(['El cliente no declara la matrícula por programa', faltanEnCliente]);
} else {
  hallazgos.push('lib/api.ts declara los tres métodos contra /program-enrollments');
}

/* ---- Informe ---- */
for (const linea of hallazgos) console.log(`OK   ${linea}`);
for (const [titulo, lista] of problemas) {
  console.log(`FALLO ${titulo}: ${lista.length}`);
  for (const linea of lista) console.log(`       - ${linea}`);
}
console.log(`\nArchivos del panel revisados: ${interfaz.length}`);
process.exit(problemas.length > 0 ? 1 : 0);
