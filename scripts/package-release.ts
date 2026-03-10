import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

type ReleaseTarget = {
  id: 'darwin-arm64' | 'darwin-x64';
  archiveName: `host-git-cred-proxy-${string}.tar.gz`;
  bunTarget: string;
};

type TarEntry = {
  relativePath: string;
  absolutePath: string;
  kind: 'file' | 'directory';
};

const REPO_ROOT = path.resolve(import.meta.dir, '..');
const HOST_ENTRYPOINT = path.resolve(REPO_ROOT, 'host', 'src', 'index.ts');
const UI_DIST_DIR = path.resolve(REPO_ROOT, 'host', 'ui', 'dist');
const RELEASE_DIR = path.resolve(REPO_ROOT, 'dist', 'releases');
const WORK_DIR = path.resolve(REPO_ROOT, 'dist', '.release-workdir');
const CHECKSUMS_FILE = 'checksums.txt';
const FIXED_MTIME_SECONDS = 0;
const RELEASE_TARGETS_ENV = 'HOST_GIT_CRED_PROXY_RELEASE_TARGETS';

const CONTAINER_ASSET_NAMES = ['install.sh', 'configure-git.sh', 'git-credential-hostproxy'] as const;

const RELEASE_TARGETS: readonly ReleaseTarget[] = [
  {
    id: 'darwin-arm64',
    archiveName: 'host-git-cred-proxy-darwin-arm64.tar.gz',
    bunTarget: 'bun-darwin-arm64',
  },
  {
    id: 'darwin-x64',
    archiveName: 'host-git-cred-proxy-darwin-x64.tar.gz',
    bunTarget: 'bun-darwin-x64',
  },
] as const;

const EXECUTABLE_RELATIVE_PATHS = new Set([
  'bin/host-git-cred-proxy',
  'share/host-git-cred-proxy/container/install.sh',
  'share/host-git-cred-proxy/container/configure-git.sh',
  'share/host-git-cred-proxy/container/git-credential-hostproxy',
]);

const PACKAGED_BUILD_DEFINE = '__HOST_GIT_CRED_PROXY_PACKAGED__=true';
await main();

async function main(): Promise<void> {
  const selectedReleaseTargets = resolveReleaseTargets(process.env[RELEASE_TARGETS_ENV]);

  await prepareEmptyDir(RELEASE_DIR);
  await prepareEmptyDir(WORK_DIR);

  try {
    await runCommand(['bun', 'run', 'build:ui'], REPO_ROOT);
    await assertDirectoryExists(UI_DIST_DIR, 'UI dist assets missing after build:ui');

    const checksums: Array<{ archiveName: string; sha256: string }> = [];

    for (const releaseTarget of selectedReleaseTargets) {
      const targetWorkDir = path.resolve(WORK_DIR, releaseTarget.id);
      await prepareEmptyDir(targetWorkDir);

      const binaryPath = path.resolve(targetWorkDir, 'host-git-cred-proxy');
      await compileHostBinary(binaryPath, releaseTarget.bunTarget);

      const stagingDir = path.resolve(targetWorkDir, 'staging');
      await stageReleaseLayout(stagingDir, binaryPath);

      const tarballPath = path.resolve(RELEASE_DIR, releaseTarget.archiveName);
      await createDeterministicTarball(stagingDir, tarballPath);

      checksums.push({
        archiveName: releaseTarget.archiveName,
        sha256: await sha256File(tarballPath),
      });
      console.log(`built ${path.relative(REPO_ROOT, tarballPath)}`);
    }

    checksums.sort((a, b) => a.archiveName.localeCompare(b.archiveName));

    const checksumContent = checksums.map((entry) => `${entry.sha256}  ${entry.archiveName}`).join('\n');
    const checksumPath = path.resolve(RELEASE_DIR, CHECKSUMS_FILE);
    await writeFile(checksumPath, `${checksumContent}\n`, 'utf-8');
    console.log(`wrote ${path.relative(REPO_ROOT, checksumPath)}`);
  } finally {
    await rm(WORK_DIR, { recursive: true, force: true });
  }
}

async function compileHostBinary(binaryPath: string, bunTarget: string): Promise<void> {
  await runCommand(
    [
      'bun',
      'build',
      HOST_ENTRYPOINT,
      '--compile',
      '--target',
      bunTarget,
      '--outfile',
      binaryPath,
        '--no-compile-autoload-dotenv',
        '--no-compile-autoload-bunfig',
        '--no-compile-autoload-tsconfig',
        '--no-compile-autoload-package-json',
        '--define',
        PACKAGED_BUILD_DEFINE,
    ],
    REPO_ROOT,
  );

  await chmod(binaryPath, 0o755);
}

function resolveReleaseTargets(filterValue: string | undefined): readonly ReleaseTarget[] {
  if (!filterValue?.trim()) {
    return RELEASE_TARGETS;
  }

  const requestedTargetIds = filterValue
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (requestedTargetIds.length === 0) {
    throw new Error(`${RELEASE_TARGETS_ENV} must name at least one release target when set`);
  }

  const requestedTargetIdSet = new Set<string>(requestedTargetIds);
  const selectedTargets = RELEASE_TARGETS.filter((target) => requestedTargetIdSet.has(target.id));
  const selectedTargetIds = new Set<string>(selectedTargets.map((target) => target.id));
  const unknownTargetIds = requestedTargetIds.filter((targetId) => !selectedTargetIds.has(targetId));

  if (unknownTargetIds.length > 0) {
    throw new Error(
      `${RELEASE_TARGETS_ENV} contains unsupported release target(s): ${unknownTargetIds.join(', ')}`,
    );
  }

  return selectedTargets;
}

async function stageReleaseLayout(stagingDir: string, binaryPath: string): Promise<void> {
  await prepareEmptyDir(stagingDir);

  const binDir = path.resolve(stagingDir, 'bin');
  const shareRoot = path.resolve(stagingDir, 'share', 'host-git-cred-proxy');
  const uiTargetDir = path.resolve(shareRoot, 'ui');
  const containerTargetDir = path.resolve(shareRoot, 'container');

  await mkdir(binDir, { recursive: true });
  await mkdir(path.resolve(stagingDir, 'share'), { recursive: true });
  await mkdir(shareRoot, { recursive: true });

  const releaseBinaryPath = path.resolve(binDir, 'host-git-cred-proxy');
  await cp(binaryPath, releaseBinaryPath, { force: true });
  await chmod(releaseBinaryPath, 0o755);

  await cp(UI_DIST_DIR, uiTargetDir, {
    recursive: true,
    force: true,
  });

  await mkdir(containerTargetDir, { recursive: true });

  for (const assetName of CONTAINER_ASSET_NAMES) {
    const sourcePath = path.resolve(REPO_ROOT, 'container', assetName);
    const destinationPath = path.resolve(containerTargetDir, assetName);
    await cp(sourcePath, destinationPath, { force: true });
    await chmod(destinationPath, 0o755);
  }

  await assertFileExists(path.resolve(uiTargetDir, 'index.html'));
}

async function createDeterministicTarball(stagingDir: string, destinationPath: string): Promise<void> {
  const entries = await collectTarEntries(stagingDir);
  const tarBuffer = await encodeTar(stagingDir, entries);
  const gzipOptions: Record<string, number> = {
    level: 9,
    mtime: FIXED_MTIME_SECONDS,
  };
  const gzipBuffer = gzipSync(tarBuffer, gzipOptions);

  await writeFile(destinationPath, gzipBuffer);
}

async function collectTarEntries(stagingDir: string): Promise<TarEntry[]> {
  const directories: TarEntry[] = [];
  const files: TarEntry[] = [];

  async function walk(relativeDir: string): Promise<void> {
    const absoluteDir = path.resolve(stagingDir, relativeDir);
    const childEntries = await readdir(absoluteDir, {
      withFileTypes: true,
    });

    childEntries.sort((a, b) => a.name.localeCompare(b.name));

    for (const child of childEntries) {
      const childRelativePath = relativeDir ? `${relativeDir}/${child.name}` : child.name;
      const childAbsolutePath = path.resolve(stagingDir, childRelativePath);

      if (child.isDirectory()) {
        directories.push({
          relativePath: childRelativePath,
          absolutePath: childAbsolutePath,
          kind: 'directory',
        });
        await walk(childRelativePath);
        continue;
      }

      if (child.isFile()) {
        files.push({
          relativePath: childRelativePath,
          absolutePath: childAbsolutePath,
          kind: 'file',
        });
        continue;
      }

      throw new Error(`Unsupported entry in release layout: ${childRelativePath}`);
    }
  }

  await walk('');
  return [...directories, ...files];
}

async function encodeTar(stagingDir: string, entries: TarEntry[]): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for (const entry of entries) {
    const tarPath = toPosixPath(entry.relativePath);
    const data = entry.kind === 'file' ? await readFile(path.resolve(stagingDir, entry.relativePath)) : Buffer.alloc(0);
    const mode = resolveTarMode(entry.relativePath, entry.kind);
    const typeFlag = entry.kind === 'directory' ? '5' : '0';

    const header = createTarHeader(tarPath, typeFlag, mode, data.length);
    chunks.push(header);

    if (data.length > 0) {
      chunks.push(data);
      const remainder = data.length % 512;
      if (remainder > 0) {
        chunks.push(Buffer.alloc(512 - remainder));
      }
    }
  }

  chunks.push(Buffer.alloc(512));
  chunks.push(Buffer.alloc(512));

  return Buffer.concat(chunks);
}

function createTarHeader(relativePath: string, typeFlag: '0' | '5', mode: number, size: number): Buffer {
  const header = Buffer.alloc(512, 0);
  const { name, prefix } = splitTarPath(relativePath);

  writeTarString(header, 0, 100, name);
  writeTarOctal(header, 100, 8, mode);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, size);
  writeTarOctal(header, 136, 12, FIXED_MTIME_SECONDS);

  header.fill(0x20, 148, 156);
  writeTarString(header, 156, 1, typeFlag);
  writeTarString(header, 257, 6, 'ustar');
  writeTarString(header, 263, 2, '00');
  writeTarString(header, 345, 155, prefix);

  let checksum = 0;
  for (let index = 0; index < 512; index += 1) {
    checksum += header[index] ?? 0;
  }

  const checksumField = checksum.toString(8).padStart(6, '0');
  writeTarString(header, 148, 6, checksumField);
  header[154] = 0;
  header[155] = 0x20;

  return header;
}

function writeTarString(buffer: Buffer, offset: number, length: number, value: string): void {
  const normalized = value.length > length ? value.slice(0, length) : value;
  buffer.write(normalized, offset, length, 'utf-8');
}

function writeTarOctal(buffer: Buffer, offset: number, length: number, value: number): void {
  const normalized = Math.max(0, Math.trunc(value));
  const encoded = normalized.toString(8).padStart(length - 1, '0');

  if (encoded.length > length - 1) {
    throw new Error(`Tar field overflow (offset=${offset}, length=${length}, value=${value})`);
  }

  writeTarString(buffer, offset, length - 1, encoded);
  buffer[offset + length - 1] = 0;
}

function splitTarPath(relativePath: string): { name: string; prefix: string } {
  const normalizedPath = toPosixPath(relativePath);

  if (Buffer.byteLength(normalizedPath, 'utf-8') <= 100) {
    return {
      name: normalizedPath,
      prefix: '',
    };
  }

  const parts = normalizedPath.split('/');
  for (let splitIndex = 1; splitIndex < parts.length; splitIndex += 1) {
    const prefix = parts.slice(0, splitIndex).join('/');
    const name = parts.slice(splitIndex).join('/');

    if (Buffer.byteLength(prefix, 'utf-8') <= 155 && Buffer.byteLength(name, 'utf-8') <= 100) {
      return {
        name,
        prefix,
      };
    }
  }

  throw new Error(`Tar path exceeds ustar limits: ${relativePath}`);
}

function resolveTarMode(relativePath: string, kind: TarEntry['kind']): number {
  if (kind === 'directory') {
    return 0o755;
  }

  return EXECUTABLE_RELATIVE_PATHS.has(toPosixPath(relativePath)) ? 0o755 : 0o644;
}

async function sha256File(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

async function prepareEmptyDir(targetDir: string): Promise<void> {
  await rm(targetDir, {
    recursive: true,
    force: true,
  });
  await mkdir(targetDir, {
    recursive: true,
  });
}

async function assertDirectoryExists(dirPath: string, message: string): Promise<void> {
  if (!existsSync(dirPath)) {
    throw new Error(message);
  }

  const fileStat = await stat(dirPath);
  if (!fileStat.isDirectory()) {
    throw new Error(`${message}: ${dirPath} is not a directory`);
  }
}

async function assertFileExists(filePath: string): Promise<void> {
  if (!existsSync(filePath)) {
    throw new Error(`Required release asset missing: ${filePath}`);
  }

  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    throw new Error(`Required release asset is not a file: ${filePath}`);
  }
}

async function runCommand(command: string[], cwd: string): Promise<void> {
  const child = Bun.spawn(command, {
    cwd,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });

  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed (${exitCode}): ${command.join(' ')}`);
  }
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}
