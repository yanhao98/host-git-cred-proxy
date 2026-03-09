import { describe, expect, test } from 'bun:test';
import { constants } from 'node:fs';
import { access, chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';

import type { Config } from '../../host/src/services/config';
import { appendAuditEvent, readAuditEvents, type AuditEvent } from '../../host/src/services/request-log';
import { truncateServerLog } from '../../host/src/services/server-log';
import { TokenService } from '../../host/src/services/token';

const HEX_64_RE = /^[0-9a-f]{64}$/;
const ALLOWED_AUDIT_FIELDS = ['time', 'action', 'protocol', 'host', 'path', 'statusCode', 'outcome', 'durationMs'];

describe('TokenService', () => {
  test('creates an initial token from scratch with 64-hex format and secure file mode', async () => {
    await withTempDir('token-service-create-', async (stateDir) => {
      const tokenService = new TokenService(stateDir);
      const token = tokenService.getToken();
      const tokenPath = path.resolve(stateDir, 'token');

      expect(token).toMatch(HEX_64_RE);
      expect((await readFile(tokenPath, 'utf-8')).trim()).toBe(token);
      expect((await stat(tokenPath)).mode & 0o777).toBe(0o600);
      expect(tokenService.validateBearer(`Bearer ${token}`)).toBe(true);
    });
  });

  test('reads an existing token file and validates strict Bearer format', async () => {
    await withTempDir('token-service-existing-', async (stateDir) => {
      const existingToken = 'a'.repeat(64);
      const tokenPath = path.resolve(stateDir, 'token');

      await mkdir(stateDir, { recursive: true });
      await writeFile(tokenPath, `${existingToken}\n`, 'utf-8');
      await chmod(tokenPath, 0o600);

      const tokenService = new TokenService(stateDir);

      expect(tokenService.getToken()).toBe(existingToken);
      expect(tokenService.validateBearer(`Bearer ${existingToken}`)).toBe(true);
      expect(tokenService.validateBearer(`bearer ${existingToken}`)).toBe(false);
      expect(tokenService.validateBearer(`Bearer  ${existingToken}`)).toBe(false);
      expect(tokenService.validateBearer(`Bearer ${existingToken} trailing`)).toBe(false);
    });
  });

  test('rotates token using token.tmp + rename and immediately rejects old bearer', async () => {
    await withTempDir('token-service-rotate-', async (stateDir) => {
      const tokenService = new TokenService(stateDir);
      const oldToken = tokenService.getToken();

      const result = await tokenService.rotate();
      const newToken = tokenService.getToken();

      expect(result).toEqual({
        tokenFilePath: path.resolve(stateDir, 'token'),
      });
      expect(newToken).toMatch(HEX_64_RE);
      expect(newToken).not.toBe(oldToken);
      expect(tokenService.validateBearer(`Bearer ${oldToken}`)).toBe(false);
      expect(tokenService.validateBearer(`Bearer ${newToken}`)).toBe(true);

      const tokenPath = path.resolve(stateDir, 'token');
      const tokenTmpPath = path.resolve(stateDir, 'token.tmp');
      expect((await readFile(tokenPath, 'utf-8')).trim()).toBe(newToken);
      await expectMissingPath(tokenTmpPath);
    });
  });
});

describe('request audit logging', () => {
  test('writes and reads redacted audit events with only allowed fields and no secrets', async () => {
    await withTempDir('request-log-redacted-', async (stateDir) => {
      const event = {
        time: new Date('2026-03-09T10:00:00.000Z').toISOString(),
        action: 'fill',
        protocol: 'https',
        host: 'github.com',
        path: 'owner/repo.git',
        statusCode: 200,
        outcome: 'ok',
        durationMs: 12,
        username: 'sensitive-user',
        password: 'sensitive-pass',
        authorization: 'Bearer secret',
        oauth_token: 'sensitive-oauth-token',
        body: 'raw credential body',
      } as AuditEvent;

      await appendAuditEvent(stateDir, event, 200);

      const requestLogPath = path.resolve(stateDir, 'requests.ndjson');
      const rawLog = await readFile(requestLogPath, 'utf-8');
      const parsedLogLine = JSON.parse(rawLog.trim()) as Record<string, unknown>;

      expect(Object.keys(parsedLogLine).sort()).toEqual([...ALLOWED_AUDIT_FIELDS].sort());

      const lowerRawLog = rawLog.toLowerCase();
      expect(lowerRawLog.includes('username')).toBe(false);
      expect(lowerRawLog.includes('password')).toBe(false);
      expect(lowerRawLog.includes('authorization')).toBe(false);
      expect(lowerRawLog.includes('oauth_token')).toBe(false);

      const events = await readAuditEvents(stateDir);
      expect(events).toEqual([
        {
          time: '2026-03-09T10:00:00.000Z',
          action: 'fill',
          protocol: 'https',
          host: 'github.com',
          path: 'owner/repo.git',
          statusCode: 200,
          outcome: 'ok',
          durationMs: 12,
        },
      ]);
    });
  });

  test('trims requests.ndjson to requestHistoryLimit newest entries', async () => {
    await withTempDir('request-log-trim-', async (stateDir) => {
      const requestHistoryLimit: Config['requestHistoryLimit'] = 3;

      for (let index = 1; index <= 5; index += 1) {
        await appendAuditEvent(
          stateDir,
          {
            time: new Date(`2026-03-09T10:00:0${index}.000Z`).toISOString(),
            action: 'fill',
            protocol: 'https',
            host: 'github.com',
            path: `owner/repo-${index}.git`,
            statusCode: 200,
            outcome: 'ok',
            durationMs: index,
          },
          requestHistoryLimit,
        );
      }

      const events = await readAuditEvents(stateDir);
      expect(events).toHaveLength(3);
      expect(events.map((event) => event.path)).toEqual(['owner/repo-3.git', 'owner/repo-4.git', 'owner/repo-5.git']);

      const onlyNewestTwo = await readAuditEvents(stateDir, 2);
      expect(onlyNewestTwo.map((event) => event.path)).toEqual(['owner/repo-4.git', 'owner/repo-5.git']);
    });
  });
});

describe('server log bounding', () => {
  test('truncateServerLog keeps only the last 5 MiB when server.log grows past limit', async () => {
    await withTempDir('server-log-bound-', async (stateDir) => {
      const maxBytes = 5 * 1024 * 1024;
      const prefix = Buffer.from('drop-this-prefix-');
      const body = Buffer.alloc(maxBytes, 'b');
      const suffix = Buffer.from('-keep-tail-marker');
      const oversize = Buffer.concat([prefix, body, suffix]);
      const expectedTail = oversize.subarray(-maxBytes);
      const serverLogPath = path.resolve(stateDir, 'server.log');

      await mkdir(stateDir, { recursive: true });
      await writeFile(serverLogPath, oversize);
      await chmod(serverLogPath, 0o600);

      await truncateServerLog(stateDir);

      const bounded = await readFile(serverLogPath);
      expect(bounded.byteLength).toBe(maxBytes);
      expect(Buffer.compare(bounded, expectedTail)).toBe(0);
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

function isErrnoCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
