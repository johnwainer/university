# PAE-U en AWS: Plan de Infraestructura Real (1000 MAU, video-first)

## 1. Objetivo

Desplegar `PAE-U` completo en AWS, con alta disponibilidad real, seguridad fuerte y costos contenidos.

Supuesto de carga inicial:
- ~1000 usuarios activos/mes.
- consumo mayoritario de video (VoD y eventos puntuales).
- picos moderados (lanzamientos, webinars/eventos).

## 2. Principio de diseño (fuerte pero austero)

- Mantener `HA` en componentes críticos (API, DB, edge).
- Evitar complejidad temprana (no EKS en fase inicial).
- Escalar horizontalmente donde más rinde (API stateless + CDN).
- Pagar por uso en media pipeline (transcodificación por job).
- Dejar camino claro a crecimiento sin rediseño.

## 3. Arquitectura objetivo (Producción)

## 3.1 Capa edge y acceso

- `Route 53` para DNS.
- `AWS Certificate Manager (ACM)` para TLS.
- `CloudFront` como CDN principal:
  - origen web estática (`S3`).
  - origen API (`ALB`).
  - origen media (`S3`/packaging).
  - contenido privado con signed URLs/cookies.
- `AWS WAF` asociado a CloudFront:
  - reglas administradas.
  - rate limiting por IP/path.

## 3.2 Aplicación (intermediador + servicios)

- `ECS Fargate` (recomendado para etapa 1):
  - servicio `api` (2 tasks mínimas, 2 AZ).
  - autoscaling por CPU/memoria/request count.
  - imágenes en `ECR`.
- `ALB` público para enrutar API.

## 3.3 Datos

- `RDS PostgreSQL` para DB del intermediador:
  - mínimo recomendado productivo: Multi-AZ.
  - backups automáticos + PITR.
- `ElastiCache Redis` para cache/sesiones/rate data.
- `S3`:
  - assets estáticos.
  - media de cursos.
  - logs/exports.

## 3.4 Moodle (backoffice académico)

Como es crítico para operación académica:

- `ECS Fargate` para Moodle app.
- `RDS MySQL/MariaDB` para DB Moodle (Multi-AZ recomendado).
- `EFS` para `moodledata` compartido.
- `ALB` dedicado (interno o restringido por IP/VPN según política).

Nota:
- Front públicos NO consumen Moodle directo.
- Moodle se integra solo vía API del intermediador.

## 3.5 Mensajería y procesos async

- `SQS` para colas de sync/eventos de dominio.
- `EventBridge Scheduler` para sync programado (Moodle, eventos, tickets).
- workers en ECS para jobs asíncronos.

## 3.6 Observabilidad y operación

- `CloudWatch Logs`, métricas y alarmas.
- `X-Ray` (opcional recomendado) para trazas API.
- dashboards por dominio: auth, cursos, playback, pagos, sync Moodle.

## 4. Diseño de red (VPC)

- 1 VPC, 2 AZ mínimo.
- Subnets públicas:
  - ALB API
  - ALB Moodle (si expuesto)
- Subnets privadas:
  - ECS tasks
  - RDS
  - Redis
  - EFS mounts
- NAT Gateway: 1 (austero) al inicio.
- Security Groups estrictos y principio de mínimo privilegio.

## 5. Media y video (cost-aware)

Para 1000 MAU, el costo dominante será transferencia de video.

Estrategia recomendada:
- `S3 + CloudFront` para entrega VoD.
- `MediaConvert` solo al publicar/actualizar videos (no infraestructura siempre encendida).
- Para lives mensuales:
  - opción A (AWS puro): `IVS` para simplicidad operativa.
  - opción B (si ya existe proveedor externo): mantener proveedor y normalizar por API.

Controles de protección:
- Signed URLs/cookies en CloudFront.
- bloqueo de acceso directo a S3 (OAC/OAI + bucket policies).

## 6. Seguridad y cumplimiento base

- `WAF` + AWS Shield Standard.
- secretos en `Secrets Manager`.
- cifrado en tránsito (TLS) y en reposo (RDS, EFS, S3, snapshots).
- IAM por servicio/entorno.
- CloudTrail habilitado.
- logging de auditoría administrativo.

## 7. CI/CD e IaC

- Infra como código (`Terraform` recomendado).
- Pipelines:
  - build/test/check.
  - scan de dependencias e imagen.
  - push a ECR.
  - deploy ECS por ambiente.
- Ambientes separados: `dev`, `qa/staging`, `prod`.
- strategy:
  - rolling update en API.
  - health checks + rollback automático.

## 8. Tamaños iniciales recomendados (1000 MAU)

## 8.1 API intermediador

- ECS Fargate:
  - `min 2 tasks` (una por AZ).
  - task size inicial: `0.5 vCPU / 1 GB`.
  - autoscaling hasta 4-6 tasks en picos.

## 8.2 PostgreSQL intermediador

- RDS PostgreSQL:
  - inicio: `db.t4g.medium` (o similar) con gp3.
  - storage 100-150 GB con autoscaling.
  - Multi-AZ si disponibilidad es prioridad contractual.

## 8.3 Redis

- `cache.t4g.small` (inicio) en 1 nodo.
- subir a replicación/multi-AZ cuando crezca concurrencia o dependencia de cache.

## 8.4 Moodle

- ECS Fargate:
  - 1-2 tasks según horario de uso admin.
- RDS MySQL/MariaDB:
  - `db.t4g.medium` inicial.
- EFS estándar para archivos Moodle.

## 9. Estimación de costos (orden de magnitud, sin compromiso)

La cifra final depende de región, tráfico de video y horas de visualización.
Usar AWS Pricing Calculator antes de contratar.

Rango mensual típico para este escenario:

- Cómputo app/API + ALB + logs básicos: `USD 120 - 280`
- DB + cache (intermediador): `USD 120 - 350`
- Moodle (app + DB + EFS): `USD 140 - 380`
- WAF + monitoreo + backup: `USD 40 - 160`
- CDN/video (muy variable): `USD 120 - 900+`

Total estimado:
- `Lean HA`: ~`USD 450 - 900/mes`
- `HA reforzada`: ~`USD 900 - 1,800/mes`

El principal driver de costo es `egress de video`.

## 10. Perfil recomendado para arrancar (tu caso)

Elegir `Lean HA` con guardrails:

- CloudFront + WAF desde día 1.
- API en ECS Fargate con 2 tasks.
- PostgreSQL productivo en Multi-AZ si el presupuesto lo permite;
  si no, Single-AZ + backups/PITR + runbook de restauración.
- Moodle con 1 task inicial (2 en horario de alta operación si se necesita).
- Redis pequeño.
- Logs/alarms estrictos para prevenir incidentes.

Esto te da buen equilibrio entre estabilidad y austeridad.

## 11. Roadmap de despliegue (4 semanas)

Semana 1:
- IaC base (VPC, subnets, IAM, ECR, ECS, ALB, RDS, Redis, S3, CloudFront, WAF).

Semana 2:
- Deploy API + web + secretos + pipelines CI/CD + monitoreo básico.

Semana 3:
- Moodle productivo (ECS + RDS + EFS) + conexión por API + sync completo.

Semana 4:
- Hardening (WAF tuning, backup drills, alertas SLO), pruebas de carga y go-live.

## 12. SLOs y alarmas mínimas

- API availability: 99.9%.
- p95 API latency < 350 ms en endpoints críticos.
- errores 5xx < 1%.
- sync Moodle con éxito > 99%.
- alertas:
  - ALB 5xx/spikes
  - RDS CPU/connections/replication lag
  - ECS task restarts
  - cola SQS creciendo
  - CloudFront 4xx/5xx anómalos

## 13. Riesgos y mitigaciones

- Riesgo: costos de video suben rápido.
  - Mitigación: bitrate ladder controlada, caching agresivo, lifecycle de assets.

- Riesgo: dependencia Moodle en picos administrativos.
  - Mitigación: desacoplar por colas/sync incremental, no bloquear experiencia pública.

- Riesgo: exposición de contenido premium.
  - Mitigación: CloudFront signed URLs/cookies + bloqueo directo de origen.

## 14. Próximos pasos concretos

1. Congelar región objetivo (`us-east-1` sugerida por costo/servicios).
2. Crear presupuesto AWS y alertas de costo (50/75/90%).
3. Implementar IaC base de `dev` y `staging`.
4. Ejecutar prueba de carga realista (video + API + sync).
5. Ajustar tamaños antes de `prod`.

---

## Referencias oficiales AWS

- CloudFront pricing: https://aws.amazon.com/cloudfront/pricing/
- AWS Fargate pricing: https://aws.amazon.com/fargate/pricing/
- RDS PostgreSQL pricing: https://aws.amazon.com/rds/postgresql/pricing/
- CloudFront private content (signed URLs/cookies): https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/PrivateContent.html
- Elegir signed URLs vs signed cookies: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-choosing-signed-urls-cookies.html
- AWS WAF rate-based rules: https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based.html
- AWS SaaS Lens: https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/saas-lens.html
- AWS Backup feature availability: https://docs.aws.amazon.com/aws-backup/latest/devguide/backup-feature-availability.html
