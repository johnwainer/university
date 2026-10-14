# Traspaso — Plataforma estudiantil de The Floridian University

**Fecha:** 14 de octubre de 2026
**Rama:** `feat/university-os-fases-1-5` · **HEAD:** `87ff0e4` · árbol limpio
**Repositorio:** `github.com/johnwainer/university.git`

Este archivo existe para que una conversación nueva pueda arrancar sin contexto
previo. Todo lo que dice se comprobó contra producción el 14 de octubre de 2026;
donde algo no se pudo comprobar, se dice.

---

## 1. Cómo usar este archivo

Léelo entero antes de tocar nada. Después:

- Para **operar** (desplegar, reiniciar, restaurar): §4 y §7.
- Para **entender por qué algo está como está**: `PROJECT_RUNBOOK.md` en el
  repositorio, que tiene 25 secciones y es la memoria larga del proyecto. Este
  traspaso es el resumen; el runbook es el detalle.
- Para **saber qué hacer a continuación**: §8.
- Antes de cambiar nada en producción: §9. Esas trampas ya mordieron una vez.

---

## 2. Qué es la plataforma

Una plataforma educativa para **The Floridian University (TFU)**, una
universidad real y acreditada. Tres piezas:

| pieza | qué es | tecnología |
|---|---|---|
| **API** | el intermediador: SIS, CRM, sílabos, credenciales, IAM, programas | Fastify 5 + TypeScript ESM + PostgreSQL 16 |
| **Portal** | el sitio público y la plataforma del estudiante | React 19 + Vite 6 + i18next (ES/EN) |
| **LMS** | el aula académica, detrás del API | Moodle 4.5.14+ |

Monorepo con workspaces de npm: `@tfu/shared`, `@tfu/api`, `@tfu/web`.

**El modelo de datos que hay que entender antes de tocar matrículas.** La unidad
de matrícula es el **PROGRAMA**, no el curso. Un programa apunta a sus cursos
por `degree_requirements` con `requirement_type = 'course'`. Y hay **dos tablas
de matrícula que no son lo mismo**:

- `student_enrollments` — el SIS. Lleva periodo, programa, aula, estado, **nota**
  y créditos. De aquí leen el expediente, el promedio y la auditoría de grado.
- `user_course_enrollments` — el espejo de Moodle. Sólo dice si el estudiante
  puede entrar al aula.

Son independientes a propósito: el estudiante puede estar matriculado en su
programa y ver su plan aunque Moodle esté caído.

---

## 3. Las tres máquinas

Esta regla evita la mitad de los errores: **compilar en el contenedor, mover por
el equipo, ejecutar en el servidor.**

| máquina | qué puede | qué NO puede |
|---|---|---|
| **contenedor** (donde corre el agente) | compilar, Playwright, git | **no tiene SSH ni AWS** |
| **equipo del usuario** (`device_bash`) | SSH, scp, el clon local | no compila el proyecto |
| **servidores** | ejecutar, AWS por rol de instancia | — |

### 3.1 Servidor del API

```
ubuntu@44.210.204.140          Ubuntu 24.04.5 LTS · Node v22.23.3
pm2                            tfu-api  (un solo proceso)
PostgreSQL                     base tfu · rol tfu  (scram-sha-256)
release en curso               /opt/plataforma-estudiantil/api/current -> releases/20261013195552
.env del release               /opt/plataforma-estudiantil/api/current/.env
.env plantilla                 /opt/plataforma-estudiantil/api/shared/.env   <- OJO, §9.1
respaldos                      /var/backups/api/
rol AWS                        plataforma-estudiantil-frontend.obj-mgmt
```

### 3.2 Servidor de Moodle

```
admin@34.200.208.43            Debian 12 (bookworm) · PHP 8.3.35
raíz                           /var/www/moodle          usuario web: www-data
versión                        Moodle 4.5.14+ (Build 20261002)
respaldos                      /var/backups/moodle/
```

El usuario es **`admin`**, no `ubuntu` ni `bitnami`. Y **`infra/deploy/00-config.sh`
describe un despliegue Bitnami en `/opt/bitnami/...` que NO es esta máquina**;
ignóralo para Moodle.

### 3.3 Clave y clon

```
clave SSH (en el equipo)   ~/mnt/Downloads/test-html-thefloridianuniversity-key.pem
clon local (en el equipo)  ~/mnt/Documents/pae-u
```

El clon local tiene **tres cambios sin commitear del usuario**:
`PROJECT_RUNBOOK.md`, `docker-compose.yml` y un `tfu-api-backup.sh` sin seguir.
**No se tocan.** Ver §7.3 para cómo empujar sin pisarlos.

### 3.4 Dominios

```
portal.thefloridianuniversity.com        el portal (bucket S3 + CDN de Lightsail)
api.portal.thefloridianuniversity.com    el API        <- el portal llama AQUÍ
lms.portal.thefloridianuniversity.com    Moodle
```

**Cuidado:** `portal.../api/*` devuelve 403 porque CloudFront lo manda al bucket.
No es una avería: el portal llama a `api.portal...`, no a `/api` del propio host.

---

## 4. Reglas que no se rompen

Estas vienen del traspaso anterior y siguen vigentes.

1. **Las credenciales de producción se leen y se usan DENTRO del servidor**,
   nunca se copian al equipo ni al chat. Para cambiar un `.env`, se edita en
   sitio con un guion que no imprima el secreto.
2. **El clasificador de seguridad bloquea** leer el `.env` de producción y los
   borrados masivos. Cuando ocurra, **no buscar rodeos**: decirlo y pedir al
   usuario que lo haga o lo autorice.
3. **Verificar antes de afirmar.** Nada se da por hecho sin comprobarlo contra
   producción, y la salida real se pega como evidencia.
4. **No inventar contenido institucional.** TFU es una universidad real: nada de
   personal, certificados, cifras ni políticas inventadas. Si falta un dato, se
   dice que falta.
5. **Todo en español**: mensajes de commit, comentarios de código, nombres de
   variables nuevas y claves i18n.
6. **`device_commit_files` con un nombre repetido entrega la versión anterior.**
   Nombre nuevo cada vez y comprobar `md5sum` **en los tres sitios**.
7. **No tocar los cambios sin commitear del clon del usuario.** Se empuja por
   bundle (§7.3).

---

## 5. Convenciones de código

- **i18n**: `apps/web/src/locales/{es,en}.json`. Paridad obligatoria —
  2.227 claves hoy en cada idioma. Ojo: i18next guarda los plurales como
  `clave_one` / `clave_other`, así que una auditoría ingenua los da por
  faltantes. La auditoría tiene que ser consciente de plurales.
- **IAM**: un `preHandler` sobre `/admin/*`; las secciones viven en
  `modules/iam/sections.ts` y el mapa de prefijos es `ROUTE_SECTIONS`. **Una ruta
  no mapeada queda sólo para superadmin.** Al añadir rutas de administración, hay
  que mapearlas.
- **Vocabularios CSS**: `ad-*` el panel de administración, `aula-*` el aula.
  Ambos sobre los tokens de `brand.css` (`--pcl-*`). **No escribir hexadecimales
  sueltos.**
- **Marca**: Midnight Atlantic Blue `#0B203A`, Aqua Horizon `#2DC4C7`, Coral
  `#FF6B6B`, Gold `#D4AF36`. Titulares en Area Extended, texto en Roboto. El
  contenedor de la plataforma son **1280px**.

---

## 6. Estado verificado el 14 de octubre de 2026

### 6.1 Lo que funciona

- API en línea, `/health` 200 por el borde público.
- 13 programas de TFU servidos en `/v1/programs`; 13 aulas en Moodle, todas con
  9 secciones y 35 actividades (13 oct – 7 dic).
- Catálogo bilingüe: los 13 cursos devuelven `tags` y `tagsEn`, 0 con `{mlang}`
  sin resolver.
- El estudiante demo `demo.estudiante@thefloridianuniversity.com` tiene sus dos
  matrículas SIS: `TFU-EDU-WALK` completado con `A-` (3,70 puntos, 3 créditos) y
  `TFU-SALES-EXC` en curso. Promedio 3,70.
- Moodle resuelve el multiidioma (filtro multilang2 instalado) y el servicio web
  sigue devolviendo el crudo que el portal necesita.
- Prueba de humo: **33 de 34**.

### 6.2 Cifras de la base

```
usuarios .................. 14   (11 de ellos ficticios, con dominio atlas)
matrículas SIS ............  2   (las dos del estudiante demo)
programas ................. 25   (13 de TFU + 12 heredados/de prueba)
aulas de Moodle ........... 13
contenidos ................ 13
clave del tenant .......... tenant-atlas   <- aún sin renombrar
certificados ..............  7   (los siete inventados)
directorio de personal ....  8   (los ocho inventados)
```

**Esas cifras dicen que el guion de limpieza de datos NO se ha ejecutado.** Ver
§8.1.

---

## 7. Cómo se despliega

### 7.1 El API

Patrón probado, y los dos pasos en negrita son los que ya causaron un corte:

1. Compilar en el contenedor: `npm run build`.
2. Empaquetar en un tarball **con nombre nuevo** y moverlo por el equipo al
   servidor; comprobar `md5sum` en los tres sitios.
3. Desplegar en un directorio de release nuevo, `npm ci --omit=dev`, enlazar
   `@tfu/shared`.
4. **`chown -R ubuntu:ubuntu` el release entero.** pm2 corre como `ubuntu`; si
   el `.env` queda de root, dotenv inyecta 0 variables y el API arranca contra
   credenciales por defecto. Eso tiró producción tres minutos.
5. **Probar en el puerto 4100 COMO `ubuntu`** antes de cambiar nada.
6. Cambiar el enlace `current` y `pm2 restart tfu-api --update-env`.

### 7.2 El portal

Se publica en el bucket `plataforma-estudiantil-frontend` con CDN
`plataforma-estudiantil-cdn`. **El contenedor no tiene AWS; el servidor del API
sí, por rol de instancia.** Así que:

1. En el contenedor, compilar **con la URL del API horneada**:
   ```bash
   VITE_API_URL="https://api.portal.thefloridianuniversity.com/api" \
     npm run build -w @tfu/web
   ```
   Sin esa variable el bundle apunta a `localhost:4000` y el portal no habla con
   nada. **Comprobarlo en el bundle antes de subir.**
2. Empaquetar `apps/web/dist` + `infra/deploy` y moverlo al servidor del API.
3. Allí: `REPO_DIR=<dir> bash infra/deploy/30-frontend-deploy.sh --skip-build --ambient-creds`

El vaciado de caché del CDN **falla** por un permiso que falta (§8.3). No
bloquea: `index.html` se sube con `no-cache, no-store, must-revalidate` y el CDN
no lo cachea, así que el build nuevo se sirve igual. Comprobar que el hash del
CSS servido coincide con el local.

### 7.3 Empujar al repositorio sin pisar al usuario

El clon del usuario tiene cambios sin commitear. Nunca se mezcla en su árbol:

```bash
# en el contenedor
git bundle create /mnt/user-data/outputs/tfu-<fecha>.bundle <desde>..HEAD
# mover al equipo con device_commit_files y comprobar md5
# en el equipo
git -C ~/mnt/Documents/pae-u fetch <bundle> HEAD:refs/remotes/bundle/<nombre>
git -C ~/mnt/Documents/pae-u push origin refs/remotes/bundle/<nombre>:refs/heads/feat/university-os-fases-1-5
```

---

## 8. Lo que está pendiente, por orden

### 8.1 Correr el guion de limpieza de datos — BLOQUEADO, necesita al usuario

`infra/data/retirar-ficcion-atlas.sql`. Retira de producción la ficción que dejó
la plantilla del producto anterior: 11 usuarios ficticios, 15 prospectos, **8
empleados inventados con cargo** (decanos, registradora), **7 certificados** con
número de serie, 5 apuntes de registro FERPA firmados por una cuenta que no
existe, 42 mensajes de prueba y 12 solicitudes ficticias. Y renombra la clave del
tenant de `tenant-atlas` a `tenant-tfu`.

**Por qué se retiran y no se renombran los dominios:** reescribirlos a
`@thefloridianuniversity.com` convertiría personal y certificados inventados en
personal y certificados aparentemente **reales** de una universidad acreditada.
Eso es peor que no tenerlos.

El guion es idempotente, está comentado, y lleva arriba el volcado previo y el
comando de restauración. **El clasificador de seguridad bloqueó su ejecución —y
hasta escribirlo por consola— con razón: son ~110 filas de once tablas de
producción.** Lo tiene que correr una persona:

```bash
sudo -u postgres pg_dump -d tfu -Fc -f /var/lib/postgresql/pre-retirada.dump
sudo mv /var/lib/postgresql/pre-retirada.dump /var/backups/api/
sudo -u postgres psql -d tfu -f retirar-ficcion-atlas.sql
```

El código ya es inmune al orden: `asegurarTenant()` pregunta si existe *algún*
tenant, así que da igual si el guion corre antes o después de un despliegue.

### 8.2 La contraseña del estudiante demo — BLOQUEADO, necesita al usuario

`demo.estudiante@thefloridianuniversity.com` es la cuenta que se va a entregar y
**nadie conoce su contraseña**. No está anotada en ninguna parte. El intento de
fijarla lo bloqueó el clasificador (escritura en `public_user_auth` de
producción).

Formato del hash, el de `verifyPassword`: `salt:scrypt(password, salt, 64)`,
ambos en hexadecimal.

**Consecuencia:** el aula rediseñada no se ha podido verificar en vivo con una
sesión de estudiante. Es la comprobación que falta.

Ojo: hay **dos** cuentas de estudiante y es fácil confundirlas.
`estudiante@atlas.edu` es el showcase heredado y tiene **0 matrículas**; probar
con ella da «0 programas» y parece una regresión que no existe.

### 8.3 Falta un permiso de AWS

Al rol `plataforma-estudiantil-frontend.obj-mgmt` le falta
`lightsail:ResetDistributionCache`. La subida funciona; el vaciado de caché
termina en `AccessDeniedException`. No bloquea hoy (§7.2), pero conviene
añadirlo.

### 8.4 El LMS envía `access-control-allow-origin: *`

Es el único fallo que queda en la prueba de humo. Permite que un front se salte
el API y hable con Moodle directamente, que es lo que el contrato prohíbe. Toca
la configuración del servidor web de Moodle. **No se tocó**: es anterior a esta
tanda y merece su propio cambio.

### 8.5 Doce programas que no son de TFU

`degree_programs` tiene 25 filas: 13 de TFU y 12 heredados — seis `DEMO-*`
inventados por la siembra y seis `QA*` de pruebas. **El API público sólo sirve
los 13 de TFU**, así que no se ven desde fuera, pero inflan los contadores del
panel. El guion del §8.1 **no** los toca. Decidir si se retiran.

### 8.6 63 mensajes de error del servidor no son bilingües

Están en español dentro del código. Arreglarlo toca unas 300 rutas, así que es
trabajo propio, no un olvido.

### 8.7 TFU no ha confirmado su escala de calificación

El módulo de registraduría usa la estándar estadounidense de 4,0 y **lo rotula
como pendiente**, tanto en el panel como en la respuesta del API
(`pendienteDeConfirmacion: true`). No se presenta una escala inventada como si
fuera la de la institución. Hace falta que TFU confirme la suya.

---

## 9. Trampas conocidas

Cada una de estas costó tiempo o un corte. Están aquí para que no vuelvan a
morder.

### 9.1 Hay DOS `.env` en producción

`current/.env` es el del release en curso. `shared/.env` es **la plantilla desde
la que el despliegue copia a cada release nuevo**. Al renombrar la base sólo se
cambió el primero, y:

- el guion de respaldos del usuario lee `shared/.env`, así que **los respaldos
  pasaron a fallar en silencio**;
- el siguiente despliegue habría copiado el `.env` viejo y el API no habría
  arrancado.

Ninguna de las dos cosas da señal al momento, y un `/health` en 200 no dice nada.
**Regla: al cambiar el `.env`, recorrerlos todos y después probar lo que depende
de ellos —el respaldo, no sólo la salud.**

```bash
sudo find /opt/plataforma-estudiantil -name ".env" -o -name ".env.*" \
  | while read F; do
      printf "%-70s %s\n" "$F" \
        "$(sudo grep -m1 '^DATABASE_URL=' "$F" \
           | sed -E 's|.*://([^:]+):[^@]*@[^/]+/(.*)$|\1@\2|')"
    done
```

### 9.2 La siembra de demostración deshacía cualquier limpieza

`seedBaseData()` corre en **cada arranque** del API y resembraba el catálogo de
la plantilla, sus ofertas y el tenant. Cualquier limpieza duraba hasta el
siguiente `pm2 restart`. Ya está cerrado con `SEED_DEMO_DATA`, apagado en
producción. **La lección general: antes de dar por hecha una limpieza de datos,
comprobar que nada la regenera al arrancar.**

### 9.3 `sudo cp` del `.env` tiró producción

Dejó el archivo de root; pm2 corre como `ubuntu`; dotenv inyectó 0 variables y el
API cayó a credenciales por defecto. 502 durante tres minutos. Ver §7.1, pasos 4
y 5.

### 9.4 Renombrar un rol de PostgreSQL puede invalidar su contraseña

Sólo con `md5`, que se sala con el nombre del rol. Aquí era `scram-sha-256` y por
eso fue seguro. **Comprobarlo antes** con `SHOW password_encryption` y el prefijo
de `pg_authid.rolpassword`.

### 9.5 `external_format_string` no filtra por omisión

`external_settings::get_filter()` vale `false`, y por eso el servicio web de
Moodle devuelve el crudo `{mlang ...}` que el portal necesita para elegir idioma.
**Lo que rompería el portal es mandar `moodlewssettingfilter=true`.** No añadirlo.

### 9.6 `filterall` no se escribe a mano

Se deriva de `stringfilters`. La API correcta es `filter_set_applies_to_strings()`.
Y un filtro activado sin esa segunda llamada **no hace nada en los encabezados**,
que es donde están los nombres de categoría.

### 9.7 El prefijo de interacciones se lee en dos formas

`ATLAS_INTERACTION::` se escribe en notas de Moodle **y se lee de vuelta**. El
código escribe `TFU_INTERACTION::` y lee los dos
(`moodleInteractionPrefixesLeidos`). **No recortar esa lista** sin comprobar que
no queda ninguna nota con el prefijo viejo: las interacciones ya guardadas
desaparecerían del portal sin error y sin aviso.

### 9.8 `pkill -f "PORT=4100"` mata tu propia sesión SSH

El patrón casa con la línea de comando del ssh. Buscar el PID con `ss -ltnp`.

---

## 10. Qué se hizo en la sesión que termina aquí

Resumen; el detalle está en `PROJECT_RUNBOOK.md` §21–§25.

1. **La plataforma del estudiante, funcional de punta a punta** (§21). Había
   cinco causas encadenadas; la de fondo era que la matrícula escribía sólo el
   espejo de Moodle y **nunca** `student_enrollments`, de modo que el expediente
   y el promedio estaban condenados a salir vacíos. Se creó el módulo de
   registraduría, que es el escritor de notas que no existía.
2. **El portal se ve como un portal de estudiantes** (§21.10): menús propios al
   iniciar sesión, sin el lenguaje de compra.
3. **Auditoría bilingüe completa** (§20): las 29 claves «faltantes» eran falsos
   positivos de los plurales de i18next. El número real era 0.
4. **Moodle: resuelto el bloqueante que llevaba roto todo el proyecto** (§22).
   Faltaba la fila `role_allow_assign` para `tfu_ws → student`, y detrás apareció
   una segunda capacidad que faltaba, `moodle/course:viewparticipants`.
5. **multilang2 instalado y verificado** (§23), con el riesgo del servicio web
   comprobado y descartado por el motivo del §9.5.
6. **Retirada completa de «Atlas»** (§24): 221 apariciones en 43 archivos del
   código, y un barrido generado sobre **las 314 columnas de texto** de la base.
   Paquetes `@atlas/*` → `@tfu/*`, base y proceso renombrados, y tres cambios
   que eran funcionales y no cosméticos: el número de serie de los certificados
   **reales**, el prefijo de interacciones (§9.7) y `asegurarTenant()`.
7. **Rediseño del aula** (§25). Resultó ser lo único del portal que nunca recibió
   el rebrand: fijaba a mano grises casi negros y acentos **violetas** de la
   plantilla. Se rediseñó para que sea más simple y usable por personas mayores
   —dos columnas en vez de tres, un solo indicador de avance en vez de cinco, la
   jerga de Moodle traducida a lenguaje humano, objetivos de 48px, el color como
   refuerzo y nunca como dato— y con el ancho de 1280px de la plataforma.

---

## 11. Dónde está documentado cada cosa

| archivo | qué contiene |
|---|---|
| `PROJECT_RUNBOOK.md` | la memoria larga, 25 secciones |
| `infra/data/retirar-ficcion-atlas.sql` | la limpieza pendiente del §8.1 |
| `infra/data/limpiar-legacy-atlas.sql` | la limpieza anterior, ya ejecutada |
| `infra/deploy/00-config.sh` | configuración del despliegue (ojo: su parte de Moodle es de otra máquina) |
| `infra/deploy/30-frontend-deploy.sh` | publicación del portal |
| `infra/deploy/90-smoke-test.sh` | la prueba de humo |
| `apps/web/src/components/aula.css` | el aula rediseñada |
| `apps/web/src/components/aula-iconos.tsx` | iconos y traducción de la jerga de Moodle |
| `apps/api/src/modules/sis/registraduria.ts` | matrícula SIS y registro de notas |

---

## 12. Lo primero que yo haría en la conversación nueva

1. Pedir al usuario que corra el guion del §8.1 y fije la contraseña del §8.2, o
   que me autorice a hacerlo.
2. Con esa contraseña, **verificar el aula en vivo en los dos idiomas**, que es
   la comprobación que quedó sin hacer.
3. Decidir sobre los 12 programas heredados del §8.5.
