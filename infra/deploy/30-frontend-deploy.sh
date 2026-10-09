#!/usr/bin/env bash
#
# 30-frontend-deploy.sh - RUNS ANYWHERE with the AWS CLI and Node 22
#                         (operator workstation or a GitHub Actions runner).
#
# Builds the React/Vite SPA with the production VITE_API_URL, publishes it to
# the Lightsail bucket and resets the Lightsail CDN cache.
#
# WHICH AWS API IS USED, AND WHY
#   * Objects: `aws s3` / `aws s3api` against --endpoint-url
#     https://s3.<region>.amazonaws.com with the BUCKET's own access key pair.
#     This is what actually works. Lightsail object storage is S3-compatible
#     and there is NO `aws lightsail put-object` operation - the lightsail API
#     only manages buckets, access keys and access rules, not their contents.
#     The keys come from `aws lightsail get-bucket-access-keys`, so they are
#     still Lightsail-issued credentials scoped to this one bucket, not the
#     account-wide credentials.
#   * CDN cache: `aws lightsail reset-distribution-cache`. This is a Lightsail
#     distribution, so `aws cloudfront create-invalidation` does not apply even
#     though the distribution is CloudFront under the hood.
#
# SPA FALLBACK
#   Lightsail distributions expose only a "default root object" - they have no
#   custom-error-response API, so there is no true wildcard "404 -> /index.html"
#   rewrite. Deep links are therefore served by publishing a copy of index.html
#   under each client-side route (SPA_FALLBACK_ROUTES in 00-config.sh), both as
#   "<route>" and "<route>/index.html". See infra/README.md for the trade-off
#   and the CloudFront migration path.
#
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=00-config.sh
source "${SCRIPT_DIR}/00-config.sh"
install_err_trap

REPO_DIR="${REPO_DIR:-$(cd "${PAEU_INFRA_DIR}/.." && pwd)}"
SKIP_BUILD=0
SKIP_UPLOAD=0
SKIP_CDN_RESET=0
PRUNE=0
# Lightsail only hands out bucket access keys to a caller with
# lightsail:GetBucketAccessKeys. The instance role attached to the API host has
# object permissions on the bucket but not that call, so deploying from the
# instance needs the ambient role for the object operations too.
AMBIENT_BUCKET_CREDS="${AMBIENT_BUCKET_CREDS:-0}"
AMBIENT_S3_ENDPOINT="${AMBIENT_S3_ENDPOINT:-0}"
FORCE="${FORCE:-0}"
DRY_RUN="${DRY_RUN:-0}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Builds ${REPO_DIR}/apps/web and publishes it to the Lightsail bucket
'${FRONTEND_BUCKET}', then resets the '${CDN_DISTRIBUTION}' cache.

Options
  --repo <dir>        Monorepo root. Default: ${REPO_DIR}
  --api-url <url>     Value baked into the SPA as VITE_API_URL.
                      Default: ${VITE_API_URL}
  --skip-build        Publish the existing ${WEB_DIST_REL} as-is.
  --skip-upload       Build only.
  --skip-cdn-reset    Do not reset the CDN cache.
  --ambient-creds     Upload objects with the ambient credentials (instance
                      role / AWS_* in the environment) instead of asking
                      Lightsail for a bucket access key pair. Use this when
                      running on a host whose role can write the bucket's
                      objects but cannot call lightsail:GetBucketAccessKeys.
  --prune             Also delete bucket objects that are no longer in dist/
                      (uses 'aws s3 sync --delete'). DESTRUCTIVE: requires
                      --force. Without it, stale hashed assets simply linger,
                      which is harmless and keeps old tabs working.
  --force             Arm --prune.
  --dry-run           Print what would happen; change nothing remote.
  -h, --help          This text.

Credentials
  Account-level (for 'aws lightsail ...'): the usual AWS_ACCESS_KEY_ID /
  AWS_SECRET_ACCESS_KEY or an attached role.

  Bucket-level (for the object upload), either:
    BUCKET_ACCESS_KEY_ID + BUCKET_SECRET_ACCESS_KEY  in the environment, or
    nothing - in which case they are fetched with
      aws lightsail get-bucket-access-keys --bucket-name ${FRONTEND_BUCKET}
    (create a pair first if none exists:
      aws lightsail create-bucket-access-key --bucket-name ${FRONTEND_BUCKET})

Cache policy
  index.html and the SPA route aliases : ${CACHE_CONTROL_NO_CACHE}
  everything else (content-hashed)     : ${CACHE_CONTROL_IMMUTABLE}
EOF
}

API_URL_OVERRIDE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)           REPO_DIR="${2:-}"; shift 2 ;;
    --repo=*)         REPO_DIR="${1#*=}"; shift ;;
    --api-url)        API_URL_OVERRIDE="${2:-}"; shift 2 ;;
    --api-url=*)      API_URL_OVERRIDE="${1#*=}"; shift ;;
    --skip-build)     SKIP_BUILD=1; shift ;;
    --skip-upload)    SKIP_UPLOAD=1; shift ;;
    --skip-cdn-reset) SKIP_CDN_RESET=1; shift ;;
    --ambient-creds)  AMBIENT_BUCKET_CREDS=1; shift ;;
    --prune)          PRUNE=1; shift ;;
    --force)          FORCE=1; shift ;;
    --dry-run)        DRY_RUN=1; shift ;;
    -h|--help)        usage; exit 0 ;;
    *)                die_usage "$(usage)" ;;
  esac
done
export FORCE DRY_RUN

[[ -n "$API_URL_OVERRIDE" ]] && VITE_API_URL="$API_URL_OVERRIDE"
DIST_DIR="${REPO_DIR}/${WEB_DIST_REL}"
S3_URI="s3://${FRONTEND_BUCKET}"

# ---------------------------------------------------------------------------
# step 1: build
# ---------------------------------------------------------------------------
build_spa() {
  if [[ "$SKIP_BUILD" == "1" ]]; then
    [[ -f "${DIST_DIR}/index.html" ]] || fail "--skip-build but ${DIST_DIR}/index.html does not exist"
    log "--skip-build: publishing the existing ${DIST_DIR}"
    return 0
  fi
  need_cmd node
  need_cmd npm
  [[ -f "${REPO_DIR}/package.json" ]] || fail "'${REPO_DIR}' is not the monorepo root (no package.json)"

  log "building the SPA with VITE_API_URL=${VITE_API_URL}"
  log "  institution: ${VITE_INSTITUTION_NAME} (${VITE_INSTITUTION_SHORT_NAME})"
  if [[ "$VITE_API_URL" != https://* ]]; then
    warn "VITE_API_URL is not https:// - the SPA is served over HTTPS and the browser will block mixed content"
  fi
  case "$VITE_API_URL" in
    */api) : ;;
    *) warn "VITE_API_URL does not end in /api. The API's public contract is
'<host>/api/...' (Fastify's rewriteUrl strips the prefix), so every request
will 404 without it." ;;
  esac

  if [[ ! -d "${REPO_DIR}/node_modules" ]]; then
    log "installing dependencies (npm ci)"
    run npm --prefix "$REPO_DIR" ci --no-audit --no-fund
  fi
  # @atlas/web type-checks against @atlas/shared, so shared builds first.
  run npm --prefix "$REPO_DIR" run build -w @atlas/shared
  run env VITE_API_URL="$VITE_API_URL" \
      VITE_INSTITUTION_NAME="$VITE_INSTITUTION_NAME" \
      VITE_INSTITUTION_SHORT_NAME="$VITE_INSTITUTION_SHORT_NAME" \
      VITE_INSTITUTION_DOMAIN="$VITE_INSTITUTION_DOMAIN" \
      npm --prefix "$REPO_DIR" run build -w @atlas/web

  [[ "$DRY_RUN" == "1" ]] || [[ -f "${DIST_DIR}/index.html" ]] \
    || fail "the build finished but ${DIST_DIR}/index.html is missing"

  # Catch a stale dist that still points at localhost.
  if [[ "$DRY_RUN" != "1" ]] && grep -rqs 'localhost:4000' "${DIST_DIR}/assets" 2>/dev/null; then
    fail "the built bundle still references localhost:4000 - VITE_API_URL did not reach vite. Delete ${DIST_DIR} and rebuild."
  fi
  ok "built $(du -sh "$DIST_DIR" 2>/dev/null | cut -f1) into ${DIST_DIR}"
}

# ---------------------------------------------------------------------------
# step 2: bucket credentials
# ---------------------------------------------------------------------------
resolve_bucket_keys() {
  if [[ "$AMBIENT_BUCKET_CREDS" == "1" ]]; then
    log "--ambient-creds: uploading objects with the ambient credentials"
    return 0
  fi
  if [[ -n "${BUCKET_ACCESS_KEY_ID:-}" && -n "${BUCKET_SECRET_ACCESS_KEY:-}" ]]; then
    log "using the bucket access keys from the environment"
    return 0
  fi
  need_cmd aws
  log "fetching the bucket access keys with aws lightsail get-bucket-access-keys"
  if [[ "$DRY_RUN" == "1" ]]; then
    BUCKET_ACCESS_KEY_ID="DRYRUN"; BUCKET_SECRET_ACCESS_KEY="DRYRUN"
    return 0
  fi
  local json
  json="$(aws lightsail get-bucket-access-keys \
            --region "$AWS_REGION" \
            --bucket-name "$FRONTEND_BUCKET" \
            --output json 2>/dev/null)" || json=""
  [[ -n "$json" ]] || fail "could not read the bucket access keys.
Create a pair first:
  aws lightsail create-bucket-access-key --region ${AWS_REGION} --bucket-name ${FRONTEND_BUCKET}
then export BUCKET_ACCESS_KEY_ID and BUCKET_SECRET_ACCESS_KEY from its output
(the secret is only shown at creation time on some API versions)."

  BUCKET_ACCESS_KEY_ID="$(printf '%s' "$json" | json_get '.accessKeys[0].accessKeyId' "d['accessKeys'][0]['accessKeyId']")" \
    || fail "no accessKeyId in the get-bucket-access-keys response"
  BUCKET_SECRET_ACCESS_KEY="$(printf '%s' "$json" | json_get '.accessKeys[0].secretAccessKey' "d['accessKeys'][0]['secretAccessKey']")" \
    || fail "the API did not return secretAccessKey (it is only shown at creation time).
Create a new pair and export BUCKET_ACCESS_KEY_ID / BUCKET_SECRET_ACCESS_KEY:
  aws lightsail create-bucket-access-key --region ${AWS_REGION} --bucket-name ${FRONTEND_BUCKET}"
  ok "bucket access key ${BUCKET_ACCESS_KEY_ID:0:8}... resolved"
}

# Every object call goes through here so the bucket keys never leak into the
# ambient environment used by `aws lightsail`. Named awsb = "aws, as the bucket".
awsb() {
  if [[ "$AMBIENT_BUCKET_CREDS" == "1" ]]; then
    # The ambient role is already scoped to this bucket; Lightsail's
    # S3-compatible endpoint is reached through the regular s3 endpoint, so no
    # --endpoint-url override and no credential substitution.
    run aws --region "$AWS_REGION" "$@"
    return $?
  fi
  run env \
    AWS_ACCESS_KEY_ID="$BUCKET_ACCESS_KEY_ID" \
    AWS_SECRET_ACCESS_KEY="$BUCKET_SECRET_ACCESS_KEY" \
    AWS_SESSION_TOKEN= \
    AWS_DEFAULT_REGION="$AWS_REGION" \
    aws --endpoint-url "$S3_ENDPOINT_URL" --region "$AWS_REGION" "$@"
}

# ---------------------------------------------------------------------------
# step 3: upload
# ---------------------------------------------------------------------------
upload() {
  need_cmd aws
  resolve_bucket_keys

  local -a sync_args=(
    s3 sync "$DIST_DIR" "$S3_URI"
    --no-progress
    --exclude 'index.html'
    --cache-control "$CACHE_CONTROL_IMMUTABLE"
  )
  if [[ "$PRUNE" == "1" ]]; then
    confirm_destructive "delete bucket objects that are no longer present in ${DIST_DIR}"
    sync_args+=(--delete)
  else
    log "not pruning (pass --prune --force to remove stale objects)"
  fi

  log "syncing hashed assets with '${CACHE_CONTROL_IMMUTABLE}'"
  awsb "${sync_args[@]}"

  # The AWS CLI guesses content types from the extension via Python's mimetypes,
  # which gets these wrong or leaves them as application/octet-stream often
  # enough to be worth a second, explicit pass.
  local ext ctype
  while read -r ext ctype; do
    [[ -z "$ext" ]] && continue
    # Only re-copy when the build actually produced files of that type.
    if [[ "$DRY_RUN" != "1" ]] && ! find "$DIST_DIR" -type f -name "*.${ext}" -print -quit | grep -q .; then
      continue
    fi
    log "fixing content-type for *.${ext} -> ${ctype}"
    awsb s3 cp "$DIST_DIR" "$S3_URI" \
      --recursive --no-progress \
      --exclude '*' --include "*.${ext}" \
      --content-type "$ctype" \
      --cache-control "$CACHE_CONTROL_IMMUTABLE"
  done <<'TYPES'
woff2 font/woff2
woff font/woff
ttf font/ttf
mjs text/javascript
map application/json
webmanifest application/manifest+json
svg image/svg+xml
TYPES

  # index.html last and uncached, so a client never sees a new index pointing at
  # assets that have not landed yet.
  log "uploading index.html with '${CACHE_CONTROL_NO_CACHE}'"
  awsb s3 cp "${DIST_DIR}/index.html" "${S3_URI}/index.html" \
    --no-progress \
    --content-type 'text/html; charset=utf-8' \
    --cache-control "$CACHE_CONTROL_NO_CACHE"

  # SPA deep-link fallback (see the header comment for why this is necessary).
  local route
  for route in $SPA_FALLBACK_ROUTES; do
    route="${route#/}"; route="${route%/}"
    [[ -n "$route" ]] || continue
    log "publishing the SPA fallback for /${route}"
    awsb s3 cp "${DIST_DIR}/index.html" "${S3_URI}/${route}" \
      --no-progress \
      --content-type 'text/html; charset=utf-8' \
      --cache-control "$CACHE_CONTROL_NO_CACHE"
    awsb s3 cp "${DIST_DIR}/index.html" "${S3_URI}/${route}/index.html" \
      --no-progress \
      --content-type 'text/html; charset=utf-8' \
      --cache-control "$CACHE_CONTROL_NO_CACHE"
  done

  # Fichas de programa: /programas/<slug>. Mismo alias, una ruta por programa,
  # porque la distribución no reescribe por comodín.
  local -a slugs=()
  local line
  while IFS= read -r line; do
    [[ -n "$line" ]] && slugs+=("$line")
  done < <(catalog_program_slugs)
  if [[ ${#slugs[@]} -eq 0 ]]; then
    warn "el catálogo no respondió; usando la lista fija de programas"
    read -r -a slugs <<<"$PROGRAM_FALLBACK_SLUGS_DEFAULT"
  fi
  log "publicando ${#slugs[@]} alias de ficha de programa"
  local slug
  for slug in "${slugs[@]}"; do
    awsb s3 cp "${DIST_DIR}/index.html" "${S3_URI}/programas/${slug}" \
      --no-progress \
      --content-type 'text/html; charset=utf-8' \
      --cache-control "$CACHE_CONTROL_NO_CACHE"
    awsb s3 cp "${DIST_DIR}/index.html" "${S3_URI}/programas/${slug}/index.html" \
      --no-progress \
      --content-type 'text/html; charset=utf-8' \
      --cache-control "$CACHE_CONTROL_NO_CACHE"
  done

  ok "upload complete"
}

# ---------------------------------------------------------------------------
# step 4: CDN cache reset
# ---------------------------------------------------------------------------
reset_cdn() {
  if [[ "$SKIP_CDN_RESET" == "1" ]]; then
    warn "--skip-cdn-reset: viewers keep the cached build until it expires"
    return 0
  fi
  need_cmd aws
  log "resetting the Lightsail distribution cache for ${CDN_DISTRIBUTION}"
  # Not `aws cloudfront create-invalidation`: this is a Lightsail distribution.
  if ! run aws lightsail reset-distribution-cache \
        --region "$AWS_REGION" \
        --distribution-name "$CDN_DISTRIBUTION" \
        --no-cli-pager; then
    fail "reset-distribution-cache failed. The account-level credentials need
lightsail:ResetDistributionCache. The upload already succeeded, so re-run with
--skip-build --skip-upload once that is fixed."
  fi
  ok "cache reset requested (it propagates in a few minutes)"
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
log "frontend deploy: ${PORTAL_URL} (bucket ${FRONTEND_BUCKET}, cdn ${CDN_DISTRIBUTION})"
build_spa
if [[ "$SKIP_UPLOAD" == "1" ]]; then
  ok "--skip-upload: build only; nothing was published"
  exit 0
fi
upload
reset_cdn

if [[ "$DRY_RUN" != "1" ]]; then
  log "verifying the published site"
  for target in "/" "/admin"; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${PORTAL_URL}${target}" || echo 000)"
    if [[ "$code" == "200" ]]; then
      ok "GET ${PORTAL_URL}${target} -> 200"
    else
      warn "GET ${PORTAL_URL}${target} -> ${code}
If / works but /admin does not, the SPA fallback alias for that route is
missing - add it to SPA_FALLBACK_ROUTES in 00-config.sh and re-run.
If neither works, the custom domain is probably not attached to the
distribution yet: run 31-frontend-domain-tls.sh."
    fi
  done
fi

ok "frontend published"
log "next: 90-smoke-test.sh"
