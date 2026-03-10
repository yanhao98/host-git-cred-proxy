import { appendFile, cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dir, '..');
const ERROR_EVIDENCE_FILE = path.resolve(REPO_ROOT, '.sisyphus', 'evidence', 'task-20-homebrew-error.txt');
const GENERATED_FORMULA = path.resolve(REPO_ROOT, 'dist', 'homebrew', 'host-git-cred-proxy.rb');

await main();

async function main(): Promise<void> {
  await mkdir(path.dirname(ERROR_EVIDENCE_FILE), { recursive: true });

  const tapRepo = process.env.HOST_GIT_CRED_PROXY_TAP_REPO?.trim();
  const tapRemoteUrl = process.env.HOST_GIT_CRED_PROXY_TAP_REMOTE_URL?.trim();
  const gitAuthorName = process.env.HOST_GIT_CRED_PROXY_TAP_GIT_NAME?.trim() || 'host-git-cred-proxy automation';
  const gitAuthorEmail = process.env.HOST_GIT_CRED_PROXY_TAP_GIT_EMAIL?.trim() || 'noreply@example.invalid';

  if (!tapRepo || !tapRemoteUrl) {
    await appendFile(
      ERROR_EVIDENCE_FILE,
      '[DECISION NEEDED] Missing Homebrew tap identifier or remote URL; skipping remote publication.\n',
      'utf-8',
    );
    return;
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), 'host-git-cred-proxy-tap-'));

  try {
    await runCommand(['git', 'clone', tapRemoteUrl, tempDir]);
    const formulaDir = path.resolve(tempDir, 'Formula');
    await mkdir(formulaDir, { recursive: true });
    await cp(GENERATED_FORMULA, path.resolve(formulaDir, 'host-git-cred-proxy.rb'), { force: true });
    await runCommand(['git', 'config', 'user.name', gitAuthorName], tempDir);
    await runCommand(['git', 'config', 'user.email', gitAuthorEmail], tempDir);
    await runCommand(['git', 'add', 'Formula/host-git-cred-proxy.rb'], tempDir);
    await runCommand(['git', 'commit', '-m', 'Update host-git-cred-proxy formula'], tempDir).catch(() => undefined);
    await runCommand(['git', 'push', 'origin', 'HEAD'], tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function runCommand(command: string[], cwd = REPO_ROOT): Promise<void> {
  const child = Bun.spawn(command, {
    cwd,
    env: process.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  if (exitCode !== 0) {
    throw new Error(`${command.join(' ')} failed:\n${stderr}\n${stdout}`);
  }
}
