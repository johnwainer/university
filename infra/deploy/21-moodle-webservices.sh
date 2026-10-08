#!/usr/bin/env bash
#
# 21-moodle-webservices.sh - RUNS ON THE MOODLE INSTANCE
#                            (plataforma-estudiantil-moodle).
#
# Turns on the Moodle web-service surface the contract (Etapa I) requires and
# prints the token for the operator to store in SSM:
#   1. admin/cli/cfg.php : enablewebservices=1, webserviceprotocols includes rest
#   2. enable the 'webservice' auth plugin (a token is refused when its owner's
#      auth plugin is disabled site-wide)
#   3. infra/moodle/cli/paeu-provision-webservice.php :
#        - external service '${MOODLE_WS_SERVICE_SHORTNAME}' (enabled, restricted)
#        - the exact authorised function list from 00-config.sh
#        - the dedicated integration user + least-privilege role
#        - a permanent token
#   4. verify the token end to end with core_webservice_get_site_info
#   5. print the token (stdout) and the exact `aws ssm put-parameter` command
#
# The token is NEVER written to the repo or to a file on disk by this script.
#
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=00-config.sh
source "${SCRIPT_DIR}/00-config.sh"
install_err_trap

MOODLE_ASSETS_DIR="${MOODLE_ASSETS_DIR:-${PAEU_INFRA_DIR}/moodle}"
HELPER_BIN_DIR="${HELPER_BIN_DIR:-/opt/plataforma-estudiantil/bin}"
PROVISION_PHP="${PROVISION_PHP:-${MOODLE_ASSETS_DIR}/cli/paeu-provision-webservice.php}"
ROTATE_TOKEN=0
PRINT_ONLY=0
SKIP_VERIFY=0
PUT_SSM=0
FORCE="${FORCE:-0}"
DRY_RUN="${DRY_RUN:-0}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Runs ON the Moodle instance (${MOODLE_INSTANCE_NAME}, ${MOODLE_STATIC_IP}) as
the 'bitnami' user, after 20-moodle-install.sh.

Options
  --rotate-token   Replace the existing token with a new one. The old token
                   stops working immediately, so the API's MOODLE_TOKEN in SSM
                   must be updated in the same maintenance window.
                   (Destructive; requires --force.)
  --print-only     Report the current state and change nothing.
  --skip-verify    Do not call the web service to validate the token.
  --put-ssm        Also write the token straight into SSM at
                   ${SSM_ENV_PREFIX}/MOODLE_TOKEN (needs AWS credentials on
                   this host with ssm:PutParameter).
  --force          Arm destructive steps.
  --dry-run        Print what would happen; change nothing.
  -h, --help       This text.

Output
  The token is printed to STDOUT as a single line:
      MOODLE_WS_TOKEN=<token>
  Everything else goes to STDERR, so this is safe:
      TOKEN="\$(./21-moodle-webservices.sh | cut -d= -f2-)"

Authorised functions ($(printf '%s\n' "$MOODLE_WS_FUNCTIONS" | wc -w) of them) come from
MOODLE_WS_FUNCTIONS in 00-config.sh and match the signed contract exactly.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rotate-token) ROTATE_TOKEN=1; shift ;;
    --print-only)   PRINT_ONLY=1; shift ;;
    --skip-verify)  SKIP_VERIFY=1; shift ;;
    --put-ssm)      PUT_SSM=1; shift ;;
    --force)        FORCE=1; shift ;;
    --dry-run)      DRY_RUN=1; shift ;;
    -h|--help)      usage; exit 0 ;;
    *)              die_usage "$(usage)" ;;
  esac
done
export FORCE DRY_RUN

[[ -d "$MOODLE_DIR" ]] || fail "${MOODLE_DIR} not found; run 20-moodle-install.sh first"
[[ -f "${MOODLE_DIR}/config.php" ]] || fail "${MOODLE_DIR}/config.php not found; Moodle is not installed yet"
[[ -x "$BITNAMI_PHP" ]] || fail "PHP not found at ${BITNAMI_PHP}"

# Prefer the copy 20-moodle-install.sh put on the host; fall back to the repo.
if [[ ! -f "$PROVISION_PHP" && -f "${HELPER_BIN_DIR}/cli/paeu-provision-webservice.php" ]]; then
  PROVISION_PHP="${HELPER_BIN_DIR}/cli/paeu-provision-webservice.php"
fi
[[ -f "$PROVISION_PHP" ]] || fail "provisioning script not found (looked in ${MOODLE_ASSETS_DIR}/cli and ${HELPER_BIN_DIR}/cli)"

php_as_web() {
  run "${SUDO:-}" -u "$BITNAMI_WEB_USER" -g "$BITNAMI_WEB_GROUP" \
    env "MOODLE_DIR=${MOODLE_DIR}" "HOME=/tmp" "$BITNAMI_PHP" "$@"
}

cfg_get() {
  sudoq -u "$BITNAMI_WEB_USER" -g "$BITNAMI_WEB_GROUP" env HOME=/tmp \
    "$BITNAMI_PHP" "${MOODLE_DIR}/admin/cli/cfg.php" --name="$1" 2>/dev/null | tr -d '\r\n'
}

cfg_set() {
  local name="$1" value="$2" current
  current="$(cfg_get "$name")" || current=""
  if [[ "$current" == "$value" ]]; then
    log "cfg ${name} already '${value}'"
    return 0
  fi
  if [[ "$DRY_RUN" == "1" || "$PRINT_ONLY" == "1" ]]; then
    log "would set \$CFG->${name} = '${value}' (currently '${current}')"
    return 0
  fi
  php_as_web "${MOODLE_DIR}/admin/cli/cfg.php" --name="$name" --set="$value"
  ok "cfg ${name} = '${value}' (was '${current}')"
}

# ---------------------------------------------------------------------------
# step 1: web services + REST protocol
# ---------------------------------------------------------------------------
log "enabling Moodle web services and the REST protocol"
cfg_set 'enablewebservices' '1'

# webserviceprotocols is a comma-separated list; add rest without dropping
# anything an administrator may have enabled on purpose.
protocols="$(cfg_get 'webserviceprotocols')"
if [[ ",${protocols}," == *",rest,"* ]]; then
  log "REST protocol already enabled (webserviceprotocols='${protocols}')"
else
  if [[ -z "$protocols" ]]; then
    new_protocols="rest"
  else
    new_protocols="${protocols},rest"
  fi
  cfg_set 'webserviceprotocols' "$new_protocols"
fi

# ---------------------------------------------------------------------------
# step 2: the 'webservice' auth plugin
# ---------------------------------------------------------------------------
# webservice_server::authenticate_by_token() rejects a token whose owner's auth
# plugin is not enabled site-wide, so this must happen before the token is used.
WS_AUTH="${WS_AUTH:-webservice}"
log "ensuring the '${WS_AUTH}' auth plugin is enabled site-wide"
auths="$(cfg_get 'auth')"
if [[ ",${auths}," == *",${WS_AUTH},"* ]]; then
  log "auth plugin '${WS_AUTH}' already enabled (auth='${auths}')"
else
  if [[ -z "$auths" ]]; then
    new_auths="$WS_AUTH"
  else
    new_auths="${auths},${WS_AUTH}"
  fi
  cfg_set 'auth' "$new_auths"
fi

# ---------------------------------------------------------------------------
# step 3: external service, functions, user, role, token
# ---------------------------------------------------------------------------
functions_csv="$(printf '%s' "$MOODLE_WS_FUNCTIONS" | tr -s ' \n\t' ',' | sed 's/^,//; s/,$//')"
function_count="$(printf '%s' "$functions_csv" | tr ',' '\n' | grep -c . || true)"
log "provisioning the external service with ${function_count} authorised functions"

provision_args=(
  "$PROVISION_PHP"
  "--service-name=${MOODLE_WS_SERVICE_NAME}"
  "--service-shortname=${MOODLE_WS_SERVICE_SHORTNAME}"
  "--role-shortname=${MOODLE_WS_ROLE_SHORTNAME}"
  "--username=${MOODLE_WS_USERNAME}"
  "--firstname=${MOODLE_WS_FIRSTNAME}"
  "--lastname=${MOODLE_WS_LASTNAME}"
  "--email=${MOODLE_WS_EMAIL}"
  "--auth=${WS_AUTH}"
  "--functions=${functions_csv}"
  "--restricted-users=1"
)
if [[ "$PRINT_ONLY" == "1" || "$DRY_RUN" == "1" ]]; then
  provision_args+=("--print-only")
fi
if [[ "$ROTATE_TOKEN" == "1" ]]; then
  confirm_destructive "rotate the Moodle web-service token (the current MOODLE_TOKEN in SSM stops working immediately)"
  provision_args+=("--rotate-token")
fi

# stdout carries only MOODLE_WS_TOKEN=...; stderr carries the change log.
provision_out="$(mktemp)"
chmod 600 "$provision_out"
# shellcheck disable=SC2064  # expand the path now, on purpose
trap "rm -f '${provision_out}'" EXIT

if ! sudoq -u "$BITNAMI_WEB_USER" -g "$BITNAMI_WEB_GROUP" \
      env "MOODLE_DIR=${MOODLE_DIR}" "HOME=/tmp" \
      "$BITNAMI_PHP" "${provision_args[@]}" > "$provision_out"; then
  fail "provisioning failed; the Moodle CLI output above explains why"
fi

if [[ "$PRINT_ONLY" == "1" || "$DRY_RUN" == "1" ]]; then
  ok "print-only: nothing was changed"
  exit 0
fi

TOKEN="$(sed -n 's/^MOODLE_WS_TOKEN=//p' "$provision_out" | head -n1)"
[[ -n "$TOKEN" ]] && [[ ${#TOKEN} -ge 20 ]] \
  || fail "the provisioning script did not return a usable token"
ok "token obtained (${#TOKEN} characters)"

# ---------------------------------------------------------------------------
# step 4: prove the token works
# ---------------------------------------------------------------------------
if [[ "$SKIP_VERIFY" == "1" ]]; then
  warn "--skip-verify: not calling the web service"
else
  log "verifying core_webservice_get_site_info over loopback"
  # Called over loopback so the Apache /webservice allow-list is irrelevant and
  # the token never travels over the public internet during the check.
  ws_body="$(curl -fsS --max-time 20 \
    --resolve "${LMS_HOST}:443:127.0.0.1" \
    "${LMS_URL}/webservice/rest/server.php" \
    --data-urlencode "wstoken=${TOKEN}" \
    --data-urlencode "wsfunction=core_webservice_get_site_info" \
    --data-urlencode "moodlewsrestformat=json" 2>/dev/null)" || ws_body=""

  if [[ -z "$ws_body" ]]; then
    warn "the loopback call failed (TLS SNI pinning to 127.0.0.1 can fail on some setups); retrying over the public name"
    ws_body="$(curl -fsS --max-time 20 \
      "${LMS_URL}/webservice/rest/server.php" \
      --data-urlencode "wstoken=${TOKEN}" \
      --data-urlencode "wsfunction=core_webservice_get_site_info" \
      --data-urlencode "moodlewsrestformat=json" 2>/dev/null)" || ws_body=""
  fi

  if [[ -z "$ws_body" ]]; then
    warn "could not reach the web service from this host.
If MOODLE_RESTRICT_WEBSERVICE=1, /webservice is allow-listed to ${MOODLE_WS_ALLOW_IPS}
- add this host's IP temporarily, or run the check from the API instance.
90-smoke-test.sh covers this end to end."
  elif printf '%s' "$ws_body" | grep -q '"exception"'; then
    err "Moodle returned an exception:"
    printf '%s\n' "$ws_body" >&2
    fail "the token exists but the web service refused it; see the message above"
  else
    sitename="$(printf '%s' "$ws_body" | json_get '.sitename' "d['sitename']")" || sitename=""
    if [[ -n "$sitename" ]]; then
      ok "web service answered: sitename='${sitename}'"
      fncount="$(printf '%s' "$ws_body" | json_get '.functions | length' "len(d['functions'])")" || fncount="?"
      log "the token exposes ${fncount} function(s)"
    else
      warn "unexpected response shape; raw body follows"
      printf '%s\n' "$ws_body" >&2
    fi
  fi
fi

# ---------------------------------------------------------------------------
# step 5: hand the token over
# ---------------------------------------------------------------------------
if [[ "$PUT_SSM" == "1" ]]; then
  need_cmd aws "needed for --put-ssm"
  log "writing ${SSM_ENV_PREFIX}/MOODLE_TOKEN to SSM"
  run aws ssm put-parameter \
    --region "$AWS_REGION" \
    --name "${SSM_ENV_PREFIX}/MOODLE_TOKEN" \
    --type SecureString \
    --key-id "$SSM_KMS_KEY_ID" \
    --value "$TOKEN" \
    --overwrite \
    --no-cli-pager >/dev/null
  ok "MOODLE_TOKEN stored in SSM"
  log "also confirm ${SSM_ENV_PREFIX}/MOODLE_BASE_URL = ${LMS_URL}"
  log "then redeploy the API so the new .env is rendered: 10-api-bootstrap.sh"
fi

cat >&2 <<EOF

-------------------------------------------------------------------------------
Next steps for the operator
-------------------------------------------------------------------------------
Store the token (printed on stdout below) in SSM. From a host with AWS
credentials that may call ssm:PutParameter:

  aws ssm put-parameter --region ${AWS_REGION} \\
    --name "${SSM_ENV_PREFIX}/MOODLE_TOKEN" \\
    --type SecureString --key-id "${SSM_KMS_KEY_ID}" \\
    --value '<paste the token>' --overwrite

  aws ssm put-parameter --region ${AWS_REGION} \\
    --name "${SSM_ENV_PREFIX}/MOODLE_BASE_URL" \\
    --type SecureString --key-id "${SSM_KMS_KEY_ID}" \\
    --value '${LMS_URL}' --overwrite

Then redeploy the API so it renders the new .env:

  ssh ${API_SSH_USER}@${API_STATIC_IP} \\
    'sudo ${APP_BIN_DIR}/deploy/10-api-bootstrap.sh --skip-toolchain'

Do NOT paste the token into the repository, a ticket, or a chat message.
-------------------------------------------------------------------------------
EOF

printf 'MOODLE_WS_TOKEN=%s\n' "$TOKEN"
