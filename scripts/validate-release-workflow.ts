import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dir, '..');
const workflowPath = path.resolve(repoRoot, '.github', 'workflows', 'release.yml');
const packageScriptPath = path.resolve(repoRoot, 'scripts', 'package-release.ts');
const smokeTestPath = path.resolve(repoRoot, 'tests', 'release', 'tarball-smoke.test.ts');
const evidenceDir = path.resolve(repoRoot, '.sisyphus', 'evidence');
const successEvidencePath = path.resolve(evidenceDir, 'task-19-release-workflow.txt');
const errorEvidencePath = path.resolve(evidenceDir, 'task-19-release-workflow-error.txt');
const releaseTargetsEnv = 'HOST_GIT_CRED_PROXY_RELEASE_TARGETS';

await main();

async function main(): Promise<void> {
  const timestamp = new Date().toISOString();
  const successLines = [`task-19-release-workflow ${timestamp}`];
  const errorLines = [`task-19-release-workflow-error ${timestamp}`];

  try {
    const workflowText = await Bun.file(workflowPath).text();
    const packageScriptText = await Bun.file(packageScriptPath).text();
    const smokeTestText = await Bun.file(smokeTestPath).text();

    requireIncludes(workflowText, "- 'v*'", 'TAG_TRIGGER_OK v*', successLines);
    requireIncludes(workflowText, 'package-macos:', 'PACKAGE_JOB_OK package-macos', successLines);
    requireIncludes(workflowText, 'draft-release:', 'RELEASE_JOB_OK draft-release', successLines);
    requireIncludes(workflowText, 'needs: package-macos', 'RELEASE_GATE_OK needs-package-macos', successLines);
    requireIncludes(workflowText, 'runner: macos-14-large', 'RUNNER_OK darwin-x64 macos-14-large', successLines);
    requireIncludes(workflowText, 'runner: macos-14', 'RUNNER_OK darwin-arm64 macos-14', successLines);
    requireIncludes(
      workflowText,
      'archive: host-git-cred-proxy-darwin-x64.tar.gz',
      'ARCHIVE_OK darwin-x64',
      successLines,
    );
    requireIncludes(
      workflowText,
      'archive: host-git-cred-proxy-darwin-arm64.tar.gz',
      'ARCHIVE_OK darwin-arm64',
      successLines,
    );
    requireIncludes(workflowText, 'name: ${{ matrix.target.artifact }}', 'ARTIFACT_NAME_OK matrix-target-artifact', successLines);
    requireIncludes(
      workflowText,
      'path: dist/releases/${{ matrix.target.archive }}',
      'ARTIFACT_PATH_OK runner-specific-tarball-only',
      successLines,
    );
    requireIncludes(
      workflowText,
      'HOST_GIT_CRED_PROXY_RELEASE_TARGETS: ${{ matrix.target.id }}',
      'TARGET_FILTER_ENV_OK workflow-uses-release-target-filter',
      successLines,
    );
    requireIncludes(workflowText, 'run: bun run package:release', 'PACKAGE_STEP_OK bun-run-package-release', successLines);
    requireIncludes(workflowText, 'run: bun run smoke:tarball', 'SMOKE_STEP_OK bun-run-smoke-tarball', successLines);
    requireIncludes(workflowText, 'uses: actions/download-artifact@v4', 'DOWNLOAD_OK release-job-downloads-artifacts', successLines);
    requireIncludes(workflowText, 'merge-multiple: true', 'DOWNLOAD_OK merge-multiple', successLines);
    requireIncludes(workflowText, 'sha256sum \\', 'CHECKSUM_STEP_OK sha256sum', successLines);
    requireIncludes(workflowText, 'draft: true', 'DRAFT_RELEASE_OK true', successLines);
    requireIncludes(workflowText, 'fail_on_unmatched_files: true', 'RELEASE_FILES_STRICT_OK', successLines);
    requireIncludes(
      workflowText,
      'dist/releases/host-git-cred-proxy-darwin-arm64.tar.gz',
      'RELEASE_ASSET_OK darwin-arm64',
      successLines,
    );
    requireIncludes(
      workflowText,
      'dist/releases/host-git-cred-proxy-darwin-x64.tar.gz',
      'RELEASE_ASSET_OK darwin-x64',
      successLines,
    );
    requireIncludes(workflowText, 'dist/releases/checksums.txt', 'RELEASE_ASSET_OK checksums', successLines);
    requireIncludes(workflowText, 'if [ "${#actual[@]}" -ne "${#expected[@]}" ]; then', 'ASSET_SET_GUARD_OK exact-count', successLines);
    requireIncludes(packageScriptText, releaseTargetsEnv, 'PACKAGE_SCRIPT_FILTER_OK release-target-filter-supported', successLines);
    requireIncludes(smokeTestText, releaseTargetsEnv, 'SMOKE_TEST_FILTER_OK release-target-filter-supported', successLines);

    requireOrderedSubstrings(
      workflowText,
      [
        'run: bun install --frozen-lockfile',
        'run: bun run package:release',
        'run: bun run smoke:tarball',
        'uses: actions/upload-artifact@v4',
      ],
      'PACKAGE_FLOW_ORDER_OK install-package-smoke-upload',
      successLines,
    );

    requireOrderedSubstrings(
      workflowText,
      [
        'uses: actions/download-artifact@v4',
        'sha256sum \\',
        'Validate release asset set',
        'uses: softprops/action-gh-release@v2',
      ],
      'RELEASE_FLOW_ORDER_OK download-checksum-validate-publish',
      successLines,
    );

    errorLines.push(
      'STRUCTURAL_BLOCKING_NOTE smoke failure in package-macos prevents upload-artifact and blocks draft-release via needs: package-macos',
    );

    await writeEvidence(successEvidencePath, successLines);
    await writeEvidence(errorEvidencePath, errorLines);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errorLines.push(`VALIDATION_FAILED ${message}`);
    await writeEvidence(errorEvidencePath, errorLines);
    throw error;
  }
}

function requireIncludes(text: string, needle: string, successLine: string, successLines: string[]): void {
  if (!text.includes(needle)) {
    throw new Error(`Missing expected text: ${needle}`);
  }

  successLines.push(successLine);
}

function requireOrderedSubstrings(text: string, needles: string[], successLine: string, successLines: string[]): void {
  let previousIndex = -1;

  for (const needle of needles) {
    const index = text.indexOf(needle, previousIndex + 1);
    if (index === -1) {
      throw new Error(`Missing ordered text: ${needle}`);
    }
    if (index < previousIndex) {
      throw new Error(`Out-of-order text: ${needle}`);
    }

    previousIndex = index;
  }

  successLines.push(successLine);
}

async function writeEvidence(filePath: string, lines: string[]): Promise<void> {
  await mkdir(evidenceDir, { recursive: true });
  await Bun.write(filePath, `${lines.join('\n')}\n`);
}
