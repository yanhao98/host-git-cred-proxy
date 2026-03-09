import { describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Config } from '../../host/src/services/config';
import { createServer } from '../../host/src/server';
import { TokenService } from '../../host/src/services/token';

const GIT_STUB_SCRIPT = fileURLToPath(new URL('../fixtures/git-credential-stub.sh', import.meta.url));
const CONFIGURE_GIT_SCRIPT = fileURLToPath(new URL('../../container/configure-git.sh', import.meta.url));
const HOST_PROXY_SCRIPT = fileURLToPath(new URL('../../container/git-credential-hostproxy', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

const HOST = '127.0.0.1';
const PROXY_TOKEN = 'test-token-routes-proxy-container';
const DEFAULT_PUBLIC_URL = 'http://host.docker.internal:18765';
const CONTENT_TYPE_TEXT = 'text/plain; charset=utf-8';

type FillMode = 'ok' | 'missing-terminal-prompts' | 'missing-username' | 'missing-password';

type HostServerOptions = {
  protocols?: string[];
  allowedHosts?: string[];
  fillMode?: FillMode;
  publicUrl?: string;
};

type GitStubCall = {
  action: string;
  terminalPrompt: string;
};

type HostServerHarness = {
  baseUrl: string;
  readGitStubCalls: () => Promise<GitStubCall[]>;
};

describe('proxy + container routes', () => {
  test('GET /healthz -> 200 ok', async () => {
    await withHostServer({}, async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/healthz`);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('ok');
    });
  });

  test('POST /fill with valid Bearer -> 200 + credential payload', async () => {
    await withHostServer({}, async ({ baseUrl, readGitStubCalls }) => {
      const response = await fetch(`${baseUrl}/fill`, {
        method: 'POST',
        headers: withBearer(),
        body: credentialBody(),
      });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('protocol=https\nhost=github.com\nusername=stub-user\npassword=stub-pass\n\n');
      expect(await readGitStubCalls()).toEqual([{ action: 'fill', terminalPrompt: '0' }]);
    });
  });

  test('POST /fill without Bearer -> 401', async () => {
    await withHostServer({}, async ({ baseUrl, readGitStubCalls }) => {
      const response = await fetch(`${baseUrl}/fill`, {
        method: 'POST',
        headers: {
          'Content-Type': CONTENT_TYPE_TEXT,
        },
        body: credentialBody(),
      });

      expect(response.status).toBe(401);
      expect(response.headers.get('content-type')).toBe(CONTENT_TYPE_TEXT);
      expect(await response.text()).toBe('Unauthorized\n');
      expect(await readGitStubCalls()).toEqual([]);
    });
  });

  test('POST /fill with wrong Bearer -> 401', async () => {
    await withHostServer({}, async ({ baseUrl, readGitStubCalls }) => {
      const response = await fetch(`${baseUrl}/fill`, {
        method: 'POST',
        headers: withBearer('wrong-token'),
        body: credentialBody(),
      });

      expect(response.status).toBe(401);
      expect(await response.text()).toBe('Unauthorized\n');
      expect(await readGitStubCalls()).toEqual([]);
    });
  });

  test('POST /approve and /reject -> 200 empty body', async () => {
    await withHostServer({}, async ({ baseUrl, readGitStubCalls }) => {
      const approve = await fetch(`${baseUrl}/approve`, {
        method: 'POST',
        headers: withBearer(),
        body: credentialBody(),
      });

      const reject = await fetch(`${baseUrl}/reject`, {
        method: 'POST',
        headers: withBearer(),
        body: credentialBody(),
      });

      expect(approve.status).toBe(200);
      expect(await approve.text()).toBe('');

      expect(reject.status).toBe(200);
      expect(await reject.text()).toBe('');

      expect((await readGitStubCalls()).map((entry) => entry.action)).toEqual(['approve', 'reject']);
    });
  });

  test('legacy aliases /get /store /erase map to fill/approve/reject', async () => {
    await withHostServer({}, async ({ baseUrl, readGitStubCalls }) => {
      const matrix = [
        ['/get', 'fill'],
        ['/store', 'approve'],
        ['/erase', 'reject'],
      ] as const;

      for (const [pathname, action] of matrix) {
        const response = await fetch(`${baseUrl}${pathname}`, {
          method: 'POST',
          headers: withBearer(),
          body: credentialBody(),
        });

        expect(response.status).toBe(200);

        if (action === 'fill') {
          expect(await response.text()).toContain('username=stub-user');
        } else {
          expect(await response.text()).toBe('');
        }
      }

      expect((await readGitStubCalls()).map((entry) => entry.action)).toEqual(['fill', 'approve', 'reject']);
    });
  });

  test('protocol deny -> 403', async () => {
    await withHostServer({ protocols: ['https'] }, async ({ baseUrl, readGitStubCalls }) => {
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

  test('host deny -> 403', async () => {
    await withHostServer({ allowedHosts: ['github.com'] }, async ({ baseUrl, readGitStubCalls }) => {
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

  test('missing protocol -> 400', async () => {
    await withHostServer({}, async ({ baseUrl, readGitStubCalls }) => {
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

  test('body over 64 KiB -> 500 or connection reset', async () => {
    await withHostServer({}, async ({ baseUrl, readGitStubCalls }) => {
      const oversizedBody = `protocol=https\nhost=github.com\npath=${'a'.repeat(70_000)}\n\n`;

      let response: Response | null = null;
      let requestError: unknown = null;

      try {
        response = await fetch(`${baseUrl}/fill`, {
          method: 'POST',
          headers: withBearer(),
          body: oversizedBody,
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

  test('GET /container/install.sh -> 200 with publicUrl and no token value', async () => {
    await withHostServer({ publicUrl: DEFAULT_PUBLIC_URL }, async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/container/install.sh`);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(CONTENT_TYPE_TEXT);
      expect(body).toContain(DEFAULT_PUBLIC_URL);
      expect(body).toContain('/run/host-git-cred-proxy/token');
      expect(body).not.toContain(PROXY_TOKEN);
    });
  });

  test('GET /container/configure-git.sh -> 200 with script content', async () => {
    const expected = await readFile(CONFIGURE_GIT_SCRIPT, 'utf-8');

    await withHostServer({}, async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/container/configure-git.sh`);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe(expected);
    });
  });

  test('GET /container/git-credential-hostproxy -> 200 with script content', async () => {
    const expected = await readFile(HOST_PROXY_SCRIPT, 'utf-8');

    await withHostServer({}, async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/container/git-credential-hostproxy`);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe(expected);
    });
  });

  test('GET /fill (wrong method) -> 405', async () => {
    await withHostServer({}, async ({ baseUrl, readGitStubCalls }) => {
      const response = await fetch(`${baseUrl}/fill`, {
        method: 'GET',
        headers: withBearer(),
      });

      expect(response.status).toBe(405);
      expect(await response.text()).toBe('Method Not Allowed\n');
      expect(await readGitStubCalls()).toEqual([]);
    });
  });

  test('/api/admin/status returns JSON from loopback', async () => {
    await withHostServer({}, async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/api/admin/status`);
      const contentType = (response.headers.get('content-type') ?? '').toLowerCase();

      expect(response.status).toBe(200);
      expect(contentType.includes('application/json')).toBe(true);

      const payload = await response.json();
      expect(payload.running).toBe(true);
      expect(typeof payload.pid).toBe('number');
      expect(typeof payload.startedAt).toBe('string');
    });
  });

  test('/container/* routes do not require auth', async () => {
    await withHostServer({}, async ({ baseUrl }) => {
      const installResponse = await fetch(`${baseUrl}/container/install.sh`);
      const configureResponse = await fetch(`${baseUrl}/container/configure-git.sh`, {
        headers: {
          Authorization: 'Bearer definitely-wrong',
        },
      });

      expect(installResponse.status).toBe(200);
      expect(configureResponse.status).toBe(200);
    });
  });
});

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

function withBearer(token = PROXY_TOKEN): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': CONTENT_TYPE_TEXT,
  };
}

async function withHostServer(options: HostServerOptions, run: (harness: HostServerHarness) => Promise<void>): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), 'routes-proxy-container-'));
  const stateDir = join(tempRoot, 'state');
  const shimBinDir = join(tempRoot, 'bin');
  const shimGitPath = join(shimBinDir, 'git');
  const stubLogPath = join(tempRoot, 'git-credential-calls.log');

  await mkdir(stateDir, { recursive: true });
  await mkdir(shimBinDir, { recursive: true });

  const tokenPath = path.resolve(stateDir, 'token');
  await writeFile(tokenPath, `${PROXY_TOKEN}\n`, 'utf-8');
  await chmod(tokenPath, 0o600);

  await writeFile(
    shimGitPath,
    `#!/usr/bin/env bash\nexec bash \"${escapeForDoubleQuotedShell(GIT_STUB_SCRIPT)}\" \"$@\"\n`,
  );
  await chmod(shimGitPath, 0o755);

  const config: Config = {
    host: HOST,
    port: 18765,
    publicUrl: options.publicUrl ?? DEFAULT_PUBLIC_URL,
    protocols: options.protocols ?? ['https'],
    allowedHosts: options.allowedHosts ?? [],
    requestHistoryLimit: 200,
    openBrowserOnStart: false,
  };

  try {
    await withEnv(
      {
        PATH: `${shimBinDir}:${process.env.PATH ?? ''}`,
        GIT_CREDENTIAL_STUB_FILL_MODE: options.fillMode ?? 'ok',
        GIT_CREDENTIAL_STUB_LOG_FILE: stubLogPath,
        GIT_CRED_PROXY_SHARE_DIR: REPO_ROOT,
      },
      async () => {
        const startedApp = createServer({
          stateDir,
          config,
          tokenService: new TokenService(stateDir),
        });

        startedApp.listen({ hostname: HOST, port: 0 });

        try {
          const port = startedApp.server?.port;
          if (!port) {
            throw new Error('Failed to start Elysia test server: missing port');
          }

          const baseUrl = `http://${HOST}:${port}`;
          await waitForServerReady(`${baseUrl}/healthz`);

          await run({
            baseUrl,
            readGitStubCalls: async () => parseGitStubCalls(await readFileSafe(stubLogPath)),
          });
        } finally {
          await startedApp.stop(true);
        }
      },
    );
  } finally {
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
    return await readFile(filePath, 'utf-8');
  } catch (error) {
    if (isErrnoCode(error, 'ENOENT')) {
      return '';
    }

    throw error;
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

function escapeForDoubleQuotedShell(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function isErrnoCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
