import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  api,
  type AcademicTermRecord,
  type AdminConfig,
  type AdminStatus,
  type DegreeProgram
} from '../../../lib/api';

/**
 * Resumen de actividad de la plataforma.
 *
 * La vista está partida en dos zonas porque el contrato (Cláusula 4) separa dos
 * entregables distintos:
 *
 *   Zona 1 — Tablero de estado operativo. Información binaria y conteos que
 *            salen de la API real. Es lo comprometido en las etapas actuales.
 *   Zona 2 — Dashboard analítico (volúmenes, tasas, tendencias). Es Etapa V,
 *            enero de 2027.
 *
 * El cliente pidió ver gráficas antes de esa fecha, así que la Zona 2 existe
 * pero como MAQUETA: sus cifras vienen de `DATOS_DE_MUESTRA`, nunca de la
 * institución. El rótulo no es decoración: esta pantalla se enseña en
 * reuniones, y una cifra de muestra que pase por real compromete la lectura del
 * avance contractual. De ahí el banner y, además, una marca por gráfica: quien
 * entre a mitad de scroll o vea una captura suelta también tiene que saberlo.
 *
 * Las gráficas se dibujan en SVG a mano a propósito. Montar una dependencia de
 * gráficas para una maqueta deja deuda que habría que mantener hasta Etapa V,
 * cuando el tablero definitivo probablemente use otra cosa.
 */

/* ------------------------------------------------------------------------- *
 * Datos de muestra — Zona 2
 * ------------------------------------------------------------------------- */

/**
 * Cifras inventadas con la única función de dar forma a la maqueta.
 *
 * En Etapa V esta constante se sustituye por las respuestas de los endpoints
 * analíticos; las gráficas no deberían necesitar cambios, sólo el origen de
 * estas series. Los órdenes de magnitud son plausibles para una institución
 * mediana para que la maqueta se lea bien, pero NO describen a ninguna.
 */
const DATOS_DE_MUESTRA = {
  /** Matrículas nuevas por mes de un año académico completo. */
  matriculas: [
    { mes: 0, valor: 128 },
    { mes: 1, valor: 142 },
    { mes: 2, valor: 196 },
    { mes: 3, valor: 174 },
    { mes: 4, valor: 158 },
    { mes: 5, valor: 121 },
    { mes: 6, valor: 96 },
    { mes: 7, valor: 184 },
    { mes: 8, valor: 243 },
    { mes: 9, valor: 215 },
    { mes: 10, valor: 188 },
    { mes: 11, valor: 164 }
  ],
  /** Embudo de admisiones, de arriba a abajo. Cada etapa es subconjunto de la anterior. */
  embudo: [
    { clave: 'interesados', valor: 2400 },
    { clave: 'solicitudes', valor: 980 },
    { clave: 'admitidos', valor: 520 },
    { clave: 'matriculados', valor: 365 }
  ],
  /** Avance medio (porcentaje de aula completada) e inscritos por programa. */
  programas: [
    { clave: 'administracion', avance: 72, inscritos: 148 },
    { clave: 'educacion', avance: 64, inscritos: 112 },
    { clave: 'tecnologia', avance: 81, inscritos: 96 },
    { clave: 'salud', avance: 55, inscritos: 74 },
    { clave: 'negocios', avance: 68, inscritos: 61 }
  ],
  /** Actividad de la última semana, por día. Lunes primero. */
  actividad: [
    { dia: 0, sesiones: 318, entregas: 86 },
    { dia: 1, sesiones: 342, entregas: 104 },
    { dia: 2, sesiones: 365, entregas: 97 },
    { dia: 3, sesiones: 329, entregas: 132 },
    { dia: 4, sesiones: 287, entregas: 118 },
    { dia: 5, sesiones: 142, entregas: 41 },
    { dia: 6, sesiones: 118, entregas: 29 }
  ]
} as const;

/* ------------------------------------------------------------------------- *
 * Geometría común de las gráficas
 * ------------------------------------------------------------------------- */

/**
 * Lienzo fijo con `viewBox`: el SVG escala con el ancho del contenedor sin que
 * haya que medir nada en JavaScript ni volver a dibujar al cambiar el tamaño.
 */
const LIENZO = { ancho: 640, alto: 260 };
const MARGEN = { arriba: 22, derecha: 18, abajo: 42, izquierda: 56 };
const UTIL = {
  ancho: LIENZO.ancho - MARGEN.izquierda - MARGEN.derecha,
  alto: LIENZO.alto - MARGEN.arriba - MARGEN.abajo
};

/** Número de divisiones del eje vertical; 4 deja 5 rótulos contando el cero. */
const DIVISIONES_Y = 4;

/**
 * Redondea el máximo a una cifra "redonda" (1, 2, 5 × 10ⁿ) para que los
 * rótulos del eje salgan legibles en vez de 243, 60.75, 121.5...
 */
function techoEscala(maximo: number): number {
  if (maximo <= 0) return 1;
  const magnitud = 10 ** Math.floor(Math.log10(maximo));
  const normalizado = maximo / magnitud;
  const paso = normalizado <= 1 ? 1 : normalizado <= 2 ? 2 : normalizado <= 5 ? 5 : 10;
  return paso * magnitud;
}

function marcasY(techo: number): number[] {
  return Array.from({ length: DIVISIONES_Y + 1 }, (_, i) => (techo / DIVISIONES_Y) * i);
}

/* ------------------------------------------------------------------------- *
 * Utilidades
 * ------------------------------------------------------------------------- */

type Etiqueta = 'ok' | 'warn' | 'off';

/** Motivo normalizado por el que un bloque de la Zona 1 no tiene datos. */
type Motivo = 'permiso' | 'error';

/**
 * Un bloque de datos reales siempre está en uno de estos tres estados. Se
 * modela explícito para que la plantilla no tenga que adivinar si un `null`
 * significa "cargando", "sin permiso" o "de verdad no hay nada".
 */
type Bloque<T> =
  | { estado: 'cargando' }
  | { estado: 'ok'; datos: T }
  | { estado: 'sin-datos'; motivo: Motivo };

/**
 * Distingue un 403/401 de una caída real.
 *
 * `fetchJson` tira un Error cuyo mensaje empieza por "Request failed: <código>",
 * así que el código se lee del texto. Es frágil comparado con mirar el status,
 * pero el cliente compartido no lo expone y esta vista no debe modificarlo.
 */
function motivoDeError(error: unknown): Motivo {
  const mensaje = error instanceof Error ? error.message : '';
  return /\b(401|403)\b/.test(mensaje) ? 'permiso' : 'error';
}

/** Envuelve una promesa de la API en un Bloque, sin dejar que un 403 rompa la vista. */
async function bloqueDe<T>(promesa: Promise<T>): Promise<Bloque<T>> {
  try {
    return { estado: 'ok', datos: await promesa };
  } catch (error) {
    return { estado: 'sin-datos', motivo: motivoDeError(error) };
  }
}

/* ------------------------------------------------------------------------- *
 * Gráfica 1 — Evolución de matrículas (área + línea)
 * ------------------------------------------------------------------------- */

function GraficaMatriculas({ etiquetasMes, formato }: { etiquetasMes: string[]; formato: Intl.NumberFormat }) {
  const { t } = useTranslation();
  const serie = DATOS_DE_MUESTRA.matriculas;
  const techo = techoEscala(Math.max(...serie.map((p) => p.valor)));

  const x = (i: number) => MARGEN.izquierda + (UTIL.ancho / (serie.length - 1)) * i;
  const y = (valor: number) => MARGEN.arriba + UTIL.alto * (1 - valor / techo);

  const linea = serie.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.valor)}`).join(' ');
  const area = `${linea} L${x(serie.length - 1)},${MARGEN.arriba + UTIL.alto} L${x(0)},${MARGEN.arriba + UTIL.alto} Z`;

  const total = serie.reduce((suma, p) => suma + p.valor, 0);
  const maximo = serie.reduce((mejor, p) => (p.valor > mejor.valor ? p : mejor), serie[0]);

  return (
    <figure className="ad-chart">
      <div className="ad-chart-head">
        <h4>{t('admin.overview.graficas.matriculas.titulo')}</h4>
        <span className="ad-preview-mark">{t('admin.overview.preview.marca')}</span>
      </div>
      <svg
        viewBox={`0 0 ${LIENZO.ancho} ${LIENZO.alto}`}
        width="100%"
        role="img"
        aria-label={t('admin.overview.graficas.matriculas.aria', {
          total: formato.format(total),
          mes: etiquetasMes[maximo.mes],
          pico: formato.format(maximo.valor)
        })}
      >
        {/* Rejilla y rótulos del eje vertical. */}
        {marcasY(techo).map((valor) => (
          <g key={valor}>
            <line
              x1={MARGEN.izquierda}
              y1={y(valor)}
              x2={MARGEN.izquierda + UTIL.ancho}
              y2={y(valor)}
              stroke="currentColor"
              strokeWidth={1}
              strokeOpacity={valor === 0 ? 0.45 : 0.14}
            />
            <text
              x={MARGEN.izquierda - 8}
              y={y(valor) + 3}
              textAnchor="end"
              fontSize={10}
              fill="currentColor"
            >
              {formato.format(valor)}
            </text>
          </g>
        ))}

        <path d={area} fill="var(--ad-serie-1)" fillOpacity={0.14} />
        <path d={linea} fill="none" stroke="var(--ad-serie-1)" strokeWidth={1} strokeLinejoin="round" />

        {serie.map((p, i) => (
          <g key={p.mes}>
            <circle cx={x(i)} cy={y(p.valor)} r={2.5} fill="var(--ad-serie-1)" />
            <text x={x(i)} y={y(p.valor) - 8} textAnchor="middle" fontSize={9} fill="currentColor">
              {formato.format(p.valor)}
            </text>
            <text
              x={x(i)}
              y={MARGEN.arriba + UTIL.alto + 16}
              textAnchor="middle"
              fontSize={10}
              fill="currentColor"
            >
              {etiquetasMes[p.mes]}
            </text>
          </g>
        ))}

        {/* Títulos de eje: sin ellos el número suelto no dice de qué es. */}
        <text
          x={MARGEN.izquierda + UTIL.ancho / 2}
          y={LIENZO.alto - 8}
          textAnchor="middle"
          fontSize={10}
          fill="currentColor"
        >
          {t('admin.overview.graficas.matriculas.ejeX')}
        </text>
        <text
          x={12}
          y={MARGEN.arriba + UTIL.alto / 2}
          textAnchor="middle"
          fontSize={10}
          fill="currentColor"
          transform={`rotate(-90 12 ${MARGEN.arriba + UTIL.alto / 2})`}
        >
          {t('admin.overview.graficas.matriculas.ejeY')}
        </text>
      </svg>
      <figcaption>{t('admin.overview.graficas.matriculas.pie')}</figcaption>
      <details>
        <summary>{t('admin.overview.preview.verDatos')}</summary>
        <table className="ad-table">
          <caption>{t('admin.overview.graficas.matriculas.titulo')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('admin.overview.graficas.matriculas.ejeX')}</th>
              <th scope="col">{t('admin.overview.graficas.matriculas.ejeY')}</th>
            </tr>
          </thead>
          <tbody>
            {serie.map((p) => (
              <tr key={p.mes}>
                <th scope="row">{etiquetasMes[p.mes]}</th>
                <td>{formato.format(p.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/* ------------------------------------------------------------------------- *
 * Gráfica 2 — Embudo de admisiones
 * ------------------------------------------------------------------------- */

const EMBUDO_ALTO_FILA = 44;
const EMBUDO_SEPARACION = 10;

function GraficaEmbudo({ formato }: { formato: Intl.NumberFormat }) {
  const { t } = useTranslation();
  const serie = DATOS_DE_MUESTRA.embudo;
  const cabeza = serie[0].valor;

  const alto = MARGEN.arriba + serie.length * (EMBUDO_ALTO_FILA + EMBUDO_SEPARACION) + 24;
  /* El embudo se centra: la banda se estrecha hacia abajo por los dos lados, que
     es la convención con la que se lee un embudo de admisiones. */
  const centro = MARGEN.izquierda + UTIL.ancho / 2;
  const anchoMaximo = UTIL.ancho;

  const porcentaje = (valor: number) => Math.round((valor / cabeza) * 100);

  return (
    <figure className="ad-chart">
      <div className="ad-chart-head">
        <h4>{t('admin.overview.graficas.embudo.titulo')}</h4>
        <span className="ad-preview-mark">{t('admin.overview.preview.marca')}</span>
      </div>
      <svg
        viewBox={`0 0 ${LIENZO.ancho} ${alto}`}
        width="100%"
        role="img"
        aria-label={t('admin.overview.graficas.embudo.aria', {
          entrada: formato.format(cabeza),
          salida: formato.format(serie[serie.length - 1].valor),
          tasa: porcentaje(serie[serie.length - 1].valor)
        })}
      >
        {serie.map((etapa, i) => {
          const ancho = Math.max(72, (etapa.valor / cabeza) * anchoMaximo);
          const y = MARGEN.arriba + i * (EMBUDO_ALTO_FILA + EMBUDO_SEPARACION);
          const color = `var(--ad-serie-${(i % 5) + 1})`;
          return (
            <g key={etapa.clave}>
              <rect
                x={centro - ancho / 2}
                y={y}
                width={ancho}
                height={EMBUDO_ALTO_FILA}
                fill={color}
                fillOpacity={0.22}
                stroke={color}
                strokeWidth={1}
              />
              <text
                x={centro}
                y={y + EMBUDO_ALTO_FILA / 2 - 2}
                textAnchor="middle"
                fontSize={11}
                fill="currentColor"
              >
                {t(`admin.overview.muestra.embudo.${etapa.clave}`)}
              </text>
              <text
                x={centro}
                y={y + EMBUDO_ALTO_FILA / 2 + 13}
                textAnchor="middle"
                fontSize={11}
                fill="currentColor"
              >
                {t('admin.overview.graficas.embudo.valor', {
                  valor: formato.format(etapa.valor),
                  porcentaje: porcentaje(etapa.valor)
                })}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption>{t('admin.overview.graficas.embudo.pie')}</figcaption>
      <details>
        <summary>{t('admin.overview.preview.verDatos')}</summary>
        <table className="ad-table">
          <caption>{t('admin.overview.graficas.embudo.titulo')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('admin.overview.graficas.embudo.colEtapa')}</th>
              <th scope="col">{t('admin.overview.graficas.embudo.colPersonas')}</th>
              <th scope="col">{t('admin.overview.graficas.embudo.colTasa')}</th>
            </tr>
          </thead>
          <tbody>
            {serie.map((etapa) => (
              <tr key={etapa.clave}>
                <th scope="row">{t(`admin.overview.muestra.embudo.${etapa.clave}`)}</th>
                <td>{formato.format(etapa.valor)}</td>
                <td>{t('admin.overview.graficas.embudo.porcentaje', { porcentaje: porcentaje(etapa.valor) })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/* ------------------------------------------------------------------------- *
 * Gráfica 3 — Avance por programa (barras)
 * ------------------------------------------------------------------------- */

function GraficaProgramas({ formato }: { formato: Intl.NumberFormat }) {
  const { t } = useTranslation();
  const serie = DATOS_DE_MUESTRA.programas;
  /* El avance es un porcentaje: la escala se fija en 100 y no al máximo de la
     serie, porque si no un 81 % se dibujaría como una barra llena. */
  const techo = 100;
  /* La serie viene ordenada por inscritos, no por avance: el programa que
     encabeza la lista no es el de mayor avance, así que el resumen que lee un
     lector de pantalla se calcula aparte. */
  const mejor = serie.reduce((actual, programa) => (programa.avance > actual.avance ? programa : actual), serie[0]);

  const paso = UTIL.ancho / serie.length;
  const anchoBarra = Math.min(64, paso * 0.56);
  const y = (valor: number) => MARGEN.arriba + UTIL.alto * (1 - valor / techo);

  return (
    <figure className="ad-chart">
      <div className="ad-chart-head">
        <h4>{t('admin.overview.graficas.programas.titulo')}</h4>
        <span className="ad-preview-mark">{t('admin.overview.preview.marca')}</span>
      </div>
      <svg
        viewBox={`0 0 ${LIENZO.ancho} ${LIENZO.alto}`}
        width="100%"
        role="img"
        aria-label={t('admin.overview.graficas.programas.aria', {
          programas: serie.length,
          mejor: t(`admin.overview.muestra.programas.${mejor.clave}`),
          avance: mejor.avance
        })}
      >
        {marcasY(techo).map((valor) => (
          <g key={valor}>
            <line
              x1={MARGEN.izquierda}
              y1={y(valor)}
              x2={MARGEN.izquierda + UTIL.ancho}
              y2={y(valor)}
              stroke="currentColor"
              strokeWidth={1}
              strokeOpacity={valor === 0 ? 0.45 : 0.14}
            />
            <text x={MARGEN.izquierda - 8} y={y(valor) + 3} textAnchor="end" fontSize={10} fill="currentColor">
              {t('admin.overview.graficas.programas.porcentaje', { porcentaje: valor })}
            </text>
          </g>
        ))}

        {serie.map((programa, i) => {
          const centro = MARGEN.izquierda + paso * i + paso / 2;
          const color = `var(--ad-serie-${(i % 5) + 1})`;
          return (
            <g key={programa.clave}>
              <rect
                x={centro - anchoBarra / 2}
                y={y(programa.avance)}
                width={anchoBarra}
                height={MARGEN.arriba + UTIL.alto - y(programa.avance)}
                fill={color}
                fillOpacity={0.22}
                stroke={color}
                strokeWidth={1}
              />
              <text x={centro} y={y(programa.avance) - 7} textAnchor="middle" fontSize={10} fill="currentColor">
                {t('admin.overview.graficas.programas.porcentaje', { porcentaje: programa.avance })}
              </text>
              <text
                x={centro}
                y={MARGEN.arriba + UTIL.alto + 16}
                textAnchor="middle"
                fontSize={10}
                fill="currentColor"
              >
                {t(`admin.overview.muestra.programas.${programa.clave}`)}
              </text>
            </g>
          );
        })}

        <text
          x={12}
          y={MARGEN.arriba + UTIL.alto / 2}
          textAnchor="middle"
          fontSize={10}
          fill="currentColor"
          transform={`rotate(-90 12 ${MARGEN.arriba + UTIL.alto / 2})`}
        >
          {t('admin.overview.graficas.programas.ejeY')}
        </text>
        <text
          x={MARGEN.izquierda + UTIL.ancho / 2}
          y={LIENZO.alto - 8}
          textAnchor="middle"
          fontSize={10}
          fill="currentColor"
        >
          {t('admin.overview.graficas.programas.ejeX')}
        </text>
      </svg>
      <figcaption>{t('admin.overview.graficas.programas.pie')}</figcaption>
      <details>
        <summary>{t('admin.overview.preview.verDatos')}</summary>
        <table className="ad-table">
          <caption>{t('admin.overview.graficas.programas.titulo')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('admin.overview.graficas.programas.ejeX')}</th>
              <th scope="col">{t('admin.overview.graficas.programas.ejeY')}</th>
              <th scope="col">{t('admin.overview.graficas.programas.colInscritos')}</th>
            </tr>
          </thead>
          <tbody>
            {serie.map((programa) => (
              <tr key={programa.clave}>
                <th scope="row">{t(`admin.overview.muestra.programas.${programa.clave}`)}</th>
                <td>{t('admin.overview.graficas.programas.porcentaje', { porcentaje: programa.avance })}</td>
                <td>{formato.format(programa.inscritos)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/* ------------------------------------------------------------------------- *
 * Gráfica 4 — Actividad semanal (barras apiladas)
 * ------------------------------------------------------------------------- */

function GraficaActividad({
  etiquetasDia,
  formato
}: {
  etiquetasDia: string[];
  formato: Intl.NumberFormat;
}) {
  const { t } = useTranslation();
  const serie = DATOS_DE_MUESTRA.actividad;
  const totales = serie.map((d) => d.sesiones + d.entregas);
  const techo = techoEscala(Math.max(...totales));

  const paso = UTIL.ancho / serie.length;
  const anchoBarra = Math.min(48, paso * 0.5);
  const y = (valor: number) => MARGEN.arriba + UTIL.alto * (1 - valor / techo);
  const altoDe = (valor: number) => (valor / techo) * UTIL.alto;

  return (
    <figure className="ad-chart">
      <div className="ad-chart-head">
        <h4>{t('admin.overview.graficas.actividad.titulo')}</h4>
        <span className="ad-preview-mark">{t('admin.overview.preview.marca')}</span>
      </div>
      <svg
        viewBox={`0 0 ${LIENZO.ancho} ${LIENZO.alto}`}
        width="100%"
        role="img"
        aria-label={t('admin.overview.graficas.actividad.aria', {
          sesiones: formato.format(serie.reduce((s, d) => s + d.sesiones, 0)),
          entregas: formato.format(serie.reduce((s, d) => s + d.entregas, 0))
        })}
      >
        {marcasY(techo).map((valor) => (
          <g key={valor}>
            <line
              x1={MARGEN.izquierda}
              y1={y(valor)}
              x2={MARGEN.izquierda + UTIL.ancho}
              y2={y(valor)}
              stroke="currentColor"
              strokeWidth={1}
              strokeOpacity={valor === 0 ? 0.45 : 0.14}
            />
            <text x={MARGEN.izquierda - 8} y={y(valor) + 3} textAnchor="end" fontSize={10} fill="currentColor">
              {formato.format(valor)}
            </text>
          </g>
        ))}

        {serie.map((dia, i) => {
          const centro = MARGEN.izquierda + paso * i + paso / 2;
          const base = MARGEN.arriba + UTIL.alto;
          const altoSesiones = altoDe(dia.sesiones);
          const altoEntregas = altoDe(dia.entregas);
          return (
            <g key={dia.dia}>
              <rect
                x={centro - anchoBarra / 2}
                y={base - altoSesiones}
                width={anchoBarra}
                height={altoSesiones}
                fill="var(--ad-serie-2)"
                fillOpacity={0.24}
                stroke="var(--ad-serie-2)"
                strokeWidth={1}
              />
              <rect
                x={centro - anchoBarra / 2}
                y={base - altoSesiones - altoEntregas}
                width={anchoBarra}
                height={altoEntregas}
                fill="var(--ad-serie-4)"
                fillOpacity={0.24}
                stroke="var(--ad-serie-4)"
                strokeWidth={1}
              />
              <text
                x={centro}
                y={base - altoSesiones - altoEntregas - 7}
                textAnchor="middle"
                fontSize={10}
                fill="currentColor"
              >
                {formato.format(dia.sesiones + dia.entregas)}
              </text>
              <text x={centro} y={base + 16} textAnchor="middle" fontSize={10} fill="currentColor">
                {etiquetasDia[dia.dia]}
              </text>
            </g>
          );
        })}

        {/* Leyenda dentro del SVG: dos series apiladas no se distinguen sin ella. */}
        <g>
          <rect
            x={MARGEN.izquierda}
            y={LIENZO.alto - 16}
            width={9}
            height={9}
            fill="var(--ad-serie-2)"
            fillOpacity={0.24}
            stroke="var(--ad-serie-2)"
            strokeWidth={1}
          />
          <text x={MARGEN.izquierda + 14} y={LIENZO.alto - 8} fontSize={10} fill="currentColor">
            {t('admin.overview.muestra.series.sesiones')}
          </text>
          <rect
            x={MARGEN.izquierda + 130}
            y={LIENZO.alto - 16}
            width={9}
            height={9}
            fill="var(--ad-serie-4)"
            fillOpacity={0.24}
            stroke="var(--ad-serie-4)"
            strokeWidth={1}
          />
          <text x={MARGEN.izquierda + 144} y={LIENZO.alto - 8} fontSize={10} fill="currentColor">
            {t('admin.overview.muestra.series.entregas')}
          </text>
        </g>
      </svg>
      <figcaption>{t('admin.overview.graficas.actividad.pie')}</figcaption>
      <details>
        <summary>{t('admin.overview.preview.verDatos')}</summary>
        <table className="ad-table">
          <caption>{t('admin.overview.graficas.actividad.titulo')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('admin.overview.graficas.actividad.colDia')}</th>
              <th scope="col">{t('admin.overview.muestra.series.sesiones')}</th>
              <th scope="col">{t('admin.overview.muestra.series.entregas')}</th>
            </tr>
          </thead>
          <tbody>
            {serie.map((dia) => (
              <tr key={dia.dia}>
                <th scope="row">{etiquetasDia[dia.dia]}</th>
                <td>{formato.format(dia.sesiones)}</td>
                <td>{formato.format(dia.entregas)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/* ------------------------------------------------------------------------- *
 * Vista
 * ------------------------------------------------------------------------- */

type Props = {
  token: string;
  locale: 'es' | 'en';
};

type Semaforo = {
  clave: string;
  etiqueta: Etiqueta;
  /** Texto del badge ya resuelto; null cuando el dato no se pudo obtener. */
  valor: string | null;
  detalle: string | null;
};

export function OverviewView({ token, locale }: Props) {
  const { t } = useTranslation();

  const [estado, setEstado] = useState<Bloque<AdminStatus>>({ estado: 'cargando' });
  const [config, setConfig] = useState<Bloque<AdminConfig>>({ estado: 'cargando' });
  const [periodos, setPeriodos] = useState<Bloque<AcademicTermRecord[]>>({ estado: 'cargando' });
  const [programas, setProgramas] = useState<Bloque<DegreeProgram[]>>({ estado: 'cargando' });
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    setRecargando(true);
    /* Las cuatro llamadas van en paralelo y cada una se resuelve a su propio
       Bloque: el panel reparte permisos por sección, así que un rol con acceso
       al resumen puede no tenerlo a programas o a periodos. Un 403 ahí tiene
       que apagar ese bloque, no la pantalla. */
    const [s, c, p, g] = await Promise.all([
      bloqueDe(api.admin.status(token)),
      bloqueDe(api.admin.config(token)),
      bloqueDe(api.admin.terms(token)),
      bloqueDe(api.admin.degreePrograms(token))
    ]);
    setEstado(s);
    setConfig(c);
    setPeriodos(p);
    setProgramas(g);
    setRecargando(false);
  }, [token]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const formato = useMemo(
    () => new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-ES'),
    [locale]
  );

  /* Los nombres de mes y de día se sacan de Intl y no de las traducciones: son
     formato, no copia, y así no hay 19 claves que mantener en dos idiomas. */
  const etiquetasMes = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-ES', { month: 'short' });
    return Array.from({ length: 12 }, (_, mes) => fmt.format(new Date(2026, mes, 1)));
  }, [locale]);

  const etiquetasDia = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-ES', { weekday: 'short' });
    // 5 de enero de 2026 es lunes: la semana de la gráfica empieza ahí.
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2026, 0, 5 + i)));
  }, [locale]);

  const fechaCorta = useCallback(
    (iso: string | null | undefined): string | null => {
      if (!iso) return null;
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return null;
      return d.toLocaleDateString(locale === 'en' ? 'en-US' : 'es-ES', { dateStyle: 'medium' });
    },
    [locale]
  );

  const fechaHora = useCallback(
    (iso: string | null | undefined): string | null => {
      if (!iso) return null;
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return null;
      return d.toLocaleString(locale === 'en' ? 'en-US' : 'es-ES', {
        dateStyle: 'medium',
        timeStyle: 'short'
      });
    },
    [locale]
  );

  const entidades = estado.estado === 'ok' ? estado.datos.db.entities : null;
  const moodle = estado.estado === 'ok' ? estado.datos.moodle : null;

  /** Programas activos: el conteo del contrato es el de oferta vigente, no el histórico. */
  const totalProgramas =
    programas.estado === 'ok' ? programas.datos.filter((p) => p.is_active).length : null;

  const periodoActivo =
    periodos.estado === 'ok' ? (periodos.datos.find((p) => p.is_active) ?? null) : null;

  /**
   * Semáforos de la Zona 1.
   *
   * «Aulas listas» aparece a propósito como no disponible: ese dato vive en
   * `GET /admin/calendar/terms/:termId/shell-check`, que todavía no está en el
   * cliente compartido `lib/api.ts`. Enseñarlo en blanco con la nota es
   * correcto; rellenarlo con una estimación sería inventar estado operativo,
   * que es justo lo que este tablero no puede hacer.
   */
  const semaforos: Semaforo[] = useMemo(() => {
    const filas: Semaforo[] = [];

    if (estado.estado === 'ok') {
      filas.push({
        clave: 'basededatos',
        etiqueta: estado.datos.db.connected ? 'ok' : 'off',
        valor: t(`admin.overview.real.semaforos.conexion.${estado.datos.db.connected ? 'si' : 'no'}`),
        detalle: estado.datos.db.database
      });
    } else {
      filas.push({ clave: 'basededatos', etiqueta: 'off', valor: null, detalle: null });
    }

    // Si /admin/status cayó, /admin/config sigue sabiendo si Moodle está configurado.
    const configurado = moodle?.configured ?? (config.estado === 'ok' ? config.datos.moodle.configured : null);
    const baseUrl = moodle?.baseUrl ?? (config.estado === 'ok' ? config.datos.moodle.baseUrl : null);

    filas.push({
      clave: 'moodleConfigurado',
      etiqueta: configurado === null ? 'off' : configurado ? 'ok' : 'warn',
      valor:
        configurado === null
          ? null
          : t(`admin.overview.real.semaforos.conexion.${configurado ? 'si' : 'no'}`),
      detalle: baseUrl
    });

    filas.push({
      clave: 'moodleConectado',
      etiqueta: moodle === null ? 'off' : moodle.connected ? 'ok' : 'warn',
      valor:
        moodle === null ? null : t(`admin.overview.real.semaforos.conexion.${moodle.connected ? 'si' : 'no'}`),
      detalle: moodle?.error ?? null
    });

    if (periodos.estado === 'ok') {
      filas.push({
        clave: 'periodo',
        etiqueta: periodoActivo ? 'ok' : 'warn',
        valor: periodoActivo ? periodoActivo.name : t('admin.overview.real.semaforos.periodoSinActivo'),
        detalle:
          periodoActivo && fechaCorta(periodoActivo.start_date) && fechaCorta(periodoActivo.end_date)
            ? t('admin.overview.real.semaforos.periodoRango', {
                inicio: fechaCorta(periodoActivo.start_date),
                fin: fechaCorta(periodoActivo.end_date)
              })
            : null
      });
    } else {
      filas.push({ clave: 'periodo', etiqueta: 'off', valor: null, detalle: null });
    }

    filas.push({
      clave: 'aulasListas',
      etiqueta: 'off',
      valor: null,
      detalle: t('admin.overview.real.semaforos.aulasNota')
    });

    return filas;
  }, [estado, config, moodle, periodos, periodoActivo, fechaCorta, t]);

  const cargando =
    estado.estado === 'cargando' &&
    config.estado === 'cargando' &&
    periodos.estado === 'cargando' &&
    programas.estado === 'cargando';

  /** Nada que enseñar: la institución está recién montada o la API devolvió vacío. */
  const zonaRealVacia =
    estado.estado === 'ok' &&
    entidades !== null &&
    entidades.users === 0 &&
    entidades.moodleCourses === 0 &&
    entidades.userEnrollments === 0 &&
    (totalProgramas === null || totalProgramas === 0);

  const tiles: Array<{ clave: string; valor: number | null }> = [
    { clave: 'programas', valor: totalProgramas },
    { clave: 'cursos', valor: entidades?.moodleCourses ?? null },
    { clave: 'usuarios', valor: entidades?.users ?? null },
    { clave: 'matriculas', valor: entidades?.userEnrollments ?? null }
  ];

  const tilesSecundarios: Array<{ clave: string; valor: number | null }> = [
    { clave: 'empresas', valor: entidades?.companies ?? null },
    { clave: 'categorias', valor: entidades?.moodleCategories ?? null },
    { clave: 'webinars', valor: entidades?.webinars ?? null },
    { clave: 'podcasts', valor: entidades?.podcasts ?? null }
  ];

  const ultimaSincronizacion = fechaHora(moodle?.lastCoursesSync?.syncedAt ?? null);

  return (
    <section>
      {/* ------------------------------------------------------------------ *
       * Zona 1 — Estado operativo. Datos reales de la API.
       * ------------------------------------------------------------------ */}
      <div className="ad-card">
        <div className="ad-card-head">
          <h2>{t('admin.overview.titulo')}</h2>
          <p>{t('admin.overview.descripcion')}</p>
        </div>
        <div className="ad-card-body">
          <div className="ad-toolbar">
            <button type="button" className="ad-btn ad-btn-ghost" disabled={recargando} onClick={() => void cargar()}>
              {t(`admin.overview.estado.${recargando ? 'actualizando' : 'actualizar'}`)}
            </button>
          </div>
        </div>
      </div>

      {cargando ? (
        <div className="ad-card">
          <div className="ad-card-body">
            <p className="ad-empty">{t('admin.overview.estado.cargando')}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="ad-card">
            <div className="ad-card-head">
              <h3>{t('admin.overview.real.titulo')}</h3>
              <p>{t('admin.overview.real.descripcion')}</p>
            </div>
            <div className="ad-card-body">
              {estado.estado === 'sin-datos' ? (
                <p className="ad-note" role="alert">
                  {t(`admin.overview.estado.${estado.motivo === 'permiso' ? 'sinPermiso' : 'errorCarga'}`)}
                </p>
              ) : null}

              <div className="ad-grid ad-grid-4">
                {tiles.map((tile) => (
                  <div className="ad-stat" key={tile.clave}>
                    <span className="ad-stat-valor">
                      {tile.valor === null ? t('admin.overview.estado.sinDato') : formato.format(tile.valor)}
                    </span>
                    <span className="ad-stat-etiqueta">{t(`admin.overview.real.tiles.${tile.clave}`)}</span>
                  </div>
                ))}
              </div>

              <div className="ad-grid ad-grid-4">
                {tilesSecundarios.map((tile) => (
                  <div className="ad-stat" key={tile.clave}>
                    <span className="ad-stat-valor">
                      {tile.valor === null ? t('admin.overview.estado.sinDato') : formato.format(tile.valor)}
                    </span>
                    <span className="ad-stat-etiqueta">{t(`admin.overview.real.tiles.${tile.clave}`)}</span>
                  </div>
                ))}
              </div>

              {programas.estado === 'sin-datos' ? (
                <p className="ad-note">
                  {t(
                    `admin.overview.real.programasNoDisponible.${
                      programas.motivo === 'permiso' ? 'permiso' : 'error'
                    }`
                  )}
                </p>
              ) : null}

              {zonaRealVacia ? <p className="ad-empty">{t('admin.overview.real.vacio')}</p> : null}
            </div>
          </div>

          <div className="ad-card">
            <div className="ad-card-head">
              <h3>{t('admin.overview.real.semaforos.titulo')}</h3>
              <p>{t('admin.overview.real.semaforos.descripcion')}</p>
            </div>
            <div className="ad-card-body">
              <table className="ad-table">
                <thead>
                  <tr>
                    <th scope="col">{t('admin.overview.real.semaforos.colIndicador')}</th>
                    <th scope="col">{t('admin.overview.real.semaforos.colEstado')}</th>
                    <th scope="col">{t('admin.overview.real.semaforos.colDetalle')}</th>
                  </tr>
                </thead>
                <tbody>
                  {semaforos.map((fila) => (
                    <tr key={fila.clave}>
                      <th scope="row">{t(`admin.overview.real.semaforos.${fila.clave}`)}</th>
                      <td>
                        <span className={`ad-semaforo ad-semaforo-${fila.etiqueta}`} aria-hidden="true" />
                        <span className={`ad-badge ad-badge-${fila.etiqueta}`}>
                          {fila.valor ?? t('admin.overview.estado.noDisponible')}
                        </span>
                      </td>
                      <td>{fila.detalle ?? t('admin.overview.estado.sinDato')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p className="ad-note">
                {ultimaSincronizacion
                  ? t('admin.overview.real.semaforos.ultimaSync', { fecha: ultimaSincronizacion })
                  : t('admin.overview.real.semaforos.sinSync')}
              </p>
            </div>
          </div>
        </>
      )}

      {/* ------------------------------------------------------------------ *
       * Zona 2 — Vista previa analítica. Datos de muestra, Etapa V.
       * ------------------------------------------------------------------ */}
      <div className="ad-preview-banner" role="note">
        <strong>{t('admin.overview.preview.banner.titulo')}</strong>
        <p>{t('admin.overview.preview.banner.cuerpo')}</p>
        <p>{t('admin.overview.preview.banner.aviso')}</p>
      </div>

      <div className="ad-card">
        <div className="ad-card-head">
          <h3>{t('admin.overview.preview.titulo')}</h3>
          <p>{t('admin.overview.preview.descripcion')}</p>
        </div>
        <div className="ad-card-body">
          <div className="ad-grid ad-grid-2">
            <GraficaMatriculas etiquetasMes={etiquetasMes} formato={formato} />
            <GraficaEmbudo formato={formato} />
            <GraficaProgramas formato={formato} />
            <GraficaActividad etiquetasDia={etiquetasDia} formato={formato} />
          </div>
          <p className="ad-note">{t('admin.overview.preview.cierre')}</p>
        </div>
      </div>
    </section>
  );
}

export default OverviewView;
