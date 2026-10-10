/**
 * Catálogo de secciones del panel y mapa de rutas.
 *
 * Esta es la única lista de secciones que existe. La usan tres cosas a la vez:
 * el gestor de roles (para pintar la matriz), el guardián de permisos (para
 * saber qué sección protege cada ruta) y la barra lateral del panel (que la
 * pide por API en vez de llevar su propia copia). Tener una sola lista es lo
 * que evita que aparezca una sección en el menú que nadie puede proteger, o un
 * permiso guardado para una sección que ya no existe.
 *
 * Los nombres van en español e inglés porque el panel es bilingüe y los nombres
 * de sección se muestran en el menú, en la matriz de permisos y en los errores.
 */

export type PermissionLevel = 'none' | 'view' | 'edit';

export const PERMISSION_LEVELS: PermissionLevel[] = ['none', 'view', 'edit'];

export type SectionDef = {
  id: string;
  group: string;
  groupEn: string;
  nameEs: string;
  nameEn: string;
};

export const SECTIONS: SectionDef[] = [
  { id: 'overview',     group: 'Operación',    groupEn: 'Operations',    nameEs: 'Resumen',                 nameEn: 'Overview' },
  { id: 'reports',      group: 'Operación',    groupEn: 'Operations',    nameEs: 'Reportes',                nameEn: 'Reports' },
  { id: 'users',        group: 'Operación',    groupEn: 'Operations',    nameEs: 'Usuarios',                nameEn: 'Users' },
  { id: 'courses',      group: 'Operación',    groupEn: 'Operations',    nameEs: 'Cursos',                  nameEn: 'Courses' },
  { id: 'enterprise',   group: 'Operación',    groupEn: 'Operations',    nameEs: 'Departamentos',           nameEn: 'Departments' },
  { id: 'sis',          group: 'Académico',    groupEn: 'Academic',      nameEs: 'SIS / Académico',         nameEn: 'SIS / Academic' },
  { id: 'calendar',     group: 'Académico',    groupEn: 'Academic',      nameEs: 'Calendario y aulas',      nameEn: 'Calendar & classrooms' },
  { id: 'compliance',   group: 'Académico',    groupEn: 'Academic',      nameEs: 'Sílabos y cumplimiento',  nameEn: 'Syllabi & compliance' },
  { id: 'crm',          group: 'Admisiones',   groupEn: 'Admissions',    nameEs: 'CRM / Admisión',          nameEn: 'CRM / Admissions' },
  { id: 'cie',          group: 'Acreditación', groupEn: 'Accreditation', nameEs: 'Checklist CIE',           nameEn: 'CIE checklist' },
  { id: 'credentials',  group: 'Acreditación', groupEn: 'Accreditation', nameEs: 'Credenciales',            nameEn: 'Credentials' },
  { id: 'webinars',     group: 'Contenido',    groupEn: 'Content',       nameEs: 'Seminarios',              nameEn: 'Webinars' },
  { id: 'podcasts',     group: 'Contenido',    groupEn: 'Content',       nameEs: 'Podcasts',                nameEn: 'Podcasts' },
  { id: 'connections',  group: 'Sistema',      groupEn: 'System',        nameEs: 'Conexiones',              nameEn: 'Connections' },
  { id: 'integrations', group: 'Sistema',      groupEn: 'System',        nameEs: 'Integraciones',           nameEn: 'Integrations' },
  { id: 'backoffice',   group: 'Sistema',      groupEn: 'System',        nameEs: 'Back-office',             nameEn: 'Back-office' },
  { id: 'routes',       group: 'Sistema',      groupEn: 'System',        nameEs: 'Rutas API',               nameEn: 'API routes' },
  { id: 'roles',        group: 'Sistema',      groupEn: 'System',        nameEs: 'Roles y permisos',        nameEn: 'Roles & permissions' }
];

export const SECTION_IDS = SECTIONS.map((s) => s.id);

/**
 * Prefijo de ruta -> sección que la protege.
 *
 * Se ordena de más largo a más corto al resolver, porque `/admin/moodle/sync`
 * y `/admin/moodle` existen los dos y gana el más específico. Lo que no está
 * en esta tabla NO queda abierto: el guardián lo trata como exclusivo del
 * superadministrador. Fallar cerrado es lo correcto aquí — una ruta nueva sin
 * mapear debe dejar de funcionar y hacerse notar, no quedar accesible a todos.
 */
export const ROUTE_SECTIONS: Array<[string, string]> = [
  ['/admin/iam',             'roles'],
  ['/admin/reports',         'reports'],
  ['/admin/overview',        'overview'],
  ['/admin/status',          'overview'],
  ['/admin/users',           'users'],
  ['/admin/moodle',          'courses'],
  ['/admin/courses',         'courses'],
  ['/admin/companies',       'enterprise'],
  ['/admin/enterprise',      'enterprise'],
  ['/admin/degree-programs', 'sis'],
  ['/admin/departments',     'sis'],
  ['/admin/holds',           'sis'],
  ['/admin/invoices',        'sis'],
  ['/admin/sis',             'sis'],
  ['/admin/admissions',      'crm'],
  ['/admin/crm',             'crm'],
  ['/admin/calendar',        'calendar'],
  ['/admin/compliance',      'compliance'],
  ['/admin/syllabus',        'compliance'],
  ['/admin/cie',             'cie'],
  ['/admin/badges',          'credentials'],
  ['/admin/certificates',    'credentials'],
  ['/admin/competencies',    'credentials'],
  ['/admin/webinars',        'webinars'],
  ['/admin/podcasts',        'podcasts'],
  ['/admin/config',          'connections'],
  ['/admin/accounting',      'backoffice'],
  ['/admin/hr',              'backoffice'],
  ['/admin/routes',          'routes']
];

const ORDENADOS = [...ROUTE_SECTIONS].sort((a, b) => b[0].length - a[0].length);

/** Devuelve la sección que protege una ruta, o null si no está mapeada. */
export function sectionForPath(pathname: string): string | null {
  const limpio = pathname.split('?')[0];
  for (const [prefijo, seccion] of ORDENADOS) {
    if (limpio === prefijo || limpio.startsWith(prefijo + '/')) return seccion;
  }
  return null;
}

/**
 * Nivel que exige un método HTTP. Leer es `view`; cualquier cosa que cambie
 * datos es `edit`. Así el permiso ver/editar de la matriz se aplica solo, sin
 * tener que anotar ruta por ruta cuál escribe.
 */
export function levelForMethod(method: string): Exclude<PermissionLevel, 'none'> {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ? 'view' : 'edit';
}
