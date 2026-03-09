import { type AdminNonceService } from '../services/admin-nonce';
import { isLoopbackAddress } from '../utils/loopback';

type RequestIpResolver = (context: Record<string, unknown>) => string | null | undefined;

export type AdminGuardOptions = {
  nonceService: AdminNonceService;
  panelOrigin: string;
  resolveIp?: RequestIpResolver;
};

export type AdminRequestCheckInput = {
  request: Request;
  ip: string | null | undefined;
  nonceService: AdminNonceService;
  panelOrigin: string;
};

export function evaluateAdminRequest({
  request,
  ip,
  nonceService,
  panelOrigin,
}: AdminRequestCheckInput): Response | null {
  if (!isLoopbackAddress(ip ?? '')) {
    return createForbiddenResponse('Admin access requires loopback');
  }

  if (request.method.toUpperCase() === 'GET') {
    return null;
  }

  if (request.headers.get('origin') !== panelOrigin) {
    return createForbiddenResponse('Admin access requires trusted Origin');
  }

  const nonce = request.headers.get('x-admin-nonce');
  if (!nonce || !nonceService.validate(nonce)) {
    return createForbiddenResponse('Admin access requires valid nonce');
  }

  return null;
}

export function createAdminGuard(options: AdminGuardOptions): { beforeHandle: (context: any) => Response | void } {
  return {
    beforeHandle(context: any): Response | void {
      const response = evaluateAdminRequest({
        request: context.request,
        ip: resolveRequestIp(context, options.resolveIp),
        nonceService: options.nonceService,
        panelOrigin: options.panelOrigin,
      });

      return response ?? undefined;
    },
  };
}

function resolveRequestIp(context: Record<string, unknown>, resolveIp?: RequestIpResolver): string | null {
  const customResolvedIp = resolveIp?.(context);
  if (typeof customResolvedIp === 'string' && customResolvedIp.trim().length > 0) {
    return customResolvedIp;
  }

  const directIp = pickStringIp(context.ip);
  if (directIp) {
    return directIp;
  }

  const server = context.server;
  const request = context.request;

  if (
    server &&
    typeof server === 'object' &&
    'requestIP' in server &&
    typeof server.requestIP === 'function' &&
    request instanceof Request
  ) {
    return pickStringIp(server.requestIP(request));
  }

  return null;
}

function pickStringIp(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  if ('address' in value && typeof value.address === 'string') {
    const trimmed = value.address.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if ('ip' in value && typeof value.ip === 'string') {
    const trimmed = value.ip.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if ('host' in value && typeof value.host === 'string') {
    const trimmed = value.host.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return null;
}

function createForbiddenResponse(error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status: 403,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  });
}
