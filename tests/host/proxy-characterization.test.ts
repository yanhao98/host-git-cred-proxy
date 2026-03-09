import { describe, expect, test } from 'bun:test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ENTRY = fileURLToPath(new URL('../../host/server.mjs', import.meta.url));
const GIT_STUB_SCRIPT = fileURLToPath(new URL('../fixtures/git-credential-stub.sh', import.meta.url));

const PROXY_HOST = '127.0.0.1';
const PROXY_TOKEN = 'test-token-12345';
const DEFAULT_PROTOCOLS = 'https';
const CONTENT_TYPE = 'text/plain; charset=utf-8';

type FillMode = 'ok' | 'missing-terminal-prompts' | 'missing-username' | 'missing-password';

type ProxyHarnessOptions = {
  protocols?: string;
  allowedHosts?: string;
  token?: string;
  fillMode?: FillMode;
};

type GitStubCall = {
  action: string;
  terminalPrompt: string;
};

type ProxyHarness = {
  baseUrl: string;
  readGitStubCalls: () => Promise<GitStubCall[]>;
};

describe('host/server.mjs proxy characterization', () => {
  test('GET /healthz -> 200 ok\\n', async () => {
    await withProxyServer({}, async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/healthz`);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('ok\n');
    });
  });

  test('Bearer token is enforced (401 without/with wrong token, 200 with correct token)', async () => {
    await withProxyServer({}, async ({ baseUrl, readGitStubCalls }) => {
      const body = credentialBody();

      const missingToken = await fetch(`${baseUrl}/fill`, {
        method: 'POST',
        headers: {
          'Content-Type': CONTENT_TYPE,
        },
        body,
      });

      expect(missingToken.status).toBe(401);
      expect(await missingToken.text()).toBe('Unauthorized\n');

      const wrongToken = await fetch(`${baseUrl}/fill`, {
        method: 'POST',
        headers: withBearer('definitely-not-the-right-token'),
        body,
      });

      expect(wrongToken.status).toBe(401);
      expect(await wrongToken.text()).toBe('Unauthorized\n');
      expect(await readGitStubCalls()).toEqual([]);

      const ok = await fetch(`${baseUrl}/fill`, {
        method: 'POST',
        headers: withBearer(),
        body,
      });

      expect(ok.status).toBe(200);
      expect(await ok.text()).toBe('protocol=https\nhost=github.com\nusername=stub-user\npassword=stub-pass\n\n');
      expect(await readGitStubCalls()).toEqual([{ action: 'fill', terminalPrompt: '0' }]);
    });
  });

  test('action mapping is preserved: get/store/erase + fill/approve/reject', async () => {
    await withProxyServer({}, async ({ baseUrl, readGitStubCalls }) => {
      const actionMatrix = [
        ['/get', 'fill'],
        ['/store', 'approve'],
        ['/erase', 'reject'],
        ['/fill', 'fill'],
        ['/approve', 'approve'],
        ['/reject', 'reject'],
      ] as const;

      for (const [route, gitAction] of actionMatrix) {
        const response = await fetch(`${baseUrl}${route}`, {
          method: 'POST',
          headers: withBearer(),
          body: credentialBody(),
        });

        expect(response.status).toBe(200);

        const text = await response.text();
        if (gitAction === 'fill') {
          expect(text).toContain('username=stub-user');
        } else {
          expect(text).toBe('');
        }
      }

      const calls = await readGitStubCalls();
      expect(calls.map((call) => call.action)).toEqual(actionMatrix.map(([, action]) => action));
      expect(calls.map((call) => call.terminalPrompt)).toEqual(actionMatrix.map(() => '0'));
    });
  });

  test('protocol whitelist blocks protocols outside GIT_CRED_PROXY_PROTOCOLS', async () => {
    await withProxyServer({ protocols: 'https' }, async ({ baseUrl, readGitStubCalls }) => {
      const response = await fetch(`${baseUrl}/fill`, {
        method: 'POST',
        headers: withBearer(),
        body: credentialBody({ protocol: 'http' }),
      });

      expect(response.status).toBe(403);
      expect(await response.text()).toBe('Protocol not allowed\n');
      expect(await readGitStubCalls()).toEqual([]);
    });
  });

  test('host whitelist blocks hosts outside GIT_CRED_PROXY_ALLOWED_HOSTS', async () => {
    await withProxyServer({ allowedHosts: 'github.com' }, async ({ baseUrl, readGitStubCalls }) => {
      const response = await fetch(`${baseUrl}/fill`, {
        method: 'POST',
        headers: withBearer(),
        body: credentialBody({ host: 'gitlab.com' }),
      });

      expect(response.status).toBe(403);
      expect(await response.text()).toBe('Host not allowed\n');
      expect(await readGitStubCalls()).toEqual([]);
    });
  });

  test('64 KiB request body cap rejects oversized payloads before git subprocess', async () => {
    await withProxyServer({}, async ({ baseUrl, readGitStubCalls }) => {
      const oversizeBody = `protocol=https\nhost=github.com\npath=${'a'.repeat(70_000)}\n\n`;

      let response: Response | null = null;
      let requestError: unknown = null;

      try {
        response = await fetch(`${baseUrl}/fill`, {
          method: 'POST',
          headers: withBearer(),
          body: oversizeBody,
        });
      } catch (error) {
        requestError = error;
      }

      if (response) {
        expect(response.status).toBe(500);
        expect(await response.text()).toBe('Request body too large\n');
      } else {
        expect(isErrnoCode(requestError, 'ECONNRESET')).toBe(true);
      }

      expect(await readGitStubCalls()).toEqual([]);
    });
  });

  test('POST /fill without protocol returns 400 Missing protocol', async () => {
    await withProxyServer({}, async ({ baseUrl, readGitStubCalls }) => {
      const response = await fetch(`${baseUrl}/fill`, {
        method: 'POST',
        headers: withBearer(),
        body: credentialBody({ protocol: undefined }),
      });

      expect(response.status).toBe(400);
      expect(await response.text()).toBe('Missing protocol\n');
      expect(await readGitStubCalls()).toEqual([]);
    });
  });

  const missingCredentialModes: Array<[FillMode, string]> = [
    ['missing-terminal-prompts', 'terminal prompts disabled'],
    ['missing-username', 'could not read username'],
    ['missing-password', 'could not read password'],
  ];

  for (const [fillMode, stderrSignature] of missingCredentialModes) {
    test(`fill missing-credential compatibility (${stderrSignature}) returns 200 + empty body`, async () => {
      await withProxyServer({ fillMode }, async ({ baseUrl, readGitStubCalls }) => {
        const response = await fetch(`${baseUrl}/fill`, {
          method: 'POST',
          headers: withBearer(),
          body: credentialBody(),
        });

        expect(response.status).toBe(200);
        expect(await response.text()).toBe('');
        expect(await readGitStubCalls()).toEqual([{ action: 'fill', terminalPrompt: '0' }]);
      });
    });
  }

  test('GIT_TERMINAL_PROMPT=0 is always set for git credential subprocess', async () => {
    await withProxyServer({}, async ({ baseUrl, readGitStubCalls }) => {
      const response = await fetch(`${baseUrl}/approve`, {
        method: 'POST',
        headers: withBearer(),
        body: credentialBody(),
      });

      expect(response.status).toBe(200);

      const calls = await readGitStubCalls();
      expect(calls).toEqual([{ action: 'approve', terminalPrompt: '0' }]);
    });
  });

  test('non-POST action requests return 405 Method Not Allowed', async () => {
    await withProxyServer({}, async ({ baseUrl, readGitStubCalls }) => {
      const response = await fetch(`${baseUrl}/fill`, {
        method: 'GET',
        headers: withBearer(),
      });

      expect(response.status).toBe(405);
      expect(await response.text()).toBe('Method Not Allowed\n');
      expect(await readGitStubCalls()).toEqual([]);
    });
  });

  test('unknown POST path returns 404 Not Found', async () => {
    await withProxyServer({}, async ({ baseUrl, readGitStubCalls }) => {
      const response = await fetch(`${baseUrl}/unknown`, {
        method: 'POST',
        headers: withBearer(),
        body: credentialBody(),
      });

      expect(response.status).toBe(404);
      expect(await response.text()).toBe('Not Found\n');
      expect(await readGitStubCalls()).toEqual([]);
    });
  });
});

function withBearer(token = PROXY_TOKEN): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': CONTENT_TYPE,
  };
}

function credentialBody(overrides: Record<string, string | undefined> = {}): string {
  const attrs: Record<string, string | undefined> = {
    protocol: 'https',
    host: 'github.com',
    path: 'owner/repo.git',
    ...overrides,
  };

  const lines = Object.entries(attrs)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`);

  return `${lines.join('\n')}\n\n`;
}

async function withProxyServer(
  options: ProxyHarnessOptions,
  run: (harness: ProxyHarness) => Promise<void>,
): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), 'proxy-characterization-'));
  const shimBinDir = join(tempRoot, 'bin');
  const shimGitPath = join(shimBinDir, 'git');
  const stubLogPath = join(tempRoot, 'git-credential-calls.log');

  await mkdir(shimBinDir, { recursive: true });
  await writeFile(
    shimGitPath,
    `#!/usr/bin/env bash\nexec bash "${escapeForDoubleQuotedShell(GIT_STUB_SCRIPT)}" "$@"\n`,
  );
  await chmod(shimGitPath, 0o755);

  const port = await findFreePort(PROXY_HOST);
  const baseUrl = `http://${PROXY_HOST}:${port}`;

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  const child = spawn('node', [SERVER_ENTRY], {
    env: {
      ...process.env,
      PATH: `${shimBinDir}:${process.env.PATH ?? ''}`,
      GIT_CRED_PROXY_TOKEN: options.token ?? PROXY_TOKEN,
      GIT_CRED_PROXY_HOST: PROXY_HOST,
      GIT_CRED_PROXY_PORT: String(port),
      GIT_CRED_PROXY_PROTOCOLS: options.protocols ?? DEFAULT_PROTOCOLS,
      GIT_CRED_PROXY_ALLOWED_HOSTS: options.allowedHosts ?? '',
      GIT_CREDENTIAL_STUB_FILL_MODE: options.fillMode ?? 'ok',
      GIT_CREDENTIAL_STUB_LOG_FILE: stubLogPath,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    stdoutChunks.push(chunk.toString());
  });

  child.stderr.on('data', (chunk) => {
    stderrChunks.push(chunk.toString());
  });

  try {
    await waitForServerReady(child, `${baseUrl}/healthz`, () => {
      const stdout = stdoutChunks.join('');
      const stderr = stderrChunks.join('');
      return `stdout:\n${stdout || '<empty>'}\nstderr:\n${stderr || '<empty>'}`;
    });

    await run({
      baseUrl,
      readGitStubCalls: async () => {
        return parseGitStubCalls(await readFileSafe(stubLogPath));
      },
    });
  } finally {
    await stopServer(child);
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function parseGitStubCalls(content: string): GitStubCall[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [action, terminalPrompt = ''] = line.split(',');
      return {
        action,
        terminalPrompt,
      };
    });
}

async function readFileSafe(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (isErrnoCode(error, 'ENOENT')) {
      return '';
    }

    throw error;
  }
}

function isErrnoCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

async function waitForServerReady(
  child: ChildProcessWithoutNullStreams,
  healthzUrl: string,
  diagnostics: () => string,
): Promise<void> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`host/server.mjs exited before readiness. ${diagnostics()}`);
    }

    try {
      const response = await fetch(healthzUrl);
      if (response.status === 200) {
        return;
      }
    } catch {
    }

    await sleep(25);
  }

  throw new Error(`Timed out waiting for host/server.mjs at ${healthzUrl}. ${diagnostics()}`);
}

async function stopServer(child: ChildProcessWithoutNullStreams): Promise<void> {
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

async function findFreePort(host: string): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();

    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();

      if (!address || typeof address === 'string') {
        server.close(() => {
          reject(new Error('Unable to resolve free port'));
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

function escapeForDoubleQuotedShell(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
