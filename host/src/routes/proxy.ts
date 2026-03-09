import { Elysia } from 'elysia';

import type { Config } from '../services/config';
import { MAX_BODY_SIZE, handleCredentialRequest } from '../services/git-credential';
import { appendAuditEvent } from '../services/request-log';
import type { TokenService } from '../services/token';

const CONTENT_TYPE_TEXT = 'text/plain; charset=utf-8';

const PROXY_ACTION_PATHS = ['/fill', '/approve', '/reject', '/get', '/store', '/erase'] as const;

export type ProxyRoutesDependencies = {
  tokenService: TokenService;
  config: Config;
  stateDir: string;
};

export function createProxyRoutes(dependencies: ProxyRoutesDependencies) {
  return new Elysia({ name: 'proxy-routes' })
    .get('/healthz', () => {
      return createTextResponse(200, 'ok');
    })
    .all('/fill', createProxyActionHandler('/fill', dependencies))
    .all('/approve', createProxyActionHandler('/approve', dependencies))
    .all('/reject', createProxyActionHandler('/reject', dependencies))
    .all('/get', createProxyActionHandler('/get', dependencies))
    .all('/store', createProxyActionHandler('/store', dependencies))
    .all('/erase', createProxyActionHandler('/erase', dependencies));
}

function createProxyActionHandler(actionPath: (typeof PROXY_ACTION_PATHS)[number], dependencies: ProxyRoutesDependencies) {
  return async ({ request }: { request: Request }): Promise<Response> => {
    try {
      return await handleProxyActionRequest(actionPath, request, dependencies);
    } catch (error) {
      return createTextResponse(500, `${error instanceof Error ? error.message : String(error)}\n`);
    }
  };
}

async function handleProxyActionRequest(
  actionPath: (typeof PROXY_ACTION_PATHS)[number],
  request: Request,
  dependencies: ProxyRoutesDependencies,
): Promise<Response> {
  if (request.method.toUpperCase() !== 'POST') {
    return createTextResponse(405, 'Method Not Allowed\n');
  }

  const authorization = request.headers.get('authorization') ?? '';
  if (!dependencies.tokenService.validateBearer(authorization)) {
    return createTextResponse(401, 'Unauthorized\n');
  }

  const body = await request.text();
  if (Buffer.byteLength(body, 'utf-8') > MAX_BODY_SIZE) {
    return createTextResponse(500, 'Request body too large\n');
  }

  const action = actionPath.slice(1);
  const startedAt = Date.now();
  const result = await handleCredentialRequest({
    action,
    body,
    config: dependencies.config,
  });

  await appendAuditEvent(
    dependencies.stateDir,
    {
      time: new Date().toISOString(),
      action,
      protocol: result.protocol,
      host: result.host,
      path: result.path,
      statusCode: result.status,
      outcome: result.outcome,
      durationMs: Math.max(0, Date.now() - startedAt),
    },
    dependencies.config.requestHistoryLimit,
  );

  return createTextResponse(result.status, result.body);
}

function createTextResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: {
      'content-type': CONTENT_TYPE_TEXT,
    },
  });
}
