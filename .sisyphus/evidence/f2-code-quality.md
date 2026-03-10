# F2: Code Quality Review Evidence

Date: 2026-03-10
Environment: macOS arm64 (Darwin 25.3.0), Bun 1.3.5, Homebrew 5.0.16

## Automated Quality Gates

### Type Checks (`bun run check`)
- `tsc --project tsconfig.host.json --noEmit` — PASS
- `tsc --project host/ui/tsconfig.json --noEmit` — PASS
- `bash -n` shell script syntax check — PASS (6 scripts)

### Host/Container Tests (`bun run test`)
- 113 pass, 10 skip, 0 fail
- 409 expect() calls across 13 files

### UI Tests (`bun run test:ui`)
- 18 pass, 0 fail across 4 files
- vitest 3.2.4 with jsdom environment

## Fixes Applied During Verification

1. **`host/src/services/self-exec.ts`** — Fixed compiled binary re-exec: `$bunfs` virtual paths in `process.argv[1]` caused `Module not found` when spawning `serve` subprocess. Added `$bunfs` path detection to fall through to `process.execPath`.

2. **`tests/release/tarball-smoke.test.ts`** — Increased test timeouts from 5s to 15s (the start command's own 5s health check raced with the default test timeout).

3. **`packaging/homebrew/formula.rb.template`** — Two fixes:
   - Replaced `on_arm`/`on_intel` blocks with `Hardware::CPU.arm?` conditional (Homebrew 5.0 no longer allows `url`/`sha256` inside `on_arm`/`on_intel`).
   - Replaced `system env, cmd` with `with_env(env) { system cmd }` (Homebrew 5.0 Sorbet type checking rejects Hash as first arg to `system`).

4. **`tests/release/smoke-brew.test.ts`** — Rewrote to use proper local tap (Homebrew 5.0 disabled `brew audit [path]`). Now creates git-initialized tap at `Library/Taps/test-hgcp/homebrew-smoke/`.

5. **UI test mocking** — Switched from `vi.mock()` module factory (broken in vitest 3.x) to `vi.spyOn()` on the actual `adminClient` singleton. Fixed 4 test files.

6. **`package.json` `test` script** — Fixed path from `host/src` (no tests) to `tests/host tests/container`.
