import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  api,
  type AdminPanelUser,
  type AdminRole,
  type AdminRouteRegistry,
  type AdminUser,
  type DegreeProgram,
  type MoodleCoursesResponse,
  type PodcastRecord,
  type WebinarRecord
} from '../../../lib/api';

/**
 * Sección de reportes del panel administrativo.
 *
 * La vista está partida en dos mitades que no se mezclan nunca, y la razón es
 * contractual antes que estética:
 *
 *   Reportes operativos — inventarios de lo que la plataforma YA tiene
 *     registrado. Salen de `api.admin.*`, se filtran y se ordenan de verdad y
 *     se exportan a CSV. Son los entregables de las etapas en curso.
 *
 *   Vista previa analítica — tasas de conversión históricas, tendencias y
 *     retención. Eso es Etapa V (enero de 2027) y hoy NO hay endpoints ni
 *     histórico del que calcularlo. Se muestra con datos de muestra y rotulado
 *     como tal.
 *
 * Esta pantalla se enseña en reuniones con el cliente, así que la mitad de
 * muestra lleva banner, marca por bloque y, a propósito, NO deja exportar: un
 * CSV de muestra que salga de aquí pierde el rótulo en el camino y acaba
 * circulando como si fueran cifras de la institución.
 *
 * Todo lo que se pide a la API pasa por `bloqueDe`, de modo que un 403 en un
 * reporte concreto apaga ese bloque y deja el resto de la pantalla viva. El
 * panel reparte permisos por sección: un rol con acceso a reportes puede no
 * tener acceso a programas, a usuarios o al registro de rutas.
 */

/* ------------------------------------------------------------------------- *
 * Estados de carga
 * ------------------------------------------------------------------------- */

/** Motivo normalizado por el que un bloque se quedó sin datos. */
type Motivo = 'permiso' | 'error';

/**
 * Un reporte siempre está en uno de estos estados. Se modela explícito para
 * que la plantilla no tenga que adivinar si un arreglo vacío significa
 * "todavía no se ha pedido", "sin permiso" o "de verdad no hay filas".
 */
type Bloque<T> =
  | { estado: 'pendiente' }
  | { estado: 'cargando' }
  | { estado: 'ok'; datos: T }
  | { estado: 'sin-datos'; motivo: Motivo };

/**
 * Distingue un 401/403 de una caída real.
 *
 * `fetchJson` lanza un Error cuyo mensaje empieza por "Request failed: <código>",
 * así que el código se lee del texto. Es frágil comparado con mirar el status,
 * pero el cliente compartido no lo expone y esta vista no puede modificarlo.
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
 * Exportación a CSV
 * ------------------------------------------------------------------------- */

/**
 * Tope de filas que se piden a los endpoints paginados.
 *
 * El servidor acepta hasta 10 000, pero traerlo todo de golpe para pintar una
 * tabla en pantalla es gratuito sólo en instituciones pequeñas. Se pide este
 * tope y, si el total declarado por la API es mayor, el reporte lo dice en su
 * nota: es mejor un CSV con el alcance escrito que uno que parezca completo.
 */
const TOPE_FILAS = 1000;

/**
 * Prepara un valor para una celda de CSV.
 *
 * Se entrecomilla en cuanto aparece una comilla, una coma, un punto y coma o un
 * salto de línea, y las comillas internas se duplican, que es lo que manda
 * RFC 4180. El punto y coma entra en la lista aunque el separador sea la coma
 * porque Excel en configuración regional española lo usa como separador y, sin
 * entrecomillar, partiría la celda al reabrir el archivo.
 */
function celdaCsv(valor: string): string {
  // Un valor que empieza por = + @ o un tabulador se interpreta como fórmula al
  // abrir el archivo en Excel o en Sheets. Se neutraliza con un apóstrofo
  // delante, que esas hojas de cálculo leen como "esto es texto".
  const texto = /^[=+@\t]/.test(valor) ? `'${valor}` : valor;
  if (/[",;\n\r]/.test(texto)) {
    return `"${texto.replace(/"/g, '""')}"`;
  }
  return texto;
}

/** Une cabeceras y filas en un documento CSV con saltos de línea CRLF (RFC 4180). */
function construirCsv(cabeceras: string[], filas: string[][]): string {
  const lineas = [cabeceras, ...filas].map((fila) => fila.map(celdaCsv).join(','));
  return lineas.join('\r\n');
}

/**
 * Lanza la descarga del CSV desde el propio navegador, sin pasar por el
 * servidor y sin ninguna librería.
 *
 * El BOM (﻿) va delante a propósito: sin él, Excel lee el archivo como
 * ANSI y los acentos y las eñes salen partidos, que en una plataforma en
 * español ocurre en la primera columna de nombres.
 */
function descargarCsv(nombreArchivo: string, contenido: string): void {
  const blob = new Blob([`﻿${contenido}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombreArchivo;
  enlace.rel = 'noopener';
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  // Se revoca en el siguiente turno del bucle de eventos: revocarlo en la misma
  // línea cancela la descarga en algunos navegadores antes de que arranque.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Fecha de hoy en ISO corto, para el nombre del archivo exportado. */
function fechaDeHoy(): string {
  const hoy = new Date();
  const mes = String(hoy.getMonth() + 1).padStart(2, '0');
  const dia = String(hoy.getDate()).padStart(2, '0');
  return `${hoy.getFullYear()}-${mes}-${dia}`;
}

/* ------------------------------------------------------------------------- *
 * Motor genérico de reportes
 * ------------------------------------------------------------------------- */

type Direccion = 'asc' | 'desc';

type Columna<T> = {
  clave: string;
  etiqueta: string;
  /** Texto plano de la celda. Es también lo que se escribe en el CSV. */
  texto: (fila: T) => string;
  /**
   * Clave de ordenación cuando no coincide con el texto mostrado: fechas, que
   * se ordenan por el ISO y no por "10 de octubre", y números, que se ordenan
   * por su valor y no por sus dígitos.
   */
  orden?: (fila: T) => string | number;
  /** Celda enriquecida (badges). Si falta se pinta `texto`. */
  render?: (fila: T) => ReactNode;
  /** La primera columna identifica la fila, así que va como `th scope="row"`. */
  cabeceraDeFila?: boolean;
  /** Las columnas sin orden natural no ofrecen botón de ordenación. */
  ordenable?: boolean;
};

type FiltroDef<T> = {
  clave: string;
  etiqueta: string;
  /** La opción "todas" la añade la tabla; aquí van sólo los valores concretos. */
  opciones: Array<{ valor: string; etiqueta: string }>;
  aplica: (fila: T, valor: string) => boolean;
};

type ReporteProps<T> = {
  /** Id estable: compone los `id` de los controles y el nombre del CSV. */
  id: string;
  titulo: string;
  descripcion: string;
  bloque: Bloque<T[]>;
  columnas: Array<Columna<T>>;
  filtros?: Array<FiltroDef<T>>;
  /** Texto en el que busca el cuadro de búsqueda. */
  busqueda: (fila: T) => string;
  /** Clave de React para cada fila. */
  claveFila: (fila: T) => string;
  locale: 'es' | 'en';
  /** Nota al pie: alcance de la carga, origen del dato, advertencias. */
  nota?: string | null;
  /** Controles extra de la barra (acciones que escriben, ya filtradas por permiso). */
  acciones?: ReactNode;
  /**
   * Se pone en false en los bloques de muestra. Un CSV pierde el rótulo de
   * "datos de muestra" en cuanto sale de la pantalla, así que ahí no se ofrece.
   */
  permitirExportar?: boolean;
  onReintentar?: () => void;
};

function ReporteTabla<T>({
  id,
  titulo,
  descripcion,
  bloque,
  columnas,
  filtros,
  busqueda,
  claveFila,
  locale,
  nota,
  acciones,
  permitirExportar = true,
  onReintentar
}: ReporteProps<T>) {
  const { t } = useTranslation();

  const [texto, setTexto] = useState('');
  /** Valor elegido en cada filtro; '' es la opción "todas". */
  const [seleccion, setSeleccion] = useState<Record<string, string>>({});
  const [orden, setOrden] = useState<{ columna: string; direccion: Direccion } | null>(null);

  /**
   * Comparador de texto sensible al idioma.
   *
   * `localeCompare` directo ordenaría "Álvarez" después de "Zapata" en español.
   * `numeric` además hace que "Curso 2" vaya antes de "Curso 10".
   */
  const colacion = useMemo(
    () => new Intl.Collator(locale === 'en' ? 'en-US' : 'es-ES', { numeric: true, sensitivity: 'base' }),
    [locale]
  );

  const todas: T[] = bloque.estado === 'ok' ? bloque.datos : [];

  const visibles = useMemo(() => {
    const aguja = texto.trim().toLocaleLowerCase(locale === 'en' ? 'en-US' : 'es-ES');

    let filas = todas.filter((fila) => {
      if (aguja && !busqueda(fila).toLocaleLowerCase(locale === 'en' ? 'en-US' : 'es-ES').includes(aguja)) {
        return false;
      }
      for (const filtro of filtros ?? []) {
        const valor = seleccion[filtro.clave];
        if (valor && !filtro.aplica(fila, valor)) return false;
      }
      return true;
    });

    if (orden) {
      const columna = columnas.find((col) => col.clave === orden.columna);
      if (columna) {
        const clave = columna.orden ?? columna.texto;
        const signo = orden.direccion === 'asc' ? 1 : -1;
        // Se copia antes de ordenar: `filas` puede ser el mismo arreglo que
        // llegó de la API si no había ni búsqueda ni filtros activos.
        filas = [...filas].sort((a, b) => {
          const va = clave(a);
          const vb = clave(b);
          if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * signo;
          return colacion.compare(String(va), String(vb)) * signo;
        });
      }
    }

    return filas;
  }, [todas, texto, seleccion, orden, columnas, filtros, busqueda, colacion, locale]);

  const alternarOrden = useCallback((clave: string) => {
    setOrden((previo) => {
      if (!previo || previo.columna !== clave) return { columna: clave, direccion: 'asc' };
      // Tercer clic: se vuelve al orden en que llegó de la API.
      if (previo.direccion === 'asc') return { columna: clave, direccion: 'desc' };
      return null;
    });
  }, []);

  const exportar = useCallback(() => {
    // Se exporta exactamente lo que hay en pantalla, con sus filtros y su
    // orden. Exportar el conjunto completo cuando se ve uno filtrado sorprende
    // a quien acaba de acotar la tabla a propósito.
    const cabeceras = columnas.map((col) => col.etiqueta);
    const filas = visibles.map((fila) => columnas.map((col) => col.texto(fila)));
    descargarCsv(`${id}-${fechaDeHoy()}.csv`, construirCsv(cabeceras, filas));
  }, [columnas, visibles, id]);

  const hayFiltrosActivos = texto.trim().length > 0 || Object.values(seleccion).some((valor) => !!valor);

  return (
    <div className="ad-card">
      <div className="ad-card-head">
        <h3>{titulo}</h3>
        <p>{descripcion}</p>
      </div>
      <div className="ad-card-body">
        {bloque.estado === 'cargando' || bloque.estado === 'pendiente' ? (
          <p className="ad-empty">{t('admin.reports.estado.cargando')}</p>
        ) : bloque.estado === 'sin-datos' ? (
          <>
            <p className="ad-note" role="alert">
              {t(`admin.reports.estado.${bloque.motivo === 'permiso' ? 'sinPermiso' : 'errorCarga'}`)}
            </p>
            {bloque.motivo === 'error' && onReintentar ? (
              <div className="ad-toolbar">
                <button type="button" className="ad-btn ad-btn-ghost" onClick={onReintentar}>
                  {t('admin.reports.estado.reintentar')}
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="ad-toolbar">
              <div className="ad-field">
                <label htmlFor={`${id}-busqueda`}>{t('admin.reports.tabla.buscar')}</label>
                <input
                  id={`${id}-busqueda`}
                  className="ad-input"
                  type="search"
                  value={texto}
                  placeholder={t('admin.reports.tabla.buscarPista')}
                  onChange={(evento) => setTexto(evento.target.value)}
                />
              </div>

              {(filtros ?? []).map((filtro) => (
                <div className="ad-field" key={filtro.clave}>
                  <label htmlFor={`${id}-${filtro.clave}`}>{filtro.etiqueta}</label>
                  <select
                    id={`${id}-${filtro.clave}`}
                    className="ad-select"
                    value={seleccion[filtro.clave] ?? ''}
                    onChange={(evento) =>
                      setSeleccion((previo) => ({ ...previo, [filtro.clave]: evento.target.value }))
                    }
                  >
                    <option value="">{t('admin.reports.tabla.todas')}</option>
                    {filtro.opciones.map((opcion) => (
                      <option value={opcion.valor} key={opcion.valor}>
                        {opcion.etiqueta}
                      </option>
                    ))}
                  </select>
                </div>
              ))}

              {acciones}

              {permitirExportar ? (
                <button
                  type="button"
                  className="ad-btn ad-btn-primary"
                  disabled={visibles.length === 0}
                  onClick={exportar}
                >
                  {t('admin.reports.tabla.exportar')}
                </button>
              ) : null}
            </div>

            <p className="ad-note" role="status">
              {hayFiltrosActivos
                ? t('admin.reports.tabla.contadorFiltrado', { visibles: visibles.length, total: todas.length })
                : t('admin.reports.tabla.contador', { count: todas.length })}
            </p>

            {todas.length === 0 ? (
              <p className="ad-empty">{t('admin.reports.tabla.vacio')}</p>
            ) : visibles.length === 0 ? (
              <p className="ad-empty">{t('admin.reports.tabla.sinCoincidencias')}</p>
            ) : (
              <div className="ad-table-wrap">
                <table className="ad-table">
                  <caption>{titulo}</caption>
                  <thead>
                    <tr>
                      {columnas.map((columna) => {
                        const ordenable = columna.ordenable !== false;
                        const activa = orden?.columna === columna.clave;
                        return (
                          <th
                            scope="col"
                            key={columna.clave}
                            /* `aria-sort` sólo va en las columnas que de verdad
                               se pueden ordenar: un "none" en una columna fija
                               le anuncia al lector de pantalla una ordenación
                               que no existe. */
                            aria-sort={
                              !ordenable
                                ? undefined
                                : activa
                                  ? orden?.direccion === 'asc'
                                    ? 'ascending'
                                    : 'descending'
                                  : 'none'
                            }
                          >
                            {ordenable ? (
                              <button
                                type="button"
                                className="ad-sortable"
                                onClick={() => alternarOrden(columna.clave)}
                              >
                                {columna.etiqueta}
                              </button>
                            ) : (
                              columna.etiqueta
                            )}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {visibles.map((fila) => (
                      <tr key={claveFila(fila)}>
                        {columnas.map((columna) =>
                          columna.cabeceraDeFila ? (
                            <th scope="row" key={columna.clave}>
                              {columna.render ? columna.render(fila) : columna.texto(fila)}
                            </th>
                          ) : (
                            <td key={columna.clave}>
                              {columna.render ? columna.render(fila) : columna.texto(fila)}
                            </td>
                          )
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {nota ? <p className="ad-note">{nota}</p> : null}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * Datos de muestra — vista previa de Etapa V
 * ------------------------------------------------------------------------- */

/**
 * Cifras inventadas cuya única función es dar forma a los reportes analíticos.
 *
 * En Etapa V esta constante se sustituye por las respuestas de los endpoints
 * analíticos; las tablas y la gráfica no deberían necesitar cambios, sólo el
 * origen de estas series. Los órdenes de magnitud son plausibles para que la
 * maqueta se lea bien, pero NO describen a ninguna institución.
 */
const MUESTRA = {
  /** Embudo de admisiones por periodo. Cada etapa es subconjunto de la anterior. */
  conversion: [
    { periodo: '2026-1', interesados: 2400, solicitudes: 980, admitidos: 520, matriculados: 365 },
    { periodo: '2026-2', interesados: 2710, solicitudes: 1105, admitidos: 604, matriculados: 431 },
    { periodo: '2026-3', interesados: 2185, solicitudes: 845, admitidos: 462, matriculados: 318 }
  ],
  /** Matrículas nuevas por mes de un año académico completo. */
  tendencia: [
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
  /** Retención por cohorte, en porcentaje de la cohorte original. */
  retencion: [
    { cohorte: '2025-1', inicial: 312, mes3: 88, mes6: 79, mes12: 71 },
    { cohorte: '2025-2', inicial: 287, mes3: 91, mes6: 83, mes12: 74 },
    { cohorte: '2025-3', inicial: 344, mes3: 86, mes6: 76, mes12: 68 },
    { cohorte: '2026-1', inicial: 365, mes3: 93, mes6: 85, mes12: 0 }
  ]
} as const;

/* Lienzo fijo con `viewBox`: el SVG escala con el ancho del contenedor sin que
   haya que medir nada en JavaScript ni redibujar al cambiar el tamaño. */
const LIENZO = { ancho: 640, alto: 240 };
const MARGEN = { arriba: 20, derecha: 16, abajo: 38, izquierda: 52 };
const UTIL = {
  ancho: LIENZO.ancho - MARGEN.izquierda - MARGEN.derecha,
  alto: LIENZO.alto - MARGEN.arriba - MARGEN.abajo
};
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

/**
 * Tendencia de matrículas de muestra, dibujada en SVG a mano.
 *
 * Se dibuja a mano y no con una librería de gráficas a propósito: montar esa
 * dependencia para una maqueta deja deuda que habría que mantener hasta
 * Etapa V, cuando el tablero definitivo probablemente use otra cosa.
 */
function GraficaTendencia({
  etiquetasMes,
  formato
}: {
  etiquetasMes: string[];
  formato: Intl.NumberFormat;
}) {
  const { t } = useTranslation();
  const serie = MUESTRA.tendencia;
  const techo = techoEscala(Math.max(...serie.map((punto) => punto.valor)));
  const marcas = Array.from({ length: DIVISIONES_Y + 1 }, (_, i) => (techo / DIVISIONES_Y) * i);

  const x = (i: number) => MARGEN.izquierda + (UTIL.ancho / (serie.length - 1)) * i;
  const y = (valor: number) => MARGEN.arriba + UTIL.alto * (1 - valor / techo);

  const linea = serie.map((punto, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(punto.valor)}`).join(' ');
  const total = serie.reduce((suma, punto) => suma + punto.valor, 0);
  const pico = serie.reduce((mejor, punto) => (punto.valor > mejor.valor ? punto : mejor), serie[0]);

  return (
    <figure className="ad-chart">
      <div className="ad-chart-head">
        <h4>{t('admin.reports.previa.tendencia.titulo')}</h4>
        <span className="ad-preview-mark">{t('admin.reports.previa.marca')}</span>
      </div>
      <svg
        viewBox={`0 0 ${LIENZO.ancho} ${LIENZO.alto}`}
        width="100%"
        role="img"
        aria-label={t('admin.reports.previa.tendencia.aria', {
          total: formato.format(total),
          mes: etiquetasMes[pico.mes],
          pico: formato.format(pico.valor)
        })}
      >
        {/* Rejilla y rótulos del eje vertical. */}
        {marcas.map((valor) => (
          <g key={valor}>
            <line
              x1={MARGEN.izquierda}
              x2={MARGEN.izquierda + UTIL.ancho}
              y1={y(valor)}
              y2={y(valor)}
              stroke="currentColor"
              strokeWidth={0.5}
              opacity={0.25}
            />
            <text
              x={MARGEN.izquierda - 8}
              y={y(valor) + 3}
              fontSize={10}
              textAnchor="end"
              fill="currentColor"
            >
              {formato.format(Math.round(valor))}
            </text>
          </g>
        ))}

        <path d={linea} fill="none" stroke="var(--ad-serie-1)" strokeWidth={2} />
        {serie.map((punto, i) => (
          <circle key={punto.mes} cx={x(i)} cy={y(punto.valor)} r={2.5} fill="var(--ad-serie-1)" />
        ))}

        {/* Rótulos del eje horizontal: uno cada dos meses para que no se pisen. */}
        {serie.map((punto, i) =>
          i % 2 === 0 ? (
            <text
              key={punto.mes}
              x={x(i)}
              y={LIENZO.alto - 20}
              fontSize={10}
              textAnchor="middle"
              fill="currentColor"
            >
              {etiquetasMes[punto.mes]}
            </text>
          ) : null
        )}
      </svg>
      <figcaption>{t('admin.reports.previa.tendencia.pie')}</figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------------- *
 * Vista
 * ------------------------------------------------------------------------- */

type Props = {
  token: string;
  locale: 'es' | 'en';
  /** Si es false, la vista no ofrece acciones que escriban; exportar sí se permite. */
  puedeEditar: boolean;
};

type Pestana = 'academico' | 'personas' | 'contenido' | 'tecnico' | 'previa';

const PESTANAS: Pestana[] = ['academico', 'personas', 'contenido', 'tecnico', 'previa'];

/** Qué reportes hace falta haber cargado para pintar cada pestaña. */
const DATOS_POR_PESTANA: Record<Pestana, Array<keyof Datos>> = {
  academico: ['programas', 'cursos'],
  personas: ['usuarios', 'panel', 'roles'],
  contenido: ['webinars', 'podcasts'],
  tecnico: ['rutas'],
  previa: []
};

type Datos = {
  programas: Bloque<DegreeProgram[]>;
  cursos: Bloque<MoodleCoursesResponse>;
  usuarios: Bloque<AdminUser[]>;
  panel: Bloque<AdminPanelUser[]>;
  roles: Bloque<AdminRole[]>;
  webinars: Bloque<WebinarRecord[]>;
  podcasts: Bloque<PodcastRecord[]>;
  rutas: Bloque<AdminRouteRegistry>;
};

const DATOS_INICIALES: Datos = {
  programas: { estado: 'pendiente' },
  cursos: { estado: 'pendiente' },
  usuarios: { estado: 'pendiente' },
  panel: { estado: 'pendiente' },
  roles: { estado: 'pendiente' },
  webinars: { estado: 'pendiente' },
  podcasts: { estado: 'pendiente' },
  rutas: { estado: 'pendiente' }
};

/** Niveles de titulación que declara `DegreeProgram.degree_level`. */
const NIVELES: DegreeProgram['degree_level'][] = [
  'certificate',
  'associate',
  'bachelor',
  'master',
  'doctoral',
  'professional'
];

/** Orígenes de vídeo que declara `WebinarRecord.source_type`. */
const ORIGENES: WebinarRecord['source_type'][] = ['youtube', 'external', 'hls', 'vimeo', 'zoom'];

export function ReportsView({ token, locale, puedeEditar }: Props) {
  const { t } = useTranslation();

  const [pestana, setPestana] = useState<Pestana>('academico');
  const [datos, setDatos] = useState<Datos>(DATOS_INICIALES);
  /** Paginación declarada por la API, para saber si la carga se quedó corta. */
  const [totales, setTotales] = useState<{ usuarios: number | null; cursos: number | null }>({
    usuarios: null,
    cursos: null
  });
  const [sincronizando, setSincronizando] = useState(false);
  const [avisoSync, setAvisoSync] = useState<string | null>(null);
  const [errorSync, setErrorSync] = useState<string | null>(null);

  /**
   * Carga de un reporte concreto.
   *
   * Cada reporte se pide por separado y guarda su propio Bloque. Así un 403 en
   * programas no arrastra a cursos, y la pantalla puede mostrar la mitad que
   * el rol sí tiene permitida.
   */
  const cargarUno = useCallback(
    async (cual: keyof Datos) => {
      setDatos((previo) => ({ ...previo, [cual]: { estado: 'cargando' } }));

      switch (cual) {
        case 'programas': {
          const bloque = await bloqueDe(api.admin.degreePrograms(token));
          setDatos((previo) => ({ ...previo, programas: bloque }));
          break;
        }
        case 'cursos': {
          const bloque = await bloqueDe(
            api.admin.moodleCoursesPage(token, { page: 1, pageSize: TOPE_FILAS })
          );
          setDatos((previo) => ({ ...previo, cursos: bloque }));
          setTotales((previo) => ({
            ...previo,
            cursos: bloque.estado === 'ok' ? bloque.datos.pagination.total : null
          }));
          break;
        }
        case 'usuarios': {
          const bloque = await bloqueDe(
            api.admin.usersPage(token, { page: 1, pageSize: TOPE_FILAS })
          );
          setDatos((previo) => ({
            ...previo,
            usuarios:
              bloque.estado === 'ok' ? { estado: 'ok', datos: bloque.datos.items } : bloque
          }));
          setTotales((previo) => ({
            ...previo,
            usuarios: bloque.estado === 'ok' ? bloque.datos.pagination.total : null
          }));
          break;
        }
        case 'panel': {
          const bloque = await bloqueDe(api.admin.iam.users(token));
          setDatos((previo) => ({
            ...previo,
            panel: bloque.estado === 'ok' ? { estado: 'ok', datos: bloque.datos.users } : bloque
          }));
          break;
        }
        case 'roles': {
          // Los roles no son un reporte: alimentan el filtro por rol del
          // reporte de usuarios del panel. Si fallan, ese filtro sale vacío y
          // la tabla sigue funcionando.
          const bloque = await bloqueDe(api.admin.iam.roles(token));
          setDatos((previo) => ({
            ...previo,
            roles: bloque.estado === 'ok' ? { estado: 'ok', datos: bloque.datos.roles } : bloque
          }));
          break;
        }
        case 'webinars': {
          const bloque = await bloqueDe(api.admin.webinars(token));
          setDatos((previo) => ({ ...previo, webinars: bloque }));
          break;
        }
        case 'podcasts': {
          const bloque = await bloqueDe(api.admin.podcasts(token));
          setDatos((previo) => ({ ...previo, podcasts: bloque }));
          break;
        }
        case 'rutas': {
          const bloque = await bloqueDe(api.admin.routes(token));
          setDatos((previo) => ({ ...previo, rutas: bloque }));
          break;
        }
      }
    },
    [token]
  );

  /**
   * Los reportes se cargan al abrir su pestaña y no todos al entrar.
   *
   * Son ocho llamadas; lanzarlas juntas al montar castiga la primera pintura
   * para traer tablas que quizá nadie abra. Lo ya cargado se conserva en
   * `datos`, así que volver a una pestaña no vuelve a pedir nada.
   */
  useEffect(() => {
    for (const cual of DATOS_POR_PESTANA[pestana]) {
      if (datos[cual].estado === 'pendiente') {
        void cargarUno(cual);
      }
    }
  }, [pestana, datos, cargarUno]);

  /** Vuelve a pedir todos los reportes de la pestaña abierta. */
  const recargarPestana = useCallback(() => {
    for (const cual of DATOS_POR_PESTANA[pestana]) {
      void cargarUno(cual);
    }
  }, [pestana, cargarUno]);

  const formato = useMemo(
    () => new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-ES'),
    [locale]
  );

  /* Los nombres de mes se sacan de Intl y no de las traducciones: son formato,
     no copia, y así no hay doce claves que mantener en dos idiomas. */
  const etiquetasMes = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-ES', { month: 'short' });
    return Array.from({ length: 12 }, (_, mes) => fmt.format(new Date(2026, mes, 1)));
  }, [locale]);

  const sinDato = t('admin.reports.estado.sinDato');

  const fechaCorta = useCallback(
    (iso: string | null | undefined): string => {
      if (!iso) return sinDato;
      const fecha = new Date(iso);
      if (Number.isNaN(fecha.getTime())) return sinDato;
      return fecha.toLocaleDateString(locale === 'en' ? 'en-US' : 'es-ES', { dateStyle: 'medium' });
    },
    [locale, sinDato]
  );

  const fechaHora = useCallback(
    (iso: string | null | undefined): string => {
      if (!iso) return sinDato;
      const fecha = new Date(iso);
      if (Number.isNaN(fecha.getTime())) return sinDato;
      return fecha.toLocaleString(locale === 'en' ? 'en-US' : 'es-ES', {
        dateStyle: 'medium',
        timeStyle: 'short'
      });
    },
    [locale, sinDato]
  );

  /**
   * Clave de ordenación para una fecha.
   *
   * Devuelve el milisegundo para que la columna se ordene cronológicamente y no
   * alfabéticamente por "10 de octubre". Lo vacío va al final en ascendente.
   */
  const ordenFecha = useCallback((iso: string | null | undefined): number => {
    if (!iso) return Number.POSITIVE_INFINITY;
    const fecha = new Date(iso);
    return Number.isNaN(fecha.getTime()) ? Number.POSITIVE_INFINITY : fecha.getTime();
  }, []);

  const si = t('admin.reports.comun.si');
  const no = t('admin.reports.comun.no');

  /** Badge de sí/no, que es la forma de media docena de columnas booleanas. */
  const badgeBooleano = useCallback(
    (valor: boolean) => (
      <span className={`ad-badge ad-badge-${valor ? 'ok' : 'off'}`}>{valor ? si : no}</span>
    ),
    [si, no]
  );

  /* --------------------------------------------------------------------- *
   * Reporte: inventario de programas académicos
   * --------------------------------------------------------------------- */

  const columnasProgramas = useMemo<Array<Columna<DegreeProgram>>>(
    () => [
      {
        clave: 'code',
        etiqueta: t('admin.reports.programas.colCodigo'),
        texto: (fila) => fila.code,
        cabeceraDeFila: true
      },
      { clave: 'name', etiqueta: t('admin.reports.programas.colNombre'), texto: (fila) => fila.name },
      {
        clave: 'nivel',
        etiqueta: t('admin.reports.programas.colNivel'),
        texto: (fila) => t(`admin.reports.niveles.${fila.degree_level}`)
      },
      {
        clave: 'creditos',
        etiqueta: t('admin.reports.programas.colCreditos'),
        texto: (fila) => formato.format(fila.credit_hours_required),
        orden: (fila) => fila.credit_hours_required
      },
      {
        clave: 'departamento',
        etiqueta: t('admin.reports.programas.colDepartamento'),
        texto: (fila) => fila.department_name ?? sinDato
      },
      {
        clave: 'activo',
        etiqueta: t('admin.reports.programas.colActivo'),
        texto: (fila) => (fila.is_active ? si : no),
        render: (fila) => badgeBooleano(fila.is_active)
      }
    ],
    [t, formato, sinDato, si, no, badgeBooleano]
  );

  const filtrosProgramas = useMemo<Array<FiltroDef<DegreeProgram>>>(
    () => [
      {
        clave: 'nivel',
        etiqueta: t('admin.reports.programas.filtroNivel'),
        opciones: NIVELES.map((nivel) => ({
          valor: nivel,
          etiqueta: t(`admin.reports.niveles.${nivel}`)
        })),
        aplica: (fila, valor) => fila.degree_level === valor
      },
      {
        clave: 'estado',
        etiqueta: t('admin.reports.comun.filtroEstado'),
        opciones: [
          { valor: 'activo', etiqueta: t('admin.reports.comun.activo') },
          { valor: 'inactivo', etiqueta: t('admin.reports.comun.inactivo') }
        ],
        aplica: (fila, valor) => fila.is_active === (valor === 'activo')
      }
    ],
    [t]
  );

  /* --------------------------------------------------------------------- *
   * Reporte: cursos de Moodle y su sincronización
   * --------------------------------------------------------------------- */

  type FilaCurso = MoodleCoursesResponse['items'][number];

  const columnasCursos = useMemo<Array<Columna<FilaCurso>>>(
    () => [
      {
        clave: 'id',
        etiqueta: t('admin.reports.cursos.colId'),
        texto: (fila) => String(fila.moodle_course_id),
        orden: (fila) => fila.moodle_course_id,
        cabeceraDeFila: true
      },
      {
        clave: 'corto',
        etiqueta: t('admin.reports.cursos.colCorto'),
        texto: (fila) => fila.short_name
      },
      { clave: 'nombre', etiqueta: t('admin.reports.cursos.colNombre'), texto: (fila) => fila.full_name },
      {
        clave: 'visible',
        etiqueta: t('admin.reports.cursos.colVisible'),
        texto: (fila) => (fila.visible ? si : no),
        render: (fila) => badgeBooleano(fila.visible)
      },
      {
        clave: 'inicio',
        etiqueta: t('admin.reports.cursos.colInicio'),
        texto: (fila) => fechaCorta(fila.start_date),
        orden: (fila) => ordenFecha(fila.start_date)
      },
      {
        clave: 'fin',
        etiqueta: t('admin.reports.cursos.colFin'),
        texto: (fila) => fechaCorta(fila.end_date),
        orden: (fila) => ordenFecha(fila.end_date)
      },
      {
        clave: 'sincronizado',
        etiqueta: t('admin.reports.cursos.colSincronizado'),
        texto: (fila) => fechaHora(fila.synced_at),
        orden: (fila) => ordenFecha(fila.synced_at)
      }
    ],
    [t, si, no, badgeBooleano, fechaCorta, fechaHora, ordenFecha]
  );

  const filtrosCursos = useMemo<Array<FiltroDef<FilaCurso>>>(
    () => [
      {
        clave: 'visible',
        etiqueta: t('admin.reports.cursos.filtroVisible'),
        opciones: [
          { valor: 'si', etiqueta: si },
          { valor: 'no', etiqueta: no }
        ],
        aplica: (fila, valor) => fila.visible === (valor === 'si')
      }
    ],
    [t, si, no]
  );

  /**
   * Resincroniza el catálogo de Moodle antes de exportar el inventario.
   *
   * Es la única acción de esta pantalla que escribe en la plataforma, así que
   * es la única que depende de `puedeEditar`. Un rol de solo lectura exporta
   * igual: lo que no puede es provocar una sincronización.
   */
  const sincronizarCursos = useCallback(async () => {
    setSincronizando(true);
    setAvisoSync(null);
    setErrorSync(null);
    try {
      const resp = await api.admin.moodleSyncCourses(token);
      if (resp.synced) {
        setAvisoSync(
          t('admin.reports.cursos.syncHecha', { total: formato.format(resp.upsertedCourses ?? 0) })
        );
        // El inventario en pantalla queda viejo en cuanto la sincronización
        // toca la tabla, así que se vuelve a pedir en vez de dejarlo estar.
        await cargarUno('cursos');
      } else {
        setErrorSync(resp.error ?? t('admin.reports.cursos.syncError'));
      }
    } catch (error) {
      setErrorSync(error instanceof Error && error.message ? error.message : t('admin.reports.cursos.syncError'));
    } finally {
      setSincronizando(false);
    }
  }, [token, t, formato, cargarUno]);

  /* --------------------------------------------------------------------- *
   * Reporte: usuarios de la plataforma
   * --------------------------------------------------------------------- */

  const columnasUsuarios = useMemo<Array<Columna<AdminUser>>>(
    () => [
      {
        clave: 'nombre',
        etiqueta: t('admin.reports.usuarios.colNombre'),
        texto: (fila) => fila.full_name,
        cabeceraDeFila: true
      },
      { clave: 'correo', etiqueta: t('admin.reports.usuarios.colCorreo'), texto: (fila) => fila.email },
      {
        clave: 'estado',
        etiqueta: t('admin.reports.comun.filtroEstado'),
        texto: (fila) =>
          fila.status === 'active' ? t('admin.reports.comun.activo') : t('admin.reports.comun.inactivo'),
        render: (fila) => (
          <span className={`ad-badge ad-badge-${fila.status === 'active' ? 'ok' : 'off'}`}>
            {fila.status === 'active'
              ? t('admin.reports.comun.activo')
              : t('admin.reports.comun.inactivo')}
          </span>
        )
      },
      {
        clave: 'roles',
        etiqueta: t('admin.reports.usuarios.colRoles'),
        // Los roles llegan como arreglo libre del servidor, sin catálogo de
        // traducción, así que se listan tal cual y la columna no se ordena.
        texto: (fila) => fila.roles.join(', '),
        ordenable: false
      },
      {
        clave: 'cursos',
        etiqueta: t('admin.reports.usuarios.colCursos'),
        texto: (fila) => formato.format(fila.enrolled_courses),
        orden: (fila) => fila.enrolled_courses
      },
      {
        clave: 'moodle',
        etiqueta: t('admin.reports.usuarios.colMoodle'),
        texto: (fila) => (fila.moodle_user_id === null ? no : String(fila.moodle_user_id)),
        orden: (fila) => fila.moodle_user_id ?? Number.POSITIVE_INFINITY
      },
      {
        clave: 'alta',
        etiqueta: t('admin.reports.usuarios.colAlta'),
        texto: (fila) => fechaCorta(fila.created_at),
        orden: (fila) => ordenFecha(fila.created_at)
      }
    ],
    [t, formato, no, fechaCorta, ordenFecha]
  );

  const filtrosUsuarios = useMemo<Array<FiltroDef<AdminUser>>>(
    () => [
      {
        clave: 'estado',
        etiqueta: t('admin.reports.comun.filtroEstado'),
        opciones: [
          { valor: 'active', etiqueta: t('admin.reports.comun.activo') },
          { valor: 'inactive', etiqueta: t('admin.reports.comun.inactivo') }
        ],
        aplica: (fila, valor) => fila.status === valor
      },
      {
        clave: 'moodle',
        etiqueta: t('admin.reports.usuarios.filtroMoodle'),
        opciones: [
          { valor: 'si', etiqueta: si },
          { valor: 'no', etiqueta: no }
        ],
        aplica: (fila, valor) => (valor === 'si' ? fila.moodle_user_id !== null : fila.moodle_user_id === null)
      }
    ],
    [t, si, no]
  );

  /* --------------------------------------------------------------------- *
   * Reporte: usuarios del panel (auditoría de accesos)
   * --------------------------------------------------------------------- */

  const nombreDeRolPanel = useCallback(
    (fila: AdminPanelUser): string => {
      const nombre = locale === 'en' ? fila.roleNameEn : fila.roleNameEs;
      return nombre ?? fila.roleKey ?? sinDato;
    },
    [locale, sinDato]
  );

  const columnasPanel = useMemo<Array<Columna<AdminPanelUser>>>(
    () => [
      {
        clave: 'nombre',
        etiqueta: t('admin.reports.panel.colNombre'),
        texto: (fila) => fila.fullName,
        cabeceraDeFila: true
      },
      { clave: 'correo', etiqueta: t('admin.reports.panel.colCorreo'), texto: (fila) => fila.email },
      { clave: 'rol', etiqueta: t('admin.reports.panel.colRol'), texto: nombreDeRolPanel },
      {
        clave: 'idioma',
        etiqueta: t('admin.reports.panel.colIdioma'),
        texto: (fila) => t(`admin.reports.idiomas.${fila.locale}`)
      },
      {
        clave: 'activo',
        etiqueta: t('admin.reports.comun.filtroEstado'),
        texto: (fila) => (fila.isActive ? t('admin.reports.comun.activo') : t('admin.reports.comun.inactivo')),
        render: (fila) => (
          <span className={`ad-badge ad-badge-${fila.isActive ? 'ok' : 'off'}`}>
            {fila.isActive ? t('admin.reports.comun.activo') : t('admin.reports.comun.inactivo')}
          </span>
        )
      },
      {
        clave: 'alta',
        etiqueta: t('admin.reports.panel.colAlta'),
        texto: (fila) => fechaCorta(fila.createdAt),
        orden: (fila) => ordenFecha(fila.createdAt)
      },
      {
        clave: 'ultimoAcceso',
        etiqueta: t('admin.reports.panel.colUltimoAcceso'),
        // Una cuenta del panel que nunca entró es el hallazgo que busca una
        // auditoría de accesos, así que se rotula en vez de dejarse en blanco.
        texto: (fila) => (fila.lastLoginAt ? fechaHora(fila.lastLoginAt) : t('admin.reports.panel.nunca')),
        orden: (fila) => ordenFecha(fila.lastLoginAt)
      }
    ],
    [t, nombreDeRolPanel, fechaCorta, fechaHora, ordenFecha]
  );

  const filtrosPanel = useMemo<Array<FiltroDef<AdminPanelUser>>>(() => {
    const roles = datos.roles.estado === 'ok' ? datos.roles.datos : [];
    return [
      {
        clave: 'rol',
        etiqueta: t('admin.reports.panel.filtroRol'),
        opciones: roles.map((rol) => ({
          valor: rol.id,
          etiqueta: locale === 'en' ? rol.nameEn : rol.nameEs
        })),
        aplica: (fila, valor) => fila.roleId === valor
      },
      {
        clave: 'estado',
        etiqueta: t('admin.reports.comun.filtroEstado'),
        opciones: [
          { valor: 'activo', etiqueta: t('admin.reports.comun.activo') },
          { valor: 'inactivo', etiqueta: t('admin.reports.comun.inactivo') }
        ],
        aplica: (fila, valor) => fila.isActive === (valor === 'activo')
      },
      {
        clave: 'acceso',
        etiqueta: t('admin.reports.panel.filtroAcceso'),
        opciones: [
          { valor: 'nunca', etiqueta: t('admin.reports.panel.nunca') },
          { valor: 'alguna', etiqueta: t('admin.reports.panel.alguna') }
        ],
        aplica: (fila, valor) =>
          valor === 'nunca' ? fila.lastLoginAt === null : fila.lastLoginAt !== null
      }
    ];
  }, [t, datos.roles, locale]);

  /* --------------------------------------------------------------------- *
   * Reportes: contenido publicado
   * --------------------------------------------------------------------- */

  const columnasWebinars = useMemo<Array<Columna<WebinarRecord>>>(
    () => [
      {
        clave: 'titulo',
        etiqueta: t('admin.reports.webinars.colTitulo'),
        // `title_en` llega con COALESCE sobre el español, así que nunca es vacío.
        texto: (fila) => (locale === 'en' ? fila.title_en : fila.title),
        cabeceraDeFila: true
      },
      { clave: 'slug', etiqueta: t('admin.reports.webinars.colSlug'), texto: (fila) => fila.slug },
      {
        clave: 'origen',
        etiqueta: t('admin.reports.webinars.colOrigen'),
        texto: (fila) => t(`admin.reports.origenes.${fila.source_type}`)
      },
      {
        clave: 'inicio',
        etiqueta: t('admin.reports.webinars.colInicio'),
        texto: (fila) => fechaHora(fila.starts_at),
        orden: (fila) => ordenFecha(fila.starts_at)
      },
      {
        clave: 'activo',
        etiqueta: t('admin.reports.comun.filtroEstado'),
        texto: (fila) => (fila.is_active ? si : no),
        render: (fila) => badgeBooleano(fila.is_active)
      },
      {
        clave: 'portada',
        etiqueta: t('admin.reports.comun.colPortada'),
        texto: (fila) => (fila.show_on_landing ? si : no),
        render: (fila) => badgeBooleano(fila.show_on_landing)
      },
      {
        clave: 'repeticion',
        etiqueta: t('admin.reports.webinars.colRepeticion'),
        texto: (fila) => (fila.replay_url ? si : no),
        render: (fila) => (
          <span className={`ad-badge ad-badge-${fila.replay_url ? 'ok' : 'warn'}`}>
            {fila.replay_url ? si : no}
          </span>
        )
      }
    ],
    [t, locale, fechaHora, ordenFecha, si, no, badgeBooleano]
  );

  const filtrosWebinars = useMemo<Array<FiltroDef<WebinarRecord>>>(
    () => [
      {
        clave: 'estado',
        etiqueta: t('admin.reports.comun.filtroEstado'),
        opciones: [
          { valor: 'activo', etiqueta: t('admin.reports.comun.activo') },
          { valor: 'inactivo', etiqueta: t('admin.reports.comun.inactivo') }
        ],
        aplica: (fila, valor) => fila.is_active === (valor === 'activo')
      },
      {
        clave: 'origen',
        etiqueta: t('admin.reports.webinars.filtroOrigen'),
        opciones: ORIGENES.map((origen) => ({
          valor: origen,
          etiqueta: t(`admin.reports.origenes.${origen}`)
        })),
        aplica: (fila, valor) => fila.source_type === valor
      },
      {
        clave: 'portada',
        etiqueta: t('admin.reports.comun.filtroPortada'),
        opciones: [
          { valor: 'si', etiqueta: si },
          { valor: 'no', etiqueta: no }
        ],
        aplica: (fila, valor) => fila.show_on_landing === (valor === 'si')
      }
    ],
    [t, si, no]
  );

  const columnasPodcasts = useMemo<Array<Columna<PodcastRecord>>>(
    () => [
      {
        clave: 'titulo',
        etiqueta: t('admin.reports.podcasts.colTitulo'),
        texto: (fila) => (locale === 'en' ? fila.title_en : fila.title),
        cabeceraDeFila: true
      },
      { clave: 'codigo', etiqueta: t('admin.reports.podcasts.colCodigo'), texto: (fila) => fila.video_code },
      {
        clave: 'publicado',
        etiqueta: t('admin.reports.podcasts.colPublicado'),
        texto: (fila) => fechaCorta(fila.published_at),
        orden: (fila) => ordenFecha(fila.published_at)
      },
      {
        clave: 'orden',
        etiqueta: t('admin.reports.podcasts.colOrden'),
        texto: (fila) => formato.format(fila.display_order),
        orden: (fila) => fila.display_order
      },
      {
        clave: 'activo',
        etiqueta: t('admin.reports.comun.filtroEstado'),
        texto: (fila) => (fila.is_active ? si : no),
        render: (fila) => badgeBooleano(fila.is_active)
      },
      {
        clave: 'portada',
        etiqueta: t('admin.reports.comun.colPortada'),
        texto: (fila) => (fila.show_on_landing ? si : no),
        render: (fila) => badgeBooleano(fila.show_on_landing)
      }
    ],
    [t, locale, fechaCorta, ordenFecha, formato, si, no, badgeBooleano]
  );

  const filtrosPodcasts = useMemo<Array<FiltroDef<PodcastRecord>>>(
    () => [
      {
        clave: 'estado',
        etiqueta: t('admin.reports.comun.filtroEstado'),
        opciones: [
          { valor: 'activo', etiqueta: t('admin.reports.comun.activo') },
          { valor: 'inactivo', etiqueta: t('admin.reports.comun.inactivo') }
        ],
        aplica: (fila, valor) => fila.is_active === (valor === 'activo')
      },
      {
        clave: 'portada',
        etiqueta: t('admin.reports.comun.filtroPortada'),
        opciones: [
          { valor: 'si', etiqueta: si },
          { valor: 'no', etiqueta: no }
        ],
        aplica: (fila, valor) => fila.show_on_landing === (valor === 'si')
      }
    ],
    [t, si, no]
  );

  /* --------------------------------------------------------------------- *
   * Reporte: inventario de rutas de la API
   * --------------------------------------------------------------------- */

  type FilaRuta = { method: string; url: string; ambito: 'admin' | 'publico' };

  /**
   * Las rutas llegan sin ámbito declarado; se deduce del prefijo, que es el
   * mismo criterio que usa el servidor para exigir credenciales de panel.
   */
  const filasRutas = useMemo<Bloque<FilaRuta[]>>(() => {
    if (datos.rutas.estado !== 'ok') return datos.rutas;
    return {
      estado: 'ok',
      datos: datos.rutas.datos.routes.map((ruta) => ({
        method: ruta.method,
        url: ruta.url,
        ambito: ruta.url.startsWith('/admin') ? 'admin' : 'publico'
      }))
    };
  }, [datos.rutas]);

  /** Verbos presentes de verdad en el registro; no se inventa el catálogo HTTP. */
  const metodos = useMemo(() => {
    if (filasRutas.estado !== 'ok') return [];
    return Array.from(new Set(filasRutas.datos.map((fila) => fila.method))).sort();
  }, [filasRutas]);

  const columnasRutas = useMemo<Array<Columna<FilaRuta>>>(
    () => [
      {
        clave: 'metodo',
        etiqueta: t('admin.reports.rutas.colMetodo'),
        texto: (fila) => fila.method,
        cabeceraDeFila: true
      },
      { clave: 'url', etiqueta: t('admin.reports.rutas.colUrl'), texto: (fila) => fila.url },
      {
        clave: 'ambito',
        etiqueta: t('admin.reports.rutas.colAmbito'),
        texto: (fila) => t(`admin.reports.rutas.ambitos.${fila.ambito}`),
        render: (fila) => (
          <span className={`ad-badge ad-badge-${fila.ambito === 'admin' ? 'warn' : 'ok'}`}>
            {t(`admin.reports.rutas.ambitos.${fila.ambito}`)}
          </span>
        )
      }
    ],
    [t]
  );

  const filtrosRutas = useMemo<Array<FiltroDef<FilaRuta>>>(
    () => [
      {
        clave: 'metodo',
        etiqueta: t('admin.reports.rutas.filtroMetodo'),
        opciones: metodos.map((metodo) => ({ valor: metodo, etiqueta: metodo })),
        aplica: (fila, valor) => fila.method === valor
      },
      {
        clave: 'ambito',
        etiqueta: t('admin.reports.rutas.filtroAmbito'),
        opciones: [
          { valor: 'admin', etiqueta: t('admin.reports.rutas.ambitos.admin') },
          { valor: 'publico', etiqueta: t('admin.reports.rutas.ambitos.publico') }
        ],
        aplica: (fila, valor) => fila.ambito === valor
      }
    ],
    [t, metodos]
  );

  /* --------------------------------------------------------------------- *
   * Notas de alcance
   * --------------------------------------------------------------------- */

  /**
   * Nota de alcance de un reporte paginado.
   *
   * Si la API declara más filas de las que se trajeron, el reporte lo dice: un
   * CSV recortado en silencio se usa después como si fuera el censo completo.
   */
  const notaAlcance = useCallback(
    (cargadas: number, total: number | null): string | null => {
      if (total === null || total <= cargadas) return null;
      return t('admin.reports.tabla.alcanceParcial', {
        cargadas: formato.format(cargadas),
        total: formato.format(total)
      });
    },
    [t, formato]
  );

  const cursosCargados = datos.cursos.estado === 'ok' ? datos.cursos.datos.items : [];
  const bloqueCursos: Bloque<FilaCurso[]> =
    datos.cursos.estado === 'ok' ? { estado: 'ok', datos: cursosCargados } : datos.cursos;

  const usuariosCargados = datos.usuarios.estado === 'ok' ? datos.usuarios.datos : [];

  return (
    <section>
      <div className="ad-card">
        <div className="ad-card-head">
          <h2>{t('admin.reports.titulo')}</h2>
          <p>{t('admin.reports.descripcion')}</p>
        </div>
        <div className="ad-card-body">
          <div className="ad-tabs" role="tablist" aria-label={t('admin.reports.titulo')}>
            {PESTANAS.map((clave) => (
              <button
                type="button"
                className="ad-tab"
                role="tab"
                key={clave}
                id={`tab-reportes-${clave}`}
                aria-controls={`panel-reportes-${clave}`}
                aria-selected={pestana === clave}
                onClick={() => setPestana(clave)}
              >
                {t(`admin.reports.pestanas.${clave}`)}
              </button>
            ))}
          </div>

          {pestana !== 'previa' ? (
            <div className="ad-toolbar">
              <button type="button" className="ad-btn ad-btn-ghost" onClick={recargarPestana}>
                {t('admin.reports.estado.recargar')}
              </button>
            </div>
          ) : null}

          <p className="ad-note">{t('admin.reports.tabla.notaExportacion')}</p>
          {!puedeEditar ? <p className="ad-note">{t('admin.reports.estado.soloLectura')}</p> : null}
        </div>
      </div>

      {/* ------------------------------------------------------------------ *
       * Académico — datos reales
       * ------------------------------------------------------------------ */}
      {pestana === 'academico' ? (
        <div id="panel-reportes-academico" role="tabpanel" aria-labelledby="tab-reportes-academico">
          <ReporteTabla<DegreeProgram>
            id="reporte-programas"
            titulo={t('admin.reports.programas.titulo')}
            descripcion={t('admin.reports.programas.descripcion')}
            bloque={datos.programas}
            columnas={columnasProgramas}
            filtros={filtrosProgramas}
            busqueda={(fila) => `${fila.code} ${fila.name} ${fila.department_name ?? ''}`}
            claveFila={(fila) => fila.id}
            locale={locale}
            onReintentar={() => void cargarUno('programas')}
          />

          <ReporteTabla<FilaCurso>
            id="reporte-cursos-moodle"
            titulo={t('admin.reports.cursos.titulo')}
            descripcion={t('admin.reports.cursos.descripcion')}
            bloque={bloqueCursos}
            columnas={columnasCursos}
            filtros={filtrosCursos}
            busqueda={(fila) => `${fila.moodle_course_id} ${fila.short_name} ${fila.full_name}`}
            claveFila={(fila) => String(fila.moodle_course_id)}
            locale={locale}
            nota={notaAlcance(cursosCargados.length, totales.cursos)}
            onReintentar={() => void cargarUno('cursos')}
            acciones={
              puedeEditar ? (
                <button
                  type="button"
                  className="ad-btn"
                  disabled={sincronizando}
                  onClick={() => void sincronizarCursos()}
                >
                  {t(`admin.reports.cursos.${sincronizando ? 'sincronizando' : 'sincronizar'}`)}
                </button>
              ) : null
            }
          />

          {avisoSync ? (
            <p className="ad-note" role="status">
              {avisoSync}
            </p>
          ) : null}
          {errorSync ? (
            <p className="ad-note" role="alert">
              {errorSync}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* ------------------------------------------------------------------ *
       * Personas — datos reales
       * ------------------------------------------------------------------ */}
      {pestana === 'personas' ? (
        <div id="panel-reportes-personas" role="tabpanel" aria-labelledby="tab-reportes-personas">
          <ReporteTabla<AdminUser>
            id="reporte-usuarios"
            titulo={t('admin.reports.usuarios.titulo')}
            descripcion={t('admin.reports.usuarios.descripcion')}
            bloque={datos.usuarios}
            columnas={columnasUsuarios}
            filtros={filtrosUsuarios}
            busqueda={(fila) => `${fila.full_name} ${fila.email}`}
            claveFila={(fila) => fila.id}
            locale={locale}
            nota={notaAlcance(usuariosCargados.length, totales.usuarios)}
            onReintentar={() => void cargarUno('usuarios')}
          />

          <ReporteTabla<AdminPanelUser>
            id="reporte-usuarios-panel"
            titulo={t('admin.reports.panel.titulo')}
            descripcion={t('admin.reports.panel.descripcion')}
            bloque={datos.panel}
            columnas={columnasPanel}
            filtros={filtrosPanel}
            busqueda={(fila) => `${fila.fullName} ${fila.email} ${nombreDeRolPanel(fila)}`}
            claveFila={(fila) => fila.id}
            locale={locale}
            nota={
              datos.roles.estado === 'sin-datos' ? t('admin.reports.panel.sinCatalogoRoles') : null
            }
            onReintentar={() => {
              void cargarUno('panel');
              void cargarUno('roles');
            }}
          />
        </div>
      ) : null}

      {/* ------------------------------------------------------------------ *
       * Contenido publicado — datos reales
       * ------------------------------------------------------------------ */}
      {pestana === 'contenido' ? (
        <div id="panel-reportes-contenido" role="tabpanel" aria-labelledby="tab-reportes-contenido">
          <ReporteTabla<WebinarRecord>
            id="reporte-seminarios"
            titulo={t('admin.reports.webinars.titulo')}
            descripcion={t('admin.reports.webinars.descripcion')}
            bloque={datos.webinars}
            columnas={columnasWebinars}
            filtros={filtrosWebinars}
            busqueda={(fila) => `${fila.title} ${fila.title_en} ${fila.slug}`}
            claveFila={(fila) => fila.id}
            locale={locale}
            onReintentar={() => void cargarUno('webinars')}
          />

          <ReporteTabla<PodcastRecord>
            id="reporte-podcasts"
            titulo={t('admin.reports.podcasts.titulo')}
            descripcion={t('admin.reports.podcasts.descripcion')}
            bloque={datos.podcasts}
            columnas={columnasPodcasts}
            filtros={filtrosPodcasts}
            busqueda={(fila) => `${fila.title} ${fila.title_en} ${fila.video_code}`}
            claveFila={(fila) => fila.id}
            locale={locale}
            onReintentar={() => void cargarUno('podcasts')}
          />
        </div>
      ) : null}

      {/* ------------------------------------------------------------------ *
       * Técnico — datos reales
       * ------------------------------------------------------------------ */}
      {pestana === 'tecnico' ? (
        <div id="panel-reportes-tecnico" role="tabpanel" aria-labelledby="tab-reportes-tecnico">
          <ReporteTabla<FilaRuta>
            id="reporte-rutas-api"
            titulo={t('admin.reports.rutas.titulo')}
            descripcion={t('admin.reports.rutas.descripcion')}
            bloque={filasRutas}
            columnas={columnasRutas}
            filtros={filtrosRutas}
            busqueda={(fila) => `${fila.method} ${fila.url}`}
            claveFila={(fila) => `${fila.method} ${fila.url}`}
            locale={locale}
            nota={
              datos.rutas.estado === 'ok'
                ? t('admin.reports.rutas.nota', { total: formato.format(datos.rutas.datos.count) })
                : null
            }
            onReintentar={() => void cargarUno('rutas')}
          />
        </div>
      ) : null}

      {/* ------------------------------------------------------------------ *
       * Vista previa de Etapa V — datos de muestra
       * ------------------------------------------------------------------ */}
      {pestana === 'previa' ? (
        <div id="panel-reportes-previa" role="tabpanel" aria-labelledby="tab-reportes-previa">
          <div className="ad-preview-banner" role="note">
            <strong>{t('admin.reports.previa.banner.titulo')}</strong>
            <p>{t('admin.reports.previa.banner.cuerpo')}</p>
            <p>{t('admin.reports.previa.banner.aviso')}</p>
          </div>

          <div className="ad-card">
            <div className="ad-card-head">
              <h3>{t('admin.reports.previa.conversion.titulo')}</h3>
              <p>{t('admin.reports.previa.conversion.descripcion')}</p>
            </div>
            <div className="ad-card-body">
              <div className="ad-chart-head">
                <h4>{t('admin.reports.previa.conversion.tabla')}</h4>
                <span className="ad-preview-mark">{t('admin.reports.previa.marca')}</span>
              </div>
              <div className="ad-table-wrap">
                <table className="ad-table">
                  <caption>{t('admin.reports.previa.conversion.tabla')}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('admin.reports.previa.conversion.colPeriodo')}</th>
                      <th scope="col">{t('admin.reports.previa.conversion.colInteresados')}</th>
                      <th scope="col">{t('admin.reports.previa.conversion.colSolicitudes')}</th>
                      <th scope="col">{t('admin.reports.previa.conversion.colAdmitidos')}</th>
                      <th scope="col">{t('admin.reports.previa.conversion.colMatriculados')}</th>
                      <th scope="col">{t('admin.reports.previa.conversion.colTasa')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {MUESTRA.conversion.map((fila) => (
                      <tr key={fila.periodo}>
                        <th scope="row">{fila.periodo}</th>
                        <td>{formato.format(fila.interesados)}</td>
                        <td>{formato.format(fila.solicitudes)}</td>
                        <td>{formato.format(fila.admitidos)}</td>
                        <td>{formato.format(fila.matriculados)}</td>
                        <td>
                          {t('admin.reports.previa.porcentaje', {
                            valor: Math.round((fila.matriculados / fila.interesados) * 100)
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="ad-note">{t('admin.reports.previa.sinExportar')}</p>
            </div>
          </div>

          <div className="ad-card">
            <div className="ad-card-head">
              <h3>{t('admin.reports.previa.tendencia.titulo')}</h3>
              <p>{t('admin.reports.previa.tendencia.descripcion')}</p>
            </div>
            <div className="ad-card-body">
              <GraficaTendencia etiquetasMes={etiquetasMes} formato={formato} />
              <div className="ad-table-wrap">
                <table className="ad-table">
                  <caption>{t('admin.reports.previa.tendencia.tabla')}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('admin.reports.previa.tendencia.colMes')}</th>
                      <th scope="col">{t('admin.reports.previa.tendencia.colMatriculas')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {MUESTRA.tendencia.map((punto) => (
                      <tr key={punto.mes}>
                        <th scope="row">{etiquetasMes[punto.mes]}</th>
                        <td>{formato.format(punto.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="ad-note">{t('admin.reports.previa.sinExportar')}</p>
            </div>
          </div>

          <div className="ad-card">
            <div className="ad-card-head">
              <h3>{t('admin.reports.previa.retencion.titulo')}</h3>
              <p>{t('admin.reports.previa.retencion.descripcion')}</p>
            </div>
            <div className="ad-card-body">
              <div className="ad-chart-head">
                <h4>{t('admin.reports.previa.retencion.tabla')}</h4>
                <span className="ad-preview-mark">{t('admin.reports.previa.marca')}</span>
              </div>
              <div className="ad-table-wrap">
                <table className="ad-table">
                  <caption>{t('admin.reports.previa.retencion.tabla')}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('admin.reports.previa.retencion.colCohorte')}</th>
                      <th scope="col">{t('admin.reports.previa.retencion.colInicial')}</th>
                      <th scope="col">{t('admin.reports.previa.retencion.colMes3')}</th>
                      <th scope="col">{t('admin.reports.previa.retencion.colMes6')}</th>
                      <th scope="col">{t('admin.reports.previa.retencion.colMes12')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {MUESTRA.retencion.map((fila) => (
                      <tr key={fila.cohorte}>
                        <th scope="row">{fila.cohorte}</th>
                        <td>{formato.format(fila.inicial)}</td>
                        <td>{t('admin.reports.previa.porcentaje', { valor: fila.mes3 })}</td>
                        <td>{t('admin.reports.previa.porcentaje', { valor: fila.mes6 })}</td>
                        {/* Un 0 en la muestra es "la cohorte no cumple 12 meses todavía". */}
                        <td>
                          {fila.mes12 === 0
                            ? t('admin.reports.previa.retencion.incompleta')
                            : t('admin.reports.previa.porcentaje', { valor: fila.mes12 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="ad-note">{t('admin.reports.previa.sinExportar')}</p>
            </div>
          </div>

          <p className="ad-note">{t('admin.reports.previa.cierre')}</p>
        </div>
      ) : null}
    </section>
  );
}

export default ReportsView;
