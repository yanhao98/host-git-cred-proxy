import { describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';

import type { Config } from '../../host/src/services/config';
import { createServer } from '../../host/src/server';
import { TokenService } from '../../host/src/services/token';

const HOST = '127.0.0.1';
const DEFAULT_PUBLIC_URL = 'http://host.docker.internal:18765';
const INDEX_HTML = '<!doctype html><html><body>Mock UI</body></html>';
const ASSET_CONTENT = 'console.log("mock-ui-asset");';

describe('ui routes', () => {
  test('GET / serves index.html', async () => {
    await withHostServer(async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(await response.text()).toBe(INDEX_HTML);
    });
  });

  test('GET /assets/* serves built UI assets', async () => {
    await withHostServer(async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/assets/app.js`);

      expect(response.status).toBe(200);
      const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
      expect(contentType.includes('javascript')).toBe(true);
      expect(await response.text()).toBe(ASSET_CONTENT);
    });
  });

  test('GET /unknown-path falls back to index.html (SPA)', async () => {
    await withHostServer(async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/some-random-page`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(await response.text()).toBe(INDEX_HTML);
    });
  });

  test('reserved-prefix unknown GET paths never fall back to index.html', async () => {
    await withHostServer(async ({ baseUrl }) => {
      const reservedUnknownPaths = [
        '/api/not-a-real-endpoint',
        '/container/not-a-real-endpoint',
        '/healthz/not-a-real-endpoint',
        '/fill/not-a-real-endpoint',
        '/approve/not-a-real-endpoint',
        '/reject/not-a-real-endpoint',
        '/get/not-a-real-endpoint',
        '/store/not-a-real-endpoint',
        '/erase/not-a-real-endpoint',
      ];

      for (const reservedPath of reservedUnknownPaths) {
        const response = await fetch(`${baseUrl}${reservedPath}`);

        expect(response.status).toBe(404);
        await expectNotSpaFallback(response);
      }
    });
  });

  test('proxy/container/admin routes keep existing behavior', async () => {
    await withHostServer(async ({ baseUrl }) => {
      const healthzResponse = await fetch(`${baseUrl}/healthz`);
      expect(healthzResponse.status).toBe(200);
      expect(await healthzResponse.text()).toBe('ok');

      const fillResponse = await fetch(`${baseUrl}/fill`);
      expect(fillResponse.status).toBe(405);
      expect(await fillResponse.text()).toBe('Method Not Allowed\n');

      const adminStatusResponse = await fetch(`${baseUrl}/api/admin/status`);
      const adminContentType = (adminStatusResponse.headers.get('content-type') ?? '').toLowerCase();

      expect(adminStatusResponse.status).toBe(200);
      expect(adminContentType.includes('application/json')).toBe(true);
    });
  });
});

type HostServerHarness = {
  baseUrl: string;
};

async function withHostServer(run: (harness: HostServerHarness) => Promise<void>): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), 'ui-routes-'));
  const stateDir = join(tempRoot, 'state');
  const uiDistDir = join(tempRoot, 'host', 'ui', 'dist');
  const uiAssetsDir = join(uiDistDir, 'assets');

  await mkdir(stateDir, { recursive: true });
  await mkdir(join(tempRoot, 'container'), { recursive: true });
  await mkdir(uiAssetsDir, { recursive: true });
  await writeFile(join(uiDistDir, 'index.html'), INDEX_HTML, 'utf-8');
  await writeFile(join(uiAssetsDir, 'app.js'), ASSET_CONTENT, 'utf-8');

  const tokenPath = path.resolve(stateDir, 'token');
  await writeFile(tokenPath, `token\n`, 'utf-8');
  await chmod(tokenPath, 0o600);

  const config: Config = {
    host: HOST,
    port: 18765,
    publicUrl: DEFAULT_PUBLIC_URL,
    protocols: ['https'],
    allowedHosts: [],
    requestHistoryLimit: 200,
    openBrowserOnStart: false,
  };

  try {
    await withEnv({
      GIT_CRED_PROXY_SHARE_DIR: tempRoot,
    }, async () => {
      const startedApp = createServer({
        stateDir,
        config,
        tokenService: new TokenService(stateDir),
      });

      startedApp.listen({ hostname: HOST, port: 0 });

      try {
        const port = startedApp.server?.port;
        if (!port) {
          throw new Error('Failed to start test server');
        }

        const baseUrl = `http://${HOST}:${port}`;
        await waitForServerReady(`${baseUrl}/healthz`);
        await run({ baseUrl });
      } finally {
        await startedApp.stop(true);
      }
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function waitForServerReady(healthzUrl: string): Promise<void> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthzUrl);
      if (response.status === 200) {
        return;
      }
    } catch {
    }

    await sleep(25);
  }

  throw new Error(`Timed out waiting for server readiness at ${healthzUrl}`);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withEnv(updates: Record<string, string | undefined>, run: () => Promise<void>): Promise<void> {
  const previousValues = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(updates)) {
    previousValues.set(key, process.env[key]);

    if (typeof value === 'undefined') {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    await run();
  } finally {
    for (const [key, previousValue] of previousValues.entries()) {
      if (typeof previousValue === 'undefined') {
        delete process.env[key];
      } else {
        process.env[key] = previousValue;
      }
    }
  }
}

async function expectNotSpaFallback(response: Response): Promise<void> {
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  const text = (await response.text()).toLowerCase();

  expect(contentType.includes('text/html')).toBe(false);
  expect(text.includes('<!doctype html') || text.includes('<html')).toBe(false);
}
