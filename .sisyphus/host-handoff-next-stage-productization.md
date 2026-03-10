# Host Handoff: Next-Stage Productization

This document outlines the current implementation status, verified evidence, remaining blockers, and exact next commands to run on the host machine. The current container environment lacks `brew` and `ruby`, and cannot perform native macOS runtime smoke tests.

## Status Table

| Task | Status | Description |
|---|---|---|
| Task 12 | ✅ Complete | Implement Overview and Setup sections |
| Task 13 | ✅ Complete | Implement Requests and Logs sections |
| Task 14 | ✅ Complete | Implement Settings save/restart/reconnect UX |
| Task 18 | ⚠️ Blocked | Add deterministic build/package scripts (Needs macOS smoke) |
| Task 19 | ✅ Complete | Add GitHub Actions release workflow |
| Task 20 | ⚠️ Blocked | Add Homebrew formula generation and smoke tests (Needs `brew`) |
| Final Verification Wave | ⏳ Unchecked | F1-F4 verification tasks |

## Blocked In Container

The following environment blockers prevent full verification inside the current Linux container:
- **Missing `brew`**: Homebrew is not installed, blocking `bun run smoke:brew` (Task 20).
- **Missing `ruby`**: Required for Homebrew formula testing.
- **Non-macOS OS**: Native macOS runtime smoke tests (`smoke:tarball`) cannot be executed (Task 18).

## Implementation Details (Tasks 18-20)

### Relevant File Paths Added/Changed
- `.github/workflows/release.yml`
- `scripts/package-release.ts`
- `tests/release/tarball-smoke.test.ts`
- `packaging/homebrew/formula.rb.template`
- `scripts/generate-formula.ts`
- `scripts/publish-homebrew-formula.ts`
- `tests/release/smoke-brew.test.ts`
- `package.json`

### Evidence Paths Already Produced
- `.sisyphus/evidence/task-18-package-release.txt` (Shows Linux skipped native runtime smoke)
- `.sisyphus/evidence/task-20-homebrew-error.txt` (Shows missing Homebrew in container)

## First Commands On Host

Run these exact commands in order on the host machine (macOS) to complete the blocked tasks:

1. **Task 18 (macOS Tarball Smoke)**:
   ```bash
   bun run package:release
   bun run smoke:tarball
   ```
   *Note: Task 18 is implemented but still needs native macOS `smoke:tarball` evidence to satisfy plan intent.*

2. **Task 20 (Homebrew Smoke)**:
   ```bash
   bun run smoke:brew
   ```
   *Note: Task 20 implementation exists but `bun run smoke:brew` currently fails because Homebrew is unavailable in container.*

3. **Final Verification Wave**:
   Proceed with F1-F4 verification tasks as defined in the plan.

## Do Not Redo

- Do NOT rewrite the implementation for Tasks 18, 19, or 20. The code is already written and just needs host-side verification.
- Do NOT modify the GitHub Actions release workflow (`.github/workflows/release.yml`).
- Do NOT modify the Homebrew formula generation scripts unless host-side testing reveals a specific bug.
