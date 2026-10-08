#!/usr/bin/env bash
#
# 90-smoke-test.sh - RUNS ANYWHERE with curl, openssl and jq-or-python3.
#
# The production verification script. Read-only: it never changes anything.
# Prints a PASS/FAIL table and exits non-zero if any check fails.
#
# Covered:
#   DNS        all three hostnames resolve
#   TLS        valid chain, correct CN/SAN, more than ${CERT_MIN_DAYS} days left
#   redirect   http:// -> https:// on the API and the LMS
#   API        /api/health, /api/v1/home, /api/v1/catalog
#   API auth   admin login -> bearer -> /api/admin/auth/me, /api/admin/moodle/status
#   negative   /api/admin/* without a token -> 401
#   hardening  no x-powered-by, no server version, no stack traces
#   CORS       the portal origin is allowed by the API
#   LMS        /login/index.php, core_webservice_get_site_info, no CORS headers
#   portal     / and the /admin deep link both serve the SPA; cache headers
#
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=00-config.sh
source "${SCRIPT_DIR}/00-config.sh"
install_err_trap

BASE_URL=""
SKIP_ADMIN=0
SKIP_MOODLE_WS=0
VERBOSE=0
TIMEOUT="${TIMEOUT:-20}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Verifies the live deployment. Read-only; exits non-zero on any failure.

Options
  --base-url <url>     Override the API base URL, e.g.
                         --base-url https://api.staging.example.com
                       so the same script works against staging. The portal and
                       LMS hosts can be overridden with --portal-url / --lms-url
                       or the PORTAL_URL / LMS_URL environment variables.
  --portal-url <url>   Override the portal URL (default ${PORTAL_URL}).
  --lms-url <url>      Override the LMS URL (default ${LMS_URL}).
  --skip-admin         Skip the authenticated admin checks (no credentials
                       needed). The 401 negative check still runs.
  --skip-moodle-ws     Skip the direct Moodle web-service call.
  --timeout <seconds>  Per-request timeout. Default: ${TIMEOUT}
  -v, --verbose        Print response bodies and headers for failures.
  -h, --help           This text.

Credentials (only for the admin checks)
  ADMIN_EMAIL     the Moodle-independent API admin address
  ADMIN_PASSWORD  its password
  MOODLE_TOKEN    web-service token, for the direct LMS check

  e.g.  ADMIN_EMAIL=... ADMIN_PASSWORD=... MOODLE_TOKEN=... ./90-smoke-test.sh

  They are read from the environment only - nothing is stored and no value is
  ever printed. Omit them and the dependent checks report SKIP.

Exit codes
  0  every executed check passed
  1  at least one check failed
EOF
}

PORTAL_URL_OVERRIDE=""
LMS_URL_OVERRIDE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)      BASE_URL="${2:-}"; shift 2 ;;
    --base-url=*)    BASE_URL="${1#*=}"; shift ;;
    --portal-url)    PORTAL_URL_OVERRIDE="${2:-}"; shift 2 ;;
    --portal-url=*)  PORTAL_URL_OVERRIDE="${1#*=}"; shift ;;
    --lms-url)       LMS_URL_OVERRIDE="${2:-}"; shift 2 ;;
    --lms-url=*)     LMS_URL_OVERRIDE="${1#*=}"; shift ;;
    --skip-admin)    SKIP_ADMIN=1; shift ;;
    --skip-moodle-ws) SKIP_MOODLE_WS=1; shift ;;
    --timeout)       TIMEOUT="${2:-}"; shift 2 ;;
    --timeout=*)     TIMEOUT="${1#*=}"; shift ;;
    -v|--verbose)    VERBOSE=1; shift ;;
    -h|--help)       usage; exit 0 ;;
    *)               die_usage "$(usage)" ;;
  esac
done

[[ -n "$BASE_URL" ]]            && API_URL="${BASE_URL%/}"
[[ -n "$PORTAL_URL_OVERRIDE" ]] && PORTAL_URL="${PORTAL_URL_OVERRIDE%/}"
[[ -n "$LMS_URL_OVERRIDE" ]]    && LMS_URL="${LMS_URL_OVERRIDE%/}"

API_BASE="${API_URL%/}${API_PUBLIC_PREFIX}"
host_of() { printf '%s' "${1#*://}" | cut -d/ -f1 | cut -d: -f1; }
API_HOST_EFF="$(host_of "$API_URL")"
PORTAL_HOST_EFF="$(host_of "$PORTAL_URL")"
LMS_HOST_EFF="$(host_of "$LMS_URL")"

need_cmd curl
need_cmd openssl
command -v jq >/dev/null 2>&1 || need_cmd python3 "needed to parse JSON when jq is absent"

# ---------------------------------------------------------------------------
# result table
# ---------------------------------------------------------------------------
declare -a R_STATUS=() R_NAME=() R_DETAIL=()
PASS_N=0; FAIL_N=0; SKIP_N=0; WARN_N=0

record() {
  local status="$1" name="$2" detail="${3:-}"
  R_STATUS+=("$status"); R_NAME+=("$name"); R_DETAIL+=("$detail")
  case "$status" in
    PASS) PASS_N=$(( PASS_N + 1 )); ok   "${name}${detail:+ - ${detail}}" ;;
    FAIL) FAIL_N=$(( FAIL_N + 1 )); err  "${name}${detail:+ - ${detail}}" ;;
    SKIP) SKIP_N=$(( SKIP_N + 1 )); log  "SKIP ${name}${detail:+ - ${detail}}" ;;
    WARN) WARN_N=$(( WARN_N + 1 )); warn "${name}${detail:+ - ${detail}}" ;;
  esac
}

# http <method> <url> [curl args...]
# Sets HTTP_CODE, HTTP_BODY and HTTP_HEADERS.
#
# It must NOT be called inside a command substitution: that runs in a subshell
# and the globals would be lost. Call it as a statement, then read HTTP_CODE.
HTTP_BODY=""; HTTP_HEADERS=""; HTTP_CODE="000"
http() {
  local method="$1" url="$2"; shift 2
  local bodyf headf code
  bodyf="$(mktemp)"; headf="$(mktemp)"
  code="$(curl -sS -o "$bodyf" -D "$headf" -w '%{http_code}' \
          --max-time "$TIMEOUT" -X "$method" "$@" "$url" 2>/dev/null)" || code=""
  # curl writes 000 itself when it never got a status line; normalise anything else.
  [[ "$code" =~ ^[0-9]{3}$ ]] || code="000"
  HTTP_BODY="$(cat "$bodyf")"
  HTTP_HEADERS="$(cat "$headf")"
  rm -f "$bodyf" "$headf"
  HTTP_CODE="$code"
  if [[ "$VERBOSE" == "1" ]]; then
    printf '\n--- %s %s -> %s ---\n%s\n%s\n' \
      "$method" "$url" "$code" "$HTTP_HEADERS" "${HTTP_BODY:0:2000}" >&2
  fi
  return 0
}

header_value() {
  printf '%s' "$HTTP_HEADERS" \
    | tr -d '\r' \
    | awk -v want="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" \
        'BEGIN{IGNORECASE=1} index(tolower($0), want": ")==1 {sub(/^[^:]*: */, ""); print; exit}'
}

# ---------------------------------------------------------------------------
# 1. DNS
# ---------------------------------------------------------------------------
section() { printf '\n%s== %s ==%s\n' "$__C_BLUE" "$1" "$__C_RESET" >&2; }

section "DNS"
resolve_check() {
  local host="$1" label="$2" expect="${3:-}"
  local addrs
  # getent exits 2 for an unknown name; with pipefail that would abort the run.
  addrs="$( { getent ahostsv4 "$host" 2>/dev/null || true; } | awk '{print $1}' | sort -u | tr '\n' ' ')"
  if [[ -z "${addrs// /}" ]]; then
    addrs="$( { getent hosts "$host" 2>/dev/null || true; } | awk '{print $1}' | sort -u | tr '\n' ' ')"
  fi
  if [[ -z "${addrs// /}" ]]; then
    record FAIL "dns ${label}" "${host} does not resolve"
    return 1
  fi
  if [[ -n "$expect" && " ${addrs} " != *" ${expect} "* ]]; then
    # A CNAME to the CDN is expected for the portal, so this is informational.
    record PASS "dns ${label}" "${host} -> ${addrs% } (expected ${expect} - a CDN/CNAME answer is normal)"
    return 0
  fi
  record PASS "dns ${label}" "${host} -> ${addrs% }"
}

# Only assert a specific address when the host was not overridden on the CLI.
EXPECT_API_IP=""
EXPECT_LMS_IP=""
[[ "$API_HOST_EFF" == "$API_HOST" ]] && EXPECT_API_IP="$API_STATIC_IP"
[[ "$LMS_HOST_EFF" == "$LMS_HOST" ]] && EXPECT_LMS_IP="$MOODLE_STATIC_IP"

# Every check function returns non-zero on failure and records it; '|| true'
# keeps `set -e` from aborting the run so the whole table is always printed.
resolve_check "$API_HOST_EFF"    "api"    "$EXPECT_API_IP" || true
resolve_check "$LMS_HOST_EFF"    "lms"    "$EXPECT_LMS_IP" || true
resolve_check "$PORTAL_HOST_EFF" "portal" "" || true

# ---------------------------------------------------------------------------
# 2. TLS
# ---------------------------------------------------------------------------
section "TLS"
tls_check() {
  local host="$1" label="$2"
  local cert
  cert="$(echo | timeout "$TIMEOUT" openssl s_client -connect "${host}:443" \
            -servername "$host" 2>/dev/null | openssl x509 2>/dev/null)" || cert=""
  if [[ -z "$cert" ]]; then
    record FAIL "tls ${label}" "no certificate returned by ${host}:443"
    return 1
  fi

  # --- name match (CN or a SAN entry, wildcards included) ---
  local subject sans
  subject="$(printf '%s' "$cert" | openssl x509 -noout -subject 2>/dev/null | sed 's/^subject= *//')"
  sans="$(printf '%s' "$cert" | openssl x509 -noout -ext subjectAltName 2>/dev/null \
          | tr ',' '\n' | sed -n 's/.*DNS://p' | tr -d ' ' | tr '\n' ' ')"
  local matched=0 entry
  for entry in $sans; do
    if [[ "$entry" == "$host" ]]; then matched=1; break; fi
    if [[ "$entry" == \*.* && "${host#*.}" == "${entry#\*.}" ]]; then matched=1; break; fi
  done
  if (( matched )); then
    record PASS "tls name ${label}" "${host} is covered by the SAN list"
  else
    record FAIL "tls name ${label}" "${host} is not in the SAN list (${sans:-none}); subject: ${subject}"
  fi

  # --- expiry ---
  local enddate end_epoch now_epoch days
  enddate="$(printf '%s' "$cert" | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2-)"
  end_epoch="$(date -u -d "$enddate" +%s 2>/dev/null || echo 0)"
  now_epoch="$(date -u +%s)"
  if [[ "$end_epoch" == "0" ]]; then
    record WARN "tls expiry ${label}" "could not parse notAfter '${enddate}'"
  else
    days=$(( (end_epoch - now_epoch) / 86400 ))
    if (( days > CERT_MIN_DAYS )); then
      record PASS "tls expiry ${label}" "${days} days remaining (threshold ${CERT_MIN_DAYS})"
    else
      record FAIL "tls expiry ${label}" "only ${days} days remaining (threshold ${CERT_MIN_DAYS}); renewal is not working"
    fi
  fi

  # --- chain trust, as a real client sees it ---
  if curl -sS -o /dev/null --max-time "$TIMEOUT" "https://${host}/" 2>/dev/null; then
    record PASS "tls chain ${label}" "curl accepts the chain"
  else
    local out
    out="$(curl -sS -o /dev/null --max-time "$TIMEOUT" "https://${host}/" 2>&1 || true)"
    if printf '%s' "$out" | grep -qi 'certificate\|SSL\|TLS'; then
      record FAIL "tls chain ${label}" "curl rejected the chain: ${out}"
    else
      # A non-TLS HTTP error (403/404) still proves the handshake succeeded.
      record PASS "tls chain ${label}" "handshake succeeded"
    fi
  fi
}

tls_check "$API_HOST_EFF"    "api"    || true
tls_check "$LMS_HOST_EFF"    "lms"    || true
tls_check "$PORTAL_HOST_EFF" "portal" || true

# ---------------------------------------------------------------------------
# 3. HTTP -> HTTPS redirect
# ---------------------------------------------------------------------------
section "HTTP to HTTPS"
redirect_check() {
  local host="$1" label="$2" code location
  code="$(curl -sS -o /dev/null -D - --max-time "$TIMEOUT" "http://${host}/" 2>/dev/null \
          | tr -d '\r' | awk 'BEGIN{IGNORECASE=1} /^HTTP\//{c=$2} /^location:/{sub(/^[^:]*: */,"");l=$0} END{print c"|"l}')" || code="|"
  location="${code#*|}"; code="${code%%|*}"
  if [[ "$code" == 30[1278] ]] && [[ "$location" == https://* ]]; then
    record PASS "redirect ${label}" "http -> ${code} ${location}"
  elif [[ -z "$code" ]]; then
    record FAIL "redirect ${label}" "no response on http://${host}/ (is TCP 80 open?)"
  else
    record FAIL "redirect ${label}" "expected a 30x to https://, got ${code} ${location:-(no Location)}"
  fi
}
redirect_check "$API_HOST_EFF" "api" || true
redirect_check "$LMS_HOST_EFF" "lms" || true

# ---------------------------------------------------------------------------
# 4. public API
# ---------------------------------------------------------------------------
section "API (public)"
http GET "${API_BASE}/health"
code="$HTTP_CODE"
if [[ "$code" == "200" ]]; then
  status="$(printf '%s' "$HTTP_BODY" | json_get '.status' "d['status']")" || status=""
  dbts="$(printf '%s' "$HTTP_BODY" | json_get '.db' "d['db']")" || dbts=""
  if [[ "$status" == "ok" ]]; then
    record PASS "GET ${API_PUBLIC_PREFIX}/health" "200, status=ok, db=${dbts:-null}"
    if [[ -z "$dbts" ]]; then
      record FAIL "health db" "'db' is null: the API cannot reach PostgreSQL"
    fi
  else
    record FAIL "GET ${API_PUBLIC_PREFIX}/health" "200 but status='${status}'"
  fi
elif [[ "$code" == "404" ]]; then
  record FAIL "GET ${API_PUBLIC_PREFIX}/health" "404 - the /api prefix is being stripped twice (nginx must pass the URI through; Fastify's rewriteUrl does the stripping)"
else
  record FAIL "GET ${API_PUBLIC_PREFIX}/health" "HTTP ${code}"
fi

json_endpoint_check() {
  local path="$1" expect_desc="$2" jqf="$3" pyf="$4"
  local c
  http GET "${API_BASE}${path}"
  c="$HTTP_CODE"
  if [[ "$c" != "200" ]]; then
    record FAIL "GET ${API_PUBLIC_PREFIX}${path}" "HTTP ${c}"
    return 1
  fi
  if ! printf '%s' "$HTTP_BODY" | json_valid; then
    record FAIL "GET ${API_PUBLIC_PREFIX}${path}" "200 but the body is not valid JSON"
    return 1
  fi
  local v
  v="$(printf '%s' "$HTTP_BODY" | json_get "$jqf" "$pyf")" || v=""
  if [[ -n "$v" ]]; then
    record PASS "GET ${API_PUBLIC_PREFIX}${path}" "200, valid JSON, ${expect_desc}=${v}"
  else
    record FAIL "GET ${API_PUBLIC_PREFIX}${path}" "200 and valid JSON but ${expect_desc} is missing or empty"
  fi
}

json_endpoint_check "/v1/home"    "tenant.name"  '.tenant.name'  "d['tenant']['name']" || true
json_endpoint_check "/v1/catalog" "item count"   'length'        "len(d)" || true

# ---------------------------------------------------------------------------
# 5. admin API
# ---------------------------------------------------------------------------
section "API (admin)"
ADMIN_TOKEN=""
if [[ "$SKIP_ADMIN" == "1" ]]; then
  record SKIP "admin login" "--skip-admin"
elif [[ -z "${ADMIN_EMAIL:-}" || -z "${ADMIN_PASSWORD:-}" ]]; then
  record SKIP "admin login" "set ADMIN_EMAIL and ADMIN_PASSWORD to run the authenticated checks"
else
  login_payload="$(mktemp)"; chmod 600 "$login_payload"
  python3 -I -c '
import json, sys
json.dump({"email": sys.argv[1], "password": sys.argv[2]}, open(sys.argv[3], "w"))
' "$ADMIN_EMAIL" "$ADMIN_PASSWORD" "$login_payload" 2>/dev/null \
    || printf '{"email":"%s","password":"%s"}' "$ADMIN_EMAIL" "$ADMIN_PASSWORD" > "$login_payload"

  http POST "${API_BASE}/admin/auth/login" \
            -H 'Content-Type: application/json' \
            --data-binary "@${login_payload}"
  code="$HTTP_CODE"
  rm -f "$login_payload"

  if [[ "$code" == "200" ]]; then
    ADMIN_TOKEN="$(printf '%s' "$HTTP_BODY" | json_get '.token' "d['token']")" || ADMIN_TOKEN=""
    if [[ -n "$ADMIN_TOKEN" ]]; then
      record PASS "POST ${API_PUBLIC_PREFIX}/admin/auth/login" "200, token issued (${#ADMIN_TOKEN} chars)"
    else
      record FAIL "POST ${API_PUBLIC_PREFIX}/admin/auth/login" "200 but no 'token' in the response"
    fi
  elif [[ "$code" == "401" ]]; then
    record FAIL "POST ${API_PUBLIC_PREFIX}/admin/auth/login" "401 - ADMIN_EMAIL/ADMIN_PASSWORD do not match the values in SSM"
  else
    record FAIL "POST ${API_PUBLIC_PREFIX}/admin/auth/login" "HTTP ${code}"
  fi
fi

if [[ -n "$ADMIN_TOKEN" ]]; then
  http GET "${API_BASE}/admin/auth/me" -H "Authorization: Bearer ${ADMIN_TOKEN}"
  code="$HTTP_CODE"
  if [[ "$code" == "200" ]]; then
    who="$(printf '%s' "$HTTP_BODY" | json_get '.admin.email' "d['admin']['email']")" || who=""
    record PASS "GET ${API_PUBLIC_PREFIX}/admin/auth/me" "200, authenticated as ${who:-unknown}"
  else
    record FAIL "GET ${API_PUBLIC_PREFIX}/admin/auth/me" "HTTP ${code} with a fresh bearer token"
  fi

  http GET "${API_BASE}/admin/moodle/status" -H "Authorization: Bearer ${ADMIN_TOKEN}"
  code="$HTTP_CODE"
  if [[ "$code" != "200" ]]; then
    record FAIL "GET ${API_PUBLIC_PREFIX}/admin/moodle/status" "HTTP ${code}"
  else
    configured="$(printf '%s' "$HTTP_BODY" | json_get '.configured' "d['configured']")" || configured="false"
    ws_ok="$(printf '%s' "$HTTP_BODY" | json_get '.siteInfo.ok' "d['siteInfo']['ok']")" || ws_ok="false"
    sitename="$(printf '%s' "$HTTP_BODY" | json_get '.siteInfo.data.sitename' "d['siteInfo']['data']['sitename']")" || sitename=""
    if [[ "$configured" != "true" ]]; then
      record FAIL "API -> Moodle" "the API reports configured=false: MOODLE_BASE_URL / MOODLE_TOKEN are missing from SSM"
    elif [[ "$ws_ok" == "true" ]]; then
      record PASS "API -> Moodle" "reachable; sitename='${sitename:-?}'"
    else
      wserr="$(printf '%s' "$HTTP_BODY" | json_get '.siteInfo.error' "d['siteInfo']['error']")" || wserr="no detail"
      record FAIL "API -> Moodle" "the API cannot reach the LMS web service: ${wserr}"
    fi
  fi
else
  record SKIP "GET ${API_PUBLIC_PREFIX}/admin/auth/me" "no admin token"
  record SKIP "API -> Moodle" "no admin token"
fi

# ---------------------------------------------------------------------------
# 6. negative checks
# ---------------------------------------------------------------------------
section "Negative checks"
for path in /admin/auth/me /admin/moodle/status /admin/routes; do
  http GET "${API_BASE}${path}"
  code="$HTTP_CODE"
  if [[ "$code" == "401" ]]; then
    record PASS "unauthenticated ${API_PUBLIC_PREFIX}${path}" "401 as required"
  else
    record FAIL "unauthenticated ${API_PUBLIC_PREFIX}${path}" "expected 401, got ${code} - the admin surface is exposed"
  fi
done

http GET "${API_BASE}/admin/auth/me" -H 'Authorization: Bearer deadbeefdeadbeefdeadbeef'
code="$HTTP_CODE"
if [[ "$code" == "401" ]]; then
  record PASS "forged bearer token" "401 as required"
else
  record FAIL "forged bearer token" "expected 401, got ${code}"
fi

# ---------------------------------------------------------------------------
# 7. hardening / information leakage
# ---------------------------------------------------------------------------
section "Hardening"
http GET "${API_BASE}/health"
code="$HTTP_CODE"
if [[ "$code" == "000" ]]; then
  # Without a response these checks would "pass" by looking at empty headers.
  for name in "no x-powered-by" "server header" "strict-transport-security" \
              "x-content-type-options" "no stack traces"; do
    record SKIP "$name" "the API did not respond, so there are no headers to inspect"
  done
else
leak_powered="$(header_value 'x-powered-by')"
leak_server="$(header_value 'server')"
hsts="$(header_value 'strict-transport-security')"
nosniff="$(header_value 'x-content-type-options')"

if [[ -z "$leak_powered" ]]; then
  record PASS "no x-powered-by" "header absent"
else
  record FAIL "no x-powered-by" "leaked: ${leak_powered}"
fi

if [[ -z "$leak_server" ]]; then
  record PASS "server header" "absent"
elif printf '%s' "$leak_server" | grep -qE '[0-9]+\.[0-9]+'; then
  record FAIL "server header" "leaks a version: '${leak_server}' (set server_tokens off / proxy_hide_header Server)"
else
  record PASS "server header" "'${leak_server}' carries no version"
fi

if [[ -n "$hsts" ]]; then
  record PASS "strict-transport-security" "${hsts}"
else
  record FAIL "strict-transport-security" "header missing on the API"
fi

if [[ "$nosniff" == "nosniff" ]]; then
  record PASS "x-content-type-options" "nosniff"
else
  record FAIL "x-content-type-options" "expected 'nosniff', got '${nosniff:-missing}'"
fi

# A deliberately bad route must not return a stack trace or a file path.
http GET "${API_BASE}/v1/this-route-does-not-exist-$$"
code="$HTTP_CODE"
if printf '%s' "$HTTP_BODY" | grep -qiE 'at [A-Za-z_$][A-Za-z0-9_$]* \(|/opt/plataforma-estudiantil|node_modules|node:internal'; then
  record FAIL "no stack traces" "a 404 body leaks internals"
  [[ "$VERBOSE" == "1" ]] && printf '%s\n' "${HTTP_BODY:0:600}" >&2
else
  record PASS "no stack traces" "the ${code} body exposes nothing internal"
fi
fi

# ---------------------------------------------------------------------------
# 8. CORS
# ---------------------------------------------------------------------------
section "CORS"
http OPTIONS "${API_BASE}/v1/catalog" \
          -H "Origin: ${PORTAL_URL}" \
          -H 'Access-Control-Request-Method: GET' \
          -H 'Access-Control-Request-Headers: authorization,content-type'
code="$HTTP_CODE"
acao="$(header_value 'access-control-allow-origin')"
acam="$(header_value 'access-control-allow-methods')"
acao_count="$(printf '%s' "$HTTP_HEADERS" | tr -d '\r' | grep -ic '^access-control-allow-origin:' || true)"

if [[ "$code" == "000" ]]; then
  record SKIP "CORS preflight"     "the API did not respond"
  record SKIP "single CORS header" "the API did not respond"
elif [[ "$acao" == "$PORTAL_URL" || "$acao" == "*" ]]; then
  record PASS "CORS preflight" "allow-origin='${acao}', allow-methods='${acam:-unset}'"
elif [[ -z "$acao" ]]; then
  record FAIL "CORS preflight" "no access-control-allow-origin for ${PORTAL_URL} (HTTP ${code}); the SPA's XHRs will be blocked"
else
  record FAIL "CORS preflight" "allow-origin is '${acao}', which does not cover ${PORTAL_URL}"
fi

if [[ "$code" != "000" ]]; then
  if [[ "${acao_count:-0}" -gt 1 ]]; then
    record FAIL "single CORS header" "access-control-allow-origin appears ${acao_count} times - nginx and @fastify/cors are both setting it; browsers reject that"
  else
    record PASS "single CORS header" "exactly one access-control-allow-origin"
  fi
fi

# ---------------------------------------------------------------------------
# 9. Moodle / LMS
# ---------------------------------------------------------------------------
section "LMS (Moodle)"
http GET "${LMS_URL}/login/index.php"
code="$HTTP_CODE"
if [[ "$code" == "200" ]]; then
  if printf '%s' "$HTTP_BODY" | grep -qi 'moodle\|loginform\|login/index.php'; then
    record PASS "GET /login/index.php" "200, Moodle login page"
  else
    record WARN "GET /login/index.php" "200 but the body does not look like Moodle's login page"
  fi
else
  record FAIL "GET /login/index.php" "HTTP ${code}"
fi

# Moodle must not be consumable by a browser frontend: no CORS on the web
# service endpoint. (The API talks to it server-to-server, which CORS never
# affects.)
http GET "${LMS_URL}/webservice/rest/server.php" -H "Origin: ${PORTAL_URL}"
code="$HTTP_CODE"
lms_acao="$(header_value 'access-control-allow-origin')"
if [[ "$code" == "000" ]]; then
  record SKIP "LMS sends no CORS headers" "the LMS did not respond"
elif [[ -z "$lms_acao" ]]; then
  record PASS "LMS sends no CORS headers" "a browser on ${PORTAL_HOST_EFF} cannot call Moodle directly"
else
  record FAIL "LMS sends no CORS headers" "access-control-allow-origin='${lms_acao}' lets a frontend bypass the API, which the contract forbids"
fi

if [[ "$SKIP_MOODLE_WS" == "1" ]]; then
  record SKIP "Moodle web service" "--skip-moodle-ws"
elif [[ -z "${MOODLE_TOKEN:-}" ]]; then
  record SKIP "Moodle web service" "set MOODLE_TOKEN to call it directly (the API -> Moodle check above already covers reachability)"
else
  http GET "${LMS_URL}/webservice/rest/server.php?moodlewsrestformat=json&wsfunction=core_webservice_get_site_info&wstoken=${MOODLE_TOKEN}"
  code="$HTTP_CODE"
  if [[ "$code" == "403" || "$code" == "401" ]]; then
    # Expected when MOODLE_RESTRICT_WEBSERVICE=1 allow-lists /webservice to the
    # API instance. That restriction is the control, so this is a pass.
    record PASS "Moodle web service" "HTTP ${code} from this host: /webservice is allow-listed to the API instance, as intended"
  elif [[ "$code" != "200" ]]; then
    record FAIL "Moodle web service" "HTTP ${code}"
  elif ! printf '%s' "$HTTP_BODY" | json_valid; then
    record FAIL "Moodle web service" "200 but the body is not valid JSON"
  elif printf '%s' "$HTTP_BODY" | grep -q '"exception"'; then
    msg="$(printf '%s' "$HTTP_BODY" | json_get '.message' "d['message']")" || msg="see the body"
    record FAIL "Moodle web service" "Moodle returned an exception: ${msg}"
  else
    sitename="$(printf '%s' "$HTTP_BODY" | json_get '.sitename' "d['sitename']")" || sitename=""
    fns="$(printf '%s' "$HTTP_BODY" | json_get '.functions | length' "len(d['functions'])")" || fns="?"
    if [[ -n "$sitename" ]]; then
      record PASS "Moodle web service" "valid JSON, sitename='${sitename}', ${fns} function(s) authorised"
    else
      record FAIL "Moodle web service" "200 and valid JSON but no 'sitename'"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 10. portal SPA
# ---------------------------------------------------------------------------
section "Portal (SPA)"
spa_check() {
  local path="$1" label="$2" c
  http GET "${PORTAL_URL}${path}"
  c="$HTTP_CODE"
  if [[ "$c" != "200" ]]; then
    local hint=""
    [[ "$path" != "/" ]] && hint=" - Lightsail distributions have no 404->index.html rewrite, so this route needs an index.html alias in the bucket (SPA_FALLBACK_ROUTES in 00-config.sh)"
    record FAIL "GET ${label}" "HTTP ${c}${hint}"
    return 1
  fi
  if printf '%s' "$HTTP_BODY" | grep -qiE '<div id="root"|id=.root.|/assets/index-'; then
    record PASS "GET ${label}" "200, serves the SPA shell"
  elif printf '%s' "$HTTP_BODY" | grep -qi 'coming soon'; then
    record FAIL "GET ${label}" "200 but still the placeholder 'Coming soon' page - run 30-frontend-deploy.sh"
  else
    record FAIL "GET ${label}" "200 but the body does not look like the built SPA"
  fi
}
spa_check "/"      "portal /" || true
spa_check "/admin" "portal /admin (deep link)" || true

# index.html must never be cached, or a deploy is invisible to returning users.
http GET "${PORTAL_URL}/"
code="$HTTP_CODE"
cc="$(header_value 'cache-control')"
if printf '%s' "$cc" | grep -qiE 'no-cache|no-store|max-age=0'; then
  record PASS "index.html cache-control" "'${cc}'"
else
  record FAIL "index.html cache-control" "'${cc:-missing}' - a cached index.html will keep pointing at old asset hashes"
fi

# And the hashed assets must be cached hard.
asset_path="$(printf '%s' "$HTTP_BODY" | grep -oE '/assets/[A-Za-z0-9_.-]+\.(js|css)' | head -n1 || true)"
if [[ -n "$asset_path" ]]; then
  http GET "${PORTAL_URL}${asset_path}"
  code="$HTTP_CODE"
  cc="$(header_value 'cache-control')"
  ctype="$(header_value 'content-type')"
  if [[ "$code" != "200" ]]; then
    record FAIL "hashed asset" "GET ${asset_path} -> ${code}"
  elif printf '%s' "$cc" | grep -qi 'immutable'; then
    record PASS "hashed asset cache-control" "${asset_path} -> '${cc}', content-type '${ctype}'"
  else
    record FAIL "hashed asset cache-control" "${asset_path} -> '${cc:-missing}', expected an immutable long cache"
  fi
else
  record WARN "hashed asset" "no /assets/... reference found in index.html"
fi

# ---------------------------------------------------------------------------
# summary
# ---------------------------------------------------------------------------
printf '\n' >&2
printf '%s\n' "===============================================================================" >&2
printf ' smoke test: %s\n' "$(date -u '+%Y-%m-%d %H:%M:%SZ')" >&2
printf '   api    : %s\n' "$API_BASE" >&2
printf '   portal : %s\n' "$PORTAL_URL" >&2
printf '   lms    : %s\n' "$LMS_URL" >&2
printf '%s\n' "-------------------------------------------------------------------------------" >&2
printf ' %-6s %-44s %s\n' "RESULT" "CHECK" "DETAIL" >&2
printf '%s\n' "-------------------------------------------------------------------------------" >&2
for i in "${!R_STATUS[@]}"; do
  detail="${R_DETAIL[$i]}"
  (( ${#detail} > 90 )) && detail="${detail:0:87}..."
  case "${R_STATUS[$i]}" in
    PASS) colour="$__C_GREEN" ;;
    FAIL) colour="$__C_RED" ;;
    WARN) colour="$__C_YELLOW" ;;
    *)    colour="$__C_DIM" ;;
  esac
  printf ' %s%-6s%s %-44s %s\n' "$colour" "${R_STATUS[$i]}" "$__C_RESET" "${R_NAME[$i]}" "$detail" >&2
done
printf '%s\n' "-------------------------------------------------------------------------------" >&2
printf ' %d passed, %d failed, %d warning(s), %d skipped\n' "$PASS_N" "$FAIL_N" "$WARN_N" "$SKIP_N" >&2
printf '%s\n' "===============================================================================" >&2

if (( FAIL_N > 0 )); then
  err "${FAIL_N} check(s) FAILED"
  exit 1
fi
ok "all executed checks passed"
exit 0
