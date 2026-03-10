# Task 19: GitHub Actions Release Workflow - Documentation Reference

**Purpose**: Authoritative docs and examples for implementing native macOS packaging, smoke tests, artifact handling, checksums, and draft release publication.

**Last Updated**: 2026-03-10

---

## 1. GitHub Actions Matrix Jobs for macOS

### Official Documentation
- **Matrix Strategy**: https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/run-job-variations
- **Runner Reference**: https://docs.github.com/en/actions/reference/runners/github-hosted-runners

### macOS Runner Types (2026)

#### Current Available Labels (as of Feb 2026)
- **macOS 26 (Tahoe)** - GA since Feb 26, 2026
  - `macos-26` - Standard runner for arm64 (Apple Silicon)
  - `macos-26-xlarge` - Extra-large runner for arm64
  - `macos-26-large` - Large runner for x64 (Intel)
  - `macos-26-intel` - Standard runner for x64

- **macOS 15** - Previous stable
  - `macos-15` - Apple Silicon
  - `macos-15-large` - Intel
  
- **macOS 14** - Still available
  - `macos-14` - Apple Silicon
  - `macos-14-large` - Intel

- **macOS 13** - Retired Dec 4, 2025
  - ⚠️ **NO LONGER AVAILABLE**

#### Recommended Matrix for Task 19
```yaml
jobs:
  build-macos:
    strategy:
      matrix:
        include:
          - runner: macos-14
            arch: arm64
            target: darwin-arm64
          - runner: macos-14-large
            arch: x64
            target: darwin-x64
    runs-on: ${{ matrix.runner }}
```

**Applicability for Atlas**:
- Use `macos-14` for Apple Silicon (arm64)
- Use `macos-14-large` for Intel (x64)
- Alternative: `macos-15` and `macos-15-large` if available
- **Do NOT use `macos-13`** - retired in Dec 2025

### Matrix Example with Multiple Dimensions
```yaml
jobs:
  build:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [macos-14, macos-14-large]
        node: [20]  # or bun version
```

---

## 2. Artifact Upload/Download Between Jobs

### Official Documentation
- **Storing Workflow Data**: https://docs.github.com/en/actions/tutorials/store-and-share-data
- **Upload Artifact Action**: https://github.com/actions/upload-artifact (v4/v7)
- **Download Artifact Action**: https://github.com/actions/download-artifact (v5/v8)

### Key Features (2026 Update)
- **Non-zipped artifacts** supported since Feb 26, 2026
  - Use `archive: false` parameter in v7 to avoid double-zip
  - Download with v8 of download-artifact action
- **Default behavior**: artifacts are automatically zipped

### Upload Pattern
```yaml
- name: Upload build artifact
  uses: actions/upload-artifact@v4
  with:
    name: tarball-${{ matrix.target }}
    path: dist/releases/host-git-cred-proxy-${{ matrix.target }}.tar.gz
    retention-days: 5
    # archive: false  # Use for v7+ to avoid double-zip
```

### Download Pattern (in release job)
```yaml
- name: Download all artifacts
  uses: actions/download-artifact@v5
  with:
    path: artifacts/
    # name: artifact-name  # Optional: download specific artifact
```

### Cross-Job Data Sharing with Outputs
```yaml
jobs:
  build:
    outputs:
      artifact-id: ${{ steps.upload.outputs.artifact-id }}
      artifact-url: ${{ steps.upload.outputs.artifact-url }}
    steps:
      - uses: actions/upload-artifact@v4
        id: upload
        with:
          name: my-artifact
          path: dist/

  release:
    needs: build
    steps:
      - name: Use artifact metadata
        run: |
          echo "Artifact ID: ${{ needs.build.outputs.artifact-id }}"
          echo "Download URL: ${{ needs.build.outputs.artifact-url }}"
```

**Applicability for Atlas**:
- Upload tarballs from each macOS matrix job
- Download all artifacts in the release job
- Use `needs` to ensure release job waits for all build jobs

---

## 3. Job Dependencies and Gating

### Official Documentation
- **Using Jobs**: https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-jobs
- **Job Dependencies Guide**: https://oneuptime.com/blog/post/2026-02-02-github-actions-job-dependencies/view

### The `needs` Keyword
```yaml
jobs:
  smoke-test-arm64:
    runs-on: macos-14
    steps:
      - name: Run smoke tests
        run: bun run smoke:tarball

  smoke-test-x64:
    runs-on: macos-14-large
    steps:
      - name: Run smoke tests
        run: bun run smoke:tarball

  release:
    needs: [smoke-test-arm64, smoke-test-x64]
    runs-on: ubuntu-latest
    if: success()  # Only runs if all dependencies succeed
    steps:
      - name: Create release
        # ...
```

### Conditional Execution
```yaml
jobs:
  release:
    needs: [build-arm64, build-x64]
    if: github.ref_type == 'tag' && success()
    # Only runs on tags and if all dependencies pass
```

### Accessing Dependency Outputs
```yaml
jobs:
  release:
    needs: [build-arm64, build-x64]
    steps:
      - name: Download artifacts from all jobs
        uses: actions/download-artifact@v5
```

**Applicability for Atlas**:
- Release job must `needs: [build-arm64, build-x64]`
- Use `if: success()` to gate on smoke test success
- Tag-driven: `if: github.ref_type == 'tag'`

---

## 4. GitHub Release Creation

### Recommended Action
- **softprops/action-gh-release**: https://github.com/softprops/action-gh-release
  - Latest: v2.5.0 (Dec 1, 2025)
  - Stars: 5.5k
  - Actively maintained
  - Supports draft releases, asset uploads, and multi-file patterns

### Basic Draft Release Pattern
```yaml
- name: Create draft release
  uses: softprops/action-gh-release@v2
  if: github.ref_type == 'tag'
  with:
    draft: true
    generate_release_notes: true
    files: |
      artifacts/host-git-cred-proxy-darwin-arm64.tar.gz
      artifacts/host-git-cred-proxy-darwin-x64.tar.gz
      artifacts/checksums.txt
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Required Permissions
```yaml
permissions:
  contents: write
```

### Key Inputs for Task 19
- `draft: true` - Create as draft (Atlas will publish later)
- `files` - Newline-separated glob patterns for assets
- `tag_name` - Defaults to `github.ref_name`
- `generate_release_notes: true` - Auto-generate from commits
- `fail_on_unmatched_files: true` - Fail if file patterns don't match

### Outputs
```yaml
- uses: softprops/action-gh-release@v2
  id: release
  with:
    # ...
    
- name: Get release URL
  run: echo "Release URL: ${{ steps.release.outputs.url }}"
```

**Applicability for Atlas**:
- Use `draft: true` to create draft releases
- Upload three files: two tarballs + checksums.txt
- Tag-driven trigger: `if: github.ref_type == 'tag'`

---

## 5. Checksum Generation

### Native GitHub Support (Since June 2025)
- **Automatic SHA256 digests**: GitHub now computes and displays SHA256 checksums for all release assets
- Viewable in: GitHub UI, REST API, GraphQL API, gh CLI
- **However**: For download verification, still need explicit checksums.txt

### Manual Checksum Generation

#### Option 1: Shell Script (Recommended for Task 19)
```yaml
- name: Generate checksums
  run: |
    cd artifacts/
    shasum -a 256 host-git-cred-proxy-darwin-*.tar.gz > checksums.txt
    cat checksums.txt
```

#### Option 2: Use Existing Actions
- **thewh1teagle/checksum@v2**: https://github.com/marketplace/actions/checksums-action
  - Supports multiple algorithms
  - Can specify file patterns
  - Generates checksum.txt automatically

```yaml
- uses: thewh1teagle/checksum@v2
  with:
    patterns: |
      *.tar.gz
    algorithm: sha256
    file-name: checksums.txt
```

### Checksum Format (Standard)
```
<sha256-hash>  <filename>
<sha256-hash>  <filename>
```

Example:
```
a1b2c3d4e5f6...  host-git-cred-proxy-darwin-arm64.tar.gz
f6e5d4c3b2a1...  host-git-cred-proxy-darwin-x64.tar.gz
```

**Applicability for Atlas**:
- Generate checksums after downloading all artifacts
- Use `shasum -a 256` for simplicity (no extra action needed)
- Include checksums.txt in release assets

---

## 6. Complete Workflow Pattern for Task 19

### Recommended Structure
```yaml
name: Release

on:
  push:
    tags:
      - 'v*.*.*'

permissions:
  contents: write

jobs:
  build-and-smoke:
    strategy:
      matrix:
        include:
          - runner: macos-14
            target: darwin-arm64
          - runner: macos-14-large
            target: darwin-x64
    runs-on: ${{ matrix.runner }}
    
    steps:
      - uses: actions/checkout@v6
      
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      
      - name: Install dependencies
        run: bun install --frozen-lockfile
      
      - name: Build
        run: bun run build
      
      - name: Package release
        run: bun run package:release
      
      - name: Run smoke tests
        run: bun run smoke:tarball
      
      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: tarball-${{ matrix.target }}
          path: dist/releases/host-git-cred-proxy-${{ matrix.target }}.tar.gz
          retention-days: 5

  release:
    needs: build-and-smoke
    runs-on: ubuntu-latest
    if: success()
    
    steps:
      - uses: actions/checkout@v6
      
      - name: Download all artifacts
        uses: actions/download-artifact@v5
        with:
          path: artifacts/
      
      - name: Generate checksums
        run: |
          cd artifacts/
          shasum -a 256 host-git-cred-proxy-darwin-*.tar.gz > checksums.txt
          cat checksums.txt
      
      - name: Create draft release
        uses: softprops/action-gh-release@v2
        with:
          draft: true
          generate_release_notes: true
          fail_on_unmatched_files: true
          files: |
            artifacts/host-git-cred-proxy-darwin-arm64.tar.gz
            artifacts/host-git-cred-proxy-darwin-x64.tar.gz
            artifacts/checksums.txt
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## 7. Key Constraints from Task 19 Spec

### Must Do
- ✅ Matrix jobs for Intel and Apple Silicon macOS runners
- ✅ Run `bun run package:release` and `bun run smoke:tarball` before publishing
- ✅ Release assets: exactly two tarballs + checksums.txt
- ✅ Draft release (Atlas does final validation)
- ✅ Gate release job on successful smoke tests
- ✅ Tag-driven workflow

### Must NOT Do
- ❌ Rely solely on cross-compilation from non-macOS runner
- ❌ Publish assets without smoke evidence
- ❌ Push Homebrew tap from this task (Task 20)
- ❌ Use retired `macos-13` runner

---

## 8. Testing the Workflow Locally

### Validate YAML Syntax
```bash
# Using actionlint
actionlint .github/workflows/release.yml

# Or using GitHub CLI
gh workflow validate release.yml
```

### Test Matrix Expansion
```bash
# Dry-run to see matrix expansion
gh workflow view release.yml --yaml
```

---

## 9. Quick Reference URLs

### Official GitHub Docs
- Matrix Strategy: https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/run-job-variations
- Artifacts: https://docs.github.com/en/actions/tutorials/store-and-share-data
- Job Dependencies: https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-jobs
- Releases: https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository

### Actions
- softprops/action-gh-release: https://github.com/softprops/action-gh-release
- actions/upload-artifact: https://github.com/actions/upload-artifact
- actions/download-artifact: https://github.com/actions/download-artifact
- oven-sh/setup-bun: https://github.com/oven-sh/setup-bun

### Runner Images
- Runner Images Repo: https://github.com/actions/runner-images
- macOS 26 GA Announcement: https://github.blog/changelog/2026-02-26-macos-26-is-now-generally-available-for-github-hosted-runners/
- Runner Images Issue #13739: https://github.com/actions/runner-images/issues/13739

---

## 10. Notes for Implementation

1. **Runner Selection**: Use `macos-14` (arm64) and `macos-14-large` (x64) - avoid retired `macos-13`

2. **Artifact Naming**: Use matrix variable in artifact names to avoid collisions
   ```yaml
   name: tarball-${{ matrix.target }}
   ```

3. **Smoke Test Gating**: Ensure release job has `needs: [build-and-smoke]` and `if: success()`

4. **Draft vs Published**: Keep `draft: true` for Atlas to validate before publishing

5. **Checksum Generation**: Simple shell command is sufficient:
   ```bash
   shasum -a 256 *.tar.gz > checksums.txt
   ```

6. **File Patterns**: Use explicit file paths in release action to avoid ambiguity

7. **Permissions**: Don't forget `permissions: contents: write` at workflow or job level

---

**End of Reference Document**
