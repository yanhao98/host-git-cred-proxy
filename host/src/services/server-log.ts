import { readFile, stat, writeFile } from 'node:fs/promises';

import { ensureStateFile } from './state-dir';

const SERVER_LOG_FILE_NAME = 'server.log';
const DEFAULT_MAX_SERVER_LOG_BYTES = 5 * 1024 * 1024;

export async function truncateServerLog(
  stateDir: string,
  maxBytes = DEFAULT_MAX_SERVER_LOG_BYTES,
): Promise<void> {
  const serverLogPath = ensureStateFile(stateDir, SERVER_LOG_FILE_NAME);
  const normalizedMaxBytes = Number.isInteger(maxBytes) && maxBytes >= 0 ? maxBytes : DEFAULT_MAX_SERVER_LOG_BYTES;

  const currentStat = await stat(serverLogPath);
  if (currentStat.size <= normalizedMaxBytes) {
    return;
  }

  const content = await readFile(serverLogPath);
  const start = normalizedMaxBytes === 0 ? content.length : Math.max(content.length - normalizedMaxBytes, 0);
  const boundedContent = content.subarray(start);

  await writeFile(serverLogPath, boundedContent);
}
