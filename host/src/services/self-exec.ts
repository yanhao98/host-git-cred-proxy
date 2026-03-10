import path from 'node:path';

const PROCESS_COMMANDS = new Set(['serve', 'start', 'stop', 'status', 'open', 'rotate-token']);

export function resolveCliEntrypoint(entrypoint?: string): string {
  const candidate = entrypoint?.trim() || process.argv[1]?.trim();

  if (candidate && !PROCESS_COMMANDS.has(candidate) && !candidate.includes('$bunfs')) {
    return path.resolve(candidate);
  }

  return path.resolve(process.execPath);
}

export function resolveServeSpawnArgs(entrypoint: string): string[] {
  const resolvedEntrypoint = path.resolve(entrypoint);
  if (resolvedEntrypoint === path.resolve(process.execPath)) {
    return [resolvedEntrypoint, 'serve'];
  }

  return ['bun', 'run', resolvedEntrypoint, 'serve'];
}
