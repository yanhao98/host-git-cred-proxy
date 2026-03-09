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
