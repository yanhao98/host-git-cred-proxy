#!/usr/bin/env bash
set -euo pipefail

subcommand="${1:-}"
action="${2:-}"
input="$(cat)"

if [[ "$subcommand" != "credential" ]]; then
  printf 'unsupported git subcommand: %s\n' "$subcommand" >&2
  exit 64
fi

if [[ -n "${GIT_CREDENTIAL_STUB_LOG_FILE:-}" ]]; then
  printf '%s,%s\n' "$action" "${GIT_TERMINAL_PROMPT:-}" >>"${GIT_CREDENTIAL_STUB_LOG_FILE}"
fi

extract_field() {
  local key="$1"
  local line

  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      "$key="*)
        printf '%s' "${line#*=}"
        return 0
        ;;
    esac
  done <<<"$input"

  return 1
}

case "$action" in
  fill)
    mode="${GIT_CREDENTIAL_STUB_FILL_MODE:-ok}"

    case "$mode" in
      ok)
        ;;
      missing-terminal-prompts)
        printf 'terminal prompts disabled\n' >&2
        exit 1
        ;;
      missing-username)
        printf 'could not read username\n' >&2
        exit 1
        ;;
      missing-password)
        printf 'could not read password\n' >&2
        exit 1
        ;;
      *)
        printf '%s\n' "$mode" >&2
        exit 1
        ;;
    esac

    protocol="$(extract_field protocol || true)"
    host="$(extract_field host || true)"

    printf 'protocol=%s\n' "${protocol:-https}"
    printf 'host=%s\n' "${host:-example.com}"
    printf 'username=%s\n' "${GIT_CREDENTIAL_STUB_USERNAME:-stub-user}"
    printf 'password=%s\n' "${GIT_CREDENTIAL_STUB_PASSWORD:-stub-pass}"
    printf '\n'
    ;;
  approve | reject)
    exit 0
    ;;
  *)
    printf 'unsupported credential action: %s\n' "$action" >&2
    exit 64
    ;;
esac
