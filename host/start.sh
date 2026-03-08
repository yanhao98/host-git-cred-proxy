#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
state_dir="$script_dir/state"
pid_file="$state_dir/server.pid"
log_file="$state_dir/server.log"
token_file="$state_dir/token"
config_file="$state_dir/config.env"

host="${GIT_CRED_PROXY_HOST:-127.0.0.1}"
port="${GIT_CRED_PROXY_PORT:-18765}"
protocols="${GIT_CRED_PROXY_PROTOCOLS:-https}"
allowed_hosts="${GIT_CRED_PROXY_ALLOWED_HOSTS:-}"
public_url="${GIT_CRED_PROXY_PUBLIC_URL:-http://host.docker.internal:${port}}"

mkdir -p "$state_dir"

if [ -f "$pid_file" ]; then
  old_pid=$(cat "$pid_file" 2>/dev/null || true)
  if [ -n "${old_pid:-}" ] && kill -0 "$old_pid" 2>/dev/null; then
    printf 'Proxy already running: pid=%s\n' "$old_pid"
    printf 'Container URL: %s\n' "$public_url"
    printf 'Token file: %s\n' "$token_file"
    exit 0
  fi
  rm -f "$pid_file"
fi

if [ ! -f "$token_file" ]; then
  if ! command -v openssl >/dev/null 2>&1; then
    printf 'openssl is required to create the token file\n' >&2
    exit 1
  fi

  umask 077
  openssl rand -hex 32 > "$token_file"
fi

runtime=''
if [ -n "${GIT_CRED_PROXY_RUNTIME:-}" ]; then
  runtime="$GIT_CRED_PROXY_RUNTIME"
elif command -v bun >/dev/null 2>&1; then
  runtime='bun'
elif command -v node >/dev/null 2>&1; then
  runtime='node'
else
  printf 'Either bun or node is required to start the proxy\n' >&2
  exit 1
fi

token=$(tr -d '\r\n' < "$token_file")

cat > "$config_file" <<EOF
GIT_CRED_PROXY_HOST=$host
GIT_CRED_PROXY_PORT=$port
GIT_CRED_PROXY_PUBLIC_URL=$public_url
GIT_CRED_PROXY_PROTOCOLS=$protocols
GIT_CRED_PROXY_ALLOWED_HOSTS=$allowed_hosts
EOF
chmod 600 "$config_file"

GIT_CRED_PROXY_HOST="$host" \
GIT_CRED_PROXY_PORT="$port" \
GIT_CRED_PROXY_TOKEN="$token" \
GIT_CRED_PROXY_PROTOCOLS="$protocols" \
GIT_CRED_PROXY_ALLOWED_HOSTS="$allowed_hosts" \
nohup "$runtime" "$script_dir/server.mjs" >>"$log_file" 2>&1 &

pid=$!
printf '%s\n' "$pid" > "$pid_file"

sleep 1

if ! kill -0 "$pid" 2>/dev/null; then
  printf 'Proxy failed to start. Check %s\n' "$log_file" >&2
  exit 1
fi

printf 'Proxy started\n'
printf 'Host listen URL: http://%s:%s\n' "$host" "$port"
printf 'Container URL: %s\n' "$public_url"
printf 'Token file: %s\n' "$token_file"
printf 'Log file: %s\n' "$log_file"
printf 'Next: run /workspaces/host-git-cred-proxy/container/configure-git.sh inside the container\n'
