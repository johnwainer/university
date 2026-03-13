# AWS Target Architecture

## Runtime
- `CloudFront` para edge delivery y caching.
- `Application Load Balancer` para tráfico HTTP.
- `ECS Fargate` para `api` y futuros servicios de dominio.
- `S3` para assets estáticos y media metadata auxiliar.

## Data
- `RDS PostgreSQL` como fuente transaccional principal.
- `ElastiCache Redis` para caché, sesiones derivadas y rate limiting.
- `SQS` y `EventBridge` para procesos asíncronos y sync con proveedores.

## Security
- `WAF` delante del ALB.
- `Secrets Manager` para credenciales.
- TLS end-to-end.
- segregación por ambientes y cuentas AWS si el presupuesto lo permite.

## Operations
- `CloudWatch Logs` y métricas por servicio.
- alarmas para `api latency`, `5xx`, `checkout failures`, `playback incidents`.
- despliegues progresivos por ambiente.
