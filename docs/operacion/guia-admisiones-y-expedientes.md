# Guía de admisiones y expedientes — personal administrativo

Etapa II. Esta guía es para quien atiende postulaciones, mantiene expedientes y
responde a un estudiante que pregunta «¿en qué va mi solicitud?».

No cubre el sílabo ni el calendario del aula: eso es la
[guía de facultad](./guia-facultad-silabos-y-aulas.md).

---

## 0. Por dónde entra una persona

Hay dos puertas, y conviene no confundirlas:

| Puerta | Quién la usa | A dónde llega |
|---|---|---|
| **Formulario público** `/admisiones` | El propio interesado | Crea la postulación y devuelve un código `TFU-XXX-XXX-XXX` |
| **Panel → CRM / Admisión** | El personal | Crea o edita la postulación a mano |

El formulario público es el camino normal. El panel se usa cuando la
postulación llega por otra vía —una llamada, una feria, un correo— y hay que
registrarla.

> **El código de seguimiento es lo único que el interesado necesita.** Con él
> consulta su estado en la misma página de admisiones, sin cuenta y sin
> contraseña. No devuelve datos personales: sólo la etapa, el programa y la
> fecha de la última actualización. Si alguien pide por teléfono «dime los
> datos de la solicitud», el código no sirve para eso y es a propósito.

### Si el interesado perdió el código

No hay recuperación automática, también a propósito: un buscador por correo
electrónico abierto al público permitiría comprobar quién ha postulado. Se
localiza desde el panel, en CRM / Admisión, buscando por correo, y se le
devuelve el código por un canal en el que ya esté identificado.

---

## 1. Las etapas y qué significa cada una

| Etapa | Qué pasó | Qué toca hacer |
|---|---|---|
| `inquiry` | Llegó la postulación | Revisar que el programa pedido existe y está activo |
| `application` | Expediente en revisión | Pedir y adjuntar documentación |
| `review` | Documentación completa | Decisión académica |
| `accepted` | Admitido | Crear usuario y matricular |
| `rejected` | No admitido | Cerrar con motivo |
| `enrolled` | Matriculado | Ya es estudiante: pasa a expedientes |

Mover una etapa se hace en el panel, en la ficha de la postulación. Cada cambio
queda con fecha; la consulta pública del interesado refleja la nueva etapa en
cuanto se guarda.

### Lo que NO hace el sistema solo

- **No decide.** No hay admisión automática por nota ni por programa.
- **No envía correos.** Mientras TFU no entregue credenciales SMTP y cree los
  buzones institucionales, ningún aviso sale del sistema. Lo que hay es el
  registro: el panel dice a quién habría que avisar y con qué texto. Avisar al
  interesado es, hoy, una acción manual.
- **No crea el usuario al aceptar.** Hay que hacerlo en el paso siguiente.

---

## 2. De admitido a estudiante

Tres pasos, en este orden:

1. **Crear el usuario** — Panel → Usuarios → Crear. El correo es la identidad;
   usa el institucional si ya lo tiene.
2. **Matricular en el programa** — Panel → SIS / Académico → Matrículas. Esto
   es lo que le da expediente, no el alta de usuario.
3. **Matricular en los cursos** — Panel → Cursos, o en Moodle. La
   sincronización lleva la matrícula a Moodle; no hace falta repetirla allí.

Después de los tres, el estudiante entra en **Mi Universidad** y ve su
expediente, sus cursos y su progreso.

> **El orden importa.** Un usuario sin matrícula de programa entra al portal
> pero no tiene expediente, y la pantalla sale vacía sin explicar por qué. Si
> alguien reporta eso, lo primero que hay que mirar es el paso 2.

---

## 3. Expedientes y datos personales

### Qué se puede ver y quién

El acceso al expediente de un estudiante queda registrado. No es una
formalidad: FERPA obliga a poder decir quién consultó qué y cuándo, y el
registro está en Panel → Cumplimiento → Registro FERPA.

Consecuencia práctica: **no se consulta un expediente «por curiosidad»**. Cada
consulta deja rastro con tu correo.

### Qué no se guarda

El sistema no guarda, y no debe guardar por un campo libre:

- Número de la seguridad social ni documentos de identidad.
- Datos de tarjeta o cuenta bancaria.
- Información de salud.

Si una postulación llega con alguno de estos datos en el campo de
antecedentes, se elimina del texto antes de archivar.

### Correcciones

Un estudiante tiene derecho a pedir la corrección de su expediente. El cambio
se hace en el panel, en su ficha. No se borra el valor anterior de la historia:
lo que se guarda es el estado vigente, y el registro de acceso deja constancia
de cuándo se tocó.

---

## 4. Problemas frecuentes

| Síntoma | Causa casi siempre | Arreglo |
|---|---|---|
| «Mi código no aparece» | Se teclea sin guiones o con minúsculas | El código es `TFU-ABC-DEF-GHI`, en mayúsculas |
| Postulación duplicada | El interesado envió dos veces | Cerrar la segunda como `rejected` con motivo «duplicada» y conservar la primera |
| «No me deja postular» | Límite de 3 postulaciones por hora desde la misma conexión | Esperar, o registrarla desde el panel |
| El programa no sale en el desplegable | Está inactivo en Panel → SIS → Programas | Activarlo, o corregir el programa de la postulación |
| Estudiante entra y no ve nada | Falta la matrícula de programa | Paso 2 de la sección 2 |

---

## 5. Lo que depende de TFU

Estas cosas no las puede resolver el panel; están pendientes de la
institución:

- **Buzones institucionales** (`admissions@`, `info@`, `ferpa@`, `titleix@`,
  `accessibility@`) y credenciales SMTP. Sin ellos no hay avisos automáticos.
- **Textos institucionales** de la página de Admisiones: requisitos reales,
  plazos, costes. Lo que hay hoy es la estructura, no los datos.
- **Las tres políticas** (FERPA, Title IX, accesibilidad) adoptadas
  formalmente. El portal las publica desde Panel → Páginas en cuanto TFU
  entregue el texto aprobado.
