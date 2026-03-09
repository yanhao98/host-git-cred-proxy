import { Elysia } from 'elysia';

const DEFAULT_PORT = Number(process.env.PORT ?? 18765);

export const createServer = () => new Elysia().get('/healthz', () => 'ok');

export const startServer = (port = DEFAULT_PORT) => createServer().listen(port);

if (import.meta.main) {
  const app = startServer();
  const port = app.server?.port ?? DEFAULT_PORT;
  console.log(`host service listening at http://127.0.0.1:${port}`);
}
