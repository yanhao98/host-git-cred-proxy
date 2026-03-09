import { describe, expect, test } from 'bun:test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runProcessCommand, type ProcessCommand } from '../../host/src/services/process-manager';

const HOST_ENTRYPOINT = fileURLToPath(new URL('../../host/src/index.ts', import.meta.url));
const LISTEN_HOST = '127.0.0.1';

type RuntimeInfo = {
  pid: number;
  startedAt: string;
  listenUrl: string;
  panelUrl: string;
  version: string;
  stateDir: string;
};

describe('process manager lifecycle', () => {
  test('serve starts and writes server.pid + runtime.json', async () => {
    await withTempDir('process-manager-serve-', async (stateDir) => {
      const port = await findFreePort(LISTEN_HOST);
      const listenUrl = `http://${LISTEN_HOST}:${port}`;

      await withEnv(
        {
          GIT_CRED_PROXY_STATE_DIR: stateDir,
          GIT_CRED_PROXY_HOST: LISTEN_HOST,
          GIT_CRED_PROXY_PORT: String(port),
        },
        async () => {
          const stdoutChunks: string[] = [];
          const stderrChunks: string[] = [];

          const child = spawn('bun', ['run', HOST_ENTRYPOINT, 'serve'], {
            env: {
              ...process.env,
            },
            stdio: ['pipe', 'pipe', 'pipe'],
          });

          child.stdout.on('data', (chunk) => {
            stdoutChunks.push(String(chunk));
          });

          child.stderr.on('data', (chunk) => {
            stderrChunks.push(String(chunk));
          });

          try {
            await waitForHealth(listenUrl, 5_000, () => {
              if (child.exitCode !== null) {
                throw new Error(
                  [
                    `serve exited before readiness with code=${child.exitCode}`,
                    `stdout:\n${stdoutChunks.join('') || '<empty>'}`,
                    `stderr:\n${stderrChunks.join('') || '<empty>'}`,
                  ].join('\n'),
                );
              }
            });

            const pidFilePath = path.resolve(stateDir, 'server.pid');
            const runtimeFilePath = path.resolve(stateDir, 'runtime.json');

            const pidFromFile = Number((await readFile(pidFilePath, 'utf-8')).trim());
            expect(Number.isInteger(pidFromFile)).toBe(true);

            const childPid = child.pid;
            if (typeof childPid !== 'number') {
              throw new Error('Unable to resolve foreground serve pid');
            }

            expect(pidFromFile).toBe(childPid);

            const runtime = (JSON.parse(await readFile(runtimeFilePath, 'utf-8')) as RuntimeInfo);
            expect(runtime.pid).toBe(pidFromFile);
            expect(runtime.listenUrl).toBe(listenUrl);
            expect(runtime.panelUrl).toBe(listenUrl);
            expect(runtime.stateDir).toBe(stateDir);
            expect(runtime.version.length).toBeGreaterThan(0);
          } finally {
            await stopForegroundServer(child);
            await expectMissingPath(path.resolve(stateDir, 'server.pid'));
          }
        },
      );
    });
  });

  test('start spawns background service and waits for healthz', async () => {
    await withTempDir('process-manager-start-', async (stateDir) => {
      const port = await findFreePort(LISTEN_HOST);
      const listenUrl = `http://${LISTEN_HOST}:${port}`;

      await withEnv(
        {
          GIT_CRED_PROXY_STATE_DIR: stateDir,
          GIT_CRED_PROXY_HOST: LISTEN_HOST,
          GIT_CRED_PROXY_PORT: String(port),
        },
        async () => {
          try {
            expect(await runHostCommand('start')).toBe(0);
            await waitForHealth(listenUrl, 5_000);

            const pid = Number((await readFile(path.resolve(stateDir, 'server.pid'), 'utf-8')).trim());
            expect(Number.isInteger(pid)).toBe(true);
          } finally {
            await runHostCommand('stop');
          }
        },
      );
    });
  });

  test('start is idempotent and exits 0 when already running', async () => {
    await withTempDir('process-manager-idempotent-', async (stateDir) => {
      const port = await findFreePort(LISTEN_HOST);

      await withEnv(
        {
          GIT_CRED_PROXY_STATE_DIR: stateDir,
          GIT_CRED_PROXY_HOST: LISTEN_HOST,
          GIT_CRED_PROXY_PORT: String(port),
        },
        async () => {
          try {
            const first = await runHostCommand('start');
            const second = await runHostCommand('start');

            expect(first).toBe(0);
            expect(second).toBe(0);
          } finally {
            await runHostCommand('stop');
          }
        },
      );
    });
  });

  test('stop sends SIGTERM and removes pid file', async () => {
    await withTempDir('process-manager-stop-', async (stateDir) => {
      const port = await findFreePort(LISTEN_HOST);

      await withEnv(
        {
          GIT_CRED_PROXY_STATE_DIR: stateDir,
          GIT_CRED_PROXY_HOST: LISTEN_HOST,
          GIT_CRED_PROXY_PORT: String(port),
        },
        async () => {
          expect(await runHostCommand('start')).toBe(0);
          const pid = Number((await readFile(path.resolve(stateDir, 'server.pid'), 'utf-8')).trim());
          expect(Number.isInteger(pid)).toBe(true);

          expect(await runHostCommand('stop')).toBe(0);
          await expectMissingPath(path.resolve(stateDir, 'server.pid'));
          await waitForCondition(() => !isProcessRunning(pid), 2_000);
        },
      );
    });
  });

  test('stop exits 0 when service is already stopped', async () => {
    await withTempDir('process-manager-stop-idempotent-', async (stateDir) => {
      await withEnv(
        {
          GIT_CRED_PROXY_STATE_DIR: stateDir,
        },
        async () => {
          expect(await runHostCommand('stop')).toBe(0);
        },
      );
    });
  });

  test('start cleans stale pid file before starting service', async () => {
    await withTempDir('process-manager-stale-pid-', async (stateDir) => {
      const port = await findFreePort(LISTEN_HOST);
      const stalePid = await findUnusedPid();
      await writeFile(path.resolve(stateDir, 'server.pid'), `${stalePid}\n`, 'utf-8');

      await withEnv(
        {
          GIT_CRED_PROXY_STATE_DIR: stateDir,
          GIT_CRED_PROXY_HOST: LISTEN_HOST,
          GIT_CRED_PROXY_PORT: String(port),
        },
        async () => {
          try {
            expect(await runHostCommand('start')).toBe(0);
            const activePid = Number((await readFile(path.resolve(stateDir, 'server.pid'), 'utf-8')).trim());

            expect(activePid).not.toBe(stalePid);
            expect(activePid > 0).toBe(true);
          } finally {
            await runHostCommand('stop');
          }
        },
      );
    });
  });

  test('status exits 0 when service is running and healthy', async () => {
    await withTempDir('process-manager-status-running-', async (stateDir) => {
      const port = await findFreePort(LISTEN_HOST);

      await withEnv(
        {
          GIT_CRED_PROXY_STATE_DIR: stateDir,
          GIT_CRED_PROXY_HOST: LISTEN_HOST,
          GIT_CRED_PROXY_PORT: String(port),
        },
        async () => {
          try {
            expect(await runHostCommand('start')).toBe(0);
            expect(await runHostCommand('status')).toBe(0);
          } finally {
            await runHostCommand('stop');
          }
        },
      );
    });
  });

  test('status exits 1 when service is not running', async () => {
    await withTempDir('process-manager-status-stopped-', async (stateDir) => {
      await withEnv(
        {
          GIT_CRED_PROXY_STATE_DIR: stateDir,
        },
        async () => {
          expect(await runHostCommand('status')).toBe(1);
        },
      );
    });
  });

  test('rotate-token updates token without restart', async () => {
    await withTempDir('process-manager-rotate-token-', async (stateDir) => {
      const port = await findFreePort(LISTEN_HOST);

      await withEnv(
        {
          GIT_CRED_PROXY_STATE_DIR: stateDir,
          GIT_CRED_PROXY_HOST: LISTEN_HOST,
          GIT_CRED_PROXY_PORT: String(port),
        },
        async () => {
          try {
            expect(await runHostCommand('start')).toBe(0);

            const pidBefore = Number((await readFile(path.resolve(stateDir, 'server.pid'), 'utf-8')).trim());
            const tokenBefore = (await readFile(path.resolve(stateDir, 'token'), 'utf-8')).trim();

            expect(await runHostCommand('rotate-token')).toBe(0);

            const tokenAfter = (await readFile(path.resolve(stateDir, 'token'), 'utf-8')).trim();
            const pidAfter = Number((await readFile(path.resolve(stateDir, 'server.pid'), 'utf-8')).trim());

            expect(tokenAfter).not.toBe(tokenBefore);
            expect(pidAfter).toBe(pidBefore);
            expect(await runHostCommand('status')).toBe(0);
          } finally {
            await runHostCommand('stop');
          }
        },
      );
    });
  });

  test('runtime.json contains expected fields', async () => {
    await withTempDir('process-manager-runtime-', async (stateDir) => {
      const port = await findFreePort(LISTEN_HOST);
      const listenUrl = `http://${LISTEN_HOST}:${port}`;

      await withEnv(
        {
          GIT_CRED_PROXY_STATE_DIR: stateDir,
          GIT_CRED_PROXY_HOST: LISTEN_HOST,
          GIT_CRED_PROXY_PORT: String(port),
        },
        async () => {
          try {
            expect(await runHostCommand('start')).toBe(0);

            const runtime = JSON.parse(await readFile(path.resolve(stateDir, 'runtime.json'), 'utf-8')) as RuntimeInfo;

            expect(runtime.pid > 0).toBe(true);
            expect(Number.isNaN(Date.parse(runtime.startedAt))).toBe(false);
            expect(runtime.listenUrl).toBe(listenUrl);
            expect(runtime.panelUrl).toBe(listenUrl);
            expect(runtime.version.length).toBeGreaterThan(0);
            expect(runtime.stateDir).toBe(stateDir);
          } finally {
            await runHostCommand('stop');
          }
        },
      );
    });
  });
});

async function runHostCommand(command: ProcessCommand): Promise<number> {
  const output = createBufferingWriter();
  return await runProcessCommand(command, {
    entrypoint: HOST_ENTRYPOINT,
    stdout: output,
    stderr: output,
  });
}

function createBufferingWriter(): { write(chunk: string): void } {
  const chunks: string[] = [];
  return {
    write(chunk: string): void {
      chunks.push(chunk);
    },
  };
}

async function withTempDir(prefix: string, run: (tempDir: string) => Promise<void>): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), prefix));

  try {
    await run(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function withEnv(
  updates: Record<string, string | undefined>,
  run: () => Promise<void>,
): Promise<void> {
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

async function waitForHealth(url: string, timeoutMs: number, beforeAttempt?: () => void): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    beforeAttempt?.();

    try {
      const response = await fetch(`${url}/healthz`);
      if (response.status === 200) {
        return;
      }
    } catch {
    }

    await sleep(50);
  }

  throw new Error(`Timed out waiting for health: ${url}/healthz`);
}

async function stopForegroundServer(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  child.kill('SIGTERM');
  await waitForChildClose(child, 2_000);

  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await waitForChildClose(child, 2_000);
  }
}

async function waitForChildClose(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    const onClose = () => {
      clearTimeout(timeout);
      resolve();
    };

    const timeout = setTimeout(() => {
      child.off('close', onClose);
      resolve();
    }, timeoutMs);

    child.once('close', onClose);
  });
}

async function expectMissingPath(targetPath: string): Promise<void> {
  try {
    await access(targetPath, constants.F_OK);
    throw new Error(`Expected path to be missing: ${targetPath}`);
  } catch (error) {
    if (isErrnoCode(error, 'ENOENT')) {
      return;
    }

    throw error;
  }
}

async function waitForCondition(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }

    await sleep(50);
  }

  throw new Error(`Condition timed out after ${timeoutMs}ms`);
}

async function findFreePort(host: string): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();

    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();

      if (!address || typeof address === 'string') {
        server.close(() => {
          reject(new Error('Unable to allocate free port'));
        });
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

async function findUnusedPid(): Promise<number> {
  const candidatePids = [999_999, 888_888, 777_777, 666_666, 555_555];

  for (const pid of candidatePids) {
    if (!isProcessRunning(pid)) {
      return pid;
    }
  }

  return 999_999;
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

function isErrnoCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
