/**
 * Iconos y vocabulario del aula.
 *
 * DOS COSAS VIVEN AQUÍ Y LAS DOS SON DECISIONES DE USABILIDAD, NO ADORNO.
 *
 * 1. LOS ICONOS. Son trazos de 24×24 heredando `currentColor`, sin relleno, de
 *    modo que toman el color del contexto y funcionan igual en el modo de alto
 *    contraste. Todos llevan `aria-hidden`: el significado lo carga siempre el
 *    texto que va al lado, nunca el dibujo. Un icono que hay que interpretar es
 *    un icono que falla, y falla antes a quien tiene menos vista o menos
 *    costumbre con interfaces.
 *
 * 2. LA TRADUCCIÓN DE LA JERGA DE MOODLE. El aula mostraba el nombre técnico
 *    del módulo tal y como lo devuelve el servicio web —`page`, `assign`,
 *    `forum`— debajo de cada actividad. Para quien estudia eso no significa
 *    nada; en el mejor de los casos lo ignora y en el peor lo confunde.
 *
 *    Los tipos que hay HOY en las trece aulas de TFU, consultados contra la
 *    base de Moodle en producción y no supuestos:
 *
 *        forum   221
 *        page    130
 *        assign  104
 *
 *    Se cubren esos tres y además los habituales de Moodle, por si mañana se
 *    añade material de otro tipo. Lo que no se reconozca cae en una etiqueta
 *    genérica honesta («Actividad») en vez de enseñar el nombre técnico.
 */

import type { ReactNode } from 'react';

type PropsIcono = { className?: string };

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false
};

export function IconoFlechaIzquierda({ className }: PropsIcono) {
  return (
    <svg {...base} strokeWidth={2.2} className={className}>
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  );
}

export function IconoFlechaDerecha({ className }: PropsIcono) {
  return (
    <svg {...base} strokeWidth={2.2} className={className}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

export function IconoVisto({ className }: PropsIcono) {
  return (
    <svg {...base} strokeWidth={3} className={className}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function IconoGuardar({ className }: PropsIcono) {
  return (
    <svg {...base} className={className}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <path d="M17 21v-8H7v8" />
      <path d="M7 3v5h8" />
    </svg>
  );
}

export function IconoArchivo({ className }: PropsIcono) {
  return (
    <svg {...base} className={className}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v5h6" />
    </svg>
  );
}

export function IconoMedalla({ className }: PropsIcono) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="8" r="6" />
      <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
    </svg>
  );
}

export function IconoVacio({ className }: PropsIcono) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}

/* --- Iconos de tipo de actividad ----------------------------------------- */

function IconoLectura({ className }: PropsIcono) {
  return (
    <svg {...base} className={className}>
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
    </svg>
  );
}

function IconoForo({ className }: PropsIcono) {
  return (
    <svg {...base} className={className}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconoTarea({ className }: PropsIcono) {
  return (
    <svg {...base} className={className}>
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="m9 14 2 2 4-4" />
    </svg>
  );
}

function IconoCuestionario({ className }: PropsIcono) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function IconoVideo({ className }: PropsIcono) {
  return (
    <svg {...base} className={className}>
      <rect x="2" y="4" width="14" height="16" rx="2" />
      <path d="m16 10 6-3v10l-6-3z" />
    </svg>
  );
}

function IconoEnlace({ className }: PropsIcono) {
  return (
    <svg {...base} className={className}>
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </svg>
  );
}

function IconoCarpeta({ className }: PropsIcono) {
  return (
    <svg {...base} className={className}>
      <path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2z" />
    </svg>
  );
}

/**
 * Traduce el nombre técnico de Moodle a una etiqueta en lenguaje humano.
 *
 * Devuelve la CLAVE de traducción, no el texto: el aula es bilingüe y el texto
 * lo resuelve i18next en el idioma del visitante.
 */
export function tipoDeActividad(modname: string | undefined | null): {
  clave: string;
  Icono: (p: PropsIcono) => ReactNode;
} {
  switch ((modname ?? '').toLowerCase()) {
    // Los tres que existen hoy en las aulas de TFU.
    case 'page':
    case 'book':
    case 'label':
      return { clave: 'aula.tipos.lectura', Icono: IconoLectura };
    case 'forum':
      return { clave: 'aula.tipos.foro', Icono: IconoForo };
    case 'assign':
    case 'workshop':
      return { clave: 'aula.tipos.tarea', Icono: IconoTarea };

    // Los habituales de Moodle, por si se añade material de otro tipo.
    case 'quiz':
    case 'choice':
    case 'feedback':
    case 'survey':
      return { clave: 'aula.tipos.cuestionario', Icono: IconoCuestionario };
    case 'url':
      return { clave: 'aula.tipos.enlace', Icono: IconoEnlace };
    case 'folder':
      return { clave: 'aula.tipos.carpeta', Icono: IconoCarpeta };
    case 'resource':
      return { clave: 'aula.tipos.archivo', Icono: IconoArchivo };
    case 'lesson':
    case 'scorm':
    case 'h5pactivity':
      return { clave: 'aula.tipos.leccion', Icono: IconoVideo };

    // Lo desconocido se nombra con honestidad en vez de enseñar `modname`.
    default:
      return { clave: 'aula.tipos.actividad', Icono: IconoLectura };
  }
}
