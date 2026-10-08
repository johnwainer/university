#!/usr/bin/env bash
#
# 50-secrets-put.sh - RUNS ANYWHERE with AWS credentials that may write SSM.
#
# Uploads the API's .env values to SSM Parameter Store as SecureString
# parameters under ${SSM_ENV_PREFIX}/, reading them from a LOCAL, UNTRACKED
# file (see infra/deploy/.gitignore). One parameter per variable, so a new
# variable added by another engineer is a one-line change to that file - the
# rendering side (10-api-bootstrap.sh) enumerates nothing.
#
# IMPORTANT: Lightsail instances cannot carry an IAM instance role. The API
# instance therefore needs a long-lived IAM user access key with the policy in
# infra/deploy/iam/api-ssm-read-policy.json. This script prints the exact steps
# with --emit-policy.
#
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=00-config.sh
source "${SCRIPT_DIR}/00-config.sh"
install_err_trap

ENV_FILE="${ENV_FILE:-${SCRIPT_DIR}/env.${DEPLOY_ENVIRONMENT}.local}"
PRUNE=0
LIST_ONLY=0
EMIT_POLICY=0
FORCE="${FORCE:-0}"
DRY_RUN="${DRY_RUN:-0}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Reads KEY=VALUE lines from an untracked local file and writes each one to SSM
as a SecureString at ${SSM_ENV_PREFIX}/KEY.

Options
  --file <path>     Source file. Default: ${ENV_FILE}
  --list            Show what is currently in SSM under the prefix (names,
                    versions and last-modified dates only - never values).
  --prune           DELETE parameters under the prefix that the file does not
                    mention. DESTRUCTIVE: requires --force.
  --emit-policy     Print the IAM policies and the exact setup commands.
  --force           Arm --prune.
  --dry-run         Show which parameters would be written; call nothing.
  -h, --help        This text.

Source file format
  One KEY=VALUE per line. '#' comments and blank lines are ignored. The value
  is everything after the first '='; surrounding single or double quotes are
  stripped. Values may contain '=', spaces and URL characters.

  Start from the tracked template:
    cp ${SCRIPT_DIR}/env.production.local.example ${ENV_FILE}
    chmod 600 ${ENV_FILE}
    \$EDITOR ${ENV_FILE}

  That path matches infra/deploy/.gitignore, so it is never committed. Delete
  it when you are done - SSM is the source of truth afterwards.

Values are passed to the AWS CLI through a temporary file (--cli-input-json),
not on the command line, so no secret ever appears in 'ps' or in your shell
history.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)         ENV_FILE="${2:-}"; shift 2 ;;
    --file=*)       ENV_FILE="${1#*=}"; shift ;;
    --list)         LIST_ONLY=1; shift ;;
    --prune)        PRUNE=1; shift ;;
    --emit-policy)  EMIT_POLICY=1; shift ;;
    --force)        FORCE=1; shift ;;
    --dry-run)      DRY_RUN=1; shift ;;
    -h|--help)      usage; exit 0 ;;
    *)              die_usage "$(usage)" ;;
  esac
done
export FORCE DRY_RUN

need_cmd aws
need_cmd python3

# ---------------------------------------------------------------------------
# --emit-policy
# ---------------------------------------------------------------------------
if [[ "$EMIT_POLICY" == "1" ]]; then
  cat <<EOF
===============================================================================
IAM setup for ${SSM_PREFIX} (account ${AWS_ACCOUNT_ID}, region ${AWS_REGION})
===============================================================================

A Lightsail instance CANNOT have an IAM instance role, so the API instance
authenticates to SSM with an IAM user's access key.

1) The API instance (read-only on its own parameters)
   Policy document: ${SCRIPT_DIR}/iam/api-ssm-read-policy.json

   aws iam create-user --user-name plataforma-estudiantil-api-ssm
   aws iam put-user-policy \\
     --user-name plataforma-estudiantil-api-ssm \\
     --policy-name plataforma-estudiantil-ssm-read \\
     --policy-document file://${SCRIPT_DIR}/iam/api-ssm-read-policy.json
   aws iam create-access-key --user-name plataforma-estudiantil-api-ssm

   Then, ON the API instance, as root:

     install -d -m 0750 -o ${SERVICE_USER} -g ${SERVICE_GROUP} /etc/plataforma-estudiantil
     cat > /etc/plataforma-estudiantil/aws.env <<'EOT'
     AWS_ACCESS_KEY_ID=...
     AWS_SECRET_ACCESS_KEY=...
     AWS_DEFAULT_REGION=${AWS_REGION}
     EOT
     chmod 600 /etc/plataforma-estudiantil/aws.env
     chown root:root /etc/plataforma-estudiantil/aws.env

   10-api-bootstrap.sh calls the AWS CLI as root, so sourcing that file before
   running it is enough:

     set -a; . /etc/plataforma-estudiantil/aws.env; set +a
     sudo -E ${APP_BIN_DIR}/deploy/10-api-bootstrap.sh

   Rotate the key every 90 days:
     aws iam create-access-key --user-name plataforma-estudiantil-api-ssm
     # update /etc/plataforma-estudiantil/aws.env, confirm a deploy works, then
     aws iam delete-access-key --user-name plataforma-estudiantil-api-ssm --access-key-id <old>

2) GitHub Actions (frontend publish + CDN reset + parameter reads)
   Policy document: ${SCRIPT_DIR}/iam/deploy-ci-policy.json
   Store its access key as the AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
   repository secrets.

3) The operator running THIS script (write access)
   Policy document: ${SCRIPT_DIR}/iam/secrets-writer-policy.json
   Attach to a human IAM user with MFA; do not put this key on any instance.

===============================================================================
EOF
  for f in api-ssm-read-policy deploy-ci-policy secrets-writer-policy; do
    printf -- '--- iam/%s.json ---\n' "$f"
    cat "${SCRIPT_DIR}/iam/${f}.json"
    printf '\n'
  done
  exit 0
fi

# ---------------------------------------------------------------------------
# --list
# ---------------------------------------------------------------------------
list_remote_names() {
  aws ssm get-parameters-by-path \
    --region "$AWS_REGION" \
    --path "${SSM_ENV_PREFIX}/" --recursive \
    --query 'Parameters[].Name' --output text 2>/dev/null | tr '\t' '\n' | sed '/^$/d'
}

if [[ "$LIST_ONLY" == "1" ]]; then
  log "parameters under ${SSM_ENV_PREFIX}/ (names and metadata only)"
  aws ssm describe-parameters \
    --region "$AWS_REGION" \
    --parameter-filters "Key=Path,Option=Recursive,Values=${SSM_ENV_PREFIX}/" \
    --query 'Parameters[].{Name:Name,Type:Type,Version:Version,Modified:LastModifiedDate}' \
    --output table
  exit 0
fi

# ---------------------------------------------------------------------------
# read and validate the source file
# ---------------------------------------------------------------------------
[[ -f "$ENV_FILE" ]] || fail "source file '${ENV_FILE}' not found.
Create it from the tracked template:
  cp ${SCRIPT_DIR}/env.production.local.example '${ENV_FILE}'
  chmod 600 '${ENV_FILE}'"

perms="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE" 2>/dev/null || echo '?')"
if [[ "$perms" != "600" && "$perms" != "400" ]]; then
  warn "'${ENV_FILE}' is mode ${perms}; it holds secrets. Run: chmod 600 '${ENV_FILE}'"
fi

# Parse into a NUL-delimited KEY\0VALUE\0 stream so values may contain
# anything at all, newlines included.
PARSED="$(mktemp)"; chmod 600 "$PARSED"
# shellcheck disable=SC2064  # expand now, on purpose
trap "rm -f '${PARSED}'" EXIT

python3 -I - "$ENV_FILE" > "$PARSED" <<'PY'
import re, sys

key_re = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
out, seen, problems = [], set(), []

with open(sys.argv[1], "r", encoding="utf-8") as fh:
    for lineno, raw in enumerate(fh, start=1):
        line = raw.rstrip("\n").rstrip("\r")
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.startswith("export "):
            stripped = stripped[len("export "):].lstrip()
        if "=" not in stripped:
            problems.append("line %d: no '=' found: %r" % (lineno, line[:40]))
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        if not key_re.match(key):
            problems.append("line %d: %r is not a valid environment variable name" % (lineno, key))
            continue
        if key in seen:
            problems.append("line %d: %r appears more than once" % (lineno, key))
            continue
        if value == "":
            problems.append("line %d: %r has an empty value" % (lineno, key))
            continue
        if value.startswith("<") and value.endswith(">"):
            problems.append("line %d: %r still holds the placeholder %s" % (lineno, key, value))
            continue
        seen.add(key)
        out.append((key, value))

if problems:
    sys.stderr.write("the source file has problems:\n")
    for p in problems:
        sys.stderr.write("  - %s\n" % p)
    sys.exit(4)

if not out:
    sys.stderr.write("no usable KEY=VALUE lines found\n")
    sys.exit(5)

buf = []
for key, value in out:
    buf.append(key)
    buf.append(value)
sys.stdout.write("\0".join(buf) + "\0")
sys.stderr.write("parsed %d variable(s)\n" % len(out))
PY

# ---------------------------------------------------------------------------
# write each one
# ---------------------------------------------------------------------------
declare -a KEYS=()
written=0; unchanged=0

put_parameter() {
  local key="$1" value="$2"
  local name="${SSM_ENV_PREFIX}/${key}"

  # Skip the call when the stored value is already identical, so parameter
  # versions (and the CloudTrail noise) only grow on real changes.
  local existing
  existing="$(aws ssm get-parameter --region "$AWS_REGION" --name "$name" \
                --with-decryption --query 'Parameter.Value' --output text 2>/dev/null)" || existing=""
  if [[ -n "$existing" && "$existing" == "$value" ]]; then
    log "unchanged: ${name}"
    unchanged=$(( unchanged + 1 ))
    return 0
  fi

  if [[ "$DRY_RUN" == "1" ]]; then
    printf '%s[dry-run]%s would put %s (%d bytes, SecureString)\n' \
      "$__C_YELLOW" "$__C_RESET" "$name" "${#value}" >&2
    return 0
  fi

  # The value goes through --cli-input-json in a 0600 temp file so it never
  # reaches argv (and therefore never reaches `ps` or the shell history).
  local payload
  payload="$(mktemp)"; chmod 600 "$payload"
  python3 -I -c '
import json, sys
json.dump({
    "Name": sys.argv[1],
    "Value": sys.argv[2],
    "Type": "SecureString",
    "KeyId": sys.argv[3],
    "Overwrite": True,
    "Tier": "Standard",
}, open(sys.argv[4], "w"))
' "$name" "$value" "$SSM_KMS_KEY_ID" "$payload"

  if aws ssm put-parameter --region "$AWS_REGION" \
       --cli-input-json "file://${payload}" --no-cli-pager >/dev/null; then
    rm -f "$payload"
    ok "wrote ${name}"
    written=$(( written + 1 ))
  else
    rm -f "$payload"
    fail "could not write ${name}. The caller needs ssm:PutParameter plus
kms:Encrypt via ssm (see --emit-policy)."
  fi
}

log "target prefix ${SSM_ENV_PREFIX}/ in ${AWS_REGION}"
while IFS= read -r -d '' key && IFS= read -r -d '' value; do
  KEYS+=("$key")
  put_parameter "$key" "$value"
done < "$PARSED"

log "${written} written, ${unchanged} unchanged, ${#KEYS[@]} total"

# ---------------------------------------------------------------------------
# sanity: everything the API reads today
# ---------------------------------------------------------------------------
EXPECTED=(HOST PORT ADMIN_API_KEY ADMIN_EMAIL ADMIN_PASSWORD
          ADMIN_SESSION_TTL_MINUTES AUTO_SYNC_INTERVAL_SEC
          PUBLIC_SYNC_MAX_AGE_SEC PUBLIC_SESSION_TTL_MINUTES
          DATABASE_URL MOODLE_BASE_URL MOODLE_TOKEN
          EXTERNAL_INTEGRATION_BASE_URL EXTERNAL_INTEGRATION_API_KEY)
for want in "${EXPECTED[@]}"; do
  found=0
  for have in "${KEYS[@]}"; do
    [[ "$have" == "$want" ]] && { found=1; break; }
  done
  (( found )) || warn "${want} is not in '${ENV_FILE}'; the API will use its built-in default"
done
log "extra variables beyond this list are fine - 10-api-bootstrap.sh renders whatever the prefix holds"

# ---------------------------------------------------------------------------
# --prune
# ---------------------------------------------------------------------------
if [[ "$PRUNE" == "1" ]]; then
  log "looking for parameters that '${ENV_FILE}' does not mention"
  mapfile -t remote < <(list_remote_names)
  declare -a doomed=()
  for name in "${remote[@]}"; do
    key="${name##*/}"
    found=0
    for have in "${KEYS[@]}"; do
      [[ "$have" == "$key" ]] && { found=1; break; }
    done
    (( found )) || doomed+=("$name")
  done
  if (( ${#doomed[@]} == 0 )); then
    ok "nothing to prune"
  else
    warn "these parameters are not in the file: ${doomed[*]}"
    confirm_destructive "delete ${#doomed[@]} SSM parameter(s) the API may still be reading"
    if [[ "$DRY_RUN" != "1" ]]; then
      for name in "${doomed[@]}"; do
        run aws ssm delete-parameter --region "$AWS_REGION" --name "$name" --no-cli-pager >/dev/null
        ok "deleted ${name}"
      done
    fi
  fi
fi

cat >&2 <<EOF

Next:
  1. Shred the local file - SSM is the source of truth now:
       shred -u '${ENV_FILE}'   (or: rm -P / rm -f)
  2. Render it onto the instance:
       ssh ${API_SSH_USER}@${API_STATIC_IP} 'sudo -E ${APP_BIN_DIR}/deploy/10-api-bootstrap.sh --skip-toolchain'
  3. Verify:
       ./90-smoke-test.sh
EOF
ok "secrets published to ${SSM_ENV_PREFIX}/"
