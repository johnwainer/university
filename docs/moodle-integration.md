# Moodle Integration Guide (Atlas Online University Intermediador)

## 1. Levantar Moodle local

```bash
docker compose --profile moodle up -d moodle-db moodle
```

- Moodle URL: `http://localhost:8081`
- El primer acceso abre el instalador web de Moodle.

## 1.1 Completar instalador web

En el instalador de Moodle usa:

- DB type: `MariaDB`
- DB host: `moodle-db`
- DB name: `moodle`
- DB user: `moodle`
- DB password: `moodle`
- URL del sitio: `http://localhost:8081`

La imagen actual usa `lthub/moodle:education-4.1.14-1` y escucha en el puerto interno `80`, mapeado al host como `8081`.

Durante el asistente se crea la cuenta admin de Moodle.

Si la instalación ya existe, el admin local del proyecto es:

- usuario: `admin`
- contraseña: `AtlasMoodle!2026`
- login: `http://localhost:8081/login/index.php`

## 2. Habilitar Web Services

En Moodle:

1. `Site administration` -> `Advanced features` -> activar `Enable web services`.
2. `Site administration` -> `Server` -> `Web services` -> `Manage protocols` -> activar `REST`.

## 3. Crear servicio y token

1. `Site administration` -> `Server` -> `Web services` -> `External services`.
2. Crear servicio (por ejemplo `Atlas Online University Intermediator`) y marcarlo como enabled.
3. Agregar funciones:
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
4. `Site administration` -> `Server` -> `Web services` -> `Manage tokens`.
5. Crear token para tu usuario admin y el servicio creado.

## 4. Configurar el intermediador

En `.env`:

```env
MOODLE_BASE_URL=http://localhost:8081
MOODLE_TOKEN=<token_generado>
```

Reiniciar API:

```bash
npm run dev:api
```

## 5. Verificar y sincronizar

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@atlas.local","password":"AtlasAdmin!2026"}' | \
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).token))")

curl -H "Authorization: Bearer $TOKEN" http://localhost:4000/admin/moodle/status
curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:4000/admin/moodle/sync/courses
curl -H "Authorization: Bearer $TOKEN" http://localhost:4000/admin/moodle/courses?page=1&pageSize=20
```

## 6. Qué hace la sincronización

- Lee cursos desde Moodle via `core_course_get_courses`.
- Guarda copia normalizada en `moodle_courses`.
- Publica/actualiza representación de cursos en `content_assets` para consumo OTT.
- Registra metadatos de último sync en `integration_settings` (`moodle.last_courses_sync`).
