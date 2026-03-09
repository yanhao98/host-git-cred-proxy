import { Elysia } from 'elysia';

import { createAdminGuard } from './middleware/admin-guard';
import { createAdminRoutes } from './routes/admin';
import { createContainerRoutes } from './routes/container';
import { createProxyRoutes } from './routes/proxy';
import { createUiRoutes } from './routes/ui';
import { AdminNonceService } from './services/admin-nonce';
import { loadConfig, type Config } from './services/config';
import { resolveStateDir } from './services/state-dir';
import { TokenService } from './services/token';

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
  const panelOrigin = resolvePanelOrigin(services.config);
  const adminGuard = createAdminGuard({
    nonceService: services.adminNonceService,
    panelOrigin,
  });

  const app = new Elysia()
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
    .use(
      createAdminRoutes(
        {
          stateDir: services.stateDir,
          config: services.config,
          tokenService: services.tokenService,
          adminNonceService: services.adminNonceService,
          getServerInstance: () => app,
        },
        {
          beforeHandle: adminGuard.beforeHandle,
        },
      ),
    )
    .use(createUiRoutes());

  return app;
};

export const startServer = (options: number | StartServerOptions = {}) => {
  const normalizedOptions = typeof options === 'number' ? { port: options } : options;
  const services = initializeServerServices(normalizedOptions);

  const host = normalizedOptions.host ?? services.config.host ?? DEFAULT_HOST;
  const port = normalizedOptions.port ?? services.config.port ?? DEFAULT_PORT;
  const runtimeConfig: Config = {
    ...services.config,
    host,
    port,
  };

  return createServer({
    stateDir: services.stateDir,
    config: runtimeConfig,
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

function resolvePanelOrigin(config: Config): string {
  return `http://${config.host}:${config.port}`;
}

if (import.meta.main) {
  const app = startServer();
  const host = app.server?.hostname ?? DEFAULT_HOST;
  const port = app.server?.port ?? DEFAULT_PORT;
  console.log(`host service listening at http://${host}:${port}`);
}
