# PAE-U OTT + LMS SaaS Foundation

Monorepo base para una plataforma OTT multi-tenant con Moodle como backoffice, API intermedia y frontend web en React.

## Workspaces

- `apps/api`: API intermedia/BFF.
- `apps/web`: frontend web React.
- `packages/shared`: tipos canónicos, contratos y mocks base.
- `docs`: documento ejecutivo y técnico.
- `infra`: base local y lineamientos de despliegue.

## Quick start

1. `npm install`
2. `cp .env.example .env`
3. `docker compose up -d postgres redis adminer`
4. `docker compose --profile moodle up -d moodle-db moodle` (opcional para integración Moodle local)
5. `npm run dev:api`
6. `npm run dev:web`

La API corre por defecto en `http://localhost:4000`.
La web corre por defecto en `http://localhost:5173` y funciona como `Admin Control Center`.
Adminer corre en `http://localhost:8080`.
Moodle local (perfil compose) corre en `http://localhost:8081`.

## Admin del intermediador

Login web (panel admin completo):

- abrir `http://localhost:5173`
- usar `ADMIN_EMAIL` y `ADMIN_PASSWORD` definidos en `.env`
- el panel separa módulos de `Resumen`, `Conexiones`, `Usuarios`, `Cursos` y `Rutas API`

Auth API:

- preferido: `Authorization: Bearer <token>` obtenido en `POST /admin/auth/login`
- compatibilidad técnica: `x-admin-key: <ADMIN_API_KEY>`

Sincronización continua Moodle:

- el intermediador ejecuta sincronización automática en background (`AUTO_SYNC_INTERVAL_SEC`)
- además, las rutas públicas validan frescura antes de responder (`PUBLIC_SYNC_MAX_AGE_SEC`)

Rutas clave:

- `GET /admin`
- `POST /admin/auth/login`
- `GET /admin/auth/me`
- `POST /admin/auth/logout`
- `GET /admin/routes`
- `GET /admin/config`
- `GET /admin/tenants`
- `POST /admin/tenants`
- `GET /admin/users`
- `PATCH /admin/users/:userId/status`
- `POST /admin/users/status/bulk`
- `POST /admin/users`
- `POST /admin/users/:userId/enrollments`
- `GET /admin/users/:userId/courses`
- `GET /admin/moodle/status`
- `GET /admin/moodle/courses`
- `GET /admin/moodle/users`
- `POST /admin/moodle/sync/courses`
- `POST /admin/moodle/sync/users`

Detalles y ejemplos: `docs/admin-api.md`.

## Integración Moodle local

1. Levanta `moodle-db` y `moodle` con el perfil `moodle`.
2. Entra a `http://localhost:8081` y completa el instalador web de Moodle.
3. En el instalador usa DB:
   - host: `moodle-db`
   - db: `moodle`
   - user: `moodle`
   - password: `moodle`
4. Habilita Web Services + REST.
5. Crea un servicio externo con funciones:
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
6. Crea token para tu usuario admin y copia ese token a `.env`:
   - `MOODLE_BASE_URL=http://localhost:8081`
   - `MOODLE_TOKEN=<tu_token>`
7. Reinicia API y ejecuta sync desde el panel web o `POST /admin/moodle/sync/courses`.
