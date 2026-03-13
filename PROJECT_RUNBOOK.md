# PAE-U Runbook Maestro (Operación Local + Handoff de Agente)

Este archivo es la guía única para entender, levantar y operar el proyecto `pae-u` sin contexto previo.

## 1) Qué es este proyecto

`PAE-U` es una plataforma OTT + LMS con:

- `Moodle` como backoffice académico (cursos, módulos, actividades, progreso).
- `API Intermediador` (BFF + dominio) como capa obligatoria para TODO.
- `Web pública` (landing, exploración, cursos, perfil, tickets, empresa).
- `Web admin` (control operativo central: sync, usuarios, cursos, webinars, eventos, podcasts, empresas, configuración Moodle/integraciones).

Regla de oro:
- Ningún frontend debe consumir Moodle ni servicios externos directo.
- Todo entra/sale por `apps/api`.

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
DATABASE_URL=postgresql://pae:pae@localhost:65432/pae_u
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
- `admin@pae-u.local`
- `PaeuAdmin!2026`

## 6.2 Moodle local

Se define durante el wizard inicial en `http://localhost:8081`.
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
- `GET /api/admin/companies` + CRUD miembros/cursos

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
npm run -w @pae-u/api check
npm run -w @pae-u/web check
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
