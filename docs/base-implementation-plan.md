# Documento Base: Implementación OTT + LMS SaaS

## 1. Sección ejecutiva

### 1.1 Visión del producto
Atlas Online University es una plataforma SaaS OTT multi-tenant, bilingüe (`es/en`), orientada a combinar distribución de contenido multimedia, e-learning y monetización digital sobre una arquitectura cloud-native en AWS. Moodle actúa como backoffice principal para la operación académica y administrativa, mientras una API intermedia protege a los clientes y desacopla la evolución del ecosistema.

### 1.2 Alcance del MVP
El MVP cubre:
- frontend web en React
- API intermedia versionada `/v1`
- catálogo OTT con `VoD`, `live` y cursos
- integración futura con Moodle mediante modelo canónico externo
- suscripción, compra puntual, cupones y códigos
- entitlements por usuario/tenant/dispositivo
- interactividad on-screen básica
- operación multi-tenant con branding y reglas por tenant
- observabilidad, CI/CD y despliegue target en AWS

### 1.3 Capacidades clave
- Moodle-first para cursos, progreso, matrículas y administración operativa
- experience API para web, mobile y TV
- catálogo unificado de learning + OTT
- pipeline de reproducción HLS con overlays interactivos
- billing y monetización desacoplados del LMS
- datos, permisos y marca aislados por tenant

### 1.4 Roadmap
- Fase 0: dominio, arquitectura, vendors, seguridad
- Fase 1: AWS base, identidad, API, integración Moodle inicial
- Fase 2: web MVP operativo
- Fase 3: interactividad, notificaciones, dashboards
- Fase 4: mobile + Android TV + tvOS
- Fase 5: expansión SaaS y autoservicio de tenants

### 1.5 Riesgos principales
- sobrecargar Moodle con capacidades OTT que no modela bien
- acoplamiento fuerte si los frontends consumen estructuras nativas de Moodle
- complejidad multi-tenant prematura sin modelo canónico estable
- dependencia temprana de proveedores de media sin abstracción propia
- combinatoria de reglas de acceso si no existe un servicio de entitlements unificado

## 2. Sección técnica

### 2.1 Arquitectura objetivo
Capas principales:
1. `apps/web`: frontend React web.
2. `apps/api`: BFF / API intermedia.
3. `packages/shared`: contratos canónicos y tipos compartidos.
4. `Moodle`: backoffice académico y administrativo.
5. servicios externos: identidad, pagos, media, analytics, mensajería.

Flujo objetivo:
`Client` -> `API /v1` -> `Domain services` -> `Moodle + Stripe + Media + Analytics + Messaging`

### 2.2 Modelo de dominio canónico
Entidades base:
- `Tenant`
- `UserProfile`
- `ContentAsset`
- `Course`
- `LiveEvent`
- `Offer`
- `Entitlement`
- `InteractiveEvent`

Decisión estructural:
- el canal digital nunca usa directamente tipos internos de Moodle
- el dominio externo se expresa con contratos propios y estables
- los adaptadores traducen entre Moodle y el modelo canónico

### 2.3 Integración con Moodle
Responsabilidades reservadas a Moodle:
- cursos, módulos, lecciones, evaluaciones
- progreso y estados académicos
- grupos, matrículas, parte editorial y administración operativa

Responsabilidades fuera de Moodle:
- catálogo OTT de alto volumen
- playback, media metadata y reglas por dispositivo
- pagos, suscripciones y conciliación
- multi-tenancy, branding y feature flags
- analytics unificados e interactividad de video

Patrón recomendado:
- adaptador Moodle en la API o en un servicio de integración dedicado
- sincronización por jobs/webhooks
- ids externos persistentes para evitar dependencia de ids internos del LMS

### 2.4 API intermedia
La API debe cubrir:
- autenticación/autorización
- composición de catálogo learning + OTT
- offers y checkout
- entitlements efectivos
- progreso visible al usuario
- blueprint de capacidades multi-plataforma

Endpoints base implementados en esta fundación:
- `GET /health`
- `GET /v1/home`
- `GET /v1/catalog`
- `GET /v1/catalog/:slug`
- `GET /v1/offers`
- `GET /v1/entitlements`
- `GET /v1/blueprint`

### 2.5 Estrategia frontend
La web actúa como cliente de referencia y prueba de contrato.

Módulos visibles en la fundación:
- hero/tenant context
- catálogo
- comercio
- blueprint de plataformas
- modelo Moodle backoffice
- eventos interactivos

Principio para siguientes clientes:
- mobile y TV reutilizan contratos, semántica de sesión, entitlements y taxonomía analítica
- la lógica compartida debe moverse gradualmente a SDKs reutilizables y no a componentes visuales forzados

### 2.6 Seguridad y operación
Lineamientos fijados:
- ningún frontend consume Moodle directo
- versionado `/v1`
- aislamiento por tenant como requisito de dominio
- secretos y configuración externa por ambiente
- logs, métricas y trazabilidad por servicio

Infra local base incluida:
- PostgreSQL
- Redis

Infra cloud objetivo:
- CloudFront
- ALB
- ECS Fargate
- RDS PostgreSQL
- ElastiCache Redis
- S3
- SQS/SNS/EventBridge
- CloudWatch
- WAF
- Secrets Manager

## 3. Entregables base en este repositorio
- `apps/api`: API intermedia inicial con datos de demostración y contratos `/v1`
- `apps/web`: frontend React que consume la API y presenta el blueprint del producto
- `packages/shared`: tipos canónicos y mocks base
- `docker-compose.yml`: PostgreSQL y Redis para desarrollo
- `README.md`: arranque rápido

## 4. Próximas implementaciones recomendadas
1. Añadir persistencia real para tenants, catálogo y entitlements.
2. Incorporar autenticación con IdP externo.
3. Crear adaptador Moodle real con sync inicial de cursos y progreso.
4. Implementar checkout Stripe y webhook processor.
5. Integrar proveedor de reproducción HLS con DRM y QoE.
6. Añadir testing automatizado y pipeline CI.
