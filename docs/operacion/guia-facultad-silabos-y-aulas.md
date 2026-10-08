# Guía de facultad — sílabos, calendario y aula

Etapa II. Esta guía es para quien da clase y para coordinación académica. Cubre
tres cosas que van juntas: **redactar el sílabo, entender el calendario y tener
el aula lista a tiempo**.

Lo administrativo —postulaciones, matrículas, expedientes— está en la
[guía de admisiones](./guia-admisiones-y-expedientes.md).

---

## 0. La regla que ordena todo lo demás

> El **Master Syllabus de TFU** manda sobre cualquier otra descripción. Son 24
> secciones, y no todas son tuyas.

Las 24 se reparten en dos grupos:

| Grupo | Cuántas | Quién escribe |
|---|---|---|
| **Heredadas de la institución** | 17 | TFU. Salen igual en todos los cursos y no se editan desde el curso. |
| **Con forma y validación** | 7 | Tú, dentro de las reglas que el sistema comprueba. |

Las siete que te toca rellenar:

1. **Información del instructor** (§1)
2. **Resultados de aprendizaje y su evaluación** (§3)
3. **Recursos de aprendizaje** (§5)
4. **Calificación y evaluación** (§7)
5. **Calendario del curso** (§8)
6. **Estándar de inteligencia artificial** (§14)
7. **Acuse de recibo del estudiante** (§24)

Que una sección sea heredada no es un permiso que falta: es que la política es
de la institución, y reescribirla por curso rompería la coherencia que el
acreditador va a revisar. Si una sección heredada está mal, el camino es
pedirle a TFU que la corrija, y el cambio aparece en todos los sílabos.

---

## 1. Redactar el sílabo

**Panel → Cumplimiento → Syllabus → Editar las 24 secciones.**

A la izquierda están las secciones, agrupadas por quién escribe. Un punto rojo
marca lo que impide publicar; uno ámbar, un aviso que no impide.

El editor guarda borradores a medias a propósito: un sílabo se escribe en
varias sesiones. Lo que no se puede es *publicar* uno incompleto.

### Lo que el sistema comprueba antes de dejarte publicar

| Regla | De dónde sale |
|---|---|
| Cada resultado de aprendizaje tiene su evaluación asociada | §3 |
| Los pesos suman exactamente 100% | §7 |
| Ninguna pieza de evaluación pasa del 30% | §7 |
| El nivel del curso está definido | §7 — es lo que fija el mínimo de aprobación |
| El estándar de IA está elegido de la lista | §14 |
| Nombre y correo del instructor | §1 |
| Si hay calendario, tiene ocho semanas | §8 |

Los pesos arrancan con los institucionales (15 / 25 / 20 / 20 / 20) y se pueden
mover «alrededor de las barandillas» del calendario maestro, mientras la suma y
el tope se respeten. El botón **Usar los pesos institucionales** los devuelve.

El **mínimo de aprobación** no se elige: lo aplica el sistema según el nivel.

| Nivel | Mínimo |
|---|---|
| Grado | D |
| Posgrado | **B** |
| Grado por transferencia | C |

Esto resuelve, a propósito, la ambigüedad entre la escala —donde la C es una
nota válida— y el mínimo de posgrado.

### Publicar

**Publicar** hace tres cosas en un solo acto:

1. Marca el sílabo como vigente y sube su versión.
2. Escribe en el aula de Moodle un bloque con el enlace al sílabo accesible.
3. Deja el registro en el repositorio de cumplimiento.

Si algo del punto 2 falla, el sílabo **sigue publicado** y el panel dice qué no
llegó. No se revierte una publicación válida por un problema de Moodle.

> **Por qué el aula recibe un enlace y no el documento copiado.** El sílabo
> cambia de versión; una copia pegada en Moodle envejece sin avisar. El enlace
> siempre resuelve a la versión vigente. Escribirlo dentro de la página
> «Sílabo» de la sección 0 requiere funciones del servicio web de Moodle que
> esta instalación no expone; está anotado como pendiente técnico.

### Exportar

Una vez publicado, dos botones:

- **HTML accesible** — la versión canónica, conforme a WCAG 2.1 AA.
- **PDF etiquetado** — generado desde ese mismo HTML, con la estructura
  incrustada para lectores de pantalla. Si el servidor no tiene el motor de
  impresión disponible, el botón responde con un mensaje claro y el HTML sigue
  sirviendo: no hay versión degradada silenciosa.

---

## 2. El calendario del aula

**Panel → Calendario y aulas.**

Un periodo de TFU son **ocho semanas de martes a lunes**. Los tres plazos
semanales, todos a las **23:59 ET**:

| Plazo | Día |
|---|---|
| Respuesta inicial a la discusión | **Martes** |
| Respuestas a compañeros | **Jueves** |
| Entrega semanal | **Lunes** |

> Ojo con esto: la intuición dice jueves y sábado. El Master Syllabus §10 dice
> **martes y jueves**, y es lo que el sistema aplica.

La semana entrante se **abre el viernes anterior**, para que el estudiante
pueda ir por delante.

### Festivos

La capa de festivos es institucional y está en la misma pantalla. Cuando se
añade o se quita uno, **se regeneran las mallas de todos los periodos activos**,
no sólo la que estés mirando: un festivo desplaza el plazo afectado al día
siguiente, salvo cuando ya cae en el cierre del lunes.

Un festivo no se borra, se desactiva. Así una malla pasada sigue explicando por
qué tenía una fecha corrida.

Cada regeneración sube la **revisión** de la malla. Si un curso de Moodle tiene
una revisión anterior, es que sus fechas están viejas: **Propagar fechas a
Moodle** las pone al día.

---

## 3. Punto de control de aulas listas

§8: **el aula debe estar lista el jueves a las 10:00 ET antes del martes en que
empieza la clase.**

El sistema lo comprueba solo, todos los días, y mira que la sección de la
semana entrante exista y tenga al menos el **foro de discusión** y la
**entrega**.

Tres estados:

| Estado | Qué significa |
|---|---|
| **lista** | La semana entrante está montada |
| **pendiente** | Falta algo y el corte todavía no ha pasado |
| **vencida** | El corte pasó y sigue incompleta |

Un aula que se completa cierra su aviso sola, con fecha. Un aviso no se duplica
por comprobar diez veces.

### Quién recibe el aviso

El instructor —del expediente de faculty del programa, o de quien tenga rol
docente en Moodle— y la dirección de programa.

> **Hoy los avisos se registran pero no se envían.** No hay credenciales SMTP
> ni buzones institucionales, así que el panel muestra el aviso, a quién habría
> que avisar y el texto, y lo marca como «registrado, sin enviar». Es
> deliberado: un «enviado» falso es peor que un «pendiente» verdadero. El día
> que TFU entregue SMTP, el envío se activa con una variable de entorno y nada
> más cambia.

Si un aviso sale **sin destinatario resoluble**, el panel dice por qué: falta el
expediente de faculty del programa, falta un profesor con rol docente en el
curso de Moodle, o falta la dirección de respaldo de coordinación académica.

### La estructura de la semana

Las aulas modelo dejan montadas, por semana:

- **Recursos de aprendizaje** — no cuenta como asistencia
- **Foro de discusión** — cuenta
- **Punto de control y reflexión** — cuenta
- **Entrega** — cuenta

Y en la sección 0: **Contacto** y **Sílabo**.

De las ocho asignaciones del curso, entre cuatro y seis van sobre el material.
La semana 1 cuenta la biografía del estudiante y la 8 la reflexión final. La
pieza más exigente no se asigna más tarde del **lunes de la semana 7**.

---

## 4. Problemas frecuentes

| Síntoma | Causa | Arreglo |
|---|---|---|
| «No me deja publicar» y no veo por qué | El panel de bloqueos está arriba, plegado | Los puntos rojos del índice llevan a la sección exacta |
| Los pesos suman 100 y aún se queja | Hay una categoría propia además de las cinco | Se admite, pero la suma incluye la tuya: revisa el total del pie de tabla |
| El PDF da error y el HTML no | El motor de impresión no está disponible en el servidor | Usa el HTML; el PDF vuelve sin tocar el sílabo |
| El aula sale «no lista» y yo la veo montada | El rol del servicio web no ve ese tipo de actividad | Reportar: es permisos en Moodle, no contenido tuyo |
| Las fechas del aula no cuadran con el panel | Se regeneró la malla y el curso tiene una revisión vieja | **Propagar fechas a Moodle** |
| Cambié un festivo y no veo el efecto | La malla se regeneró, pero la pantalla no | **Ver malla existente** |

---

## 5. Lo que depende de TFU

- **SMTP y buzones institucionales** — sin ellos no hay avisos automáticos.
- **Los textos de las 17 secciones heredadas** que todavía están vacías. El
  sílabo publicado omite una sección heredada sin texto en vez de sacar un
  encabezado huérfano, así que no rompe nada, pero falta.
- **Expedientes de faculty** asociados a cada programa: son los que resuelven a
  quién avisa un aula no lista.
