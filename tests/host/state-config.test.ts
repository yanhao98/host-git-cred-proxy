import { describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';

import { DEFAULT_CONFIG, loadConfig, saveConfig, type Config } from '../../host/src/services/config';
import { ensureStateFile, resolveStateDir } from '../../host/src/services/state-dir';
import { resolveShareDir, resolveUiDistDir } from '../../host/src/services/ui-assets';

describe('state dir services', () => {
  test('resolveStateDir creates state directory and ensureStateFile uses secure permissions', async () => {
    await withTempDir('host-git-cred-proxy-state-dir-', async (tmpRoot) => {
      const configuredStateDir = path.resolve(tmpRoot, 'nested', 'state');

      await withEnv(
        {
          GIT_CRED_PROXY_STATE_DIR: configuredStateDir,
        },
        async () => {
          const resolvedStateDir = resolveStateDir();
          expect(resolvedStateDir).toBe(configuredStateDir);
          expect(await modeBits(resolvedStateDir)).toBe(0o700);

          const tokenFile = ensureStateFile(resolvedStateDir, 'token');
          expect(path.resolve(tokenFile)).toBe(path.resolve(resolvedStateDir, 'token'));
          expect(await modeBits(tokenFile)).toBe(0o600);
        },
      );
    });
  });
});

describe('config services', () => {
  test('loadConfig materializes default config when config.json is missing', async () => {
    await withTempDir('host-git-cred-proxy-config-default-', async (stateDir) => {
      const config = loadConfig(stateDir);
      expect(config).toEqual(DEFAULT_CONFIG);

      const configPath = path.resolve(stateDir, 'config.json');
      const saved = await readFile(configPath, 'utf-8');

      expect(JSON.parse(saved)).toEqual(DEFAULT_CONFIG);
      expect(await modeBits(configPath)).toBe(0o600);
    });
  });

  test('loadConfig normalizes case, duplicates, whitespace, and invalid values', async () => {
    await withTempDir('host-git-cred-proxy-config-normalize-', async (stateDir) => {
      const configPath = path.resolve(stateDir, 'config.json');
      await mkdir(stateDir, { recursive: true });
      await writeFile(
        configPath,
        `${JSON.stringify(
          {
            host: ' 0.0.0.0  ',
            port: '19090',
            publicUrl: '   https://example.test:19090/path  ',
            protocols: [' HTTPS ', 'https', '', 'http', 'HTTP'],
            allowedHosts: [' EXAMPLE.com ', 'example.com', '  ', 'GitHub.com'],
            requestHistoryLimit: 0,
            openBrowserOnStart: 'true',
          },
          null,
          2,
        )}\n`,
      );
      await chmod(configPath, 0o600);

      const config = loadConfig(stateDir);

      expect(config).toEqual({
        host: '0.0.0.0',
        port: 19090,
        publicUrl: 'https://example.test:19090/path',
        protocols: ['https', 'http'],
        allowedHosts: ['example.com', 'github.com'],
        requestHistoryLimit: 200,
        openBrowserOnStart: false,
      });
    });
  });

  test('loadConfig applies env var overrides on top of config.json', async () => {
    await withTempDir('host-git-cred-proxy-config-env-', async (stateDir) => {
      const configPath = path.resolve(stateDir, 'config.json');
      await mkdir(stateDir, { recursive: true });
      await writeFile(
        configPath,
        `${JSON.stringify(
          {
            host: '127.0.0.1',
            port: 18765,
            publicUrl: 'http://host.docker.internal:18765',
            protocols: ['https'],
            allowedHosts: [],
            requestHistoryLimit: 120,
            openBrowserOnStart: false,
          },
          null,
          2,
        )}\n`,
      );

      await withEnv(
        {
          GIT_CRED_PROXY_HOST: ' 0.0.0.0 ',
          GIT_CRED_PROXY_PORT: '30001',
          GIT_CRED_PROXY_PUBLIC_URL: ' https://proxy.example.test:30001 ',
          GIT_CRED_PROXY_PROTOCOLS: 'HTTPS,http,,https',
          GIT_CRED_PROXY_ALLOWED_HOSTS: 'Example.com,  foo.internal,example.com,',
        },
        async () => {
          const config = loadConfig(stateDir);

          expect(config).toEqual({
            host: '0.0.0.0',
            port: 30001,
            publicUrl: 'https://proxy.example.test:30001',
            protocols: ['https', 'http'],
            allowedHosts: ['example.com', 'foo.internal'],
            requestHistoryLimit: 120,
            openBrowserOnStart: false,
          });
        },
      );
    });
  });

  test('saveConfig/loadConfig round-trip preserves normalized values with pretty JSON', async () => {
    await withTempDir('host-git-cred-proxy-config-roundtrip-', async (stateDir) => {
      const input: Config = {
        host: ' 0.0.0.0 ',
        port: 29999,
        publicUrl: ' https://roundtrip.example.test:29999 ',
        protocols: ['HTTPS', 'https', 'http'],
        allowedHosts: [' Example.com ', 'example.com', 'Foo.internal'],
        requestHistoryLimit: 17,
        openBrowserOnStart: true,
      };

      saveConfig(stateDir, input);

      const configPath = path.resolve(stateDir, 'config.json');
      const saved = await readFile(configPath, 'utf-8');

      expect(saved.startsWith('{\n  "host":')).toBe(true);
      expect(saved.endsWith('\n')).toBe(true);

      const loaded = loadConfig(stateDir);
      expect(loaded).toEqual({
        host: '0.0.0.0',
        port: 29999,
        publicUrl: 'https://roundtrip.example.test:29999',
        protocols: ['https', 'http'],
        allowedHosts: ['example.com', 'foo.internal'],
        requestHistoryLimit: 17,
        openBrowserOnStart: true,
      });
    });
  });
});

describe('UI asset resolution services', () => {
  test('resolves packaged assets from installed bin/share layout', async () => {
    await withTempDir('host-git-cred-proxy-packaged-assets-', async (tmpRoot) => {
      const fakeExecPath = path.resolve(tmpRoot, 'bin', 'host-git-cred-proxy');
      const expectedShareDir = path.resolve(tmpRoot, 'share', 'host-git-cred-proxy');
      const expectedUiDir = path.resolve(expectedShareDir, 'ui');
      const containerDir = path.resolve(expectedShareDir, 'container');

      await mkdir(path.dirname(fakeExecPath), { recursive: true });
      await writeFile(fakeExecPath, '#!/bin/sh\n', { mode: 0o755 });
      await mkdir(expectedUiDir, { recursive: true });
      await mkdir(containerDir, { recursive: true });

      await withEnv(
        {
          GIT_CRED_PROXY_SHARE_DIR: undefined,
        },
        async () => {
          await withExecPath(fakeExecPath, async () => {
            expect(resolveShareDir()).toBe(expectedShareDir);
            expect(resolveUiDistDir()).toBe(expectedUiDir);
          });
        },
      );
    });
  });

  test('resolves dev assets from repo-relative fallback', async () => {
    await withTempDir('host-git-cred-proxy-dev-assets-', async (tmpRoot) => {
      const missingExecPath = path.resolve(tmpRoot, 'bin', 'host-git-cred-proxy');
      const expectedRepoRoot = path.resolve(import.meta.dir, '..', '..');

      await withEnv(
        {
          GIT_CRED_PROXY_SHARE_DIR: undefined,
        },
        async () => {
          await withExecPath(missingExecPath, async () => {
            expect(resolveShareDir()).toBe(expectedRepoRoot);
            expect(resolveUiDistDir()).toBe(path.resolve(expectedRepoRoot, 'host', 'ui', 'dist'));
          });
        },
      );
    });
  });

  test('throws clear error when share dir override does not contain assets', async () => {
    await withTempDir('host-git-cred-proxy-no-assets-', async (tmpRoot) => {
      await withEnv(
        {
          GIT_CRED_PROXY_SHARE_DIR: tmpRoot,
        },
        async () => {
          expect(() => resolveShareDir()).toThrow(/Invalid GIT_CRED_PROXY_SHARE_DIR path/i);
        },
      );
    });
  });
});

async function withTempDir(prefix: string, run: (tempDir: string) => Promise<void>): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), prefix));

  try {
    await run(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function modeBits(filePath: string): Promise<number> {
  const entry = await stat(filePath);
  return entry.mode & 0o777;
}

async function withExecPath(nextExecPath: string, run: () => Promise<void>): Promise<void> {
  const originalExecPath = process.execPath;

  process.execPath = nextExecPath;
  try {
    await run();
  } finally {
    process.execPath = originalExecPath;
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
