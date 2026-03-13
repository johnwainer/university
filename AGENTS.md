# AGENTS: Reglas del Proyecto

## Regla obligatoria de documentación operativa

Siempre que se agregue o cambie una funcionalidad del producto, se debe actualizar `PROJECT_RUNBOOK.md`.

Se considera cambio funcional (no exhaustivo):
- Nuevas rutas API, payloads, auth o flujos.
- Nuevos módulos en admin o web pública.
- Cambios de puertos, variables de entorno o comandos de arranque.
- Nuevas integraciones (Moodle, pagos, eventos, tickets, etc.).
- Cambios de despliegue, infraestructura u operación.

## Criterio de actualización mínima

Al menos una de estas secciones debe ajustarse:
- Arquitectura / componentes.
- Cómo levantar el proyecto.
- Rutas API clave.
- Sincronización/integraciones.
- Troubleshooting / checklist de handoff.

## Definición de terminado (DoD)

Ningún trabajo funcional está completo si `PROJECT_RUNBOOK.md` no refleja el estado real del sistema.
