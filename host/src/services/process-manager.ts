import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { platform } from 'node:os';
import path from 'node:path';

import type { Config } from './config';
import { loadConfig } from './config';
import { resolveStateDir, ensureStateFile } from './state-dir';
import { TokenService } from './token';
import { startServer } from '../server';

const PID_FILE_NAME = 'server.pid';
const RUNTIME_FILE_NAME = 'runtime.json';
const LOG_FILE_NAME = 'server.log';
const TOKEN_FILE_NAME = 'token';

const HEALTH_CHECK_TIMEOUT_MS = 5_000;
const HEALTH_CHECK_INTERVAL_MS = 100;
const STOP_WAIT_TIMEOUT_MS = 2_000;
const STOP_WAIT_INTERVAL_MS = 50;
const DEFAULT_VERSION = process.env.npm_package_version?.trim() || '0.1.0';

const SUPPORTED_COMMANDS = ['serve', 'start', 'stop', 'status', 'open', 'rotate-token'] as const;

type RuntimeInfo = {
  pid: number;
  startedAt: string;
  listenUrl: string;
  panelUrl: string;
  version: string;
  stateDir: string;
};

type ProcessInspection = {
  isRunning: boolean;
  isProxyProcess: boolean;
  command: string;
};

type WriteTarget = {
  write(chunk: string): unknown;
};

export type ProcessCommand = (typeof SUPPORTED_COMMANDS)[number];

export type RunProcessCommandOptions = {
  entrypoint?: string;
  stdout?: WriteTarget;
  stderr?: WriteTarget;
};

type ProcessCommandContext = {
  stateDir: string;
  config: Config;
  entrypoint: string;
  stdout: WriteTarget;
  stderr: WriteTarget;
};

type RuntimePaths = {
  pidFilePath: string;
  runtimeFilePath: string;
  logFilePath: string;
  tokenFilePath: string;
};

export function isProcessCommand(value: string): value is ProcessCommand {
  return SUPPORTED_COMMANDS.includes(value as ProcessCommand);
}

export async function runProcessCommand(
  command: ProcessCommand,
  options: RunProcessCommandOptions = {},
): Promise<number> {
  const stateDir = resolveStateDir();
  const config = loadConfig(stateDir);
  const entrypoint = resolveEntrypoint(options.entrypoint);

  const context: ProcessCommandContext = {
    stateDir,
    config,
    entrypoint,
    stdout: options.stdout ?? process.stdout,
    stderr: options.stderr ?? process.stderr,
  };

  switch (command) {
    case 'serve':
      return await runServeCommand(context);
    case 'start':
      return await runStartCommand(context);
    case 'stop':
      return await runStopCommand(context);
    case 'status':
      return await runStatusCommand(context);
    case 'open':
      return await runOpenCommand(context);
    case 'rotate-token':
      return await runRotateTokenCommand(context);
  }
}

async function runServeCommand(context: ProcessCommandContext): Promise<number> {
  const { stateDir, config, stdout } = context;
  const paths = resolveRuntimePaths(stateDir);
  const listenUrl = toListenUrl(config);
  const panelUrl = listenUrl;
  const startedAt = new Date().toISOString();

  new TokenService(stateDir);

  const pidFilePath = ensureStateFile(stateDir, PID_FILE_NAME);
  const runtimeFilePath = ensureStateFile(stateDir, RUNTIME_FILE_NAME);

  await writeFile(pidFilePath, `${process.pid}\n`, { encoding: 'utf-8' });
  await writeRuntimeFile(runtimeFilePath, {
    pid: process.pid,
    startedAt,
    listenUrl,
    panelUrl,
    version: DEFAULT_VERSION,
    stateDir,
  });

  const app = startServer(config.port);
  writeLine(stdout, `host service listening at ${listenUrl}`);

  let shutdownRequested = false;

  return await new Promise<number>((resolve) => {
    const completeShutdown = (signal: string) => {
      if (shutdownRequested) {
        return;
      }

      shutdownRequested = true;
      safelyStopServer(app);

      void removeIfExists(paths.pidFilePath).finally(() => {
        process.off('SIGTERM', onSigterm);
        process.off('SIGINT', onSigint);
        writeLine(stdout, `received ${signal}, shutting down`);
        resolve(0);
      });
    };

    const onSigterm = () => {
      completeShutdown('SIGTERM');
    };

    const onSigint = () => {
      completeShutdown('SIGINT');
    };

    process.once('SIGTERM', onSigterm);
    process.once('SIGINT', onSigint);
  });
}

async function runStartCommand(context: ProcessCommandContext): Promise<number> {
  const { stateDir, config, entrypoint, stdout, stderr } = context;
  const paths = resolveRuntimePaths(stateDir);
  const listenUrl = toListenUrl(config);

  new TokenService(stateDir);
  ensureStateFile(stateDir, LOG_FILE_NAME);

  const pidFromFile = await readPidFile(paths.pidFilePath);
  if (pidFromFile !== null) {
    const inspection = inspectProcess(pidFromFile);

    if (!inspection.isRunning || !inspection.isProxyProcess) {
      await removeIfExists(paths.pidFilePath);
    } else {
      const isHealthy = await checkHealth(listenUrl);
      if (isHealthy) {
        const runtime = await readRuntimeFile(paths.runtimeFilePath);
        const panelUrl = runtime?.panelUrl ?? listenUrl;

        writeLine(stdout, 'Service already running');
        writeLine(stdout, `Panel URL: ${panelUrl}`);
        writeLine(stdout, `State dir: ${stateDir}`);
        writeLine(stdout, `Token file: ${paths.tokenFilePath}`);
        return 0;
      }

      writeLine(stderr, 'Service is already running but unhealthy');
      writeLine(stderr, `PID: ${pidFromFile}`);
      writeLine(stderr, `Log file: ${paths.logFilePath}`);
      return 1;
    }
  }

  const portProbe = await probePort(config.host, config.port);
  if (!portProbe.available) {
    writeLine(
      stderr,
      `Port ${config.port} is already occupied by a non-host-git-cred-proxy process (${portProbe.reason}).`,
    );
    return 1;
  }

  const logFd = openSync(paths.logFilePath, 'a');
  try {
    const subprocess = Bun.spawn(['bun', 'run', entrypoint, 'serve'], {
      detached: true,
      stdin: 'ignore',
      stdout: logFd,
      stderr: logFd,
      env: {
        ...process.env,
        GIT_CRED_PROXY_STATE_DIR: stateDir,
      },
    });

    subprocess.unref();
  } finally {
    closeSync(logFd);
  }

  const becameHealthy = await waitForHealth(listenUrl, HEALTH_CHECK_TIMEOUT_MS, HEALTH_CHECK_INTERVAL_MS);
  if (!becameHealthy) {
    writeLine(stderr, `Service failed health check within ${HEALTH_CHECK_TIMEOUT_MS}ms.`);
    writeLine(stderr, `Log file: ${paths.logFilePath}`);
    return 1;
  }

  const runtime = await readRuntimeFile(paths.runtimeFilePath);
  const panelUrl = runtime?.panelUrl ?? listenUrl;

  writeLine(stdout, 'Service started');
  writeLine(stdout, `Panel URL: ${panelUrl}`);
  writeLine(stdout, `State dir: ${stateDir}`);
  writeLine(stdout, `Token file: ${paths.tokenFilePath}`);
  writeLine(stdout, `Log file: ${paths.logFilePath}`);

  return 0;
}

async function runStopCommand(context: ProcessCommandContext): Promise<number> {
  const { stateDir, stdout, stderr } = context;
  const paths = resolveRuntimePaths(stateDir);
  const pid = await readPidFile(paths.pidFilePath);

  if (pid === null) {
    writeLine(stdout, 'Service is already stopped');
    return 0;
  }

  const inspection = inspectProcess(pid);
  if (!inspection.isRunning) {
    await removeIfExists(paths.pidFilePath);
    writeLine(stdout, 'Service is already stopped');
    return 0;
  }

  if (!inspection.isProxyProcess) {
    await removeIfExists(paths.pidFilePath);
    writeLine(stdout, 'Removed stale pid file pointing to an unrelated process');
    return 0;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    if (!isErrnoCode(error, 'ESRCH')) {
      writeLine(stderr, `Failed to stop service pid=${pid}: ${toErrorMessage(error)}`);
      return 1;
    }
  }

  await waitForProcessToExit(pid, STOP_WAIT_TIMEOUT_MS);

  if (isProcessRunning(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
      await waitForProcessToExit(pid, STOP_WAIT_TIMEOUT_MS);
    } catch (error) {
      if (!isErrnoCode(error, 'ESRCH')) {
        writeLine(stderr, `Failed to force-stop service pid=${pid}: ${toErrorMessage(error)}`);
        return 1;
      }
    }
  }

  await removeIfExists(paths.pidFilePath);
  writeLine(stdout, `Service stopped (pid=${pid})`);
  return 0;
}

async function runStatusCommand(context: ProcessCommandContext): Promise<number> {
  const { stateDir, config, stdout } = context;
  const paths = resolveRuntimePaths(stateDir);
  const listenUrl = toListenUrl(config);
  const pid = await readPidFile(paths.pidFilePath);

  if (pid === null) {
    writeLine(stdout, 'Service is not running');
    return 1;
  }

  const inspection = inspectProcess(pid);
  if (!inspection.isRunning || !inspection.isProxyProcess) {
    await removeIfExists(paths.pidFilePath);
    writeLine(stdout, 'Service is not running');
    return 1;
  }

  const runtime = await readRuntimeFile(paths.runtimeFilePath);
  const healthy = await checkHealth(listenUrl);

  if (!healthy) {
    writeLine(stdout, 'Service is running but unhealthy');
    return 1;
  }

  const startedAt = runtime?.startedAt ?? 'unknown';
  const uptime = formatUptime(startedAt);

  writeLine(stdout, 'Service is running');
  writeLine(stdout, `PID: ${pid}`);
  writeLine(stdout, `Listen URL: ${runtime?.listenUrl ?? listenUrl}`);
  writeLine(stdout, `Panel URL: ${runtime?.panelUrl ?? listenUrl}`);
  writeLine(stdout, `State dir: ${runtime?.stateDir ?? stateDir}`);
  writeLine(stdout, `Uptime: ${uptime}`);
  return 0;
}

async function runOpenCommand(context: ProcessCommandContext): Promise<number> {
  const { stateDir, stdout, stderr } = context;
  const paths = resolveRuntimePaths(stateDir);

  const pid = await readPidFile(paths.pidFilePath);
  if (pid === null) {
    writeLine(stderr, 'Service is not running');
    return 1;
  }

  const inspection = inspectProcess(pid);
  if (!inspection.isRunning || !inspection.isProxyProcess) {
    await removeIfExists(paths.pidFilePath);
    writeLine(stderr, 'Service is not running');
    return 1;
  }

  const runtime = await readRuntimeFile(paths.runtimeFilePath);
  if (!runtime?.panelUrl) {
    writeLine(stderr, `Missing runtime metadata at ${paths.runtimeFilePath}`);
    return 1;
  }

  const opener = resolveOpenCommand(runtime.panelUrl);
  const result = spawnSync(opener.command, opener.args, {
    stdio: 'ignore',
  });

  if (result.status !== 0) {
    writeLine(stderr, `Failed to open panel URL: ${runtime.panelUrl}`);
    return 1;
  }

  writeLine(stdout, `Opened ${runtime.panelUrl}`);
  return 0;
}

async function runRotateTokenCommand(context: ProcessCommandContext): Promise<number> {
  const { stateDir, stdout } = context;

  const tokenService = new TokenService(stateDir);
  const result = await tokenService.rotate();

  writeLine(stdout, `Token rotated. Token file: ${result.tokenFilePath}`);
  return 0;
}

function resolveRuntimePaths(stateDir: string): RuntimePaths {
  return {
    pidFilePath: path.resolve(stateDir, PID_FILE_NAME),
    runtimeFilePath: path.resolve(stateDir, RUNTIME_FILE_NAME),
    logFilePath: path.resolve(stateDir, LOG_FILE_NAME),
    tokenFilePath: path.resolve(stateDir, TOKEN_FILE_NAME),
  };
}

function resolveEntrypoint(entrypoint?: string): string {
  const candidate = entrypoint?.trim() || process.argv[1]?.trim();

  if (!candidate) {
    throw new Error('Unable to resolve host CLI entrypoint for detached start command');
  }

  return path.resolve(candidate);
}

function toListenUrl(config: Config): string {
  return `http://${config.host}:${config.port}`;
}

function writeLine(target: WriteTarget, message: string): void {
  target.write(`${message}\n`);
}

function inspectProcess(pid: number): ProcessInspection {
  if (!isProcessRunning(pid)) {
    return {
      isRunning: false,
      isProxyProcess: false,
      command: '',
    };
  }

  const output = spawnSync('ps', ['-p', String(pid), '-o', 'command='], {
    encoding: 'utf-8',
  });

  const command = output.status === 0 ? String(output.stdout ?? '').trim() : '';
  return {
    isRunning: true,
    isProxyProcess: looksLikeHostProxyCommand(command),
    command,
  };
}

function looksLikeHostProxyCommand(command: string): boolean {
  const normalized = command.toLowerCase();
  if (!normalized.includes('serve')) {
    return false;
  }

  return (
    normalized.includes('host-git-cred-proxy') ||
    normalized.includes('host/src/index.ts') ||
    normalized.includes('dist/host/index')
  );
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isErrnoCode(error, 'ESRCH')) {
      return false;
    }

    return true;
  }
}

async function readPidFile(pidFilePath: string): Promise<number | null> {
  if (!existsSync(pidFilePath)) {
    return null;
  }

  const raw = (await readFile(pidFilePath, 'utf-8')).trim();
  if (raw.length === 0) {
    return null;
  }

  const pid = Number(raw);
  if (!Number.isInteger(pid) || pid <= 0) {
    return null;
  }

  return pid;
}

async function removeIfExists(filePath: string): Promise<void> {
  try {
    await rm(filePath, {
      force: true,
    });
  } catch {
  }
}

async function writeRuntimeFile(runtimeFilePath: string, runtime: RuntimeInfo): Promise<void> {
  const serialized = `${JSON.stringify(runtime, null, 2)}\n`;
  await writeFile(runtimeFilePath, serialized, {
    encoding: 'utf-8',
  });
}

async function readRuntimeFile(runtimeFilePath: string): Promise<RuntimeInfo | null> {
  if (!existsSync(runtimeFilePath)) {
    return null;
  }

  const raw = (await readFile(runtimeFilePath, 'utf-8')).trim();
  if (raw.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<RuntimeInfo>;
    if (!isRuntimeInfo(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
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

function safelyStopServer(app: unknown): void {
  const maybeApp = app as {
    stop?: () => unknown;
    server?: {
      stop?: (closeActiveConnections?: boolean) => unknown;
    };
  };

  try {
    if (typeof maybeApp.stop === 'function') {
      maybeApp.stop();
      return;
    }

    if (typeof maybeApp.server?.stop === 'function') {
      maybeApp.server.stop(true);
    }
  } catch {
  }
}

async function waitForHealth(listenUrl: string, timeoutMs: number, intervalMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await checkHealth(listenUrl)) {
      return true;
    }

    await sleep(intervalMs);
  }

  return false;
}

async function checkHealth(listenUrl: string): Promise<boolean> {
  const healthUrl = new URL('/healthz', `${listenUrl}/`).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300);

  try {
    const response = await fetch(healthUrl, {
      signal: controller.signal,
    });
    return response.status === 200;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function probePort(host: string, port: number): Promise<{ available: boolean; reason: string }> {
  return await new Promise<{ available: boolean; reason: string }>((resolve) => {
    const probe = createServer();

    probe.once('error', (error) => {
      const reason = isErrnoLike(error) && typeof error.code === 'string' ? error.code : 'UNKNOWN';
      resolve({
        available: false,
        reason,
      });
    });

    probe.listen(port, host, () => {
      probe.close((error) => {
        if (error) {
          const reason = isErrnoLike(error) && typeof error.code === 'string' ? error.code : 'CLOSE_ERROR';
          resolve({
            available: false,
            reason,
          });
          return;
        }

        resolve({
          available: true,
          reason: 'ok',
        });
      });
    });
  });
}

async function waitForProcessToExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) {
      return;
    }

    await sleep(STOP_WAIT_INTERVAL_MS);
  }
}

function resolveOpenCommand(url: string): { command: string; args: string[] } {
  const currentPlatform = platform();

  if (currentPlatform === 'darwin') {
    return {
      command: 'open',
      args: [url],
    };
  }

  if (currentPlatform === 'win32') {
    return {
      command: 'cmd',
      args: ['/c', 'start', '', url],
    };
  }

  return {
    command: 'xdg-open',
    args: [url],
  };
}

function formatUptime(startedAt: string): string {
  const startedEpoch = Date.parse(startedAt);
  if (Number.isNaN(startedEpoch)) {
    return 'unknown';
  }

  const elapsedMs = Math.max(Date.now() - startedEpoch, 0);
  const elapsedSeconds = Math.floor(elapsedMs / 1_000);

  const hours = Math.floor(elapsedSeconds / 3_600);
  const minutes = Math.floor((elapsedSeconds % 3_600) / 60);
  const seconds = elapsedSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function isErrnoCode(error: unknown, code: string): boolean {
  return Boolean(isErrnoLike(error) && error.code === code);
}

function isErrnoLike(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
