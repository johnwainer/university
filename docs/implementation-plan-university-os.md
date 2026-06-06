# Plan de Implementación — Atlas Online University como "University Operating System"

> Origen: análisis de `gi.md` (research de SIS/CRM/LMS/HR/Contabilidad/Syllabus) mapeado
> sobre la plataforma actual (`apps/api` intermediador + Moodle + `apps/web`).
>
> **Decisiones tomadas (2026-06-06):**
> - Alcance: **Híbrido** — construir nativo SIS, CRM-lite, Syllabus y Compliance; integrar HR (Gusto/Deel) y Contabilidad (QuickBooks) vía conector; conservar Moodle como LMS.
> - Pagos: **Pasarela integrada (Stripe)** conciliada al ledger estudiantil.
> - LMS: **conservar Moodle** (no migrar a Canvas).

---

## 1. Síntesis funcional de `gi.md`

`gi.md` compara *vendors*, pero los requisitos reales son 6 dominios:

| Dominio | Vendor de referencia | Función esencial |
|---|---|---|
| SIS | Populi / Banner / Workday | Admisiones, expediente, matrícula, billing, transcript, degree audit, reporting |
| CRM | HubSpot / Slate / Element451 | Leads, pipeline de admisión, marketing, retención/early-alert, ticketing |
| LMS | Canvas (vs Moodle) | Cursos, CBE, autoaprendizaje, badges/certificados |
| HR/Payroll | Gusto / Deel | Empleados, nómina, beneficios |
| Contabilidad | QuickBooks | Facturación, libro mayor (GL), reportes |
| Syllabus | Simple Syllabus | Plantillas, compliance WCAG/ADA, archivo para acreditación |

## 2. Inventario de la plataforma actual

Fuentes: `apps/api/src/server.ts` (108 rutas), `apps/api/src/db.ts` (24 tablas), `apps/web`.

- **LMS** ✅ — Moodle integrado + sync (cursos, categorías, usuarios, matrículas), catálogo,
  contenido, progreso, interacciones. Tablas: `moodle_courses`, `moodle_categories`,
  `user_course_enrollments`, `public_course_progress`, `public_course_interactions`.
- **SIS (parcial)** 🟡 — `academic_terms`, `departments`, `degree_programs`, `student_enrollments`;
  endpoints `/v1/me/transcript` y `/v1/me/gpa`. **El esqueleto del SIS ya existe.**
- **B2B/Enterprise** ✅ — `companies`, `company_members`, grupos, asignación de cursos
  (`/v1/enterprise/*`, `/admin/companies/*`).
- **Monetización** ✅ — `offers`, `entitlements`.
- **OTT/Media** ✅ — `webinars`, `podcasts`.
- **Multi-tenant + auth** ✅ — `tenants`, auth admin (`.env`) y auth pública (`public_user_auth`).
- **Compliance anticipado** 🟡 — `.env` con `NCES_ID`, `IPEDS_CODE`, `FERPA_OFFICER_EMAIL`,
  `TITLE_IX_COORDINATOR_EMAIL`, `ADA_COORDINATOR_EMAIL`, `REGIONAL_ACCREDITOR`.
- **Integraciones** ✅ — tabla `integration_settings` (reutilizable para Stripe/QuickBooks/HubSpot/Gusto).

## 3. Gap analysis

| Dominio | Estado | Estrategia |
|---|---|---|
| LMS | ✅ Completo | Conservar Moodle; añadir CBE/badges dentro de Moodle |
| SIS | 🟡 Base hecha | **Construir nativo** (núcleo operativo) |
| CRM | 🔴 No existe | **Híbrido**: CRM-lite nativo + conector HubSpot |
| Syllabus | 🔴 No existe | **Construir nativo** (atado a cursos/degree programs) |
| Compliance | 🟡 Placeholders | **Construir** capa transversal (FERPA, IPEDS, WCAG) |
| HR/Payroll | 🔴 No existe | **Integrar** Gusto/Deel (no reinventar nómina) |
| Contabilidad | 🔴 No existe | **Integrar** QuickBooks (GL); billing nativo lo alimenta |
| Pagos | 🔴 No existe | **Stripe** integrado, conciliado al ledger |

## 4. Arquitectura objetivo

El intermediador (`apps/api`) es el **sistema de registro y orquestación**. Regla de oro
(runbook): *todo entra/sale por `apps/api`*. Tres categorías:

- 🟢 **Nativo**: SIS, CRM-lite, Syllabus, Compliance.
- 🔵 **Conector** (en `apps/api/src/integrations/`): Stripe, QuickBooks, HubSpot, Gusto/Deel.
- ⚪ **Abstraído**: Moodle (LMS).

Cada conector guarda credenciales/estado en `integration_settings` y expone webhooks/sync
siguiendo el patrón actual de Moodle.

## 5. Roadmap por fases

### Fase 1 — Núcleo SIS + Pagos Stripe (4–6 semanas) · *máximo valor, ya iniciado*

**Tablas nuevas:**
- `admissions_applications` (lead → aplicante → admitido → matriculado)
- `student_ledger` (cargos y abonos por estudiante)
- `invoices`, `payments` (con `stripe_payment_intent_id`, `stripe_invoice_id`)
- `financial_aid` (becas/ayudas aplicadas al ledger)
- `degree_requirements` (requisitos por `degree_programs`)
- `enrollment_holds` (bloqueos: deuda, académico, documentos)
- `academic_calendar` (fechas clave por `academic_terms`)

**Conector Stripe** (`apps/api/src/integrations/stripe.ts`):
- Crear `PaymentIntent`/`Invoice` desde un cargo del ledger.
- Webhook `/v1/webhooks/stripe` → concilia `payments` y libera `enrollment_holds`.
- Credenciales en `integration_settings`; claves en `.env` (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`).

**Rutas API:**
- `/admin/admissions/*` (CRUD aplicaciones, cambio de etapa)
- `/admin/students/:id/ledger`, `/admin/students/:id/degree-audit`
- `/v1/me/billing` (estado de cuenta del estudiante), `/v1/me/pay` (checkout Stripe)

**UI admin** (`apps/web/src/components/admin/views/`): `AdmissionsView`, `BillingView`,
`DegreeAuditView` (hoy solo existe `CompaniesView.tsx`).

### Fase 2 — CRM de admisión + retención (3–4 semanas)

**Tablas:** `crm_contacts`, `crm_pipeline_stages`, `crm_activities`, `early_alerts`.

Flujo lead → aplicante → matrícula que conecta `crm_contacts` con `admissions_applications`
y `student_enrollments`. Early-alerts disparados por progreso bajo (`public_course_progress`).

**Conector HubSpot** (`integrations/hubspot.ts`): sync bidireccional de contactos (opcional;
CRM-lite nativo es la fuente de verdad operativa).

### Fase 3 — Syllabus + Compliance (3–4 semanas)

**Tablas:** `syllabus_templates`, `syllabi` (versionados por curso/término),
`compliance_records`, `ferpa_access_log`.

- Plantillas con secciones obligatorias (ADA / Title IX / integridad académica) auto-pobladas
  desde `.env`.
- Audit log FERPA: registrar todo acceso admin a expedientes (`users`, `student_enrollments`).
- Reporting IPEDS/NCES exportable.
- WCAG 2.2 AA en la web pública.

### Fase 4 — Conectores HR + Contabilidad (2–3 semanas)

- `integrations/gusto.ts` — directorio de staff y nómina (read-only en admin).
- `integrations/quickbooks.ts` — push de `invoices`/`payments` al GL de QuickBooks.
- Mismo patrón que Moodle: settings en `integration_settings`, sync programado.

### Fase 5 — LMS avanzado + certificados (2 semanas)

CBE/competencias, badges y certificados verificables sobre Moodle; exponer en `/v1/me/transcript`.

## 6. Compliance US (capa transversal, continua)

- **FERPA**: control de acceso por rol + `ferpa_access_log` sobre datos de estudiante.
- **IPEDS/NCES**: reporting con los IDs de `.env`.
- **WCAG 2.2 AA**: accesibilidad en web pública y syllabi.
- **Acreditación**: archivo histórico versionado de `syllabi` y políticas.

## 7. Riesgos y decisiones abiertas

- **Stripe / PCI**: usar Stripe Checkout/Elements (Stripe maneja PCI); no almacenar PAN.
  Webhooks idempotentes y conciliación con el ledger.
- **HubSpot como fuente de verdad**: decidir si marketing vive en HubSpot o en CRM-lite.
- **Moodle vs Canvas**: el plan conserva Moodle; migrar sería un proyecto aparte.
- **Multi-tenant**: todas las tablas nuevas deben llevar `tenant_id` para no romper el aislamiento.

## 8. Orden de ejecución sugerido

1. Fase 1 (SIS + Stripe) — desbloquea cobro y operación académica real.
2. Fase 2 (CRM) — alimenta el embudo de matrícula.
3. Fase 3 (Syllabus + Compliance) — requisito de acreditación.
4. Fase 4 (HR + Contabilidad) — back-office.
5. Fase 5 (LMS avanzado) — diferenciación de producto.
