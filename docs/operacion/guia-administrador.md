# Guía del administrador — The Floridian University

Etapa I. Cubre las cuatro áreas que exige el entregable de documentación del
contrato: **usuarios, cursos, contenido y respaldos**.

Está escrita contra el despliegue real, no contra una instalación genérica: los
nombres de servicio, rutas y pantallas son los que vas a encontrar.

---

## 0. Las tres piezas y quién manda sobre qué

| Pieza | Dónde | Para qué |
|---|---|---|
| **Portal** | `portal.thefloridianuniversity.com` | Lo que ve el público y el estudiante. |
| **Panel admin** | `portal.thefloridianuniversity.com/admin` | Donde se administra todo lo del portal. |
| **Moodle (aula)** | `lms.portal.thefloridianuniversity.com` | Donde ocurre la clase: contenido, entregas, calificaciones. |

La regla que conviene tener clara desde el principio:

> **El catálogo del portal es un espejo de Moodle.** Un curso se crea y se edita
> en Moodle; el portal lo refleja. Lo que NO se refleja —imagen de portada,
> duración oficial, textos del catálogo— se gestiona en el portal.

Nunca se edita la base de datos a mano. Todo pasa por el panel o por Moodle.

---

## 1. Usuarios

### 1.1 Estudiantes

**Alta.** El estudiante se registra desde el portal (botón *Iniciar sesión →
Crear cuenta*). No hay que darlo de alta a mano.

**Ver quién hay.** Panel admin → pestaña **Usuarios**. Muestra correo, idioma,
fecha de alta y cursos matriculados.

**Matricular.** La matrícula se hace **en Moodle**, en el curso correspondiente
(*Participantes → Matricular usuarios*). El portal la recoge en la siguiente
sincronización y a partir de ahí el estudiante ve el curso en *Mis cursos*.

**Si un estudiante dice que no ve su curso:** casi siempre es que la matrícula
está en Moodle pero aún no se sincronizó. Panel admin → **Integraciones →
Sincronizar cursos**. Si después de eso sigue sin verlo, revisa que el curso
esté **visible** en Moodle: un curso oculto desaparece del catálogo a propósito.

### 1.2 Administradores

El panel admin usa **una sola cuenta**, definida en el entorno del servidor
(`ADMIN_EMAIL` / `ADMIN_PASSWORD`). No se crea desde la interfaz.

Para cambiarla hay que editar `/opt/plataforma-estudiantil/api/shared/.env` en
la instancia de la API y reiniciar el servicio:

```bash
sudo nano /opt/plataforma-estudiantil/api/shared/.env   # ADMIN_PASSWORD=...
pm2 restart atlas-api --update-env
```

> El servicio **no arranca** si `ADMIN_API_KEY` o `ADMIN_PASSWORD` faltan. Es
> deliberado: antes tenían un valor por defecto y el fallo era silencioso.

**Administradores de Moodle** son aparte y se gestionan dentro de Moodle
(*Administración del sitio → Usuarios*).

### 1.3 Quién puede ver qué

- Las rutas `/admin/*` de la API exigen credenciales de administrador.
- Un estudiante sólo accede al contenido de los cursos en los que tiene
  **matrícula activa**. La API lo comprueba en cada petición, y lo mismo con los
  ficheros del aula: sólo se sirven los del material que ese estudiante puede
  ver.

---

## 2. Cursos

### 2.1 Crear un curso

1. En **Moodle**: *Administración del sitio → Cursos → Añadir un curso*.
2. Rellena **nombre completo** y **nombre corto**. El nombre corto es la clave
   con la que el portal identifica el curso: conviene seguir el patrón existente
   (`PCL-AREA-NOMBRE`).
3. Elige la **categoría**. Las categorías son las áreas que se ven como etiqueta
   en el catálogo.
4. En el portal: **Integraciones → Sincronizar cursos**.

### 2.2 Curso bilingüe

Moodle guarda los dos idiomas en el mismo campo con el marcado del filtro
*multilang*, que ya está activo:

```
{mlang en}Sales Excellence{mlang}{mlang es}Excelencia en Ventas{mlang}
```

Vale para el nombre y para el resumen. El alumno ve sólo su idioma.

> **Aviso importante.** El portal **no** lee ese texto de Moodle para los trece
> programas de Peregrine: el web service de Moodle aplica los filtros antes de
> responder y devuelve un solo idioma. Para esos cursos, el título y el resumen
> del catálogo viven en
> `apps/api/src/catalog/peregrine-catalog.ts`, junto con la imagen y la
> duración. Cambiar el texto del catálogo de uno de esos programas requiere
> tocar ese archivo y desplegar. Para cualquier curso nuevo que no esté en ese
> mapa, el portal sí usa lo que diga Moodle.

### 2.3 Estructura del aula

Los cursos **PCL-SALES-EXC** y **PCL-EDU-WALK** son los shells de muestra: ocho
semanas, cada una con lecturas, foro de discusión y entrega, con la cadencia del
Master Syllabus (semana de martes a lunes, cierre a las 11:59 p.m. del Este).

Para montar esa misma estructura en otro curso, desde la instancia de Moodle:

```bash
sudo php /var/www/cli/aula-modelo.php NOMBRE-CORTO
```

Es idempotente: si el curso ya tiene actividades, no lo toca.

### 2.4 Retirar un curso

**Ocúltalo, no lo borres.** En Moodle, *Configuración del curso → Visibilidad →
Ocultar*. El portal lo retira del catálogo en la siguiente sincronización y
conserva matrículas y calificaciones. Un curso borrado en Moodle se lleva todo
eso por delante y no hay vuelta atrás.

---

## 3. Contenido

### 3.1 Páginas institucionales

Panel admin → **Contenido / Páginas**. Son siete: Quiénes somos, Admisiones,
Términos, Privacidad, FERPA, Título IX y Accesibilidad. Cada una tiene título y
cuerpo en español e inglés.

El cuerpo admite HTML sencillo: `<p>`, `<h3>`, `<ul>`, `<ol>`, `<strong>`,
`<a href>`. No hace falta tocar nada más: el cambio se ve de inmediato, sin
desplegar.

> Los textos actuales son un punto de partida redactado con un criterio
> explícito: **no afirman acreditación, licencia, antigüedad ni tamaño de la
> institución**, porque son datos que sólo TFU puede confirmar. Las políticas
> (FERPA, Título IX, ADA) están en su forma estándar y **necesitan revisión y
> adopción formal de TFU** antes de la presentación ante la CIE.

### 3.2 Eventos en vivo y podcasts

Panel admin → **Webinars** y **Podcasts**.

Para un evento: título, subtítulo, descripción, imagen, fecha y hora con su
**zona horaria**, y el enlace de registro. El portal calcula solo si el evento
está *próximo*, *en directo* o *grabado*.

La traducción al inglés se guarda en columnas aparte. Si la dejas vacía, el
portal muestra el texto en español en lugar de un hueco.

### 3.3 Catálogo

El catálogo no se edita: es el espejo de Moodle. Lo que sí se controla desde el
portal es la imagen de portada y la duración, en
`apps/api/src/catalog/peregrine-catalog.ts` (ver 2.2).

---

## 4. Respaldos

### 4.1 Qué hay montado

| Qué | Dónde | Cuándo | Retención |
|---|---|---|---|
| Base de Moodle + moodledata + config | Instancia Moodle, `/var/backups/moodle` | 03:15 UTC diario | 7 días |
| Base PostgreSQL de la API | Instancia API, `/var/backups/api` | 03:40 UTC diario | 7 días |
| Snapshots de disco | AWS Lightsail | Según la política de la consola | Según la consola |

Los volcados lógicos y los snapshots cubren cosas distintas: el snapshot
restaura la máquina entera, el volcado permite recuperar **una tabla o un curso**
sin tocar el resto.

### 4.2 Comprobar que se están haciendo

```bash
# API
systemctl list-timers tfu-api-backup.timer
sudo ls -la /var/backups/api/

# Moodle
systemctl list-timers tfu-moodle-backup.timer
sudo ls -la /var/backups/moodle/
```

Si el listado no tiene un archivo con la fecha de hoy o de ayer, algo falló:

```bash
sudo systemctl status tfu-api-backup.service
journalctl -u tfu-api-backup.service --since '2 days ago'
```

### 4.3 Restaurar

**API (PostgreSQL).** Restaura siempre primero en una base de pruebas, nunca
directamente sobre la de producción:

```bash
gzip -dc /var/backups/api/api-2026-10-08.dump.gz > /tmp/api.dump
pg_restore --list /tmp/api.dump | head          # ver qué contiene
createdb atlas_restore
pg_restore --no-owner --no-acl -d atlas_restore /tmp/api.dump
```

Para recuperar sólo una tabla, `--table=nombre`.

**Moodle.** Base y ficheros van juntos; restaurar sólo uno de los dos deja el
sitio inconsistente:

```bash
gzip -dc /var/backups/moodle/db-2026-10-08.sql.gz | mysql -u USUARIO -p BASE
sudo tar -xzf /var/backups/moodle/moodledata-2026-10-08.tar.gz -C /var/moodledata
sudo php /var/www/moodle/admin/cli/purge_caches.php
```

### 4.4 Lo que el respaldo no cubre

- **La SPA del portal** vive en el bucket de Lightsail y se reconstruye desde el
  repositorio Git; no necesita respaldo.
- **Los secretos** (`.env`) se copian dentro del respaldo de Moodle (`config.php`)
  pero **no** en el de la API. Guarda una copia de
  `/opt/plataforma-estudiantil/api/shared/.env` fuera del servidor, en el gestor
  de contraseñas de la institución.
- Los respaldos **viven en la misma máquina** que los datos. Para cumplir con una
  política seria de continuidad conviene sacarlos a S3 con versionado; queda
  recomendado, no está montado.

---

## 5. Mantenimiento corriente

| Tarea | Frecuencia | Cómo |
|---|---|---|
| Comprobar que los respaldos corren | Semanal | §4.2 |
| Revisar el checklist CIE | Semanal | Panel → CIE |
| Revisar mensajes del formulario | Diaria | Panel → CIE → Mensajes |
| Actualizaciones de seguridad del SO | Mensual | `sudo apt update && sudo apt upgrade` |
| Actualización de Moodle | Según publique Moodle | Respaldar antes, siempre |
| Renovación de certificados | Automática | `certbot.timer`; verificar con `sudo certbot certificates` |

### Si algo se cae

```bash
pm2 list                      # ¿está viva la API?
pm2 logs atlas-api --lines 50 # ¿qué dice?
pm2 restart atlas-api
sudo systemctl status nginx
curl -s -o /dev/null -w '%{http_code}\n' https://api.portal.thefloridianuniversity.com/api/health
```

Un `health` que devuelve 200 y un portal que no carga apuntan al CDN o al
bucket, no a la API.
