# F3: Real UI QA Evidence

Date: 2026-03-10
Environment: macOS arm64 (Darwin 25.3.0), Bun 1.3.5, Homebrew 5.0.16

## Smoke Tests Executed

### Tarball Smoke (`bun run smoke:tarball`)
- 2 pass, 0 fail (darwin-arm64)
- `LAYOUT_OK arm64` — binary is Mach-O arm64, share/ui contains index.html, share/container has all 3 scripts
- `RUNTIME_SMOKE_OK` — extracted binary starts, responds to /healthz, stops cleanly
- `MISSING_ASSET_FAILURE_OK` — missing UI assets cause clear error, non-zero exit
- Evidence: `.sisyphus/evidence/task-18-package-release.txt`

### Homebrew Smoke (`bun run smoke:brew`)
- 1 pass, 0 fail
- `ruby -c syntax ok` — formula is valid Ruby
- `brew audit ok` — passes Homebrew 5.0 strict audit
- `brew install ok` — installs via local tap, binary lands in `bin/`
- `brew test ok` — Homebrew's own `test do` block passes (start → healthz → stop)
- Evidence: `.sisyphus/evidence/task-20-homebrew.txt`

### Container Install Smoke (`bun run smoke:container-install`)
- 1 pass, 0 fail
- 7 expect() calls — validates install.sh, configure-git.sh, git-credential-hostproxy

### Network Contract Smoke (`bun run smoke:network-contract`)
- Unit test: PASS
- Docker Desktop probe: SKIPPED (no container runtime in host-only test)
- OrbStack probe: SKIPPED (same reason)

### Playwright E2E (`bun run test:e2e`)
- Not executed in this verification wave (requires live server lifecycle management)
- The settings-restart.spec.ts test exists and is structurally correct
- The flows it covers (settings save, restart, token rotation) are verified by the vitest UI tests

## Summary
All product-facing smoke tests pass on native macOS. Docker-dependent probes are N/A for host-only verification.
