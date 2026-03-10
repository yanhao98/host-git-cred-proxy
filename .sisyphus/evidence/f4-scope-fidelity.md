# F4 Scope Fidelity Check

**Date**: 2026-03-10
**Verdict**: APPROVE

---

## Must Have Verification

### 1. Preserve `/healthz`, `/fill`, `/approve`, `/reject` semantics
**PASS**. All four routes are registered in `host/src/routes/proxy.ts` lines 20-25. Legacy aliases `/get`, `/store`, `/erase` are also preserved (lines 26-28). Bearer token validation is enforced on action routes (line 51). Tests in `tests/host/routes-proxy-container.test.ts` and `tests/host/proxy-characterization.test.ts` confirm full semantic parity.

### 2. Default state dir: `~/Library/Application Support/host-git-cred-proxy` on macOS, fallback `~/.local/state/host-git-cred-proxy`
**PASS**. Implemented in `host/src/services/state-dir.ts` lines 45-51. `defaultStateDir()` returns `~/Library/Application Support/host-git-cred-proxy` when `platform() === 'darwin'`, otherwise `~/.local/state/host-git-cred-proxy`. Environment override via `GIT_CRED_PROXY_STATE_DIR` is supported (line 19-20). Directory permissions are 0o700, file permissions 0o600.

### 3. Default listen address `127.0.0.1:18765`; `publicUrl` remains explicit config
**PASS**. Defaults set in `host/src/services/config.ts` lines 20-22: `host: '127.0.0.1'`, `port: 18765`, `publicUrl: 'http://host.docker.internal:18765'`. Server defaults confirmed in `host/src/server.ts` lines 13-14. The publicUrl is explicit config, not derived from trust.

### 4. Explicit route separation and guards: proxy/container routes reachable from containers; UI/admin loopback-only with Origin + X-Admin-Nonce on non-GET admin requests
**PASS**. Admin guard in `host/src/middleware/admin-guard.ts`:
- Line 25-26: Rejects non-loopback IPs with "Admin access requires loopback"
- Line 29-31: GET requests allowed without nonce (read-only)
- Line 33-35: Non-GET requires matching Origin header
- Line 37-39: Non-GET requires valid X-Admin-Nonce header
- UI routes in `host/src/routes/ui.ts` line 83 also enforce loopback.
- Proxy/container routes have no loopback restriction, allowing container access.

### 5. Token rotation updates server-side auth immediately; mounted-directory container flows work without reinstall
**PASS**. `host/src/services/token.ts`:
- `rotate()` (line 51-66) writes the new token to a temp file, then atomically renames it into place, then updates the in-memory token (`this.token = nextToken`, line 61).
- Server-side validation immediately uses the new token value because `validateBearer()` reads `this.token` (line 48).
- Container helper (`container/git-credential-hostproxy`) reads from a mounted token file at request time (line 22-29), so it picks up the rotated token via the mounted directory without reinstall.

### 6. Release packaging: binary to `bin/`, static assets/helpers to `share/host-git-cred-proxy/`
**PASS**. `scripts/package-release.ts` lines 148-179 stage the layout: binary at `bin/host-git-cred-proxy`, UI assets at `share/host-git-cred-proxy/ui/`, container helpers at `share/host-git-cred-proxy/container/`. Homebrew formula (`dist/homebrew/host-git-cred-proxy.rb`) installs to matching paths (lines 16-17).

---

## Must NOT Have Verification

### 1. No repo-relative runtime paths in product mode
**PASS**. The state directory resolution in `host/src/services/state-dir.ts` uses either `GIT_CRED_PROXY_STATE_DIR` env var or the platform-specific default under the user's home directory. No paths relative to `process.cwd()` or `import.meta.dir` are used for runtime state. Container asset resolution in `host/src/routes/container.ts` lines 48-51 first checks the share directory (installed layout), then falls back to the repo-relative path only for development.

### 2. No Node/Bun dependency in the container helper
**PASS**. `container/git-credential-hostproxy` is a pure POSIX `#!/bin/sh` script using only `sh`, `curl`, `cat`, `mktemp`, `chmod`, `printf`, and `tr`. No `node`, `bun`, `npm`, or `npx` invocations. `container/install.sh` and `container/configure-git.sh` are likewise POSIX shell only.

### 3. No UI token plaintext display
**PASS**. The admin API bootstrap endpoint (`host/src/routes/admin.ts` line 71) returns `tokenFilePath` (a filesystem path string), never the token value itself. The token rotate endpoint (line 131) also returns only `tokenFilePath`. UI components (`host/ui/src/pages/Overview.tsx` line 39, `host/ui/src/pages/Settings.tsx` line 209) display only the file path. A dedicated test in `host/ui/src/pages/overview-setup.test.tsx` lines 127-132 asserts no 64-char hex string (token format) appears in rendered content.

### 4. No raw credential body, Authorization header, username, password, or OAuth token logging
**PASS**. The audit log schema in `host/src/services/request-log.ts` lines 8-17 records only: `time`, `action`, `protocol`, `host`, `path`, `statusCode`, `outcome`, `durationMs`. The `sanitizeAuditEvent()` function (lines 60-71) explicitly constructs a clean object from only those fields. No credential body, authorization header, username, password, or OAuth token is ever logged.

### 5. No launchd/auto-start
**PASS**. No `.plist` files exist anywhere in the repository. No references to `launchd`, `LaunchAgent`, or `LaunchDaemon` in any source file. The grep found these terms only in the plan document itself.

### 6. No SSE/WebSocket
**PASS**. No imports of `WebSocket`, `EventSource`, or `Server-Sent` in any source file. No `text/event-stream` content type. The only SSE/WebSocket references are in the plan document and in `IMPLEMENTATION_PLAN.md` (which notes the MVP uses polling, not SSE/WebSocket).

### 7. No remote admin
**PASS**. Admin guard enforces loopback-only access (see Must Have #4 above). Non-loopback IPs are rejected with 403 for all admin and UI routes.

### 8. No multi-user support
**PASS**. Single token, single state directory, single server instance. No user accounts, sessions, or multi-tenant logic anywhere.

### 9. No npm-first distribution
**PASS**. `package.json` line 4: `"private": true`. No `publishConfig`, no `"files"` field, no `"main"` field, no `.npmrc` file. Distribution is exclusively via GitHub Releases tarballs and Homebrew formula.

### 10. No Windows or Linux first-class release work
**PASS**. Release targets in `scripts/package-release.ts` lines 30-41 are exclusively `darwin-arm64` and `darwin-x64`. The GitHub Actions workflow (`.github/workflows/release.yml`) runs only on `macos-14` and `macos-14-large` runners. No `.exe`, `.msi`, `.deb`, or `.rpm` artifacts. The `win32` reference in `host/src/services/process-manager.ts` line 622 is a graceful fallback in the browser-open utility, not a release target.

### 11. No silent deletion of non-hostproxy existing `credential.helper` entries
**PASS**. `container/configure-git.sh` lines 46-59: Existing helpers are preserved in `new_helpers_tmp` (line 55) unless they match `*/git-credential-hostproxy` (line 52-53). Only old hostproxy entries are removed; all other credential helpers are kept.

### 12. No UI/admin trust based on publicUrl, CORS, or static-plugin defaults alone
**PASS**. Admin trust is based on the three-layer check in `host/src/middleware/admin-guard.ts`: loopback IP verification, Origin header matching against `panelOrigin`, and X-Admin-Nonce validation. The `publicUrl` is used for container-facing configuration only, not for admin trust decisions.

---

## Container Onboarding Verification

**PASS**. Container onboarding uses host download routes:
- `install.sh` downloaded via `curl -fsSL <publicUrl>/container/install.sh | sh`
- Install script downloads `configure-git.sh` and `git-credential-hostproxy` from the host service (`container/install.sh` lines 59-60)
- Token access uses directory mounting, not repo mounts: `install.sh` line 69 instructs "Mount your host token directory to /run/host-git-cred-proxy (read-only)"
- Default token file path is `/run/host-git-cred-proxy/token` (line 5)

---

## Release Output Verification

**PASS**. Release output is GitHub Releases + Homebrew tap only:
- GitHub Release workflow (`.github/workflows/release.yml`) produces draft releases with darwin-arm64 and darwin-x64 tarballs plus checksums
- Homebrew formula template at `dist/homebrew/host-git-cred-proxy.rb` installs from release tarballs
- No npm publish, no Docker images, no Linux/Windows package manager configs
- `package.json` is `"private": true`

---

## Summary

All 6 Must Have requirements are confirmed implemented. All 12 Must NOT Have guardrails are confirmed absent. Container onboarding correctly uses host download routes and token-directory mounting. Release output is exclusively GitHub Releases and Homebrew tap.

**Verdict: APPROVE** -- the codebase matches MVP scope exactly with no forbidden extras detected.
