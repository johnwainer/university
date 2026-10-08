#!/usr/bin/env bash
#
# tfu-shell-check.sh — punto de control de aulas listas, diario.
#
# §8 del Master Syllabus: «los profesores deben tener sus aulas listas los
# jueves a las 10 AM antes de que la clase empiece el martes». Este script
# recorre los términos con malla generada y llama al chequeo, que reconcilia
# los avisos: abre los que faltan, actualiza los abiertos y cierra los que ya
# se resolvieron.
#
# Se ejecuta todos los días y no sólo los jueves a propósito: así un aula que
# se desmonta el viernes no pasa inadvertida hasta la semana siguiente, y el
# aviso 'pending' sale con antelación en vez de llegar cuando ya es tarde.
#
# Uso:  tfu-shell-check.sh [--base-url URL] [--term TERM_ID]
#
set -Eeuo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:4000/api}"
ENV_FILE="${ENV_FILE:-/opt/plataforma-estudiantil/api/shared/.env}"
ONLY_TERM=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) BASE_URL="${2:-}"; shift 2 ;;
    --term)     ONLY_TERM="${2:-}"; shift 2 ;;
    -h|--help)  sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "opción desconocida: $1" >&2; exit 2 ;;
  esac
done

ADMIN_KEY="${ADMIN_API_KEY:-}"
if [[ -z "$ADMIN_KEY" && -r "$ENV_FILE" ]]; then
  ADMIN_KEY="$(sed -n 's/^ADMIN_API_KEY=//p' "$ENV_FILE" | head -n1)"
fi
[[ -n "$ADMIN_KEY" ]] || { echo "falta ADMIN_API_KEY" >&2; exit 1; }

DB_URL="${DATABASE_URL:-}"
if [[ -z "$DB_URL" && -r "$ENV_FILE" ]]; then
  DB_URL="$(sed -n 's/^DATABASE_URL=//p' "$ENV_FILE" | head -n1)"
fi

if [[ -n "$ONLY_TERM" ]]; then
  TERMS="$ONLY_TERM"
else
  [[ -n "$DB_URL" ]] || { echo "falta DATABASE_URL para listar los términos" >&2; exit 1; }
  # Sólo términos vigentes o futuros: un periodo cerrado no genera avisos.
  TERMS="$(psql "$DB_URL" -t -A -c \
    "SELECT term_id FROM term_grids WHERE ends_on >= CURRENT_DATE - INTERVAL '7 days' ORDER BY starts_on")"
fi

[[ -n "$TERMS" ]] || { echo "sin términos vigentes: nada que comprobar"; exit 0; }

RESUMEN="$(mktemp)"
trap 'rm -f "$RESUMEN"' EXIT
# El resumidor se escribe una vez a un temporal: dos redirecciones de stdin en
# la misma invocación se anulan entre sí, que era el fallo de la primera versión.
cat > "$RESUMEN" <<'FIN_PY'
import json, sys
term = sys.argv[1]
data = json.load(sys.stdin)
alerts = data.get("alerts", {})
print(f"[{term}] cursos={data.get('total')} listos={data.get('ready')} "
      f"vencidos={data.get('overdue')} avisos_abiertos={alerts.get('open', 0)}")
for item in alerts.get("delivered", []):
    detalle = f" - {item['detail']}" if item.get("detail") else ""
    print(f"   curso {item['moodleCourseId']} semana {item['week']}: {item['delivery']}{detalle}")
FIN_PY

status=0
while IFS= read -r term; do
  [[ -n "$term" ]] || continue
  response="$(curl -sS -H "x-admin-key: ${ADMIN_KEY}" \
    "${BASE_URL}/admin/calendar/terms/${term}/shell-check" || true)"
  if [[ -z "$response" ]]; then
    echo "[$term] sin respuesta del API" >&2
    status=1
    continue
  fi
  printf '%s' "$response" | python3 "$RESUMEN" "$term" || status=1
done <<<"$TERMS"

exit "$status"
