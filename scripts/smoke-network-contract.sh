#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

evidence_file="${NETWORK_CONTRACT_EVIDENCE_FILE:-$repo_dir/.sisyphus/evidence/task-1-network-contract.txt}"
vendor="${NETWORK_CONTRACT_VENDOR:-auto}"
probe_url="${NETWORK_CONTRACT_PROBE_URL:-http://host.docker.internal:18765/healthz}"
require_probe="${NETWORK_CONTRACT_REQUIRE_DOCKER_PROBE:-0}"
test_target="${NETWORK_CONTRACT_TEST_TARGET:-tests/host/network-contract.test.ts}"

mkdir -p "$(dirname -- "$evidence_file")"

log_line() {
  printf '%s\n' "$1" | tee -a "$evidence_file"
}

run_contract_test() {
  if ! command -v bun >/dev/null 2>&1; then
    log_line 'ERROR_BUN_NOT_INSTALLED'
    return 1
  fi

  log_line "RUN_BUN_TEST $test_target"
  if bun test "$test_target" >>"$evidence_file" 2>&1; then
    log_line 'BUN_TEST_OK'
    return 0
  fi

  log_line 'BUN_TEST_FAILED'
  return 1
}

run_docker_desktop_probe() {
  if ! command -v docker >/dev/null 2>&1; then
    log_line 'SKIPPED_DOCKER_DESKTOP_NOT_INSTALLED'
    return 0
  fi

  if ! docker info >/dev/null 2>&1; then
    log_line 'SKIPPED_DOCKER_DESKTOP_DAEMON_UNAVAILABLE'
    return 0
  fi

  log_line "RUN_DOCKER_DESKTOP_PROBE $probe_url"
  if docker run --rm curlimages/curl:8.7.1 curl -fsS "$probe_url" >>"$evidence_file" 2>&1; then
    log_line 'DOCKER_DESKTOP_PROBE_OK'
    return 0
  fi

  log_line 'DOCKER_DESKTOP_PROBE_FAILED'
  if [ "$require_probe" = '1' ]; then
    return 1
  fi

  return 0
}

run_orbstack_probe() {
  if ! command -v orbctl >/dev/null 2>&1; then
    log_line 'SKIPPED_ORBSTACK_NOT_INSTALLED'
    return 0
  fi

  if ! command -v docker >/dev/null 2>&1; then
    log_line 'SKIPPED_ORBSTACK_DOCKER_CLI_NOT_INSTALLED'
    return 0
  fi

  if ! docker info >/dev/null 2>&1; then
    log_line 'SKIPPED_ORBSTACK_DAEMON_UNAVAILABLE'
    return 0
  fi

  log_line "RUN_ORBSTACK_PROBE $probe_url"
  if docker run --rm curlimages/curl:8.7.1 curl -fsS "$probe_url" >>"$evidence_file" 2>&1; then
    log_line 'ORBSTACK_PROBE_OK'
    return 0
  fi

  log_line 'ORBSTACK_PROBE_FAILED'
  if [ "$require_probe" = '1' ]; then
    return 1
  fi

  return 0
}

printf 'network-contract-smoke %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" >"$evidence_file"

run_contract_test

case "$vendor" in
  auto)
    run_docker_desktop_probe
    run_orbstack_probe
    ;;
  docker-desktop)
    run_docker_desktop_probe
    ;;
  orbstack)
    run_orbstack_probe
    ;;
  none)
    log_line 'SKIPPED_DOCKER_DESKTOP_NOT_SELECTED'
    log_line 'SKIPPED_ORBSTACK_NOT_SELECTED'
    ;;
  *)
    log_line "ERROR_UNSUPPORTED_VENDOR $vendor"
    exit 1
    ;;
esac

log_line 'SMOKE_NETWORK_CONTRACT_DONE'
