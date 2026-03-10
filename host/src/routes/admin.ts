import { closeSync, openSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { Elysia } from 'elysia';

import type { AdminNonceService } from '../services/admin-nonce';
import type { Config } from '../services/config';
import { resolveCliEntrypoint, resolveServeSpawnArgs } from '../services/self-exec';
import { loadConfig, saveConfig } from '../services/config';
import { readAuditEvents } from '../services/request-log';
import type { TokenService } from '../services/token';

const DEFAULT_VERSION = process.env.npm_package_version?.trim() || '0.1.0';
const RUNTIME_FILE_NAME = 'runtime.json';
const TOKEN_FILE_NAME = 'token';
const SERVER_LOG_FILE_NAME = 'server.log';
const SERVER_LOG_LINE_LIMIT = 200;
const RESTART_RESPONSE_FLUSH_DELAY_MS = 150;

type RuntimeInfo = {
  pid: number;
  startedAt: string;
  listenUrl: string;
  panelUrl: string;
  version: string;
  stateDir: string;
};

type RestartResponse = {
  ok: true;
  restarting: true;
  nextPanelUrl: string;
};

type RouteBeforeHandle = (context: any) => Response | void;

export type AdminRoutesDependencies = {
  stateDir: string;
  config: Config;
  tokenService: TokenService;
  adminNonceService: AdminNonceService;
  getServerInstance?: () => any;
};

export type AdminRoutesOptions = {
  beforeHandle?: RouteBeforeHandle;
};

export function createAdminRoutes(dependencies: AdminRoutesDependencies, options: AdminRoutesOptions = {}) {
  const hooks = {
    beforeHandle: options.beforeHandle,
  };

  return new Elysia({ name: 'admin-routes' })
    .get('/api/admin/bootstrap', async () => {
      const config = loadCurrentConfig(dependencies);
      const runtime = await readRuntimeInfo(dependencies.stateDir);
      const listenUrl = toListenUrl(config);

      return {
        adminNonce: dependencies.adminNonceService.getNonce(),
        version: DEFAULT_VERSION,
        config,
        runtime,
        derived: {
          panelUrl: listenUrl,
          listenUrl,
          publicUrl: config.publicUrl,
          stateDir: dependencies.stateDir,
          tokenFilePath: resolveTokenFilePath(dependencies.stateDir),
          installCommand: `curl -fsSL ${normalizeBaseUrl(config.publicUrl)}/container/install.sh | sh`,
        },
      };
    }, hooks)
    .get('/api/admin/status', async () => {
      const config = loadCurrentConfig(dependencies);
      const runtime = await readRuntimeInfo(dependencies.stateDir);

      return {
        running: true,
        pid: runtime?.pid ?? process.pid,
        startedAt: runtime?.startedAt ?? new Date().toISOString(),
        listenUrl: runtime?.listenUrl ?? toListenUrl(config),
        publicUrl: config.publicUrl,
        stateDir: dependencies.stateDir,
        tokenFilePath: resolveTokenFilePath(dependencies.stateDir),
        requestHistoryLimit: config.requestHistoryLimit,
      };
    }, hooks)
    .get('/api/admin/config', () => {
      return loadCurrentConfig(dependencies);
    }, hooks)
    .post(
      '/api/admin/config',
      async ({ body }) => {
        const nextConfig = parseConfigPayload(body);
        if (!nextConfig) {
          return createBadRequestResponse('Invalid config payload');
        }

        saveConfig(dependencies.stateDir, nextConfig);

        return {
          ok: true,
          restartRequired: true,
          nextPanelUrl: toListenUrl(nextConfig),
        };
      },
      hooks,
    )
    .post('/api/admin/restart', async () => {
      const config = loadCurrentConfig(dependencies);
      const response: RestartResponse = {
        ok: true,
        restarting: true,
        nextPanelUrl: toListenUrl(config),
      };

      setTimeout(() => {
        void restartCurrentProcess(dependencies);
      }, RESTART_RESPONSE_FLUSH_DELAY_MS);

      return response;
    }, hooks)
    .post('/api/admin/token/rotate', async () => {
      const result = await dependencies.tokenService.rotate();

      return {
        ok: true,
        tokenFilePath: result.tokenFilePath,
      };
    }, hooks)
    .get('/api/admin/requests', async () => {
      return await readAuditEvents(dependencies.stateDir);
    }, hooks)
    .get('/api/admin/logs', async () => {
      return await readServerLogs(dependencies.stateDir, SERVER_LOG_LINE_LIMIT);
    }, hooks);
}

async function restartCurrentProcess(dependencies: AdminRoutesDependencies): Promise<void> {
  const entrypoint = resolveCliEntrypoint();
  if (!entrypoint) {
    process.exit(1);
  }

  const logFilePath = path.resolve(dependencies.stateDir, SERVER_LOG_FILE_NAME);
  const logFd = openSync(logFilePath, 'a');

  try {
    const subprocess = Bun.spawn(resolveServeSpawnArgs(entrypoint), {
      detached: true,
      stdin: 'ignore',
      stdout: logFd,
      stderr: logFd,
      env: {
        ...process.env,
        GIT_CRED_PROXY_STATE_DIR: dependencies.stateDir,
      },
    });

    subprocess.unref();
  } finally {
    closeSync(logFd);
  }

  stopCurrentServerIfPossible(dependencies.getServerInstance?.());
  process.exit(0);
}

function stopCurrentServerIfPossible(serverInstance: any): void {
  try {
    if (serverInstance && typeof serverInstance.stop === 'function') {
      void serverInstance.stop(true);
      return;
    }

    if (serverInstance?.server && typeof serverInstance.server.stop === 'function') {
      void serverInstance.server.stop(true);
    }
  } catch {
  }
}

function loadCurrentConfig(dependencies: AdminRoutesDependencies): Config {
  try {
    return loadConfig(dependencies.stateDir);
  } catch {
    return dependencies.config;
  }
}

function parseConfigPayload(payload: unknown): Config | null {
  if (!isObjectRecord(payload)) {
    return null;
  }

  const candidate = payload as Partial<Record<keyof Config, unknown>>;

  if (!isNonEmptyString(candidate.host)) {
    return null;
  }

  if (!Number.isInteger(candidate.port) || Number(candidate.port) < 1 || Number(candidate.port) > 65_535) {
    return null;
  }

  if (!isHttpUrl(candidate.publicUrl)) {
    return null;
  }

  if (!isStringArray(candidate.protocols) || !isStringArray(candidate.allowedHosts)) {
    return null;
  }

  if (!Number.isInteger(candidate.requestHistoryLimit) || Number(candidate.requestHistoryLimit) <= 0) {
    return null;
  }

  if (typeof candidate.openBrowserOnStart !== 'boolean') {
    return null;
  }

  return {
    host: candidate.host.trim(),
    port: Number(candidate.port),
    publicUrl: candidate.publicUrl.trim(),
    protocols: candidate.protocols.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0),
    allowedHosts: candidate.allowedHosts
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0),
    requestHistoryLimit: Number(candidate.requestHistoryLimit),
    openBrowserOnStart: candidate.openBrowserOnStart,
  };
}

async function readRuntimeInfo(stateDir: string): Promise<RuntimeInfo | null> {
  const runtimeFilePath = path.resolve(stateDir, RUNTIME_FILE_NAME);

  try {
    const raw = (await readFile(runtimeFilePath, 'utf-8')).trim();
    if (raw.length === 0) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<RuntimeInfo>;
    if (!isRuntimeInfo(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

async function readServerLogs(
  stateDir: string,
  limit: number,
): Promise<{
  lines: string[];
  truncated: boolean;
}> {
  const logFilePath = path.resolve(stateDir, SERVER_LOG_FILE_NAME);

  try {
    const raw = await readFile(logFilePath, 'utf-8');
    const allLines = splitLogLines(raw);

    if (allLines.length <= limit) {
      return {
        lines: allLines,
        truncated: false,
      };
    }

    return {
      lines: allLines.slice(-limit),
      truncated: true,
    };
  } catch (error) {
    if (isErrnoCode(error, 'ENOENT')) {
      return {
        lines: [],
        truncated: false,
      };
    }

    return {
      lines: [],
      truncated: false,
    };
  }
}

function resolveTokenFilePath(stateDir: string): string {
  return path.resolve(stateDir, TOKEN_FILE_NAME);
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function toListenUrl(config: Config): string {
  return `http://${config.host}:${config.port}`;
}

function splitLogLines(value: string): string[] {
  const lines = value.split(/\r?\n/);

  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isHttpUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.startsWith('http://') || normalized.startsWith('https://');
}

function isRuntimeInfo(value: Partial<RuntimeInfo>): value is RuntimeInfo {
  return (
    typeof value.pid === 'number' &&
    Number.isInteger(value.pid) &&
    value.pid > 0 &&
    typeof value.startedAt === 'string' &&
    typeof value.listenUrl === 'string' &&
    typeof value.panelUrl === 'string' &&
    typeof value.version === 'string' &&
    typeof value.stateDir === 'string'
  );
}

function isErrnoCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

function createBadRequestResponse(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  });
}
