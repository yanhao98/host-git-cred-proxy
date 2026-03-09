#!/bin/sh
set -eu

default_install_dir='/usr/local/bin'
recommended_token_file_path='/run/host-git-cred-proxy/token'
base_url='__PUBLIC_URL__'

install_dir="${INSTALL_DIR:-$default_install_dir}"
install_dir_overridden='0'
if [ -n "${INSTALL_DIR:-}" ]; then
  install_dir_overridden='1'
fi

helper_path="$install_dir/git-credential-hostproxy"
configure_path="$install_dir/configure-git.sh"

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

fail_with_install_dir_guidance() {
  reason="$1"

  if [ "$install_dir" = "$default_install_dir" ] && [ "$install_dir_overridden" = '0' ]; then
    fail "$reason Set INSTALL_DIR to a writable directory and re-run: curl -fsSL $base_url/container/install.sh | sh"
  fi

  fail "$reason"
}

if ! command -v sh >/dev/null 2>&1; then
  fail 'sh is required to run this installer'
fi

if ! command -v curl >/dev/null 2>&1; then
  fail 'curl is required to install git-credential-hostproxy'
fi

if [ ! -d "$install_dir" ]; then
  if ! mkdir -p "$install_dir"; then
    fail_with_install_dir_guidance "Unable to create install directory: $install_dir."
  fi
fi

if [ ! -w "$install_dir" ]; then
  fail_with_install_dir_guidance "Install directory is not writable: $install_dir."
fi

download_script() {
  source_url="$1"
  target_path="$2"

  if ! curl -fsSL "$source_url" -o "$target_path"; then
    fail "Failed to download $source_url"
  fi
}

download_script "$base_url/container/git-credential-hostproxy" "$helper_path"
download_script "$base_url/container/configure-git.sh" "$configure_path"

if ! chmod +x "$helper_path" "$configure_path"; then
  fail 'Failed to mark installed scripts as executable'
fi

printf 'Installed %s\n' "$helper_path"
printf 'Installed %s\n' "$configure_path"
printf '\nNext steps:\n'
printf '  1) Mount your host token directory to /run/host-git-cred-proxy (read-only).\n'
printf '  2) Set: export GIT_CRED_PROXY_TOKEN_FILE=%s\n' "$recommended_token_file_path"
printf '  3) Set: export GIT_CRED_PROXY_URL=%s\n' "$base_url"
printf '  4) Run: configure-git.sh --global\n'
printf '\nIf %s is not in PATH, run: export PATH=%s:$PATH\n' "$install_dir" "$install_dir"
