import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { Elysia } from 'elysia';

import { resolveUiDistDir } from '../services/ui-assets';
import { isLoopbackAddress } from '../utils/loopback';

const CONTENT_TYPE_HTML = 'text/html; charset=utf-8';
const CONTENT_TYPE_TEXT = 'text/plain; charset=utf-8';
const RESERVED_PREFIXES = ['/api', '/container', '/healthz', '/fill', '/approve', '/reject', '/get', '/store', '/erase'] as const;

export function createUiRoutes() {
  const uiDistDir = resolveUiDistDir();
  const assetsDir = path.resolve(uiDistDir, 'assets');
  const hooks = {
    beforeHandle: ensureLoopbackUiAccess,
  };

  return new Elysia({ name: 'ui-routes' })
    .get('/', async () => {
      return await readIndexHtmlResponse(uiDistDir);
    }, hooks)
    .get('/assets/*', async ({ params }) => {
      return await readAssetResponse(assetsDir, params['*']);
    }, hooks)
    .get('*', async ({ request }) => {
      const pathname = new URL(request.url).pathname;

      if (matchesReservedPrefix(pathname)) {
        return createNotFoundResponse();
      }

      return await readIndexHtmlResponse(uiDistDir);
    }, hooks);
}

async function readIndexHtmlResponse(uiDistDir: string): Promise<Response> {
  try {
    const indexPath = path.join(uiDistDir, 'index.html');
    const content = await readFile(indexPath, 'utf-8');

    return new Response(content, {
      status: 200,
      headers: {
        'content-type': CONTENT_TYPE_HTML,
      },
    });
  } catch {
    return createNotFoundResponse();
  }
}

async function readAssetResponse(assetsDir: string, rawAssetPath: string | undefined): Promise<Response> {
  const assetPath = normalizeAssetPath(rawAssetPath);
  if (!assetPath) {
    return createNotFoundResponse();
  }

  const resolvedAssetPath = path.resolve(assetsDir, assetPath);
  if (!isWithinDirectory(assetsDir, resolvedAssetPath)) {
    return createNotFoundResponse();
  }

  const file = Bun.file(resolvedAssetPath);
  if (!(await file.exists())) {
    return createNotFoundResponse();
  }

  return new Response(file, {
    status: 200,
    headers: file.type
      ? {
          'content-type': file.type,
        }
      : undefined,
  });
}

function ensureLoopbackUiAccess(context: any): Response | void {
  const clientIp = resolveRequestIp(context);
  if (clientIp && !isLoopbackAddress(clientIp)) {
    return createForbiddenResponse('Panel access requires loopback');
  }

  return undefined;
}

function matchesReservedPrefix(pathname: string): boolean {
  return RESERVED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function normalizeAssetPath(value: string | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().replace(/^\/+/, '');
  if (normalized.length === 0 || normalized.includes('\0')) {
    return null;
  }

  return normalized;
}

function isWithinDirectory(baseDir: string, candidatePath: string): boolean {
  const relativePath = path.relative(baseDir, candidatePath);

  return relativePath.length > 0 && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function resolveRequestIp(context: any): string | null {
  const directIp = pickStringIp(context.ip);
  if (directIp) {
    return directIp;
  }

  const server = context.server;
  const request = context.request;

  if (
    server &&
    typeof server === 'object' &&
    'requestIP' in server &&
    typeof server.requestIP === 'function' &&
    request instanceof Request
  ) {
    return pickStringIp(server.requestIP(request));
  }

  return null;
}

function pickStringIp(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  if ('address' in value && typeof value.address === 'string') {
    const trimmed = value.address.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if ('ip' in value && typeof value.ip === 'string') {
    const trimmed = value.ip.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if ('host' in value && typeof value.host === 'string') {
    const trimmed = value.host.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return null;
}

function createForbiddenResponse(error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status: 403,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

function createNotFoundResponse(): Response {
  return new Response('Not Found', {
    status: 404,
    headers: {
      'content-type': CONTENT_TYPE_TEXT,
    },
  });
}
