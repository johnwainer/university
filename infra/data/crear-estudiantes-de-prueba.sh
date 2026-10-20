#!/usr/bin/env bash
#
# crear-estudiantes-de-prueba.sh — dos estudiantes con los que TFU puede
# recorrer la plataforma entera.
#
# POR QUE EXISTE
#
# TFU pidio: «we would like to test how it looks with two student profiles to
# assess its functionality, interactions and notifications». Hoy solo existe
# demo.estudiante@thefloridianuniversity.com y NADIE CONOCE SU CONTRASENA
# (§8.2 del traspaso), asi que no hay forma de entrar y mirar.
#
# Esto crea dos cuentas nuevas con contrasena conocida, cada una matriculada en
# un programa, usando las MISMAS rutas que usa el portal. No toca la base a
# mano: el alta publica crea tambien el usuario de Moodle, y la matricula por
# programa escribe el SIS y el espejo del aula. Replicar eso con SQL seria
# reimplementar dos modulos y acabaria desincronizado.
#
# DONDE SE EJECUTA
#   En el servidor del API (ubuntu@44.210.204.140) o desde cualquier sitio que
#   alcance la API publica. Necesita ADMIN_API_KEY para la matricula.
#
# USO
#   ADMIN_API_KEY=... bash crear-estudiantes-de-prueba.sh
#   ADMIN_API_KEY=... API=https://api.portal.thefloridianuniversity.com/api \
#     PROGRAMA_1=TFU-AI-WORK PROGRAMA_2=TFU-SALES-EXC \
#     bash crear-estudiantes-de-prueba.sh
#
# IDEMPOTENTE: si la cuenta ya existe, inicia sesion en vez de crearla y sigue
# con la matricula. Volver a correrlo no duplica nada.
#
# IMPORTANTE: imprime las contrasenas en pantalla A PROPOSITO — son cuentas de
# prueba que hay que entregar a TFU. No uses este guion para cuentas reales.
set -Eeuo pipefail

API="${API:-https://api.portal.thefloridianuniversity.com/api}"
PROGRAMA_1="${PROGRAMA_1:-TFU-AI-WORK}"
PROGRAMA_2="${PROGRAMA_2:-TFU-SALES-EXC}"
DOMINIO="${DOMINIO:-thefloridianuniversity.com}"

if [[ -z "${ADMIN_API_KEY:-}" ]]; then
  echo "Falta ADMIN_API_KEY. Leela del .env del servicio, no la escribas aqui:" >&2
  echo "  export ADMIN_API_KEY=\$(sudo grep -m1 '^ADMIN_API_KEY=' /opt/plataforma-estudiantil/api/current/.env | cut -d= -f2-)" >&2
  exit 2
fi

need() { command -v "$1" >/dev/null || { echo "Falta '$1'." >&2; exit 2; }; }
need curl
need python3

json() { python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get(sys.argv[1]) or "")' "$1"; }

crear_estudiante() {
  local nombre="$1" correo="$2" clave="$3" locale="$4" programa="$5"

  echo "--- ${nombre} <${correo}> ---"

  local alta token
  alta="$(curl -s -X POST "${API}/v1/auth/register" \
    -H 'content-type: application/json' \
    -d "{\"fullName\":\"${nombre}\",\"email\":\"${correo}\",\"password\":\"${clave}\",\"locale\":\"${locale}\"}" || true)"
  token="$(printf '%s' "$alta" | json token)"

  if [[ -z "$token" ]]; then
    # Ya existia: se entra con la contrasena conocida. Si tampoco entra, la
    # cuenta existe con OTRA contrasena y hay que decirlo en vez de seguir.
    echo "    el alta no devolvio sesion; probando a iniciar sesion"
    local sesion
    sesion="$(curl -s -X POST "${API}/v1/auth/login" \
      -H 'content-type: application/json' \
      -d "{\"email\":\"${correo}\",\"password\":\"${clave}\"}" || true)"
    token="$(printf '%s' "$sesion" | json token)"
    if [[ -z "$token" ]]; then
      echo "    ERROR: la cuenta existe con otra contrasena, o el alta fallo." >&2
      echo "    respuesta del alta: ${alta}" >&2
      return 1
    fi
    echo "    sesion iniciada con la cuenta existente"
  else
    echo "    cuenta creada"
  fi

  # El id del usuario sale de la propia sesion.
  local userId
  userId="$(curl -s "${API}/v1/auth/me" -H "authorization: Bearer ${token}" \
    | python3 -c 'import sys,json;d=json.load(sys.stdin);u=d.get("user") or d;print(u.get("id",""))')"
  if [[ -z "$userId" ]]; then
    echo "    ERROR: no se pudo resolver el id del usuario." >&2
    return 1
  fi
  echo "    id: ${userId}"

  # Matricula por PROGRAMA, que es la unidad del modelo: escribe el SIS y abre
  # las aulas del programa en Moodle.
  local matricula
  matricula="$(curl -s -X POST "${API}/admin/users/${userId}/program-enrollments" \
    -H "x-admin-key: ${ADMIN_API_KEY}" -H 'content-type: application/json' \
    -d "{\"programCode\":\"${programa}\"}")"
  echo "    matricula en ${programa}: $(printf '%s' "$matricula" | head -c 300)"
  echo "    CREDENCIALES PARA TFU -> ${correo} / ${clave}"
  echo
}

echo "API: ${API}"
echo

# Dos perfiles distintos a proposito: uno en ingles y otro en espanol, para que
# TFU vea el portal y el aula en los dos idiomas sin tocar nada.
crear_estudiante "Taylor Reed"   "taylor.reed@${DOMINIO}"   'PruebaTFU2026!Uno' 'en' "${PROGRAMA_1}"
crear_estudiante "Marcela Ortiz" "marcela.ortiz@${DOMINIO}" 'PruebaTFU2026!Dos' 'es' "${PROGRAMA_2}"

cat <<'FIN'
Siguientes pasos para que TFU pueda evaluar interacciones y notificaciones:

  1. Entra con cada cuenta en https://portal.thefloridianuniversity.com
     y abre «Mis cursos» -> el aula del programa.
  2. Responde una actividad y marcala como hecha: eso escribe la interaccion y
     el avance, que son los datos que alimentan el panel.
  3. Los avisos de aula quedan REGISTRADOS pero no se envian mientras TFU no
     entregue las credenciales SMTP (SMTP_URL). Es lo esperado, no un fallo.
FIN
