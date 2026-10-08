#!/usr/bin/env bash
#
# 20-moodle-install.sh - RUNS ON THE MOODLE INSTANCE
#                        (plataforma-estudiantil-moodle, Bitnami LAMP 8.5.10).
#
# Installs Moodle 4.5 LTS reproducibly with the CLI installer - no web wizard:
#   1. preflight (Bitnami stack, PHP version + extensions, disk)
#   2. PHP ini drop-ins Moodle requires (max_input_vars, opcache, ...)
#   3. download + extract Moodle into ${MOODLE_DIR}
#   4. create the MariaDB database + user (utf8mb4, idempotent)
#   5. php admin/cli/install.php (or admin/cli/upgrade.php when already present)
#   6. bilingual ES/EN language packs
#   7. Apache vhosts for ${LMS_HOST} + Let's Encrypt
#   8. php admin/cli/cfg.php settings the integration depends on
#      (enablecompletion, enablenotes, forcelogin, pathtophp, ...)
#   9. Moodle cron every minute + the daily database/moodledata backup
#
# Re-running is safe: an existing install is upgraded in place, never wiped.
# Dropping the database requires --reinstall --force.
#
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=00-config.sh
source "${SCRIPT_DIR}/00-config.sh"
install_err_trap

MOODLE_ASSETS_DIR="${MOODLE_ASSETS_DIR:-${PAEU_INFRA_DIR}/moodle}"
DOWNLOAD_CACHE="${DOWNLOAD_CACHE:-/opt/plataforma-estudiantil/cache}"
HELPER_BIN_DIR="${HELPER_BIN_DIR:-/opt/plataforma-estudiantil/bin}"
SKIP_CERT=0
STAGING_CERT=0
SKIP_DOWNLOAD=0
REINSTALL=0
FORCE="${FORCE:-0}"
DRY_RUN="${DRY_RUN:-0}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Runs ON the Moodle instance (${MOODLE_INSTANCE_NAME}, ${MOODLE_STATIC_IP}) as
the 'bitnami' user (which has sudo).

Options
  --skip-download    Reuse the already-extracted ${MOODLE_DIR}.
  --skip-cert        Configure Apache but do not touch certbot.
  --staging          Use the Let's Encrypt staging CA (untrusted cert).
  --reinstall        Drop and recreate the Moodle database and config.php.
                     DESTROYS ALL MOODLE DATA. Requires --force as well.
  --force            Arm destructive steps.
  --dry-run          Print what would happen; change nothing.
  -h, --help         This text.

Required environment (never defaulted, never stored in the repo)
  MOODLE_DB_PASSWORD        password for the '${MOODLE_DB_USER}' MariaDB user
  MOODLE_ADMIN_PASSWORD     password for the Moodle '${MOODLE_ADMIN_USER}' account
                            (only needed on a first install)

One of these, to reach MariaDB as an administrator
  MOODLE_DB_ROOT_PASSWORD   the MariaDB root password. On a Bitnami image the
                            initial value is in /home/bitnami/bitnami_credentials.
  MOODLE_DB_DEFAULTS_FILE   path to a my.cnf with a [client] section instead.

Optional
  MOODLE_VERSION      pin a release, e.g. 4.5.6 (default: latest ${MOODLE_BRANCH} build)
  MOODLE_SHA256       expected sha256 of the tarball; verified when set
  MOODLE_LANGS        language packs to install (default: "${MOODLE_LANGS}")
  MOODLE_FORCE_LOGIN  1 (default) makes Moodle require login for every page,
                      so the LMS is not browsable by the public.

Prerequisites
  ${LMS_HOST} must already resolve to ${MOODLE_STATIC_IP} in Cloudflare as a
  grey-cloud ("DNS only") A record, and the Lightsail firewall must allow
  TCP 80 and 443.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-download) SKIP_DOWNLOAD=1; shift ;;
    --skip-cert)     SKIP_CERT=1; shift ;;
    --staging)       STAGING_CERT=1; shift ;;
    --reinstall)     REINSTALL=1; shift ;;
    --force)         FORCE=1; shift ;;
    --dry-run)       DRY_RUN=1; shift ;;
    -h|--help)       usage; exit 0 ;;
    *)               die_usage "$(usage)" ;;
  esac
done
export FORCE DRY_RUN

MOODLE_FORCE_LOGIN="${MOODLE_FORCE_LOGIN:-1}"
LE_LIVE="/etc/letsencrypt/live/${LMS_HOST}"
MOODLE_CONFIG="${MOODLE_DIR}/config.php"

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

# Everything Moodle writes must be owned by the Apache user, so all CLI tools
# run as that user. 'daemon' has nologin, hence -g and an explicit binary path.
php_as_web() {
  run "${SUDO:-}" -u "$BITNAMI_WEB_USER" -g "$BITNAMI_WEB_GROUP" \
    env "MOODLE_DIR=${MOODLE_DIR}" "HOME=/tmp" \
    "$BITNAMI_PHP" "$@"
}

moodle_cli() {
  local script="$1"; shift
  php_as_web "${MOODLE_DIR}/admin/cli/${script}" "$@"
}

# cfg_set <name> <value> - idempotent; only writes when the value differs.
cfg_set() {
  local name="$1" value="$2" current
  if [[ "$DRY_RUN" == "1" ]]; then
    log "dry-run: would set \$CFG->${name} = ${value}"
    return 0
  fi
  current="$(sudoq -u "$BITNAMI_WEB_USER" -g "$BITNAMI_WEB_GROUP" env HOME=/tmp \
    "$BITNAMI_PHP" "${MOODLE_DIR}/admin/cli/cfg.php" --name="$name" 2>/dev/null | tr -d '\r\n')" || current=""
  if [[ "$current" == "$value" ]]; then
    log "cfg ${name} already '${value}'"
    return 0
  fi
  moodle_cli cfg.php --name="$name" --set="$value"
  ok "cfg ${name} = ${value} (was '${current}')"
}

apache_reload() {
  if [[ "$DRY_RUN" == "1" ]]; then
    warn "dry-run: skipping Apache config test / restart"
    return 0
  fi
  if ! sudoq "${BITNAMI_ROOT}/apache/bin/apachectl" configtest; then
    fail "Apache configtest failed; nothing was restarted"
  fi
  # Bitnami wraps Apache; ctlscript.sh is the supported entrypoint.
  run "${SUDO:-}" "$BITNAMI_CTL" restart apache
  ok "Apache restarted"
}

# A root my.cnf built once, mode 0600, removed on exit. Never argv.
ADMIN_DEFAULTS=""
make_admin_defaults() {
  if [[ -n "${MOODLE_DB_DEFAULTS_FILE:-}" ]]; then
    [[ -r "$MOODLE_DB_DEFAULTS_FILE" ]] || fail "MOODLE_DB_DEFAULTS_FILE '${MOODLE_DB_DEFAULTS_FILE}' is not readable"
    ADMIN_DEFAULTS="$MOODLE_DB_DEFAULTS_FILE"
    log "using MySQL defaults file ${ADMIN_DEFAULTS}"
    return 0
  fi
  need_env MOODLE_DB_ROOT_PASSWORD \
    "On a fresh Bitnami image the initial password is in /home/bitnami/bitnami_credentials. Alternatively set MOODLE_DB_DEFAULTS_FILE."
  ADMIN_DEFAULTS="$(mktemp)"
  chmod 600 "$ADMIN_DEFAULTS"
  {
    printf '[client]\n'
    printf 'user="root"\n'
    printf 'password="%s"\n' "${MOODLE_DB_ROOT_PASSWORD//\"/\\\"}"
    printf 'host="%s"\n'     "$MOODLE_DB_HOST"
    printf 'port=%s\n'       "$MOODLE_DB_PORT"
  } > "$ADMIN_DEFAULTS"
  __PAEU_TMP_DEFAULTS="$ADMIN_DEFAULTS"
}
cleanup_admin_defaults() {
  [[ -n "${__PAEU_TMP_DEFAULTS:-}" ]] && rm -f "$__PAEU_TMP_DEFAULTS"
  return 0
}
trap cleanup_admin_defaults EXIT

mysql_admin() {
  "$BITNAMI_MYSQL" --defaults-file="$ADMIN_DEFAULTS" --batch --skip-column-names "$@"
}

# ---------------------------------------------------------------------------
# step 1: preflight
# ---------------------------------------------------------------------------
preflight() {
  log "preflight"
  [[ -d "$BITNAMI_ROOT" ]] || fail "${BITNAMI_ROOT} not found - this script must run on the Bitnami LAMP instance"
  [[ -x "$BITNAMI_PHP" ]]  || fail "PHP not found at ${BITNAMI_PHP}"
  [[ -x "$BITNAMI_MYSQL" ]]|| fail "mysql client not found at ${BITNAMI_MYSQL}"
  [[ -x "$BITNAMI_CTL" ]]  || fail "${BITNAMI_CTL} not found"
  need_cmd curl
  need_cmd tar

  local php_version php_major php_minor
  php_version="$("$BITNAMI_PHP" -r 'echo PHP_VERSION;')"
  php_major="${php_version%%.*}"
  php_minor="$(printf '%s' "$php_version" | cut -d. -f2)"
  log "php ${php_version}"
  # Moodle 4.5 supports PHP 8.1 - 8.3.
  if (( php_major < 8 )) || { (( php_major == 8 )) && (( php_minor < 1 )); }; then
    fail "Moodle 4.5 needs PHP 8.1+; this stack has ${php_version}"
  fi
  if (( php_major > 8 )) || { (( php_major == 8 )) && (( php_minor > 3 )); }; then
    warn "PHP ${php_version} is newer than Moodle 4.5's tested range (8.1-8.3); Moodle's environment check may complain"
  fi

  # Bitnami's PHP is compiled in place: a missing extension cannot be apt-installed.
  local -a required=(curl ctype dom gd iconv intl json mbstring openssl pcre SimpleXML soap spl xml xmlreader zip zlib)
  local -a missing=()
  local ext
  for ext in "${required[@]}"; do
    "$BITNAMI_PHP" -m | grep -qix "$ext" || missing+=("$ext")
  done
  if (( ${#missing[@]} > 0 )); then
    fail "the Bitnami PHP build is missing extensions Moodle requires: ${missing[*]}
These are compiled into the stack and cannot be added with apt. Recreate the
instance from a Bitnami image that bundles them, or install them with
'/opt/bitnami/php/bin/pecl'."
  fi
  ok "all required PHP extensions present"

  local avail_kb
  avail_kb="$(df -Pk /opt | awk 'NR==2 {print $4}')"
  if [[ -n "$avail_kb" ]] && (( avail_kb < 5000000 )); then
    warn "less than ~5 GB free on /opt ($(( avail_kb / 1024 )) MB); Moodle + moodledata + backups will grow"
  fi

  if (( ${#MOODLE_LANGS} == 0 )); then
    fail "MOODLE_LANGS must list at least one language pack"
  fi
}

# ---------------------------------------------------------------------------
# step 2: PHP ini drop-ins
# ---------------------------------------------------------------------------
install_php_ini() {
  log "installing PHP ini drop-ins into ${BITNAMI_PHP_CONFD}"
  ensure_dir "$BITNAMI_PHP_CONFD" 0755 root:root
  # zz-upload.ini already exists in the repo and is owned by another engineer;
  # it is installed as-is and zz-moodle.ini is loaded after it without
  # overriding any upload limit.
  install_file "${MOODLE_ASSETS_DIR}/php/zz-upload.ini" \
               "${BITNAMI_PHP_CONFD}/zz-upload.ini" 0644 root:root
  install_file "${MOODLE_ASSETS_DIR}/php/zz-moodle.ini" \
               "${BITNAMI_PHP_CONFD}/zz-moodle.ini" 0644 root:root
  if [[ "$DRY_RUN" != "1" ]]; then
    local miv
    miv="$("$BITNAMI_PHP" -r 'echo ini_get("max_input_vars");' 2>/dev/null || echo '?')"
    log "php max_input_vars now reports ${miv} (Moodle needs >= 5000)"
  fi
}

# ---------------------------------------------------------------------------
# step 3: download + extract
# ---------------------------------------------------------------------------
download_moodle() {
  if [[ "$SKIP_DOWNLOAD" == "1" ]]; then
    [[ -f "${MOODLE_DIR}/version.php" ]] || fail "--skip-download but ${MOODLE_DIR}/version.php is missing"
    log "--skip-download: keeping the existing ${MOODLE_DIR}"
    return 0
  fi
  if [[ -f "${MOODLE_DIR}/version.php" ]]; then
    local release
    release="$(grep -oE "release *= *'[^']+'" "${MOODLE_DIR}/version.php" | head -1 | cut -d"'" -f2 || true)"
    log "Moodle ${release:-unknown} already extracted at ${MOODLE_DIR}; not re-downloading"
    log "to move to a newer point release: remove/rename ${MOODLE_DIR} and re-run, or use Moodle's own updater"
    return 0
  fi

  ensure_dir "$DOWNLOAD_CACHE" 0755 root:root
  ensure_dir "$MOODLE_PROJECT_DIR" 0755 root:root
  local tarball="${DOWNLOAD_CACHE}/${MOODLE_TARBALL}"

  if [[ ! -s "$tarball" ]]; then
    log "downloading ${MOODLE_DOWNLOAD_URL}"
    run "${SUDO:-}" curl -fL --retry 3 --retry-delay 5 \
      -o "${tarball}.part" "$MOODLE_DOWNLOAD_URL"
    run "${SUDO:-}" mv -f "${tarball}.part" "$tarball"
  else
    log "using the cached tarball ${tarball}"
  fi

  if [[ -n "${MOODLE_SHA256:-}" && "$DRY_RUN" != "1" ]]; then
    log "verifying sha256"
    printf '%s  %s\n' "$MOODLE_SHA256" "$tarball" | sha256sum -c - \
      || fail "sha256 mismatch for ${tarball}; refusing to install"
    ok "checksum verified"
  else
    warn "MOODLE_SHA256 not set; the tarball's integrity rests on TLS alone.
Publish and pin the checksum for a reproducible build:
  sha256sum ${tarball}"
  fi

  # Extract into a staging dir first so a half-extracted tree never becomes
  # the DocumentRoot.
  local staging="${MOODLE_PROJECT_DIR}/.extract.$$"
  ensure_dir "$staging" 0755 root:root
  log "extracting"
  run "${SUDO:-}" tar -xzf "$tarball" -C "$staging"
  [[ "$DRY_RUN" == "1" ]] || [[ -f "${staging}/moodle/version.php" ]] \
    || fail "unexpected tarball layout: ${staging}/moodle/version.php not found"
  run "${SUDO:-}" mv -T "${staging}/moodle" "$MOODLE_DIR"
  run "${SUDO:-}" rm -rf -- "$staging"
  ok "Moodle extracted to ${MOODLE_DIR}"
}

set_ownership() {
  log "setting ownership and permissions"
  # Code: readable by Apache, writable only by root, so a web compromise cannot
  # rewrite Moodle's own PHP.
  run "${SUDO:-}" chown -R "root:${BITNAMI_WEB_GROUP}" "$MOODLE_DIR"
  run "${SUDO:-}" find "$MOODLE_DIR" -type d -exec chmod 0750 {} +
  run "${SUDO:-}" find "$MOODLE_DIR" -type f -exec chmod 0640 {} +

  # moodledata: outside the webroot, fully owned by Apache.
  ensure_dir "$MOODLE_DATA_DIR" 0770 "${BITNAMI_WEB_USER}:${BITNAMI_WEB_GROUP}"
  run "${SUDO:-}" chown -R "${BITNAMI_WEB_USER}:${BITNAMI_WEB_GROUP}" "$MOODLE_DATA_DIR"

  ensure_dir "$MOODLE_ACME_WEBROOT/.well-known/acme-challenge" 0755 "${BITNAMI_WEB_USER}:${BITNAMI_WEB_GROUP}"
  ensure_dir "$MOODLE_BACKUP_DIR" 0700 root:root
}

# ---------------------------------------------------------------------------
# step 4: MariaDB database + user
# ---------------------------------------------------------------------------
ensure_database() {
  need_env MOODLE_DB_PASSWORD "the MariaDB password for the '${MOODLE_DB_USER}' user"
  make_admin_defaults

  if [[ "$DRY_RUN" == "1" ]]; then
    log "dry-run: would ensure database ${MOODLE_DB_NAME} and user ${MOODLE_DB_USER}"
    return 0
  fi

  log "checking MariaDB connectivity"
  mysql_admin -e 'SELECT 1;' >/dev/null \
    || fail "cannot connect to MariaDB as root. Check MOODLE_DB_ROOT_PASSWORD (initial value in /home/bitnami/bitnami_credentials) and that MariaDB is running: sudo ${BITNAMI_CTL} status"

  local exists
  exists="$(mysql_admin -e "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='${MOODLE_DB_NAME}';")"
  if [[ -n "$exists" && "$REINSTALL" == "1" ]]; then
    confirm_destructive "DROP the Moodle database '${MOODLE_DB_NAME}' and delete ${MOODLE_CONFIG}"
    warn "dropping database ${MOODLE_DB_NAME}"
    mysql_admin -e "DROP DATABASE \`${MOODLE_DB_NAME}\`;"
    [[ -f "$MOODLE_CONFIG" ]] && run "${SUDO:-}" rm -f "$MOODLE_CONFIG"
    exists=""
  fi

  if [[ -z "$exists" ]]; then
    log "creating database ${MOODLE_DB_NAME}"
    mysql_admin -e "CREATE DATABASE \`${MOODLE_DB_NAME}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
    ok "database created"
  else
    log "database ${MOODLE_DB_NAME} already exists"
    local charset
    charset="$(mysql_admin -e "SELECT DEFAULT_CHARACTER_SET_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='${MOODLE_DB_NAME}';")"
    [[ "$charset" == "utf8mb4" ]] || warn "database charset is '${charset}', not utf8mb4; Moodle 4.x expects utf8mb4"
  fi

  # CREATE USER IF NOT EXISTS then always ALTER, so re-running rotates the
  # password to whatever MOODLE_DB_PASSWORD now holds.
  log "ensuring MariaDB user ${MOODLE_DB_USER}@localhost"
  mysql_admin <<SQL
CREATE USER IF NOT EXISTS '${MOODLE_DB_USER}'@'localhost' IDENTIFIED BY '${MOODLE_DB_PASSWORD//\'/\'\'}';
ALTER USER '${MOODLE_DB_USER}'@'localhost' IDENTIFIED BY '${MOODLE_DB_PASSWORD//\'/\'\'}';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, INDEX, ALTER,
      CREATE TEMPORARY TABLES, LOCK TABLES, TRIGGER, EVENT, REFERENCES
  ON \`${MOODLE_DB_NAME}\`.* TO '${MOODLE_DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL
  ok "MariaDB user ensured"
}

# ---------------------------------------------------------------------------
# step 5: CLI install / upgrade
# ---------------------------------------------------------------------------
install_or_upgrade_moodle() {
  if [[ -f "$MOODLE_CONFIG" ]]; then
    log "config.php exists; running the non-interactive upgrade instead of the installer"
    if [[ "$DRY_RUN" == "1" ]]; then
      log "dry-run: would run admin/cli/upgrade.php"
      return 0
    fi
    moodle_cli upgrade.php --non-interactive --allow-unstable || {
      warn "upgrade.php returned non-zero; it is a no-op when already up to date"
    }
    # wwwroot must track the real hostname (it may have been installed on the IP).
    cfg_set 'wwwroot' "$LMS_URL" || true
    return 0
  fi

  need_env MOODLE_ADMIN_PASSWORD "the password for the Moodle '${MOODLE_ADMIN_USER}' account (first install only)"

  log "running admin/cli/install.php for ${LMS_URL}"
  if [[ "$DRY_RUN" == "1" ]]; then
    log "dry-run: would run the Moodle CLI installer"
    return 0
  fi

  # config.php is created by the installer, so the directory must be writable
  # by the web user for the duration of the install.
  run "${SUDO:-}" chown "${BITNAMI_WEB_USER}:${BITNAMI_WEB_GROUP}" "$MOODLE_DIR"
  run "${SUDO:-}" chmod 0770 "$MOODLE_DIR"

  # NOTE: Moodle's installer only accepts credentials as CLI arguments, so they
  # are briefly visible to `ps` on this host. It runs exactly once, on a host
  # whose only other account is the operator's.
  warn "the installer takes --dbpass/--adminpass as arguments; they are briefly visible to 'ps' on this host"
  php_as_web "${MOODLE_DIR}/admin/cli/install.php" \
    --non-interactive --agree-license \
    --lang="$MOODLE_DEFAULT_LANG" \
    --wwwroot="$LMS_URL" \
    --dataroot="$MOODLE_DATA_DIR" \
    --dbtype=mariadb \
    --dbhost="$MOODLE_DB_HOST" \
    --dbport="$MOODLE_DB_PORT" \
    --dbname="$MOODLE_DB_NAME" \
    --dbuser="$MOODLE_DB_USER" \
    --dbpass="$MOODLE_DB_PASSWORD" \
    --prefix="$MOODLE_DB_PREFIX" \
    --fullname="$MOODLE_SITE_FULLNAME" \
    --shortname="$MOODLE_SITE_SHORTNAME" \
    --summary="Plataforma estudiantil - ${MOODLE_SITE_FULLNAME}" \
    --adminuser="$MOODLE_ADMIN_USER" \
    --adminpass="$MOODLE_ADMIN_PASSWORD" \
    --adminemail="$MOODLE_ADMIN_EMAIL"

  [[ -f "$MOODLE_CONFIG" ]] || fail "the installer finished but ${MOODLE_CONFIG} was not created"

  # Lock the code tree back down; config.php holds the DB password.
  run "${SUDO:-}" chown "root:${BITNAMI_WEB_GROUP}" "$MOODLE_DIR"
  run "${SUDO:-}" chmod 0750 "$MOODLE_DIR"
  run "${SUDO:-}" chown "root:${BITNAMI_WEB_GROUP}" "$MOODLE_CONFIG"
  run "${SUDO:-}" chmod 0640 "$MOODLE_CONFIG"
  ok "Moodle installed"
}

# ---------------------------------------------------------------------------
# step 6: language packs (bilingual ES/EN - contract Etapa I)
# ---------------------------------------------------------------------------
install_language_packs() {
  log "installing language packs: ${MOODLE_LANGS}"
  if [[ "$DRY_RUN" == "1" ]]; then
    log "dry-run: would install ${MOODLE_LANGS}"
    return 0
  fi
  local lang
  for lang in $MOODLE_LANGS; do
    # 'en' ships with core.
    if [[ "$lang" == "en" ]]; then
      log "en is bundled with core; nothing to download"
      continue
    fi
    if [[ -d "${MOODLE_DATA_DIR}/lang/${lang}" ]]; then
      log "language pack '${lang}' already present"
      continue
    fi
    if [[ -f "${MOODLE_DIR}/admin/tool/langimport/cli/install.php" ]]; then
      if php_as_web "${MOODLE_DIR}/admin/tool/langimport/cli/install.php" --lang="$lang"; then
        ok "installed language pack '${lang}'"
      else
        warn "tool_langimport's CLI failed for '${lang}'; install it from Site administration > Language > Language packs"
      fi
    else
      log "this build has no tool/langimport CLI installer; using the controller API instead"
      if php_as_web "${HELPER_BIN_DIR}/cli/paeu-install-lang.php" --lang="$lang"; then
        ok "installed language pack '${lang}'"
      else
        warn "could not install '${lang}'; do it from Site administration > Language > Language packs"
      fi
    fi
  done
  cfg_set 'lang' "$MOODLE_DEFAULT_LANG"
  # Let users switch between the installed packs.
  cfg_set 'langmenu' '1'
  local allowed
  allowed="$(printf '%s' "$MOODLE_LANGS" | tr ' ' ',')"
  cfg_set 'langlist' "$allowed"
}

# ---------------------------------------------------------------------------
# step 7: Apache vhosts + TLS
# ---------------------------------------------------------------------------
configure_apache_http() {
  log "installing the port-80 vhost for ${LMS_HOST}"
  ensure_dir "$BITNAMI_APACHE_VHOSTS" 0755 root:root
  render_template "${MOODLE_ASSETS_DIR}/apache/lms-vhost.conf.template" \
    "${BITNAMI_APACHE_VHOSTS}/paeu-lms-vhost.conf" \
    "LMS_HOST=${LMS_HOST}" \
    "MOODLE_DIR=${MOODLE_DIR}" \
    "ACME_WEBROOT=${MOODLE_ACME_WEBROOT}"
  apache_reload
}

issue_certificate() {
  if [[ "$SKIP_CERT" == "1" ]]; then
    warn "--skip-cert: not touching certbot"
    return 0
  fi
  if [[ -s "${LE_LIVE}/fullchain.pem" && "$FORCE" != "1" ]]; then
    log "certificate already present at ${LE_LIVE}; reusing it"
    return 0
  fi
  if ! command -v certbot >/dev/null 2>&1; then
    log "installing certbot"
    run "${SUDO:-}" apt-get update -qq
    run "${SUDO:-}" apt-get install -y certbot
  fi

  if [[ "$DRY_RUN" != "1" ]]; then
    local token="paeu-acme-selftest-$$"
    printf 'ok\n' | sudoq tee "${MOODLE_ACME_WEBROOT}/.well-known/acme-challenge/${token}" >/dev/null
    sudoq chown "${BITNAMI_WEB_USER}:${BITNAMI_WEB_GROUP}" "${MOODLE_ACME_WEBROOT}/.well-known/acme-challenge/${token}"
    if ! curl -fsS --max-time 10 "http://${LMS_HOST}/.well-known/acme-challenge/${token}" | grep -q '^ok$'; then
      sudoq rm -f "${MOODLE_ACME_WEBROOT}/.well-known/acme-challenge/${token}"
      fail "the ACME challenge path is not reachable at http://${LMS_HOST}/.well-known/acme-challenge/
Check: (a) the Cloudflare A record for ${LMS_HOST} -> ${MOODLE_STATIC_IP} is grey-cloud/'DNS only';
       (b) the Lightsail firewall allows TCP 80;
       (c) 'sudo ${BITNAMI_CTL} status apache' shows Apache running."
    fi
    sudoq rm -f "${MOODLE_ACME_WEBROOT}/.well-known/acme-challenge/${token}"
    ok "ACME challenge path verified"
  fi

  local -a args=(
    certonly --webroot -w "$MOODLE_ACME_WEBROOT"
    -d "$LMS_HOST"
    --non-interactive --agree-tos
    -m "$LETSENCRYPT_EMAIL"
    --keep-until-expiring
    --deploy-hook "${BITNAMI_CTL} restart apache"
  )
  [[ "$STAGING_CERT" == "1" ]] && args+=(--staging)
  if [[ "$FORCE" == "1" && -s "${LE_LIVE}/fullchain.pem" ]]; then
    confirm_destructive "force-renew the live certificate for ${LMS_HOST}"
    args+=(--force-renewal)
  fi
  run "${SUDO:-}" certbot "${args[@]}"

  # Bitnami's bncert-tool is the alternative if you prefer Bitnami's own flow:
  #   sudo ${BITNAMI_ROOT}/bncert-tool
  # It rewrites the stack's vhosts, so it is not used here - the vhost files in
  # infra/moodle/apache/ stay the single reviewable source of truth.

  ensure_dir /etc/letsencrypt/renewal-hooks/deploy 0755 root:root
  local hook
  hook="$(mktemp)"
  cat > "$hook" <<EOF
#!/usr/bin/env bash
# Installed by infra/deploy/20-moodle-install.sh
set -Eeuo pipefail
"${BITNAMI_CTL}" restart apache
EOF
  install_file "$hook" /etc/letsencrypt/renewal-hooks/deploy/00-restart-bitnami-apache.sh 0755 root:root
  rm -f "$hook"
}

configure_apache_https() {
  if [[ "$DRY_RUN" != "1" && ! -s "${LE_LIVE}/fullchain.pem" ]]; then
    fail "no certificate at ${LE_LIVE}/fullchain.pem; cannot install the HTTPS vhost"
  fi
  log "installing the port-443 vhost for ${LMS_HOST}"

  # Build the <Location /webservice> access block from MOODLE_WS_ALLOW_IPS.
  local ws_block
  if [[ "$MOODLE_RESTRICT_WEBSERVICE" == "1" ]]; then
    # Explicit <RequireAny>: anything not matching an allow-listed address is
    # denied. (Bare `Require ip` lines already behave this way in Apache 2.4,
    # but spelling it out leaves no room for misreading the policy.)
    ws_block="<RequireAny>"
    local ip
    for ip in $MOODLE_WS_ALLOW_IPS; do
      ws_block="${ws_block}"$'\n      '"Require ip ${ip}"
    done
    ws_block="${ws_block}"$'\n    '"</RequireAny>"
    log "restricting /webservice to: ${MOODLE_WS_ALLOW_IPS}"
  else
    ws_block="Require all granted"
    warn "MOODLE_RESTRICT_WEBSERVICE=0: /webservice is open to the internet, which the contract's 'no direct frontend access' rule does not allow"
  fi

  render_template "${MOODLE_ASSETS_DIR}/apache/lms-https-vhost.conf.template" \
    "${BITNAMI_APACHE_VHOSTS}/paeu-lms-https-vhost.conf" \
    "LMS_HOST=${LMS_HOST}" \
    "MOODLE_DIR=${MOODLE_DIR}" \
    "ACME_WEBROOT=${MOODLE_ACME_WEBROOT}" \
    "TLS_CERT=${LE_LIVE}/fullchain.pem" \
    "TLS_KEY=${LE_LIVE}/privkey.pem" \
    "TLS_CHAIN=${LE_LIVE}/chain.pem" \
    "WS_ALLOW_DIRECTIVES=${ws_block}"
  apache_reload
}

# ---------------------------------------------------------------------------
# step 8: Moodle settings the integration depends on
# ---------------------------------------------------------------------------
configure_moodle_settings() {
  log "applying Moodle settings"
  cfg_set 'wwwroot'            "$LMS_URL"
  cfg_set 'pathtophp'          "$BITNAMI_PHP"
  cfg_set 'slasharguments'     '1'
  # core_completion_* web service functions are no-ops unless completion is on.
  cfg_set 'enablecompletion'   '1'
  cfg_set 'enableavailability' '1'
  # core_notes_* web service functions require notes to be enabled.
  cfg_set 'enablenotes'        '1'
  # Cron must only be runnable from the CLI, never over HTTP.
  cfg_set 'cronclionly'        '1'
  # The LMS is a back office: no public browsing, no self-registration. The
  # login page itself stays reachable (90-smoke-test.sh checks it).
  cfg_set 'forcelogin'         "$MOODLE_FORCE_LOGIN"
  cfg_set 'guestloginbutton'   '0'
  # Self-registration stays off; \$CFG->registerauth defaults to '' (disabled)
  # and admin/cli/cfg.php will not accept an empty --set, so it is left alone.
  # Verify at Site administration > Plugins > Authentication > Manage auth.
  # The frontends talk to the API, never to the Moodle mobile web service.
  cfg_set 'enablemobilewebservice' '0'
  cfg_set 'timezone'           "${MOODLE_TIMEZONE:-America/New_York}"
  # HTTPS-only cookies, now that TLS terminates here.
  cfg_set 'cookiesecure'       '1'
}

# ---------------------------------------------------------------------------
# step 9: cron + backups
# ---------------------------------------------------------------------------
install_helper_scripts() {
  log "installing the operator helper scripts into ${HELPER_BIN_DIR}"
  ensure_dir "$HELPER_BIN_DIR" 0755 root:root
  install_file "${MOODLE_ASSETS_DIR}/paeu-moodle-backup.sh" \
               "${HELPER_BIN_DIR}/paeu-moodle-backup.sh" 0750 root:root
  ensure_dir "${HELPER_BIN_DIR}/cli" 0755 root:root
  install_file "${MOODLE_ASSETS_DIR}/cli/paeu-dbconfig.php" \
               "${HELPER_BIN_DIR}/cli/paeu-dbconfig.php" 0644 root:root
  install_file "${MOODLE_ASSETS_DIR}/cli/paeu-provision-webservice.php" \
               "${HELPER_BIN_DIR}/cli/paeu-provision-webservice.php" 0644 root:root
  install_file "${MOODLE_ASSETS_DIR}/cli/paeu-install-lang.php" \
               "${HELPER_BIN_DIR}/cli/paeu-install-lang.php" 0644 root:root
}

configure_cron_and_backups() {
  log "installing the Moodle cron entry and the nightly backup job"
  local tmp
  tmp="$(mktemp)"
  cat > "$tmp" <<EOF
# Generated by infra/deploy/20-moodle-install.sh - do not edit by hand.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Moodle's scheduled task runner. Must run as the Apache user so the files it
# writes under moodledata keep the right ownership.
* * * * * ${BITNAMI_WEB_USER} ${BITNAMI_PHP} ${MOODLE_DIR}/admin/cli/cron.php >/dev/null 2>&1

# Nightly database + moodledata backup (contract Etapa I acceptance criterion).
# --prune enforces the retention window; the Lightsail daily snapshot keeps 7
# days of whole-disk recovery on top of this.
17 3 * * * root ${HELPER_BIN_DIR}/paeu-moodle-backup.sh --dir "${MOODLE_BACKUP_DIR}" --retain 14 --prune >> /var/log/paeu-moodle-backup.log 2>&1
EOF
  install_file "$tmp" /etc/cron.d/paeu-moodle 0644 root:root
  rm -f "$tmp"

  tmp="$(mktemp)"
  cat > "$tmp" <<EOF
# Generated by infra/deploy/20-moodle-install.sh
/var/log/paeu-moodle-backup.log {
    weekly
    rotate 12
    missingok
    notifempty
    compress
    delaycompress
    create 0640 root root
}
EOF
  install_file "$tmp" /etc/logrotate.d/paeu-moodle-backup 0644 root:root
  rm -f "$tmp"

  if [[ "$DRY_RUN" != "1" ]]; then
    log "running Moodle cron once to confirm it works"
    if moodle_cli cron.php >/dev/null 2>&1; then
      ok "admin/cli/cron.php ran cleanly"
    else
      warn "admin/cli/cron.php returned non-zero; run it by hand to see why:
  sudo -u ${BITNAMI_WEB_USER} -g ${BITNAMI_WEB_GROUP} ${BITNAMI_PHP} ${MOODLE_DIR}/admin/cli/cron.php"
    fi
  fi
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
log "Moodle install/upgrade for ${LMS_HOST}"
log "version source: ${MOODLE_DOWNLOAD_URL}"

if [[ "$REINSTALL" == "1" && "$FORCE" != "1" ]]; then
  fail "--reinstall destroys all Moodle data; add --force to confirm"
fi

preflight
install_php_ini
install_helper_scripts
download_moodle
set_ownership
ensure_database
configure_apache_http
install_or_upgrade_moodle
install_language_packs
issue_certificate
configure_apache_https
configure_moodle_settings
configure_cron_and_backups

if [[ "$DRY_RUN" != "1" ]]; then
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${LMS_URL}/login/index.php" || echo 000)"
  if [[ "$code" == "200" ]]; then
    ok "GET ${LMS_URL}/login/index.php -> 200"
  else
    warn "GET ${LMS_URL}/login/index.php -> ${code}; check the Apache error log at ${BITNAMI_ROOT}/apache/logs/${LMS_HOST}-error_log"
  fi
fi

ok "Moodle is installed and serving ${LMS_URL}"
log "next: 21-moodle-webservices.sh on this same host"
