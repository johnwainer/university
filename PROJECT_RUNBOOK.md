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

- Landing moderna.
- Slider principal.
- Secciones dinámicas: mis cursos, webinars/eventos, podcasts, categorías.
- Explorar catálogo con filtros.
- Vista de curso y consumo de módulos.
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

- `GET /api/v1/home`
- `GET /api/v1/catalog`
- `GET /api/v1/catalog/:slug`
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
