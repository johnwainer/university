#!/usr/bin/env bash
#
# 10-api-bootstrap.sh - RUNS ON THE API INSTANCE (plataforma-estudiantil-api).
#
# Brings the Fastify API to the desired state and is also the deploy path used
# by .github/workflows/deploy.yml. Idempotent and re-runnable:
#
#   toolchain check -> service user + directories -> fetch source into a NEW
#   timestamped release -> npm ci -> build shared + api -> render .env from SSM
#   -> PM2 ecosystem + systemd startup unit -> atomic `current` symlink flip
#   -> loopback health check -> automatic rollback on failure -> logrotate
#   -> prune old releases
#
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=00-config.sh
source "${SCRIPT_DIR}/00-config.sh"
install_err_trap

SOURCE_MODE=""
SOURCE_FROM="${APP_STAGING_DIR}"
SKIP_TOOLCHAIN=0
SKIP_ENV=0
NO_ACTIVATE=0
DO_ROLLBACK=0
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_DELAY="${HEALTH_DELAY:-2}"
FORCE="${FORCE:-0}"
DRY_RUN="${DRY_RUN:-0}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Runs ON the API instance (${API_INSTANCE_NAME}, ${API_STATIC_IP}) as a user
with sudo rights (the 'ubuntu' account).

Options
  --source git|local     Where the code comes from.
                           git   : clone/fetch \$REPO_URL at --ref
                           local : rsync from --from (used by CI, no deploy key
                                   needed on the instance)
                         Default: local when --from exists, otherwise git.
  --from <dir>           Staging directory for --source local.
                         Default: ${APP_STAGING_DIR}
  --ref <git-ref>        Branch, tag or SHA for --source git. Default: \${REPO_REF}
  --skip-toolchain       Do not verify/install Node, pnpm, PM2, Redis.
  --skip-env             Keep the existing ${APP_SHARED_DIR}/.env instead of
                         re-rendering it from SSM.
  --no-activate          Build the release but do not flip 'current'.
  --rollback             Flip 'current' back to 'previous', reload, health-check.
  --health-retries <n>   Health poll attempts (default ${HEALTH_RETRIES}).
  --force                Allow destructive steps (release pruning, rollback
                         without a recorded previous release).
  --dry-run              Print what would happen; change nothing.
  -h, --help             This text.

Environment (all overridable, see 00-config.sh)
  REPO_URL REPO_REF APP_ROOT SERVICE_USER PM2_APP_NAME SSM_ENV_PREFIX
  AWS_REGION API_PORT API_ENTRY_REL

Secrets
  None are read from or written to the repository. The .env is rendered from
  SSM Parameter Store under ${SSM_ENV_PREFIX}/ and written 0600 to
  ${APP_SHARED_DIR}/.env.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source)         SOURCE_MODE="${2:-}"; shift 2 ;;
    --source=*)       SOURCE_MODE="${1#*=}"; shift ;;
    --from)           SOURCE_FROM="${2:-}"; shift 2 ;;
    --from=*)         SOURCE_FROM="${1#*=}"; shift ;;
    --ref)            REPO_REF="${2:-}"; shift 2 ;;
    --ref=*)          REPO_REF="${1#*=}"; shift ;;
    --health-retries) HEALTH_RETRIES="${2:-}"; shift 2 ;;
    --skip-toolchain) SKIP_TOOLCHAIN=1; shift ;;
    --skip-env)       SKIP_ENV=1; shift ;;
    --no-activate)    NO_ACTIVATE=1; shift ;;
    --rollback)       DO_ROLLBACK=1; shift ;;
    --force)          FORCE=1; shift ;;
    --dry-run)        DRY_RUN=1; shift ;;
    -h|--help)        usage; exit 0 ;;
    *)                die_usage "$(usage)" ;;
  esac
done
export FORCE DRY_RUN

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

PM2_HOME_DIR="${SERVICE_HOME}/.pm2"

# Run a command as the unprivileged service user with a sane PM2_HOME.
as_service() {
  run "${SUDO:-}" -u "$SERVICE_USER" -H \
    env "PM2_HOME=${PM2_HOME_DIR}" "HOME=${SERVICE_HOME}" \
        "PATH=/usr/local/bin:/usr/bin:/bin:${SERVICE_HOME}/.npm-global/bin" \
        "AWS_REGION=${AWS_REGION}" "AWS_DEFAULT_REGION=${AWS_REGION}" \
    "$@"
}

health_url="http://${API_BIND_HOST}:${API_PORT}${API_PUBLIC_PREFIX}/health"

check_health_once() {
  local body
  body="$(curl -fsS --max-time 5 "$health_url" 2>/dev/null)" || return 1
  printf '%s' "$body" | json_valid || return 1
  local status
  status="$(printf '%s' "$body" | json_get '.status' "d['status']")" || return 1
  [[ "$status" == "ok" ]]
}

wait_for_health() {
  log "polling ${health_url} (${HEALTH_RETRIES} x ${HEALTH_DELAY}s)"
  if [[ "$DRY_RUN" == "1" ]]; then
    warn "dry-run: skipping health check"
    return 0
  fi
  local n=1
  while (( n <= HEALTH_RETRIES )); do
    if check_health_once; then
      ok "health check passed on attempt ${n}"
      return 0
    fi
    sleep "$HEALTH_DELAY"
    n=$(( n + 1 ))
  done
  err "health check never passed"
  return 1
}

current_release_path() {
  if [[ -L "$APP_CURRENT_LINK" ]]; then
    readlink -f "$APP_CURRENT_LINK"
  fi
}

previous_release_path() {
  if [[ -L "$APP_PREVIOUS_LINK" ]]; then
    readlink -f "$APP_PREVIOUS_LINK"
  fi
}

# atomic symlink swap: write a temp link then rename over the target
point_link() {
  local link="$1" target="$2"
  run "${SUDO:-}" ln -sfn "$target" "${link}.tmp"
  run "${SUDO:-}" mv -Tf "${link}.tmp" "$link"
  run "${SUDO:-}" chown -h "${SERVICE_USER}:${SERVICE_GROUP}" "$link"
}

# ---------------------------------------------------------------------------
# step 1: toolchain
# ---------------------------------------------------------------------------
verify_toolchain() {
  log "verifying the toolchain"
  need_cmd curl
  need_cmd git
  need_cmd rsync "install it with: sudo apt-get install -y rsync"
  need_cmd node "the Lightsail launch script should have installed Node 22"
  need_cmd npm
  need_cmd aws "install the AWS CLI v2 so the .env can be rendered from SSM"

  local node_version node_major node_minor
  node_version="$(node -p 'process.versions.node')"
  node_major="${node_version%%.*}"
  node_minor="$(printf '%s' "$node_version" | cut -d. -f2)"
  log "node ${node_version}"
  if (( node_major < NODE_MIN_MAJOR )); then
    fail "Node ${NODE_MIN_MAJOR}+ required, found ${node_version}"
  fi

  # @atlas/shared ships COMPILED JavaScript (packages/shared/dist/index.js,
  # declared in its package.json "main"/"exports"). The built API therefore
  # loads plain .js at runtime and needs no TypeScript stripping. The root
  # `npm run build` builds shared BEFORE api/web so that dist always exists.
  #
  # Guard against a regression: if shared's dist is missing after the build,
  # the API would fail to resolve the import at boot.
  NODE_TS_FLAG=""
  : "${node_minor:=0}"

  if ! command -v pm2 >/dev/null 2>&1; then
    warn "pm2 not on PATH; installing globally"
    run "${SUDO:-}" npm install -g pm2
  fi
  log "pm2 $(pm2 --version 2>/dev/null || echo '?')"

  if command -v redis-cli >/dev/null 2>&1; then
    if redis-cli ping >/dev/null 2>&1; then
      log "redis is answering PING"
    else
      warn "redis-cli present but Redis is not answering PING on localhost"
    fi
  else
    warn "redis-cli not found; Redis 7 was expected to be preinstalled"
  fi

  command -v nginx >/dev/null 2>&1 || warn "nginx not found; run 11-api-nginx-tls.sh after this"
  command -v psql  >/dev/null 2>&1 || warn "psql not found; 40-db-init.sh needs postgresql-client-16"
}

# ---------------------------------------------------------------------------
# step 2: service user + directory layout
# ---------------------------------------------------------------------------
ensure_service_account() {
  log "ensuring service account '${SERVICE_USER}'"
  if ! getent group "$SERVICE_GROUP" >/dev/null 2>&1; then
    run "${SUDO:-}" groupadd --system "$SERVICE_GROUP"
  fi
  if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
    run "${SUDO:-}" useradd --system --create-home --home-dir "$SERVICE_HOME" \
      --shell /usr/sbin/nologin --gid "$SERVICE_GROUP" "$SERVICE_USER"
    ok "created ${SERVICE_USER}"
  else
    log "${SERVICE_USER} already exists"
  fi
  # PM2 needs a real shell to exec the interpreter under systemd.
  run "${SUDO:-}" usermod --shell /bin/bash "$SERVICE_USER"

  ensure_dir "$APP_ROOT"          0755 "${SERVICE_USER}:${SERVICE_GROUP}"
  ensure_dir "$APP_RELEASES_DIR"  0755 "${SERVICE_USER}:${SERVICE_GROUP}"
  ensure_dir "$APP_SHARED_DIR"    0750 "${SERVICE_USER}:${SERVICE_GROUP}"
  ensure_dir "$APP_LOG_DIR"       0750 "${SERVICE_USER}:${SERVICE_GROUP}"
  ensure_dir "$APP_BIN_DIR"       0755 "${SERVICE_USER}:${SERVICE_GROUP}"
  ensure_dir "$APP_STAGING_DIR"   0755 "${SERVICE_USER}:${SERVICE_GROUP}"
  ensure_dir "$SERVICE_HOME"      0750 "${SERVICE_USER}:${SERVICE_GROUP}"
  ensure_dir "$PM2_HOME_DIR"      0750 "${SERVICE_USER}:${SERVICE_GROUP}"
}

# ---------------------------------------------------------------------------
# step 3: fetch the source into a brand-new release directory
# ---------------------------------------------------------------------------
fetch_source() {
  local release_dir="$1"
  ensure_dir "$release_dir" 0755 "${SERVICE_USER}:${SERVICE_GROUP}"

  case "$SOURCE_MODE" in
    local)
      [[ -d "$SOURCE_FROM" ]] || fail "--source local but '${SOURCE_FROM}' is not a directory"
      [[ -f "${SOURCE_FROM}/package.json" ]] || fail "'${SOURCE_FROM}' does not look like the pae-u monorepo (no package.json)"
      log "rsyncing ${SOURCE_FROM} -> ${release_dir}"
      run "${SUDO:-}" rsync -a --delete \
        --exclude '.git/' --exclude 'node_modules/' --exclude 'dist/' \
        --exclude '.env' --exclude '*.pem' \
        "${SOURCE_FROM%/}/" "${release_dir}/"
      ;;
    git)
      need_env REPO_URL "set REPO_URL (or use --source local --from <dir>)"
      local mirror="${APP_ROOT}/repo.git"
      if [[ ! -d "$mirror" ]]; then
        log "creating bare mirror at ${mirror}"
        run "${SUDO:-}" -u "$SERVICE_USER" git clone --mirror "$REPO_URL" "$mirror"
      else
        log "updating bare mirror"
        run "${SUDO:-}" -u "$SERVICE_USER" git --git-dir "$mirror" remote set-url origin "$REPO_URL"
        run "${SUDO:-}" -u "$SERVICE_USER" git --git-dir "$mirror" fetch --prune --tags origin '+refs/heads/*:refs/heads/*'
      fi
      log "checking out ${REPO_REF} into ${release_dir}"
      run "${SUDO:-}" -u "$SERVICE_USER" git --git-dir "$mirror" --work-tree "$release_dir" \
        checkout --force "$REPO_REF" -- .
      run "${SUDO:-}" -u "$SERVICE_USER" git --git-dir "$mirror" rev-parse --short "$REPO_REF" \
        > /dev/null
      ;;
    *)
      fail "unknown --source '${SOURCE_MODE}' (expected 'git' or 'local')"
      ;;
  esac
  run "${SUDO:-}" chown -R "${SERVICE_USER}:${SERVICE_GROUP}" "$release_dir"
}

# ---------------------------------------------------------------------------
# step 4+5: install and build
# ---------------------------------------------------------------------------
build_release() {
  local release_dir="$1"
  log "npm ci in ${release_dir}"
  # devDependencies are required: the build is tsc.
  as_service bash -lc "cd '${release_dir}' && npm ci --no-audit --no-fund"

  log "building @atlas/shared then @atlas/api"
  as_service bash -lc "cd '${release_dir}' && npm run build -w @atlas/shared"
  as_service bash -lc "cd '${release_dir}' && npm run build -w @atlas/api"

  # El API compilado importa @atlas/shared por su "main" (dist/index.js). Si el
  # build de shared no emitio dist, el fallo aparecería recien al arrancar, ya
  # con el symlink 'current' movido. Mejor fallar aqui.
  if [[ "$DRY_RUN" != "1" && ! -f "${release_dir}/packages/shared/dist/index.js" ]]; then
    fail "packages/shared/dist/index.js no existe tras el build; el API no podra resolver @atlas/shared"
  fi
}

resolve_entry() {
  local release_dir="$1"
  local entry="${release_dir}/${API_ENTRY_REL}"
  if [[ -f "$entry" ]]; then
    printf '%s' "$API_ENTRY_REL"
    return 0
  fi
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '%s' "$API_ENTRY_REL"
    return 0
  fi
  warn "${API_ENTRY_REL} not found; searching the emitted tree"
  local found
  found="$(find "${release_dir}/apps/api/dist" -type f -name 'server.js' -print 2>/dev/null | head -n1)"
  [[ -n "$found" ]] || fail "could not locate the built API entrypoint under ${release_dir}/apps/api/dist"
  found="${found#"${release_dir}/"}"
  warn "using detected entrypoint ${found} (update API_ENTRY_REL in 00-config.sh)"
  printf '%s' "$found"
}

# ---------------------------------------------------------------------------
# step 6: render .env from SSM (generic - no fixed key list)
# ---------------------------------------------------------------------------
render_env_from_ssm() {
  local dest="${APP_SHARED_DIR}/.env"
  if [[ "$SKIP_ENV" == "1" ]]; then
    [[ -f "$dest" ]] || fail "--skip-env given but ${dest} does not exist yet"
    log "--skip-env: keeping the existing ${dest}"
    return 0
  fi

  log "rendering .env from SSM path ${SSM_ENV_PREFIX}/"
  if [[ "$DRY_RUN" == "1" ]]; then
    warn "dry-run: not calling SSM"
    return 0
  fi

  local raw tmp
  raw="$(mktemp)"; tmp="$(mktemp)"
  chmod 600 "$raw" "$tmp"
  # shellcheck disable=SC2064  # expand the paths now, on purpose
  trap "rm -f '${raw}' '${tmp}'" RETURN

  if ! aws ssm get-parameters-by-path \
        --region "$AWS_REGION" \
        --path "${SSM_ENV_PREFIX}/" \
        --recursive --with-decryption \
        --output json > "$raw"; then
    fail "aws ssm get-parameters-by-path failed for ${SSM_ENV_PREFIX}/ (check the instance's IAM credentials - see 50-secrets-put.sh)"
  fi

  # Every parameter under the prefix becomes one .env line. Nothing is
  # enumerated here, so variables added by other engineers appear automatically.
  # The JSON file is passed as a path (argv) rather than on stdin so the
  # heredoc carrying the program is the only thing competing for stdin.
  python3 -I - "$SSM_ENV_PREFIX" "$raw" > "$tmp" <<'PY'
import json, re, sys

prefix = sys.argv[1].rstrip("/") + "/"
with open(sys.argv[2], "r", encoding="utf-8") as fh:
    doc = json.load(fh)
params = doc.get("Parameters", [])
if not params:
    sys.stderr.write("no parameters found under %s\n" % prefix)
    sys.exit(3)

key_re = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
rows, bad = [], []
for p in params:
    name = p.get("Name", "")
    key = name[len(prefix):] if name.startswith(prefix) else name.rsplit("/", 1)[-1]
    key = key.strip("/").replace("/", "_")
    if not key_re.match(key):
        bad.append(name)
        continue
    rows.append((key, p.get("Value", "")))

if bad:
    sys.stderr.write("skipping parameters with non-identifier names: %s\n" % ", ".join(bad))

def emit(value):
    # Single quotes are literal for dotenv, so prefer them. Fall back to double
    # quotes with escaping when the value itself contains a single quote or a
    # newline.
    if "'" not in value and "\n" not in value and "\r" not in value:
        return "'" + value + "'"
    esc = (value.replace("\\", "\\\\")
                .replace('"', '\\"')
                .replace("\r", "")
                .replace("\n", "\\n"))
    return '"' + esc + '"'

print("# Rendered by infra/deploy/10-api-bootstrap.sh from SSM %s" % prefix)
print("# DO NOT EDIT BY HAND - edit the SSM parameters and redeploy.")
for key, value in sorted(rows):
    print("%s=%s" % (key, emit(value)))
PY

  local count
  count="$(grep -cE '^[A-Za-z_][A-Za-z0-9_]*=' "$tmp" || true)"
  [[ "${count:-0}" -gt 0 ]] || fail "rendered .env is empty; refusing to install it"
  log "rendered ${count} variables"

  local key
  for key in DATABASE_URL ADMIN_EMAIL ADMIN_PASSWORD ADMIN_API_KEY MOODLE_BASE_URL MOODLE_TOKEN; do
    grep -qE "^${key}=" "$tmp" || warn "SSM has no ${key}; the API will fall back to its built-in default"
  done
  # The app must never be reachable except through nginx.
  if grep -qE "^HOST=('|\")?0\.0\.0\.0" "$tmp"; then
    warn "HOST is 0.0.0.0 in SSM; set it to ${API_BIND_HOST} so only nginx can reach the API"
  fi

  TEMPLATE_MODE=0600 TEMPLATE_OWNER="${SERVICE_USER}:${SERVICE_GROUP}" \
    install_file "$tmp" "$dest" 0600 "${SERVICE_USER}:${SERVICE_GROUP}"
}

# ---------------------------------------------------------------------------
# step 7: PM2 ecosystem + systemd startup unit
# ---------------------------------------------------------------------------
write_ecosystem() {
  local entry_rel="$1"
  local dest="${APP_SHARED_DIR}/ecosystem.config.cjs"
  local node_args="--enable-source-maps"
  [[ -n "${NODE_TS_FLAG:-}" ]] && node_args="${node_args} ${NODE_TS_FLAG}"

  local tmp
  tmp="$(mktemp)"
  cat > "$tmp" <<EOF
// Generated by infra/deploy/10-api-bootstrap.sh - do not edit by hand.
//
// cwd is the 'current' SYMLINK on purpose: apps/api/src/config.ts loads .env
// from process.cwd(), and a reload after a symlink flip then picks up the new
// release without touching this file.
module.exports = {
  apps: [
    {
      name: '${PM2_APP_NAME}',
      script: '${entry_rel}',
      cwd: '${APP_CURRENT_LINK}',
      interpreter: 'node',
      node_args: '${node_args}',
      exec_mode: 'cluster',
      instances: ${PM2_INSTANCES},
      max_memory_restart: '${PM2_MAX_MEMORY}',
      autorestart: true,
      // Give the boot-time initDb() room to create the schema before PM2
      // decides the process is healthy.
      min_uptime: '20s',
      max_restarts: 10,
      restart_delay: 2000,
      kill_timeout: 10000,
      wait_ready: false,
      merge_logs: true,
      time: true,
      out_file: '${APP_LOG_DIR}/${PM2_APP_NAME}.out.log',
      error_file: '${APP_LOG_DIR}/${PM2_APP_NAME}.err.log',
      env: {
        NODE_ENV: 'production',
        // HOST/PORT and every secret come from the rendered .env, which
        // apps/api/src/config.ts reads via dotenv.
        TZ: 'UTC'
      }
    }
  ]
};
EOF
  install_file "$tmp" "$dest" 0644 "${SERVICE_USER}:${SERVICE_GROUP}"
  rm -f "$tmp"
}

ensure_pm2_startup() {
  if systemctl list-unit-files 2>/dev/null | grep -q "^pm2-${SERVICE_USER}\.service"; then
    log "systemd unit pm2-${SERVICE_USER}.service already installed"
  else
    log "installing the PM2 systemd startup unit for ${SERVICE_USER}"
    run "${SUDO:-}" env "PATH=${PATH}" pm2 startup systemd \
      -u "$SERVICE_USER" --hp "$SERVICE_HOME"
  fi
  run "${SUDO:-}" systemctl enable "pm2-${SERVICE_USER}" >/dev/null 2>&1 || \
    warn "could not enable pm2-${SERVICE_USER}.service; check 'systemctl status'"
}

# ---------------------------------------------------------------------------
# step 8: logrotate
# ---------------------------------------------------------------------------
configure_logrotate() {
  local tmp
  tmp="$(mktemp)"
  cat > "$tmp" <<EOF
# Generated by infra/deploy/10-api-bootstrap.sh
${APP_LOG_DIR}/*.log {
    daily
    rotate 14
    maxsize 100M
    missingok
    notifempty
    compress
    delaycompress
    copytruncate
    su ${SERVICE_USER} ${SERVICE_GROUP}
    create 0640 ${SERVICE_USER} ${SERVICE_GROUP}
}
EOF
  install_file "$tmp" "/etc/logrotate.d/${PM2_APP_NAME}" 0644 "root:root"
  rm -f "$tmp"
  if [[ "$DRY_RUN" != "1" ]]; then
    sudoq logrotate --debug "/etc/logrotate.d/${PM2_APP_NAME}" >/dev/null 2>&1 \
      || warn "logrotate reported a problem with /etc/logrotate.d/${PM2_APP_NAME}"
  fi
}

# ---------------------------------------------------------------------------
# step 9: activate / reload / rollback
# ---------------------------------------------------------------------------
reload_pm2() {
  log "reloading PM2 app '${PM2_APP_NAME}'"
  as_service pm2 startOrReload "${APP_SHARED_DIR}/ecosystem.config.cjs" --update-env
  as_service pm2 save
}

prune_releases() {
  local keep="$APP_KEEP_RELEASES"
  local -a all=()
  while IFS= read -r line; do all+=("$line"); done < <(
    find "$APP_RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | sort
  )
  local total=${#all[@]}
  (( total > keep )) || { log "${total} release(s) on disk; nothing to prune"; return 0; }

  local cur prev
  cur="$(current_release_path || true)"
  prev="$(previous_release_path || true)"

  local -a doomed=("${all[@]:0:$(( total - keep ))}")
  local name path
  for name in "${doomed[@]}"; do
    path="${APP_RELEASES_DIR}/${name}"
    if [[ "$path" == "$cur" || "$path" == "$prev" ]]; then
      log "keeping ${name} (current or previous)"
      continue
    fi
    # Deleting a release directory is the only destructive step here.
    if [[ "$FORCE" != "1" ]]; then
      warn "would remove old release ${name} (re-run with --force to prune)"
      continue
    fi
    case "$path" in
      "${APP_RELEASES_DIR}/"?*) run "${SUDO:-}" rm -rf -- "$path"; ok "pruned ${name}" ;;
      *) warn "refusing to remove suspicious path '${path}'" ;;
    esac
  done
}

do_rollback() {
  local prev
  prev="$(previous_release_path || true)"
  if [[ -z "$prev" || ! -d "$prev" ]]; then
    confirm_destructive "roll back with no recorded previous release"
    fail "no previous release recorded at ${APP_PREVIOUS_LINK}; nothing to roll back to"
  fi
  warn "rolling back: current -> ${prev}"
  point_link "$APP_CURRENT_LINK" "$prev"
  reload_pm2
  if wait_for_health; then
    ok "rollback complete and healthy: $(basename "$prev")"
    return 0
  fi
  fail "rollback finished but the health check still fails - investigate ${APP_LOG_DIR}"
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
log "plataforma-estudiantil API bootstrap"
paeu_print_config >&2

if [[ "$DO_ROLLBACK" == "1" ]]; then
  do_rollback
  exit 0
fi

if [[ -z "$SOURCE_MODE" ]]; then
  if [[ -d "$SOURCE_FROM" && -f "${SOURCE_FROM}/package.json" ]]; then
    SOURCE_MODE="local"
  else
    SOURCE_MODE="git"
  fi
  log "no --source given; using '${SOURCE_MODE}'"
fi

if [[ "$SKIP_TOOLCHAIN" == "1" ]]; then
  log "--skip-toolchain: not verifying Node/PM2/Redis"
  NODE_TS_FLAG="${NODE_TS_FLAG:-}"
else
  verify_toolchain
fi
ensure_service_account

RELEASE_ID="$(date -u '+%Y%m%d%H%M%S')"
RELEASE_DIR="${APP_RELEASES_DIR}/${RELEASE_ID}"
log "new release: ${RELEASE_DIR}"

fetch_source "$RELEASE_DIR"
build_release "$RELEASE_DIR"
ENTRY_REL="$(resolve_entry "$RELEASE_DIR")"
log "entrypoint: ${ENTRY_REL}"

render_env_from_ssm
# apps/api/src/config.ts reads .env relative to cwd, so every release needs the
# shared file visible at its root.
run "${SUDO:-}" ln -sfn "${APP_SHARED_DIR}/.env" "${RELEASE_DIR}/.env"
run "${SUDO:-}" chown -h "${SERVICE_USER}:${SERVICE_GROUP}" "${RELEASE_DIR}/.env"

write_ecosystem "$ENTRY_REL"
ensure_pm2_startup
configure_logrotate

# Keep an on-host copy of these scripts so the operator can re-run them over
# the Lightsail browser SSH console without a checkout.
if [[ -d "${RELEASE_DIR}/infra/deploy" ]]; then
  run "${SUDO:-}" rsync -a --delete "${RELEASE_DIR}/infra/" "${APP_BIN_DIR}/"
  run "${SUDO:-}" chown -R "${SERVICE_USER}:${SERVICE_GROUP}" "$APP_BIN_DIR"
fi

if [[ "$NO_ACTIVATE" == "1" ]]; then
  ok "release ${RELEASE_ID} built but NOT activated (--no-activate)"
  exit 0
fi

OLD_RELEASE="$(current_release_path || true)"
if [[ -n "$OLD_RELEASE" && -d "$OLD_RELEASE" && "$OLD_RELEASE" != "$RELEASE_DIR" ]]; then
  log "recording previous release: $(basename "$OLD_RELEASE")"
  point_link "$APP_PREVIOUS_LINK" "$OLD_RELEASE"
fi

point_link "$APP_CURRENT_LINK" "$RELEASE_DIR"
reload_pm2

if wait_for_health; then
  ok "release ${RELEASE_ID} is live and healthy"
  prune_releases
  log "next: 11-api-nginx-tls.sh (TLS + public vhost), then 90-smoke-test.sh"
  exit 0
fi

err "new release failed its health check; rolling back automatically"
sudoq tail -n 50 "${APP_LOG_DIR}/${PM2_APP_NAME}.err.log" 2>/dev/null || true
if [[ -n "$OLD_RELEASE" && -d "$OLD_RELEASE" ]]; then
  point_link "$APP_CURRENT_LINK" "$OLD_RELEASE"
  reload_pm2
  if wait_for_health; then
    fail "deploy of ${RELEASE_ID} failed; rolled back to $(basename "$OLD_RELEASE") which is healthy"
  fi
  fail "deploy of ${RELEASE_ID} failed AND the rollback is unhealthy - manual intervention needed"
fi
fail "deploy of ${RELEASE_ID} failed and there is no previous release to roll back to"
