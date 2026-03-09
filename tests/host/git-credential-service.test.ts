import { describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Config } from '../../host/src/services/config';
import {
  ACTION_MAP,
  MAX_BODY_SIZE,
  handleCredentialRequest,
  parseCredentialBody,
} from '../../host/src/services/git-credential';

const GIT_STUB_SCRIPT = fileURLToPath(new URL('../fixtures/git-credential-stub.sh', import.meta.url));

type GitStubCall = {
  action: string;
  terminalPrompt: string;
};

type WithGitCredentialStubOptions = {
  fillMode?: string;
};

type StubHarness = {
  readGitStubCalls: () => Promise<GitStubCall[]>;
};

describe('git credential service', () => {
  test('exports MAX_BODY_SIZE as 64 KiB', () => {
    expect(MAX_BODY_SIZE).toBe(64 * 1024);
  });

  test('parseCredentialBody keeps key=value pairs and splits on first equals', () => {
    const parsed = parseCredentialBody(
      ['protocol=https', 'host=github.com', 'username=stub=user', 'line-without-equals', '', 'password=secret'].join(
        '\n',
      ),
    );

    expect(parsed).toEqual({
      protocol: 'https',
      host: 'github.com',
      username: 'stub=user',
      password: 'secret',
    });
  });

  test('ACTION_MAP keeps legacy and canonical action mapping', () => {
    expect([...ACTION_MAP.entries()]).toEqual([
      ['get', 'fill'],
      ['store', 'approve'],
      ['erase', 'reject'],
      ['fill', 'fill'],
      ['approve', 'approve'],
      ['reject', 'reject'],
    ]);
  });

  test('happy path: fill returns credentials; approve/reject return empty', async () => {
    await withGitCredentialStub({}, async ({ readGitStubCalls }) => {
      const fill = await handleCredentialRequest({
        action: 'fill',
        body: credentialBody(),
        config: createConfig(),
      });

      expect(fill.status).toBe(200);
      expect(fill.outcome).toBe('ok');
      expect(fill.body).toContain('username=stub-user');
      expect(fill.body).toContain('password=stub-pass');

      const approve = await handleCredentialRequest({
        action: 'approve',
        body: credentialBody(),
        config: createConfig(),
      });

      expect(approve.status).toBe(200);
      expect(approve.outcome).toBe('ok');
      expect(approve.body).toBe('');

      const reject = await handleCredentialRequest({
        action: 'reject',
        body: credentialBody(),
        config: createConfig(),
      });

      expect(reject.status).toBe(200);
      expect(reject.outcome).toBe('ok');
      expect(reject.body).toBe('');

      expect(await readGitStubCalls()).toEqual([
        { action: 'fill', terminalPrompt: '0' },
        { action: 'approve', terminalPrompt: '0' },
        { action: 'reject', terminalPrompt: '0' },
      ]);
    });
  });

  test('action mapping: get->fill, store->approve, erase->reject', async () => {
    await withGitCredentialStub({}, async ({ readGitStubCalls }) => {
      const get = await handleCredentialRequest({
        action: 'get',
        body: credentialBody(),
        config: createConfig(),
      });

      const store = await handleCredentialRequest({
        action: 'store',
        body: credentialBody(),
        config: createConfig(),
      });

      const erase = await handleCredentialRequest({
        action: 'erase',
        body: credentialBody(),
        config: createConfig(),
      });

      expect(get.status).toBe(200);
      expect(get.outcome).toBe('ok');
      expect(get.body).toContain('username=stub-user');

      expect(store.status).toBe(200);
      expect(store.outcome).toBe('ok');
      expect(store.body).toBe('');

      expect(erase.status).toBe(200);
      expect(erase.outcome).toBe('ok');
      expect(erase.body).toBe('');

      expect((await readGitStubCalls()).map((call) => call.action)).toEqual(['fill', 'approve', 'reject']);
    });
  });

  test('protocol whitelist: missing protocol -> 400, disallowed protocol -> 403', async () => {
    await withGitCredentialStub({}, async ({ readGitStubCalls }) => {
      const missingProtocol = await handleCredentialRequest({
        action: 'fill',
        body: credentialBody({ protocol: undefined }),
        config: createConfig({ protocols: ['https'] }),
      });

      expect(missingProtocol).toMatchObject({
        status: 400,
        body: 'Missing protocol\n',
        outcome: 'bad_request',
      });

      const disallowedProtocol = await handleCredentialRequest({
        action: 'fill',
        body: credentialBody({ protocol: 'http' }),
        config: createConfig({ protocols: ['https'] }),
      });

      expect(disallowedProtocol).toMatchObject({
        status: 403,
        body: 'Protocol not allowed\n',
        outcome: 'denied',
      });

      expect(await readGitStubCalls()).toEqual([]);
    });
  });

  test('host whitelist: disallowed host -> 403; empty allowlist passes through', async () => {
    await withGitCredentialStub({}, async ({ readGitStubCalls }) => {
      const denied = await handleCredentialRequest({
        action: 'fill',
        body: credentialBody({ host: 'gitlab.com' }),
        config: createConfig({ allowedHosts: ['github.com'] }),
      });

      expect(denied).toMatchObject({
        status: 403,
        body: 'Host not allowed\n',
        outcome: 'denied',
      });

      const allowed = await handleCredentialRequest({
        action: 'fill',
        body: credentialBody({ host: 'gitlab.com' }),
        config: createConfig({ allowedHosts: [] }),
      });

      expect(allowed.status).toBe(200);
      expect(allowed.outcome).toBe('ok');

      expect(await readGitStubCalls()).toEqual([{ action: 'fill', terminalPrompt: '0' }]);
    });
  });

  const missingCredentialModes: Array<[string, string]> = [
    ['missing-terminal-prompts', 'terminal prompts disabled'],
    ['missing-username', 'could not read username'],
    ['missing-password', 'could not read password'],
  ];

  for (const [fillMode, stderrSignature] of missingCredentialModes) {
    test(`missing credential compatibility (${stderrSignature}) returns 200 + empty`, async () => {
      await withGitCredentialStub({ fillMode }, async ({ readGitStubCalls }) => {
        const result = await handleCredentialRequest({
          action: 'fill',
          body: credentialBody(),
          config: createConfig(),
        });

        expect(result).toMatchObject({
          status: 200,
          body: '',
          outcome: 'empty',
        });
        expect(await readGitStubCalls()).toEqual([{ action: 'fill', terminalPrompt: '0' }]);
      });
    });
  }

  test('unknown action returns 404 Not Found without invoking git subprocess', async () => {
    await withGitCredentialStub({}, async ({ readGitStubCalls }) => {
      const result = await handleCredentialRequest({
        action: 'unknown',
        body: credentialBody(),
        config: createConfig(),
      });

      expect(result).toMatchObject({
        status: 404,
        body: 'Not Found\n',
        outcome: 'bad_request',
      });
      expect(await readGitStubCalls()).toEqual([]);
    });
  });

  test('GIT_TERMINAL_PROMPT=0 is always set for git credential subprocess', async () => {
    await withGitCredentialStub({}, async ({ readGitStubCalls }) => {
      await handleCredentialRequest({
        action: 'fill',
        body: credentialBody(),
        config: createConfig(),
      });
      await handleCredentialRequest({
        action: 'approve',
        body: credentialBody(),
        config: createConfig(),
      });
      await handleCredentialRequest({
        action: 'reject',
        body: credentialBody(),
        config: createConfig(),
      });

      const calls = await readGitStubCalls();
      expect(calls).toHaveLength(3);
      expect(calls.map((call) => call.terminalPrompt)).toEqual(['0', '0', '0']);
    });
  });

  test('outcome mapping covers ok, empty, denied, bad_request, and error', async () => {
    await withGitCredentialStub({}, async () => {
      const ok = await handleCredentialRequest({
        action: 'fill',
        body: credentialBody(),
        config: createConfig(),
      });

      const denied = await handleCredentialRequest({
        action: 'fill',
        body: credentialBody({ protocol: 'http' }),
        config: createConfig({ protocols: ['https'] }),
      });

      const badRequest = await handleCredentialRequest({
        action: 'unknown',
        body: credentialBody(),
        config: createConfig(),
      });

      expect(ok.outcome).toBe('ok');
      expect(denied.outcome).toBe('denied');
      expect(badRequest.outcome).toBe('bad_request');
    });

    await withGitCredentialStub({ fillMode: 'missing-password' }, async () => {
      const empty = await handleCredentialRequest({
        action: 'fill',
        body: credentialBody(),
        config: createConfig(),
      });

      expect(empty.outcome).toBe('empty');
    });

    await withGitCredentialStub({ fillMode: 'definitely-a-non-missing-error' }, async () => {
      const error = await handleCredentialRequest({
        action: 'fill',
        body: credentialBody(),
        config: createConfig(),
      });

      expect(error.status).toBe(502);
      expect(error.outcome).toBe('error');
      expect(error.body).toBe('definitely-a-non-missing-error\n');
    });
  });
});

function createConfig(overrides: Partial<Pick<Config, 'protocols' | 'allowedHosts'>> = {}): Config {
  return {
    host: '127.0.0.1',
    port: 18765,
    publicUrl: 'http://host.docker.internal:18765',
    protocols: ['https'],
    allowedHosts: [],
    requestHistoryLimit: 200,
    openBrowserOnStart: false,
    ...overrides,
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

async function withGitCredentialStub(
  options: WithGitCredentialStubOptions,
  run: (harness: StubHarness) => Promise<void>,
): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), 'git-credential-service-'));
  const shimBinDir = join(tempRoot, 'bin');
  const shimGitPath = join(shimBinDir, 'git');
  const stubLogPath = join(tempRoot, 'git-credential-calls.log');

  await mkdir(shimBinDir, { recursive: true });
  await writeFile(
    shimGitPath,
    `#!/usr/bin/env bash\nexec bash "${escapeForDoubleQuotedShell(GIT_STUB_SCRIPT)}" "$@"\n`,
  );
  await chmod(shimGitPath, 0o755);

  try {
    await withEnv(
      {
        PATH: `${shimBinDir}:${process.env.PATH ?? ''}`,
        GIT_CREDENTIAL_STUB_FILL_MODE: options.fillMode ?? 'ok',
        GIT_CREDENTIAL_STUB_LOG_FILE: stubLogPath,
      },
      async () => {
        await run({
          readGitStubCalls: async () => parseGitStubCalls(await readFileSafe(stubLogPath)),
        });
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
