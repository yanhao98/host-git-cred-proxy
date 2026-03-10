import { existsSync } from 'node:fs';
import { appendFile, mkdir, rm, writeFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { test, expect, beforeAll } from 'bun:test';

const REPO_ROOT = path.resolve(import.meta.dir, '..', '..');
const EVIDENCE_DIR = path.resolve(REPO_ROOT, '.sisyphus', 'evidence');
const ERROR_EVIDENCE_FILE = path.resolve(EVIDENCE_DIR, 'task-20-homebrew-error.txt');
const SUCCESS_EVIDENCE_FILE = path.resolve(EVIDENCE_DIR, 'task-20-homebrew.txt');
const FORMULA_PATH = path.resolve(REPO_ROOT, 'dist', 'homebrew', 'host-git-cred-proxy.rb');
const RELEASE_BASE_URL = `file://${path.resolve(REPO_ROOT, 'dist', 'releases')}`;

beforeAll(async () => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
});

test('Homebrew formula smoke test', async () => {
  await Bun.write(SUCCESS_EVIDENCE_FILE, `task-20-homebrew ${new Date().toISOString()}\n`);
  await Bun.write(ERROR_EVIDENCE_FILE, `task-20-homebrew-error ${new Date().toISOString()}\n`);

  const generateResult = await runCommand(['bun', 'run', 'scripts/generate-formula.ts'], REPO_ROOT, {
    ...process.env,
    HOST_GIT_CRED_PROXY_RELEASE_BASE_URL: RELEASE_BASE_URL,
  });
  if (generateResult.exitCode !== 0) {
    await writeFile(ERROR_EVIDENCE_FILE, `${await Bun.file(ERROR_EVIDENCE_FILE).text()}formula generation failed\n${generateResult.stderr}${generateResult.stdout}`, 'utf-8');
    throw new Error(`Formula generation failed:\n${generateResult.stderr}\n${generateResult.stdout}`);
  }

  const { exitCode: brewExitCode } = await runCommand(['which', 'brew']);

  if (brewExitCode !== 0) {
    const msg = 'Homebrew is not installed in this workspace. Local smoke test is blocked.';
    await appendFile(ERROR_EVIDENCE_FILE, `${msg}\n`, 'utf-8');
    throw new Error(msg);
  }

  if (!existsSync(FORMULA_PATH)) {
    const msg = `Formula not found at ${FORMULA_PATH}. Did you run generate-formula.ts?`;
    await appendFile(ERROR_EVIDENCE_FILE, `${msg}\n`, 'utf-8');
    throw new Error(msg);
  }

  const tapUser = 'test-hgcp';
  const tapRepo = 'smoke';
  const tapFullName = `${tapUser}/${tapRepo}`;
  const brewRepo = (await runCommand(['brew', '--repository'])).stdout.trim();
  const tapDir = path.resolve(brewRepo, 'Library', 'Taps', tapUser, `homebrew-${tapRepo}`);
  const formulaDir = path.resolve(tapDir, 'Formula');

  try {
    await mkdir(formulaDir, { recursive: true });
    await cp(FORMULA_PATH, path.resolve(formulaDir, 'host-git-cred-proxy.rb'));

    // Initialize as a git repo so Homebrew recognizes the tap
    await runCommand(['git', 'init'], tapDir);
    await runCommand(['git', '-C', tapDir, 'add', '.']);
    await runCommand(['git', '-C', tapDir, 'commit', '-m', 'init', '--author', 'test <test@test.com>']);

    // Ruby syntax check (fast, always works)
    const syntaxResult = await runCommand(['ruby', '-c', FORMULA_PATH]);
    if (syntaxResult.exitCode !== 0) {
      throw new Error(`Ruby syntax check failed:\n${syntaxResult.stderr}\n${syntaxResult.stdout}`);
    }
    await appendFile(SUCCESS_EVIDENCE_FILE, 'ruby -c syntax ok\n', 'utf-8');

    // brew audit via local tap (Homebrew 5.0+ requires name, not path)
    const auditResult = await runCommand(['brew', 'audit', '--formula', `${tapFullName}/host-git-cred-proxy`]);
    if (auditResult.exitCode !== 0) {
      await appendFile(SUCCESS_EVIDENCE_FILE, `brew audit warnings (non-blocking):\n${auditResult.stderr}\n${auditResult.stdout}\n`, 'utf-8');
    } else {
      await appendFile(SUCCESS_EVIDENCE_FILE, 'brew audit ok\n', 'utf-8');
    }

    // brew install from local tap
    const installResult = await runCommand(['brew', 'install', '--formula', `${tapFullName}/host-git-cred-proxy`]);
    if (installResult.exitCode !== 0) {
      throw new Error(`brew install failed:\n${installResult.stderr}\n${installResult.stdout}`);
    }
    await appendFile(SUCCESS_EVIDENCE_FILE, 'brew install ok\n', 'utf-8');

    // brew test
    const testResult = await runCommand(['brew', 'test', `${tapFullName}/host-git-cred-proxy`]);
    if (testResult.exitCode !== 0) {
      throw new Error(`brew test failed:\n${testResult.stderr}\n${testResult.stdout}`);
    }
    await appendFile(SUCCESS_EVIDENCE_FILE, 'brew test ok\n', 'utf-8');
    expect(true).toBe(true);

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendFile(ERROR_EVIDENCE_FILE, `Smoke test failed: ${message}\n`, 'utf-8');
    throw error;
  } finally {
    await runCommand(['brew', 'uninstall', `${tapFullName}/host-git-cred-proxy`]).catch(() => {});
    await rm(path.resolve(brewRepo, 'Library', 'Taps', tapUser), { recursive: true, force: true }).catch(() => {});
  }
}, 300000);

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

async function runCommand(command: string[], cwd: string = REPO_ROOT, env: NodeJS.ProcessEnv = process.env): Promise<CommandResult> {
  const child = Bun.spawn(command, {
    cwd,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  return { exitCode, stdout, stderr };
}
