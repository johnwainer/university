# Atlas Online University — Propuesta Comercial y Distribución de Costos

> Valor total del proyecto: **USD $24,700**, llave en mano, incluyendo **3 meses de soporte y ajustes**.
> Para el detalle del activo ver `SALES_OVERVIEW.md` y `docs/TECHNICAL_INVENTORY.md`.

---

## 1. Resumen

| Concepto | Valor |
|---|---|
| **Precio total del proyecto (one-time)** | **USD $24,700** |
| Incluye | Código fuente completo, 5 módulos University OS, conectores, frontend, documentación, puesta en marcha y **3 meses de soporte y ajustes** |
| Soporte adicional (a partir del mes 4) | desde **USD $450/mes** (ver tiers en §4) |
| **Infraestructura (a cargo del comprador)** | Hosting AWS ~$80–$320/mes · Dominio ~$12–$169/año · Moodle open source $0 licencia (ver §5) |
| Modalidad de pago | **40% al inicio · 30% a la entrega de implementación · 30% a la aceptación/go-live** (ver §7) |
| Plazo de implementación | **~1 mes de implementación + 15 días de pruebas funcionales** (~6 semanas, ver §6) |

---

## 2. Distribución del precio (USD $24,700)

### 2.1 Activo y entrega (one-time) — $23,350

| # | Componente | Detalle | Valor |
|---|---|---|---|
| 1 | **Plataforma base / intermediador** | API Fastify (BFF + dominio), multi-tenant, auth admin + pública, catálogo, progreso, monetización (offers/entitlements), OTT (webinars/podcasts), B2B Enterprise | **$7,000** |
| 2 | **5 módulos University OS** | SIS (admisiones, ledger, billing, becas, degree audit, holds, calendario), CRM, Syllabus + Compliance, Backoffice (HR/Contabilidad), Credenciales (CBE/badges/certificados) | **$8,500** |
| 3 | **Conectores / integraciones** | Stripe (pagos + webhook), HubSpot, Gusto/Deel, QuickBooks (GL), sync Moodle con pruning | **$3,500** |
| 4 | **Frontend** | Web pública, portal estudiante "My University", panel admin con 6 vistas y dashboards, i18n ES/EN | **$2,500** |
| 5 | **Documentación + traspaso + puesta en marcha** | Runbook, inventario técnico, plan de fases, sesión de handoff y asistencia de instalación/despliegue | **$1,850** |
| | **Subtotal activo y entrega** | | **$23,350** |

### 2.2 Soporte y ajustes incluidos (3 meses) — $1,350

| Concepto | Detalle | Valor |
|---|---|---|
| **Soporte y ajustes — meses 1 a 3** | Nivel Estándar (ver §3), valorado a $450/mes × 3 | **$1,350** |

### **TOTAL: $23,350 + $1,350 = USD $24,700** ✅

---

## 3. Qué incluyen los 3 meses de soporte y ajustes

Criterio profesional: el periodo incluido cubre **garantía (corrección de defectos)** y **mantenimiento adaptativo menor** — todo lo necesario para dejar la plataforma operando a nombre del comprador. No incluye desarrollo nuevo (ver §3.2).

### 3.1 Incluido ✅
- **Garantía / corrección de bugs** del código entregado, sin costo.
- **Personalización de marca**: nombre, logos, colores, dominios, textos y emails de compliance (FERPA/Title IX/ADA).
- **Activación de conectores** con las credenciales del comprador: Stripe, HubSpot, Gusto/Deel, QuickBooks y token de Moodle (configuración y prueba).
- **Ajustes menores de contenido/UI**: catálogo, traducciones (ES/EN), imágenes, datos de demo/seed.
- **Ajuste de parámetros** de entorno (`.env`): intervalos de sync, TTLs de sesión, claves, IDs de compliance.
- **Asistencia de despliegue/instalación** y resolución de incidencias de entorno (Docker, base de datos, Moodle).
- **Actualizaciones menores de dependencias** y parches de seguridad.
- **Bolsa de hasta 6 horas/mes** de ajustes menores a discreción del comprador.
- **Canal de soporte** (email/mensajería acordada) con **SLA de respuesta de 1–2 días hábiles**.

### 3.2 No incluido (se cotiza aparte o vía tier Premium) ⛔
- Desarrollo de **nuevos módulos o funcionalidades** inexistentes.
- **Integraciones** con sistemas no contemplados en el alcance.
- **Migraciones de datos** masivas desde sistemas externos.
- **Rediseño completo** de UX/branding o cambio de arquitectura.
- **Migración de LMS** (p.ej. Moodle → Canvas).
- **Hosting / infraestructura productiva** y soporte 24/7 (puede cotizarse como servicio gestionado).

---

## 4. Soporte adicional a partir del mes 4 (valor de mercado)

**Referencia de mercado:** el estándar de la industria para mantenimiento y soporte de software es **15%–25% del valor del proyecto por año** (SOLTECH, LTS Group, Intigate, Galorath, 2026). Para un activo de $24,700 eso equivale a **~$309–$515/mes**. Los tiers siguientes se ubican dentro de ese rango.

| Tier | Mensual | Anualizado vs. $24,700 | Incluye |
|---|---|---|---|
| **Básico** | **$300/mes** | ~14.6%/año | Corrección de bugs, parches de seguridad, actualización de dependencias, SLA 2–3 días hábiles |
| **Estándar (recomendado)** | **$450/mes** | ~21.9%/año | Todo lo de Básico + ajustes menores (bolsa 6 h/mes) + soporte de configuración/conectores + SLA 1–2 días hábiles |
| **Premium** | **$750/mes** | ~36.4%/año | Todo lo de Estándar + bolsa 14 h/mes para mejoras/desarrollo menor + soporte prioritario (SLA mismo día hábil) |

**Opciones:**
- **Prepago anual:** 10% de descuento (p.ej. Estándar $450 → **$405/mes** facturado anual = $4,860/año).
- **Trabajo fuera de alcance / por demanda:** **$50/hora** (estimación previa y aprobación del comprador).
- El tier puede cambiarse mes a mes; el periodo incluido (meses 1–3) equivale al tier **Estándar**.

---

## 5. Costos recurrentes a cargo del comprador (infraestructura externa)

Estos costos **no forman parte de los $24,700** ni se pagan al proveedor: son servicios de terceros que el comprador contrata y paga directamente (AWS, registrador de dominio). Se listan para que la operación tenga un costo total de propiedad transparente. La **instalación y configuración inicial** de toda esta infraestructura está incluida en la puesta en marcha (§2.1, ítem 5).

### 5.1 Hosting en AWS (pago directo a Amazon, mensual)

Arquitectura sugerida: cómputo para la API + web (Atlas), cómputo para **Moodle**, base de datos **PostgreSQL** (Atlas) y **MariaDB** (Moodle), caché **Redis**, almacenamiento/CDN/transferencia y backups. Modelo **pago por uso**: el costo crece con la matrícula y el tráfico.

| Escenario | Estimado mensual | Notas |
|---|---|---|
| **Arranque lean** (~100–400 estudiantes) | **~$80–$130/mes** | Instancias pequeñas, servicios co-ubicados, sin alta disponibilidad |
| **Crecimiento** (~500–1,000 estudiantes) | **~$180–$320/mes** | RDS/ElastiCache gestionados, balanceador, CloudFront, backups reforzados |

> Referencias de mercado 2026: un Moodle pequeño en producción sobre AWS ronda **$24–$34/mes** y un sitio pequeño EC2+RDS ~**$51/mes**; nuestro stack corre **ambas piezas** (plataforma Atlas + Moodle), de ahí el rango combinado. Cifras estimadas; el costo real depende de tráfico, almacenamiento y región. Se recomienda activar **AWS Budgets** y empezar con instancias reservadas/Savings Plans para optimizar.

### 5.2 Dominio (pago directo al registrador, anual)

**Recomendación: comprarlo en AWS (Amazon Route 53)** si el hosting ya está en AWS — así dominio + DNS quedan en la misma cuenta, con un solo proveedor/factura, certificado (ACM) y conexión automática a la infraestructura. Route 53 soporta cientos de TLDs (incluidos `.university`, `.education`, `.org`, `.com`, `.academy`).

> ⚠️ **`.edu` NO se puede registrar en Route 53** (ni en registradores comerciales): es exclusivo de **EDUCAUSE** y requiere acreditación en EE. UU.

**Dónde comprar — opciones recomendadas:**

| Registrador | Cuándo conviene |
|---|---|
| **AWS Route 53** (recomendado) | Si el hosting está en AWS: integración nativa con DNS/ACM, una sola factura. + ~$0.50/zona-mes de DNS (~$6/año) |
| **Cloudflare Registrar** | Precio at-cost (sin sobreprecio) + DNS/CDN/SSL gratis; ideal si se usa Cloudflare delante de AWS |
| **Namecheap** | Económico, soporta `.education`/`.university`, privacidad WHOIS gratis |
| **Squarespace Domains** (ex-Google) / **GoDaddy** | Alternativas reputadas y fáciles de gestionar |
| **EDUCAUSE** | Único camino para un `.edu` (si la institución califica) |

**Costo anual por opción de TLD (referencia 2026):**

| Opción | Costo anual aprox. | Idoneidad |
|---|---|---|
| **`.edu`** (solo vía EDUCAUSE) | **~$77–$169/año** | Más prestigioso pero **restringido** a instituciones acreditadas en EE. UU. |
| **`.university`** | **~$60–$70/año** (Route 53) | Claramente académico; disponible sin restricción |
| **`.education`** | **~$20–$40/año** | Académico, más económico que `.university` |
| **`.edu.co` / `.edu.mx`** (ccTLD educativo) | **variable** | Requiere acreditación en el país correspondiente |
| **`.org` / `.com`** | **~$12–$25/año** | Opción neutra y económica para arranque |

> **Sugerencia práctica:** para una universidad nueva for-profit, comprar **`.university`** o **`.education`** en **Route 53** (mismo AWS) y, de obtenerse la acreditación, gestionar luego un `.edu` con EDUCAUSE. Reservar también el `.com` defensivo y redirigirlo. SSL es gratis vía AWS ACM o Let's Encrypt.

### 5.3 Moodle (LMS open source)

- **Licencia: $0.** Moodle es software libre (GPL); no tiene costo de licencia.
- Se instala **self-hosted en el servidor AWS** del comprador (incluido en el cómputo de §5.1).
- La **instalación, configuración de Web Services/REST y conexión con la API** están incluidas en la puesta en marcha (§2.1).
- Único costo asociado: el cómputo/almacenamiento de AWS donde corre (ya contemplado arriba).

### 5.4 Resumen de costo recurrente de infraestructura (a cargo del comprador)

| Concepto | Costo |
|---|---|
| Hosting AWS | ~$80–$320/mes (según etapa) |
| Dominio | ~$12–$169/año (según TLD elegido) |
| Moodle (open source) | $0 de licencia (corre sobre el hosting) |
| **(Opcional) Soporte mensual del proveedor** | desde $450/mes (§4) |

---

## 6. Plan de implementación (~6 semanas)

El producto ya está construido; la implementación consiste en **desplegar, personalizar, integrar y validar** la plataforma para el comprador. Duración: **~1 mes (4 semanas) de implementación + 15 días de pruebas funcionales** ≈ 6 semanas hasta go-live.

| Fase | Días | Actividades | Entregable |
|---|---|---|---|
| **0 · Kickoff** | Días 1–2 | Firma, **pago 40%**, accesos (AWS, dominio, credenciales de conectores), definición de marca y alcance de personalización | Acta de inicio + entornos creados |
| **1 · Infraestructura** | Semana 1 | Provisión AWS (cómputo, PostgreSQL, MariaDB, Redis, S3/CDN), dominio en Route 53 + SSL (ACM), despliegue de API + web, **instalación de Moodle** y Web Services/REST | Plataforma desplegada en AWS, accesible por dominio |
| **2 · Configuración y marca** | Semana 2 | Branding (logos, colores, textos, emails de compliance), i18n ES/EN, tenant, catálogo inicial, IDs de compliance (FERPA/IPEDS/NCES) en `.env` | Plataforma con identidad del comprador |
| **3 · Conectores e integraciones** | Semana 3 | Stripe (test→live + webhook), HubSpot, Gusto/Deel, QuickBooks, sincronización Moodle (cursos/categorías/usuarios) | Integraciones activas y verificadas |
| **4 · Datos, contenido y capacitación** | Semana 4 | Carga de programas/cursos/usuarios, syllabi y certificados; sesión de **capacitación** del equipo admin; documentación de operación. **Pago 30% (entrega de implementación)** | Sistema operativo + equipo capacitado |
| **5 · Pruebas funcionales / UAT** | Días 31–45 (15 días) | Ejecución del plan de pruebas end-to-end, corrección de incidencias, regresión, prueba de carga ligera, checklist de aceptación | Reporte de pruebas + aceptación firmada |
| **Go-live** | Fin semana 6 | Puesta en producción, monitoreo inicial. **Pago final 30% (aceptación/go-live)** → inicia el periodo de **3 meses de soporte incluido** | Plataforma en producción |

### 6.1 Alcance de las pruebas funcionales (15 días)

Se valida end-to-end cada dominio antes de la aceptación:
- **Auth y portal:** registro/login público y admin, perfil, sesiones.
- **Catálogo y LMS:** catálogo, vista de curso, consumo de módulos, **progreso** e interacciones, sync Moodle.
- **SIS:** admisiones (cambio de etapa), ledger, facturación, becas, holds, degree audit, calendario.
- **Pagos:** estado de cuenta, **checkout Stripe**, webhook (conciliación + liberación de holds).
- **CRM:** contactos, pipeline, actividades, early alerts.
- **Syllabus/Compliance:** plantillas, publicación, audit log FERPA, reporte IPEDS.
- **Credenciales:** competencias, badges, emisión de certificados, **verificación pública**.
- **B2B Enterprise:** empresas, colaboradores, paquetes y asignación de cursos.
- **Transversal:** i18n ES/EN, responsive/móvil, accesibilidad WCAG, multi-tenant, backups y monitoreo.

### 6.2 Hitos de pago (40 / 30 / 30)

| Hito | % | Monto | Momento |
|---|---|---|---|
| 1 · Kickoff | **40%** | **$9,880** | A la firma / inicio |
| 2 · Entrega de implementación | **30%** | **$7,410** | Fin de Fase 4 (sistema configurado e integrado, antes de pruebas) |
| 3 · Aceptación / go-live | **30%** | **$7,410** | Fin de pruebas funcionales + aceptación |
| | **100%** | **$24,700** | |

---

## 7. Supuestos y notas

- Precios en **USD**, no incluyen impuestos locales que pudieran aplicar.
- El comprador provee las **credenciales y cuentas** de los servicios externos (Stripe, HubSpot, Gusto/Deel, QuickBooks) y su propia instancia de **Moodle** y de **hosting**.
- El soporte se presta de forma **remota**, en horario hábil, por el canal acordado.
- El plazo de **~6 semanas** asume que el comprador entrega los **accesos** (AWS, dominio, credenciales de conectores) y los **contenidos** en el kickoff; retrasos en su entrega corren el cronograma.
- Los **3 meses de soporte incluido** comienzan a partir del **go-live/aceptación**.
- La garantía de corrección de defectos aplica sobre el código **tal como se entrega**; cambios hechos por terceros sobre el código pueden afectar su cobertura.
- Esta propuesta tiene **validez de 30 días** desde su emisión.
