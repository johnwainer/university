# Kit de despliegue en producción — Plataforma Estudiantil (The Floridian University)

Runbook operativo. Se lee de arriba hacia abajo: prerrequisitos, orden exacto de
ejecución, verificación, rollback y troubleshooting.

Los textos están en español; los comandos, flags e identificadores se mantienen
en inglés tal como aparecen en el código.

> **Regla de oro:** ningún secreto se escribe nunca en este repositorio. Todos
> los valores sensibles viven en **AWS SSM Parameter Store** como
> `SecureString`, y los scripts los renderizan en el servidor en tiempo de
> despliegue.

---

## 1. Qué despliega este kit

| Componente | Dónde vive | Hostname público |
| --- | --- | --- |
| SPA React 19 + Vite 6 (`apps/web`) | Bucket Lightsail `plataforma-estudiantil-frontend` detrás del CDN `plataforma-estudiantil-cdn` | `portal.thefloridianuniversity.com` |
| API Fastify 5 + TypeScript (`apps/api`) | Instancia Lightsail `plataforma-estudiantil-api` (`44.210.204.140`), Nginx + PM2 | `api.portal.thefloridianuniversity.com` |
| Moodle 4.5 LTS | Instancia Lightsail `plataforma-estudiantil-moodle` (`34.200.208.43`), Bitnami LAMP 8.5.10 | `lms.portal.thefloridianuniversity.com` |
| PostgreSQL 16 | Lightsail Managed DB `plataforma-estudiantil-postgres` | *(sin acceso público; endpoint no está en el repo)* |
| Redis 7 | Colocado en la instancia de la API (`127.0.0.1:6379`) | — |

Cuenta AWS `280995443462`, región `us-east-1`, todo etiquetado
`grupo=plataforma-estudiantil`. El DNS está en **Cloudflare** (zona
`thefloridianuniversity.com`) y **todos los registros deben quedar en "DNS only"
(nube gris)**, porque el TLS termina en el origen.

### Dos detalles del contrato público que condicionan toda la configuración

1. **El prefijo `/api` lo quita la aplicación, no Nginx.** `apps/api/src/server.ts`
   crea Fastify con un `rewriteUrl` que recorta el `/api` inicial. El contrato
   público es por tanto `https://api.portal.../api/health`, `/api/v1/...`,
   `/api/admin/...`, y **Nginx debe pasar la URI intacta**. Si alguien añade un
   `rewrite` en Nginx, el prefijo se recorta dos veces y todas las rutas
   devuelven `404`.
2. **El CORS lo gestiona la aplicación.** La API registra `@fastify/cors` con
   `origin: true`. Los vhosts de Nginx **no** añaden cabeceras
   `Access-Control-*` a propósito: duplicarlas hace que el navegador rechace la
   respuesta. `90-smoke-test.sh` verifica que haya exactamente una.

---

## 2. Árbol de archivos

```
infra/
├── README.md                          este runbook
├── deploy/
│   ├── .gitignore                     excluye *.local, .env*, *.pem, *.token, ...
│   ├── 00-config.sh                   ÚNICA fuente de verdad (hosts, IPs, rutas, SSM)
│   ├── lib/common.sh                  log/fail/run/install_file/render_template/json
│   ├── 10-api-bootstrap.sh            [host API]    releases + build + .env + PM2
│   ├── 11-api-nginx-tls.sh            [host API]    Nginx + Let's Encrypt
│   ├── 20-moodle-install.sh           [host Moodle] Moodle vía CLI + Apache + TLS + cron
│   ├── 21-moodle-webservices.sh       [host Moodle] Web Services + REST + servicio + token
│   ├── 30-frontend-deploy.sh          [cualquiera]  build SPA + bucket + reset CDN
│   ├── 31-frontend-domain-tls.sh      [cualquiera]  certificado + dominio en el CDN
│   ├── 40-db-init.sh                  [host API]    rol + base de datos en PostgreSQL
│   ├── 50-secrets-put.sh              [cualquiera]  sube el .env a SSM
│   ├── 90-smoke-test.sh               [cualquiera]  verificación de producción
│   ├── env.production.local.example   plantilla de los valores para SSM
│   └── iam/
│       ├── api-ssm-read-policy.json   política para la instancia de la API
│       ├── deploy-ci-policy.json      política para GitHub Actions
│       └── secrets-writer-policy.json política para el operador humano
├── nginx/
│   ├── api.portal.http.conf.template  vhost :80 (ACME + redirect)
│   ├── api.portal.ssl.conf.template   vhost :443 (proxy inverso, URI intacta)
│   └── snippets/
│       ├── security-headers.conf      HSTS, nosniff, oculta X-Powered-By/Server
│       └── proxy-params.conf          cabeceras de proxy y timeouts
└── moodle/
    ├── paeu-moodle-backup.sh          respaldo diario de BD + moodledata
    ├── apache/
    │   ├── lms-vhost.conf.template       vhost :80 (ACME + redirect)
    │   └── lms-https-vhost.conf.template vhost :443 (+ allow-list de /webservice)
    ├── php/
    │   ├── zz-upload.ini              límites de subida (preexistente)
    │   └── zz-moodle.ini              max_input_vars, opcache, etc.
    └── cli/
        ├── paeu-provision-webservice.php  servicio + funciones + usuario + rol + token
        ├── paeu-install-lang.php          instalador de paquetes de idioma (fallback)
        └── paeu-dbconfig.php              lee credenciales de config.php sin exponerlas
```

```
.github/workflows/
├── ci.yml        typecheck + build + arranque real contra Postgres
└── deploy.yml    despliegue manual (workflow_dispatch) con rollback
```

Todos los scripts: `set -Eeuo pipefail`, bloque `--help`, variables
sobreescribibles por entorno, idempotentes, y **ninguna operación destructiva
sin `--force`**.

---

## 3. Prerrequisitos

### 3.1 En la máquina del operador

| Herramienta | Para qué |
| --- | --- |
| `aws` CLI v2 | SSM, Lightsail, subida al bucket |
| `curl`, `openssl` | verificación y smoke test |
| `jq` **o** `python3` | parseo de JSON (los scripts usan el que encuentren) |
| `node` 22 y `npm` | build de la SPA (solo para `30-frontend-deploy.sh`) |
| `ssh`, `rsync` | acceso a las instancias |

### 3.2 DNS en Cloudflare (hacer **antes** de pedir certificados)

| Nombre | Tipo | Valor | Proxy |
| --- | --- | --- | --- |
| `api.portal` | A | `44.210.204.140` | **DNS only** |
| `lms.portal` | A | `34.200.208.43` | **DNS only** |
| `portal` | CNAME | `d3v7aeo2q6v7bm.cloudfront.net` | **DNS only** |
| *(validación)* | CNAME | lo imprime `31-frontend-domain-tls.sh` | **DNS only** |

Con la nube naranja (proxy activado) fallan dos cosas: el desafío `http-01` de
Let's Encrypt y la verificación de certificado del smoke test, porque TLS
terminaría en Cloudflare.

### 3.3 Firewall de Lightsail

Ambas instancias necesitan **TCP 80 y TCP 443** abiertos, además del 22 para
SSH. La API escucha solo en `127.0.0.1:4000`; nada debe exponer ese puerto.

### 3.4 Estado actual conocido

- `portal.thefloridianuniversity.com` ya responde `200` con una página
  provisional "Coming soon", pero **el dominio personalizado aún no está
  asociado al CDN** (ese 200 llega por el nombre `*.cloudfront.net`). Lo
  resuelve el paso 2 (`31-frontend-domain-tls.sh`).
- `api.portal.*` y `lms.portal.*` todavía no responden.

---

## 4. Cómo entrar a las instancias

### 4.1 Con la llave local

```bash
chmod 600 ~/.ssh/test-html-thefloridianuniversity-key.pem

ssh -i ~/.ssh/test-html-thefloridianuniversity-key.pem ubuntu@44.210.204.140   # API
ssh -i ~/.ssh/test-html-thefloridianuniversity-key.pem bitnami@34.200.208.43   # Moodle
```

### 4.2 Sin la llave: consola SSH del navegador (Lightsail)

Si no tienes el `.pem` a mano, usa la consola web, que no requiere llave:

1. Entra a la consola de AWS → **Lightsail** → **Instances**.
2. Elige `plataforma-estudiantil-api` o `plataforma-estudiantil-moodle`.
3. Botón **Connect using SSH** (abre una terminal en el navegador).

Esa terminal **no tiene este repositorio**. Dos opciones:

- **Después del primer despliegue**, los scripts ya están en la instancia de la
  API, copiados por `10-api-bootstrap.sh`:

  ```bash
  ls /opt/plataforma-estudiantil/api/bin/deploy/
  sudo /opt/plataforma-estudiantil/api/bin/deploy/90-smoke-test.sh --help
  ```

- **Antes del primer despliegue**, clona el repositorio en la instancia:

  ```bash
  sudo install -d -o "$USER" /opt/plataforma-estudiantil
  git clone <REPO_URL> ~/pae-u
  chmod +x ~/pae-u/infra/deploy/*.sh
  ```

  La consola del navegador no permite copiar-pegar archivos cómodamente; para el
  archivo de secretos (paso 1) es mejor usar una terminal real con la llave, o
  escribir los parámetros directamente con `aws ssm put-parameter`.

> La consola del navegador cierra la sesión por inactividad. Para los scripts
> largos (`20-moodle-install.sh` tarda varios minutos) ejecútalos dentro de
> `tmux` o con `nohup ... &` para que no mueran al cortarse la sesión.

---

## 5. Qué hay que poner en SSM

Prefijo: **`/plataforma-estudiantil/production/`**

| Parámetro | Tipo | De dónde sale |
| --- | --- | --- |
| `…/env/HOST` | SecureString | `127.0.0.1` (fijo; Nginx es el único acceso) |
| `…/env/PORT` | SecureString | `4000` |
| `…/env/ADMIN_API_KEY` | SecureString | tú: `openssl rand -hex 32` |
| `…/env/ADMIN_EMAIL` | SecureString | tú (correo del admin de la API) |
| `…/env/ADMIN_PASSWORD` | SecureString | tú (contraseña larga y aleatoria) |
| `…/env/ADMIN_SESSION_TTL_MINUTES` | SecureString | `720` |
| `…/env/AUTO_SYNC_INTERVAL_SEC` | SecureString | `180` |
| `…/env/PUBLIC_SYNC_MAX_AGE_SEC` | SecureString | `30` |
| `…/env/PUBLIC_SESSION_TTL_MINUTES` | SecureString | `43200` |
| `…/env/DATABASE_URL` | SecureString | lo construye `40-db-init.sh --put-ssm` |
| `…/env/MOODLE_BASE_URL` | SecureString | `https://lms.portal.thefloridianuniversity.com` |
| `…/env/MOODLE_TOKEN` | SecureString | lo imprime `21-moodle-webservices.sh` |
| `…/env/EXTERNAL_INTEGRATION_BASE_URL` | SecureString | `https://api.pasosalexito.com` |
| `…/env/EXTERNAL_INTEGRATION_API_KEY` | SecureString | tú |
| `…/infra/db-endpoint` | String | hostname del endpoint de PostgreSQL (caché) |

**El manejo del `.env` es genérico:** `10-api-bootstrap.sh` hace
`get-parameters-by-path --recursive` y convierte **cada** parámetro bajo
`…/env/` en una línea del `.env`. Para añadir una variable nueva (por ejemplo
las de notificación del formulario de contacto o de compliance que está
agregando otro ingeniero) basta con crear el parámetro y redesplegar: **no hay
que tocar ningún script**.

### Secretos que el operador debe aportar a mano (nunca van a SSM ni al repo)

| Variable de entorno | Dónde se usa | Dónde se consigue |
| --- | --- | --- |
| `PGPASSWORD` | `40-db-init.sh` | consola Lightsail → Databases → *Connect* (usuario `dbmasteruser`) |
| `DB_APP_PASSWORD` | `40-db-init.sh` | la eliges tú (se le asigna al rol `paeu_app`) |
| `MOODLE_DB_ROOT_PASSWORD` | `20-moodle-install.sh` | `/home/bitnami/bitnami_credentials` en la instancia |
| `MOODLE_DB_PASSWORD` | `20-moodle-install.sh` | la eliges tú (usuario MariaDB `moodle`) |
| `MOODLE_ADMIN_PASSWORD` | `20-moodle-install.sh` | la eliges tú (cuenta `admin` de Moodle) |
| `BUCKET_ACCESS_KEY_ID` / `BUCKET_SECRET_ACCESS_KEY` | `30-frontend-deploy.sh` | `aws lightsail create-bucket-access-key` |

### IAM: una instancia Lightsail **no** puede tener rol de instancia

Esto es una limitación real de Lightsail: no existen *instance profiles*. La
instancia de la API necesita por tanto una **access key de usuario IAM** para
leer SSM. El script imprime todos los comandos:

```bash
./infra/deploy/50-secrets-put.sh --emit-policy
```

Resumen: crea el usuario `plataforma-estudiantil-api-ssm` con
`iam/api-ssm-read-policy.json`, y deja su access key en la instancia en
`/etc/plataforma-estudiantil/aws.env` (modo `0600`, `root:root`). Rota la llave
cada 90 días.

---

## 6. Orden de ejecución (primera instalación)

> Ejecuta los pasos en este orden. Cada script es idempotente: si algo falla a
> mitad, corrige la causa y vuelve a lanzar el mismo script.

| # | Script | Dónde se ejecuta | Qué hace |
| --- | --- | --- | --- |
| 0 | *(manual)* | consola AWS | IAM: los 3 usuarios/políticas de `--emit-policy`; dejar `aws.env` en la instancia de la API |
| 1 | `50-secrets-put.sh` | operador | sube el `.env` a SSM como `SecureString` |
| 2 | `31-frontend-domain-tls.sh` | operador | certificado Lightsail + asocia `portal.*` al CDN (**dos fases**, ver abajo) |
| 3 | `40-db-init.sh` | **host API** | crea rol `paeu_app` + base `paeu` en PostgreSQL y verifica `CREATE TABLE` |
| 4 | `20-moodle-install.sh` | **host Moodle** | instala Moodle 4.5 por CLI, Apache, HTTPS, idiomas, cron, respaldos |
| 5 | `21-moodle-webservices.sh` | **host Moodle** | Web Services + REST + servicio externo + usuario + token |
| 6 | *(manual)* | operador | guarda en SSM el `MOODLE_TOKEN` y `MOODLE_BASE_URL` |
| 7 | `10-api-bootstrap.sh` | **host API** | release + build + `.env` desde SSM + PM2 + health check |
| 8 | `11-api-nginx-tls.sh` | **host API** | vhost de Nginx + certificado Let's Encrypt + renovación |
| 9 | `30-frontend-deploy.sh` | operador | build de la SPA + publicación al bucket + reset del CDN |
| 10 | `90-smoke-test.sh` | operador | verificación completa; debe terminar en `0` |

### Paso 1 — secretos a SSM

```bash
cd infra/deploy
cp env.production.local.example env.production.local
chmod 600 env.production.local
$EDITOR env.production.local            # rellena todo menos DATABASE_URL y MOODLE_TOKEN

./50-secrets-put.sh --file env.production.local
./50-secrets-put.sh --list              # confirma: nombres y versiones, nunca valores
```

`DATABASE_URL` y `MOODLE_TOKEN` se completan en los pasos 3 y 6. Cuando
termines, borra el archivo: `shred -u env.production.local`.

### Paso 2 — dominio del portal (dos fases)

```bash
./31-frontend-domain-tls.sh             # fase 1: imprime el CNAME de validación
# -> añade ese CNAME en Cloudflare, nube gris
./31-frontend-domain-tls.sh --wait 15   # fase 2: espera validación y asocia el cert
```

### Paso 3 — base de datos (desde el host de la API)

```bash
ssh ubuntu@44.210.204.140
cd ~/pae-u/infra/deploy                 # o /opt/plataforma-estudiantil/api/bin/deploy
set -a; . /etc/plataforma-estudiantil/aws.env; set +a

read -rs -p 'master password: ' PGPASSWORD; export PGPASSWORD
read -rs -p 'app password: '    DB_APP_PASSWORD; export DB_APP_PASSWORD
./40-db-init.sh --put-ssm               # crea el rol/base y sube DATABASE_URL a SSM
unset PGPASSWORD DB_APP_PASSWORD
```

El endpoint de PostgreSQL **no está en el repositorio**. El script lo busca en
`$PGHOST`, luego en SSM (`…/infra/db-endpoint`) y luego en la API de Lightsail.

### Pasos 4 y 5 — Moodle

```bash
ssh bitnami@34.200.208.43
cd ~/pae-u/infra/deploy

sudo cat /home/bitnami/bitnami_credentials      # contraseña inicial de MariaDB root
read -rs -p 'mariadb root: ' MOODLE_DB_ROOT_PASSWORD; export MOODLE_DB_ROOT_PASSWORD
read -rs -p 'moodle db:    ' MOODLE_DB_PASSWORD;      export MOODLE_DB_PASSWORD
read -rs -p 'moodle admin: ' MOODLE_ADMIN_PASSWORD;   export MOODLE_ADMIN_PASSWORD

./20-moodle-install.sh                  # usa tmux: tarda varios minutos
./21-moodle-webservices.sh              # imprime MOODLE_WS_TOKEN=... en stdout
unset MOODLE_DB_ROOT_PASSWORD MOODLE_DB_PASSWORD MOODLE_ADMIN_PASSWORD
```

Para fijar una versión reproducible en lugar del último parche de la rama 4.5:

```bash
MOODLE_VERSION=4.5.6 \
MOODLE_SHA256=<sha256 publicado> \
./20-moodle-install.sh
```

### Paso 6 — token de Moodle a SSM

```bash
aws ssm put-parameter --region us-east-1 \
  --name /plataforma-estudiantil/production/env/MOODLE_TOKEN \
  --type SecureString --key-id alias/aws/ssm \
  --value '<token>' --overwrite

aws ssm put-parameter --region us-east-1 \
  --name /plataforma-estudiantil/production/env/MOODLE_BASE_URL \
  --type SecureString --key-id alias/aws/ssm \
  --value 'https://lms.portal.thefloridianuniversity.com' --overwrite
```

Si la instancia de Moodle ya tiene credenciales AWS, `21-moodle-webservices.sh
--put-ssm` lo hace por ti.

### Pasos 7 y 8 — API

```bash
ssh ubuntu@44.210.204.140
cd ~/pae-u/infra/deploy
set -a; . /etc/plataforma-estudiantil/aws.env; set +a

sudo -E ./10-api-bootstrap.sh --source local --from ~/pae-u
sudo -E ./11-api-nginx-tls.sh
```

Para ensayar el certificado sin gastar cuota de Let's Encrypt:
`sudo -E ./11-api-nginx-tls.sh --staging` (el certificado no será de confianza y
el smoke test lo reportará como fallo de TLS, que es lo esperado).

### Paso 9 — frontend

```bash
cd infra/deploy
export BUCKET_ACCESS_KEY_ID=... BUCKET_SECRET_ACCESS_KEY=...   # opcional
./30-frontend-deploy.sh
```

### Paso 10 — verificación

```bash
ADMIN_EMAIL='...' ADMIN_PASSWORD='...' MOODLE_TOKEN='...' ./90-smoke-test.sh
```

---

## 7. Verificación: qué comprueba `90-smoke-test.sh`

Es **de solo lectura**, imprime una tabla `PASS/FAIL/WARN/SKIP` y termina con
código `1` si algo falla.

| Grupo | Comprobaciones |
| --- | --- |
| DNS | los tres hostnames resuelven |
| TLS | cadena válida, el hostname está en el SAN, **más de 14 días** de vigencia |
| Redirect | `http://` → `https://` en la API y en el LMS |
| API pública | `GET /api/health` → `200` con `status=ok` y `db` no nulo; `GET /api/v1/home` y `/api/v1/catalog` → `200` y JSON válido |
| API admin | `POST /api/admin/auth/login` → token; `GET /api/admin/auth/me` con `Bearer` → `200`; `GET /api/admin/moodle/status` → `siteInfo.ok = true` |
| Negativas | `/api/admin/*` sin token → `401`; token falsificado → `401` |
| Hardening | sin `x-powered-by`, sin versión en `Server`, sin stack traces en los errores, HSTS y `nosniff` presentes |
| CORS | el origen del portal está permitido y la cabecera `Access-Control-Allow-Origin` aparece **exactamente una vez** |
| LMS | `GET /login/index.php` → `200`; `core_webservice_get_site_info` devuelve JSON con `sitename`; el LMS **no** envía cabeceras CORS |
| Portal | `/` y el enlace profundo `/admin` sirven la SPA; `index.html` sin caché y los assets con hash en caché inmutable |

Opciones útiles:

```bash
./90-smoke-test.sh --base-url https://api.staging.ejemplo.com \
                   --portal-url https://portal.staging.ejemplo.com \
                   --lms-url https://lms.staging.ejemplo.com
./90-smoke-test.sh --skip-admin        # sin credenciales
./90-smoke-test.sh -v                  # imprime cuerpos y cabeceras
```

### Sobre la comprobación directa del web service de Moodle

El contrato prohíbe que cualquier frontend consuma Moodle directamente. El
vhost de Apache aplica una **allow-list por IP sobre `/webservice/`**
(`MOODLE_WS_ALLOW_IPS`, por defecto la IP de la instancia de la API más
loopback). Por eso:

- Si el smoke test se ejecuta desde una máquina **no** autorizada, esa
  comprobación devuelve `403` y se registra como **PASS (restringido, como se
  espera)**.
- La prueba autoritativa de que el LMS está realmente operativo es
  `GET /api/admin/moodle/status`, que consulta a Moodle **a través de la API**.
- Además se verifica que el LMS **no** devuelva `Access-Control-Allow-Origin`,
  que es lo que impediría a un navegador llamarlo directamente.

Para depurar desde tu máquina, añade temporalmente tu IP:

```bash
MOODLE_WS_ALLOW_IPS="34.200.208.43 127.0.0.1 ::1 44.210.204.140 TU.IP.AQUI" \
  sudo -E ./20-moodle-install.sh --skip-download --skip-cert
```

---

## 8. Despliegues posteriores (CI/CD)

### `ci.yml` — en cada push y PR

Node 22 → `npm ci` → `npm run check` (typecheck de todos los workspaces) →
`npm run build` → **arranca la API de verdad contra un contenedor de
PostgreSQL 16** y comprueba que `initDb()` crea el esquema y que las rutas
públicas responden. También valida el propio kit (`bash -n`, `shellcheck`,
`php -l`, YAML y JSON).

### `deploy.yml` — manual

Actions → **Deploy** → *Run workflow* → elige `staging` o `production`.

Secuencia: **frontend** (build + bucket + reset del CDN) → **api** (rsync del
checkout + `10-api-bootstrap.sh`) → **smoke** (`90-smoke-test.sh`). Si el smoke
test falla, el job hace **rollback de la API** y termina en error.

La API se despliega *después* del frontend a propósito: una SPA nueva hablando
con una API vieja es el estado transitorio seguro, porque la API solo agrega
rutas.

La lista completa de secretos y variables requeridos está en el comentario de
cabecera de `.github/workflows/deploy.yml`. Resumen:

- **Secretos obligatorios:** `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
  `SSH_PRIVATE_KEY`, `SMOKE_ADMIN_EMAIL`, `SMOKE_ADMIN_PASSWORD`.
- **Secretos opcionales:** `SSH_KNOWN_HOSTS` (muy recomendable),
  `BUCKET_ACCESS_KEY_ID`, `BUCKET_SECRET_ACCESS_KEY`, `SMOKE_MOODLE_TOKEN`.

---

## 9. Rollback

Los releases se despliegan en directorios con sello de tiempo y se activan con
un symlink:

```
/opt/plataforma-estudiantil/api/
├── releases/20260207T143000/   ... (se conservan los últimos 5)
├── current  -> releases/<nuevo>
├── previous -> releases/<anterior>
├── shared/.env                 renderizado desde SSM, modo 0600
├── logs/                       con logrotate diario
└── bin/                        copia de infra/ en la instancia
```

### API — automático

`10-api-bootstrap.sh` hace el health check en `127.0.0.1:4000/api/health` tras
cambiar el symlink. Si no pasa, **revierte solo** a `previous`, recarga PM2 y
termina en error. No hay que intervenir.

### API — manual

```bash
ssh ubuntu@44.210.204.140
sudo /opt/plataforma-estudiantil/api/bin/deploy/10-api-bootstrap.sh --rollback --force
```

O volver a un release concreto:

```bash
ls /opt/plataforma-estudiantil/api/releases/
sudo ln -sfn /opt/plataforma-estudiantil/api/releases/<ID> /opt/plataforma-estudiantil/api/current.tmp
sudo mv -Tf /opt/plataforma-estudiantil/api/current.tmp /opt/plataforma-estudiantil/api/current
sudo -u paeu -H env PM2_HOME=/home/paeu/.pm2 pm2 reload paeu-api
```

### Frontend

El bucket no versiona objetos. Para volver atrás, reconstruye y publica desde
el commit anterior:

```bash
git checkout <commit-anterior>
./infra/deploy/30-frontend-deploy.sh
```

Por eso `30-frontend-deploy.sh` **no borra** objetos antiguos salvo que se pase
`--prune --force`: los assets con hash del release previo siguen en el bucket y
las pestañas ya abiertas continúan funcionando.

### Moodle

No se despliega por release. La recuperación es por restauración:

- **Snapshot diario de Lightsail** (retención 7 días) para recuperar el disco
  completo.
- **Respaldo propio** en `/opt/plataforma-estudiantil/backups/moodle/<sello>/`
  (`moodle-db.sql.gz`, `moodledata.tar.gz`, `config.php`, `MANIFEST.txt`),
  generado cada noche a las 03:17 UTC con retención de 14 días.

```bash
# restauración de la base de datos
gunzip -c moodle-db.sql.gz | /opt/bitnami/mariadb/bin/mysql --defaults-file=<my.cnf>
# restauración de moodledata
sudo tar -xzf moodledata.tar.gz -C /opt/bitnami/projects/lms/moodledata
sudo chown -R daemon:daemon /opt/bitnami/projects/lms/moodledata
```

---

## 10. Operación continua

| Tarea | Cómo |
| --- | --- |
| Renovación TLS | `certbot` con timer de systemd en ambos hosts, con hook de recarga. Verificar: `sudo certbot renew --dry-run` |
| Cron de Moodle | `/etc/cron.d/paeu-moodle`, cada minuto como el usuario `daemon` |
| Respaldo de Moodle | mismo archivo cron, 03:17 UTC, log en `/var/log/paeu-moodle-backup.log` |
| Logs de la API | `/opt/plataforma-estudiantil/api/logs/`, logrotate diario, 14 días, máx. 100 MB |
| Rotar el token de Moodle | `./21-moodle-webservices.sh --rotate-token --force`, actualizar `MOODLE_TOKEN` en SSM y redesplegar la API **en la misma ventana** |
| Rotar un secreto | `./50-secrets-put.sh --file <archivo>` y luego `10-api-bootstrap.sh` |
| Rotar la access key IAM de la instancia | ver `./50-secrets-put.sh --emit-policy` |
| Ver qué hay en SSM | `./50-secrets-put.sh --list` (nombres y versiones, nunca valores) |
| Estado de los procesos | `sudo -u paeu -H env PM2_HOME=/home/paeu/.pm2 pm2 ls` |
| Verificación periódica | `./90-smoke-test.sh` (idealmente en un cron o scheduled task) |

---

## 11. Limitaciones conocidas y decisiones de diseño

### 11.1 Fallback de SPA en el CDN de Lightsail (importante)

Una distribución de Lightsail solo expone un **default root object**; **no tiene
API de *custom error responses***, así que no existe una reescritura comodín
`404 → /index.html`. Los enlaces profundos (`/admin`, `/admin/companies`, …) se
resuelven publicando una copia de `index.html` bajo cada ruta de cliente
(`SPA_FALLBACK_ROUTES` en `00-config.sh`), tanto como `<ruta>` como
`<ruta>/index.html`.

**Consecuencia:** cuando se añada una ruta nueva a la SPA, hay que añadirla a
`SPA_FALLBACK_ROUTES` o su enlace profundo devolverá `404`. El smoke test lo
detecta.

**Solución definitiva** (recomendada si crecen las rutas): migrar a una
distribución CloudFront propia con una *custom error response*
`403/404 → /index.html (200)`. Solo cambia el paso de reset de caché en
`30-frontend-deploy.sh` (`aws cloudfront create-invalidation` en lugar de
`aws lightsail reset-distribution-cache`).

### 11.2 Subida de objetos: por qué `aws s3` y no `aws lightsail`

**No existe** una operación `aws lightsail put-object`: la API de Lightsail
gestiona buckets, llaves y reglas de acceso, no su contenido. Los buckets de
Lightsail son compatibles con S3, así que `30-frontend-deploy.sh` sube con
`aws s3 --endpoint-url https://s3.us-east-1.amazonaws.com` usando las **access
keys del bucket** (`aws lightsail get-bucket-access-keys`), que siguen siendo
credenciales emitidas por Lightsail y limitadas a ese bucket. Para el CDN sí se
usa la API de Lightsail: `aws lightsail reset-distribution-cache` (no
`aws cloudfront create-invalidation`, porque es una distribución de Lightsail).

### 11.3 Node debe ser ≥ 22.18

`packages/shared/package.json` declara `"main": "src/index.ts"`, es decir
**TypeScript sin compilar**. La API compilada sigue haciendo
`import … from '@atlas/shared'`, así que **en producción Node carga un `.ts`
directamente**. Funciona porque Node ≥ 22.18 elimina los tipos por defecto
(`process.features.typescript === 'strip'`).

`10-api-bootstrap.sh` lo verifica: con Node 22.6–22.17 añade
`--experimental-strip-types` a PM2, y con versiones anteriores **aborta con un
mensaje explícito**. `ci.yml` también lo comprueba.

Arreglo de raíz (fuera del alcance de este kit, requiere tocar `packages/`):
apuntar `main`/`exports` de `@atlas/shared` a `dist/`.

### 11.4 Ruta del entrypoint compilado

`apps/api/tsconfig.json` hereda `baseUrl: "."` de la raíz del monorepo, así que
`tsc` emite un árbol anidado y el entrypoint real es
`apps/api/dist/apps/api/src/server.js` (no `apps/api/dist/server.js`).

Está en `API_ENTRY_REL` (`00-config.sh`); si no existe, el script lo busca y
avisa. `ci.yml` falla si la ruta cambia, para que nadie se entere en producción.

### 11.5 PM2, no systemd directo

Se eligió **PM2** porque ya venía instalado por el launch script, da modo
*cluster* (2 workers para 2 vCPU) y recarga sin downtime. La persistencia entre
reinicios la da `pm2 startup systemd`, que instala la unidad
`pm2-paeu.service`. Es una sola decisión, aplicada de forma consistente: no hay
unidades systemd propias para la API.

### 11.6 La contraseña del instalador de Moodle pasa por argv

`admin/cli/install.php` solo acepta credenciales como argumentos, así que
durante esa única ejecución son visibles para `ps` **en ese host**. Todo lo
demás (respaldos, provisión del web service, MariaDB) usa archivos de opciones
en modo `0600` y nunca argv. No hay forma de evitarlo con el instalador de
Moodle; se ejecuta una sola vez.

### 11.7 Sin herramienta de migraciones

La API crea su propio esquema en el arranque (`initDb()` con
`CREATE TABLE IF NOT EXISTS`). `40-db-init.sh` **no** crea tablas; solo el rol,
la base y los privilegios, y verifica que el rol pueda hacer `CREATE TABLE`.
Un cambio de esquema que no sea puramente aditivo (renombrar o cambiar un tipo
de columna) **no** se aplicará solo: necesita SQL manual en una ventana de
mantenimiento.

---

## 12. Troubleshooting

| Síntoma | Causa probable | Qué hacer |
| --- | --- | --- |
| `GET /api/health` → `404` | Nginx recorta `/api` además de Fastify | Revisar `proxy_pass http://paeu_api;` **sin** URI final y sin `rewrite` en `api.portal.ssl.conf.template` |
| `GET /api/health` → `502` | la API no escucha en `127.0.0.1:4000` | `sudo -u paeu -H env PM2_HOME=/home/paeu/.pm2 pm2 ls`; `tail logs/paeu-api.err.log`; confirmar `HOST=127.0.0.1` y `PORT=4000` en SSM |
| `health` responde pero `db: null` | `DATABASE_URL` mal o sin `sslmode=require` | `./40-db-init.sh --verify-only`; Lightsail Managed PostgreSQL **exige** TLS |
| La API no arranca: `ERR_UNKNOWN_FILE_EXTENSION ".ts"` | Node < 22.18 sin strip de tipos | Ver §11.3; actualizar Node o relanzar `10-api-bootstrap.sh` (añade el flag solo) |
| `10-api-bootstrap.sh`: "no parameters found under …/env/" | la instancia no puede leer SSM | Comprobar `/etc/plataforma-estudiantil/aws.env` y la política `api-ssm-read-policy.json`; recordar que Lightsail no soporta roles de instancia |
| `certbot` falla con "Invalid response" / 404 | el registro en Cloudflare está proxeado (nube naranja) o el 80 está cerrado | Poner el registro en **DNS only**; abrir TCP 80 en el firewall de Lightsail. El script hace un auto-test del path ACME antes de llamar a certbot |
| `/admin` en el portal devuelve `404` | falta el alias de SPA para esa ruta | Añadirla a `SPA_FALLBACK_ROUTES` en `00-config.sh` y relanzar `30-frontend-deploy.sh` (ver §11.1) |
| El portal sigue mostrando "Coming soon" | nunca se publicó la SPA, o caché del CDN | `./30-frontend-deploy.sh`; si persiste, `aws lightsail reset-distribution-cache --distribution-name plataforma-estudiantil-cdn` y esperar unos minutos |
| El certificado del portal es el equivocado | el dominio personalizado no está asociado al CDN | `./31-frontend-domain-tls.sh` (ver §6, paso 2) |
| `admin/moodle/status` → `configured: false` | falta `MOODLE_BASE_URL` o `MOODLE_TOKEN` en SSM | Subirlos y relanzar `10-api-bootstrap.sh` |
| `admin/moodle/status` → `siteInfo.ok: false` | la allow-list de `/webservice` no incluye la IP de la API, o el token es inválido | Verificar `MOODLE_WS_ALLOW_IPS` (debe incluir `44.210.204.140`); relanzar `./21-moodle-webservices.sh --print-only` |
| Moodle: `invalidtoken` | token rotado y SSM sin actualizar | `./21-moodle-webservices.sh --print-only` muestra el estado; `--rotate-token --force` genera uno nuevo. Actualizar SSM y redesplegar |
| Moodle: `accessexception` en una función | el usuario de integración no tiene la capability | `./21-moodle-webservices.sh` vuelve a aplicar el rol; para una capability extra, añadirla a `$defaultcapabilities` en `cli/paeu-provision-webservice.php` |
| Moodle: `core_notes_*` devuelve error | `enablenotes` desactivado | Lo activa `20-moodle-install.sh`; verificar con `php admin/cli/cfg.php --name=enablenotes` |
| Moodle: `core_completion_*` sin datos | `enablecompletion` desactivado | Igual que arriba, con `--name=enablecompletion` |
| `enrol_manual_enrol_users` → "role not allowed" | el rol destino no está permitido en el plugin *Manual enrolments* | Site administration → Plugins → Enrolments → Manual enrolments → *Roles asignables* |
| El navegador bloquea las llamadas: error de CORS | hay dos `Access-Control-Allow-Origin` | Nginx **no** debe añadir cabeceras CORS; las pone `@fastify/cors`. El smoke test lo detecta ("single CORS header") |
| TLS con menos de 14 días | la renovación no corre | `sudo certbot renew --dry-run`; `systemctl list-timers \| grep certbot` |
| Apache de Bitnami no arranca tras editar un vhost | error de sintaxis | `sudo /opt/bitnami/apache/bin/apachectl configtest`; luego `sudo /opt/bitnami/ctlscript.sh restart apache` |
| Moodle muy lento o con errores de formulario | falta `max_input_vars` / opcache | Confirmar que `/opt/bitnami/php/etc/conf.d/zz-moodle.ini` está instalado y reiniciar Apache |
| `rsync`/`ssh` falla en CI con host key | falta `SSH_KNOWN_HOSTS` | `ssh-keyscan -H 44.210.204.140` y guardarlo como secreto |
| `30-frontend-deploy.sh`: "the API did not return secretAccessKey" | la API de Lightsail solo revela el secreto al crear la llave | `aws lightsail create-bucket-access-key …` y exportar `BUCKET_ACCESS_KEY_ID` / `BUCKET_SECRET_ACCESS_KEY` |

### Diagnóstico rápido

```bash
# ¿qué está vivo?
./infra/deploy/90-smoke-test.sh -v

# API
ssh ubuntu@44.210.204.140 'sudo -u paeu -H env PM2_HOME=/home/paeu/.pm2 pm2 ls'
ssh ubuntu@44.210.204.140 'sudo tail -n 100 /opt/plataforma-estudiantil/api/logs/paeu-api.err.log'
ssh ubuntu@44.210.204.140 'curl -s localhost:4000/api/health'
ssh ubuntu@44.210.204.140 'sudo nginx -t && sudo systemctl status nginx --no-pager'

# Moodle
ssh bitnami@34.200.208.43 'sudo /opt/bitnami/ctlscript.sh status'
ssh bitnami@34.200.208.43 'sudo tail -n 100 /opt/bitnami/apache/logs/lms.portal.thefloridianuniversity.com-error_log'
ssh bitnami@34.200.208.43 'sudo -u daemon -g daemon /opt/bitnami/php/bin/php /opt/bitnami/projects/lms/moodle/admin/cli/cron.php'

# ¿qué release está activo?
ssh ubuntu@44.210.204.140 'readlink -f /opt/plataforma-estudiantil/api/current'
```

Cualquier script acepta `--help` y `--dry-run`. Úsalos: `--dry-run` imprime
exactamente lo que haría sin tocar nada.
