# Plan de capacitación — Etapas I y II

El contrato incluye capacitación en las dos etapas y la describe así:

- **Etapa I** (Anexo 1 §4): «Guías de gestión de usuarios, cursos, contenido y
  backups. Una a dos sesiones para administradores.»
- **Etapa II** (Anexo 1 §4): «Guía operativa de admisiones, sílabos y
  calendario, y sesión de entrenamiento diferenciada para personal
  administrativo y para docentes.»

Las guías escritas están entregadas. Este documento es el guion de las sesiones
en vivo: qué se cubre, cuánto dura, qué hace falta tener listo antes y qué debe
quedar demostrado al final. Son tres sesiones. Sólo falta que TFU fije las
fechas.

---

## Antes de cualquier sesión

Sin esto, la sesión se convierte en una demostración y no en un entrenamiento,
porque los asistentes no pueden hacer los ejercicios:

| Requisito | Quién lo entrega | Por qué |
|---|---|---|
| Una cuenta de administrador por asistente | TFU | Nadie aprende mirando a otro teclear. |
| Cuenta de administrador de Moodle | TFU | La sesión 1 y la 3 entran al aula. |
| Un programa real con su curso en Moodle | TFU | Los ejercicios se hacen sobre un curso de verdad, no sobre un ejemplo. |
| Servidor de correo (SMTP) configurado | TFU | Sin él no se puede demostrar el envío de avisos; se mostrará el registro sin envío. |
| Sala con proyección y conexión | TFU | — |

Cada sesión se graba y la grabación queda con TFU.

---

## Sesión 1 — Administración de la plataforma

**Para:** administradores del sistema. **Duración:** 2 h.
**Material:** `guia-administrador.md`.
**Corresponde a:** entregable de capacitación de la Etapa I.

| Bloque | Min | Qué se hace |
|---|---|---|
| Las tres piezas y quién manda sobre qué | 15 | Portal, panel y Moodle. La regla del espejo: el curso se crea en Moodle, el portal lo refleja. |
| Usuarios | 25 | Crear una cuenta, matricularla en un curso, desactivarla. Diferencia entre usuario del portal y usuario de Moodle. |
| Cursos y categorías | 25 | Sincronizar desde Moodle, revisar qué llegó, corregir lo que el portal gobierna (portada, duración, textos). |
| Contenido del sitio | 20 | Editar una página institucional en los dos idiomas desde el panel y verla publicada. |
| Repositorio de compliance | 20 | Cargar un documento, asignarlo a un programa, ver cómo cambia el semáforo del checklist CIE. |
| Respaldos y qué hacer si algo se cae | 15 | Dónde está la copia diaria, cómo se comprueba que corrió, a quién se escribe. |

**Queda demostrado al final.** El asistente ha creado un usuario, lo ha
matriculado, ha sincronizado Moodle, ha editado una página en español e inglés
y ha subido una evidencia que movió el checklist.

---

## Sesión 2 — Admisiones y expedientes

**Para:** personal administrativo y de admisiones. **Duración:** 1 h 30.
**Material:** `guia-admisiones-y-expedientes.md`.
**Corresponde a:** mitad administrativa del entregable de la Etapa II.

| Bloque | Min | Qué se hace |
|---|---|---|
| El recorrido de una postulación | 15 | De dónde llega, qué ve el aspirante, qué código recibe. |
| Trabajar la bandeja | 25 | Abrir una postulación, moverla de etapa, dejar nota. Qué significa cada etapa y quién la mueve. |
| Mensajes de contacto | 15 | Dónde caen los mensajes del formulario, cómo se responden, cómo se enlazan con una postulación. |
| Expediente del estudiante | 25 | Qué contiene, qué se edita, qué llega solo desde Moodle. |
| Qué NO se hace todavía | 10 | Facturación, estado de cuenta y pagos son Etapa III: a dónde se deriva mientras tanto. |

**Queda demostrado al final.** El asistente ha movido una postulación de etapa,
ha respondido un mensaje de contacto y ha encontrado el expediente de un
estudiante matriculado.

---

## Sesión 3 — Facultad: sílabos y aulas

**Para:** docentes y dirección de programa. **Duración:** 2 h.
**Material:** `guia-facultad-silabos-y-aulas.md`.
**Corresponde a:** mitad docente del entregable de la Etapa II.

| Bloque | Min | Qué se hace |
|---|---|---|
| El Master Syllabus como formulario | 20 | Las 24 secciones y los tres tratamientos: qué se hereda, qué se escribe y qué valida el sistema. |
| Redactar un sílabo | 40 | Diligenciar las siete secciones con validación sobre un curso real: instructor, CLO, recursos, evaluación, aula, IA, acuse. |
| Por qué no deja publicar | 20 | Provocar a propósito los cuatro bloqueos —pesos distintos de 100 %, componente por encima del 30 %, CLO sin evaluación, IA sin diligenciar— y resolverlos. |
| Publicar | 15 | El acto único y sus tres destinos. Ver el sílabo en el catálogo público y dentro del aula de Moodle. Versionado: qué pasa al republicar. |
| Calendario y cadencia | 25 | La malla de ocho semanas, los tres plazos semanales, la apertura del viernes y el corte del jueves. Qué desplaza un festivo. |
| Aulas listas | 20 | Leer el punto de control, entender un aviso abierto y cerrarlo completando el aula. |

**Queda demostrado al final.** El docente ha publicado un sílabo que antes el
sistema rechazaba, lo ha visto en el catálogo y en su aula, y ha cerrado un
aviso de aula no lista.

---

## Acta de aceptación

La Cláusula 11 obliga a TFU a «revisar y aceptar por escrito cada entregable de
etapa conforme al checklist de aceptación aplicable». Este es ese checklist.

### Etapa I

- [ ] El sitio público responde en las 23 direcciones, en español e inglés.
- [ ] Moodle está en pie, con marca TFU y las aulas cerradas a quien no está matriculado.
- [ ] Existen los dos cursos modelo con la estructura del Master Syllabus.
- [ ] El panel administrativo permite gestionar usuarios y ver cursos y programas.
- [ ] El repositorio de compliance acepta documentos, expedientes de faculty y evidencia.
- [ ] El checklist documental muestra el estado por programa con semáforo.
- [ ] El formulario de contacto captura y los mensajes llegan al panel.
- [ ] SSL vigente, copia de seguridad diaria verificada y roles de administrador definidos.
- [ ] El repositorio Git privado está entregado y accesible.
- [ ] Guías entregadas y sesión 1 impartida.

Aceptado por: ____________________  Fecha: ____________

### Etapa II

- [ ] Una postulación recorre el flujo de admisiones de principio a fin y devuelve código de seguimiento.
- [ ] El expediente del estudiante y la vista *My University* muestran sus datos.
- [ ] El portal del estudiante da acceso a cursos y progreso, en los dos idiomas.
- [ ] La sincronización con Moodle trae cursos, categorías, usuarios y matrículas.
- [ ] El catálogo público filtra y muestra el detalle de cada curso.
- [ ] Un sílabo recorre las 24 secciones, es rechazado por una validación, se corrige y se publica.
- [ ] El sílabo publicado aparece en el catálogo, en el aula de Moodle y en el repositorio de compliance.
- [ ] La exportación del sílabo produce PDF etiquetado y HTML accesible.
- [ ] El calendario genera la malla de ocho semanas con sus tres plazos por semana.
- [ ] Un festivo desplaza los plazos afectados.
- [ ] El punto de control de aulas listas abre un aviso y lo cierra al completarse el aula.
- [ ] Guías entregadas y sesiones 2 y 3 impartidas.

Aceptado por: ____________________  Fecha: ____________
