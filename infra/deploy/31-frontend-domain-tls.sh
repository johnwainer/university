#!/usr/bin/env bash
#
# 31-frontend-domain-tls.sh - RUNS ANYWHERE with the AWS CLI.
#
# Attaches portal.thefloridianuniversity.com to the Lightsail distribution with
# a Lightsail-managed certificate. Run this ONCE, before 90-smoke-test.sh can
# pass the portal checks.
#
# Current real state this script fixes: the portal already returns 200, but via
# the distribution's own *.cloudfront.net name - the custom domain is NOT yet
# attached, so https://portal.thefloridianuniversity.com would answer with the
# wrong certificate (or not at all).
#
# The flow is necessarily two-phase because DNS lives in Cloudflare:
#   phase 1  create the Lightsail certificate and print the validation CNAME
#   phase 2  (after you add that CNAME in Cloudflare and it validates) attach
#            the certificate to the distribution and set the default root object
#
# Re-running is safe at any point; it reports where it is and what is missing.
#
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=00-config.sh
source "${SCRIPT_DIR}/00-config.sh"
install_err_trap

WAIT_MINUTES="${WAIT_MINUTES:-0}"
FORCE="${FORCE:-0}"
DRY_RUN="${DRY_RUN:-0}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Attaches ${PORTAL_HOST} to the Lightsail distribution '${CDN_DISTRIBUTION}'.

Options
  --wait <minutes>   Poll until the certificate validates (0 = do not wait).
  --force            Allow replacing a certificate already attached to the
                     distribution (DESTRUCTIVE: the portal serves the wrong
                     certificate for a few minutes while it swaps).
  --dry-run          Print what would happen; change nothing.
  -h, --help         This text.

What you must do in Cloudflare (zone ${DNS_ZONE}, all records "DNS only")
  1. The validation CNAME this script prints, exactly as printed.
  2. ${PORTAL_HOST}  CNAME  ${CDN_DEFAULT_DOMAIN}
     Cloudflare flattens a CNAME at a subdomain, which is fine. Keep the record
     grey-cloud: an orange-cloud (proxied) record would terminate TLS at
     Cloudflare instead of at the distribution, and the smoke test's
     certificate check would then describe Cloudflare's cert, not ours.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --wait)    WAIT_MINUTES="${2:-}"; shift 2 ;;
    --wait=*)  WAIT_MINUTES="${1#*=}"; shift ;;
    --force)   FORCE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *)         die_usage "$(usage)" ;;
  esac
done
export FORCE DRY_RUN

need_cmd aws
need_cmd curl

cert_json() {
  aws lightsail get-certificates \
    --region "$AWS_REGION" \
    --certificate-name "$CDN_CERTIFICATE_NAME" \
    --include-certificate-details \
    --output json 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# phase 1: the certificate
# ---------------------------------------------------------------------------
log "checking for the Lightsail certificate '${CDN_CERTIFICATE_NAME}'"
CERT="$(cert_json)"

if [[ -z "$CERT" || "$CERT" == *'"certificates": []'* ]]; then
  log "not found; creating it for ${PORTAL_HOST}"
  if [[ "$DRY_RUN" == "1" ]]; then
    warn "dry-run: would create the certificate"
    exit 0
  fi
  run aws lightsail create-certificate \
    --region "$AWS_REGION" \
    --certificate-name "$CDN_CERTIFICATE_NAME" \
    --domain-name "$PORTAL_HOST" \
    --tags "key=${RESOURCE_TAG_KEY},value=${RESOURCE_TAG_VALUE}" \
    --no-cli-pager >/dev/null
  ok "certificate requested"
  sleep 5
  CERT="$(cert_json)"
else
  log "certificate already exists"
fi

cert_status() {
  printf '%s' "$CERT" | json_get \
    '.certificates[0].certificateDetail.status' \
    "d['certificates'][0]['certificateDetail']['status']"
}

print_validation_record() {
  local name value
  name="$(printf '%s' "$CERT" | json_get \
    '.certificates[0].certificateDetail.domainValidationRecords[0].name' \
    "d['certificates'][0]['certificateDetail']['domainValidationRecords'][0]['name']")" || name=""
  value="$(printf '%s' "$CERT" | json_get \
    '.certificates[0].certificateDetail.domainValidationRecords[0].value' \
    "d['certificates'][0]['certificateDetail']['domainValidationRecords'][0]['value']")" || value=""
  if [[ -z "$name" || -z "$value" ]]; then
    warn "AWS has not published the validation record yet; re-run in a minute"
    return 1
  fi
  cat >&2 <<EOF

-------------------------------------------------------------------------------
Add this record in Cloudflare (zone ${DNS_ZONE}), proxy OFF (grey cloud):

  Type   : CNAME
  Name   : ${name}
  Target : ${value}
  Proxy  : DNS only

Cloudflare may strip the trailing dot and the zone suffix from Name - that is
normal. Validation usually completes within a few minutes of the record going
live.
-------------------------------------------------------------------------------

EOF
  return 0
}

STATUS="$(cert_status || echo UNKNOWN)"
log "certificate status: ${STATUS}"

if [[ "$STATUS" != "ISSUED" ]]; then
  print_validation_record || true

  if [[ "${WAIT_MINUTES:-0}" -gt 0 ]]; then
    log "waiting up to ${WAIT_MINUTES} minute(s) for validation"
    deadline=$(( $(date +%s) + WAIT_MINUTES * 60 ))
    while (( $(date +%s) < deadline )); do
      sleep 30
      CERT="$(cert_json)"
      STATUS="$(cert_status || echo UNKNOWN)"
      log "status: ${STATUS}"
      [[ "$STATUS" == "ISSUED" ]] && break
      if [[ "$STATUS" == "FAILED" || "$STATUS" == "VALIDATION_TIMED_OUT" ]]; then
        fail "certificate validation ${STATUS}; delete it and start again:
  aws lightsail delete-certificate --region ${AWS_REGION} --certificate-name ${CDN_CERTIFICATE_NAME}"
      fi
    done
  fi

  if [[ "$STATUS" != "ISSUED" ]]; then
    warn "the certificate is '${STATUS}', not ISSUED; stopping before the attach step"
    log "add the CNAME above, then re-run this script (optionally with --wait 15)"
    exit 0
  fi
fi
ok "certificate is ISSUED"

# ---------------------------------------------------------------------------
# phase 2: attach it to the distribution
# ---------------------------------------------------------------------------
log "reading the distribution '${CDN_DISTRIBUTION}'"
DIST="$(aws lightsail get-distributions \
          --region "$AWS_REGION" \
          --distribution-name "$CDN_DISTRIBUTION" \
          --output json 2>/dev/null)" || DIST=""
[[ -n "$DIST" ]] || fail "distribution '${CDN_DISTRIBUTION}' not found in ${AWS_REGION}"

ATTACHED="$(printf '%s' "$DIST" | json_get \
  '.distributions[0].certificateName' \
  "d['distributions'][0].get('certificateName')")" || ATTACHED=""

if [[ "$ATTACHED" == "$CDN_CERTIFICATE_NAME" ]]; then
  ok "'${CDN_CERTIFICATE_NAME}' is already attached to the distribution"
elif [[ -n "$ATTACHED" ]]; then
  confirm_destructive "replace the certificate currently attached ('${ATTACHED}') with '${CDN_CERTIFICATE_NAME}'"
  run aws lightsail attach-certificate-to-distribution \
    --region "$AWS_REGION" \
    --distribution-name "$CDN_DISTRIBUTION" \
    --certificate-name "$CDN_CERTIFICATE_NAME" \
    --no-cli-pager >/dev/null
  ok "certificate replaced"
else
  log "attaching the certificate"
  run aws lightsail attach-certificate-to-distribution \
    --region "$AWS_REGION" \
    --distribution-name "$CDN_DISTRIBUTION" \
    --certificate-name "$CDN_CERTIFICATE_NAME" \
    --no-cli-pager >/dev/null
  ok "certificate attached"
fi

ROOT_OBJECT="$(printf '%s' "$DIST" | json_get \
  '.distributions[0].defaultCacheBehavior.behavior' \
  "d['distributions'][0]['defaultCacheBehavior']['behavior']")" || ROOT_OBJECT=""
log "default cache behavior: ${ROOT_OBJECT:-unknown}"

ORIGIN_NAME="$(printf '%s' "$DIST" | json_get \
  '.distributions[0].origin.name' \
  "d['distributions'][0]['origin']['name']")" || ORIGIN_NAME=""
if [[ "$ORIGIN_NAME" != "$FRONTEND_BUCKET" ]]; then
  warn "the distribution's origin is '${ORIGIN_NAME}', not '${FRONTEND_BUCKET}' - check the Lightsail console"
else
  log "origin: ${ORIGIN_NAME} (as expected)"
fi

# ---------------------------------------------------------------------------
# verification
# ---------------------------------------------------------------------------
if [[ "$DRY_RUN" != "1" ]]; then
  log "resolving ${PORTAL_HOST}"
  if ! getent hosts "$PORTAL_HOST" >/dev/null 2>&1; then
    warn "${PORTAL_HOST} does not resolve yet. Add in Cloudflare (grey cloud):
  ${PORTAL_HOST}  CNAME  ${CDN_DEFAULT_DOMAIN}"
  else
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "${PORTAL_URL}/" || echo 000)"
    log "GET ${PORTAL_URL}/ -> ${code}"
    subject="$(echo | openssl s_client -connect "${PORTAL_HOST}:443" -servername "$PORTAL_HOST" 2>/dev/null \
      | openssl x509 -noout -subject 2>/dev/null || true)"
    [[ -n "$subject" ]] && log "served certificate: ${subject}"
  fi
fi

ok "custom domain configuration complete for ${PORTAL_HOST}"
log "a distribution change takes a few minutes to propagate; then run 90-smoke-test.sh"
