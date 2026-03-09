import { statSync } from 'node:fs';
import path from 'node:path';

const SHARE_DIR_ENV = 'GIT_CRED_PROXY_SHARE_DIR';

export function resolveShareDir(): string {
  const envShareDir = process.env[SHARE_DIR_ENV]?.trim();

  if (envShareDir) {
    const resolvedEnvShareDir = path.resolve(envShareDir);
    if (isPackagedLayout(resolvedEnvShareDir) || isDevLayout(resolvedEnvShareDir)) {
      return resolvedEnvShareDir;
    }

    throw new Error(
      `Invalid ${SHARE_DIR_ENV} path: ${resolvedEnvShareDir}. Expected packaged layout (ui/ + container/) or dev layout (host/ui/dist + container/).`,
    );
  }

  const installedShareDir = path.resolve(path.dirname(process.execPath), '..', 'share', 'host-git-cred-proxy');
  if (isPackagedLayout(installedShareDir)) {
    return installedShareDir;
  }

  const repoRoot = path.resolve(import.meta.dir, '..', '..', '..');
  if (isDevLayout(repoRoot)) {
    return repoRoot;
  }

  throw new Error(
    [
      'Unable to resolve host-git-cred-proxy assets.',
      `Checked installed share dir: ${installedShareDir}`,
      `Checked repo dev layout root: ${repoRoot}`,
      `Set ${SHARE_DIR_ENV} to override.`,
    ].join(' '),
  );
}

export function resolveUiDistDir(): string {
  const shareDir = resolveShareDir();

  if (isPackagedLayout(shareDir)) {
    return path.resolve(shareDir, 'ui');
  }

  if (isDevLayout(shareDir)) {
    return path.resolve(shareDir, 'host', 'ui', 'dist');
  }

  throw new Error(
    `Resolved share directory does not contain UI assets: ${shareDir}. Expected packaged layout (ui/) or dev layout (host/ui/dist).`,
  );
}

function isPackagedLayout(baseDir: string): boolean {
  return isDirectory(path.resolve(baseDir, 'ui')) && isDirectory(path.resolve(baseDir, 'container'));
}

function isDevLayout(repoRoot: string): boolean {
  return (
    isDirectory(path.resolve(repoRoot, 'host', 'ui', 'dist')) && isDirectory(path.resolve(repoRoot, 'container'))
  );
}

function isDirectory(targetPath: string): boolean {
  try {
    return statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}
