#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
state_dir="$script_dir/state"
pid_file="$state_dir/server.pid"
log_file="$state_dir/server.log"
config_file="$state_dir/config.env"

host='127.0.0.1'
port='18765'
public_url="http://host.docker.internal:${port}"

if [ -f "$config_file" ]; then
  . "$config_file"
  host="${GIT_CRED_PROXY_HOST:-$host}"
  port="${GIT_CRED_PROXY_PORT:-$port}"
  public_url="${GIT_CRED_PROXY_PUBLIC_URL:-$public_url}"
fi

printf 'Host listen URL: http://%s:%s\n' "$host" "$port"
printf 'Container URL: %s\n' "$public_url"

if [ ! -f "$pid_file" ]; then
  printf 'Status: stopped\n'
  exit 1
fi

pid=$(cat "$pid_file" 2>/dev/null || true)

if [ -z "${pid:-}" ] || ! kill -0 "$pid" 2>/dev/null; then
  printf 'Status: stale pid file\n'
  exit 1
fi

printf 'Status: running (pid=%s)\n' "$pid"

if command -v curl >/dev/null 2>&1; then
  if curl -fsS "http://${host}:${port}/healthz" >/dev/null 2>&1; then
    printf 'Health: ok\n'
  else
    printf 'Health: check failed\n'
  fi
fi

if [ -f "$log_file" ]; then
  printf 'Log file: %s\n' "$log_file"
fi
