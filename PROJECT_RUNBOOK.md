# The Floridian University — Runbook Maestro (Operación Local + Handoff de Agente)

Este archivo es la guía única para entender, levantar y operar el proyecto sin contexto previo.

## 1) Qué es este proyecto

`The Floridian University` es una plataforma OTT + LMS con:

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
DATABASE_URL=postgresql://tfu:tfu@localhost:65432/tfu
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
- `admin@tfu.local`
- `CambiaEstaClave!2026`

## 6.2 Moodle local

Se define durante el wizard inicial en `http://localhost:8081`.
Credenciales locales fijadas para administración:

- usuario: `admin`
- contraseña: `CambiaEstaClave!2026`
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
npm run -w @tfu/api check
npm run -w @tfu/web check
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

1. `cd /Users/john/Documents/pae-u`
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
  `@tfu/shared` y con `main: src/index.ts` solo arrancaba en Node >= 22.18.
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
| Frontend (build) | `VITE_INSTITUTION_NAME` | `The Floridian University` |
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
  npm run build -w @tfu/web
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
| `infra/data/limpiar-legacy-atlas.sql` | retirada de los datos de demostración heredados (1.ª tanda) |
| `infra/data/retirar-ficcion-atlas.sql` | retirada de la ficción de la plantilla: personas, certificados y asientos inventados (2.ª tanda) |

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

### 21.10 Con sesión, el portal cambia de piel

El sitio y el portal del estudiante son la misma aplicación (`PublicApp.tsx`), y
hasta ahora también la misma cabecera. Un estudiante matriculado veía el menú de
captación —«Acerca de», «Admisiones», «Vida estudiantil», «Atletismo»,
«Noticias»— y un botón «Postular ahora» para un proceso que ya había terminado.
Nada de eso le sirve, y encima escondía lo único que viene a hacer.

Con `publicSession`, la cabecera y el pie se cambian enteros:

| | sin sesión | con sesión |
|---|---|---|
| Menú | `TOP_NAV` (6 ítems de captación) | `STUDENT_NAV`: Mi programa · Mis cursos · Mi expediente · Mi perfil · Explorar oferta académica |
| Llamada a la acción | «Postular ahora» | ninguna (ver abajo) |
| Barra utilitaria | correo · Para empresas · Contacto | rótulo «Portal del estudiante» · correo · Contacto |
| Cuenta | avatar + «Iniciar sesión» | avatar + nombre de pila |
| Logotipo lleva a | portada | «Mi programa» |
| Pie | 3 columnas (académico, institucional, políticas) | 2 columnas (portal, políticas) |
| Menú móvil | los 6 + Para empresas + Contacto | los 5 + Contacto + Cerrar sesión |

**Por qué no hay llamada a la acción para el estudiante.** Se probó con un botón
«Ir a mi programa» y se retiró: el logotipo ya lleva ahí y «Mi programa» es el
primer ítem del menú. Tres controles para el mismo destino en la misma barra.
Por lo mismo se quitó el botón «Ver mi expediente completo» de la vista de
programa, que quedaba a dos dedos del ítem «Mi expediente» del menú.

**Una sola lista para los dos menús.** `navActual` resuelve cuál toca y la usan
la navegación de escritorio y la hoja móvil. Antes la hoja móvil repetía la
lista a mano, que es como se acaba con dos menús distintos en la misma página.

**Medido, no estimado.** El menú del estudiante cabe en una fila hasta 1024px y
pasa a hamburguesa en 900px, sin desbordamiento horizontal a ningún ancho entre
390 y 1440px.

**Vocabulario.** `nav.academics` decía «Mi Universidad» / «My University», que no
dice lo que hay dentro (expediente, estado de cuenta, certificados y
competencias). Pasa a «Mi expediente» / «My record». El título de la vista es
otra clave y no se tocó. De paso se unificó la caja de las etiquetas inglesas,
que mezclaba «My Courses» con «My program»: en el menú superior no se veía
porque el CSS las pone en caja alta, pero en el pie se renderizan tal cual.

---

## 22) Moodle: resuelto el bloqueante, y lo que se encontró por el camino

El 13 de octubre de 2026 se abrió el puerto 22 y se intervino Moodle. **El
bloqueante §20.1 está resuelto: la matrícula funciona.** Pero casi nada de lo
que el traspaso daba por sabido resultó exacto, así que aquí queda lo
comprobado.

### 22.1 Lo que el traspaso decía mal

| Decía | Es |
|---|---|
| Rol del servicio web `paeu_ws_client` | **`tfu_ws`** (id 9, «TFU Web Service») |
| Instalación Bitnami en `/opt/bitnami/...` (deducido de `00-config.sh`) | **Debian 12, Moodle 4.5.14+ en `/var/www/moodle`**, PHP 8.3 en `/usr/bin/php`, usuario web `www-data` |
| Automatriculación e invitados pendientes de cerrar | **Ya estaban cerrados** en los 13 cursos; `manual` activa en los 13 |
| Sólo faltaba una fila en `role_allow_assign` | Faltaba esa **y** una capacidad de lectura (§22.3) |

`00-config.sh` describe un despliegue Bitnami que NO es esta máquina. Al
preparar la intervención se reescribieron los guiones suponiendo Bitnami; se
corrigió al entrar. `infra/moodle/paeu-bootstrap.php` resuelve la raíz de Moodle
por `MOODLE_DIR`, subiendo desde el guion y luego por rutas conocidas, de modo
que sirve en las dos.

### 22.2 El bloqueante de matrícula

Comprobado antes de tocar nada: se intentó matricular con **los roles 1 al 10** y
los diez fallaron con `wsusercannotassign`. La tabla `role_allow_assign` tenía 7
filas y ninguna de `tfu_ws`. Las tres capacidades (`moodle/role:assign`,
`enrol/manual:enrol`, `enrol/manual:unenrol`) ya estaban concedidas.

```bash
sudo -u www-data php paeu-permitir-asignar-estudiante.php --role-shortname=tfu_ws --dry-run
sudo -u www-data php paeu-permitir-asignar-estudiante.php --role-shortname=tfu_ws
```

**El guion da un aviso al terminar** —«You must not call clear_all_caches outside
of unit tests»— porque llama a una función que Moodle 4.5 ya no admite por CLI.
El cambio se aplica igual; purgar después con
`php /var/www/moodle/admin/cli/purge_caches.php`.

Tras esto, matricular al demo en sus dos programas devolvió `enrolled: true` y
cero fallos, y `GET /v1/courses/12/content` pasó de 403 a **200 con 9 secciones**.

### 22.3 SEGUNDA capacidad que faltaba: leer las matrículas

Arreglado lo anterior, la plataforma podía DAR DE ALTA pero no RELEER. Al llamar
a `core_enrol_get_users_courses` recibía `[]` aunque en Moodle las matrículas
estuvieran activas y con rol `student`, y entonces marcaba
`user_course_enrollments` como `inactive` y el portal volvía a decir «aula no
disponible». Se vio porque la comprobación con navegador salió distinta en
español y en inglés, que es imposible, y resultó ser el orden de las pruebas.

La causa está en `enrol/externallib.php`:

```php
if (!$sameuser && (!course_can_view_participants($context) || !user_can_view_profile($user, $course))) {
    continue;   // <- aquí se vaciaba la lista
}
```

`course_can_view_participants()` exige **`moodle/course:viewparticipants`**, que
`tfu_ws` no tenía. Las demás sí. Se concedieron en contexto de sistema
`moodle/course:viewparticipants` y `moodle/site:viewparticipants`.

**Si alguna vez se recrea el rol del servicio web, estas dos capacidades tienen
que ir en la lista**, o la plataforma volverá a ver sus matrículas vacías.

### 22.4 Las trece aulas

`aula-modelo.php` fijaba el inicio del término en «el próximo martes a partir de
hoy». Montando el 13 de octubre —primer día de `TERM-2026-FALL`— habría puesto
las aulas a empezar el 20 y acabar el 15 de diciembre, una semana desfasadas del
calendario del portal. Ahora acepta `--inicio=AAAA-MM-DD` y exige que caiga en
martes (§10 del Master Syllabus). Además sumaba 8×7 días para el fin, que da el 8
de diciembre; el periodo acaba el **7**, y así lo tenían las aulas 12 y 24. Se
corrigió a 8×7−1 y se alinearon las once ya montadas.

```bash
sudo -u www-data php aula-modelo.php --inicio=2026-10-13 PCL-SALES-OPS PCL-CX-SUCCESS ...
```

Las trece quedan idénticas: 9 secciones, 35 actividades, 13 oct – 7 dic. Y se
asociaron las trece al periodo: el punto de control vigilaba sólo 3.

### 22.5 El multiidioma: por qué NO se puede usar la sintaxis del núcleo

Este es el hallazgo que más cuesta recordar, así que va entero.

Los nombres de categoría usan `{mlang en}…{mlang}{mlang es}…{mlang}`, que es la
sintaxis del plugin **multilang2**, de terceros, **que no está instalado**. El
filtro del núcleo sí está activo pero entiende otra:
`<span lang="en" class="multilang">…</span>`. Por eso el LMS mostraba el marcado
crudo en el listado de cursos.

Se convirtieron los cinco nombres a la sintaxis del núcleo y **el LMS quedó
perfecto… y se rompió el portal**: el servicio web devolvió
`'AI — Cross-Cutting CapabilityIA — Capacidad Transversal'`, los dos idiomas
pegados. `external_format_string()` quita el HTML **siempre**, también con
`moodlewssettingfilter=false` (comprobado).

**Conclusión: `{mlang}` es la sintaxis correcta para esta arquitectura**, porque
es texto plano y sobrevive al servicio web, que es por donde el portal lee. Se
revirtió. El precio es que el LMS enseña el marcado crudo en su propio listado
de categorías.

**Para arreglar también el LMS hace falta instalar el filtro multilang2**
(`github.com/iarenaza/moodle-filter_multilang2`; GitHub es alcanzable desde la
máquina). No se instaló: es código de terceros en un Moodle de producción y esa
decisión es del usuario.

Del lado de la plataforma sí quedó resuelto el §8.5: `parseMultilang` en
`apps/api/src/db.ts` entiende ahora **las dos** sintaxis, y el payload lleva
`tagsEn` junto a `tags`, así que el área del programa sale en el idioma del
visitante: «IA — Capacidad Transversal» / «AI — Cross-Cutting Capability».

### 22.6 Lo que queda

**Ya nada: el usuario autorizó las dos cosas y están hechas.** Ver §23.

- ~~**Instalar multilang2**~~ → instalado y verificado, §23.1.
- ~~**«Categoría 1»** con sus 10 cursos heredados~~ → los diez borrados, §23.5.

## 23) Las dos decisiones del usuario, ejecutadas

El usuario autorizó las dos cosas que el §22.6 dejaba pendientes: instalar el
filtro multilang2 y borrar los diez cursos heredados. Esta sección es lo que
pasó al hacerlo, incluido un agujero que sólo apareció porque la limpieza no
duraba.

### 23.1 multilang2 instalado

- Versión 2.0.5.5 (`version = 2026041801`), `MATURITY_STABLE`, desde
  `github.com/iarenaza/moodle-filter_multilang2`.
- Respaldo previo: `/var/backups/moodle/pre-multilang2-20261013T195801Z.sql.gz`.
- Archivos en `/var/www/moodle/filter/multilang2`, `root:root`, 755/644.
- `admin/cli/upgrade.php --non-interactive` → `filter_multilang2 ++ Éxito`.
- Activado con `filter_set_global_state('multilang2', TEXTFILTER_ON)` **y**
  `filter_set_applies_to_strings('multilang2', true)`. Lo segundo es
  imprescindible: los nombres de categoría son «cadenas», no «contenido», y sin
  esa segunda llamada el filtro está encendido y no hace nada en los
  encabezados.

Estado final del filtrado, comprobado en la máquina:

```
  multilang   estado= 1  aplica_a_cadenas=1
  multilang2  estado= 1  aplica_a_cadenas=1
  stringfilters = multilang,multilang2
  filterall     = 1
```

Recordatorio del §22: `filterall` **no se escribe a mano**, se deriva de
`stringfilters`. La API correcta es `filter_set_applies_to_strings()`.

Resultado en el LMS: `0` etiquetas `{mlang}` crudas en `/` y en
`/course/index.php`, y `format_string` resuelve por idioma:

```
  [en] Sales and Revenue Growth          [es] Ventas y Crecimiento de Ingresos
  [en] Customer Experience as Revenue…   [es] Experiencia del Cliente como Motor…
```

### 23.2 El riesgo que no se materializó, y por qué (importante)

Al activar el filtro había un riesgo concreto: que `external_format_string()`
resolviera también el multiidioma **en el servicio web** y devolviera un solo
idioma. Eso habría roto el área bilingüe del portal, que necesita el crudo con
las dos etiquetas para elegir según el visitante.

No pasó. El servicio web sigue devolviendo las dos etiquetas, y la razón no es
suerte:

```
external_settings::get_filter()  =  false   <- el valor POR OMISIÓN
```

`external_format_string()` sólo filtra si ese ajuste está en `true`, y por
omisión es `false`. De paso queda explicado por qué el §22 encontró que
`moodlewssettingfilter=false` «no ayudaba»: no ayudaba porque ya era el estado
por defecto, no había nada que apagar.

**Lo que rompería el portal es mandar `moodlewssettingfilter=true`.** Está
comprobado que el cliente del API no lo manda en ninguna llamada (sólo aparece
en un comentario de `apps/api/src/catalog/peregrine-catalog.ts`). **No añadirlo.**

Comprobación de punta a punta tras activar el filtro, por el borde público
`https://api.portal.thefloridianuniversity.com/api`:

```
  /v1/catalog -> 200
  cursos: 13
  sin una de las dos listas de etiquetas: 0
  con {mlang} sin resolver               : 0
  tags  : ['IA — Capacidad Transversal']
  tagsEn: ['AI — Cross-Cutting Capability']
```

### 23.3 La siembra de demostración deshacía cualquier limpieza

Esto es lo más serio que apareció, y apareció por casualidad: tras borrar los
diez cursos legacy, la tabla de contenidos volvió a tener las mismas diez filas
unas horas después, y el tenant volvía a llamarse «Atlas Online University».

La causa: **`seedBaseData()` corre en cada arranque del API** y sembraba sin
condiciones el catálogo de demostración de Atlas, sus ofertas de precio, sus
entitlements y —con `ON CONFLICT DO UPDATE`— el tenant con su logo de
dummyimage y una usuaria falsa. Cualquier limpieza duraba hasta el siguiente
`pm2 restart`.

Arreglo en `apps/api/src/db.ts`:

```ts
const SEMBRAR_DEMO =
  (process.env.SEED_DEMO_DATA ?? (config.isProduction ? 'false' : 'true')) === 'true';
```

En producción la siembra queda apagada; en desarrollo sigue encendida, que es
para lo que existe; y se puede forzar con `SEED_DEMO_DATA=true`. El tenant se
sigue creando si falta, porque `users.tenant_id` es obligatorio, pero con
`ON CONFLICT DO NOTHING` y con el nombre de la institución configurada: si
alguien lo renombró, se respeta.

Durabilidad comprobada tras `pm2 restart`:

```
 contenidos | ofertas | entitlements | seminarios |          tenant
         13 |       0 |            0 |          6 | The Floridian University
```

**La lección general**: antes de dar por hecha una limpieza de datos, comprobar
que nada la regenera al arrancar. Aquí se informó de la limpieza como hecha sin
haberlo comprobado, y era falso.

### 23.4 Hay dos cuentas de estudiante y una es una trampa

Al verificar el portal se obtuvo «0 programas» y promedio nulo, y parecía una
regresión. No lo era: hay **dos** cuentas y se probó con la equivocada.

| cuenta | origen | matrículas |
|---|---|---|
| `estudiante@atlas.edu` | showcase heredado de Atlas (`scripts/seed-demo.ts`) | 0 |
| `demo.estudiante@thefloridianuniversity.com` | el estudiante demo de TFU | 2 |

La de TFU es la que tiene el estado bueno: `TFU-EDU-WALK` completado con `A-`
(3,70 puntos, 3 créditos) y `TFU-SALES-EXC` en curso. El promedio sale de ahí:
3,70 × 3 / 3 = **3,70**.

**La contraseña de la cuenta de TFU no está anotada en ninguna parte** y nadie
la conoce. Es una cuenta que se va a entregar, así que hace falta fijarle una
conocida y apuntarla aquí. El intento de hacerlo lo bloqueó el clasificador de
seguridad (escritura en `public_user_auth` de producción); queda pendiente de
que lo haga o lo autorice el usuario. El formato del hash es el de
`verifyPassword`: `salt:scrypt(password, salt, 64)`, ambos en hexadecimal.

### 23.5 Cursos legacy borrados

Los diez cursos heredados de Atlas que vivían en «Categoría 1» (Filosofía
Moderna, Cálculo, Derecho Constitucional…) se borraron, y con ellos desapareció
el motivo por el que «Categoría 1» no se podía ocultar. El guion de limpieza del
lado de la plataforma es `infra/data/limpiar-legacy-atlas.sql`, que es
idempotente y deliberadamente conservador: no borra usuarios ni el tenant, y no
toca `content_assets` porque ahí hay contenido que alguien del equipo debe
revisar uno a uno.

### 23.6 Lo que sigue pendiente

- **La contraseña del estudiante demo** (§23.4). Bloqueado por el clasificador.
- **63 mensajes de error del servidor no son bilingües.** Están en español en el
  código. Arreglarlo toca unas 300 rutas, así que no se hizo en esta tanda: es
  trabajo propio, no un olvido.
- **La escala de calificación sigue sin confirmar por TFU.** El módulo usa la
  estándar estadounidense de 4,0 y lo rotula como pendiente, tanto en el panel
  como en la respuesta del API (`pendienteDeConfirmacion: true`). No se presenta
  una escala inventada como si fuera la de la institución.

## 24) Retirada completa de «Atlas»: qué se barrió y qué falta

El usuario pidió que no quedara rastro del producto anterior ni en el código ni
en los datos. Esta sección es el inventario de lo que se encontró, lo que se
hizo y las tres cosas que siguen pendientes porque necesitan una decisión o una
ventana de mantenimiento.

### 24.1 Cómo se auditó

En el código: 221 apariciones de «atlas» en 43 archivos. En la base: un barrido
generado sobre **las 314 columnas de texto** de todas las tablas, en vez de
mirar las que uno recuerda. Es la diferencia entre creer que está limpio y
saberlo: el barrido encontró el directorio de personal y el registro FERPA, que
nadie habría mirado.

En Moodle: comprobado aparte (nombre del sitio, cursos, categorías, usuarios,
cohortes y las dos tablas de configuración). **Moodle estaba limpio**, el sitio
ya se llamaba The Floridian University / TFU.

### 24.2 La decisión de fondo: retirar, no renombrar

La siembra de la plantilla había dejado en PRODUCCIÓN personas, certificados,
facturas y pagos que nunca existieron: once usuarios ficticios, quince
prospectos, **ocho empleados con cargo** (decanos, registradora, oficial de
ayuda financiera), **siete certificados** con número de serie y cinco apuntes
de registro FERPA firmados por `registrar@atlas.edu`.

Lo cómodo era reescribir los dominios a `@thefloridianuniversity.com`. Sería
peor: convertiría personal inventado en personal aparentemente real de una
universidad acreditada, y certificados inventados en certificados con pinta de
válidos. Por eso se retiran. El guion es
`infra/data/retirar-ficcion-atlas.sql`.

La excepción son los **sílabos**: ahí el documento es real de TFU y lo único
equivocado era el nombre de la institución en el campo de integridad académica.
Eso se reescribe, no se borra.

### 24.3 Tres cambios de código que son funcionales, no cosméticos

La mayoría del barrido fue texto. Estos tres no:

1. **El número de serie de los certificados.** `makeSerial()` en
   `modules/credentials/routes.ts` emitía `ATLAS-XXXXXX-XXXX` para **todo
   certificado real** que emitiera la institución. Ahora emite `TFU-`.

2. **El prefijo de las interacciones guardadas en Moodle.**
   `ATLAS_INTERACTION::` se escribe en notas de Moodle **y se lee de vuelta**.
   Cambiarlo a secas habría hecho desaparecer del portal las interacciones ya
   guardadas, sin error y sin aviso. Se escribe sólo el nuevo prefijo y se leen
   los dos (`moodleInteractionPrefixesLeidos`). **Esa lista no se recorta** sin
   comprobar antes que no queda ninguna nota con el prefijo viejo.

3. **`asegurarTenant()` ya no depende del orden.** Comprobaba
   `ON CONFLICT (id)` sobre un identificador fijo. Como el guion de datos
   renombra la clave del tenant, arrancar el código nuevo antes del guion
   habría insertado un SEGUNDO tenant, con los usuarios colgando del viejo y
   las filas repartidas. Ahora pregunta si existe algún tenant. El orden entre
   despliegue y guion deja de importar, que es lo que se quiere: nadie debería
   tener que acordarse.

Además: los paquetes del monorepo pasan de `@atlas/*` a `@tfu/*` (con el
`package-lock.json` regenerado), las claves del navegador de
`atlas-public-session` / `atlas-admin-session-token` a `tfu-*` (eso cierra las
sesiones abiertas una vez), los servicios de `docker-compose` y la base de
desarrollo a `tfu`, y las credenciales de ejemplo dejan de ser `AtlasAdmin!2026`
y `AtlasMoodle!2026`.

El tipo `TenantBranding.logoUrl` pasa a `string | null`. Decía `string` mientras
la base guardaba NULL: el tipo estaba mintiendo.

### 24.4 La siembra de demostración ya no fabrica gente plausible

`scripts/seed-demo.ts` era la fuente de toda la ficción. Sus dominios pasan a
`.invalid` (`@demo.invalid`, `@prospect.demo.invalid`), que está reservado por
la RFC 2606 y **no se puede registrar ni recibir correo**. Así la siembra sigue
sirviendo para lo que existe —poblar un entorno de desarrollo— pero ninguna de
sus filas puede volver a confundirse con una persona de la institución si algún
día se cuela en otro entorno.

### 24.5 Lo que sigue diciendo «Atlas» a propósito

- **Los dos guiones de retirada** (`limpiar-legacy-atlas.sql` y
  `retirar-ficcion-atlas.sql`). Su trabajo es encontrar y retirar filas de
  Atlas; sin la palabra no funcionan.
- **`ATLAS_INTERACTION::`** en la lista de prefijos que se leen (§24.3).
- **El relato histórico de este runbook** (§21, §22, §23). Borrarlo dejaría las
  lecciones sin sentido: explica por qué se retiró cada cosa.
(El proceso y la base ya se renombraron, §24.7, así que la documentación y los
guiones usan los nombres nuevos.)

### 24.6 Pendiente: necesita decisión o ventana

1. **Correr `infra/data/retirar-ficcion-atlas.sql` en producción.** El
   clasificador de seguridad bloqueó la ejecución —y hasta la escritura— del
   borrado masivo, con razón: son ~110 filas de once tablas de producción. El
   guion está escrito, comentado, es idempotente y lleva arriba el volcado
   previo y el comando de restauración. Lo corre una persona.

2. **La contraseña del estudiante demo** (§23.4), que sigue sin fijar.

Los nombres de infraestructura ya no están pendientes: se renombraron, §24.7.

### 24.7 Renombrado de la base y del proceso, hecho

Autorizado por el usuario y ejecutado con ventana corta. Lo que se hizo, en
orden, con vuelta atrás automática preparada por si la salud no respondía:

1. Volcado previo: `/var/backups/api/pre-rename-20261013T204318.dump`.
2. Copia del `.env` del release (`.env.bak-rename`, mismo dueño y permisos 0600).
3. `pm2 stop`, cierre de conexiones sueltas a la base.
4. `ALTER DATABASE atlas RENAME TO tfu` y `ALTER ROLE atlas RENAME TO tfu`.
5. Reescritura de `DATABASE_URL` **sólo** en el usuario y el nombre de la base,
   con el parseo de la URL: la contraseña no se toca ni se imprime.
6. Comprobación de que las credenciales nuevas conectan de verdad, **antes** de
   arrancar: `conectado a tfu como tfu`.
7. `pm2 start --name tfu-api`, salud en 200, retirada de la entrada vieja y
   `pm2 save`.

**Por qué el rol se podía renombrar sin más.** Porque la contraseña está en
`scram-sha-256`, que no se sala con el nombre del rol. Con el antiguo `md5` sí
—se sala con el nombre— y renombrar el rol habría invalidado la contraseña,
dejando el API sin poder conectar. Se comprobó (`SHOW password_encryption` y el
prefijo de `pg_authid.rolpassword`) antes de tocar nada; si hubiera dicho md5,
el renombrado del rol habría exigido además fijar la contraseña de nuevo.

Estado comprobado después: sólo existen las bases `postgres` y `tfu`, ningún rol
ni proceso de pm2 contiene «atlas», el guardado de pm2 que resucita al reiniciar
la máquina apunta a `tfu-api`, y por el borde público `/health`, `/v1/catalog`
y `/v1/programs` responden 200 con los 13 cursos bilingües. Aguanta
`pm2 restart`.

Queda en el servidor `.env.bak-rename`, a propósito: es la vuelta atrás del
cambio de `DATABASE_URL`. Conviene retirarlo cuando se haya convivido unos días
con el nombre nuevo.

### 24.8 El renombrado rompió los respaldos, y por qué

Conviene dejarlo escrito porque el fallo fue del tipo que no avisa.

Tras renombrar la base se comprobó el `.env` del release en curso
(`current/.env`) y se dio el trabajo por bueno. **Hay un segundo `.env`:**
`/opt/plataforma-estudiantil/api/shared/.env`, que es la plantilla desde la que
el despliegue copia el fichero a cada release nuevo. Ése seguía diciendo
`atlas`. Consecuencias:

- **El guion de respaldos** (`tfu-api-backup.sh`) lee precisamente
  `shared/.env`, así que los respaldos pasaron a fallar. Comprobado:
  `FATAL: password authentication failed for user "atlas"`.
- **El siguiente despliegue** habría copiado ese `.env` al release nuevo y el
  API no habría arrancado.

Ninguna de las dos cosas da señal al momento: el respaldo falla en silencio en
una tarea programada, y el despliegue rompe más tarde. Un `/health` en 200 no
dice nada de esto.

Arreglado: `shared/.env` reescrito y **comprobado ejecutando un respaldo de
verdad**, que es la única prueba que vale (324 KB). Y se puso al día el `.env`
de los siete releases que se conservan, porque volver atrás el enlace `current`
a cualquiera de ellos habría dejado el API apuntando a una base que ya no
existe. Los nueve `.env` en uso dicen ahora `tfu@tfu`.

**La regla que sale de aquí:** al cambiar cualquier cosa del `.env` de
producción, no basta con el del release en curso. Hay que recorrer **todos**:

```bash
sudo find /opt/plataforma-estudiantil -name ".env" -o -name ".env.*" \
  | while read F; do
      printf "%-70s %s\n" "$F" \
        "$(sudo grep -m1 '^DATABASE_URL=' "$F" \
           | sed -E 's|.*://([^:]+):[^@]*@[^/]+/(.*)$|\1@\2|')"
    done
```

Y después, probar lo que depende de ellos —el respaldo, no sólo la salud del
API—, porque es lo que falla callado.

Quedan en el servidor los `.bak-rename` como vuelta atrás. Conviene retirarlos
cuando se haya convivido unos días con el nombre nuevo; contienen la URL
anterior con su contraseña, en ficheros 0600 de `ubuntu`, igual que los `.env`.
