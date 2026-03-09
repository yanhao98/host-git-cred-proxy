import { chmodSync, closeSync, mkdirSync, openSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import path from 'node:path';

const STATE_DIR_MODE = 0o700;
const STATE_FILE_MODE = 0o600;
const APP_NAME = 'host-git-cred-proxy';

export const STATE_FILES = [
  'config.json',
  'token',
  'server.pid',
  'server.log',
  'requests.ndjson',
  'runtime.json',
] as const;

export function resolveStateDir(): string {
  const envStateDir = process.env.GIT_CRED_PROXY_STATE_DIR;
  const stateDir = envStateDir && envStateDir.trim().length > 0 ? path.resolve(envStateDir.trim()) : defaultStateDir();

  mkdirSync(stateDir, {
    recursive: true,
    mode: STATE_DIR_MODE,
  });
  chmodSync(stateDir, STATE_DIR_MODE);

  return stateDir;
}

export function ensureStateFile(stateDir: string, filename: string): string {
  const filePath = path.resolve(stateDir, filename);
  mkdirSync(path.dirname(filePath), {
    recursive: true,
    mode: STATE_DIR_MODE,
  });

  const fileDescriptor = openSync(filePath, 'a', STATE_FILE_MODE);
  closeSync(fileDescriptor);
  chmodSync(filePath, STATE_FILE_MODE);

  return filePath;
}

function defaultStateDir(): string {
  if (platform() === 'darwin') {
    return path.resolve(homedir(), 'Library', 'Application Support', APP_NAME);
  }

  return path.resolve(homedir(), '.local', 'state', APP_NAME);
}
