import { describe, expect, test } from 'bun:test';

import { createAdminGuard } from '../../host/src/middleware/admin-guard';
import { AdminNonceService } from '../../host/src/services/admin-nonce';
import { isLoopbackAddress, normalizeAddress } from '../../host/src/utils/loopback';

const PANEL_ORIGIN = 'http://127.0.0.1:18765';

describe('loopback utilities', () => {
  test('normalizeAddress strips IPv4-mapped IPv6 prefix', () => {
    expect(normalizeAddress('::ffff:127.0.0.1')).toBe('127.0.0.1');
  });

  test('isLoopbackAddress accepts IPv4 and IPv6 loopback forms', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('127.8.9.10')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('0:0:0:0:0:0:0:1')).toBe(true);
  });

  test('isLoopbackAddress rejects non-loopback addresses', () => {
    expect(isLoopbackAddress('192.168.1.1')).toBe(false);
    expect(isLoopbackAddress('10.0.0.1')).toBe(false);
  });
});

describe('AdminNonceService', () => {
  test('generates, validates, and refreshes an in-memory nonce', () => {
    const nonceService = new AdminNonceService();
    const initialNonce = nonceService.getNonce();

    expect(initialNonce).toMatch(/^[0-9a-f]{64}$/);
    expect(nonceService.validate(initialNonce)).toBe(true);

    const refreshedNonce = nonceService.refresh();

    expect(refreshedNonce).toMatch(/^[0-9a-f]{64}$/);
    expect(refreshedNonce).not.toBe(initialNonce);
    expect(nonceService.validate(initialNonce)).toBe(false);
    expect(nonceService.validate(refreshedNonce)).toBe(true);
  });
});

describe('createAdminGuard', () => {
  test('allows loopback GET requests without origin or nonce', () => {
    const guard = createGuard();

    const response = guard.beforeHandle(createContext({
      method: 'GET',
      ip: '127.0.0.1',
      headers: {
        origin: 'http://untrusted.example',
      },
    }));

    expect(response).toBeUndefined();
  });

  test('denies non-loopback requests', async () => {
    const guard = createGuard();

    const response = guard.beforeHandle(
      createContext({
        method: 'GET',
        ip: '192.168.1.1',
      }),
    );

    await expectForbidden(response, 'Admin access requires loopback');
  });

  test('allows non-GET requests with loopback, matching Origin, and valid nonce', () => {
    const nonceService = new AdminNonceService();
    const guard = createGuard(nonceService);

    const response = guard.beforeHandle(
      createContext({
        method: 'POST',
        ip: '::ffff:127.0.0.1',
        headers: {
          origin: PANEL_ORIGIN,
          'x-admin-nonce': nonceService.getNonce(),
        },
      }),
    );

    expect(response).toBeUndefined();
  });

  test('denies non-GET requests with missing or wrong Origin', async () => {
    const nonceService = new AdminNonceService();
    const guard = createGuard(nonceService);

    const missingOriginResponse = guard.beforeHandle(
      createContext({
        method: 'POST',
        ip: '127.0.0.1',
        headers: {
          'x-admin-nonce': nonceService.getNonce(),
        },
      }),
    );

    await expectForbidden(missingOriginResponse, 'Admin access requires trusted Origin');

    const wrongOriginResponse = guard.beforeHandle(
      createContext({
        method: 'POST',
        ip: '127.0.0.1',
        headers: {
          origin: 'http://evil.example',
          'x-admin-nonce': nonceService.getNonce(),
        },
      }),
    );

    await expectForbidden(wrongOriginResponse, 'Admin access requires trusted Origin');
  });

  test('denies non-GET requests with missing or wrong nonce', async () => {
    const nonceService = new AdminNonceService();
    const guard = createGuard(nonceService);

    const missingNonceResponse = guard.beforeHandle(
      createContext({
        method: 'POST',
        ip: '127.0.0.1',
        headers: {
          origin: PANEL_ORIGIN,
        },
      }),
    );

    await expectForbidden(missingNonceResponse, 'Admin access requires valid nonce');

    const wrongNonceResponse = guard.beforeHandle(
      createContext({
        method: 'POST',
        ip: '127.0.0.1',
        headers: {
          origin: PANEL_ORIGIN,
          'x-admin-nonce': 'wrong-nonce',
        },
      }),
    );

    await expectForbidden(wrongNonceResponse, 'Admin access requires valid nonce');
  });

  test('uses server.requestIP when no custom resolver is provided', () => {
    const nonceService = new AdminNonceService();
    const guard = createAdminGuard({
      nonceService,
      panelOrigin: PANEL_ORIGIN,
    });

    const response = guard.beforeHandle({
      request: new Request('http://localhost/api/admin/status', {
        method: 'GET',
      }),
      server: {
        requestIP() {
          return {
            address: '0:0:0:0:0:0:0:1',
          };
        },
      },
    });

    expect(response).toBeUndefined();
  });
});

function createGuard(nonceService = new AdminNonceService()) {
  return createAdminGuard({
    nonceService,
    panelOrigin: PANEL_ORIGIN,
    resolveIp: (context) => {
      return typeof context.ip === 'string' ? context.ip : null;
    },
  });
}

function createContext({
  method,
  ip,
  headers,
}: {
  method: string;
  ip: string;
  headers?: Record<string, string>;
}) {
  return {
    request: new Request('http://localhost/api/admin/status', {
      method,
      headers,
    }),
    ip,
  };
}

async function expectForbidden(response: Response | void, expectedError: string): Promise<void> {
  expect(response).toBeInstanceOf(Response);

  const deniedResponse = response as Response;

  expect(deniedResponse.status).toBe(403);
  expect(deniedResponse.headers.has('access-control-allow-origin')).toBe(false);
  expect(deniedResponse.headers.has('access-control-allow-methods')).toBe(false);
  expect(await deniedResponse.json()).toEqual({
    error: expectedError,
  });
}
