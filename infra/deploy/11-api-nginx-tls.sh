#!/usr/bin/env bash
#
# 11-api-nginx-tls.sh - RUNS ON THE API INSTANCE (plataforma-estudiantil-api).
#
# Publishes the Fastify API at https://api.portal.thefloridianuniversity.com:
#   1. install the reviewable snippets + vhosts from infra/nginx/
#   2. bring up the port-80 vhost (ACME challenge + HTTPS redirect)
#   3. issue/renew the Let's Encrypt certificate with certbot --webroot
#   4. install the port-443 vhost that reverse-proxies to 127.0.0.1:4000 with
#      the request URI untouched (Fastify's rewriteUrl strips /api itself)
#   5. verify renewal is armed (systemd timer or cron) and dry-run it
#
# Idempotent: existing certificates are reused, config is only rewritten when
# the rendered content actually differs, and nginx is only reloaded on change.
#
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=00-config.sh
source "${SCRIPT_DIR}/00-config.sh"
install_err_trap

NGINX_TEMPLATE_DIR="${NGINX_TEMPLATE_DIR:-${PAEU_INFRA_DIR}/nginx}"
ACME_WEBROOT="${ACME_WEBROOT:-/var/www/letsencrypt}"
CLIENT_MAX_BODY="${CLIENT_MAX_BODY:-64m}"
STAGING_CERT=0
SKIP_CERT=0
RENEW_DRY_RUN=1
FORCE="${FORCE:-0}"
DRY_RUN="${DRY_RUN:-0}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Runs ON the API instance (${API_INSTANCE_NAME}, ${API_STATIC_IP}) with sudo.
Configures nginx for ${API_HOST} -> ${API_UPSTREAM} and issues TLS.

Options
  --staging            Use the Let's Encrypt staging CA (safe for rehearsals;
                       produces an untrusted cert, so 90-smoke-test.sh will
                       report a TLS failure - that is expected).
  --skip-cert          Only (re)write the nginx config; do not touch certbot.
  --no-renew-dry-run   Skip 'certbot renew --dry-run' at the end.
  --webroot <dir>      ACME http-01 webroot. Default: ${ACME_WEBROOT}
  --max-body <size>    nginx client_max_body_size. Default: ${CLIENT_MAX_BODY}
  --force              Allow 'certbot --force-renewal'.
  --dry-run            Print what would happen; change nothing.
  -h, --help           This text.

Prerequisites
  * ${API_HOST} must already resolve to ${API_STATIC_IP} in Cloudflare, as a
    grey-cloud ("DNS only") A record. Proxied (orange cloud) records make the
    http-01 challenge fail.
  * Lightsail firewall for this instance must allow TCP 80 and 443.
  * 10-api-bootstrap.sh must have run (something has to answer on ${API_UPSTREAM}).

Notes
  No CORS header is added in nginx. The app registers @fastify/cors itself
  (origin: true); duplicating the header here would break browsers.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --staging)          STAGING_CERT=1; shift ;;
    --skip-cert)        SKIP_CERT=1; shift ;;
    --no-renew-dry-run) RENEW_DRY_RUN=0; shift ;;
    --webroot)          ACME_WEBROOT="${2:-}"; shift 2 ;;
    --webroot=*)        ACME_WEBROOT="${1#*=}"; shift ;;
    --max-body)         CLIENT_MAX_BODY="${2:-}"; shift 2 ;;
    --max-body=*)       CLIENT_MAX_BODY="${1#*=}"; shift ;;
    --force)            FORCE=1; shift ;;
    --dry-run)          DRY_RUN=1; shift ;;
    -h|--help)          usage; exit 0 ;;
    *)                  die_usage "$(usage)" ;;
  esac
done
export FORCE DRY_RUN

LE_LIVE="/etc/letsencrypt/live/${API_HOST}"
HTTP_CONF_AVAIL="/etc/nginx/sites-available/${API_HOST}.conf"
SSL_CONF_AVAIL="/etc/nginx/sites-available/${API_HOST}-ssl.conf"
HTTP_CONF_LINK="/etc/nginx/sites-enabled/${API_HOST}.conf"
SSL_CONF_LINK="/etc/nginx/sites-enabled/${API_HOST}-ssl.conf"
__PAEU_FILE_CHANGED=0

nginx_test_and_reload() {
  log "nginx -t"
  if [[ "$DRY_RUN" == "1" ]]; then
    warn "dry-run: skipping nginx -t / reload"
    return 0
  fi
  if ! sudoq nginx -t; then
    fail "nginx configuration test failed; nothing was reloaded"
  fi
  run "${SUDO:-}" systemctl reload nginx
  ok "nginx reloaded"
}

enable_site() {
  local avail="$1" link="$2"
  if [[ -L "$link" && "$(readlink -f "$link")" == "$(readlink -f "$avail")" ]]; then
    log "already enabled: $(basename "$link")"
    return 0
  fi
  run "${SUDO:-}" ln -sfn "$avail" "$link"
  __PAEU_FILE_CHANGED=1
  ok "enabled $(basename "$link")"
}

# ---------------------------------------------------------------------------
log "configuring nginx for ${API_HOST}"
need_cmd nginx "sudo apt-get install -y nginx"
need_cmd curl
[[ -d "$NGINX_TEMPLATE_DIR" ]] || fail "nginx templates not found at ${NGINX_TEMPLATE_DIR}"

# Reviewable snippets first; the vhosts include them by path.
ensure_dir /etc/nginx/snippets 0755 root:root
install_file "${NGINX_TEMPLATE_DIR}/snippets/security-headers.conf" \
             /etc/nginx/snippets/paeu-security-headers.conf 0644 root:root
install_file "${NGINX_TEMPLATE_DIR}/snippets/proxy-params.conf" \
             /etc/nginx/snippets/paeu-proxy-params.conf 0644 root:root

# Never advertise the nginx version anywhere, including default error pages.
TOKENS_CONF="$(mktemp)"
printf 'server_tokens off;\n' > "$TOKENS_CONF"
install_file "$TOKENS_CONF" /etc/nginx/conf.d/paeu-server-tokens.conf 0644 root:root
rm -f "$TOKENS_CONF"

ensure_dir "${ACME_WEBROOT}/.well-known/acme-challenge" 0755 "www-data:www-data"

# --- stage 1: port 80 -------------------------------------------------------
log "stage 1: port-80 vhost (ACME + redirect)"
render_template "${NGINX_TEMPLATE_DIR}/api.portal.http.conf.template" \
  "$HTTP_CONF_AVAIL" \
  "API_HOST=${API_HOST}" \
  "ACME_WEBROOT=${ACME_WEBROOT}"
enable_site "$HTTP_CONF_AVAIL" "$HTTP_CONF_LINK"

# Debian/Ubuntu ships a catch-all default site that would answer first.
if [[ -L /etc/nginx/sites-enabled/default ]]; then
  warn "disabling the packaged nginx 'default' site"
  run "${SUDO:-}" rm -f /etc/nginx/sites-enabled/default
  __PAEU_FILE_CHANGED=1
fi

nginx_test_and_reload

# --- stage 2: certificate ---------------------------------------------------
if [[ "$SKIP_CERT" == "1" ]]; then
  warn "--skip-cert: not touching certbot"
else
  need_cmd certbot "sudo apt-get install -y certbot"

  if [[ -s "${LE_LIVE}/fullchain.pem" && "$FORCE" != "1" ]]; then
    log "certificate already present at ${LE_LIVE}; reusing it"
    if [[ "$DRY_RUN" != "1" ]]; then
      sudoq openssl x509 -in "${LE_LIVE}/fullchain.pem" -noout -subject -enddate >&2 || true
    fi
  else
    local_args=(
      certonly --webroot -w "$ACME_WEBROOT"
      -d "$API_HOST"
      --non-interactive --agree-tos
      -m "$LETSENCRYPT_EMAIL"
      --keep-until-expiring
      --rsa-key-size 2048
      --deploy-hook "/usr/bin/systemctl reload nginx"
    )
    if [[ "$STAGING_CERT" == "1" ]]; then
      warn "using the Let's Encrypt STAGING CA (cert will not be trusted)"
      local_args+=(--staging)
    fi
    if [[ "$FORCE" == "1" && -s "${LE_LIVE}/fullchain.pem" ]]; then
      confirm_destructive "force-renew the live certificate for ${API_HOST}"
      local_args+=(--force-renewal)
    fi

    # Fail fast with a useful message instead of a certbot stack trace.
    if [[ "$DRY_RUN" != "1" ]]; then
      token="paeu-acme-selftest-$$"
      printf 'ok\n' | sudoq tee "${ACME_WEBROOT}/.well-known/acme-challenge/${token}" >/dev/null
      if ! curl -fsS --max-time 10 "http://${API_HOST}/.well-known/acme-challenge/${token}" | grep -q '^ok$'; then
        sudoq rm -f "${ACME_WEBROOT}/.well-known/acme-challenge/${token}"
        fail "the ACME challenge path is not reachable over plain HTTP at http://${API_HOST}/.well-known/acme-challenge/
Check: (a) the Cloudflare A record for ${API_HOST} points to ${API_STATIC_IP} and is grey-cloud/'DNS only';
       (b) the Lightsail firewall allows TCP 80;
       (c) nothing else is bound to :80."
      fi
      sudoq rm -f "${ACME_WEBROOT}/.well-known/acme-challenge/${token}"
      ok "ACME challenge path verified"
    fi

    run "${SUDO:-}" certbot "${local_args[@]}"
    __PAEU_FILE_CHANGED=1
  fi
fi

# --- stage 3: port 443 ------------------------------------------------------
if [[ "$DRY_RUN" != "1" && ! -s "${LE_LIVE}/fullchain.pem" ]]; then
  fail "no certificate at ${LE_LIVE}/fullchain.pem; cannot install the HTTPS vhost. Re-run without --skip-cert."
fi

log "stage 2: port-443 vhost (reverse proxy, URI preserved)"
render_template "${NGINX_TEMPLATE_DIR}/api.portal.ssl.conf.template" \
  "$SSL_CONF_AVAIL" \
  "API_HOST=${API_HOST}" \
  "API_UPSTREAM=${API_UPSTREAM}" \
  "ACME_WEBROOT=${ACME_WEBROOT}" \
  "TLS_CERT=${LE_LIVE}/fullchain.pem" \
  "TLS_KEY=${LE_LIVE}/privkey.pem" \
  "TLS_CHAIN=${LE_LIVE}/chain.pem" \
  "CLIENT_MAX_BODY=${CLIENT_MAX_BODY}"
enable_site "$SSL_CONF_AVAIL" "$SSL_CONF_LINK"
nginx_test_and_reload

# --- stage 4: renewal is armed ---------------------------------------------
if [[ "$SKIP_CERT" != "1" ]]; then
  log "checking automatic renewal"
  renewal_armed=0
  if systemctl list-timers --all 2>/dev/null | grep -q 'certbot'; then
    log "systemd timer certbot.timer is present"
    renewal_armed=1
  fi
  if [[ -f /etc/cron.d/certbot ]]; then
    log "/etc/cron.d/certbot is present"
    renewal_armed=1
  fi
  if [[ "$renewal_armed" != "1" ]]; then
    warn "no certbot timer or cron entry found; installing a daily systemd timer"
    TIMER_SVC="$(mktemp)"
    cat > "$TIMER_SVC" <<EOF
[Unit]
Description=Renew Let's Encrypt certificates (plataforma-estudiantil)

[Service]
Type=oneshot
ExecStart=/usr/bin/certbot renew --quiet --deploy-hook "/usr/bin/systemctl reload nginx"
EOF
    install_file "$TIMER_SVC" /etc/systemd/system/paeu-certbot-renew.service 0644 root:root
    cat > "$TIMER_SVC" <<EOF
[Unit]
Description=Daily Let's Encrypt renewal check (plataforma-estudiantil)

[Timer]
OnCalendar=*-*-* 03:17:00
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
EOF
    install_file "$TIMER_SVC" /etc/systemd/system/paeu-certbot-renew.timer 0644 root:root
    rm -f "$TIMER_SVC"
    run "${SUDO:-}" systemctl daemon-reload
    run "${SUDO:-}" systemctl enable --now paeu-certbot-renew.timer
  fi

  # Ensure the deploy hook exists even for a certificate issued before this
  # script ever ran, so a renewal actually reloads nginx.
  ensure_dir /etc/letsencrypt/renewal-hooks/deploy 0755 root:root
  HOOK="$(mktemp)"
  cat > "$HOOK" <<'EOF'
#!/usr/bin/env bash
# Installed by infra/deploy/11-api-nginx-tls.sh
set -Eeuo pipefail
systemctl reload nginx
EOF
  install_file "$HOOK" /etc/letsencrypt/renewal-hooks/deploy/00-reload-nginx.sh 0755 root:root
  rm -f "$HOOK"

  if [[ "$RENEW_DRY_RUN" == "1" && "$DRY_RUN" != "1" ]]; then
    log "certbot renew --dry-run (no certificate is replaced)"
    if sudoq certbot renew --dry-run >/dev/null 2>&1; then
      ok "renewal dry-run succeeded"
    else
      warn "renewal dry-run FAILED; run 'sudo certbot renew --dry-run' and read the output"
    fi
  fi
fi

# --- stage 5: prove the routing contract ------------------------------------
if [[ "$DRY_RUN" != "1" ]]; then
  log "verifying the /api prefix survives the proxy"
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    "https://${API_HOST}${API_PUBLIC_PREFIX}/health" || echo 000)"
  if [[ "$code" == "200" ]]; then
    ok "GET https://${API_HOST}${API_PUBLIC_PREFIX}/health -> 200"
  else
    warn "GET https://${API_HOST}${API_PUBLIC_PREFIX}/health -> ${code}
If this is 404, something is stripping /api twice (nginx must NOT rewrite it).
If this is 502, the app is not listening on ${API_UPSTREAM} - check 'pm2 ls'."
  fi
fi

ok "nginx + TLS configured for ${API_HOST}"
log "next: 20-moodle-install.sh on ${MOODLE_INSTANCE_NAME}, then 90-smoke-test.sh"
