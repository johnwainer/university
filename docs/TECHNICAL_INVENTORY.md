# Atlas Online University — Inventario Técnico (Due Diligence)

> Documento de referencia exhaustivo para evaluación técnica / traspaso del activo.
> Generado a partir del código fuente. Estado: typecheck limpio en los 3 workspaces.
> Convenciones: API expuesta bajo `/api` (Fastify `rewriteUrl`). LMS = Moodle (abstraído).

## 1. Resumen

| Métrica | Valor |
|---|---|
| Arquitectura | Monorepo npm workspaces (`apps/*`, `packages/*`) |
| Backend | Fastify 5 + TypeScript + Zod + PostgreSQL (`pg`) |
| Frontend | React 19 + Vite 6 + i18next (ES/EN) + Recharts |
| LMS | Moodle (Docker, Web Services REST) |
| Endpoints HTTP | **165** (106 core + 59 módulos University OS) |
| Tablas PostgreSQL | **47** (25 core + 22 módulos University OS) |
| Conectores externos | 5 (Moodle, Stripe, HubSpot, Gusto/Deel, QuickBooks) |
| Variables de entorno | 33 (10 core + 2 Moodle + 8 identidad/compliance + 12 conectores + 1 otro) |
| LOC | ~11.4k API · ~12k Web |
| Idiomas UI | Español / Inglés (392 claves c/u) |

## 2. Estructura del monorepo

```
apps/
  api/   Fastify BFF + dominio + integraciones + persistencia
    src/
      server.ts          Bootstrap + 106 endpoints core
      db.ts              Esquema core (25 tablas) + seed base + sync Moodle
      moodle.ts          Cliente Moodle Web Services
      config.ts          Carga de configuración/env
      architecture.ts    Metadatos de arquitectura (/v1/blueprint)
      integrations/      Conectores: stripe, hubspot, gusto, quickbooks
      modules/           University OS (5 módulos self-contained)
        sis/ crm/ syllabus/ backoffice/ credentials/
          schema.ts      migrateX(pool) — CREATE TABLE IF NOT EXISTS
          routes.ts      registerXRoutes(app, ctx)
      scripts/           seed-demo.ts, populate-moodle-demo-content-docker.ts
  web/   React (pública + admin + portal estudiante)
    src/
      components/
        PublicApp.tsx         Web pública + portal estudiante
        AdminApp.tsx          Panel admin (núcleo + nav de módulos)
        StudentAcademics.tsx  "My University" (portal estudiante)
        EnterpriseGroupManager.tsx
        admin/views/          SisView, CrmView, ComplianceView,
                              BackofficeView, CredentialsView, CompaniesView
      locales/                en.json, es.json
      i18n.ts
packages/shared/   Tipos/contratos canónicos (@atlas/shared)
docs/              Documentación funcional/técnica
infra/             Config auxiliar (PHP/Moodle local)
docker-compose.yml PostgreSQL, Redis, Adminer, Moodle, MariaDB
```

## 3. Patrón de módulos (University OS)

Cada dominio nativo es self-contained en `apps/api/src/modules/<nombre>/`:
- `schema.ts` exporta `migrateX(pool)` con `CREATE TABLE IF NOT EXISTS` (idempotente).
- `routes.ts` exporta `registerXRoutes(app, ctx)`.
- Cableado en `server.ts`: migraciones tras `initDb()`, rutas antes de `app.listen()`.
- Vista admin en `apps/web/src/components/admin/views/<Modulo>View.tsx`, montada en `AdminApp.tsx`.

**Regla de oro:** ningún frontend consume Moodle ni servicios externos directo; todo entra/sale por `apps/api`.

## 4. Inventario de endpoints

### 4.1 Core — Públicas v1 (`apps/api/src/server.ts`)

```
GET    /health
GET    /v1/blueprint            Metadatos de arquitectura
GET    /v1/home                 Home (rows dinámicos, continue-learning)
GET    /v1/catalog              Catálogo
GET    /v1/catalog/:slug        Detalle de curso
GET    /v1/courses/:id/content  Contenido (módulos Moodle)
GET    /v1/courses/:id/progress · PUT /v1/courses/:id/progress
POST   /v1/courses/:id/modules/:moduleId/complete
POST   /v1/courses/:id/modules/:moduleId/respond
GET    /v1/courses/:id/interactions
POST   /v1/auth/register · POST /v1/auth/login
GET    /v1/auth/me · PATCH /v1/auth/me
GET    /v1/me/courses · GET /v1/me/transcript · GET /v1/me/gpa
GET    /v1/webinars · GET /v1/podcasts
GET    /v1/offers · GET /v1/entitlements
GET    /v1/terms · GET /v1/degrees
GET    /v1/media/demo.mp4 · GET /v1/moodle/file
```

### 4.2 Core — Enterprise B2B (público autenticado)

```
GET    /v1/enterprise/overview
GET    /v1/enterprise/groups · POST · PUT/:groupId · DELETE/:groupId
POST   /v1/enterprise/groups/:groupId/courses/:moodleCourseId · DELETE
POST   /v1/enterprise/members · PATCH /:userId/status
GET    /v1/enterprise/members/:userId/groups · POST · DELETE
GET    /v1/enterprise/members/:userId/courses · POST · DELETE
PUT/DELETE /v1/enterprise/courses/:moodleCourseId
```

### 4.3 Core — Admin (`/admin`, auth Bearer o `x-admin-key`)

```
POST   /admin/auth/login · GET /admin/auth/me · POST /admin/auth/logout
GET    /admin/status · /admin/routes · /admin/config
GET    /admin/tenants · POST /admin/tenants
GET    /admin/users · POST · GET /:userId/courses
POST   /admin/users/:userId/enrollments · PATCH /:userId/status · POST /status/bulk
GET    /admin/departments · POST   |  GET /admin/degree-programs · POST
GET    /admin/terms · POST
GET    /admin/moodle/status · /config (GET/PUT) · /courses · /categories · /users
POST   /admin/moodle/sync/{courses,categories,users,all,enterprise}
GET    /admin/webinars · POST · PATCH/:id · DELETE/:id
GET    /admin/podcasts · POST · PATCH/:id · DELETE/:id
# Companies B2B (CRUD completo: empresa, miembros, cursos, grupos/paquetes, asignaciones, stats)
GET/POST/PATCH/DELETE /admin/companies[...]  (28 rutas)
```

### 4.4 Módulo SIS (`modules/sis/routes.ts`)

```
GET    /admin/admissions · POST · PATCH/:id · PATCH/:id/stage
GET    /admin/students/:id/ledger · POST
GET    /admin/students/:id/degree-audit
GET    /admin/invoices · POST
GET    /admin/holds · POST · PATCH/:id/release
GET    /v1/me/billing            (estado de cuenta del estudiante)
POST   /v1/me/pay                (checkout Stripe)
POST   /v1/webhooks/stripe       (conciliación + liberación de holds)
```

### 4.5 Módulo CRM (`modules/crm/routes.ts`)

```
GET    /admin/crm/pipeline
GET    /admin/crm/contacts · POST · PATCH/:id · PATCH/:id/stage · DELETE/:id
GET    /admin/crm/contacts/:id/activities · POST
GET    /admin/crm/early-alerts · POST · PATCH/:id/resolve
```

### 4.6 Módulo Syllabus + Compliance (`modules/syllabus/routes.ts`)

```
GET    /admin/syllabus/templates · POST · PATCH/:id · DELETE/:id
GET    /admin/syllabi · POST · PATCH/:id · POST/:id/publish
GET    /admin/compliance/records · POST · PATCH/:id
GET    /admin/compliance/ferpa-log · POST
GET    /admin/compliance/ipeds-report      (reporting IPEDS/NCES)
```

### 4.7 Módulo Backoffice — HR + Contabilidad (`modules/backoffice/routes.ts`)

```
GET    /admin/hr/staff · POST · POST /admin/hr/sync          (Gusto/Deel)
GET    /admin/accounting/status · POST /admin/accounting/sync (QuickBooks GL)
```

### 4.8 Módulo Credenciales (`modules/credentials/routes.ts`)

```
GET    /admin/competencies · POST · PATCH/:id · DELETE/:id
GET    /admin/badges · POST · DELETE/:id
GET    /admin/students/:id/competencies · POST
POST   /admin/certificates/issue · GET /admin/certificates
GET    /v1/me/certificates · GET /v1/me/competencies
GET    /v1/verify/:verificationCode        (verificación pública de certificados)
```

## 5. Inventario de tablas (PostgreSQL)

### 5.1 Core (25 — `apps/api/src/db.ts`)

| Dominio | Tablas |
|---|---|
| Multi-tenant / auth | `tenants`, `users`, `public_user_auth` |
| Catálogo / LMS | `content_assets`, `moodle_courses`, `moodle_categories`, `user_course_enrollments`, `public_course_progress`, `public_course_interactions` |
| Académico (base SIS) | `academic_terms`, `departments`, `degree_programs`, `student_enrollments` |
| Monetización | `offers`, `entitlements` |
| OTT / media | `webinars`, `podcasts` |
| B2B Enterprise | `companies`, `company_members`, `company_course_access`, `company_course_groups`, `company_course_group_items`, `company_member_courses`, `company_member_groups` |
| Integraciones | `integration_settings` |

### 5.2 University OS (22 — `apps/api/src/modules/*/schema.ts`)

| Módulo | Tablas |
|---|---|
| **sis** | `admissions_applications`, `student_ledger`, `invoices`, `payments`, `financial_aid`, `degree_requirements`, `enrollment_holds`, `academic_calendar` |
| **crm** | `crm_pipeline_stages`, `crm_contacts`, `crm_activities`, `early_alerts` |
| **syllabus** | `syllabus_templates`, `syllabi`, `compliance_records`, `ferpa_access_log` |
| **backoffice** | `staff_directory`, `gl_sync_log` |
| **credentials** | `competencies`, `badges`, `student_competency_progress`, `certificates` |

## 6. Integraciones / conectores

Todos viven en `apps/api/src/integrations/` (salvo Moodle). **Degradan elegantemente**: si faltan credenciales devuelven `{ configured: false }` en lugar de fallar; la app arranca sin ninguna.

| Conector | Archivo | Activación (env) | Función |
|---|---|---|---|
| **Moodle** (LMS) | `moodle.ts` + `db.ts` | `MOODLE_BASE_URL`, `MOODLE_TOKEN` | Sync cursos/categorías/usuarios/matrículas; contenido; **pruning** de cursos eliminados |
| **Stripe** (pagos) | `integrations/stripe.ts` | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | PaymentIntent/Invoice desde ledger; webhook concilia y libera holds |
| **HubSpot** (CRM) | `integrations/hubspot.ts` | `HUBSPOT_ACCESS_TOKEN` | Upsert/list de contactos (sync opcional) |
| **Gusto / Deel** (HR) | `integrations/gusto.ts` | `GUSTO_ACCESS_TOKEN` / `DEEL_API_TOKEN` | Directorio de staff / nómina |
| **QuickBooks** (GL) | `integrations/quickbooks.ts` | `QBO_ACCESS_TOKEN`, `QBO_REALM_ID` | Push de invoices/payments al libro mayor |

## 7. Variables de entorno (33)

Ver `.env.example` para la lista comentada y agrupada. Categorías:
- **Core (10):** `HOST`, `PORT`, `ADMIN_API_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_SESSION_TTL_MINUTES`, `AUTO_SYNC_INTERVAL_SEC`, `PUBLIC_SYNC_MAX_AGE_SEC`, `PUBLIC_SESSION_TTL_MINUTES`, `DATABASE_URL`.
- **Moodle (2):** `MOODLE_BASE_URL`, `MOODLE_TOKEN`.
- **Identidad/Compliance (8):** `INSTITUTION_NAME`, `NCES_ID`, `IPEDS_CODE`, `REGIONAL_ACCREDITOR`, `STATE_AUTHORIZATION_ID`, `FERPA_OFFICER_EMAIL`, `TITLE_IX_COORDINATOR_EMAIL`, `ADA_COORDINATOR_EMAIL`.
- **Conectores (12):** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `HUBSPOT_ACCESS_TOKEN`, `GUSTO_ACCESS_TOKEN`, `GUSTO_COMPANY_ID`, `GUSTO_API_BASE_URL`, `DEEL_API_TOKEN`, `DEEL_API_BASE_URL`, `QBO_ACCESS_TOKEN`, `QBO_REALM_ID`, `QBO_API_BASE_URL`, `QBO_MINOR_VERSION`.
- **Otros:** `DEMO_VIDEO_PATH`.

## 8. Frontend

| Superficie | Componente | Contenido |
|---|---|---|
| Web pública | `PublicApp.tsx` | Landing, slider, rows dinámicos, catálogo+filtros, curso/módulos, progreso, tickets, perfil, empresas. Bilingüe. Responsive. |
| Portal estudiante | `StudentAcademics.tsx` | "My University": expediente+GPA, billing+pago Stripe, certificados+verificación, competencias |
| Panel admin | `AdminApp.tsx` | Núcleo (status, rutas, usuarios, cursos, conexiones/sync Moodle, webinars/podcasts) + 6 vistas de módulos |
| Vistas de módulos | `admin/views/*` | `SisView`, `CrmView`, `ComplianceView`, `BackofficeView`, `CredentialsView`, `CompaniesView` (dashboards Recharts) |

## 9. Operación

- **Arranque local:** ver `PROJECT_RUNBOOK.md` (guía maestra) y `README.md`.
- **Puertos:** API `4000`, Web `5174`, Moodle `8081`, Adminer `8080`, PostgreSQL `65432`, Redis `6379`.
- **Seed demo:** `npx tsx apps/api/src/scripts/seed-demo.ts` — datos demo idempotentes en las 8 secciones (scoping por claves demo no visibles; sin prefijos `[DEMO]` en texto de cara al usuario).
- **Typecheck:** `npm run check` (limpio en api/web/shared).
- **Build:** `npm run build`.

## 10. Compliance (capa transversal)

- **FERPA:** control de acceso por rol + `ferpa_access_log` (audit de accesos a expedientes).
- **IPEDS/NCES:** reporting exportable (`/admin/compliance/ipeds-report`) con IDs de `.env`.
- **WCAG 2.x AA:** accesibilidad en web pública y syllabi.
- **Acreditación:** archivo histórico versionado de `syllabi` y `compliance_records`.
- **Stripe/PCI:** Stripe maneja PCI (Checkout/Elements); no se almacenan PANs; webhooks idempotentes.

## 11. Decisiones de arquitectura que no romper

1. La API intermediadora es la fuente de verdad operativa; Moodle es backoffice académico, no frontend.
2. Toda integración externa nueva entra por `apps/api` (patrón conector + `integration_settings`).
3. Toda tabla nueva lleva `tenant_id` (aislamiento multi-tenant).
4. Toda feature pública nueva queda administrable en `/admin` cuando aplique.
5. No dejar artefactos compilados (`.js/.jsx`) en carpetas de fuente `.tsx` (Vite los prioriza).
