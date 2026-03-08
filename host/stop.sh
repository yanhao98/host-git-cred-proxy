#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
pid_file="$script_dir/state/server.pid"

if [ ! -f "$pid_file" ]; then
  printf 'Proxy is not running\n'
  exit 0
fi

pid=$(cat "$pid_file" 2>/dev/null || true)

if [ -z "${pid:-}" ]; then
  rm -f "$pid_file"
  printf 'Stale pid file removed\n'
  exit 0
fi

if kill -0 "$pid" 2>/dev/null; then
  kill "$pid"
  printf 'Stopped proxy pid=%s\n' "$pid"
else
  printf 'Proxy process was not running, removing stale pid file\n'
fi

rm -f "$pid_file"
