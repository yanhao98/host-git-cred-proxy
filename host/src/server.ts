import { Elysia } from 'elysia';

import { createAdminGuard } from './middleware/admin-guard';
import { createContainerRoutes } from './routes/container';
import { createProxyRoutes } from './routes/proxy';
import { AdminNonceService } from './services/admin-nonce';
import { loadConfig, type Config } from './services/config';
import { resolveStateDir } from './services/state-dir';
import { TokenService } from './services/token';

const CONTENT_TYPE_TEXT = 'text/plain; charset=utf-8';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 18765;

type ServerServices = {
  stateDir: string;
  config: Config;
  tokenService: TokenService;
  adminNonceService: AdminNonceService;
};

export type CreateServerOptions = {
  stateDir?: string;
  config?: Config;
  tokenService?: TokenService;
  adminNonceService?: AdminNonceService;
};

export type StartServerOptions = CreateServerOptions & {
  host?: string;
  port?: number;
};

export const createServer = (options: CreateServerOptions = {}) => {
  const services = initializeServerServices(options);
  const panelOrigin = new URL(services.config.publicUrl).origin;
  const adminGuard = createAdminGuard({
    nonceService: services.adminNonceService,
    panelOrigin,
  });

  return new Elysia()
    .use(
      createProxyRoutes({
        tokenService: services.tokenService,
        config: services.config,
        stateDir: services.stateDir,
      }),
    )
    .use(
      createContainerRoutes({
        config: services.config,
      }),
    )
    .all(
      '/api/admin/*',
      () => {
        return new Response('Not Found\n', {
          status: 404,
          headers: {
            'content-type': CONTENT_TYPE_TEXT,
          },
        });
      },
      {
        beforeHandle: adminGuard.beforeHandle,
      },
    );
};

export const startServer = (options: number | StartServerOptions = {}) => {
  const normalizedOptions = typeof options === 'number' ? { port: options } : options;
  const services = initializeServerServices(normalizedOptions);

  const host = normalizedOptions.host ?? services.config.host ?? DEFAULT_HOST;
  const port = normalizedOptions.port ?? services.config.port ?? DEFAULT_PORT;

  return createServer({
    stateDir: services.stateDir,
    config: services.config,
    tokenService: services.tokenService,
    adminNonceService: services.adminNonceService,
  }).listen({
    hostname: host,
    port,
  });
};

function initializeServerServices(options: CreateServerOptions): ServerServices {
  const stateDir = options.stateDir ?? resolveStateDir();
  const config = options.config ?? loadConfig(stateDir);

  return {
    stateDir,
    config,
    tokenService: options.tokenService ?? new TokenService(stateDir),
    adminNonceService: options.adminNonceService ?? new AdminNonceService(),
  };
}

if (import.meta.main) {
  const app = startServer();
  const host = app.server?.hostname ?? DEFAULT_HOST;
  const port = app.server?.port ?? DEFAULT_PORT;
  console.log(`host service listening at http://${host}:${port}`);
}
