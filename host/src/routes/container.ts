import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { Elysia } from 'elysia';

import type { Config } from '../services/config';
import { resolveShareDir } from '../services/ui-assets';

const CONTENT_TYPE_TEXT = 'text/plain; charset=utf-8';
const RECOMMENDED_TOKEN_FILE_PATH = '/run/host-git-cred-proxy/token';

export type ContainerRoutesDependencies = {
  config: Config;
};

export function createContainerRoutes(dependencies: ContainerRoutesDependencies) {
  return new Elysia({ name: 'container-routes' })
    .get('/container/install.sh', () => {
      return createTextResponse(200, renderInstallScript(dependencies.config.publicUrl));
    })
    .get('/container/configure-git.sh', async () => {
      return await readContainerAssetResponse('configure-git.sh');
    })
    .get('/container/git-credential-hostproxy', async () => {
      return await readContainerAssetResponse('git-credential-hostproxy');
    });
}

async function readContainerAssetResponse(filename: string): Promise<Response> {
  const filePath = resolveContainerAssetPath(filename);
  const content = await readFile(filePath, 'utf-8');

  return createTextResponse(200, content);
}

function renderInstallScript(publicUrl: string): string {
  const baseUrl = publicUrl.replace(/\/+$/, '');

  return [
    '#!/bin/sh',
    'set -eu',
    '',
    `base_url='${escapeForSingleQuotedShell(baseUrl)}'`,
    'install_dir="${GIT_CRED_PROXY_INSTALL_DIR:-/usr/local/bin}"',
    `token_file_path='${RECOMMENDED_TOKEN_FILE_PATH}'`,
    '',
    "if ! command -v curl >/dev/null 2>&1; then",
    "  printf 'curl is required to install git-credential-hostproxy\\n' >&2",
    '  exit 1',
    'fi',
    '',
    'mkdir -p "$install_dir"',
    'curl -fsSL "$base_url/container/git-credential-hostproxy" -o "$install_dir/git-credential-hostproxy"',
    'chmod +x "$install_dir/git-credential-hostproxy"',
    'curl -fsSL "$base_url/container/configure-git.sh" -o "$install_dir/configure-git.sh"',
    'chmod +x "$install_dir/configure-git.sh"',
    '',
    "printf 'Installed %s\\n' \"$install_dir/git-credential-hostproxy\"",
    "printf 'Installed %s\\n' \"$install_dir/configure-git.sh\"",
    "printf 'Set GIT_CRED_PROXY_URL=%s in your container if needed.\\n' \"$base_url\"",
    "printf 'Recommended token directory mount: %s\\n' '/run/host-git-cred-proxy'",
    "printf 'Then point GIT_CRED_PROXY_TOKEN_FILE to %s.\\n' \"$token_file_path\"",
    '',
  ].join('\n');
}

function resolveContainerAssetPath(filename: string): string {
  const candidatePaths = [
    resolveAssetPathFromShareDir(filename),
    path.resolve(import.meta.dir, '..', '..', '..', 'container', filename),
  ].filter((candidate): candidate is string => typeof candidate === 'string');

  for (const candidatePath of candidatePaths) {
    if (isFile(candidatePath)) {
      return candidatePath;
    }
  }

  throw new Error(`Container asset not found: ${filename}`);
}

function resolveAssetPathFromShareDir(filename: string): string | null {
  try {
    return path.resolve(resolveShareDir(), 'container', filename);
  } catch {
    return null;
  }
}

function isFile(targetPath: string): boolean {
  try {
    return statSync(targetPath).isFile();
  } catch {
    return false;
  }
}

function createTextResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: {
      'content-type': CONTENT_TYPE_TEXT,
    },
  });
}

function escapeForSingleQuotedShell(value: string): string {
  return value.replaceAll("'", "'\"'\"'");
}
