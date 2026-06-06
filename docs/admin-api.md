# Admin API del Intermediador

Todas las rutas `admin` aceptan:

- `Authorization: Bearer <token>` (recomendado)
- `x-admin-key: <ADMIN_API_KEY>` (compatibilidad para scripts)

## Rutas

- `GET /admin`
  - Panel HTML básico con estado y rutas registradas.
- `POST /admin/auth/login`
  - Login de administrador y entrega token de sesión.
- `GET /admin/auth/me`
  - Valida token de sesión.
- `POST /admin/auth/logout`
  - Cierra sesión (invalida token).
- `GET /admin/routes`
  - Lista JSON de rutas montadas en la API.
- `GET /admin/config`
  - Estado de config de servidor, DB y Moodle.
- `GET /admin/tenants`
  - Lista de tenants registrados.
- `POST /admin/tenants`
  - Crea tenant.
- `GET /admin/users`
  - Lista paginada de usuarios administrados desde el intermediador.
  - Query params: `page`, `pageSize`, `q`, `status`.
- `POST /admin/users`
  - Crea usuario en intermediador y lo crea/sincroniza en Moodle.
- `PATCH /admin/users/:userId/status`
  - Activa/desactiva usuario de forma individual y sincroniza en Moodle.
- `POST /admin/users/status/bulk`
  - Activa/desactiva usuarios en lote y sincroniza en Moodle.
- `POST /admin/users/:userId/enrollments`
  - Matricula usuario en curso Moodle y guarda matrícula local.
- `GET /admin/users/:userId/courses`
  - Devuelve cursos del usuario (estado local + Moodle).
- `GET /admin/moodle/status`
  - Test de conexión a Moodle vía `core_webservice_get_site_info`.
- `GET /admin/moodle/courses`
  - Lista paginada de cursos sincronizados desde Moodle.
  - Query params: `page`, `pageSize`, `q`, `visible`.
- `GET /admin/moodle/users`
  - Lista usuarios sincronizados (moodle_user_id) en el intermediador.
- `POST /admin/moodle/sync/courses`
  - Ejecuta sync real de cursos vía `core_course_get_courses`, guarda cursos en `moodle_courses`,
    actualiza catálogo `content_assets` y deja registro de último sync.
- `POST /admin/moodle/sync/users`
  - Sincroniza usuarios desde Moodle al intermediador y reconstruye matrículas locales por curso.

## Ejemplos

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@atlas.local","password":"AtlasAdmin!2026"}' \
  http://localhost:4000/admin/auth/login
```

```bash
curl -H "Authorization: Bearer <token>" http://localhost:4000/admin/routes
```

```bash
curl -H "x-admin-key: dev-admin-key" http://localhost:4000/admin/moodle/status
```

```bash
curl -H "x-admin-key: dev-admin-key" http://localhost:4000/admin/moodle/courses
```

```bash
curl -H "x-admin-key: dev-admin-key" http://localhost:4000/admin/moodle/users
```

```bash
curl -X POST \
  -H "x-admin-key: dev-admin-key" \
  http://localhost:4000/admin/moodle/sync/courses
```

```bash
curl -X POST \
  -H "x-admin-key: dev-admin-key" \
  http://localhost:4000/admin/moodle/sync/users
```

```bash
curl -H "x-admin-key: dev-admin-key" http://localhost:4000/admin/users
```

```bash
curl -H "Authorization: Bearer <token>" \
  "http://localhost:4000/admin/users?page=1&pageSize=20&q=ana&status=active"
```

```bash
curl -X POST \
  -H "x-admin-key: dev-admin-key" \
  -H "Content-Type: application/json" \
  -d '{
    "fullName":"Maria Demo",
    "email":"maria.demo@atlas.local",
    "locale":"es",
    "roles":["learner"]
  }' \
  http://localhost:4000/admin/users
```

```bash
curl -X POST \
  -H "x-admin-key: dev-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"moodleCourseId":3,"roleId":5}' \
  http://localhost:4000/admin/users/<userId>/enrollments
```

```bash
curl -H "x-admin-key: dev-admin-key" \
  http://localhost:4000/admin/users/<userId>/courses
```

```bash
curl -X PATCH \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"status":"inactive","syncMoodle":true}' \
  http://localhost:4000/admin/users/<userId>/status
```

```bash
curl -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"userIds":["<id1>","<id2>"],"status":"inactive","syncMoodle":true}' \
  http://localhost:4000/admin/users/status/bulk
```

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "x-admin-key: dev-admin-key" \
  -d '{
    "id":"tenant-acme",
    "slug":"acme",
    "name":"Acme Learning",
    "locales":["en","es"],
    "currency":"USD",
    "branding":{
      "logoUrl":"https://example.com/logo.png",
      "primaryColor":"#1f2937",
      "accentColor":"#f59e0b",
      "heroGradient":"linear-gradient(120deg, #111827 0%, #f59e0b 100%)"
    }
  }' \
  http://localhost:4000/admin/tenants
```
