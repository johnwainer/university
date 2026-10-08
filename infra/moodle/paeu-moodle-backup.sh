#!/usr/bin/env bash
#
# paeu-moodle-backup.sh - RUNS ON THE MOODLE INSTANCE.
#
# Installed by 20-moodle-install.sh to /opt/plataforma-estudiantil/bin/ and
# wired to a daily cron entry. Contract Etapa I acceptance criteria require
# backups, and the Lightsail daily instance snapshot (7-day retention) only
# protects the whole disk - this gives a restorable, portable copy of the
# database plus moodledata.
#
# Produces, under $BACKUP_DIR/<UTC timestamp>/ :
#   moodle-db.sql.gz    mysqldump of the Moodle database (single transaction)
#   moodledata.tar.gz   moodledata, excluding regenerable caches
#   config.php          the Moodle config (contains the DB password: mode 0600)
#   MANIFEST.txt        versions, sizes and checksums
#
set -Eeuo pipefail

BITNAMI_ROOT="${BITNAMI_ROOT:-/opt/bitnami}"
MOODLE_DIR="${MOODLE_DIR:-${BITNAMI_ROOT}/projects/lms/moodle}"
MOODLE_DATA_DIR="${MOODLE_DATA_DIR:-${BITNAMI_ROOT}/projects/lms/moodledata}"
BACKUP_DIR="${BACKUP_DIR:-/opt/plataforma-estudiantil/backups/moodle}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"
MYSQLDUMP="${MYSQLDUMP:-${BITNAMI_ROOT}/mariadb/bin/mysqldump}"
PHP_BIN="${PHP_BIN:-${BITNAMI_ROOT}/php/bin/php}"
# Shipped alongside this script (infra/moodle/cli/paeu-dbconfig.php).
DBCONFIG_PHP="${DBCONFIG_PHP:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/cli/paeu-dbconfig.php}"
PRUNE=0
DRY_RUN=0

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Backs up the Moodle database and moodledata into ${BACKUP_DIR}.

Options
  --dir <path>       Backup root. Default: ${BACKUP_DIR}
  --retain <days>    Retention for --prune. Default: ${RETAIN_DAYS}
  --prune            Delete backup sets older than --retain days.
                     (Destructive; omitted by default, so a plain run only adds.)
  --dry-run          Print what would happen; write nothing.
  -h, --help         This text.

Credentials
  Read from Moodle's own config.php - nothing is passed on the command line and
  no password is stored in this script. The temporary MySQL defaults file is
  mode 0600 and removed on exit.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)     BACKUP_DIR="${2:-}"; shift 2 ;;
    --dir=*)   BACKUP_DIR="${1#*=}"; shift ;;
    --retain)  RETAIN_DAYS="${2:-}"; shift 2 ;;
    --retain=*) RETAIN_DAYS="${1#*=}"; shift ;;
    --prune)   PRUNE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

log()  { printf '%s [backup] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >&2; }
fail() { printf '%s [backup] ERROR: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >&2; exit 1; }

[[ -r "${MOODLE_DIR}/config.php" ]] || fail "cannot read ${MOODLE_DIR}/config.php"
[[ -x "$MYSQLDUMP" ]] || fail "mysqldump not found at ${MYSQLDUMP}"
[[ -x "$PHP_BIN" ]]   || fail "php not found at ${PHP_BIN}"

# Pull the DB settings out of config.php with a reviewable PHP helper, so no
# credential ever appears in argv (visible via `ps`) or in this script.
[[ -r "$DBCONFIG_PHP" ]] || fail "helper not found at ${DBCONFIG_PHP} (set DBCONFIG_PHP)"

read -r DB_NAME DB_USER DB_HOST DB_PORT DB_PREFIX < <(
  "$PHP_BIN" "$DBCONFIG_PHP" "${MOODLE_DIR}/config.php" fields
)
[[ -n "${DB_NAME:-}" ]] || fail "could not read dbname out of config.php"

DEFAULTS_FILE="$(mktemp)"
chmod 600 "$DEFAULTS_FILE"
cleanup() { rm -f "$DEFAULTS_FILE"; }
trap cleanup EXIT

"$PHP_BIN" "$DBCONFIG_PHP" "${MOODLE_DIR}/config.php" mycnf > "$DEFAULTS_FILE"
[[ -s "$DEFAULTS_FILE" ]] || fail "could not build the MySQL defaults file"

STAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
DEST="${BACKUP_DIR}/${STAMP}"

log "database ${DB_NAME} (prefix ${DB_PREFIX}) on ${DB_HOST}:${DB_PORT}"
log "destination ${DEST}"

if [[ "$DRY_RUN" == "1" ]]; then
  log "dry-run: nothing written"
  exit 0
fi

mkdir -p "$DEST"
chmod 700 "$DEST"

log "dumping the database"
"$MYSQLDUMP" --defaults-file="$DEFAULTS_FILE" \
  --single-transaction --quick --routines --triggers --events \
  --default-character-set=utf8mb4 \
  --databases "$DB_NAME" | gzip -9 > "${DEST}/moodle-db.sql.gz"
[[ -s "${DEST}/moodle-db.sql.gz" ]] || fail "the database dump is empty"

log "archiving moodledata"
# trashdir/cache/localcache/temp/sessions are all regenerable.
tar -czf "${DEST}/moodledata.tar.gz" \
  --exclude='./cache' --exclude='./localcache' --exclude='./temp' \
  --exclude='./trashdir' --exclude='./sessions' --exclude='./muc' \
  -C "$MOODLE_DATA_DIR" . 2>/dev/null \
  || log "tar reported warnings (files changing during backup is normal)"
[[ -s "${DEST}/moodledata.tar.gz" ]] || fail "the moodledata archive is empty"

install -m 0600 "${MOODLE_DIR}/config.php" "${DEST}/config.php"

{
  echo "created_utc   : $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo "host          : $(hostname)"
  echo "moodle_dir    : ${MOODLE_DIR}"
  echo "moodledata    : ${MOODLE_DATA_DIR}"
  echo "db_name       : ${DB_NAME}"
  echo "db_user       : ${DB_USER}"
  echo "db_endpoint   : ${DB_HOST}:${DB_PORT}"
  echo "db_prefix     : ${DB_PREFIX}"
  if [[ -r "${MOODLE_DIR}/version.php" ]]; then
    echo "moodle_release: $(grep -oE "release *= *'[^']+'" "${MOODLE_DIR}/version.php" | head -1 | cut -d"'" -f2)"
  fi
  echo "php_version   : $("$PHP_BIN" -r 'echo PHP_VERSION;')"
  echo ""
  echo "sha256:"
  (cd "$DEST" && sha256sum moodle-db.sql.gz moodledata.tar.gz)
  echo ""
  echo "sizes:"
  (cd "$DEST" && du -h moodle-db.sql.gz moodledata.tar.gz)
} > "${DEST}/MANIFEST.txt"

log "backup complete: ${DEST}"
cat "${DEST}/MANIFEST.txt" >&2

if [[ "$PRUNE" == "1" ]]; then
  # Belt and braces before any deletion: refuse an empty, relative, root, or
  # non-existent backup root, and refuse a nonsensical retention window.
  [[ -n "${BACKUP_DIR:-}" ]]            || fail "--prune with an empty BACKUP_DIR; refusing to delete anything"
  [[ "$BACKUP_DIR" == /*  ]]            || fail "--prune needs an absolute BACKUP_DIR, got '${BACKUP_DIR}'"
  [[ "$BACKUP_DIR" != "/" ]]            || fail "--prune with BACKUP_DIR=/; refusing"
  [[ -d "$BACKUP_DIR" ]]                || fail "--prune but '${BACKUP_DIR}' is not a directory"
  [[ "$RETAIN_DAYS" =~ ^[0-9]+$ ]]      || fail "--retain must be a whole number of days, got '${RETAIN_DAYS}'"
  (( RETAIN_DAYS >= 1 ))                || fail "--retain must be at least 1 day; 0 would delete the backup just taken"

  log "pruning backup sets older than ${RETAIN_DAYS} days under ${BACKUP_DIR}"
  # Only ever touch timestamp-shaped directories directly under BACKUP_DIR:
  # -mindepth/-maxdepth 1 plus the regex mean nothing else can ever match.
  find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d \
    -regextype posix-extended -regex '.*/[0-9]{8}T[0-9]{6}Z$' \
    -mtime "+${RETAIN_DAYS}" -print -exec rm -rf -- '{}' +
else
  log "retention: pass --prune to delete sets older than ${RETAIN_DAYS} days"
fi
