#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
helper_path="$script_dir/git-credential-hostproxy"
scope='global'
target_repo=$(pwd)

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

if [ "$scope" = 'global' ]; then
  git config --global --replace-all credential.helper ''
  git config --global --add credential.helper "$helper_path"
  git config --global credential.useHttpPath true
  printf 'Configured global Git credential helper: %s\n' "$helper_path"
else
  git -C "$target_repo" config --local --replace-all credential.helper ''
  git -C "$target_repo" config --local --add credential.helper "$helper_path"
  git -C "$target_repo" config --local credential.useHttpPath true
  printf 'Configured local Git credential helper for %s\n' "$target_repo"
fi

printf 'Proxy URL default: %s\n' "${GIT_CRED_PROXY_URL:-http://host.docker.internal:18765}"
printf 'Protocol filter is configured on the host side\n'
