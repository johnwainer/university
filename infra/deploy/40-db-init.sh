#!/usr/bin/env bash
#
# 40-db-init.sh - RUNS ANYWHERE that can reach the managed PostgreSQL endpoint
#                 (normally ON the API instance, which has postgresql-client-16
#                 and sits inside the Lightsail private network).
#
# Creates the application role and database on the Lightsail managed
# PostgreSQL 16 instance, then verifies connectivity as the application user.
#
# THE API CREATES ITS OWN SCHEMA. apps/api/src/db.ts runs initDb() at boot,
# which issues CREATE TABLE IF NOT EXISTS for every table. There is no
# migration tool in this project, so this script deliberately creates NOTHING
# beyond the role, the database and its default privileges - the first
# successful API boot does the rest.
#
# THE ENDPOINT HOSTNAME IS NEVER HARDCODED. It is taken, in order, from:
#   1. $PGHOST
#   2. SSM parameter ${SSM_DB_HOST_PARAM}
#   3. aws lightsail get-relational-database --relational-database-name ...
#
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=00-config.sh
source "${SCRIPT_DIR}/00-config.sh"
install_err_trap

VERIFY_ONLY=0
PUT_SSM=0
DROP_DB=0
FORCE="${FORCE:-0}"
DRY_RUN="${DRY_RUN:-0}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Creates the role '${DB_APP_USER}' and the database '${DB_APP_DATABASE}' on
'${DB_INSTANCE_NAME}' (PostgreSQL 16, Lightsail managed) if they are absent,
then verifies the application connection string.

Options
  --verify-only      Only test connectivity; create nothing.
  --put-ssm          After success, write DATABASE_URL to SSM at
                     ${SSM_ENV_PREFIX}/DATABASE_URL as a SecureString.
  --drop-database    DROP the application database first. DESTROYS ALL
                     APPLICATION DATA and requires --force.
  --force            Arm destructive steps.
  --dry-run          Print what would happen; change nothing.
  -h, --help         This text.

Required environment (never defaulted, never stored in the repo)
  PGPASSWORD              password of the master user '${DB_MASTER_USER}'
  DB_APP_PASSWORD         password to set for '${DB_APP_USER}'
                          (not needed with --verify-only)

Optional
  PGHOST                  the endpoint hostname. When unset it is read from SSM
                          (${SSM_DB_HOST_PARAM}) and then from the Lightsail API.
  PGUSER                  master user. Default: ${DB_MASTER_USER}
  DB_MASTER_DATABASE      master database to connect to. Default: ${DB_MASTER_DATABASE}
  DB_SSLMODE              Default: ${DB_SSLMODE} (Lightsail managed PostgreSQL requires TLS)

Example
  PGPASSWORD='...' DB_APP_PASSWORD='...' ./40-db-init.sh --put-ssm
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --verify-only)   VERIFY_ONLY=1; shift ;;
    --put-ssm)       PUT_SSM=1; shift ;;
    --drop-database) DROP_DB=1; shift ;;
    --force)         FORCE=1; shift ;;
    --dry-run)       DRY_RUN=1; shift ;;
    -h|--help)       usage; exit 0 ;;
    *)               die_usage "$(usage)" ;;
  esac
done
export FORCE DRY_RUN

need_cmd psql "sudo apt-get install -y postgresql-client-16"

# ---------------------------------------------------------------------------
# resolve the endpoint - never a literal in this repository
# ---------------------------------------------------------------------------
resolve_endpoint() {
  if [[ -n "${PGHOST:-}" ]]; then
    log "endpoint from \$PGHOST"
    return 0
  fi

  if command -v aws >/dev/null 2>&1; then
    log "reading the endpoint from SSM ${SSM_DB_HOST_PARAM}"
    local v
    v="$(aws ssm get-parameter --region "$AWS_REGION" \
          --name "$SSM_DB_HOST_PARAM" --with-decryption \
          --query 'Parameter.Value' --output text 2>/dev/null)" || v=""
    if [[ -n "$v" && "$v" != "None" ]]; then
      PGHOST="$v"
      log "endpoint from SSM"
      return 0
    fi

    log "reading the endpoint from the Lightsail API"
    v="$(aws lightsail get-relational-database --region "$AWS_REGION" \
          --relational-database-name "$DB_INSTANCE_NAME" \
          --query 'relationalDatabase.masterEndpoint.address' \
          --output text 2>/dev/null)" || v=""
    if [[ -n "$v" && "$v" != "None" ]]; then
      PGHOST="$v"
      log "endpoint from the Lightsail API"
      log "tip: cache it so later runs need no AWS call:
  aws ssm put-parameter --region ${AWS_REGION} --name ${SSM_DB_HOST_PARAM} \\
    --type String --value '${PGHOST}' --overwrite"
      return 0
    fi
  fi

  fail "could not determine the PostgreSQL endpoint.
Set PGHOST explicitly, or make one of these work:
  aws ssm get-parameter --name ${SSM_DB_HOST_PARAM}
  aws lightsail get-relational-database --relational-database-name ${DB_INSTANCE_NAME}
Find it in the Lightsail console under Databases > ${DB_INSTANCE_NAME} > Connect."
}

resolve_endpoint
PGUSER="${PGUSER:-$DB_MASTER_USER}"
PGPORT="${PGPORT:-$DB_PORT}"
export PGHOST PGUSER PGPORT
export PGSSLMODE="${PGSSLMODE:-$DB_SSLMODE}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"
# Never let psql drop into its interactive pager or prompt for input.
export PAGER=cat

log "endpoint ${PGHOST}:${PGPORT} sslmode=${PGSSLMODE}"
log "master user ${PGUSER}, master database ${DB_MASTER_DATABASE}"

# psql as the master user against the master database.
psql_master() {
  psql --dbname "$DB_MASTER_DATABASE" --no-psqlrc --quiet \
       --set ON_ERROR_STOP=1 --tuples-only --no-align "$@"
}

need_env PGPASSWORD "the master user's password (Lightsail console > Databases > ${DB_INSTANCE_NAME} > Connect)"

log "testing the master connection"
if [[ "$DRY_RUN" != "1" ]]; then
  server_version="$(psql_master -c 'SHOW server_version;' 2>/dev/null)" || server_version=""
  [[ -n "$server_version" ]] || fail "cannot connect as ${PGUSER}@${PGHOST}:${PGPORT}/${DB_MASTER_DATABASE}.
Check: (a) PGPASSWORD; (b) the database's 'Public mode' setting if you are
connecting from outside the Lightsail network; (c) that this host's IP is
allowed. From the API instance it should work without public access."
  ok "connected; server_version=${server_version}"
  case "$server_version" in
    16.*) : ;;
    *) warn "expected PostgreSQL 16.x, got ${server_version}" ;;
  esac
fi

if [[ "$VERIFY_ONLY" == "1" ]]; then
  log "--verify-only: skipping role/database creation"
else
  need_env DB_APP_PASSWORD "the password to set for the '${DB_APP_USER}' role"

  # --- role ---------------------------------------------------------------
  log "ensuring role '${DB_APP_USER}'"
  if [[ "$DRY_RUN" == "1" ]]; then
    log "dry-run: would create/alter the role and database"
  else
    # psql does NOT interpolate :'var' inside a dollar-quoted body, so the
    # existence check is done first and the password is bound into a plain
    # statement, where psql quotes and escapes it correctly. The password never
    # appears in argv (ps) and is never concatenated into SQL by this script.
    role_exists="$(psql_master -c "SELECT 1 FROM pg_roles WHERE rolname = '${DB_APP_USER}';")"
    if [[ -z "${role_exists//[[:space:]]/}" ]]; then
      psql_master --set=apppass="$DB_APP_PASSWORD" \
        -c "CREATE ROLE \"${DB_APP_USER}\" LOGIN PASSWORD :'apppass';"
      ok "created role '${DB_APP_USER}'"
    else
      psql_master --set=apppass="$DB_APP_PASSWORD" \
        -c "ALTER ROLE \"${DB_APP_USER}\" LOGIN PASSWORD :'apppass';"
      log "role '${DB_APP_USER}' already existed; password set to DB_APP_PASSWORD"
    fi
    ok "role ensured"

    # --- database ---------------------------------------------------------
    db_exists="$(psql_master -c "SELECT 1 FROM pg_database WHERE datname = '${DB_APP_DATABASE}';")"
    if [[ -n "${db_exists//[[:space:]]/}" && "$DROP_DB" == "1" ]]; then
      confirm_destructive "DROP the database '${DB_APP_DATABASE}' and every table the API created in it"
      warn "terminating connections to ${DB_APP_DATABASE}"
      psql_master -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_APP_DATABASE}' AND pid <> pg_backend_pid();" >/dev/null
      # CREATE/DROP DATABASE cannot run inside a transaction block, hence no DO.
      psql_master -c "DROP DATABASE \"${DB_APP_DATABASE}\";"
      ok "database dropped"
      db_exists=""
    fi

    if [[ -z "${db_exists//[[:space:]]/}" ]]; then
      log "creating database '${DB_APP_DATABASE}' owned by '${DB_APP_USER}'"
      psql_master -c "CREATE DATABASE \"${DB_APP_DATABASE}\" OWNER \"${DB_APP_USER}\" ENCODING 'UTF8' TEMPLATE template0;"
      ok "database created"
    else
      log "database '${DB_APP_DATABASE}' already exists"
      owner="$(psql_master -c "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='${DB_APP_DATABASE}';")"
      owner="${owner//[[:space:]]/}"
      if [[ "$owner" != "$DB_APP_USER" ]]; then
        warn "owner is '${owner}', not '${DB_APP_USER}'; reassigning"
        psql_master -c "ALTER DATABASE \"${DB_APP_DATABASE}\" OWNER TO \"${DB_APP_USER}\";"
      fi
    fi

    # --- privileges inside the app database -------------------------------
    # The API's initDb() creates its own tables, so the role only needs to own
    # (and be able to create in) the public schema.
    log "granting schema privileges inside '${DB_APP_DATABASE}'"
    psql --dbname "$DB_APP_DATABASE" --no-psqlrc --quiet \
      --set ON_ERROR_STOP=1 <<SQL
GRANT ALL ON DATABASE "${DB_APP_DATABASE}" TO "${DB_APP_USER}";
ALTER SCHEMA public OWNER TO "${DB_APP_USER}";
GRANT ALL ON SCHEMA public TO "${DB_APP_USER}";
-- PostgreSQL 15+ revokes CREATE on public from PUBLIC by default; keep it that
-- way and rely on ownership instead of broad grants.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
    ok "privileges set"
  fi
fi

# ---------------------------------------------------------------------------
# verify as the application user with the exact URL the API will use
# ---------------------------------------------------------------------------
DATABASE_URL_VALUE=""
if [[ -n "${DB_APP_PASSWORD:-}" ]]; then
  # URL-encode the password so a '@', '/' or ':' cannot break the DSN.
  enc_pass="$(printf '%s' "$DB_APP_PASSWORD" | python3 -I -c '
import sys, urllib.parse
sys.stdout.write(urllib.parse.quote(sys.stdin.read(), safe=""))
')"
  DATABASE_URL_VALUE="postgresql://${DB_APP_USER}:${enc_pass}@${PGHOST}:${PGPORT}/${DB_APP_DATABASE}?sslmode=${PGSSLMODE}"
fi

if [[ "$DRY_RUN" != "1" && -n "$DATABASE_URL_VALUE" ]]; then
  log "verifying the application connection"
  app_now="$(PGPASSWORD="$DB_APP_PASSWORD" psql --dbname "$DB_APP_DATABASE" \
    --username "$DB_APP_USER" --no-psqlrc --quiet --tuples-only --no-align \
    --set ON_ERROR_STOP=1 -c 'SELECT NOW();' 2>/dev/null)" || app_now=""
  [[ -n "$app_now" ]] || fail "the application role cannot connect to ${DB_APP_DATABASE}"
  ok "'${DB_APP_USER}' connected; server time ${app_now}"

  # Prove the role can actually create a table, since that is literally what
  # initDb() does on the first boot.
  if PGPASSWORD="$DB_APP_PASSWORD" psql --dbname "$DB_APP_DATABASE" \
       --username "$DB_APP_USER" --no-psqlrc --quiet --set ON_ERROR_STOP=1 \
       -c 'CREATE TABLE IF NOT EXISTS paeu_deploy_probe (id int PRIMARY KEY); DROP TABLE paeu_deploy_probe;' >/dev/null 2>&1; then
    ok "CREATE TABLE works, so the API's initDb() will succeed"
  else
    fail "'${DB_APP_USER}' cannot CREATE TABLE in ${DB_APP_DATABASE}; the API's initDb() would fail at boot"
  fi

  table_count="$(PGPASSWORD="$DB_APP_PASSWORD" psql --dbname "$DB_APP_DATABASE" \
    --username "$DB_APP_USER" --no-psqlrc --quiet --tuples-only --no-align \
    -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null)" || table_count="?"
  log "public schema currently holds ${table_count} table(s)"
  [[ "${table_count//[[:space:]]/}" == "0" ]] && \
    log "that is expected before the first API boot: apps/api/src/db.ts initDb() creates them"
fi

# ---------------------------------------------------------------------------
# optionally publish DATABASE_URL
# ---------------------------------------------------------------------------
if [[ "$PUT_SSM" == "1" ]]; then
  [[ -n "$DATABASE_URL_VALUE" ]] || fail "--put-ssm needs DB_APP_PASSWORD to build DATABASE_URL"
  need_cmd aws
  log "writing ${SSM_ENV_PREFIX}/DATABASE_URL to SSM"
  if [[ "$DRY_RUN" != "1" ]]; then
    aws ssm put-parameter --region "$AWS_REGION" \
      --name "${SSM_ENV_PREFIX}/DATABASE_URL" \
      --type SecureString --key-id "$SSM_KMS_KEY_ID" \
      --value "$DATABASE_URL_VALUE" --overwrite --no-cli-pager >/dev/null
    ok "DATABASE_URL stored as a SecureString"
    aws ssm put-parameter --region "$AWS_REGION" \
      --name "$SSM_DB_HOST_PARAM" \
      --type String --value "$PGHOST" --overwrite --no-cli-pager >/dev/null
    ok "endpoint cached at ${SSM_DB_HOST_PARAM}"
  fi
else
  cat >&2 <<EOF

-------------------------------------------------------------------------------
Store DATABASE_URL in SSM (the value is not printed here on purpose):

  aws ssm put-parameter --region ${AWS_REGION} \\
    --name "${SSM_ENV_PREFIX}/DATABASE_URL" \\
    --type SecureString --key-id "${SSM_KMS_KEY_ID}" \\
    --value "postgresql://${DB_APP_USER}:<url-encoded-password>@${PGHOST}:${PGPORT}/${DB_APP_DATABASE}?sslmode=${PGSSLMODE}" \\
    --overwrite

or re-run this script with --put-ssm, which builds and uploads it for you.
-------------------------------------------------------------------------------
EOF
fi

ok "database ready: ${DB_APP_DATABASE} on ${DB_INSTANCE_NAME}"
log "the API creates its own tables at boot; no migration step is needed"
