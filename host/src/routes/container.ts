import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { Elysia } from 'elysia';

import type { Config } from '../services/config';
import { resolveShareDir } from '../services/ui-assets';

const CONTENT_TYPE_TEXT = 'text/plain; charset=utf-8';
const INSTALL_SCRIPT_BASE_URL_PLACEHOLDER = '__PUBLIC_URL__';

export type ContainerRoutesDependencies = {
  config: Config;
};

export function createContainerRoutes(dependencies: ContainerRoutesDependencies) {
  return new Elysia({ name: 'container-routes' })
    .get('/container/install.sh', async () => {
      const template = await readContainerAsset('install.sh');
      return createTextResponse(200, renderInstallScript(template, dependencies.config.publicUrl));
    })
    .get('/container/configure-git.sh', async () => {
      return await readContainerAssetResponse('configure-git.sh');
    })
    .get('/container/git-credential-hostproxy', async () => {
      return await readContainerAssetResponse('git-credential-hostproxy');
    });
}

async function readContainerAssetResponse(filename: string): Promise<Response> {
  const content = await readContainerAsset(filename);

  return createTextResponse(200, content);
}

async function readContainerAsset(filename: string): Promise<string> {
  const filePath = resolveContainerAssetPath(filename);
  return await readFile(filePath, 'utf-8');
}

function renderInstallScript(template: string, publicUrl: string): string {
  const baseUrl = publicUrl.replace(/\/+$/, '');
  return template.replaceAll(INSTALL_SCRIPT_BASE_URL_PLACEHOLDER, escapeForSingleQuotedShell(baseUrl));
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
