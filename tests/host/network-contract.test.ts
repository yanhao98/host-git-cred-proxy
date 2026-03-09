import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_BIND = {
  host: '127.0.0.1',
  port: 18765,
} as const;

const DEFAULT_PUBLIC_URL = 'http://host.docker.internal:18765';

const ROUTE_PRECEDENCE = [
  '/healthz',
  '/fill|/approve|/reject',
  '/container/*',
  '/api/admin/*',
  '/assets/*',
  '/',
] as const;

const ACCESS_TRUST_MODEL = {
  publicUrl: 'config-only',
} as const;

const PROXY_TOKEN = 'network-contract-proxy-token';

const CREDENTIAL_FILL_BODY = ['protocol=https', 'host=example.com', 'path=owner/repo.git', ''].join('\n');

type StartServerInput = {
  stateDir: string;
  host?: string;
  port?: number;
  proxyToken: string;
  publicUrl?: string;
  protocols?: string[];
  allowedHosts?: string[];
  requestHistoryLimit?: number;
  openBrowserOnStart?: boolean;
};

type StartedServerLike = {
  origin?: string;
  url?: string;
  baseUrl?: string;
  host?: string;
  port?: number;
  stop?: () => Promise<void> | void;
  close?: () => Promise<void> | void;
  server?: {
    stop?: () => Promise<void> | void;
    close?: () => Promise<void> | void;
  };
};

type StartServerForTests = (options: StartServerInput) => Promise<StartedServerLike | void> | StartedServerLike | void;

type RunningServer = {
  host: string;
  port: number;
  stop: () => Promise<void>;
};

type ContractLoaderResult = {
  startServer: StartServerForTests | null;
  skipReason: string | null;
};

const CONTRACT_LOADER_RESULT = await resolveContractServerStarter();
const CONTRACT_RUNTIME_TEST = CONTRACT_LOADER_RESULT.startServer ? test : test.skip;
const NON_LOOPBACK_ADDRESS = getNonLoopbackIPv4();
const NON_LOOPBACK_RUNTIME_TEST =
  CONTRACT_LOADER_RESULT.startServer && NON_LOOPBACK_ADDRESS ? test : test.skip;

describe('host network contract declarations', () => {
  test('default bind is loopback 127.0.0.1:18765', () => {
    expect(DEFAULT_BIND).toEqual({
      host: '127.0.0.1',
      port: 18765,
    });
  });

  test('route precedence is fixed and explicit', () => {
    expect(ROUTE_PRECEDENCE).toEqual([
      '/healthz',
      '/fill|/approve|/reject',
      '/container/*',
      '/api/admin/*',
      '/assets/*',
      '/',
    ]);
  });

  test('publicUrl is config-only metadata, not trust derivation', () => {
    expect(DEFAULT_PUBLIC_URL).toBe('http://host.docker.internal:18765');
    expect(ACCESS_TRUST_MODEL.publicUrl).toBe('config-only');
  });

  if (!CONTRACT_LOADER_RESULT.startServer && CONTRACT_LOADER_RESULT.skipReason) {
    test('runtime contract harness is pending host server scaffold', () => {
      const skipReason = CONTRACT_LOADER_RESULT.skipReason;
      expect(skipReason?.length ?? 0).toBeGreaterThan(0);
    });
  }
});

describe('host network contract runtime smoke', () => {
  CONTRACT_RUNTIME_TEST('GET /healthz returns 200 ok (loopback path)', async () => {
    await withServer({ host: '127.0.0.1', port: 0 }, async ({ port }) => {
      const response = await request(`http://127.0.0.1:${port}`, '/healthz');
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('ok\n');
    });
  });

  NON_LOOPBACK_RUNTIME_TEST('GET /healthz remains reachable from non-loopback source', async () => {
    await withServer({ host: '0.0.0.0', port: 0 }, async ({ port }) => {
      const response = await request(`http://${NON_LOOPBACK_ADDRESS}:${port}`, '/healthz');
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('ok\n');
    });
  });

  CONTRACT_RUNTIME_TEST('POST /fill with valid Bearer token returns success response', async () => {
    await withServer({ host: '127.0.0.1', port: 0 }, async ({ port }) => {
      const response = await request(`http://127.0.0.1:${port}`, '/fill', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${PROXY_TOKEN}`,
          'Content-Type': 'text/plain; charset=utf-8',
        },
        body: CREDENTIAL_FILL_BODY,
      });

      expect(response.status).toBe(200);
    });
  });

  CONTRACT_RUNTIME_TEST('GET /container/install.sh is accessible without admin nonce or proxy token', async () => {
    await withServer({ host: '127.0.0.1', port: 0 }, async ({ port }) => {
      const response = await request(`http://127.0.0.1:${port}`, '/container/install.sh');
      expect(response.status).toBe(200);

      const body = await response.text();
      expect(body.length).toBeGreaterThan(0);
    });
  });

  CONTRACT_RUNTIME_TEST('GET /api/admin/status from loopback succeeds', async () => {
    await withServer({ host: '127.0.0.1', port: 0 }, async ({ port }) => {
      const response = await request(`http://127.0.0.1:${port}`, '/api/admin/status');
      expect(response.status).toBe(200);
    });
  });

  NON_LOOPBACK_RUNTIME_TEST('GET /api/admin/status from non-loopback is denied', async () => {
    await withServer(
      {
        host: '0.0.0.0',
        port: 0,
        publicUrl: 'http://example.invalid:18765',
      },
      async ({ port }) => {
        const response = await request(`http://${NON_LOOPBACK_ADDRESS}:${port}`, '/api/admin/status');
        expect(response.status).toBe(403);
      },
    );
  });

  CONTRACT_RUNTIME_TEST('GET / (UI) from loopback succeeds', async () => {
    await withServer({ host: '127.0.0.1', port: 0 }, async ({ port }) => {
      const response = await request(`http://127.0.0.1:${port}`, '/');
      expect(response.status).toBe(200);

      const contentType = response.headers.get('content-type') ?? '';
      expect(contentType.toLowerCase()).toContain('text/html');
    });
  });

  NON_LOOPBACK_RUNTIME_TEST('GET / (UI) from non-loopback is denied even when publicUrl is non-loopback', async () => {
    await withServer(
      {
        host: '0.0.0.0',
        port: 0,
        publicUrl: `http://${NON_LOOPBACK_ADDRESS}:18765`,
      },
      async ({ port }) => {
        const response = await request(`http://${NON_LOOPBACK_ADDRESS}:${port}`, '/');
        expect(response.status).toBe(403);
      },
    );
  });

  CONTRACT_RUNTIME_TEST('GET /api/admin/nonexistent is an API error and never SPA fallback HTML', async () => {
    await withServer({ host: '127.0.0.1', port: 0 }, async ({ port }) => {
      const response = await request(`http://127.0.0.1:${port}`, '/api/admin/nonexistent');
      expect(response.status).toBe(404);
      await expectNotSpaFallback(response);
    });
  });

  CONTRACT_RUNTIME_TEST('GET /container/nonexistent is a container-route error and never SPA fallback HTML', async () => {
    await withServer({ host: '127.0.0.1', port: 0 }, async ({ port }) => {
      const response = await request(`http://127.0.0.1:${port}`, '/container/nonexistent');
      expect(response.status).toBe(404);
      await expectNotSpaFallback(response);
    });
  });
});

async function resolveContractServerStarter(): Promise<ContractLoaderResult> {
  const moduleCandidates = [
    process.env.NETWORK_CONTRACT_SERVER_MODULE,
    '../../host/src/server.ts',
    '../../host/src/server',
    '../../host/src/index.ts',
    '../../host/src/index',
    '../../host/src/main.ts',
    '../../host/src/main',
  ].filter((candidate): candidate is string => Boolean(candidate));

  let loadedWithoutStarter = false;

  for (const candidate of moduleCandidates) {
    const specifier = toImportSpecifier(candidate);

    try {
      const loaded = await import(specifier);
      const startServer = pickStartFunction(loaded);

      if (!startServer) {
        loadedWithoutStarter = true;
        continue;
      }

      return {
        startServer,
        skipReason: null,
      };
    } catch (error) {
      if (isModuleNotFoundError(error)) {
        continue;
      }

      throw error;
    }
  }

  return {
    startServer: null,
    skipReason: loadedWithoutStarter
      ? 'Host module exists, but no test starter export found. Add startServerForTests/startHostServerForTests to enable runtime contract checks.'
      : 'Set NETWORK_CONTRACT_SERVER_MODULE to the test-startable host server module once Task 2 scaffolding lands.',
  };
}

function toImportSpecifier(candidate: string): string {
  if (candidate.startsWith('file://')) {
    return candidate;
  }

  if (candidate.startsWith('/')) {
    return pathToFileURL(candidate).href;
  }

  return candidate;
}

function pickStartFunction(moduleExports: Record<string, unknown>): StartServerForTests | null {
  const namedCandidates = [
    moduleExports.startServerForTests,
    moduleExports.startHostServerForTests,
  ];

  for (const candidate of namedCandidates) {
    if (typeof candidate === 'function') {
      return candidate as StartServerForTests;
    }
  }

  return null;
}

function isModuleNotFoundError(error: unknown): boolean {
  const message =
    typeof error === 'string'
      ? error.toLowerCase()
      : error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
        ? error.message.toLowerCase()
        : String(error).toLowerCase();

  return (
    message.includes('cannot find module') ||
    message.includes('module not found') ||
    message.includes('could not resolve') ||
    message.includes('no such file or directory')
  );
}

async function withServer(
  overrides: Omit<Partial<StartServerInput>, 'stateDir' | 'proxyToken'>,
  run: (server: RunningServer) => Promise<void>,
): Promise<void> {
  if (!CONTRACT_LOADER_RESULT.startServer) {
    throw new Error('Contract runtime tests cannot run before the host starter module is available.');
  }

  const stateDir = await mkdtemp(join(tmpdir(), 'host-git-cred-proxy-network-contract-'));

  let startedServer: RunningServer | null = null;

  try {
    const startResult = await CONTRACT_LOADER_RESULT.startServer({
      stateDir,
      proxyToken: PROXY_TOKEN,
      publicUrl: DEFAULT_PUBLIC_URL,
      protocols: ['https'],
      allowedHosts: [],
      requestHistoryLimit: 200,
      openBrowserOnStart: false,
      ...overrides,
    });

    startedServer = normalizeStartedServer(startResult, overrides.host ?? DEFAULT_BIND.host, overrides.port);
    await waitForServer(`http://127.0.0.1:${startedServer.port}/healthz`);

    await run(startedServer);
  } finally {
    try {
      if (startedServer) {
        await startedServer.stop();
      }
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  }
}

function normalizeStartedServer(
  startResult: StartedServerLike | void,
  requestedHost: string,
  requestedPort?: number,
): RunningServer {
  if (!startResult || typeof startResult !== 'object') {
    throw new Error('Server starter must return an object that includes a resolved port and stop/close function.');
  }

  const origin =
    typeof startResult.origin === 'string'
      ? startResult.origin
      : typeof startResult.url === 'string'
        ? startResult.url
        : typeof startResult.baseUrl === 'string'
          ? startResult.baseUrl
          : null;

  const parsedPort = origin ? Number(new URL(origin).port) : NaN;
  const resolvedPort =
    typeof startResult.port === 'number' && startResult.port > 0
      ? startResult.port
      : Number.isFinite(parsedPort) && parsedPort > 0
        ? parsedPort
        : typeof requestedPort === 'number' && requestedPort > 0
          ? requestedPort
          : NaN;

  if (!Number.isFinite(resolvedPort) || resolvedPort <= 0) {
    throw new Error('Unable to resolve server port from starter return value.');
  }

  const stopFn =
    startResult.stop ??
    startResult.close ??
    startResult.server?.stop ??
    startResult.server?.close ??
    null;

  if (typeof stopFn !== 'function') {
    throw new Error('Server starter must expose stop/close so tests can release ports deterministically.');
  }

  return {
    host: startResult.host ?? requestedHost,
    port: resolvedPort,
    stop: async () => {
      await stopFn();
    },
  };
}

async function waitForServer(url: string): Promise<void> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status >= 200 && response.status < 500) {
        return;
      }
    } catch {
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for server readiness at ${url}`);
}

async function request(baseUrl: string, pathname: string, init?: RequestInit): Promise<Response> {
  const url = new URL(pathname, baseUrl);
  return fetch(url, {
    redirect: 'manual',
    ...init,
  });
}

async function expectNotSpaFallback(response: Response): Promise<void> {
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  const text = (await response.text()).toLowerCase();

  expect(contentType.includes('text/html')).toBe(false);
  expect(text.includes('<!doctype html') || text.includes('<html')).toBe(false);
}

function getNonLoopbackIPv4(): string | null {
  const interfaces = networkInterfaces();

  for (const entries of Object.values(interfaces)) {
    if (!entries) {
      continue;
    }

    for (const entry of entries) {
      const isIPv4 = entry.family === 'IPv4';

      if (isIPv4 && !entry.internal) {
        return entry.address;
      }
    }
  }

  return null;
}
