import { describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';

import { createServer } from '../../host/src/server';
import type { Config } from '../../host/src/services/config';
import { loadConfig, saveConfig } from '../../host/src/services/config';
import { AdminNonceService } from '../../host/src/services/admin-nonce';
import { appendAuditEvent, type AuditEvent } from '../../host/src/services/request-log';
import { TokenService } from '../../host/src/services/token';

const HOST = '127.0.0.1';
const DEFAULT_CONFIG: Config = {
  host: HOST,
  port: 18765,
  publicUrl: 'http://host.docker.internal:18765',
  protocols: ['https'],
  allowedHosts: [],
  requestHistoryLimit: 200,
  openBrowserOnStart: false,
};

type RuntimeInfo = {
  pid: number;
  startedAt: string;
  listenUrl: string;
  panelUrl: string;
  version: string;
  stateDir: string;
};

type AdminServerHarness = {
  baseUrl: string;
  stateDir: string;
  config: Config;
  adminNonce: string;
  panelOrigin: string;
  request: (pathname: string, init?: RequestInit) => Promise<Response>;
  postAdmin: (pathname: string, body?: unknown) => Promise<Response>;
};

describe('admin API routes', () => {
  test('GET /api/admin/bootstrap returns contract shape and derived fields', async () => {
    await withAdminServer(async ({ request, stateDir, config, adminNonce }) => {
      const runtime: RuntimeInfo = {
        pid: 4242,
        startedAt: '2024-01-01T00:00:00Z',
        listenUrl: `http://${config.host}:${config.port}`,
        panelUrl: `http://${config.host}:${config.port}`,
        version: process.env.npm_package_version?.trim() || '0.1.0',
        stateDir,
      };

      await writeFile(path.resolve(stateDir, 'runtime.json'), `${JSON.stringify(runtime, null, 2)}\n`, 'utf-8');

      const response = await request('/api/admin/bootstrap');
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toEqual({
        adminNonce,
        version: process.env.npm_package_version?.trim() || '0.1.0',
        config,
        runtime,
        derived: {
          panelUrl: `http://${config.host}:${config.port}`,
          listenUrl: `http://${config.host}:${config.port}`,
          publicUrl: config.publicUrl,
          stateDir,
          tokenFilePath: path.resolve(stateDir, 'token'),
          installCommand: `curl -fsSL ${config.publicUrl}/container/install.sh | sh`,
        },
      });
    });
  });

  test('GET /api/admin/status returns running metadata from runtime.json', async () => {
    await withAdminServer(async ({ request, stateDir, config }) => {
      const runtime: RuntimeInfo = {
        pid: 99999,
        startedAt: '2024-01-01T00:00:00Z',
        listenUrl: `http://${config.host}:${config.port}`,
        panelUrl: `http://${config.host}:${config.port}`,
        version: '0.1.0',
        stateDir,
      };

      await writeFile(path.resolve(stateDir, 'runtime.json'), `${JSON.stringify(runtime, null, 2)}\n`, 'utf-8');

      const response = await request('/api/admin/status');
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toEqual({
        running: true,
        pid: runtime.pid,
        startedAt: runtime.startedAt,
        listenUrl: runtime.listenUrl,
        publicUrl: config.publicUrl,
        stateDir,
        tokenFilePath: path.resolve(stateDir, 'token'),
        requestHistoryLimit: config.requestHistoryLimit,
      });
    });
  });

  test('GET /api/admin/status falls back to current process metadata when runtime.json is missing', async () => {
    await withAdminServer(async ({ request, config, stateDir }) => {
      const response = await request('/api/admin/status');
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.running).toBe(true);
      expect(payload.pid).toBe(process.pid);
      expect(typeof payload.startedAt).toBe('string');
      expect(Number.isNaN(Date.parse(payload.startedAt))).toBe(false);
      expect(payload.listenUrl).toBe(`http://${config.host}:${config.port}`);
      expect(payload.publicUrl).toBe(config.publicUrl);
      expect(payload.stateDir).toBe(stateDir);
      expect(payload.tokenFilePath).toBe(path.resolve(stateDir, 'token'));
      expect(payload.requestHistoryLimit).toBe(config.requestHistoryLimit);
    });
  });

  test('GET /api/admin/config returns persisted config object', async () => {
    await withAdminServer(async ({ request, config }) => {
      const response = await request('/api/admin/config');

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(config);
    });
  });

  test('POST /api/admin/config validates, saves config, and returns restartRequired contract', async () => {
    await withAdminServer(async ({ postAdmin, request, stateDir }) => {
      const nextConfig: Config = {
        host: HOST,
        port: 28765,
        publicUrl: 'http://host.docker.internal:28765',
        protocols: ['https', 'http'],
        allowedHosts: ['github.com', 'gitlab.com'],
        requestHistoryLimit: 500,
        openBrowserOnStart: false,
      };

      const saveResponse = await postAdmin('/api/admin/config', nextConfig);

      expect(saveResponse.status).toBe(200);
      expect(await saveResponse.json()).toEqual({
        ok: true,
        restartRequired: true,
        nextPanelUrl: `http://${HOST}:${nextConfig.port}`,
      });

      expect(loadConfig(stateDir)).toEqual(nextConfig);

      const getResponse = await request('/api/admin/config');
      expect(getResponse.status).toBe(200);
      expect(await getResponse.json()).toEqual(nextConfig);
    });
  });

  test('POST /api/admin/restart returns response first and schedules async restart handoff', async () => {
    await withAdminServer(async ({ postAdmin, config }) => {
      const originalSetTimeout = globalThis.setTimeout;
      const scheduledDelays: number[] = [];

      globalThis.setTimeout = ((handler: (...args: any[]) => unknown, timeout?: number) => {
        void handler;
        scheduledDelays.push(typeof timeout === 'number' ? timeout : 0);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout;

      try {
        const response = await postAdmin('/api/admin/restart');

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          ok: true,
          restarting: true,
          nextPanelUrl: `http://${config.host}:${config.port}`,
        });
        expect(scheduledDelays.includes(150)).toBe(true);
      } finally {
        globalThis.setTimeout = originalSetTimeout;
      }
    });
  });

  test('POST /api/admin/token/rotate returns tokenFilePath only and rotates token', async () => {
    await withAdminServer(async ({ postAdmin, stateDir }) => {
      const tokenFilePath = path.resolve(stateDir, 'token');
      const tokenBefore = (await readFile(tokenFilePath, 'utf-8')).trim();

      const response = await postAdmin('/api/admin/token/rotate');
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toEqual({
        ok: true,
        tokenFilePath,
      });
      expect('token' in payload).toBe(false);
      expect('value' in payload).toBe(false);

      const tokenAfter = (await readFile(tokenFilePath, 'utf-8')).trim();
      expect(tokenAfter).not.toBe(tokenBefore);
      expect(tokenAfter).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  test('admin POST origin trust uses local panel origin and rejects config.publicUrl origin', async () => {
    await withAdminServer(async ({ request, panelOrigin, config, adminNonce }) => {
      const localOriginResponse = await request('/api/admin/token/rotate', {
        method: 'POST',
        headers: {
          Origin: panelOrigin,
          'X-Admin-Nonce': adminNonce,
        },
      });

      expect(localOriginResponse.status).toBe(200);

      const publicOriginResponse = await request('/api/admin/token/rotate', {
        method: 'POST',
        headers: {
          Origin: new URL(config.publicUrl).origin,
          'X-Admin-Nonce': adminNonce,
        },
      });

      expect(publicOriginResponse.status).toBe(403);
      expect(await publicOriginResponse.json()).toEqual({
        error: 'Admin access requires trusted Origin',
      });
    });
  });

  test('GET /api/admin/requests returns redacted audit events', async () => {
    await withAdminServer(async ({ request, stateDir }) => {
      const event: AuditEvent = {
        time: '2024-01-01T00:00:00Z',
        action: 'fill',
        protocol: 'https',
        host: 'github.com',
        path: 'owner/repo.git',
        statusCode: 200,
        outcome: 'ok',
        durationMs: 12,
      };

      await appendAuditEvent(stateDir, event, 200);

      const response = await request('/api/admin/requests');

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([event]);
    });
  });

  test('GET /api/admin/logs returns newest 200 lines and truncated=true when over limit', async () => {
    await withAdminServer(async ({ request, stateDir }) => {
      const lines = Array.from({ length: 250 }, (_, index) => `line-${index + 1}`);
      await writeFile(path.resolve(stateDir, 'server.log'), `${lines.join('\n')}\n`, 'utf-8');

      const response = await request('/api/admin/logs');
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.lines.length).toBe(200);
      expect(payload.lines[0]).toBe('line-51');
      expect(payload.lines[payload.lines.length - 1]).toBe('line-250');
      expect(payload.truncated).toBe(true);
    });
  });

  test('GET /api/admin/logs handles missing server.log as empty lines + truncated=false', async () => {
    await withAdminServer(async ({ request, stateDir }) => {
      await rm(path.resolve(stateDir, 'server.log'), { force: true });

      const response = await request('/api/admin/logs');

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        lines: [],
        truncated: false,
      });
    });
  });

  test('GET /api/admin/requests handles missing requests.ndjson as an empty array', async () => {
    await withAdminServer(async ({ request, stateDir }) => {
      await rm(path.resolve(stateDir, 'requests.ndjson'), { force: true });

      const response = await request('/api/admin/requests');

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([]);
    });
  });
});

async function withAdminServer(run: (harness: AdminServerHarness) => Promise<void>): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), 'admin-api-'));
  const stateDir = path.resolve(tempRoot, 'state');
  const port = await reserveLoopbackPort();
  const config: Config = {
    ...DEFAULT_CONFIG,
    port,
    publicUrl: `http://host.docker.internal:${port}`,
  };

  await mkdir(stateDir, { recursive: true });
  saveConfig(stateDir, config);

  const tokenService = new TokenService(stateDir);
  const adminNonceService = new AdminNonceService();
  const panelOrigin = `http://${config.host}:${config.port}`;

  const app = createServer({
    stateDir,
    config,
    tokenService,
    adminNonceService,
  });

  app.listen({
    hostname: HOST,
    port,
  });

  try {
    const port = app.server?.port;
    if (!port) {
      throw new Error('Failed to bind test server port');
    }

    const baseUrl = `http://${HOST}:${port}`;
    await waitForServerReady(`${baseUrl}/healthz`);

    await run({
      baseUrl,
      stateDir,
      config,
      adminNonce: adminNonceService.getNonce(),
      panelOrigin,
      request(pathname, init = {}) {
        return fetch(`${baseUrl}${pathname}`, {
          redirect: 'manual',
          ...init,
        });
      },
      postAdmin(pathname, body) {
        const headers: Record<string, string> = {
          Origin: panelOrigin,
          'X-Admin-Nonce': adminNonceService.getNonce(),
        };

        let serializedBody: string | undefined;

        if (typeof body !== 'undefined') {
          headers['Content-Type'] = 'application/json';
          serializedBody = JSON.stringify(body);
        }

        return fetch(`${baseUrl}${pathname}`, {
          method: 'POST',
          headers,
          body: serializedBody,
          redirect: 'manual',
        });
      },
    });
  } finally {
    await app.stop(true);
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

async function reserveLoopbackPort(): Promise<number> {
  const server = createNetServer();

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, () => resolve());
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('Failed to reserve loopback port');
  }

  return port;
}
