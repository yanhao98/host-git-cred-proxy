import { afterEach, describe, expect, test } from 'bun:test';
import { appendFile, cp, mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dir, '..', '..');
const releasesDir = path.resolve(repoRoot, 'dist', 'releases');
const evidenceDir = path.resolve(repoRoot, '.sisyphus', 'evidence');
const successEvidencePath = path.resolve(evidenceDir, 'task-18-package-release.txt');
const errorEvidencePath = path.resolve(evidenceDir, 'task-18-package-release-error.txt');
const releaseTargetsEnv = 'HOST_GIT_CRED_PROXY_RELEASE_TARGETS';

const allReleaseTargets = [
  {
    archiveName: 'host-git-cred-proxy-darwin-arm64.tar.gz',
    id: 'darwin-arm64',
    expectedCpuType: 0x0100000c,
    expectedArchLabel: 'arm64',
  },
  {
    archiveName: 'host-git-cred-proxy-darwin-x64.tar.gz',
    id: 'darwin-x64',
    expectedCpuType: 0x01000007,
    expectedArchLabel: 'x64',
  },
] as const;

const tempDirs = new Set<string>();

describe('release tarball smoke', () => {
  afterEach(async () => {
    for (const tempDir of tempDirs) {
      await rm(tempDir, { recursive: true, force: true });
      tempDirs.delete(tempDir);
    }
  });

  test('release tarballs are structurally correct and runnable', async () => {
    await resetEvidence(successEvidencePath, 'task-18-package-release');
    const releaseTargets = resolveReleaseTargets(process.env[releaseTargetsEnv]);

    for (const target of releaseTargets) {
      const archivePath = path.resolve(releasesDir, target.archiveName);
      const extractDir = await createTempDir('host-git-cred-proxy-release-smoke-');

      await appendEvidence(successEvidencePath, `CHECK_ARCHIVE ${archivePath}`);
      await extractArchive(archivePath, extractDir);
      await validateExtractedLayout(extractDir, target.expectedCpuType, target.expectedArchLabel, successEvidencePath);

      if (process.platform === 'darwin') {
        await smokeExtractedBinary(extractDir, successEvidencePath);
      } else {
        await appendEvidence(successEvidencePath, `SKIPPED_RUNTIME_SMOKE_REQUIRES_MACOS ${process.platform}`);
      }
    }
  });

  test('missing share assets fail loudly', async () => {
    await resetEvidence(errorEvidencePath, 'task-18-package-release-error');
    const releaseTargets = resolveReleaseTargets(process.env[releaseTargetsEnv]);

    if (process.platform !== 'darwin') {
      await appendEvidence(errorEvidencePath, `SKIPPED_MISSING_ASSET_RUNTIME_CHECK_REQUIRES_MACOS ${process.platform}`);
      expect(true).toBe(true);
      return;
    }

    const target = releaseTargets[0];
    const archivePath = path.resolve(releasesDir, target.archiveName);
    const extractDir = await createTempDir('host-git-cred-proxy-release-broken-');

    await extractArchive(archivePath, extractDir);
    await verifyMissingAssetsFailLoudly(extractDir, errorEvidencePath);
  });
});

async function validateExtractedLayout(
  extractDir: string,
  expectedCpuType: number,
  expectedArchLabel: string,
  evidencePath: string,
): Promise<void> {
  const binaryPath = path.resolve(extractDir, 'bin', 'host-git-cred-proxy');
  const uiDir = path.resolve(extractDir, 'share', 'host-git-cred-proxy', 'ui');
  const containerTargetDir = path.resolve(extractDir, 'share', 'host-git-cred-proxy', 'container');
  const binaryBytes = Buffer.from(await readFile(binaryPath));

  expect(binaryBytes.length).toBeGreaterThan(8);
  expect(readMachCpuType(binaryBytes)).toBe(expectedCpuType);
  expect(await readdir(uiDir)).toContain('index.html');
  expect(await readdir(containerTargetDir)).toContain('install.sh');
  expect(await readdir(containerTargetDir)).toContain('configure-git.sh');
  expect(await readdir(containerTargetDir)).toContain('git-credential-hostproxy');

  await appendEvidence(evidencePath, `LAYOUT_OK ${expectedArchLabel}`);
}

async function smokeExtractedBinary(extractDir: string, evidencePath: string): Promise<void> {
  const binaryPath = path.resolve(extractDir, 'bin', 'host-git-cred-proxy');
  const runDir = await createTempDir('host-git-cred-proxy-run-cwd-');
  const stateDir = await createTempDir('host-git-cred-proxy-state-');

  try {
    const startResult = await runBinary(binaryPath, ['start'], runDir, stateDir);
    expect(startResult.exitCode).toBe(0);
    await assertHealthzOk();
    await appendEvidence(evidencePath, `RUNTIME_SMOKE_OK ${binaryPath}`);
  } finally {
    await runBinary(binaryPath, ['stop'], runDir, stateDir).catch(() => undefined);
  }
}

async function verifyMissingAssetsFailLoudly(extractDir: string, evidencePath: string): Promise<void> {
  const brokenDir = await createTempDir('host-git-cred-proxy-broken-tree-');
  const runDir = await createTempDir('host-git-cred-proxy-broken-cwd-');
  const stateDir = await createTempDir('host-git-cred-proxy-broken-state-');
  const binaryPath = path.resolve(brokenDir, 'bin', 'host-git-cred-proxy');

  try {
    await cp(extractDir, brokenDir, { recursive: true, force: true });
    await rm(path.resolve(brokenDir, 'share', 'host-git-cred-proxy', 'ui'), { recursive: true, force: true });

    const startResult = await runBinary(binaryPath, ['start'], runDir, stateDir);
    expect(startResult.exitCode).not.toBe(0);

    const logPath = path.resolve(stateDir, 'server.log');
    const logText = await Bun.file(logPath).text().catch(() => '');
    expect(`${startResult.stdout}\n${startResult.stderr}\n${logText}`).toMatch(/Unable to resolve host-git-cred-proxy assets|Resolved share directory does not contain UI assets/i);
    await appendEvidence(evidencePath, `MISSING_ASSET_FAILURE_OK ${binaryPath}`);
  } finally {
    await runBinary(binaryPath, ['stop'], runDir, stateDir).catch(() => undefined);
  }
}

async function resetEvidence(evidencePath: string, label: string): Promise<void> {
  await mkdir(evidenceDir, { recursive: true });
  await Bun.write(evidencePath, `${label} ${new Date().toISOString()}\n`);
}

async function appendEvidence(evidencePath: string, line: string): Promise<void> {
  await appendFile(evidencePath, `${line}\n`, 'utf-8');
}

async function createTempDir(prefix: string): Promise<string> {
  const tempDir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.add(tempDir);
  return tempDir;
}

async function extractArchive(archivePath: string, extractDir: string): Promise<void> {
  const proc = Bun.spawn(['tar', '-xzf', archivePath, '-C', extractDir], {
    cwd: repoRoot,
    env: process.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  expect(exitCode).toBe(0);
  expect(stderr).toBe('');
}

async function runBinary(binaryPath: string, args: string[], cwd: string, stateDir: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([binaryPath, ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_CRED_PROXY_STATE_DIR: stateDir,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return {
    exitCode,
    stdout,
    stderr,
  };
}

async function assertHealthzOk(): Promise<void> {
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:18765/healthz');
      const body = await response.text();
      if (response.ok && body === 'ok') {
        return;
      }
    } catch {}

    await Bun.sleep(100);
  }

  throw new Error('Timed out waiting for /healthz to return ok');
}

function readMachCpuType(binaryBytes: Buffer): number {
  const magic = binaryBytes.readUInt32LE(0);
  expect(magic).toBe(0xfeedfacf);
  return binaryBytes.readUInt32LE(4);
}

function resolveReleaseTargets(filterValue: string | undefined): readonly (typeof allReleaseTargets)[number][] {
  if (!filterValue?.trim()) {
    return allReleaseTargets;
  }

  const requestedTargetIds = filterValue
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (requestedTargetIds.length === 0) {
    throw new Error(`${releaseTargetsEnv} must name at least one release target when set`);
  }

  const requestedTargetIdSet = new Set<string>(requestedTargetIds);
  const releaseTargets = allReleaseTargets.filter((target) => requestedTargetIdSet.has(target.id));
  const selectedTargetIds = new Set<string>(releaseTargets.map((target) => target.id));
  const unknownTargetIds = requestedTargetIds.filter((targetId) => !selectedTargetIds.has(targetId));

  if (unknownTargetIds.length > 0) {
    throw new Error(`${releaseTargetsEnv} contains unsupported release target(s): ${unknownTargetIds.join(', ')}`);
  }

  return releaseTargets;
}
