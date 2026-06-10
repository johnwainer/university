# Atlas Online University — Resumen de Venta

> Dossier ejecutivo del activo. Para detalle técnico ver `docs/TECHNICAL_INVENTORY.md`;
> para operación ver `PROJECT_RUNBOOK.md`; para el plan de fases ver
> `docs/implementation-plan-university-os.md`.

---

## 1. Qué es

**Atlas Online University** es una plataforma **"University Operating System" (OTT + LMS)** lista para operar una universidad online (enfocada en reskilling de adultos). No es solo un LMS: es la capa de orquestación que **unifica los 6 dominios funcionales de una universidad** en un solo sistema, con Moodle como backoffice académico abstraído.

**Una frase:** Atlas reemplaza un stack de 5–6 SaaS (SIS + CRM + Syllabus + HR/Payroll + Contabilidad + Pagos) con módulos **nativos**, más **conectores opcionales** a los vendors líderes para quien ya los use.

---

## 2. Propuesta de valor / por qué se vende

- **Sustituye gasto recurrente alto.** El stack tradicional equivalente (SIS por estudiante + CRM + plataforma de syllabus + nómina + contabilidad + pasarela de pago) cuesta **~$32k–$140k+/año** según volumen de matrícula. Atlas lo internaliza en un solo sistema.
- **Diseñado para crecer.** Cloud-native, multi-tenant y modelo de datos preparado para escalar de cientos a miles de estudiantes sin migraciones.
- **Time-to-market.** Plataforma funcional, con datos demo, documentación operativa y typecheck limpio. Se levanta en local en minutos (Docker + 2 comandos).
- **Sin lock-in y portable.** Regla de oro: todo pasa por la API intermediadora; el LMS está abstraído y es reemplazable sin tocar el frontend.
- **Bilingüe (ES/EN) y mobile-friendly** desde el día uno: vendible a operadores en LATAM, US y mercados mixtos; ideal para profesionales adultos.
- **Compliance US incorporado** (FERPA, IPEDS/NCES, WCAG, Title IX/ADA) — diferenciador real frente a un LMS genérico.

---

## 3. Dominios que cubre la plataforma

Atlas implementa los seis dominios que necesita una universidad online. Para cada uno se tomó una decisión **híbrida**: construir nativo el núcleo operativo, integrar vía conector lo que no conviene reinventar (nómina/contabilidad) y conservar el LMS.

| Dominio | Referencia de mercado | Decisión | Estado |
|---|---|---|---|
| SIS | Populi / Banner / Workday | Nativo | ✅ Módulo `sis` + Stripe |
| CRM | HubSpot / Slate / Element451 | Nativo + conector | ✅ Módulo `crm` + HubSpot |
| LMS | Canvas / Moodle / Google Workspace | Conservar Moodle | ✅ Integración + sync + pruning |
| Syllabus | Simple Syllabus | Nativo | ✅ Módulo `syllabus` |
| HR / Payroll | Gusto / Deel | Conector | ✅ Gusto (US) + Deel (global) |
| Contabilidad | QuickBooks | Conector | ✅ QuickBooks (GL) |
| Pagos | Stripe | Nativo | ✅ Conciliado al ledger |
| Compliance US | FERPA / IPEDS / WCAG / ADA | Capa transversal | ✅ Audit log + reporting |

---

## 4. Cobertura funcional detallada

### SIS — Student Information System (nativo)
- Admisiones con embudo completo: **lead → aplicante → admitido → matriculado → rechazado**.
- Expediente académico, **transcript** y **GPA** del estudiante.
- **Billing**: ledger estudiantil (cargos/abonos), facturación e **integración de pagos**.
- **Ayuda financiera / becas** (scholarship, grant, work-study) aplicadas al ledger.
- **Degree audit** contra requisitos por programa (créditos, GPA mínimo, cursos obligatorios).
- **Holds / bloqueos** (financiero, documentos, académico) con liberación.
- **Calendario académico** por término (clases, exámenes, recesos, graduación).
- **Portal self-service** del estudiante (expediente, cuenta, pagos, certificados).
- Multi-tenant, cloud, escalable por volumen de matrícula.

### CRM — Admisión y retención (nativo + conector HubSpot)
- **Leads / contactos** con fuente, lead score y estado; vínculo lead → estudiante.
- **Pipeline** de etapas de admisión configurable (Lead, Contacted, Application, Admitted, Enrolled, Lost).
- **Actividades** por contacto (nota, email, llamada, tarea).
- **Early alerts / detección de riesgo** (baja participación, calificación baja, inactividad, saldo pendiente) con severidad y resolución — base de **retención**.
- Sync opcional de contactos con HubSpot (marketing/automatización).

### LMS + Educación basada en competencias (Moodle + módulo de credenciales)
- Moodle como LMS: cursos, módulos/actividades, **progreso** e interacciones, sincronizados.
- **CBE**: competencias por programa/curso y **progreso por estudiante** (not started / in progress / mastered).
- **Badges** e **insignias** ligadas a competencias.
- **Certificados verificables** con verificación pública por código (para empleadores).
- Self-paced, mobile-responsive; outcomes expuestos en el transcript.

### Syllabus + Compliance (nativo)
- **Plantillas** con secciones obligatorias (objetivos, política de calificación, **integridad académica, ADA, Title IX**) auto-pobladas desde configuración institucional.
- **Syllabi versionados** por curso/término, con estado y **publicación**.
- **Repositorio centralizado** y archivo histórico para **acreditación**.
- **Accesibilidad WCAG** en web pública y syllabi (multi-formato web/mobile).

### HR / Payroll (conector Gusto + Deel)
- **Directorio de staff** (empleados y contractors, por país/rol/tipo).
- **Gusto** para nómina/beneficios US; **Deel** para hires globales / contractors / EOR.
- Sincronización vía conector siguiendo el patrón de integraciones.

### Contabilidad (conector QuickBooks)
- **Push de invoices y payments** al libro mayor (GL) de QuickBooks.
- **Log de sincronización** y estado de la integración consultables en admin.

### Pagos (Stripe, nativo)
- Estado de cuenta y **checkout/pago** del estudiante.
- **Webhook** idempotente que concilia pagos contra el ledger y **libera holds** automáticamente.
- Stripe gestiona PCI (Checkout/Elements); no se almacenan datos de tarjeta.

### Compliance US (capa transversal)
- **FERPA**: control de acceso por rol + **audit log** de accesos a expedientes.
- **IPEDS / NCES**: reporting exportable con los identificadores institucionales.
- **WCAG**: accesibilidad en web y syllabi. **Title IX / ADA**: registros y secciones de política.
- **Acreditación**: archivo versionado de syllabi y registros de cumplimiento.

### Plataforma base (ya existente)
- Monetización (**offers / entitlements**), OTT (**webinars / podcasts**), **B2B Enterprise** (empresas, colaboradores, paquetes de cursos, asignaciones), **multi-tenant** y autenticación admin + pública.

---

## 5. Hechos técnicos (para el comprador técnico)

| Métrica | Valor |
|---|---|
| Stack | Fastify 5 / React 19 / PostgreSQL / Moodle / Stripe / i18next |
| Endpoints | 165 (106 core + 59 módulos) |
| Tablas | 47 (25 core + 22 módulos) |
| Conectores | 5, todos con degradación elegante (la app corre sin credenciales) |
| Idiomas | ES / EN (392 claves c/u) |
| Salud | **typecheck limpio** en api/web/shared |
| Arranque | Docker Compose + `npm run dev` |

Detalle completo: `docs/TECHNICAL_INVENTORY.md`.

---

## 6. Qué se entrega

- Código fuente completo (monorepo) con los 5 módulos + conectores + frontend + portal estudiante.
- **Documentación:** `PROJECT_RUNBOOK.md` (operación/onboarding), `docs/TECHNICAL_INVENTORY.md` (due diligence), `docs/implementation-plan-university-os.md` (plan de fases), `docs/admin-api.md`, `docs/moodle-integration.md`, `README.md`.
- `docker-compose.yml` + `.env.example` documentado (incluye todas las variables de conectores y compliance).
- Seed de datos demo idempotente para mostrar la plataforma end-to-end.

---

## 7. Estado y polish reciente

**Hecho y verificado:** 5 módulos University OS, portal estudiante, rebrand completo a Atlas, catálogo Moodle universitario, catálogo bilingüe, seed demo, typecheck limpio.

**Pulido de presentación aplicado en esta revisión:**
1. Branding: header con marca **Atlas**, footer/emails de compliance a `@atlas.edu`, strings de UI rebrandeadas (ES/EN) — se preserva "My University" (portal) y "Atlas Online University" (nombre legal).
2. Eliminados los prefijos visibles `[DEMO]` del contenido sembrado; idempotencia del seed conservada con marcadores **no visibles** (claves demo por FK/código).
3. Podcasts genéricos reemplazados por contenido **Atlas** (códigos de video verificados).
4. Carrusel "Continue Learning" ahora respeta el idioma (aplica `localizeAsset`).
5. Sync de Moodle ahora **poda** cursos/assets eliminados upstream (con guarda anti-borrado si Moodle devuelve vacío).

**Notas para el comprador:** Moodle se entrega como LMS (reemplazable). Las credenciales de los conectores externos (Stripe/HubSpot/Gusto/QuickBooks) son del comprador y se activan vía `.env`.

---

## 8. Pitch de una línea

> Atlas Online University: un "University OS" listo para operar que unifica SIS, CRM, Syllabus/Compliance, credenciales CBE, HR y contabilidad sobre Moodle, con pagos Stripe nativos, compliance US, multi-tenant y bilingüe — reemplazando un stack SaaS de $32k–$140k+/año, con arquitectura limpia y código que compila sin errores.
