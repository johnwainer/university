#!/usr/bin/env bash
# shellcheck shell=bash
#
# common.sh - shared helpers for the plataforma-estudiantil deployment kit.
# This file is SOURCED (never executed). It is pulled in by 00-config.sh, so
# every script only needs:  source "<dir>/00-config.sh"
#
# Provides: log / warn / err / fail / die_usage / run / need_cmd / need_env
#           confirm_destructive / ensure_dir / install_file / retry / json_get

if [[ -n "${__PAEU_COMMON_SOURCED:-}" ]]; then
  return 0
fi
__PAEU_COMMON_SOURCED=1
# This file is sourced, never executed.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    printf '%s is meant to be sourced, not executed.\n' "${BASH_SOURCE[0]}" >&2
    printf 'Use:  source "%s"\n' "${BASH_SOURCE[0]}" >&2
    exit 2
fi


# --- output -----------------------------------------------------------------

if [[ -t 2 ]]; then
  __C_RESET=$'\033[0m'; __C_DIM=$'\033[2m'; __C_RED=$'\033[31m'
  __C_GREEN=$'\033[32m'; __C_YELLOW=$'\033[33m'; __C_BLUE=$'\033[34m'
else
  __C_RESET=''; __C_DIM=''; __C_RED=''; __C_GREEN=''; __C_YELLOW=''; __C_BLUE=''
fi

__ts() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }

log()  { printf '%s%s%s %s[INFO ]%s %s\n'  "$__C_DIM" "$(__ts)" "$__C_RESET" "$__C_BLUE"   "$__C_RESET" "$*" >&2; }
ok()   { printf '%s%s%s %s[ OK  ]%s %s\n'  "$__C_DIM" "$(__ts)" "$__C_RESET" "$__C_GREEN"  "$__C_RESET" "$*" >&2; }
warn() { printf '%s%s%s %s[WARN ]%s %s\n'  "$__C_DIM" "$(__ts)" "$__C_RESET" "$__C_YELLOW" "$__C_RESET" "$*" >&2; }
err()  { printf '%s%s%s %s[ERROR]%s %s\n'  "$__C_DIM" "$(__ts)" "$__C_RESET" "$__C_RED"    "$__C_RESET" "$*" >&2; }

fail() { err "$*"; exit 1; }

# die_usage <usage-text>
die_usage() { printf '%s\n' "$1" >&2; exit 2; }

# Printed by the ERR trap installed in every top-level script.
__paeu_on_err() {
  local exit_code=$? line=${1:-?} cmd=${2:-?}
  err "aborted at line ${line}: '${cmd}' exited ${exit_code}"
  exit "$exit_code"
}

# install_err_trap - call once at the top of an executable script.
install_err_trap() {
  trap '__paeu_on_err "$LINENO" "$BASH_COMMAND"' ERR
}

# --- execution --------------------------------------------------------------

# run <cmd...> - echo the command; skip it when DRY_RUN=1.
#
# Leading empty arguments are dropped. Callers write `run "${SUDO:-}" cmd ...`,
# and when the script is already running as root $SUDO is empty - without this,
# bash would try to execute the empty string and fail with "command not found".
run() {
  local -a argv=()
  local arg
  for arg in "$@"; do
    if [[ -z "$arg" && ${#argv[@]} -eq 0 ]]; then
      continue
    fi
    argv+=("$arg")
  done
  if (( ${#argv[@]} == 0 )); then
    warn "run: nothing to execute"
    return 0
  fi
  if [[ "${DRY_RUN:-0}" == "1" ]]; then
    printf '%s[dry-run]%s %s\n' "$__C_YELLOW" "$__C_RESET" "${argv[*]}" >&2
    return 0
  fi
  printf '%s      +%s %s\n' "$__C_DIM" "$__C_RESET" "${argv[*]}" >&2
  "${argv[@]}"
}

# sudoq <cmd...> - run a command with $SUDO, or directly when $SUDO is empty.
#
# For the places that must NOT go through run(): pipelines, command
# substitutions and `if` conditions, where run()'s logging or its return value
# would get in the way. Same empty-$SUDO problem, same fix.
sudoq() {
  if [[ -n "${SUDO:-}" ]]; then
    "$SUDO" "$@"
  else
    "$@"
  fi
}

# need_cmd <cmd> [hint]
need_cmd() {
  local cmd="$1" hint="${2:-}"
  command -v "$cmd" >/dev/null 2>&1 && return 0
  if [[ -n "$hint" ]]; then
    fail "required command '${cmd}' not found. ${hint}"
  fi
  fail "required command '${cmd}' not found in PATH"
}

# need_env <VAR> [hint] - fail when the variable is unset or empty.
need_env() {
  local name="$1" hint="${2:-}"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    if [[ -n "$hint" ]]; then
      fail "environment variable ${name} is required. ${hint}"
    fi
    fail "environment variable ${name} is required but empty"
  fi
}

# retry <attempts> <sleep-seconds> <cmd...>
retry() {
  local attempts="$1" delay="$2"; shift 2
  local n=1
  until "$@"; do
    if (( n >= attempts )); then
      return 1
    fi
    warn "attempt ${n}/${attempts} failed; retrying in ${delay}s: $*"
    sleep "$delay"
    n=$(( n + 1 ))
  done
  return 0
}

# confirm_destructive <description>
# Every destructive step must call this. It only proceeds when FORCE=1
# (normally set by the caller's --force flag).
confirm_destructive() {
  local what="$1"
  if [[ "${FORCE:-0}" == "1" ]]; then
    warn "--force given: proceeding with destructive step: ${what}"
    return 0
  fi
  fail "refusing to ${what} without --force (re-run with --force if you really mean it)"
}

# --- filesystem -------------------------------------------------------------

# ensure_dir <path> [mode] [owner]
ensure_dir() {
  local path="$1" mode="${2:-}" owner="${3:-}"
  if [[ ! -d "$path" ]]; then
    run "${SUDO:-}" mkdir -p "$path"
  fi
  [[ -n "$mode"  ]] && run "${SUDO:-}" chmod "$mode" "$path"
  [[ -n "$owner" ]] && run "${SUDO:-}" chown "$owner" "$path"
  return 0
}

# install_file <src> <dest> [mode] [owner]
# Idempotent: only writes (and reports) when the content actually differs.
install_file() {
  local src="$1" dest="$2" mode="${3:-0644}" owner="${4:-root:root}"
  if [[ ! -f "$src" ]]; then
    fail "install_file: source '${src}' does not exist"
  fi
  if [[ -f "$dest" ]] && cmp -s "$src" "$dest"; then
    log "unchanged: ${dest}"
  else
    ensure_dir "$(dirname "$dest")"
    run "${SUDO:-}" install -o "${owner%%:*}" -g "${owner##*:}" -m "$mode" "$src" "$dest"
    ok "written: ${dest}"
    __PAEU_FILE_CHANGED=1
  fi
  return 0
}

# render_template <template> <dest> <KEY=VALUE>...
# Substitutes __KEY__ placeholders using pure bash parameter expansion (no sed
# escaping hazards with URLs, slashes or ampersands). Idempotent via install_file.
render_template() {
  local tpl="$1" dest="$2"; shift 2
  [[ -f "$tpl" ]] || fail "render_template: template '${tpl}' not found"
  local content
  content="$(cat "$tpl")"
  local pair key value
  for pair in "$@"; do
    key="${pair%%=*}"
    value="${pair#*=}"
    content="${content//__${key}__/${value}}"
  done
  if printf '%s' "$content" | grep -q '__[A-Z0-9_]\+__'; then
    warn "template ${tpl} still contains unsubstituted placeholders:"
    printf '%s' "$content" | grep -o '__[A-Z0-9_]\+__' | sort -u >&2
  fi
  local tmp
  tmp="$(mktemp)"
  printf '%s\n' "$content" > "$tmp"
  install_file "$tmp" "$dest" "${TEMPLATE_MODE:-0644}" "${TEMPLATE_OWNER:-root:root}"
  rm -f "$tmp"
}

# --- json -------------------------------------------------------------------

# json_get <jq-filter> <python-expression>
# Reads JSON on stdin. Prefers jq; falls back to python3 so operator machines
# without jq still work. Prints nothing and returns 1 when the value is absent.
json_get() {
  local jq_filter="$1" py_expr="$2" body out
  body="$(cat)"
  if command -v jq >/dev/null 2>&1; then
    out="$(printf '%s' "$body" | jq -r "$jq_filter" 2>/dev/null)" || return 1
  elif command -v python3 >/dev/null 2>&1; then
    out="$(printf '%s' "$body" | python3 -I -c "
import json,sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(1)
try:
    v = ${py_expr}
except Exception:
    sys.exit(1)
if v is None:
    sys.exit(1)
print(v if not isinstance(v, bool) else str(v).lower())
" 2>/dev/null)" || return 1
  else
    fail "need either 'jq' or 'python3' to parse JSON responses"
  fi
  [[ -n "$out" && "$out" != "null" ]] || return 1
  printf '%s' "$out"
}

# json_valid - returns 0 when stdin is parseable JSON.
json_valid() {
  if command -v jq >/dev/null 2>&1; then
    jq -e . >/dev/null 2>&1
  elif command -v python3 >/dev/null 2>&1; then
    python3 -I -c 'import json,sys; json.load(sys.stdin)' >/dev/null 2>&1
  else
    fail "need either 'jq' or 'python3' to parse JSON responses"
  fi
}
