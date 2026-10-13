# Atlas Online University Runbook Maestro (Operación Local + Handoff de Agente)

Este archivo es la guía única para entender, levantar y operar el proyecto `atlas` sin contexto previo.

## 1) Qué es este proyecto

`Atlas Online University` es una plataforma OTT + LMS con:

- `Moodle` como backoffice académico (cursos, módulos, actividades, progreso).
- `API Intermediador` (BFF + dominio) como capa obligatoria para TODO.
- `Web pública` (landing, exploración, cursos, perfil, tickets, empresa).
- `Web admin` (control operativo central: sync, usuarios, cursos, webinars, eventos, podcasts, empresas, configuración Moodle/integraciones).

Regla de oro:
- Ningún frontend debe consumir Moodle ni servicios externos directo.
- Todo entra/sale por `apps/api`.
- Jamás dejar archivos compilados (.js, .jsx) colgados en las carpetas de código fuente fuente (.tsx), ya que Vite les dará prioridad superior al construir.

## 2) Estructura del repo

- `apps/api`: backend Fastify + integración Moodle + integraciones externas + persistencia.
- `apps/web`: frontend React (pública + admin).
- `packages/shared`: tipos/contratos compartidos.
- `docs`: documentación funcional/técnica histórica.
- `infra`: archivos auxiliares (incluye config de PHP para Moodle local).
- `docker-compose.yml`: PostgreSQL, Redis, Adminer, Moodle y MariaDB de Moodle.

## 3) Requisitos

- `Node.js` 20+ (recomendado 22 LTS).
- `npm` 10+.
- `Docker` + `Docker Compose`.

## 4) Variables de entorno

### 4.1 Inicializar `.env`

```bash
cp .env.example .env
```

### 4.2 Variables críticas

- `PORT=4000` (API).
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` (login del panel admin).
- `DATABASE_URL` (PostgreSQL del intermediador).
- `MOODLE_BASE_URL` / `MOODLE_TOKEN` (conexión Moodle).
- `EXTERNAL_INTEGRATION_BASE_URL` / `EXTERNAL_INTEGRATION_API_KEY` (eventos/tickets externos).

Nota importante de DB local:
- `docker-compose` expone PostgreSQL en host `65432`.
- Por eso, para usar la DB de compose, deja `DATABASE_URL` así:

```env
DATABASE_URL=postgresql://atlas:atlas@localhost:65432/atlas
```

## 5) Levantar todo en local (completo)

## 5.1 Infra base

```bash
docker compose up -d postgres redis adminer
docker compose --profile moodle up -d moodle-db moodle
```

## 5.2 Dependencias JS

```bash
npm install
```

## 5.3 Backend API

```bash
npm run dev:api
```

## 5.4 Frontend Web

```bash
npm run dev:web
```

También puedes usar un solo comando (mantiene API+Web juntos):

```bash
npm run dev
```

## 5.5 URLs locales

- Web pública: `http://localhost:5174/`
- Web admin: `http://localhost:5174/admin`
- API base: `http://localhost:4000/api`
- Health API: `http://localhost:4000/api/health`
- Moodle: `http://localhost:8081`
- Adminer: `http://localhost:8080`

## 6) Credenciales operativas

## 6.1 Admin del intermediador

Tomadas de `.env`:

- email: `ADMIN_EMAIL`
- password: `ADMIN_PASSWORD`

Valores por defecto en ejemplo:
- `admin@atlas.local`
- `AtlasAdmin!2026`

## 6.2 Moodle local

Se define durante el wizard inicial en `http://localhost:8081`.
Credenciales locales fijadas para administración:

- usuario: `admin`
- contraseña: `AtlasMoodle!2026`
- login web: `http://localhost:8081/login/index.php`

DB de Moodle en wizard:

- host: `moodle-db`
- db: `moodle`
- user: `moodle`
- pass: `moodle`

## 7) Configurar Moodle para integrarlo

1. Entrar a Moodle admin.
2. Habilitar Web Services + REST.
3. Crear servicio externo.
4. Agregar funciones (mínimo):
   - `core_webservice_get_site_info`
   - `core_course_get_courses`
   - `core_course_get_contents`
   - `core_user_get_users`
   - `core_user_create_users`
   - `core_user_get_users_by_field`
   - `core_user_update_users`
   - `core_enrol_get_users_courses`
   - `core_enrol_get_enrolled_users`
   - `enrol_manual_enrol_users`
   - `enrol_manual_unenrol_users`
   - `core_notes_create_notes`
   - `core_notes_get_notes`
   - `core_completion_get_activities_completion_status`
   - `core_completion_update_activity_completion_status_manually`
5. Crear token para usuario admin Moodle.
6. Configurar conexión Moodle desde Admin del intermediador:
   - sección Conexiones/Moodle
   - o endpoint `PUT /api/admin/moodle/config`
7. La base local usa `lthub/moodle:education-4.1.14-1` en `http://localhost:8081` y el contenedor escucha internamente en `80`.

## 8) Componentes funcionales implementados (actual)

## 8.1 API Intermediador (`apps/api`)

- Auth pública (registro/login/sesión/perfil).
- Home y catálogo.
- Cursos y contenido por slug/id.
- Progreso e interacciones de curso.
- Entitlements/ofertas.
- Webinars.
- Podcasts.
- Integración de eventos externos y agrupaciones.
- Tickets por usuario autenticado (via API del intermediador).
- Empresas (representante, colaboradores, cursos habilitados).
- Admin total:
  - estado/rutas/config
  - tenants
  - usuarios (individual/bulk)
  - cursos/categorías Moodle
  - sync Moodle (cursos, usuarios, categorías, all)
  - conexión Moodle editable
  - webinars/podcasts CRUD
  - eventos externos + agrupaciones + visibilidad landing
  - compañías + miembros + acceso a cursos

## 8.2 Web pública (`apps/web`)

**El programa es la unidad del sitio público.** Es lo que se navega y aquello
en lo que el estudiante se matricula; los cursos viven DENTRO del programa y no
se ven ni se cursan por separado. Quien no está matriculado ve, en la ficha del
programa, el temario: los cursos que incluye con su nombre y su descripción,
sin enlace y sin vista previa. Al aula de un curso sólo se entra desde «Mis
cursos», que son las matrículas activas del estudiante.

- Landing moderna.
- Slider principal (programas destacados).
- Secciones dinámicas: mis cursos, webinars/eventos, podcasts, áreas.
- Explorar catálogo de programas, con filtro por área y orden A-Z. La búsqueda
  mira también los cursos del temario.
- Ficha del programa: resumen, temario (los cursos que incluye, como índice no
  navegable), plan de ocho semanas, formato y programas de la misma área.
- Aula del curso y consumo de módulos, sólo para quien tiene matrícula activa.
  No hay modo vista previa ni módulos candados: fueron la puerta por la que se
  llegaba a un curso suelto.
- Gestión de progreso y aprendizaje.
- Mis entradas (tickets del usuario).
- Perfil (edición de datos).
- Sección empresas destacada.
- Responsive mobile/tablet.

## 8.3 Web admin (`apps/web` ruta `/admin`)

- Login admin.
- Dashboard de estado.
- Rutas API.
- Usuarios (paginado, activación/desactivación, bulk, cursos por usuario).
- Cursos/categorías.
- Conexiones (Moodle/integraciones).
- Webinars.
- Podcasts.
- Eventos integrados y agrupaciones.
- Empresas.
- **Resumen de actividad**: estado operativo con datos reales (conteos y
  semáforos binarios) y, debajo, una vista previa del tablero analítico
  comprometido para la Etapa V, con datos de demostración y rótulo explícito.
  La separación es contractual (Cláusula 4): las gráficas no son entregable
  de las etapas actuales y no deben presentarse como cifras de la institución.
- **Reportes**: inventarios reales con búsqueda, filtros, ordenación y
  exportación a CSV (BOM UTF-8, CRLF por RFC 4180, neutralización de fórmulas
  para que Excel no ejecute una celda que empiece por `=`). Cubre programas,
  cursos de Moodle, usuarios de la plataforma, usuarios del panel, seminarios,
  podcasts y el inventario de rutas de API. Una pestaña aparte agrupa la vista
  previa analítica de Etapa V, que no ofrece exportación a propósito: un CSV
  descargado pierde el rótulo de «datos de muestra».
- **Roles y permisos**: gestor de roles con matriz sección × (ninguno / ver /
  editar) y administración de las cuentas del panel.
- **Panel bilingüe (ES/EN)**: todos los textos pasan por i18next. El idioma
  arranca según el de la persona y se cambia con el selector de la cabecera,
  presente también en la pantalla de acceso.
- La barra lateral sólo muestra las secciones que el rol puede abrir, y marca
  «solo lectura» las que puede consultar sin editar. Esto es presentación: la
  comprobación real la hace el servidor en cada petición.

## 8.4 Identidad y permisos del panel (`apps/api/src/modules/iam`)

Sustituye la cuenta única que se comparaba contra `ADMIN_EMAIL` /
`ADMIN_PASSWORD` del `.env` y las sesiones en memoria.

Tablas (migración idempotente en cada arranque, `migrateIam`):

- `admin_roles` — roles; `is_system` protege a `superadmin`.
- `admin_role_permissions` — `(role_id, section, level)` con
  `level IN ('none','view','edit')`.
- `admin_users` — cuentas del panel; contraseña con scrypt y salt por usuario.
- `admin_sessions` — sesiones persistentes, que ya sobreviven a `pm2 restart`.

Las 18 secciones del panel se declaran en un único sitio,
`apps/api/src/modules/iam/sections.ts`, que usan a la vez la matriz de
permisos, el guardián y la barra lateral.

**Cómo se aplican los permisos.** Un hook `preHandler` sobre `/admin/*`, no
anotación ruta por ruta: el panel tiene casi trescientas rutas y anotarlas una
a una garantiza que alguna se quede sin anotar. El hook deduce la sección por
prefijo de ruta (tabla `ROUTE_SECTIONS`) y el nivel por método HTTP (`GET`
pide `view`, lo demás pide `edit`). **Una ruta que no esté en esa tabla no
queda abierta**: se trata como exclusiva del superadministrador, para que una
ruta nueva falle de forma visible en lugar de quedar accesible a todos.

Si añades una ruta `/admin/...` nueva, añádela también a `ROUTE_SECTIONS`.

Roles sembrados al arrancar: `superadmin`, `academico`, `admisiones`,
`acreditacion`, `contenido`, `finanzas`, `lectura`. Si un rol ya existe no se
reescriben sus permisos: un despliegue no debe deshacer un ajuste manual.

Dos salvaguardas deliberadas:

- La cuenta de `ADMIN_EMAIL` / `ADMIN_PASSWORD` del `.env` **sigue
  funcionando** como superadministrador de rescate. Si alguien deja la matriz
  en un estado que impide entrar, esa cuenta no depende de la base.
- Los permisos del rol `superadmin` **no se pueden modificar** (devuelve 400).
  Si se pudieran, un clic dejaría la plataforma sin nadie capaz de volver a
  conceder permisos.

`ADMIN_API_KEY` (cabecera `x-admin-key`) se mantiene y equivale a
superadministrador: es la que usan los temporizadores de systemd.

Los permisos se releen en cada petición en vez de viajar dentro del token,
para que retirar un acceso surta efecto en ese momento y no al caducar la
sesión.

## 9) Puertos fijos esperados

- `4000`: API
- `5174`: Web (pública + admin)
- `8081`: Moodle
- `8080`: Adminer
- `65432`: PostgreSQL host
- `6379`: Redis

## 10) Rutas API clave

Todas cuelgan de `/api` por `rewriteUrl` en Fastify.

## 10.1 Públicas v1

- `GET /api/v1/home` — `featured`, `continueLearning` y `programs` son
  programas; `liveNow` sigue siendo contenido suelto (seminarios).
- `GET /api/v1/catalog` — array de PROGRAMAS, no de cursos. Cada programa trae
  `courseCount` y `courses[]` (título, resumen y módulos de cada curso). Los
  cursos **no** llevan identificador de Moodle, a propósito: sin él no se puede
  construir una ruta a un curso, y la regla «no se ve ni se cursa un curso
  suelto» queda garantizada por construcción y no por disciplina del cliente.
- `GET /api/v1/programs/catalog` — el mismo catálogo, por su nombre propio.
- `GET /api/v1/catalog/:slug?locale=es|en` — ficha del programa:
  `{ content, program, outline, related, entitlement }`. `content` y `program`
  son el mismo programa (`content` se conserva por compatibilidad), `outline`
  es el plan de ocho semanas y `related` hasta 3 programas de la misma área.
  El slug es el código del programa en minúsculas (`TFU-SALES-EXC` ->
  `tfu-sales-exc`); los slugs antiguos de curso (`moodle-pcl-sales-exc-12`)
  siguen resolviendo al programa que contiene ese curso, para no romper los
  enlaces ya repartidos.
- `GET /api/v1/courses/:moodleCourseId/content`
- `GET /api/v1/courses/:moodleCourseId/progress`
- `PUT /api/v1/courses/:moodleCourseId/progress`
- `POST /api/v1/courses/:moodleCourseId/modules/:moduleId/complete`
- `POST /api/v1/courses/:moodleCourseId/modules/:moduleId/respond`
- `GET /api/v1/courses/:moodleCourseId/interactions`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`
- `PATCH /api/v1/auth/me`
- `GET /api/v1/me/courses`
- `GET /api/v1/me/tickets`
- `GET /api/v1/webinars`
- `GET /api/v1/podcasts`
- `GET /api/v1/integration/events/grouped`
- `GET /api/v1/legal/terms`
- `GET /api/v1/legal/privacy`

## 10.2 Admin

- `POST /api/admin/auth/login`
- `GET /api/admin/auth/me`
- `POST /api/admin/auth/logout`
- `GET /api/admin/status`
- `GET /api/admin/routes`
- `GET /api/admin/config`
- `GET /api/admin/iam/sections` — catálogo de secciones y niveles
- `GET|POST /api/admin/iam/roles`
- `PATCH|DELETE /api/admin/iam/roles/:id`
- `PUT /api/admin/iam/roles/:id/permissions` — matriz completa del rol
- `GET|POST /api/admin/iam/users`
- `PATCH|DELETE /api/admin/iam/users/:id`
- `GET /api/admin/users`
- `POST /api/admin/users`
- `PATCH /api/admin/users/:userId/status`
- `POST /api/admin/users/status/bulk`
- `POST /api/admin/users/:userId/enrollments`
- `GET /api/admin/users/:userId/courses`
- `GET /api/admin/moodle/config`
- `PUT /api/admin/moodle/config`
- `POST /api/admin/moodle/sync/courses`
- `POST /api/admin/moodle/sync/categories`
- `POST /api/admin/moodle/sync/users`
- `POST /api/admin/moodle/sync/all`
- `GET /api/admin/webinars` + CRUD
- `GET /api/admin/podcasts` + CRUD
- `GET /api/admin/integration/external/events/grouped`
- `PATCH /api/admin/integration/external/groups/:groupKey`
- `GET /api/admin/companies` + CRUD (Creación, Edición, Eliminación)
- `GET /api/admin/companies/:companyId/members` + CRUD (Añadir, Desactivar, Eliminar)
- `GET /api/admin/companies/:companyId/courses` + CRUD
- `GET /api/admin/companies/:companyId/groups` + CRUD (Paquetes de cursos)
- `PUT /api/admin/companies/:companyId/groups/:groupId/courses/:moodleCourseId` (Añadir curso a paquete)
- `GET /api/admin/companies/:companyId/members/:userId/assignments` (Accesos por colaborador)
- `PUT /api/admin/companies/:companyId/members/:userId/groups/:groupId` (Asignar paquete a colaborador)
- `PUT /api/admin/companies/:companyId/members/:userId/courses/:moodleCourseId` (Asignar curso a colaborador)

## 11) Sincronización y consistencia

- Moodle sync automático: `AUTO_SYNC_INTERVAL_SEC`.
- Freshness para rutas públicas: `PUBLIC_SYNC_MAX_AGE_SEC`.
- Configuración Moodle editable y persistida por API admin (`integration_settings`).
- Si cambias cursos/categorías/usuarios en Moodle, ejecuta:

```bash
curl -X POST http://localhost:4000/api/admin/moodle/sync/all \
  -H "Content-Type: application/json" \
  -H "x-admin-key: dev-admin-key"
```

o hazlo desde panel admin.

## 12) Comandos de mantenimiento y validación

## 12.1 Typecheck

```bash
npm run check
```

o por app:

```bash
npm run -w @atlas/api check
npm run -w @atlas/web check
```

## 12.2 Build

```bash
npm run build
```

## 12.3 Smoke test rápido API

```bash
curl http://localhost:4000/api/health
curl http://localhost:4000/api/v1/home
curl http://localhost:4000/api/v1/catalog
```

## 13) Troubleshooting rápido

- `ERR_CONNECTION_REFUSED` a `:4000`:
  - la API no está arriba -> iniciar `npm run dev:api`.

- Web abre pero sin datos:
  - revisar `VITE_API_URL` (por defecto usa `http://localhost:4000/api`).

- No sincroniza con Moodle:
  - revisar token/base URL en admin conexión Moodle.
  - ejecutar sync manual `sync/all`.
  - confirmar que funciones web service de Moodle estén habilitadas.

- Login público/admin falla:
  - validar credenciales y sesiones.
  - revisar logs de API terminal.

- DB no conecta:
  - confirmar `DATABASE_URL` usando `65432` si PostgreSQL viene de compose.

- Cambios de frontend “no aparecen”:
  - confirmar que estás en `http://localhost:5174`.
  - reiniciar `npm run dev:web`.

## 14) Onboarding express para otro agente (paso a paso exacto)

1. `cd /Users/john/Documents/atlas`
2. `cp .env.example .env` (si no existe).
3. Ajustar `DATABASE_URL` a puerto `65432`.
4. `docker compose up -d postgres redis adminer`
5. `docker compose --profile moodle up -d moodle-db moodle`
6. `npm install`
7. Terminal A: `npm run dev:api`
8. Terminal B: `npm run dev:web`
9. Abrir:
   - `http://localhost:5174/`
   - `http://localhost:5174/admin`
   - `http://localhost:8081`
10. Configurar conexión Moodle en admin (`/admin` -> Conexiones) con URL+token válidos.
11. Ejecutar sync completo (`/admin` -> Sync all Moodle).
12. Verificar flujo final:
   - catálogo visible en público
   - login/register público funcionando
   - progreso/entradas/cursos consumidos por API
   - usuarios/cursos en admin sincronizados

## 15) Decisiones operativas que no se deben romper

- API intermediador es fuente de verdad operativa de experiencia digital.
- Moodle se usa como backoffice académico, no como frontend.
- Todas las nuevas integraciones externas deben entrar por `apps/api`.
- Cualquier feature pública nueva debe quedar administrable en `/admin` cuando aplique.
- Mantener consistencia de puertos locales: `4000` API, `5174` web, `8081` Moodle.
- **El catálogo público expone programas, nunca cursos sueltos.** El payload de
  un programa no lleva el identificador de Moodle de sus cursos: es lo que hace
  imposible construir una ruta a un curso. Si alguien lo añade «por comodidad»,
  el front podrá volver a enlazar cursos individuales y la regla se cae sola.
- Al aula de un curso se entra **sólo** desde «Mis cursos», con el id de la
  matrícula. El sitio público no tiene ruta de curso.

## 16) Etapa I — CIE Readiness (módulo `cie`)

Entrega contractual de la Etapa I de The Floridian University: **repositorio de
compliance documental** y **checklist de estado documental con semáforo**. Es
estado operativo **binario** —qué evidencia existe y qué falta—, no analítica
de indicadores: volúmenes, tasas y tendencias son Etapa V. Por eso en esta
capa no se usa Recharts ni ninguna librería de gráficos.

### 16.1 Qué NO es

No sustituye ni toca la tabla `compliance_records` (módulo `syllabus`), que es
la lista de estado por área (FERPA, IPEDS, WCAG, Title IX, ADA, acreditación)
mantenida a mano y expuesta en `/admin/compliance/records`. Las dos conviven y
resuelven problemas distintos. Por lo mismo el módulo usa el prefijo
`/admin/cie/`, no `/admin/compliance/`.

### 16.2 Archivos

- `apps/api/src/modules/cie/schema.ts` — `migrateCie(pool)`: tablas, índices
  parciales de unicidad y siembra idempotente del catálogo de evidencia.
- `apps/api/src/modules/cie/service.ts` — `getCieChecklist(pool, institutionName)`
  y `signalFor(counts, cieRequired)`: el cálculo del semáforo.
- `apps/api/src/modules/cie/routes.ts` — `registerCieRoutes(app, { pool, ensureAdmin })`.
- `apps/web/src/components/admin/views/CieChecklistView.tsx` — panel admin,
  sección **Checklist CIE**.
- `apps/web/src/components/public/ContactSection.tsx` — formulario público,
  vista **Contacto**.

### 16.3 Tablas

| Tabla | Para qué |
| --- | --- |
| `cie_document_types` | Catálogo de evidencia exigida (19 tipos sembrados, editables). `scope IN ('institutional','program','faculty')`, `cie_required`. |
| `cie_documents` | El repositorio. Cada documento cuelga de un solo ámbito; índices parciales impiden dos del mismo tipo por unidad (violación → HTTP 409). |
| `faculty_records` | Expedientes de faculty, con cobertura documental calculada. |
| `contact_messages` | Bandeja del formulario público. |

Los programas **no** son una tabla nueva: se reutiliza `degree_programs`
(`apps/api/src/db.ts`), cuya columna `is_active` decide qué programas exigen
evidencia. Se gestionan desde la sección **SIS / Académico** del panel
(`/admin/degree-programs`).

### 16.4 Reglas del semáforo (no romper)

- Una pieza de evidencia cuenta como completa **solo** si `status = 'approved'`
  y no está vencida (`expires_at IS NULL OR expires_at >= CURRENT_DATE`).
- Unidades esperadas por ítem: 1 para `institutional`, nº de programas activos
  para `program`, nº de expedientes activos para `faculty`.
- `green` = toda la evidencia esperada aprobada; `red` = nada aprobado,
  pendiente ni vencido; `amber` = cualquier punto intermedio.
- **Un conjunto vacío NO es verde.** Si `expected = 0` y el tipo es
  `cie_required`, la señal es **roja** y el ítem lleva una fila de hueco que lo
  dice con palabras ("No hay programas activos registrados"). Si el tipo no es
  `cie_required`, un conjunto vacío sí es verde (no hay nada que probar).
  Pintar en verde un "0 de 0 aprobados" le diría a la institución que su
  expediente está listo cuando no hay nada cargado.
- El resumen y el semáforo global cuentan **solo** los tipos `cie_required`.
- El color nunca es el único portador del estado: cada señal lleva su etiqueta
  de texto (WCAG 2.1 AA).

### 16.5 Rutas

Públicas: `GET /v1/programs?locale=`, `POST /v1/contact` (201; 202 con
`id:"discarded"` si se rellena el honeypot `company`; 429 a partir de 5 envíos
por IP en 60 minutos).

Admin: `GET /admin/cie/checklist`, `GET /admin/cie/overview`, CRUD de
`/admin/cie/document-types`, `/admin/cie/documents` (filtros `?scope= ?status=
?programId= ?facultyId= ?documentTypeId=`), `/admin/cie/faculty`, más
`GET /admin/contact-messages` y
`PATCH /admin/contact-messages/:messageId/status`.

`X-Forwarded-For` solo se honra para el límite por IP si la conexión viene de
loopback o de un rango privado; si no, la cabecera sería trivial de falsificar
y el límite no serviría de nada.

### 16.6 Manejador global de errores

`apps/api/src/server.ts` instala un `setErrorHandler` justo después de
`register(sensible)`: `ZodError` → 400 con `{message, fields}`; PG `23505` →
409; PG `23503`/`23514`/`22P02` → 400; 4xx ya tipados se dejan pasar; el resto
→ 500 genérico con el detalle solo en el log. Antes de esto cualquier
`schema.parse()` fallido salía como 500 con el volcado interno de Zod,
incluidas `/v1/auth/register`, `/v1/auth/login` y `/admin/auth/login`.

### 16.7 Correcciones de build

- `packages/shared` publica JavaScript compilado (`main: dist/index.js`,
  `types`, `exports`, `files`), no TypeScript crudo. El API compilado importa
  `@atlas/shared` y con `main: src/index.ts` solo arrancaba en Node >= 22.18.
- `packages/shared/tsconfig.json` fija `rootDir: "src"` para que la salida sea
  `dist/index.js` y no `dist/src/index.js`.
- Los `*.tsbuildinfo` no se versionan: un `tsbuildinfo` commiteado convierte
  `tsc -p` en un no-op silencioso y un clon limpio no compila nada.
- `npm run build` fija el orden `shared → api → web`; `-ws` compilaba `shared`
  al final.
- `modules/backoffice/routes.ts` importaba `../../integrations/gusto` y
  `../../integrations/quickbooks` sin extensión: en ESM compilado eso no
  resuelve y el API no arrancaba con `node`.

### 16.8 Verificación

```bash
npm install
npm run check                 # los tres workspaces
rm -rf packages/shared/dist apps/*/dist
npm run build                 # deja packages/shared/dist/index.js plano
node apps/api/dist/apps/api/src/server.js      # node pelado, sin flags de TS
./infra/deploy/91-etapa1-functional-test.sh \
  --base-url http://localhost:4000/api --admin-key "$ADMIN_API_KEY"
```

`91-etapa1-functional-test.sh` escribe datos: solo staging o local. Marca SKIP
los dos casos que necesitarían desactivar un programa, porque
`/admin/degree-programs` no expone `PATCH` ni `DELETE` y crea el programa ya
activo.

### 16.9 Kit de despliegue

`infra/deploy/` (scripts numerados + `00-config.sh`), `infra/nginx/`,
`infra/moodle/` y `.github/workflows/{ci,deploy}.yml`. Destinos:
`portal.thefloridianuniversity.com` (SPA en bucket Lightsail + CDN),
`api.portal.thefloridianuniversity.com` (Fastify en 44.210.204.140),
`lms.portal.thefloridianuniversity.com` (Moodle en 34.200.208.43).
`INSTITUTION_NAME=The Floridian University` se fija vía SSM
(`infra/deploy/env.production.local.example` → `50-secrets-put.sh`); el default
commiteado en `.env.example` es el de desarrollo de esta rama y no se cambia.

## 17) Marca de la institución (multi-institución)

El producto sirve a varias instituciones con un mismo código. El nombre NO se
escribe a mano en los textos: las traducciones usan `{{brand}}` (nombre
completo) y `{{brandShort}}` (nombre corto), que i18next resuelve mediante
`interpolation.defaultVariables` en `apps/web/src/i18n.ts`.

| Dónde | Variable | Por defecto |
|---|---|---|
| Frontend (build) | `VITE_INSTITUTION_NAME` | `Atlas Online University` |
| Frontend (build) | `VITE_INSTITUTION_SHORT_NAME` | primera palabra del nombre completo |
| API (runtime) | `INSTITUTION_NAME` | `University` |

El título de la pestaña sale del plugin `institutionTitle` de
`apps/web/vite.config.ts`, que sustituye `%VITE_INSTITUTION_NAME%` en
`index.html` y garantiza un valor aunque la variable no esté definida;
`main.tsx` lo reafirma en tiempo de ejecución.

Para desplegar a una institución concreta basta con exportar esas variables
antes del build. **No se edita el repositorio para cambiar de marca.** El
despliegue de The Floridian University usa:

```bash
VITE_INSTITUTION_NAME="The Floridian University" \
VITE_INSTITUTION_SHORT_NAME="Floridian" \
  npm run build -w @atlas/web
```

y `INSTITUTION_NAME=The Floridian University` en el `.env` de la API.

## 18) Identidad visual — Peregrine Corporate Learning

La paleta y la tipografía salen de `peregrineeducationus.com`, medidas sobre
los estilos computados del sitio en producción.

| Token | Valor | Uso |
|---|---|---|
| `--pcl-navy-900` | `#081627` | fondo más profundo |
| `--pcl-navy-800` | `#0b203a` | fondo principal |
| `--pcl-navy-700` | `#16324f` | superficies y tarjetas |
| `--pcl-navy-600` | `#1f4063` | bordes y hover |
| `--pcl-cyan` | `#00cde8` | acento de marca |
| `--pcl-ice` | `#cfe0ee` | texto secundario |
| `--pcl-coral` | `#ff6b6b` | alertas |
| `--pcl-gold` | `#d4af36` | distinciones |

Tipografía: **Area Extended ExtraBold** (Blaze Type) en titulares y **Roboto**
en texto, igual que el sitio corporativo. La fuente se sirve desde el propio
dominio en `apps/web/public/fonts/AreaExtended-Extrabold.woff2` (74 KB, 58 %
menos que el `.otf` original).

Todo vive en `apps/web/src/brand.css`, que `main.tsx` importa **antes** que
cualquier otra hoja. Los tokens que ya usaban la web pública (`--bg`,
`--surface`, `--accent`…) y el panel (`--bg-top`, `--card`, `--accent`…) se
reapuntan a esta paleta: así la marca se cambia en un solo archivo sin tocar
las casi 4.000 líneas de estilos existentes.

**Licencia:** Area es una fuente comercial de Blaze Type. El sitio corporativo
ya la usa, pero conviene confirmar que la licencia cubre uso como webfont en
este dominio antes de salir a producción abierta.

## 19) Catálogo Peregrine en Moodle

`infra/catalogo/peregrine.json` tiene las 5 categorías y los 13 programas
publicados en el sitio. `sync-peregrine.mjs` los crea o actualiza en Moodle de
forma idempotente (categorías por `idnumber`, cursos por `shortname`) y oculta
los cursos que no estén en el catálogo — **ocultar, no borrar**: en Moodle
borrar un curso arrastra matrículas y calificaciones.

Un curso oculto en Moodle (`visible = 0`) deja de publicarse en el catálogo
público y su ficha se retira de `content_assets`, pero sigue en
`moodle_courses` para que el panel admin lo vea. Los textos que vienen de
Moodle se decodifican de entidades HTML antes de guardarse.

## 20) Modelo programa → cursos en el sitio público

El programa es la unidad: se navega, se presenta y se matricula. Los cursos
viven dentro y no tienen página propia.

**Dónde está cada pieza**

| Pieza | Archivo |
|---|---|
| Programas para el sitio público | `apps/api/src/modules/programs/service.ts` |
| Composición programa → cursos | `apps/api/src/modules/programs/schema.ts` |
| Tipos del front (`ProgramaPublico`, `CursoDelPrograma`) | `apps/web/src/lib/api.ts` |
| Catálogo, portada, ficha y aula | `apps/web/src/components/PublicApp.tsx` |
| Estilos del temario | `apps/web/src/components/programa.css` |

La relación no usa tabla nueva: `degree_requirements` con
`requirement_type = 'course'` ya significa «este curso forma parte de este
programa», y es lo que lee la auditoría de grado del SIS. La migración sólo le
añadió `sort_order`, porque un programa con varios cursos necesita decir cuál
va primero.

**Lo que no se debe deshacer**

- Los cursos del temario se pintan como `<li>` con texto: ni `<a>`, ni
  `<button>`, ni `onClick`. Si parecieran pulsables, el visitante haría clic y
  no pasaría nada, que es peor que leerlos como el índice que son.
- `courses[].modulos` es `null` cuando el aula de Moodle todavía no está
  montada. En ese caso el dato se **omite**; no se escribe un `0`, que se leería
  como «aula vacía».
- `GET /v1/courses/:moodleCourseId/content` exige matrícula activa y responde
  403 sin ella. Esa comprobación del servidor es la que de verdad cierra el
  acceso; el front sólo deja de ofrecerlo.

**El payload público NO lleva el id de Moodle de los cursos.** Es deliberado.
La regla «no se cursa un curso suelto» la impone el servidor negando el
contenido sin matrícula, pero si el id viajara al front, la interfaz podría
volver a construir una ruta al curso. Omitirlo lo hace imposible por
construcción en vez de por disciplina. Si alguna vista necesita el id, que lo
pida por una ruta de admin, no por el catálogo público.

**Componer programas desde el panel.** Sección «Programas y cursos», dentro del
grupo Académico. Sus rutas están bajo `/admin/degree-programs`, que el guardián
ya asigna a la sección de permisos `sis`; por eso la entrada del menú lleva
`permiso: 'sis'` en `NAV_GROUPS` y no una sección propia, que el servidor no
conocería.

- `GET /admin/degree-programs/composition`
- `GET /admin/degree-programs/available-courses`
- `POST /admin/degree-programs/:id/courses`
- `DELETE /admin/degree-programs/:id/courses/:moodleCourseId`
- `PUT /admin/degree-programs/:id/courses/order`

Dos reglas que impone el servidor y conviene no quitar: un curso **no puede
pertenecer a dos programas** (409), porque dejaría ambiguo de qué programa
depende la matrícula de quien lo esté cursando; y no se puede desvincular un
curso con **matrículas activas** dentro de ese programa (400), porque esos
estudiantes quedarían con una matrícula que no cuelga de nada.

### 20.1 BLOQUEANTE: la matrícula en Moodle no funciona

**Síntoma.** Cualquier intento de matricular devuelve
`wsusercannotassign`: «No tiene permisos para asignar el rol (5) a este
usuario (N) en este curso (M)».

**Alcance.** Comprobado en producción: `user_course_enrollments` está **vacía**.
El alta de estudiantes desde la plataforma no ha funcionado nunca, ni por
programa ni por curso. No lo introdujo el cambio de modelo; estaba antes y
quedó a la vista al probar la matrícula por programa de punta a punta.

**Causa.** En Moodle, asignar un rol exige DOS cosas y el aprovisionamiento
dejó sólo una:

1. La capacidad `moodle/role:assign`. Esa **sí** la concede
   `paeu-provision-webservice.php` al rol `paeu_ws_client`.
2. Una autorización explícita por pareja de roles en la tabla
   `role_allow_assign` («el rol X puede asignar el rol Y»). Sin la fila
   `paeu_ws_client → student`, la capacidad no basta y Moodle lanza
   exactamente `wsusercannotassign`.

Es configuración, no código: la API llama bien a `enrol_manual_enrol_users`.

**Arreglo.** `infra/moodle/cli/paeu-permitir-asignar-estudiante.php`, idempotente
y con `--dry-run`. Necesita shell en la máquina de Moodle, hoy con el puerto 22
cerrado. **No se puede hacer por servicio web**: de las 21 funciones habilitadas
ninguna toca roles ni permisos.

**Hasta que se arregle**, el panel NO oculta el fallo: la matrícula por programa
devuelve `coursesFailed` con el id de cada aula y su error, y la interfaz lo
muestra como error, no como éxito.

**Moodle.** Hacia fuera ya está cerrado: `/course/view.php` y el buscador
redirigen a login y no revelan nombres de curso a un visitante anónimo
(comprobado). Lo que queda abierto es el hueco de dentro —una persona ya
autenticada en Moodle que se automatricule— y **no se puede cerrar por servicio
web**: de las 21 funciones habilitadas ninguna gestiona métodos de
matriculación. El guion está listo en
`infra/moodle/cli/paeu-cerrar-curso-suelto.php`; desactiva las instancias
`self` y `guest` de los cursos `PCL-*`, deja intacta la `manual` (que es por
donde matricula la plataforma) y aborta avisando si algún curso se quedara sin
ella. Requiere shell en la máquina de Moodle, hoy con el puerto 22 cerrado,
igual que `paeu-ajustes-bilingue.php`.

**Alias del CDN.** Lightsail no tiene reescritura comodín, así que cada ficha
necesita su alias del index. `PROGRAM_FALLBACK_SLUGS_DEFAULT` en
`infra/deploy/00-config.sh` lleva los trece slugs de programa (`tfu-*`) y, a
propósito, también los trece slugs antiguos de curso (`moodle-pcl-*-<id>`): la
API los resuelve al programa que contiene ese curso, pero sin su alias el
enlace directo moriría en un 403 de S3 antes de llegar al SPA.

---

## 21) Plataforma del estudiante: programa, matrícula SIS y calificaciones

Esta sección documenta la tanda de trabajo que hizo funcional la plataforma del
estudiante. El punto de partida era que el estudiante demo entraba y no veía
nada, y la causa no era una sino **cinco**, encadenadas. Se describen todas
porque cada una se puede volver a introducir por separado.

### 21.1 Las cinco causas

**1. Dos nociones de «periodo» que no se hablaban.** `academic_terms` es la
tabla a la que apunta la clave ajena de `student_enrollments`. Sólo contenía
tres periodos heredados de Atlas (`DEMO-*`), y el marcado como activo era Spring
2026, terminado en mayo. El periodo real, `TERM-2026-FALL`, vivía **sólo** en
`term_grids`, cuyo `term_id` es texto libre sin clave ajena a nada. Es decir:
**no se podía crear una matrícula SIS para el periodo real**, porque la clave
ajena no tenía a dónde apuntar.

**2. La matrícula por programa nunca escribía `student_enrollments`.** Escribía
sólo `user_course_enrollments`, que es el espejo de Moodle. Pero el expediente
(`/v1/me/transcript`), el promedio (`/v1/me/gpa`) y la auditoría de grado leen
`student_enrollments`. Aunque §20.1 se arreglara mañana, los tres seguirían
vacíos.

**3. Las calificaciones no tenían ninguna vía de registro.**
`student_enrollments.grade` no tenía un solo escritor en todo el código. Y no se
pueden traer del libro de calificaciones de Moodle: de las 21 funciones del
servicio web **ninguna es `gradereport_*`**.

**4. El portal no tenía vista de programa.** Tenía «Mis cursos», «Expediente» y
«Perfil», lo que contradice el modelo del §20, donde el programa es la unidad.

**5. Restos del producto Atlas en rutas públicas.** `/v1/home` devolvía la fila
`tenants` heredada («Atlas Online University», logo de dummyimage.com) y un
usuario de demostración fijo —María González, mgonzalez@atlas.edu— a cualquiera
que pidiera la portada, autenticado o no.

### 21.2 La separación que hay que mantener

```
matrícula en el PROGRAMA  ->  hecho de la plataforma  ->  student_enrollments
acceso al AULA            ->  hecho de Moodle         ->  user_course_enrollments
```

**Son independientes a propósito, y no se deben volver a acoplar.** Antes la
matrícula entera se caía si Moodle fallaba y no quedaba rastro de nada. Ahora la
fila del SIS se escribe primero y pase lo que pase con Moodle, de modo que con
§20.1 todavía sin arreglar el estudiante ve su programa, su plan de estudios, su
calendario y sus notas, y el portal le dice de frente que el aula no está
disponible. La respuesta de la matrícula distingue las dos cosas: `sisEnrolled`
y `coursesInSis` por un lado, `enrolled` y `coursesFailed` por el otro.

### 21.3 La escala de calificación está PENDIENTE de TFU

`apps/api/src/modules/sis/calificaciones.ts` lleva la escala estadounidense
estándar de 4,0 con tercios, más las marcas no punitivas `P`, `NP`, `I` y `W`.
**TFU no ha confirmado la suya**, igual que no ha confirmado el nivel ni los
créditos de los trece programas. Por eso la ruta `/admin/registrar/scale`
devuelve `pendienteDeConfirmacion: true` y tanto el panel como el portal lo
rotulan — el mismo criterio con el que las gráficas van rotuladas como vista
previa de la Etapa V. **Cuando TFU la confirme se cambia en ese archivo, que es
el único sitio donde vive.**

### 21.4 Terminar un curso no es aprobarlo

`status = 'completed'` significa que el curso ACABÓ, y una `F` también lo acaba.
Lo que decide si el requisito del programa queda cumplido y si los créditos se
ganan es **si la nota aprueba**, que es `LETRAS_APROBATORIAS`. Con la tabla de
notas vacía el error no se veía; al registrar la primera `F` de prueba el
expediente del estudiante decía «3 créditos» mientras la auditoría de grado
decía «0». Si alguien vuelve a escribir `WHERE status = 'completed'` para contar
créditos, reintroduce esa contradicción.

### 21.5 Permisos: dos agujeros que se taparon

- **El rol `superadmin` leía sus permisos de la tabla.** Las secciones nuevas se
  insertan con nivel `none` para los roles que ya existían, `superadmin`
  incluido, así que **cada sección nueva dejaba fuera al superadministrador**
  hasta que alguien se la concediera a mano — incluida, llegado el caso, la
  pantalla de roles desde la que se arregla. Ahora `permisosDeRol` los CALCULA
  cuando la clave del rol es `superadmin`, y eso además es lo que de verdad
  sostiene la invariante del §8.4.
- **Doce rutas `/admin/*` no estaban en `ROUTE_SECTIONS`**, así que sólo las
  podía usar el superadministrador, en silencio. Se mapearon
  `/admin/registrar`, `/admin/students`, `/admin/terms` y `/admin/syllabi`
  —esta última era un error de plural: el mapa decía `/admin/syllabus` y las
  rutas reales son `/admin/syllabi`, de modo que el módulo de sílabos entero
  quedaba fuera del alcance del rol de acreditación.
  **Siguen sin mapear, a la espera de una decisión organizativa sobre quién es
  su dueño:** `/admin/contact-messages`, `/admin/pages`, `/admin/pages/:slug` y
  `/admin/tenants`.

Para comprobarlo en cualquier momento:

```bash
# Lista las rutas /admin que ningún rol salvo superadmin puede usar.
node - <<'JS'
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const src = readFileSync('apps/api/src/modules/iam/sections.ts', 'utf8');
const bloque = src.slice(src.indexOf('export const ROUTE_SECTIONS'), src.indexOf('const ORDENADOS'));
const pares = [...bloque.matchAll(/\['([^']+)',\s*'([^']+)'\]/g)].map((m) => [m[1], m[2]]);
const ord = [...pares].sort((a, b) => b[0].length - a[0].length);
const sec = (p) => ord.find(([x]) => p === x || p.startsWith(x + '/'))?.[1] ?? null;
const rutas = [...new Set([...execSync(`grep -rhoE "app\\.(get|post|put|patch|delete)\\('/admin[^']*'" apps/api/src --include=*.ts`)
  .toString().matchAll(/'(\/admin[^']*)'/g)].map((m) => m[1]))].sort();
const exentas = new Set(['/admin', '/admin/auth/login', '/admin/auth/me', '/admin/auth/logout']);
console.log(rutas.filter((r) => !exentas.has(r) && !sec(r)));
JS
```

### 21.6 Archivos

| Archivo | Para qué |
|---|---|
| `apps/api/src/modules/sis/periodos.ts` | reconcilia `term_grids` con `academic_terms`; `periodoActivo()` |
| `apps/api/src/modules/sis/calificaciones.ts` | la escala, los puntos y qué nota aprueba |
| `apps/api/src/modules/sis/registraduria.ts` | `matricularEnSis()` y las rutas `/admin/registrar/*` |
| `apps/web/src/components/StudentProgram.tsx` | la vista «Mi programa» del estudiante |
| `apps/web/src/components/admin/views/RegistrarView.tsx` | la pantalla de calificaciones del panel |
| `infra/data/limpiar-legacy-atlas.sql` | retirada de los datos de demostración de Atlas |

### 21.7 Rutas nuevas

| Ruta | Qué devuelve |
|---|---|
| `GET /v1/me/program` | el programa del estudiante, su plan con notas y progreso, y la malla del periodo |
| `GET /admin/registrar/enrollments` | las matrículas SIS, filtrables por periodo, programa o estudiante |
| `PATCH /admin/registrar/enrollments/:id` | registra la nota; los puntos y el estado los deriva el servidor |
| `GET /admin/registrar/scale` | la escala, con `pendienteDeConfirmacion` |
| `GET /admin/registrar/term` | el periodo en curso |

Retiradas: `GET /v1/entitlements`, `GET /v1/blueprint` y `GET /v1/offers`, que
servían datos de demostración de Atlas y a las que no llamaba nadie.

### 21.8 Los plazos se muestran en hora del Este

El Master Syllabus fija los cierres a las 23:59 ET y la malla ya resuelve el
cambio de horario de verano. `StudentProgram.tsx` los formatea con
`timeZone: 'America/New_York'` y la zona escrita. Si se dejara en la zona del
navegador, el mismo plazo se leería distinto en cada equipo: con el navegador en
UTC aparecía «14 oct, 03:59», que es el mismo instante que las 23:59 del 13 pero
no se parece a lo que dice la norma.

### 21.9 Cómo se verificó

Todo se probó con la API corriendo contra una base PostgreSQL local, **no contra
producción**, sembrando la malla real del periodo y un programa con su aula:

- Matrícula por programa **con Moodle no configurado**, que es la condición
  exacta de §20.1: respondió `sisEnrolled: true`, `enrolled: false` y
  `coursesFailed` con el error de Moodle; la fila del SIS quedó escrita y
  `user_course_enrollments` siguió en cero.
- Notas `A-`, `F`, `W`, `I` y una fuera de escala: los estados derivados salieron
  `completed`, `completed`, `withdrawn`, `enrolled` y HTTP 400 respectivamente.
- Promedio y auditoría de grado comparados con una `F` y con una `A-`: antes se
  contradecían (3 créditos contra 0), después coinciden.
- Portal con navegador real en español y en inglés: `requestfailed`, `pageerror`,
  respuestas `/api/` con error y mensajes de CSP, los cuatro en cero; sin
  desbordamiento horizontal a 1440 ni a 390 px; ninguna clave i18n sin resolver.
- Paridad i18n comprobada con script: 2.148 claves hoja en cada idioma, ninguna
  apuntando a un objeto.
