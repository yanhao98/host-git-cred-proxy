import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';

const REPO_ROOT = path.resolve(import.meta.dir, '..');
const RELEASE_DIR = path.resolve(REPO_ROOT, 'dist', 'releases');
const CHECKSUMS_FILE = path.resolve(RELEASE_DIR, 'checksums.txt');
const TEMPLATE_FILE = path.resolve(REPO_ROOT, 'packaging', 'homebrew', 'formula.rb.template');
const OUTPUT_DIR = path.resolve(REPO_ROOT, 'dist', 'homebrew');
const OUTPUT_FILE = path.resolve(OUTPUT_DIR, 'host-git-cred-proxy.rb');
const VERSION = process.env.HOST_GIT_CRED_PROXY_VERSION || '0.1.0';
const HOMEPAGE = process.env.HOST_GIT_CRED_PROXY_HOMEPAGE || 'https://git.1-h.cc/gitea_1-h.cc/host-git-cred-proxy';
const RELEASE_BASE_URL = process.env.HOST_GIT_CRED_PROXY_RELEASE_BASE_URL?.trim() || `file://${RELEASE_DIR}`;

async function main() {
  if (!existsSync(CHECKSUMS_FILE)) {
    console.error(`Checksums file not found: ${CHECKSUMS_FILE}`);
    console.error('Please run `bun run package:release` first.');
    process.exit(1);
  }

  const checksumsContent = await readFile(CHECKSUMS_FILE, 'utf-8');
  const checksums = new Map<string, string>();
  
  for (const line of checksumsContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    const [sha256, archiveName] = trimmed.split(/\s+/);
    if (sha256 && archiveName) {
      checksums.set(archiveName, sha256);
    }
  }

  const arm64Archive = 'host-git-cred-proxy-darwin-arm64.tar.gz';
  const x64Archive = 'host-git-cred-proxy-darwin-x64.tar.gz';

  const sha256Arm64 = checksums.get(arm64Archive);
  const sha256X64 = checksums.get(x64Archive);

  if (!sha256Arm64 || !sha256X64) {
    console.error('Missing checksums for required release targets.');
    process.exit(1);
  }

  const templateContent = await readFile(TEMPLATE_FILE, 'utf-8');

  const formulaContent = templateContent
    .replace('{{HOMEPAGE}}', HOMEPAGE)
    .replace('{{VERSION}}', VERSION)
    .replace('{{URL_ARM64}}', `${RELEASE_BASE_URL}/${arm64Archive}`)
    .replace('{{SHA256_ARM64}}', sha256Arm64)
    .replace('{{URL_X64}}', `${RELEASE_BASE_URL}/${x64Archive}`)
    .replace('{{SHA256_X64}}', sha256X64);

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(OUTPUT_FILE, formulaContent, 'utf-8');
  
  console.log(`Generated Homebrew formula at ${path.relative(REPO_ROOT, OUTPUT_FILE)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
