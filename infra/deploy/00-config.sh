#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2034  # this file exists to define variables for its consumers
#
# 00-config.sh - the single source of truth for the plataforma-estudiantil
# production deployment. SOURCE it, never execute it:
#
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   source "${SCRIPT_DIR}/00-config.sh"
#
# Every value can be overridden from the environment (`VAR=... ./10-...sh`) or
# from an untracked `00-config.local.sh` sitting next to this file.
#
# NOTHING SECRET LIVES HERE. Tokens, passwords and the PostgreSQL endpoint
# hostname come from SSM Parameter Store or the operator's environment.

if [[ -n "${__PAEU_CONFIG_SOURCED:-}" ]]; then
  return 0
fi
__PAEU_CONFIG_SOURCED=1
# This file is sourced, never executed.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    printf '%s is meant to be sourced, not executed.\n' "${BASH_SOURCE[0]}" >&2
    printf 'Use:  source "%s"\n' "${BASH_SOURCE[0]}" >&2
    exit 2
fi


PAEU_DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAEU_INFRA_DIR="$(cd "${PAEU_DEPLOY_DIR}/.." && pwd)"

# shellcheck source=lib/common.sh
source "${PAEU_DEPLOY_DIR}/lib/common.sh"

# ---------------------------------------------------------------------------
# AWS account / region
# ---------------------------------------------------------------------------
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-$AWS_REGION}"
export AWS_REGION AWS_DEFAULT_REGION
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-280995443462}"
RESOURCE_TAG_KEY="${RESOURCE_TAG_KEY:-grupo}"
RESOURCE_TAG_VALUE="${RESOURCE_TAG_VALUE:-plataforma-estudiantil}"

# ---------------------------------------------------------------------------
# Public hostnames (confirmed with the client)
# ---------------------------------------------------------------------------
DNS_ZONE="${DNS_ZONE:-thefloridianuniversity.com}"        # managed in Cloudflare, "DNS only"
PORTAL_HOST="${PORTAL_HOST:-portal.${DNS_ZONE}}"          # React SPA (bucket + Lightsail CDN)
API_HOST="${API_HOST:-api.portal.${DNS_ZONE}}"            # Fastify API (nginx + Let's Encrypt)
LMS_HOST="${LMS_HOST:-lms.portal.${DNS_ZONE}}"            # Moodle (Apache + Let's Encrypt)

PORTAL_URL="${PORTAL_URL:-https://${PORTAL_HOST}}"
API_URL="${API_URL:-https://${API_HOST}}"
LMS_URL="${LMS_URL:-https://${LMS_HOST}}"

# Public API contract. Fastify's `rewriteUrl` strips the leading /api itself,
# so this prefix must be preserved end-to-end by nginx.
API_PUBLIC_PREFIX="${API_PUBLIC_PREFIX:-/api}"
# Baked into the SPA at build time.
VITE_API_URL="${VITE_API_URL:-${API_URL}${API_PUBLIC_PREFIX}}"

# Identidad que se hornea en el SPA. Sin estas variables el front caía al valor
# por defecto del código y el pie del sitio en producción decía «Atlas Online
# University», que es el nombre de la plantilla y no el del cliente.
VITE_INSTITUTION_NAME="${VITE_INSTITUTION_NAME:-The Floridian University}"
VITE_INSTITUTION_SHORT_NAME="${VITE_INSTITUTION_SHORT_NAME:-TFU}"
VITE_INSTITUTION_DOMAIN="${VITE_INSTITUTION_DOMAIN:-${DNS_ZONE}}"

# ACME / certificate contact
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-tech@pasosalexito.com}"
CERT_MIN_DAYS="${CERT_MIN_DAYS:-14}"

# ---------------------------------------------------------------------------
# Lightsail instance: API
# ---------------------------------------------------------------------------
API_INSTANCE_NAME="${API_INSTANCE_NAME:-plataforma-estudiantil-api}"
API_STATIC_IP="${API_STATIC_IP:-44.210.204.140}"
API_SSH_USER="${API_SSH_USER:-ubuntu}"
API_SSH_KEY_NAME="${API_SSH_KEY_NAME:-test-html-thefloridianuniversity-key}"
# Local path to the private key; only used by the operator's workstation / CI.
API_SSH_KEY_PATH="${API_SSH_KEY_PATH:-${HOME:-/root}/.ssh/${API_SSH_KEY_NAME}.pem}"

# On-instance layout (atomic releases + `current` symlink).
APP_ROOT="${APP_ROOT:-/opt/plataforma-estudiantil/api}"
APP_RELEASES_DIR="${APP_RELEASES_DIR:-${APP_ROOT}/releases}"
APP_CURRENT_LINK="${APP_CURRENT_LINK:-${APP_ROOT}/current}"
APP_PREVIOUS_LINK="${APP_PREVIOUS_LINK:-${APP_ROOT}/previous}"
APP_SHARED_DIR="${APP_SHARED_DIR:-${APP_ROOT}/shared}"       # holds the rendered .env
APP_LOG_DIR="${APP_LOG_DIR:-${APP_ROOT}/logs}"
APP_BIN_DIR="${APP_BIN_DIR:-${APP_ROOT}/bin}"                # a copy of infra/deploy on the host
APP_STAGING_DIR="${APP_STAGING_DIR:-${APP_ROOT}/staging}"     # rsync target used by CI
APP_KEEP_RELEASES="${APP_KEEP_RELEASES:-5}"

SERVICE_USER="${SERVICE_USER:-paeu}"
SERVICE_GROUP="${SERVICE_GROUP:-paeu}"
SERVICE_HOME="${SERVICE_HOME:-/home/${SERVICE_USER}}"

# Process manager: PM2 (already installed by the Lightsail launch script).
PM2_APP_NAME="${PM2_APP_NAME:-paeu-api}"
PM2_INSTANCES="${PM2_INSTANCES:-2}"           # 2 vCPU -> 2 cluster workers
PM2_MAX_MEMORY="${PM2_MAX_MEMORY:-512M}"

# The API binds loopback only; nginx is the single public entrypoint.
API_BIND_HOST="${API_BIND_HOST:-127.0.0.1}"
API_PORT="${API_PORT:-4000}"
API_UPSTREAM="${API_UPSTREAM:-127.0.0.1:${API_PORT}}"

# `tsc -p apps/api/tsconfig.json` has baseUrl "." at the monorepo root, so the
# emitted tree is nested. Verified against the real build output.
API_ENTRY_REL="${API_ENTRY_REL:-apps/api/dist/apps/api/src/server.js}"

NODE_MIN_MAJOR="${NODE_MIN_MAJOR:-22}"
# @atlas/shared resolves to packages/shared/src/index.ts (raw TypeScript).
# Node >= 22.18 strips types by default; 22.6-22.17 needs the explicit flag.
NODE_MIN_MINOR_FOR_NATIVE_TS="${NODE_MIN_MINOR_FOR_NATIVE_TS:-18}"

# ---------------------------------------------------------------------------
# Lightsail instance: Moodle (Bitnami LAMP 8.5.10)
# ---------------------------------------------------------------------------
MOODLE_INSTANCE_NAME="${MOODLE_INSTANCE_NAME:-plataforma-estudiantil-moodle}"
MOODLE_STATIC_IP="${MOODLE_STATIC_IP:-34.200.208.43}"
MOODLE_SSH_USER="${MOODLE_SSH_USER:-bitnami}"

BITNAMI_ROOT="${BITNAMI_ROOT:-/opt/bitnami}"
BITNAMI_CTL="${BITNAMI_CTL:-${BITNAMI_ROOT}/ctlscript.sh}"
BITNAMI_PHP="${BITNAMI_PHP:-${BITNAMI_ROOT}/php/bin/php}"
BITNAMI_PHP_CONFD="${BITNAMI_PHP_CONFD:-${BITNAMI_ROOT}/php/etc/conf.d}"
BITNAMI_APACHE_VHOSTS="${BITNAMI_APACHE_VHOSTS:-${BITNAMI_ROOT}/apache/conf/vhosts}"
BITNAMI_MYSQL="${BITNAMI_MYSQL:-${BITNAMI_ROOT}/mariadb/bin/mysql}"
BITNAMI_MYSQLDUMP="${BITNAMI_MYSQLDUMP:-${BITNAMI_ROOT}/mariadb/bin/mysqldump}"
# Apache (and therefore Moodle + cron) runs as this user on Bitnami stacks.
BITNAMI_WEB_USER="${BITNAMI_WEB_USER:-daemon}"
BITNAMI_WEB_GROUP="${BITNAMI_WEB_GROUP:-daemon}"

MOODLE_PROJECT_DIR="${MOODLE_PROJECT_DIR:-${BITNAMI_ROOT}/projects/lms}"
MOODLE_DIR="${MOODLE_DIR:-${MOODLE_PROJECT_DIR}/moodle}"            # DocumentRoot
MOODLE_DATA_DIR="${MOODLE_DATA_DIR:-${MOODLE_PROJECT_DIR}/moodledata}"  # OUTSIDE the webroot
MOODLE_ACME_WEBROOT="${MOODLE_ACME_WEBROOT:-${MOODLE_PROJECT_DIR}/acme}"
MOODLE_BACKUP_DIR="${MOODLE_BACKUP_DIR:-/opt/plataforma-estudiantil/backups/moodle}"

# Moodle 4.5 LTS. Pin MOODLE_VERSION (e.g. 4.5.6) for a reproducible build;
# the default tracks the latest 4.5.x point release.
MOODLE_BRANCH="${MOODLE_BRANCH:-405}"
MOODLE_VERSION="${MOODLE_VERSION:-}"
if [[ -n "$MOODLE_VERSION" ]]; then
  MOODLE_TARBALL="${MOODLE_TARBALL:-moodle-${MOODLE_VERSION}.tgz}"
else
  MOODLE_TARBALL="${MOODLE_TARBALL:-moodle-latest-${MOODLE_BRANCH}.tgz}"
fi
MOODLE_DOWNLOAD_URL="${MOODLE_DOWNLOAD_URL:-https://packaging.moodle.org/stable${MOODLE_BRANCH}/${MOODLE_TARBALL}}"

MOODLE_SITE_FULLNAME="${MOODLE_SITE_FULLNAME:-The Floridian University}"
MOODLE_SITE_SHORTNAME="${MOODLE_SITE_SHORTNAME:-TFU}"
MOODLE_LANGS="${MOODLE_LANGS:-es en}"          # bilingual ES/EN, contract Etapa I
MOODLE_DEFAULT_LANG="${MOODLE_DEFAULT_LANG:-es}"
MOODLE_DB_NAME="${MOODLE_DB_NAME:-moodle}"
MOODLE_DB_USER="${MOODLE_DB_USER:-moodle}"
MOODLE_DB_HOST="${MOODLE_DB_HOST:-127.0.0.1}"
MOODLE_DB_PORT="${MOODLE_DB_PORT:-3306}"
MOODLE_DB_PREFIX="${MOODLE_DB_PREFIX:-mdl_}"
MOODLE_ADMIN_USER="${MOODLE_ADMIN_USER:-admin}"
MOODLE_ADMIN_EMAIL="${MOODLE_ADMIN_EMAIL:-tech@pasosalexito.com}"

# Dedicated, non-interactive Moodle account the API authenticates as.
MOODLE_WS_SERVICE_NAME="${MOODLE_WS_SERVICE_NAME:-PAE-U Intermediator}"
MOODLE_WS_SERVICE_SHORTNAME="${MOODLE_WS_SERVICE_SHORTNAME:-paeu_intermediator}"
MOODLE_WS_ROLE_SHORTNAME="${MOODLE_WS_ROLE_SHORTNAME:-paeu_ws_client}"
MOODLE_WS_USERNAME="${MOODLE_WS_USERNAME:-paeu.integration}"
MOODLE_WS_FIRSTNAME="${MOODLE_WS_FIRSTNAME:-PAEU}"
MOODLE_WS_LASTNAME="${MOODLE_WS_LASTNAME:-Integration}"
MOODLE_WS_EMAIL="${MOODLE_WS_EMAIL:-integration+moodle@pasosalexito.com}"

# The contract forbids any frontend talking to Moodle directly. /webservice/ is
# therefore allow-listed to the API instance (plus loopback) at the Apache layer.
# Add the operator's IP temporarily when debugging, space separated.
MOODLE_WS_ALLOW_IPS="${MOODLE_WS_ALLOW_IPS:-${MOODLE_STATIC_IP} 127.0.0.1 ::1 ${API_STATIC_IP}}"
MOODLE_RESTRICT_WEBSERVICE="${MOODLE_RESTRICT_WEBSERVICE:-1}"

# Exact function list authorised by the signed contract (Etapa I).
# Order is irrelevant; the list is compared as a set by 21-moodle-webservices.sh.
MOODLE_WS_FUNCTIONS="${MOODLE_WS_FUNCTIONS:-\
core_webservice_get_site_info \
core_course_get_courses \
core_course_get_categories \
core_course_create_courses \
core_course_get_contents \
core_user_get_users \
core_user_create_users \
core_user_get_users_by_field \
core_user_update_users \
core_enrol_get_users_courses \
core_enrol_get_enrolled_users \
enrol_manual_enrol_users \
enrol_manual_unenrol_users \
core_notes_create_notes \
core_notes_get_notes \
core_completion_get_activities_completion_status \
core_completion_update_activity_completion_status_manually}"

# ---------------------------------------------------------------------------
# Lightsail managed PostgreSQL
#
# The endpoint hostname is deliberately NOT hardcoded. Supply it as PGHOST, or
# let 40-db-init.sh read it from SSM / `aws lightsail get-relational-database`.
# ---------------------------------------------------------------------------
DB_INSTANCE_NAME="${DB_INSTANCE_NAME:-plataforma-estudiantil-postgres}"
DB_MASTER_DATABASE="${DB_MASTER_DATABASE:-dbplataforma_estudiantil}"
DB_MASTER_USER="${DB_MASTER_USER:-dbmasteruser}"
DB_APP_DATABASE="${DB_APP_DATABASE:-paeu}"
DB_APP_USER="${DB_APP_USER:-paeu_app}"
DB_PORT="${DB_PORT:-5432}"
DB_SSLMODE="${DB_SSLMODE:-require}"   # Lightsail managed PostgreSQL requires TLS

# ---------------------------------------------------------------------------
# Lightsail object storage + CDN (frontend)
# ---------------------------------------------------------------------------
FRONTEND_BUCKET="${FRONTEND_BUCKET:-plataforma-estudiantil-frontend}"
CDN_DISTRIBUTION="${CDN_DISTRIBUTION:-plataforma-estudiantil-cdn}"
CDN_DEFAULT_DOMAIN="${CDN_DEFAULT_DOMAIN:-d3v7aeo2q6v7bm.cloudfront.net}"
CDN_CERTIFICATE_NAME="${CDN_CERTIFICATE_NAME:-plataforma-estudiantil-portal-cert}"
# Lightsail buckets are S3-compatible and are reached through the regular S3
# endpoint using the BUCKET access keys (see 30-frontend-deploy.sh).
S3_ENDPOINT_URL="${S3_ENDPOINT_URL:-https://s3.${AWS_REGION}.amazonaws.com}"

WEB_DIST_REL="${WEB_DIST_REL:-apps/web/dist}"
CACHE_CONTROL_IMMUTABLE="${CACHE_CONTROL_IMMUTABLE:-public, max-age=31536000, immutable}"
CACHE_CONTROL_NO_CACHE="${CACHE_CONTROL_NO_CACHE:-no-cache, no-store, must-revalidate}"
# Lightsail distributions have no custom-error-response API, so wildcard SPA
# fallback is emulated by publishing index.html under each client-side route.
# See the "SPA fallback" note en infra/README.md.
#
# La lista tiene que ser exactamente la de las rutas que el SPA lee de
# window.location.pathname; cualquier otra "ruta" es estado interno y nunca
# llega a la barra de direcciones:
#   components/App.tsx        -> '/' y todo lo que empieza por '/admin'
#   components/PublicApp.tsx  -> '/terminos', '/terminos-y-condiciones',
#                                '/privacidad', '/politica-de-privacidad'
# Publicar alias de rutas que no existen no rompe nada (devuelven el index),
# pero omitir una real deja un 403 de S3 en el enlace directo y en el F5.
# 'contact' y 'programas' quedan por compatibilidad con enlaces ya repartidos.
SPA_FALLBACK_ROUTES="${SPA_FALLBACK_ROUTES:-admin about quienes-somos admissions admisiones terminos terminos-y-condiciones privacidad politica-de-privacidad ferpa title-ix titulo-ix accesibilidad accessibility contact programas vida-estudiantil campus-life atletismo athletics noticias news-events}"

# Fichas de programa: /programas/<slug>.
#
# Una distribución de Lightsail no tiene reescritura comodín, así que cada
# programa necesita su propio alias del index. La lista se obtiene del propio
# catálogo en vez de escribirse a mano —un programa nuevo en Moodle aparece
# solo— y cae a la lista fija de abajo si la API no responde durante el
# despliegue, para no publicar un sitio con las fichas rotas.
PROGRAM_FALLBACK_SLUGS_DEFAULT="moodle-pcl-sales-exc-12 moodle-pcl-sales-ops-13 moodle-pcl-cx-success-14 moodle-pcl-cx-comm-15 moodle-pcl-lead-elead-16 moodle-pcl-lead-team-17 moodle-pcl-lead-change-18 moodle-pcl-ai-exec-19 moodle-pcl-ai-work-20 moodle-pcl-ai-network-21 moodle-pcl-edu-assess-22 moodle-pcl-edu-network-23 moodle-pcl-edu-walk-24"

# Devuelve los slugs del catálogo publicado, uno por línea; vacío si falla.
catalog_program_slugs() {
  local url="${API_URL}${API_PUBLIC_PREFIX}/v1/catalog"
  local body
  body="$(curl -fsS --max-time 20 "$url" 2>/dev/null)" || return 0
  printf '%s' "$body" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    raise SystemExit(0)
programs = data if isinstance(data, list) else data.get("programs", [])
for program in programs:
    slug = (program or {}).get("slug")
    if isinstance(slug, str) and slug and "/" not in slug:
        print(slug)
' 2>/dev/null || return 0
}

# ---------------------------------------------------------------------------
# SSM Parameter Store
#
# Every .env key for the API lives under ${SSM_ENV_PREFIX}/<KEY> as a
# SecureString, so new variables added by other engineers are picked up
# automatically - nothing enumerates a fixed list.
# ---------------------------------------------------------------------------
DEPLOY_ENVIRONMENT="${DEPLOY_ENVIRONMENT:-production}"
SSM_PREFIX="${SSM_PREFIX:-/plataforma-estudiantil/${DEPLOY_ENVIRONMENT}}"
SSM_ENV_PREFIX="${SSM_ENV_PREFIX:-${SSM_PREFIX}/env}"
SSM_KMS_KEY_ID="${SSM_KMS_KEY_ID:-alias/aws/ssm}"
# Non-secret infrastructure values that scripts may also read from SSM.
SSM_DB_HOST_PARAM="${SSM_DB_HOST_PARAM:-${SSM_PREFIX}/infra/db-endpoint}"

# ---------------------------------------------------------------------------
# Repository source
# ---------------------------------------------------------------------------
REPO_URL="${REPO_URL:-}"                 # required only for --source git
REPO_REF="${REPO_REF:-main}"

# ---------------------------------------------------------------------------
# Operator-local overrides (untracked - see infra/deploy/.gitignore)
# ---------------------------------------------------------------------------
if [[ -f "${PAEU_DEPLOY_DIR}/00-config.local.sh" ]]; then
  # shellcheck source=/dev/null
  source "${PAEU_DEPLOY_DIR}/00-config.local.sh"
fi

# $SUDO prefixes every privileged command. It is set to 'sudo' whenever sudo
# exists - including when we are already root - because several call sites use
# sudo's own -u/-g flags to drop to the service user or to Apache's 'daemon'
# user, and those have no equivalent without it. (sudo as root is a no-op
# privilege-wise.) run() and sudoq() both tolerate an empty value.
if [[ -z "${SUDO+x}" ]]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  elif [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    SUDO=""
  else
    SUDO=""
    warn "sudo is not installed and this shell is not root; privileged steps will fail"
  fi
fi

paeu_print_config() {
  cat <<EOF
environment      : ${DEPLOY_ENVIRONMENT}
region / account : ${AWS_REGION} / ${AWS_ACCOUNT_ID}
portal           : ${PORTAL_URL}
api              : ${API_URL}${API_PUBLIC_PREFIX}
lms              : ${LMS_URL}
api instance     : ${API_INSTANCE_NAME} (${API_STATIC_IP}, ssh ${API_SSH_USER}@)
moodle instance  : ${MOODLE_INSTANCE_NAME} (${MOODLE_STATIC_IP}, ssh ${MOODLE_SSH_USER}@)
database         : ${DB_INSTANCE_NAME} app db ${DB_APP_DATABASE} as ${DB_APP_USER}
bucket / cdn     : ${FRONTEND_BUCKET} / ${CDN_DISTRIBUTION}
ssm env prefix   : ${SSM_ENV_PREFIX}
app root         : ${APP_ROOT} (pm2 app ${PM2_APP_NAME})
moodle root      : ${MOODLE_DIR} (data ${MOODLE_DATA_DIR})
EOF
}
