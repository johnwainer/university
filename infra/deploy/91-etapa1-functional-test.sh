#!/usr/bin/env bash
#
# 91-etapa1-functional-test.sh — prueba funcional de los módulos de la Etapa I.
#
# A diferencia de 90-smoke-test.sh (solo lectura, apto para producción), este
# script ESCRIBE datos: crea un programa, un expediente de faculty y varios
# documentos, verifica que el semáforo del checklist reacciona correctamente y
# después borra todo lo que creó.
#
# Por eso está pensado para staging o para un entorno local. Contra producción
# exige --allow-writes de forma explícita.
#
# Adaptado a esta rama: el checklist vive bajo /admin/cie/* porque la raíz
# /admin/compliance/* ya la ocupan las rutas de compliance_records del módulo
# syllabus. Los programas son `degree_programs`, gestionados por
# /admin/degree-programs, que ahora expone PATCH para activar y desactivar
# ya activo (is_active default true). La suite lo desactiva al terminar, para
# que dos corridas seguidas den el mismo resultado.
#
# Uso:
#   ./91-etapa1-functional-test.sh [--base-url URL] [--admin-key KEY]
#                                  [--admin-email MAIL --admin-password PASS]
#                                  [--allow-writes] [--keep]
#
set -Eeuo pipefail

BASE_URL="${BASE_URL:-http://localhost:4000/api}"
ADMIN_KEY="${ADMIN_API_KEY:-dev-admin-key}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
ALLOW_WRITES=0
KEEP_DATA=0

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
RESULTS=()

# Recursos creados, para poder limpiarlos al final.
CREATED_PROGRAM_ID=""
CREATED_FACULTY_ID=""
CREATED_DOCUMENT_IDS=()

usage() {
  sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

log()  { printf '\033[0;36m›\033[0m %s\n' "$*"; }
fail() { printf '\033[0;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

check() {
  local name="$1" condition="$2" detail="${3:-}"
  if [[ "$condition" == "1" ]]; then
    PASS_COUNT=$((PASS_COUNT + 1))
    RESULTS+=("PASS|${name}|")
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    RESULTS+=("FAIL|${name}|${detail}")
  fi
}

# Caso que esta rama no puede ejercitar (no existe la ruta que haria falta).
# Se reporta explicitamente en vez de contarse como aprobado: un SKIP silencioso
# es peor que un fallo, porque deja de verse.
skip() {
  local name="$1" reason="${2:-}"
  SKIP_COUNT=$((SKIP_COUNT + 1))
  RESULTS+=("SKIP|${name}|${reason}")
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)       BASE_URL="${2:?}"; shift 2 ;;
    --admin-key)      ADMIN_KEY="${2:?}"; shift 2 ;;
    --admin-email)    ADMIN_EMAIL="${2:?}"; shift 2 ;;
    --admin-password) ADMIN_PASSWORD="${2:?}"; shift 2 ;;
    --allow-writes)   ALLOW_WRITES=1; shift ;;
    --keep)           KEEP_DATA=1; shift ;;
    -h|--help)        usage ;;
    *)                printf 'Unknown flag: %s\n' "$1" >&2; exit 2 ;;
  esac
done

BASE_URL="${BASE_URL%/}"

# Guardia: no escribir en producción por accidente.
if [[ "$BASE_URL" == *"api.portal."* && "$ALLOW_WRITES" -ne 1 ]]; then
  fail "$BASE_URL parece producción. Repite con --allow-writes si es intencional."
fi

command -v curl >/dev/null || fail "curl no está disponible"
command -v jq   >/dev/null || fail "jq no está disponible"

# ---------------------------------------------------------------------------
# Helpers HTTP. Dejan el cuerpo en HTTP_BODY y el código en HTTP_STATUS.
# ---------------------------------------------------------------------------
HTTP_BODY=""
HTTP_STATUS=""

request() {
  local method="$1" path="$2" body="${3:-}" auth="${4:-admin}"
  local -a args=(-sS -o /tmp/etapa1-body.$$ -w '%{http_code}' -X "$method" --max-time 30)

  case "$auth" in
    admin)  args+=(-H "x-admin-key: ${ADMIN_KEY}") ;;
    bearer) args+=(-H "Authorization: Bearer ${SESSION_TOKEN:-}") ;;
    none)   : ;;
  esac

  if [[ -n "$body" ]]; then
    args+=(-H 'Content-Type: application/json' -d "$body")
  fi

  # Identidad de cliente propia de esta corrida: evita que el limite por IP
  # del formulario publico acumule entre ejecuciones y vuelva la suite
  # irrepetible. Solo surte efecto si la conexion sale de un proxy de
  # confianza, que es el caso en local y detras del Nginx de produccion.
  if [[ -n "${CLIENT_IP:-}" ]]; then
    args+=(-H "X-Forwarded-For: ${CLIENT_IP}")
  fi

  HTTP_STATUS="$(curl "${args[@]}" "${BASE_URL}${path}" || echo 000)"
  HTTP_BODY="$(cat /tmp/etapa1-body.$$ 2>/dev/null || true)"
  rm -f /tmp/etapa1-body.$$
}

cleanup() {
  [[ "$KEEP_DATA" -eq 1 ]] && { log "--keep: se conservan los datos de prueba"; return; }
  log "Limpiando datos de prueba…"
  local id
  for id in "${CREATED_DOCUMENT_IDS[@]:-}"; do
    [[ -n "$id" ]] && request DELETE "/admin/cie/documents/${id}" '' admin || true
  done
  [[ -n "$CREATED_FACULTY_ID" ]] && request DELETE "/admin/cie/faculty/${CREATED_FACULTY_ID}" '' admin || true
  # `degree_programs` no expone DELETE en esta rama, asi que el programa de
  # prueba se queda. No afecta a las verificaciones (todas son relativas a su
  # propio baseline), pero se avisa para que el operador lo pueda borrar.
  # degree_programs no expone DELETE a proposito (lo referencian matriculas e
  # historia academica), pero si PATCH: desactivar saca el programa de prueba
  # del catalogo publico y del denominador del checklist, que es lo que hacia
  # que dos corridas seguidas no dieran el mismo resultado.
  if [[ -n "$CREATED_PROGRAM_ID" ]]; then
    request PATCH "/admin/degree-programs/${CREATED_PROGRAM_ID}" '{"isActive":false}' admin || true
    log "Programa de prueba ${PROGRAM_CODE} desactivado (queda en la tabla, fuera del conteo)."
  fi
  return 0
}
trap cleanup EXIT

STAMP="$(date +%s)"
PROGRAM_CODE="QA${STAMP: -6}"
# IP sintetica unica por corrida (rango de documentacion TEST-NET-3).
CLIENT_IP="203.0.113.$(( (STAMP % 250) + 1 ))"
FACULTY_EMAIL="qa-${STAMP}@test.invalid"

log "Objetivo: ${BASE_URL}"

# ---------------------------------------------------------------------------
# 1. Salud e inventario de rutas
# ---------------------------------------------------------------------------
request GET /health '' none
check "GET /health responde 200" "$([[ "$HTTP_STATUS" == 200 ]] && echo 1 || echo 0)" "status=$HTTP_STATUS"

request GET /admin/routes '' admin
ROUTES="$HTTP_BODY"
for route in \
  '/v1/programs' '/v1/contact' \
  '/admin/cie/checklist' '/admin/cie/overview' \
  '/admin/degree-programs' '/admin/cie/document-types' \
  '/admin/cie/documents' '/admin/cie/faculty' \
  '/admin/contact-messages'
do
  found="$(printf '%s' "$ROUTES" | jq --arg r "$route" '[.. | objects | select(.url? == $r)] | length' 2>/dev/null || echo 0)"
  check "Ruta registrada: ${route}" "$([[ "${found:-0}" -ge 1 ]] && echo 1 || echo 0)" "no aparece en /admin/routes"
done

# ---------------------------------------------------------------------------
# 2. Autenticación: las rutas de compliance exigen credenciales
# ---------------------------------------------------------------------------
for path in /admin/cie/checklist /admin/cie/documents /admin/contact-messages; do
  request GET "$path" '' none
  check "401 sin credenciales en ${path}" "$([[ "$HTTP_STATUS" == 401 ]] && echo 1 || echo 0)" "status=$HTTP_STATUS"
done

if [[ -n "$ADMIN_EMAIL" && -n "$ADMIN_PASSWORD" ]]; then
  request POST /admin/auth/login "$(jq -nc --arg e "$ADMIN_EMAIL" --arg p "$ADMIN_PASSWORD" '{email:$e,password:$p}')" none
  SESSION_TOKEN="$(printf '%s' "$HTTP_BODY" | jq -r '.token // empty')"
  check "Login admin devuelve token" "$([[ -n "$SESSION_TOKEN" ]] && echo 1 || echo 0)" "status=$HTTP_STATUS"

  if [[ -n "$SESSION_TOKEN" ]]; then
    request GET /admin/cie/checklist '' bearer
    check "Checklist accesible con Bearer" "$([[ "$HTTP_STATUS" == 200 ]] && echo 1 || echo 0)" "status=$HTTP_STATUS"
  fi
fi

# ---------------------------------------------------------------------------
# 3. Catálogo de evidencia sembrado
# ---------------------------------------------------------------------------
request GET /admin/cie/document-types '' admin
TYPES="$HTTP_BODY"
TYPE_COUNT="$(printf '%s' "$TYPES" | jq '.documentTypes | length' 2>/dev/null || echo 0)"
check "Catálogo de tipos de documento sembrado" "$([[ "${TYPE_COUNT:-0}" -ge 15 ]] && echo 1 || echo 0)" "solo ${TYPE_COUNT} tipos"

for scope in institutional program faculty; do
  n="$(printf '%s' "$TYPES" | jq --arg s "$scope" '[.documentTypes[] | select(.scope == $s)] | length')"
  check "Tipos de ámbito ${scope} presentes" "$([[ "${n:-0}" -ge 1 ]] && echo 1 || echo 0)" "n=${n}"
done

INST_TYPE_ID="$(printf '%s' "$TYPES" | jq -r '[.documentTypes[] | select(.scope=="institutional" and .cieRequired)][0].id // empty')"
PROG_TYPE_ID="$(printf '%s' "$TYPES" | jq -r '[.documentTypes[] | select(.scope=="program" and .cieRequired)][0].id // empty')"
FAC_TYPE_ID="$(printf  '%s' "$TYPES" | jq -r '[.documentTypes[] | select(.scope=="faculty" and .cieRequired)][0].id // empty')"
[[ -n "$INST_TYPE_ID" && -n "$PROG_TYPE_ID" && -n "$FAC_TYPE_ID" ]] || fail "No se pudo resolver un tipo por ámbito"

# ---------------------------------------------------------------------------
# 4. Checklist: estructura y baseline
# ---------------------------------------------------------------------------
request GET /admin/cie/checklist '' admin
CHECKLIST="$HTTP_BODY"
check "Checklist responde 200" "$([[ "$HTTP_STATUS" == 200 ]] && echo 1 || echo 0)" "status=$HTTP_STATUS"
check "Checklist trae 3 secciones" \
  "$([[ "$(printf '%s' "$CHECKLIST" | jq '.sections | length')" == 3 ]] && echo 1 || echo 0)"
check "Checklist expone semáforo global" \
  "$(printf '%s' "$CHECKLIST" | jq -e '.summary.signal | IN("green","amber","red")' >/dev/null 2>&1 && echo 1 || echo 0)"
check "completionPercent está entre 0 y 100" \
  "$(printf '%s' "$CHECKLIST" | jq -e '.summary.completionPercent >= 0 and .summary.completionPercent <= 100' >/dev/null 2>&1 && echo 1 || echo 0)"

BASE_REQUIRED="$(printf '%s' "$CHECKLIST" | jq '.summary.totalRequired')"
BASE_APPROVED="$(printf '%s' "$CHECKLIST" | jq '.summary.totalApproved')"
log "Baseline: ${BASE_APPROVED}/${BASE_REQUIRED} evidencias aprobadas"

# Un conjunto vacio NO es "completo". Si no hay programas ni expedientes
# activos, pintar esas secciones en verde le diria a la institucion que su
# evidencia esta lista cuando no hay nada cargado.
ACTIVE_PROGRAMS="$(printf '%s' "$CHECKLIST" | jq '.counters.activePrograms')"
ACTIVE_FACULTY="$(printf '%s' "$CHECKLIST" | jq '.counters.activeFacultyRecords')"

if [[ "${ACTIVE_PROGRAMS:-0}" -eq 0 ]]; then
  sig="$(printf '%s' "$CHECKLIST" | jq -r '[.sections[] | select(.scope=="program")][0].signal')"
  check "Sin programas activos la seccion NO se pinta en verde" \
    "$([[ "$sig" != "green" ]] && echo 1 || echo 0)" "signal=${sig}"
  gap="$(printf '%s' "$CHECKLIST" | jq -r '[.sections[] | select(.scope=="program")][0].items[] | select(.cieRequired) | .gaps[0].targetLabel' | head -1)"
  check "Se explica que no hay programas registrados" \
    "$([[ "$gap" == *"No hay programas"* ]] && echo 1 || echo 0)" "gap=${gap}"
fi

if [[ "${ACTIVE_FACULTY:-0}" -eq 0 ]]; then
  sig="$(printf '%s' "$CHECKLIST" | jq -r '[.sections[] | select(.scope=="faculty")][0].signal')"
  check "Sin expedientes activos la seccion NO se pinta en verde" \
    "$([[ "$sig" != "green" ]] && echo 1 || echo 0)" "signal=${sig}"
fi

if [[ "$ALLOW_WRITES" -ne 1 && "$BASE_URL" == *"api.portal."* ]]; then
  log "Modo solo lectura: se omiten las pruebas de escritura"
else

# ---------------------------------------------------------------------------
# 5. Programas: crear y comprobar que el checklist cuenta los activos
#
# En esta rama los programas son `degree_programs`, gestionados por
# /admin/degree-programs. Esa ruta solo tiene GET y POST, y el POST crea el
# programa ya activo (is_active default true).
# ---------------------------------------------------------------------------
request POST /admin/degree-programs \
  "$(jq -nc --arg c "$PROGRAM_CODE" '{name:"Programa QA",code:$c,degreeLevel:"master"}')" admin
CREATED_PROGRAM_ID="$(printf '%s' "$HTTP_BODY" | jq -r '.id // empty')"
check "Crear programa devuelve 201" "$([[ "$HTTP_STATUS" == 201 ]] && echo 1 || echo 0)" "status=$HTTP_STATUS body=$HTTP_BODY"
check "Programa creado tiene id" "$([[ -n "$CREATED_PROGRAM_ID" ]] && echo 1 || echo 0)"
[[ -n "$CREATED_PROGRAM_ID" ]] || fail "sin programa no se puede continuar"

# Codigo duplicado -> 409. Lo produce el manejador global de errores al
# traducir el 23505 de Postgres; sin ese manejador seria un 500.
request POST /admin/degree-programs \
  "$(jq -nc --arg c "$PROGRAM_CODE" '{name:"Dup",code:$c,degreeLevel:"master"}')" admin
check "Codigo de programa duplicado devuelve 409" "$([[ "$HTTP_STATUS" == 409 ]] && echo 1 || echo 0)" "status=$HTTP_STATUS"

# Nivel invalido -> 400 (ZodError traducido por el manejador global)
request POST /admin/degree-programs \
  '{"name":"x","code":"QABAD","degreeLevel":"not-a-level"}' admin
check "Nivel de programa invalido devuelve 400" "$([[ "$HTTP_STATUS" == 400 ]] && echo 1 || echo 0)" "status=$HTTP_STATUS"
check "El 400 de validacion trae detalle por campo" \
  "$(printf '%s' "$HTTP_BODY" | jq -e '(.fields | length) >= 1' >/dev/null 2>&1 && echo 1 || echo 0)" "body=$HTTP_BODY"

# El programa nace activo; se desactiva para comprobar que sale del catalogo
# publico y del denominador del checklist, y luego se reactiva.
request PATCH "/admin/degree-programs/${CREATED_PROGRAM_ID}" '{"isActive":false}' admin
check "Desactivar programa devuelve 200" "$([[ "$HTTP_STATUS" == 200 ]] && echo 1 || echo 0)" "status=$HTTP_STATUS"

request GET "/v1/programs?locale=es" '' none
check "Programa inactivo no se publica" \
  "$(printf '%s' "$HTTP_BODY" | jq -e --arg id "$CREATED_PROGRAM_ID" '[.programs[] | select(.id==$id)] | length == 0' >/dev/null 2>&1 && echo 1 || echo 0)"

request PATCH "/admin/degree-programs/${CREATED_PROGRAM_ID}" '{"isActive":true}' admin
check "Reactivar programa devuelve 200" "$([[ "$HTTP_STATUS" == 200 ]] && echo 1 || echo 0)" "status=$HTTP_STATUS"

request PATCH "/admin/degree-programs/no-existe" '{"isActive":true}' admin
check "PATCH de programa inexistente devuelve 404" "$([[ "$HTTP_STATUS" == 404 ]] && echo 1 || echo 0)" "status=$HTTP_STATUS"

# Activo SI aparece en el catalogo publico.
request GET "/v1/programs?locale=en" '' none
check "Programa activo aparece en el catalogo publico" \
  "$(printf '%s' "$HTTP_BODY" | jq -e --arg id "$CREATED_PROGRAM_ID" '[.programs[] | select(.id==$id)] | length == 1' >/dev/null 2>&1 && echo 1 || echo 0)"
check "El catalogo publico declara el locale pedido (en)" \
  "$(printf '%s' "$HTTP_BODY" | jq -e '.locale == "en"' >/dev/null 2>&1 && echo 1 || echo 0)" "body=$HTTP_BODY"
# `degree_programs` tiene una sola columna `name`, no un par ES/EN, asi que el
# nombre es el mismo en los dos idiomas. Se verifica que se devuelva intacto.
check "El catalogo publico devuelve el nombre registrado (en)" \
  "$(printf '%s' "$HTTP_BODY" | jq -e --arg id "$CREATED_PROGRAM_ID" '[.programs[] | select(.id==$id)][0].name == "Programa QA"' >/dev/null 2>&1 && echo 1 || echo 0)"

request GET "/v1/programs?locale=es" '' none
check "El catalogo publico declara el locale pedido (es)" \
  "$(printf '%s' "$HTTP_BODY" | jq -e '.locale == "es"' >/dev/null 2>&1 && echo 1 || echo 0)"
check "El catalogo publico devuelve el nombre registrado (es)" \
  "$(printf '%s' "$HTTP_BODY" | jq -e --arg id "$CREATED_PROGRAM_ID" '[.programs[] | select(.id==$id)][0].name == "Programa QA"' >/dev/null 2>&1 && echo 1 || echo 0)"

# El programa activo aumenta la evidencia exigida
request GET /admin/cie/checklist '' admin
AFTER_PROGRAM_REQUIRED="$(printf '%s' "$HTTP_BODY" | jq '.summary.totalRequired')"
check "Un programa activo aumenta totalRequired" \
  "$([[ "$AFTER_PROGRAM_REQUIRED" -gt "$BASE_REQUIRED" ]] && echo 1 || echo 0)" \
  "antes=${BASE_REQUIRED} despues=${AFTER_PROGRAM_REQUIRED}"

# ---------------------------------------------------------------------------
# 6. Faculty
# ---------------------------------------------------------------------------
request POST /admin/cie/faculty \
  "$(jq -nc --arg e "$FACULTY_EMAIL" --arg p "$CREATED_PROGRAM_ID" \
     '{fullName:"QA Docente",email:$e,programId:$p,degreeLevel:"doctoral",status:"active"}')" admin
CREATED_FACULTY_ID="$(printf '%s' "$HTTP_BODY" | jq -r '.faculty.id // empty')"
check "Crear expediente de faculty devuelve 201" "$([[ "$HTTP_STATUS" == 201 ]] && echo 1 || echo 0)" "status=$HTTP_STATUS body=$HTTP_BODY"
[[ -n "$CREATED_FACULTY_ID" ]] || fail "sin expediente no se puede continuar"

request POST /admin/cie/faculty \
  "$(jq -nc --arg e "$FACULTY_EMAIL" '{fullName:"Dup",email:$e}')" admin
check "Correo de faculty duplicado devuelve 409" "$([[ "$HTTP_STATUS" == 409 ]] && echo 1 || echo 0)" "status=$HTTP_STATUS"

request POST /admin/cie/faculty '{"fullName":"QA","email":"no-es-un-correo"}' admin
check "Correo de faculty inválido devuelve 400" "$([[ "$HTTP_STATUS" == 400 ]] && echo 1 || echo 0)" "status=$HTTP_STATUS"

request GET /admin/cie/faculty '' admin
check "El expediente reporta cobertura documental incompleta" \
  "$(printf '%s' "$HTTP_BODY" | jq -e --arg id "$CREATED_FACULTY_ID" \
     '[.faculty[] | select(.id==$id)][0] | .requiredDocuments > 0 and .approvedDocuments == 0 and (.missingDocumentCodes | length) > 0' \
     >/dev/null 2>&1 && echo 1 || echo 0)"

# ---------------------------------------------------------------------------
# 7. Documentos: validación de ámbito
# ---------------------------------------------------------------------------
request POST /admin/cie/documents \
  "$(jq -nc --arg t "$INST_TYPE_ID" --arg p "$CREATED_PROGRAM_ID" '{documentTypeId:$t,programId:$p,title:"Mal ámbito"}')" admin
check "Documento institucional con programa devuelve 400" "$([[ "$HTTP_STATUS" == 400 ]] && echo 1 || echo 0)" "status=$HTTP_STATUS"

request POST /admin/cie/documents \
  "$(jq -nc --arg t "$PROG_TYPE_ID" '{documentTypeId:$t,title:"Falta programa"}')" admin
check "Documento de programa sin programId devuelve 400" "$([[ "$HTTP_STATUS" == 400 ]] && echo 1 || echo 0)" "status=$HTTP_STATUS"

request POST /admin/cie/documents \
  "$(jq -nc --arg t "$FAC_TYPE_ID" '{documentTypeId:$t,title:"Falta docente"}')" admin
check "Documento de faculty sin facultyId devuelve 400" "$([[ "$HTTP_STATUS" == 400 ]] && echo 1 || echo 0)" "status=$HTTP_STATUS"

request POST /admin/cie/documents \
  "$(jq -nc --arg t "$PROG_TYPE_ID" --arg p "$CREATED_PROGRAM_ID" \
     '{documentTypeId:$t,programId:$p,title:"Fechas invertidas",effectiveDate:"2026-06-01",expiresAt:"2026-01-01"}')" admin
check "expiresAt anterior a effectiveDate devuelve 400" "$([[ "$HTTP_STATUS" == 400 ]] && echo 1 || echo 0)" "status=$HTTP_STATUS"

request POST /admin/cie/documents \
  '{"documentTypeId":"no-existe","title":"Tipo inexistente"}' admin
check "documentTypeId inexistente devuelve 400" "$([[ "$HTTP_STATUS" == 400 ]] && echo 1 || echo 0)" "status=$HTTP_STATUS"

# ---------------------------------------------------------------------------
# 8. El semáforo reacciona al estado real de la evidencia
# ---------------------------------------------------------------------------
signal_for_type() {
  local type_id="$1"
  request GET /admin/cie/checklist '' admin
  printf '%s' "$HTTP_BODY" | jq -r --arg t "$type_id" \
    '[.sections[].items[] | select(.documentTypeId == $t)][0].signal'
}

# Sin documento -> rojo
check "Sin evidencia el semáforo del programa está en rojo" \
  "$([[ "$(signal_for_type "$PROG_TYPE_ID")" == "red" ]] && echo 1 || echo 0)"

# Documento en borrador -> ámbar
request POST /admin/cie/documents \
  "$(jq -nc --arg t "$PROG_TYPE_ID" --arg p "$CREATED_PROGRAM_ID" \
     '{documentTypeId:$t,programId:$p,title:"Malla QA",status:"draft",version:"1"}')" admin
DOC_PROG_ID="$(printf '%s' "$HTTP_BODY" | jq -r '.document.id // empty')"
CREATED_DOCUMENT_IDS+=("$DOC_PROG_ID")
check "Crear documento de programa devuelve 201" "$([[ "$HTTP_STATUS" == 201 ]] && echo 1 || echo 0)" "status=$HTTP_STATUS body=$HTTP_BODY"
check "Evidencia en borrador pone el semáforo en ámbar" \
  "$([[ "$(signal_for_type "$PROG_TYPE_ID")" == "amber" ]] && echo 1 || echo 0)"

# Duplicado para la misma unidad -> 409
request POST /admin/cie/documents \
  "$(jq -nc --arg t "$PROG_TYPE_ID" --arg p "$CREATED_PROGRAM_ID" '{documentTypeId:$t,programId:$p,title:"Duplicado"}')" admin
check "Segundo documento del mismo tipo y unidad devuelve 409" "$([[ "$HTTP_STATUS" == 409 ]] && echo 1 || echo 0)" "status=$HTTP_STATUS"

# Aprobado y vigente -> verde
request PATCH "/admin/cie/documents/${DOC_PROG_ID}" '{"status":"approved","expiresAt":"2099-12-31"}' admin
check "Aprobar documento devuelve 200" "$([[ "$HTTP_STATUS" == 200 ]] && echo 1 || echo 0)" "status=$HTTP_STATUS"
check "Evidencia aprobada y vigente pone el semáforo en verde" \
  "$([[ "$(signal_for_type "$PROG_TYPE_ID")" == "green" ]] && echo 1 || echo 0)"

# Aprobado pero vencido -> NO cuenta: vuelve a ámbar
request PATCH "/admin/cie/documents/${DOC_PROG_ID}" '{"expiresAt":"2020-01-01"}' admin
check "Evidencia vencida deja de contar (ámbar)" \
  "$([[ "$(signal_for_type "$PROG_TYPE_ID")" == "amber" ]] && echo 1 || echo 0)"
request GET /admin/cie/checklist '' admin
check "La evidencia vencida se cuenta en totalExpired" \
  "$(printf '%s' "$HTTP_BODY" | jq -e '.summary.totalExpired >= 1' >/dev/null 2>&1 && echo 1 || echo 0)"
check "El documento vencido se marca isExpired en el listado" \
  "$(request GET "/admin/cie/documents" '' admin; printf '%s' "$HTTP_BODY" | jq -e --arg id "$DOC_PROG_ID" '[.documents[] | select(.id==$id)][0].isExpired == true' >/dev/null 2>&1 && echo 1 || echo 0)"

# Restaurar vigencia
request PATCH "/admin/cie/documents/${DOC_PROG_ID}" '{"expiresAt":"2099-12-31"}' admin

# Documento de faculty aprobado -> cobertura completa del expediente
request POST /admin/cie/documents \
  "$(jq -nc --arg t "$FAC_TYPE_ID" --arg f "$CREATED_FACULTY_ID" \
     '{documentTypeId:$t,facultyId:$f,title:"CV QA",status:"approved"}')" admin
DOC_FAC_ID="$(printf '%s' "$HTTP_BODY" | jq -r '.document.id // empty')"
CREATED_DOCUMENT_IDS+=("$DOC_FAC_ID")
check "Crear documento de faculty devuelve 201" "$([[ "$HTTP_STATUS" == 201 ]] && echo 1 || echo 0)" "status=$HTTP_STATUS"

request GET /admin/cie/faculty '' admin
check "El expediente refleja el documento aprobado" \
  "$(printf '%s' "$HTTP_BODY" | jq -e --arg id "$CREATED_FACULTY_ID" \
     '[.faculty[] | select(.id==$id)][0].approvedDocuments >= 1' >/dev/null 2>&1 && echo 1 || echo 0)"

# Filtros del listado
request GET "/admin/cie/documents?scope=program" '' admin
check "Filtro por ámbito solo devuelve ese ámbito" \
  "$(printf '%s' "$HTTP_BODY" | jq -e 'all(.documents[]; .documentTypeScope == "program")' >/dev/null 2>&1 && echo 1 || echo 0)"

request GET "/admin/cie/documents?status=approved" '' admin
check "Filtro por estado solo devuelve aprobados" \
  "$(printf '%s' "$HTTP_BODY" | jq -e 'all(.documents[]; .status == "approved")' >/dev/null 2>&1 && echo 1 || echo 0)"

# Overview coherente con el checklist
request GET /admin/cie/overview '' admin
check "Overview responde 200 con resumen y contadores" \
  "$(printf '%s' "$HTTP_BODY" | jq -e '.summary.completionPercent != null and .counters.activePrograms != null' >/dev/null 2>&1 && echo 1 || echo 0)"

# ---------------------------------------------------------------------------
# 9. Formulario de contacto
# ---------------------------------------------------------------------------
request POST /v1/contact \
  "$(jq -nc --arg p "$CREATED_PROGRAM_ID" \
     '{fullName:"QA Prospecto",email:"prospecto@test.invalid",message:"Quisiera información del programa, gracias.",programId:$p,locale:"es"}')" none
CONTACT_ID="$(printf '%s' "$HTTP_BODY" | jq -r '.id // empty')"
check "Enviar formulario de contacto devuelve 201" "$([[ "$HTTP_STATUS" == 201 ]] && echo 1 || echo 0)" "status=$HTTP_STATUS body=$HTTP_BODY"

request POST /v1/contact '{"fullName":"QA","email":"malcorreo","message":"mensaje suficientemente largo"}' none
check "Correo inválido en contacto devuelve 400" "$([[ "$HTTP_STATUS" == 400 ]] && echo 1 || echo 0)" "status=$HTTP_STATUS"

request POST /v1/contact '{"fullName":"QA","email":"qa@test.invalid","message":"corto"}' none
check "Mensaje demasiado corto devuelve 400" "$([[ "$HTTP_STATUS" == 400 ]] && echo 1 || echo 0)" "status=$HTTP_STATUS"

request POST /v1/contact \
  '{"fullName":"QA","email":"qa@test.invalid","message":"mensaje largo suficiente","programId":"no-existe"}' none
check "programId inexistente en contacto devuelve 400" "$([[ "$HTTP_STATUS" == 400 ]] && echo 1 || echo 0)" "status=$HTTP_STATUS"

# Honeypot: se acepta con 202 y no se persiste
request POST /v1/contact \
  '{"fullName":"Bot","email":"bot@test.invalid","message":"spam spam spam spam","company":"AcmeBot"}' none
check "El honeypot responde 202 y descarta" \
  "$([[ "$HTTP_STATUS" == 202 && "$(printf '%s' "$HTTP_BODY" | jq -r '.id')" == "discarded" ]] && echo 1 || echo 0)" "status=$HTTP_STATUS"

if [[ -n "$CONTACT_ID" ]]; then
  request GET /admin/contact-messages '' admin
  check "El mensaje aparece en la bandeja admin" \
    "$(printf '%s' "$HTTP_BODY" | jq -e --arg id "$CONTACT_ID" '[.items[] | select(.id==$id)] | length == 1' >/dev/null 2>&1 && echo 1 || echo 0)"
  check "El mensaje resuelve el programa asociado" \
    "$(printf '%s' "$HTTP_BODY" | jq -e --arg id "$CONTACT_ID" '[.items[] | select(.id==$id)][0].programCode != null' >/dev/null 2>&1 && echo 1 || echo 0)"
  check "El honeypot no dejó registro" \
    "$(printf '%s' "$HTTP_BODY" | jq -e '[.items[] | select(.email=="bot@test.invalid")] | length == 0' >/dev/null 2>&1 && echo 1 || echo 0)"

  request PATCH "/admin/contact-messages/${CONTACT_ID}/status" '{"status":"in_progress"}' admin
  check "Cambiar estado del mensaje devuelve 200" "$([[ "$HTTP_STATUS" == 200 ]] && echo 1 || echo 0)" "status=$HTTP_STATUS"
  check "El estado queda registrado con responsable" \
    "$(printf '%s' "$HTTP_BODY" | jq -e '.message.status == "in_progress" and .message.handledBy != null' >/dev/null 2>&1 && echo 1 || echo 0)"

  request PATCH "/admin/contact-messages/${CONTACT_ID}/status" '{"status":"no-existe"}' admin
  check "Estado inválido de mensaje devuelve 400" "$([[ "$HTTP_STATUS" == 400 ]] && echo 1 || echo 0)" "status=$HTTP_STATUS"
fi

# El limite por IP debe disparar al sexto envio desde la misma IP.
RATE_IP="198.51.100.$(( (STAMP % 250) + 1 ))"
rate_status=""
for i in 1 2 3 4 5 6; do
  rate_status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 \
    -X POST "${BASE_URL}/v1/contact" \
    -H 'Content-Type: application/json' \
    -H "X-Forwarded-For: ${RATE_IP}" \
    -d "{\"fullName\":\"Rate ${i}\",\"email\":\"rate${i}@test.invalid\",\"message\":\"Mensaje de prueba del limite por IP numero ${i}.\"}" || echo 000)"
  [[ "$i" -le 5 ]] && check "Envio ${i}/5 dentro del limite se acepta" \
    "$([[ "$rate_status" == 201 ]] && echo 1 || echo 0)" "status=${rate_status}"
done
check "El sexto envio desde la misma IP devuelve 429" \
  "$([[ "$rate_status" == 429 ]] && echo 1 || echo 0)" "status=${rate_status}"

# Falsificar X-Forwarded-For no debe saltarse el limite cuando la peticion no
# viene de un proxy de confianza. En local SI es loopback, asi que aqui solo se
# comprueba que una IP distinta tiene su propio cupo (comportamiento esperado
# detras de Nginx).
fresh_ip="198.51.100.$(( ((STAMP + 7) % 250) + 1 ))"
fresh_status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 \
  -X POST "${BASE_URL}/v1/contact" -H 'Content-Type: application/json' \
  -H "X-Forwarded-For: ${fresh_ip}" \
  -d '{"fullName":"Otra IP","email":"otra@test.invalid","message":"Mensaje desde otra IP distinta."}' || echo 000)"
check "Otra IP conserva su propio cupo" \
  "$([[ "$fresh_status" == 201 ]] && echo 1 || echo 0)" "status=${fresh_status}"

# ---------------------------------------------------------------------------
# 10. 404 coherentes
# ---------------------------------------------------------------------------
request PATCH "/admin/cie/faculty/no-existe" '{"status":"inactive"}' admin
check "PATCH de expediente inexistente devuelve 404" "$([[ "$HTTP_STATUS" == 404 ]] && echo 1 || echo 0)" "status=$HTTP_STATUS"

request PATCH "/admin/cie/document-types/no-existe" '{"displayOrder":1}' admin
check "PATCH de tipo de documento inexistente devuelve 404" "$([[ "$HTTP_STATUS" == 404 ]] && echo 1 || echo 0)" "status=$HTTP_STATUS"

request DELETE "/admin/cie/documents/no-existe" '' admin
check "DELETE de documento inexistente devuelve 404" "$([[ "$HTTP_STATUS" == 404 ]] && echo 1 || echo 0)" "status=$HTTP_STATUS"

fi  # fin del bloque de escritura

# ---------------------------------------------------------------------------
# Resultado
# ---------------------------------------------------------------------------
printf '\n%-6s %s\n' "ESTADO" "VERIFICACIÓN"
printf '%s\n' "------ ----------------------------------------------------------"
for row in "${RESULTS[@]}"; do
  IFS='|' read -r state name detail <<<"$row"
  case "$state" in
    PASS) printf '\033[0;32m%-6s\033[0m %s\n' "PASS" "$name" ;;
    SKIP) printf '\033[0;33m%-6s\033[0m %s — %s\n' "SKIP" "$name" "$detail" ;;
    *)    printf '\033[0;31m%-6s\033[0m %s — %s\n' "FAIL" "$name" "$detail" ;;
  esac
done

printf '\n%d correctas, %d fallidas, %d omitidas\n' "$PASS_COUNT" "$FAIL_COUNT" "$SKIP_COUNT"
[[ "$FAIL_COUNT" -eq 0 ]] || exit 1
log "Etapa I: todas las verificaciones funcionales pasaron"
