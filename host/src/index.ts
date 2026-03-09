import { runCli } from './cli';

export const WORKSPACE_VERSION = '0.1.0';

if (import.meta.main) {
  const exitCode = await runCli(process.argv);
  process.exitCode = exitCode;
}
