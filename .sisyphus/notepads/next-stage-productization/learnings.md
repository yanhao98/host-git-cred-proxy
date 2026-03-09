# Learnings

## Initial Context
- Repo is a script-bound prototype: `host/server.mjs`, shell scripts, `container/helper.mjs`
- No test infrastructure, no CI, no release automation exists yet
- Current prototype uses repo-relative paths everywhere — product must not
- Bun is the target runtime; Node is NOT a product dependency
- Container helper must be pure POSIX sh + curl (no Node/Bun)

## Task 2 Workspace Scaffold
- Canonical `check` can combine `tsc --noEmit` for host + UI with `bash -n` syntax checks on retained shell scripts.
- With `host/ui/vite.config.ts`, setting `root: 'host/ui'` and `build.outDir: 'dist'` produces build output at `host/ui/dist` from repo root.
- Keep legacy `host/server.mjs` and shell helpers in place for characterization reference while scaffolding new Bun/TypeScript entrypoints in `host/src`.

## Task 1 Network Contract Specs
- Contract tests can remain executable during parallel scaffolding by using declaration assertions plus runtime smoke tests gated behind a dedicated `startServerForTests`/`startHostServerForTests` export.
- Route contract should be frozen explicitly in test constants: bind defaults (`127.0.0.1:18765`), route precedence (`/healthz` → proxy actions → `/container/*` → `/api/admin/*` → `/assets/*` → `/`), and `publicUrl` as config-only metadata.
- Smoke runner should always emit explicit vendor skip markers (`SKIPPED_DOCKER_DESKTOP_NOT_INSTALLED`, `SKIPPED_ORBSTACK_NOT_INSTALLED`) so absence of Docker/OrbStack is recorded as evidence, not silent pass.

## Task 3 Proxy Characterization
- Reliable host-side characterization can stub `git credential` deterministically by prepending a temp PATH shim (`git` wrapper) that dispatches into `tests/fixtures/git-credential-stub.sh`; this avoids touching real keychains/helpers.
- `host/server.mjs` alias routes are behaviorally active today (`/get`, `/store`, `/erase`) and must remain mapped to `fill`, `approve`, `reject` until explicitly removed by a contract change.
- The subprocess contract is observable in tests via stub logs: every credential invocation currently carries `GIT_TERMINAL_PROMPT=0`.
- Oversized body enforcement (`> 64 KiB`) is branch-covered, but current runtime can surface either HTTP `500 Request body too large` or client-side `ECONNRESET` because the implementation rejects then destroys the request stream (`req.destroy()`).

## Task 4 State + Config + Asset Resolution
- Keep state ownership in dedicated services: `resolveStateDir()` handles platform/env resolution + `0700` directory permissions, while `ensureStateFile()` enforces `0600` file permissions consistently.
- `loadConfig()` should materialize `config.json` defaults when missing, then normalize user/env inputs without deriving trust behavior from `publicUrl`.
- For asset lookup, a resilient order works well: explicit `GIT_CRED_PROXY_SHARE_DIR` override first, installed `bin/../share/host-git-cred-proxy` second, then repo-dev fallback (`host/ui/dist` + `container/`) with explicit errors when layout is invalid.

## Task 9 Admin Security Primitives
- Treat loopback normalization as a dedicated utility: strip IPv4-mapped IPv6 (`::ffff:`) before trust checks so Bun/Elysia `requestIP()` results behave consistently for localhost traffic.
- Admin browser writes should remain a three-part gate: loopback source, exact `Origin` match, and a separate in-memory admin nonce; plain GET admin reads only need loopback.
- Denial responses can stay simple JSON `403` objects with no `Access-Control-*` headers to preserve a no-CORS admin surface.

## Task 5 Token + Audit + Server Log Services
- Token lifecycle should match legacy shell behavior exactly: 32-byte random value encoded as 64 hex chars, persisted in `token`, and rotated atomically via `token.tmp` + `rename` in the same state directory.
- Audit events should be runtime-sanitized to an allowlist schema before writing NDJSON so even incorrectly-cast inputs cannot persist credential fields (`username`, `password`, `authorization`, `oauth_token`, raw body).
- Bounded log retention is easiest to reason about as tail-preservation: if `server.log` exceeds 5 MiB, rewrite with only the last `maxBytes` bytes, preserving latest diagnostics while controlling growth.

## Task 6 Git Credential Service Layer
- Porting proxy core into a typed service works cleanly when `handleCredentialRequest` returns audit-ready metadata (`protocol`, `host`, `path`) alongside `status/body/outcome`.
- `ACTION_MAP` alias behavior (`get/store/erase`) is now unit-testable without HTTP by exercising the service directly and asserting stubbed git actions.
- Missing credential compatibility must stay signature-based (`terminal prompts disabled`, `could not read username`, `could not read password`) and still resolve to `200` with an empty body.
- Reusing the PATH-shim git stub harness from characterization tests keeps subprocess behavior deterministic and verifies `GIT_TERMINAL_PROMPT=0` on every invocation.

## Task 7 Proxy + Container Route Tree
- Elysia route plugins are easier to keep type-safe with explicit chained route declarations than dynamic loop registration; this avoids generic inference conflicts when returning plugin instances.
- Preserving legacy alias routes (`/get`, `/store`, `/erase`) in the HTTP layer while delegating action mapping to `handleCredentialRequest` keeps behavior frozen and minimizes duplicate logic.
- Serving `/container/configure-git.sh` and `/container/git-credential-hostproxy` through `resolveShareDir()` with repo fallback keeps download routes install-layout-safe and still reliable in dev/test.
- A dedicated `/api/admin/*` guarded 404 catch-all preserves reserved-prefix precedence before SPA/static fallback is introduced in later tasks.

## Task 8 CLI + Process Manager
- Detached lifecycle is reliable when `start` preflights stale PID cleanup, probes port availability, then `Bun.spawn(["bun", "run", <entrypoint>, "serve"], { detached: true })` with `unref()` and append-mode `server.log` fds.
- PID trust needs two checks together: `process.kill(pid, 0)` for liveness plus `ps -p <pid> -o command=` marker matching for host-git-cred-proxy ownership before stop/status can act.
- `runtime.json` is the stable runtime contract surface for CLI/status/open; writing `{ pid, startedAt, listenUrl, panelUrl, version, stateDir }` at serve boot keeps start/status/open output deterministic across cwd changes.
- Rewrite container/git-credential-hostproxy as pure POSIX sh + curl to remove Node/Bun dependency in containers.
- POSIX sh compatibility: avoid bashisms like [[ ]], local, and arrays.
- Used mktemp for response body to handle large outputs and separate http_code from body.
- Testing: spawnSync blocks Bun event loop, preventing Bun.serve from responding. Use asynchronous spawn (Bun.spawn or child_process.spawn) in tests.

## Task 10 Admin API Contract
- Admin API route plugin is easiest to keep contract-stable when each endpoint is explicit (`.get/.post`) and all share the same `beforeHandle` hook wiring from `createAdminGuard`.
- In Elysia handlers, prefer `context.body` for JSON POST payloads; calling `request.json()` can fail after framework parsing consumes the request stream.
- `runtime.json` parsing should be strict and nullable: treat missing/empty/invalid payloads as `null` for bootstrap, and only fall back to `{ pid: process.pid, startedAt: now }` in status where required.
- Bounded log API behavior is deterministic by line-tail slicing: split log into lines, drop trailing empty newline, return the newest 200 and a `truncated` flag when more exist.
- Existing characterization tests that assumed admin 404 must be updated once real admin routes land to keep full-suite regression signals meaningful.

## Task 10 Admin API Tests (follow-up)
- Admin-guarded endpoint tests are most reliable with a real `app.listen({ port: 0 })` server + `fetch`; `app.handle(new Request(...))` does not consistently provide request IP context for loopback checks.
- For POST admin endpoints, test helpers should always attach both `Origin: new URL(config.publicUrl).origin` and `X-Admin-Nonce: adminNonceService.getNonce()` or guard rejections will mask route-contract assertions.
- Updating reserved-prefix regression tests from `404` to explicit JSON payload assertions (`running`, `pid`, `startedAt`) avoids false positives from content-type-only checks.

## Task 10 Admin Origin Trust Fix (live QA regression)
- Admin POST Origin trust must be derived from the local panel/listen origin (`http://<listen-host>:<listen-port>`), never from `config.publicUrl` (container-facing metadata).
- Regression coverage should assert both directions in one test: local loopback origin + valid nonce succeeds, while `publicUrl` origin + same nonce is rejected with trusted-Origin `403`.
- `startServer()` should propagate runtime host/port overrides into the config passed to route wiring so admin guard origin checks stay aligned with the actual bound listener.

## Task 16 Rewriting configure-git.sh
- Switched to "installed-command mode": configure `credential.helper` to just `git-credential-hostproxy`.
- Implemented safe helper-chain mutation in pure POSIX sh using `mktemp` and temporary files to handle list manipulation.
- Instead of wiping helpers, we now ensure `git-credential-hostproxy` is the FIRST helper while preserving others in their original order.
- Migration logic now automatically removes old-style path-based hostproxy entries (e.g. `/path/to/git-credential-hostproxy`).
- `git config --get-all` and `--unset-all` must handle exit status 1 with `|| true` when the key is missing to avoid script failure under `set -e`.
- Testing git configuration requires isolating `$HOME` to prevent accidental modification of real global config.

## Quoting and Command Construction in POSIX sh
- Avoid building multi-word commands in variables (e.g. `cmd="git -C  config"`) if any word might contain spaces.
- Using shell functions with `"$@"` is the robust POSIX sh way to wrap commands with dynamic arguments or options while maintaining quoting integrity.

## Task 17 Container Installer + Onboarding Refresh
- `/container/install.sh` is now backed by the real `container/install.sh` asset and templated at response time with the current `publicUrl`.
- Installer behavior is now explicit for permission failures: default `/usr/local/bin` writes must succeed, otherwise the error message names `INSTALL_DIR` as the supported fix.
- Updated onboarding examples remove `host-git-cred-proxy` source-tree mounts and instead use install-from-host plus token-directory mounts (`/run/host-git-cred-proxy/token`).
- Added `smoke:container-install` coverage that fetches installer over HTTP and verifies executable installs into a temp `INSTALL_DIR`.

## Task 11 UI Host Integration Fix
- Root-mounting `@elysiajs/static` at `/` can interfere with non-UI traffic under Bun/Elysia and surface proxy POST regressions as `500 Body already used`.
- The resilient pattern is explicit GET-only UI routing: `GET /` serves `index.html`, `GET /assets/*` serves dist assets, and the final SPA fallback is GET-only and reserved-prefix-aware.
- Loopback enforcement for panel pages should be route-scoped to UI GET handlers, not plugin-wide, so proxy/container/admin behavior stays untouched.
- `host/ui/src/App.test.tsx` can remain the canonical plan file while avoiding broad `bun test` failures by skipping the suite when `document` is unavailable.
