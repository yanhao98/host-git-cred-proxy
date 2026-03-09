#!/bin/sh
set -eu

scope='global'
target_repo=$(pwd)
helper_cmd='git-credential-hostproxy'

while [ "$#" -gt 0 ]; do
  case "$1" in
    --global)
      scope='global'
      ;;
    --local)
      scope='local'
      ;;
    --repo)
      shift
      if [ "$#" -eq 0 ]; then
        printf 'Missing value for --repo\n' >&2
        exit 1
      fi
      target_repo="$1"
      ;;
    *)
      printf 'Usage: %s [--global|--local] [--repo PATH]\n' "$0" >&2
      exit 1
      ;;
  esac
  shift
done

git_config() {
  if [ "$scope" = 'global' ]; then
    git config --global "$@"
  else
    git -C "$target_repo" config --local "$@"
  fi
}

tmp_helpers=$(mktemp)
git_config --get-all credential.helper > "$tmp_helpers" 2>/dev/null || true

new_helpers_tmp=$(mktemp)
printf '%s\n' "$helper_cmd" > "$new_helpers_tmp"

while IFS= read -r existing_helper; do
  if [ -z "$existing_helper" ]; then
    continue
  fi
  if [ "$existing_helper" != "$helper_cmd" ]; then
    case "$existing_helper" in
      */git-credential-hostproxy)
        ;;
      *)
        printf '%s\n' "$existing_helper" >> "$new_helpers_tmp"
        ;;
    esac
  fi
done < "$tmp_helpers"

git_config --unset-all credential.helper 2>/dev/null || true

while IFS= read -r helper; do
  git_config --add credential.helper "$helper"
done < "$new_helpers_tmp"

git_config credential.useHttpPath true

rm -f "$tmp_helpers" "$new_helpers_tmp"

if [ "$scope" = 'global' ]; then
  printf 'Configured global Git credential helper chain:\n'
else
  printf 'Configured local Git credential helper chain for %s:\n' "$target_repo"
fi
git_config --get-all credential.helper

printf '\nProxy URL default: %s\n' "${GIT_CRED_PROXY_URL:-http://host.docker.internal:18765}"
printf 'Protocol filter is configured on the host side\n'

