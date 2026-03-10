# host-git-cred-proxy Next-Stage Productization

## TL;DR
> **Summary**: Rebuild the current script-bound prototype into a Bun + Elysia + React/Vite local product that installs and runs without repo mounting, preserves existing Git credential proxy semantics, and ships as macOS tarballs plus a Homebrew tap.
> **Deliverables**:
> - Bun/TypeScript host service with single-port proxy/admin/UI/container-download routing
> - React/Vite local Web panel
> - POSIX `sh + curl` container helper/install/configure flow
> - User-state-dir runtime model with redacted audit logging
> - GitHub Releases packaging and Homebrew tap automation
> **Effort**: XL
> **Parallel**: YES - 4 waves
> **Critical Path**: 1 → 2 → 3 → 4 → 6 → 7 → 8 → 9 → 10 → 11 → 14 → 15 → 16 → 18 → 19 → 20

## Context
### Original Request
- Produce an implementation plan from `IMPLEMENTATION_PLAN.md` for the next-stage productization of `host-git-cred-proxy`.

### Interview Summary
- No extra product interview was required because `IMPLEMENTATION_PLAN.md` already fixes the main architecture: Bun + Elysia host service, React + Vite UI, one port, shell helper, state dir outside repo, GitHub Releases, Homebrew tap, macOS-first.
- Repo exploration confirmed the current prototype is still repo-bound: `host/server.mjs`, `host/start.sh`, `host/stop.sh`, `host/status.sh`, `container/helper.mjs`, `container/configure-git.sh`, `container/git-credential-hostproxy`, example compose/devcontainer files, and no UI/test/CI/release scaffolding.
- Defaults applied for planning: keep standalone `container/configure-git.sh`, use `tests-after` with fresh test infrastructure, keep release assets external under `share/host-git-cred-proxy/*`, and treat code signing/notarization as out of MVP.

### Metis Review (gaps addressed)
- Freeze runtime asset lookup across dev, tarball, and Homebrew installs before implementation.
- Freeze container token provisioning and rotation semantics before helper rewrite.
- Freeze process supervision/restart contract before exposing UI restart flows.
- Do not silently wipe pre-existing Git credential helpers; reorder/preserve them safely.
- Add explicit route precedence, SPA fallback exclusions, bounded log growth, and no secret logging.
- Expand acceptance coverage to stale PID, port-in-use, restart recovery, non-loopback denial, token rotation, and package smoke tests.

## Work Objectives
### Core Objective
Ship an installable local product that preserves today’s proven credential-proxy behavior while removing all repo-path/runtime assumptions and adding a loopback-only admin/UI surface on the same port.

### Deliverables
- `host/src/*` Bun + TypeScript service and CLI
- `host/ui/*` React + Vite app with built assets consumed by the host service
- `container/install.sh`, `container/configure-git.sh`, `container/git-credential-hostproxy`
- Release packaging scripts for `darwin-arm64` and `darwin-x64`
- GitHub Actions release workflow
- Homebrew tap formula automation

### Definition of Done (verifiable conditions with commands)
- `bun test` passes for host/service logic and container script smoke coverage.
- `bun run test:ui` passes for React/Vite unit tests.
- `bun run test:e2e` passes for Playwright panel flows.
- `bun run build` produces host binary and UI assets.
- `bun run package:release` emits both tarballs plus checksums under `dist/releases/`.
- `bun run smoke:tarball` starts the packaged binary from an arbitrary cwd using a temp state dir and returns `ok` from `/healthz`.
- `bun run smoke:brew` passes `brew audit --strict`, `brew install --build-from-source`, and `brew test` against the formula.

### Must Have
- Preserve `/healthz`, `/fill`, `/approve`, `/reject` semantics from `host/server.mjs`.
- Default state dir: `~/Library/Application Support/host-git-cred-proxy` on macOS, fallback `~/.local/state/host-git-cred-proxy` elsewhere.
- Default listen address `127.0.0.1:18765`; `publicUrl` remains explicit config, not derived trust.
- Explicit route separation and explicit guards: proxy/container routes may be reachable from containers; UI/admin are loopback-only, with `Origin` + `X-Admin-Nonce` on non-GET admin requests.
- Token rotation updates server-side auth immediately and keeps mounted-directory container flows working without reinstall.
- Release packaging installs binary to `bin/` and static assets/helpers to `share/host-git-cred-proxy/`.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- No repo-relative runtime paths in product mode.
- No Node/Bun dependency in the container helper.
- No UI token plaintext display.
- No raw credential body, `Authorization` header, username, password, or OAuth token logging.
- No launchd/auto-start, SSE/WebSocket, remote admin, multi-user support, npm-first distribution, Windows, or Linux-first release work.
- No silent deletion of non-hostproxy existing `credential.helper` entries.
- No UI/admin trust based on `publicUrl`, CORS, or static-plugin defaults alone.

## Verification Strategy
> ZERO HUMAN INTERVENTION — all verification is agent-executed.
- Test decision: `tests-after` with new infrastructure: `bun test` for host/service logic and scriptable smoke coverage, `vitest`/Testing Library for UI units, Playwright for browser/admin flows.
- QA policy: Every task includes executable happy-path and failure/edge scenarios.
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. Extract shared foundations early.

Wave 1: foundation contracts, scaffolding, characterization, state/config/resource services, token/logging policy

Wave 2: host core routing, CLI/process management, admin security, admin APIs

Wave 3: UI shell/pages/settings UX, shell helper rewrite

Wave 4: container onboarding, packaging, release automation, Homebrew automation

### Dependency Matrix (full, all tasks)
| Task | Depends On |
|---|---|
| 1 | — |
| 2 | — |
| 3 | 2 |
| 4 | 2 |
| 5 | 4 |
| 6 | 3, 4, 5 |
| 7 | 1, 4, 6 |
| 8 | 4, 6 |
| 9 | 1, 4 |
| 10 | 5, 7, 9 |
| 11 | 2, 10 |
| 12 | 10, 11 |
| 13 | 10, 11 |
| 14 | 10, 11 |
| 15 | 1, 6 |
| 16 | 15 |
| 17 | 15, 16 |
| 18 | 2, 4, 7, 12, 13, 14, 17 |
| 19 | 18 |
| 20 | 18, 19 |

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 5 tasks → deep, quick, unspecified-high
- Wave 2 → 5 tasks → deep, unspecified-high, quick
- Wave 3 → 5 tasks → visual-engineering, deep, quick
- Wave 4 → 5 tasks → deep, writing, unspecified-high

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Lock the bind/interface and route-precedence contract with executable smoke proofs

  **What to do**: Add a smoke-test harness that starts the new service with a temp state dir and validates the supported network contract on macOS: default `host=127.0.0.1`, `publicUrl=http://host.docker.internal:18765`, explicit loopback-only denial for UI/admin, and exact route precedence (`/healthz`, `/fill|approve|reject`, `/container/*`, `/api/admin/*`, `/assets/*`, `/`). If container access to `127.0.0.1` via `host.docker.internal` fails in a supported environment, do **not** change the default; instead, prove the documented fallback works by setting `host=0.0.0.0` while keeping UI/admin non-loopback denial intact.
  **Must NOT do**: Do not broaden the default bind address; do not add CORS-based trust; do not let SPA fallback intercept `/api/*` or `/container/*`.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: cross-cutting network/security contract that affects routing, examples, and packaging.
  - Skills: `[]` — no extra skill required.
  - Omitted: `[frontend-ui-ux]` — not a UI design task.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: [7, 9, 16, 17] | Blocked By: []

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `IMPLEMENTATION_PLAN.md:90-160` — single-port and route-layering baseline.
  - Pattern: `IMPLEMENTATION_PLAN.md:218-256` — config schema and `host/publicUrl` semantics.
  - Pattern: `README.md:49-52` — current default host/port/public URL behavior.
  - Pattern: `host/server.mjs:128-188` — current route matching and proxy auth flow.
  - External: `https://elysiajs.com/plugins/static` — static serving behavior; use only after explicit route guards.
  - External: `https://context7.com/elysiajs/documentation/llms.txt` — `.group`/`.guard` route grouping examples.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun run smoke:network-contract` writes a matrix file proving: loopback browser access succeeds, non-loopback admin/UI access fails, and `/api/*` plus `/container/*` are never shadowed by SPA fallback.
  - [ ] The smoke harness supports two modes: default `127.0.0.1` and documented fallback `0.0.0.0`; the fallback is only exercised when the default container path is unreachable.
  - [ ] The matrix evidence records whether Docker Desktop and/or OrbStack were available, and emits `SKIPPED_<vendor>_NOT_INSTALLED` instead of a silent pass.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Default bind contract works on supported host
    Tool: Bash
    Steps: Run `bun run smoke:network-contract --vendor=docker-desktop --host=127.0.0.1 --port=18765`; start the service with a temp state dir; curl `http://127.0.0.1:18765/healthz`; if Docker is available, run `docker run --rm curlimages/curl:8.7.1 curl -fsS http://host.docker.internal:18765/healthz`
    Expected: Local curl returns `ok`; container curl either returns `ok` or triggers the scripted fallback path and records it explicitly
    Evidence: .sisyphus/evidence/task-1-network-contract.txt

  Scenario: Non-loopback UI/admin access is denied
    Tool: Bash
    Steps: Start the service in fallback bind mode (`0.0.0.0`); request `/api/admin/status` and `/` through the machine's non-loopback interface or a container path that is not loopback
    Expected: Requests are rejected with the contractually defined denial status/body; `/healthz` and `/container/install.sh` remain reachable
    Evidence: .sisyphus/evidence/task-1-network-contract-error.txt
  ```

  **Commit**: YES | Message: `test(network): lock bind and route contract` | Files: `host/`, `package.json`, `tests/`, `scripts/`

- [x] 2. Scaffold the Bun + TypeScript + Vite workspace and canonical project scripts

  **What to do**: Replace the current minimal manifest with a Bun-first workspace that supports `host/src`, `host/ui`, shared TypeScript config, Vite build output under `host/ui/dist`, and canonical scripts: `check`, `test`, `test:ui`, `test:e2e`, `build:host`, `build:ui`, `build`, `package:release`, `smoke:tarball`, `smoke:brew`, `smoke:network-contract`. Keep `host/server.mjs` and current shell scripts available only long enough for characterization tests; do not wire new product behavior through them.
  **Must NOT do**: Do not keep Node as a product runtime dependency; do not add a second web server; do not embed UI assets into the Bun binary for MVP.

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: mostly deterministic scaffolding and script wiring.
  - Skills: `[]` — no special skill required.
  - Omitted: `[git-master]` — no git operation required inside the task itself.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: [3, 4, 11, 18] | Blocked By: []

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `IMPLEMENTATION_PLAN.md:524-564` — target repo structure.
  - Pattern: `IMPLEMENTATION_PLAN.md:571-602` — phase ordering and initial host/UI deliverables.
  - Pattern: `package.json:1-16` — current script surface that must be superseded.
  - External: `https://bun.sh/docs/bundler/executables` — Bun compile/build target model.
  - External: `https://elysiajs.com/patterns/deploy` — Bun/Elysia production build context.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun install` succeeds from repo root without requiring Node/npm.
  - [ ] `bun run check` performs typecheck/lint-equivalent validation and script syntax checks without starting the service.
  - [ ] `bun run build:ui` emits `host/ui/dist/index.html` plus asset files.
  - [ ] `bun run build:host` emits the host build artifact expected by later package tasks.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Fresh workspace bootstraps and builds
    Tool: Bash
    Steps: Run `bun install`, `bun run check`, `bun run build:ui`, and `bun run build:host`
    Expected: All commands exit 0; `host/ui/dist/index.html` exists; host build output exists in the documented location
    Evidence: .sisyphus/evidence/task-2-workspace-build.txt

  Scenario: Legacy prototype is no longer the product entrypoint
    Tool: Bash
    Steps: Inspect the generated script graph by running `bun run build`; verify it does not invoke `host/server.mjs` or `container/helper.mjs` as runtime dependencies
    Expected: Build succeeds using the new Bun/TypeScript structure only
    Evidence: .sisyphus/evidence/task-2-workspace-build-error.txt
  ```

  **Commit**: YES | Message: `chore(workspace): scaffold bun typescript vite structure` | Files: `package.json`, `bunfig.toml`, `tsconfig*.json`, `host/src/`, `host/ui/`, `scripts/`

- [x] 3. Add characterization tests that freeze the current proxy semantics before migration

  **What to do**: Create host-side characterization tests that exercise the existing semantics from `host/server.mjs`: `GET /healthz`, Bearer token enforcement, `protocol` whitelist, `host` whitelist, 64 KiB body cap, `GIT_TERMINAL_PROMPT=0`, git action mapping, and `fill` missing-credential compatibility (`200` + empty body). Use fixture subprocesses/stubs for `git credential` calls so the tests stay deterministic and do not depend on the machine keychain.
  **Must NOT do**: Do not rely on the developer’s real Git credential helper; do not collapse `fill` missing-credential into an error; do not postpone these tests until after the rewrite.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: preserves behavioral contract across the rewrite.
  - Skills: `[]` — no special skill required.
  - Omitted: `[playwright]` — non-browser task.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: [6, 8, 10] | Blocked By: [2]

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `host/server.mjs:30-37` — action map.
  - Pattern: `host/server.mjs:39-54` — credential body parser.
  - Pattern: `host/server.mjs:56-80` — request body reader and 64 KiB limit.
  - Pattern: `host/server.mjs:82-110` — `git credential` subprocess behavior.
  - Pattern: `host/server.mjs:119-126` — missing-credential detection.
  - Pattern: `host/server.mjs:132-188` — route/auth/deny behavior.
  - Pattern: `IMPLEMENTATION_PLAN.md:110-122` — proxy route contract.
  - Pattern: `IMPLEMENTATION_PLAN.md:258-299` — audit and outcome expectations.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun test tests/host/proxy-characterization.test.ts` covers success, deny, bad request, missing credential, and oversize body cases.
  - [ ] Tests verify the exact missing-credential compatibility: status `200` and empty body for `fill` when Git reports prompt-disabled/no username/no password.
  - [ ] Tests verify that `approve` and `reject` map to `git credential approve` and `git credential reject`, respectively.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Characterization suite freezes known-good behavior
    Tool: Bash
    Steps: Run `bun test tests/host/proxy-characterization.test.ts`
    Expected: All assertions pass and fixture subprocess logs show `GIT_TERMINAL_PROMPT=0`
    Evidence: .sisyphus/evidence/task-3-proxy-characterization.txt

  Scenario: Oversize and missing-auth failures are explicit
    Tool: Bash
    Steps: Run the targeted tests for body > 65536 bytes and missing `Authorization` header
    Expected: Oversize request fails with the documented status/body; unauthorized request fails without invoking the git fixture
    Evidence: .sisyphus/evidence/task-3-proxy-characterization-error.txt
  ```

  **Commit**: YES | Message: `test(proxy): add characterization coverage` | Files: `tests/host/`, `fixtures/`, `package.json`

- [x] 4. Implement state-dir, config-schema, and installed-resource resolution services

  **What to do**: Implement `state-dir.ts`, `config.ts`, and `ui-assets.ts`/resource-resolution services. Resolve state dir in this order: `GIT_CRED_PROXY_STATE_DIR`, macOS Application Support, fallback `~/.local/state/host-git-cred-proxy`. Resolve packaged assets in this order: explicit test/dev override env var, installed `../share/host-git-cred-proxy` relative to `process.execPath`, then repo-dev fallback for `bun run` development. Persist config as pretty JSON with the exact schema from the spec and normalize values: lower-case unique `protocols`, lower-case trimmed unique `allowedHosts`, explicit `publicUrl`, default `requestHistoryLimit=200`, default `openBrowserOnStart=false`.
  **Must NOT do**: Do not read/write runtime state in the repo; do not derive trust from `publicUrl`; do not auto-derive `publicUrl` from `host` after the initial default.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: file layout and config normalization affect every later task.
  - Skills: `[]` — no special skill required.
  - Omitted: `[frontend-ui-ux]` — service-layer task.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: [5, 6, 7, 8, 10, 18] | Blocked By: [2]

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `IMPLEMENTATION_PLAN.md:187-216` — state-dir file list and intent.
  - Pattern: `IMPLEMENTATION_PLAN.md:220-256` — config schema and precedence.
  - Pattern: `IMPLEMENTATION_PLAN.md:468-511` — `bin/` + `share/` packaging layout.
  - Pattern: `host/start.sh:4-17` — current repo-bound state handling to replace.
  - Pattern: `host/status.sh:4-19` — current config loading behavior to replace.
  - External: `https://bun.sh/docs/bundler/executables` — compiled binary path/runtime behavior.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun test tests/host/state-config.test.ts` verifies path resolution, default config materialization, JSON normalization, and installed-resource lookup for dev and packaged layouts.
  - [ ] State dir permissions are asserted as directory `0700` and files `0600` for `config.json`, `token`, `server.pid`, `server.log`, `requests.ndjson`, and `runtime.json`.
  - [ ] Resource lookup works from arbitrary cwd when the binary is started from a packaged `bin/` + `share/` layout.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: State and asset resolution work in packaged layout
    Tool: Bash
    Steps: Create a temp `bin/` + `share/host-git-cred-proxy/` fixture; run `bun test tests/host/state-config.test.ts`
    Expected: Tests pass for macOS-style state dir, fallback state dir, and `process.execPath`-relative asset lookup
    Evidence: .sisyphus/evidence/task-4-state-config.txt

  Scenario: Repo-bound paths are rejected
    Tool: Bash
    Steps: Run the negative tests with cwd outside the repo and without a packaged `share/` directory
    Expected: The service fails with the documented missing-assets error instead of silently reading `host/state` or repo-relative files
    Evidence: .sisyphus/evidence/task-4-state-config-error.txt
  ```

  **Commit**: YES | Message: `feat(state): add config state and resource services` | Files: `host/src/services/`, `tests/host/`

- [x] 5. Implement token service, redacted request audit log, and bounded server-log policy

  **What to do**: Implement a token service that creates the initial token, supports admin/API rotation without process restart, writes the token atomically inside the state dir, and exposes only file paths/metadata to the UI. Implement request audit logging to `requests.ndjson` with the exact redacted schema from the spec, capped to `requestHistoryLimit` newest entries. Implement `server.log` bounded growth by keeping only the newest 5 MiB in-place; `GET /api/admin/logs` will later read the newest lines from that file. Lock file permissions and sanitize every error/log path so secrets never hit disk.
  **Must NOT do**: Do not rotate tokens by replacing UI-visible values into HTML/JSON responses; do not log `Authorization`, full request bodies, username, password, oauth tokens, or raw git stderr containing credentials.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: security-sensitive state and log policy.
  - Skills: `[]` — no special skill required.
  - Omitted: `[playwright]` — non-browser task.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: [6, 10, 12, 13, 14, 18] | Blocked By: [4]

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `IMPLEMENTATION_PLAN.md:200-216` — runtime file inventory.
  - Pattern: `IMPLEMENTATION_PLAN.md:272-299` — audit event schema and allowed outcomes.
  - Pattern: `IMPLEMENTATION_PLAN.md:334-336` — UI must not display token plaintext.
  - Pattern: `IMPLEMENTATION_PLAN.md:398-407` — token env/file precedence on container side.
  - Pattern: `host/start.sh:30-38` — current token creation behavior.
  - Pattern: `container/helper.mjs:75-79` — helper reads token per invocation; preserve this model in shell form.
  - Pattern: `README.md:198-203` — current token risk statement to replace with safer mounted-directory flow.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun test tests/host/token-and-audit.test.ts` verifies token creation, atomic rotation, in-memory refresh, audit redaction, and log bounding.
  - [ ] Rotating the token updates the server-side accepted Bearer token without requiring a restart.
  - [ ] `requests.ndjson` never grows beyond `requestHistoryLimit` entries and contains only `time`, `action`, `protocol`, `host`, `path`, `statusCode`, `outcome`, and `durationMs`.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Token rotation is live and redacted logging is enforced
    Tool: Bash
    Steps: Run `bun test tests/host/token-and-audit.test.ts --filter rotation`; rotate the token; send one request with the old token and one with the new token
    Expected: Old token is rejected, new token succeeds, and the audit file contains no secret-bearing fields
    Evidence: .sisyphus/evidence/task-5-token-audit.txt

  Scenario: Log growth is bounded and secret fields stay absent
    Tool: Bash
    Steps: Generate more than `requestHistoryLimit` audit events and a `server.log` larger than 5 MiB in the test fixture
    Expected: Audit file is trimmed to the newest configured entries; server log is truncated in place to the newest 5 MiB; secret strings are absent
    Evidence: .sisyphus/evidence/task-5-token-audit-error.txt
  ```

  **Commit**: YES | Message: `feat(security): add token and audit log services` | Files: `host/src/services/`, `tests/host/`

- [x] 6. Port the git credential core into typed host services without changing semantics

  **What to do**: Implement `host/src/services/git-credential.ts` by porting `parseCredentialBody`, the `git credential <action>` subprocess wrapper, missing-credential detection, and outcome/status mapping from `host/server.mjs`. Keep the request body format as raw `key=value` text, enforce the same 64 KiB request cap, preserve `GIT_TERMINAL_PROMPT=0`, and map outcomes exactly: `ok`, `empty`, `denied`, `bad_request`, `error`.
  **Must NOT do**: Do not return raw git stderr directly to container clients in missing-credential cases; do not parse into JSON on the wire; do not change `approve/reject` semantics.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: core behavior migration with strict compatibility requirements.
  - Skills: `[]` — no special skill required.
  - Omitted: `[frontend-ui-ux]` — backend-only task.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: [7, 8, 10, 15] | Blocked By: [3, 4, 5]

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `host/server.mjs:39-54` — credential body parsing.
  - Pattern: `host/server.mjs:56-80` — 64 KiB body cap.
  - Pattern: `host/server.mjs:82-110` — subprocess spawn with `GIT_TERMINAL_PROMPT=0`.
  - Pattern: `host/server.mjs:119-126` — missing-credential signature detection.
  - Pattern: `host/server.mjs:176-188` — result handling branches.
  - Pattern: `IMPLEMENTATION_PLAN.md:258-299` — required proxy behavior and outcome schema.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun test tests/host/git-credential-service.test.ts` passes against the typed service layer.
  - [ ] The service returns `200` + empty body for missing-credential `fill`, `403` for protocol/host denial, `400` for malformed request missing required protocol, and `502` for non-compatible upstream errors.
  - [ ] Audit outcome mapping matches the documented enumeration and is asserted in tests.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Typed git service preserves happy path behavior
    Tool: Bash
    Steps: Run `bun test tests/host/git-credential-service.test.ts`
    Expected: The service reproduces all frozen behaviors from the characterization suite
    Evidence: .sisyphus/evidence/task-6-git-credential-service.txt

  Scenario: Upstream failure and malformed payload are handled safely
    Tool: Bash
    Steps: Run targeted tests for malformed payload, denied host/protocol, and upstream stderr not matching the missing-credential signatures
    Expected: The service emits the exact documented status/outcome mapping without leaking secrets
    Evidence: .sisyphus/evidence/task-6-git-credential-service-error.txt
  ```

  **Commit**: YES | Message: `feat(proxy): port git credential core service` | Files: `host/src/services/`, `tests/host/`

- [x] 7. Implement Elysia proxy routes and container-download routes with fixed precedence

  **What to do**: Build the single-port Elysia route tree using explicit route groups and handler ordering. Implement exact proxy routes: `GET /healthz`, `POST /fill`, `POST /approve`, `POST /reject`; support legacy action aliases `/get`, `/store`, `/erase` only if they do not conflict with the fixed contract. Implement container download routes: `GET /container/install.sh`, `GET /container/configure-git.sh`, `GET /container/git-credential-hostproxy`. Template `install.sh` and the helper/configure downloads only with current `publicUrl` and token-file path guidance; do not inject the token value.
  **Must NOT do**: Do not let a static plugin auto-register these paths; do not require admin auth or proxy token for `/container/*`; do not make container download behavior depend on repo mounts.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: route tree and precedence are security-sensitive.
  - Skills: `[]` — no special skill required.
  - Omitted: `[playwright]` — no browser needed yet.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [10, 15, 17, 18] | Blocked By: [1, 4, 6]

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `IMPLEMENTATION_PLAN.md:99-160` — route classes and access rules.
  - Pattern: `IMPLEMENTATION_PLAN.md:409-455` — install/configure/helper download requirements.
  - Pattern: `host/server.mjs:128-188` — current proxy route logic.
  - Pattern: `container/helper.mjs:20-79` — current proxy URL and token-file usage to preserve conceptually.
  - Pattern: `container/configure-git.sh:33-46` — current configure messaging to replace with installed-command flow.
  - External: `https://context7.com/elysiajs/documentation/llms.txt` — `.group`/`.guard` examples.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun test tests/host/routes-proxy-container.test.ts` verifies exact route precedence and access policy.
  - [ ] `GET /container/install.sh` returns a script that references the current configured `publicUrl` and recommended token mount path, but never includes the token value.
  - [ ] Proxy routes preserve the frozen semantics from Tasks 3 and 6.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Proxy and container routes coexist on one port
    Tool: Bash
    Steps: Start the service with a temp state dir; curl `/healthz`, `/fill`, `/container/install.sh`, and `/container/git-credential-hostproxy`
    Expected: Each path returns the correct handler response; `/container/*` is reachable without admin or proxy auth
    Evidence: .sisyphus/evidence/task-7-proxy-container-routes.txt

  Scenario: SPA/static fallback never shadows reserved prefixes
    Tool: Bash
    Steps: Request `/api/admin/status`, `/container/install.sh`, and `/assets/does-not-exist.js` before UI routing is added
    Expected: Reserved prefixes return their contract responses; missing assets return the documented not-found response instead of HTML fallback
    Evidence: .sisyphus/evidence/task-7-proxy-container-routes-error.txt
  ```

  **Commit**: YES | Message: `feat(routes): add proxy and container download routes` | Files: `host/src/routes/`, `tests/host/`

- [x] 8. Implement process manager and CLI commands with explicit exit-code and restart semantics

  **What to do**: Implement `host-git-cred-proxy serve`, `start`, `stop`, `status`, `open`, and `rotate-token`. `start` must spawn a detached `serve`, log to `server.log`, wait for `/healthz`, and exit `0` on success or if the matching service is already running. `stop` must exit `0` when the service is stopped or already absent. `status` must exit `0` only when the matching process is running and healthy; use `1` for stopped/stale/unhealthy. `open` must open the current panel URL from `runtime.json` or derived config. `rotate-token` must call the same token service used by the admin API so it becomes effective immediately without restart. Use `server.pid` as numeric pid only; use `runtime.json` plus macOS `ps -p <pid> -o command=` verification to avoid killing unrelated reused PIDs.
  **Must NOT do**: Do not use `nohup` shell wrappers in product mode; do not treat any pid as trusted without command verification; do not require the caller to be in the repo root.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: lifecycle correctness and stale-PID safety.
  - Skills: `[]` — no special skill required.
  - Omitted: `[frontend-ui-ux]` — CLI/process task.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: [10, 18, 19, 20] | Blocked By: [4, 6]

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `IMPLEMENTATION_PLAN.md:163-185` — required CLI command set and expectations.
  - Pattern: `host/start.sh:19-85` — current start/health-check output model to preserve conceptually.
  - Pattern: `host/stop.sh:7-27` — current stop/stale behavior baseline.
  - Pattern: `host/status.sh:21-48` — current status output and `/healthz` check.
  - Pattern: `IMPLEMENTATION_PLAN.md:200-216` — `server.pid`, `server.log`, `runtime.json` responsibilities.
  - Pattern: `IMPLEMENTATION_PLAN.md:367-371` — save-then-restart expectation from Settings.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun test tests/host/process-manager.test.ts` verifies detached start, stale PID handling, health gating, and `runtime.json` updates.
  - [ ] `bun run smoke:cli` verifies exit codes for `start`, `stop`, `status`, `open`, and `rotate-token` from outside the repo root using a temp state dir.
  - [ ] `open` uses the persisted/derived panel URL and does not require the service to know the original cwd.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: CLI lifecycle works end-to-end
    Tool: Bash
    Steps: Run `bun run smoke:cli`; start the service, query status, rotate token, stop the service, query status again
    Expected: Exit codes match the contract; token rotation is effective without restart; stale or missing pid files are cleaned safely
    Evidence: .sisyphus/evidence/task-8-cli-process-manager.txt

  Scenario: Stale PID and port-in-use are handled safely
    Tool: Bash
    Steps: Create a stale `server.pid`; separately occupy the configured port; run `start` and `stop`
    Expected: `start` reports port-in-use without false success; `stop` refuses to kill unrelated processes and cleans stale pid state
    Evidence: .sisyphus/evidence/task-8-cli-process-manager-error.txt
  ```

  **Commit**: YES | Message: `feat(cli): add process manager and host commands` | Files: `host/src/cli.ts`, `host/src/services/`, `tests/host/`, `scripts/`

- [x] 9. Implement admin security primitives: loopback normalization, Origin policy, nonce lifecycle, and no-CORS admin surface

  **What to do**: Implement utilities/middleware for: normalized loopback detection (`127.0.0.1`, `::1`, and canonical loopback forms), admin nonce generation/storage in memory, admin nonce refresh on restart, and non-GET admin request enforcement (`Origin` must match the current panel origin and `X-Admin-Nonce` must match the active nonce). Apply no CORS headers to `/api/admin/*`; admin access is local-browser only, not cross-origin API usage. Proxy routes keep Bearer auth; container downloads stay unauthenticated.
  **Must NOT do**: Do not reuse the proxy token as the admin nonce; do not trust `Host` or `publicUrl` as the sole admin gate; do not rely on frontend checks for enforcement.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: security primitives with low tolerance for ambiguity.
  - Skills: `[]` — no special skill required.
  - Omitted: `[frontend-ui-ux]` — backend-only security task.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [10, 14] | Blocked By: [1, 4]

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `IMPLEMENTATION_PLAN.md:147-161` — loopback/origin/nonce rules.
  - Pattern: `IMPLEMENTATION_PLAN.md:138-145` — admin route list.
  - Pattern: `IMPLEMENTATION_PLAN.md:331-336` — Setup page must show token file path, not token.
  - Pattern: `host/server.mjs:142-145` — current Bearer auth check; admin nonce must stay separate.
  - External: `https://context7.com/elysiajs/documentation/llms.txt` — route guard patterns.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun test tests/host/admin-security.test.ts` verifies loopback allow/deny, bad-origin rejection, nonce rejection, and nonce refresh on restart.
  - [ ] Non-loopback requests to `/` and `/api/admin/*` are rejected even when the server binds to `0.0.0.0` for compatibility.
  - [ ] Proxy routes and `/container/*` are unaffected by admin nonce enforcement.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Local admin requests succeed with correct nonce and Origin
    Tool: Bash
    Steps: Bootstrap the service from loopback, capture the admin nonce, send a non-GET admin request with matching `Origin` and `X-Admin-Nonce`
    Expected: The request succeeds and the security tests pass
    Evidence: .sisyphus/evidence/task-9-admin-security.txt

  Scenario: Non-loopback or bad-origin admin requests fail
    Tool: Bash
    Steps: Send admin requests from a non-loopback path or with missing/invalid `Origin` / `X-Admin-Nonce`
    Expected: Each request is rejected with the documented denial response and no state mutation occurs
    Evidence: .sisyphus/evidence/task-9-admin-security-error.txt
  ```

  **Commit**: YES | Message: `feat(admin): add loopback origin and nonce guards` | Files: `host/src/routes/`, `host/src/utils/`, `tests/host/`

- [x] 10. Implement the full admin API contract, including restart and bootstrap recovery semantics

  **What to do**: Implement `GET /api/admin/bootstrap`, `GET /api/admin/status`, `GET /api/admin/config`, `POST /api/admin/config`, `POST /api/admin/restart`, `POST /api/admin/token/rotate`, `GET /api/admin/requests`, and `GET /api/admin/logs`. Use these exact response contracts:
  - `GET /api/admin/bootstrap` → `{ adminNonce, version, config, runtime, derived: { panelUrl, listenUrl, publicUrl, stateDir, tokenFilePath, installCommand } }`
  - `GET /api/admin/status` → `{ running: true, pid, startedAt, listenUrl, publicUrl, stateDir, tokenFilePath, requestHistoryLimit }`
  - `GET /api/admin/config` → persisted config JSON only
  - `POST /api/admin/config` → validates and writes `config.json`, returns `{ ok: true, restartRequired: true, nextPanelUrl }`
  - `POST /api/admin/restart` → flushes `{ ok: true, restarting: true, nextPanelUrl }`, then spawns the replacement process and terminates the current one
  - `POST /api/admin/token/rotate` → `{ ok: true, tokenFilePath }`
  - `GET /api/admin/requests` → newest redacted events only
  - `GET /api/admin/logs` → `{ lines: string[], truncated: boolean }` using the newest 200 lines
    The replacement-process contract is fixed: after `restart`, the current process returns the JSON response, spawns the replacement `serve`, waits only long enough to hand off, and then exits; the UI will re-bootstrap from `nextPanelUrl`.
  **Must NOT do**: Do not combine config-save and restart into one opaque endpoint; do not return token plaintext; do not rely on stale nonce values after a restart.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: API contract and restart flow span CLI, state, and UI.
  - Skills: `[]` — no special skill required.
  - Omitted: `[playwright]` — API-first task; browser verification comes later.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: [11, 12, 13, 14, 18] | Blocked By: [5, 7, 8, 9]

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `IMPLEMENTATION_PLAN.md:136-145` — admin endpoint inventory.
  - Pattern: `IMPLEMENTATION_PLAN.md:149-161` — admin access policy and nonce lifecycle.
  - Pattern: `IMPLEMENTATION_PLAN.md:367-371` — config-save then restart UX expectation.
  - Pattern: `IMPLEMENTATION_PLAN.md:338-365` — Requests/Logs/Settings UI needs.
  - Pattern: `IMPLEMENTATION_PLAN.md:324-336` — Setup page data requirements.
  - Pattern: `IMPLEMENTATION_PLAN.md:200-216` — runtime file responsibilities.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun test tests/host/admin-api.test.ts` covers every admin route and exact response contract.
  - [ ] `GET /api/admin/logs` returns the newest 200 lines (or fewer if the file is shorter) plus a correct `truncated` flag.
  - [ ] `POST /api/admin/restart` updates `runtime.json` and yields a replacement process that becomes healthy at `nextPanelUrl`.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Admin API supports bootstrap, save, restart, and token rotation
    Tool: Bash
    Steps: Start the service; call `GET /api/admin/bootstrap`; save a new port via `POST /api/admin/config`; call `POST /api/admin/restart`; poll `nextPanelUrl/api/admin/bootstrap`; rotate the token via `POST /api/admin/token/rotate`
    Expected: Bootstrap and status payloads match the contract; restart succeeds at the new URL; token rotation returns only the token file path
    Evidence: .sisyphus/evidence/task-10-admin-api.txt

  Scenario: Missing logs or requests files degrade safely
    Tool: Bash
    Steps: Remove `server.log` and `requests.ndjson` from the temp state dir; call `GET /api/admin/logs` and `GET /api/admin/requests`
    Expected: Both endpoints return empty-but-valid responses instead of 500s
    Evidence: .sisyphus/evidence/task-10-admin-api-error.txt
  ```

  **Commit**: YES | Message: `feat(admin): add bootstrap config restart and log apis` | Files: `host/src/routes/`, `host/src/services/`, `tests/host/`

- [x] 11. Create the React/Vite panel shell, admin API client, and stable test selectors

  **What to do**: Build the UI shell under `host/ui/` as a single-page local panel that polls admin APIs and exposes stable `data-testid` hooks for all interactive and asserted elements. The minimum selector set is fixed and must exist: `app-shell`, `nav-overview`, `nav-setup`, `nav-requests`, `nav-logs`, `nav-settings`, `overview-status`, `overview-listen-url`, `overview-public-url`, `overview-state-dir`, `setup-install-command`, `setup-configure-command`, `setup-compose-snippet`, `setup-devcontainer-snippet`, `requests-table`, `logs-view`, `settings-host`, `settings-port`, `settings-public-url`, `settings-protocols`, `settings-allowed-hosts`, `settings-save`, `settings-restart`, `restart-banner`, `token-rotate`, `token-file-path`. Centralize all API calls in `api.ts` with automatic bootstrap fetch and nonce attachment for non-GET admin requests.
  **Must NOT do**: Do not expose token plaintext in UI state; do not use server-side rendering; do not make the UI depend on a separate dev server in product mode.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: UI shell plus testability hooks.
  - Skills: `[frontend-ui-ux]` — create a clean, minimal, local-tool UI without overdesign.
  - Omitted: `[playwright]` — e2e verification belongs to QA scenarios, not implementation logic.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: [12, 13, 14] | Blocked By: [2, 10]

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `IMPLEMENTATION_PLAN.md:301-372` — UI product requirements and section inventory.
  - Pattern: `IMPLEMENTATION_PLAN.md:549-556` — target UI file layout.
  - Pattern: `IMPLEMENTATION_PLAN.md:149-161` — admin nonce/bootstrap model that the client must honor.
  - External: `https://bun.sh/docs/bundler/executables` — product build constraints; UI must remain compatible with external asset packaging.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun run test:ui -- host/ui/src/App.test.tsx` verifies the shell renders all required navigation/test-id anchors.
  - [ ] `bun run build:ui` emits a static bundle that the host service can serve without an extra web server.
  - [ ] The API client automatically attaches `X-Admin-Nonce` to non-GET admin requests after bootstrap and never stores the token value.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Panel shell renders with stable selectors
    Tool: Playwright
    Steps: Start the host service; open `/`; wait for `[data-testid="app-shell"]`; assert the five nav items and key overview/setup/settings selectors exist
    Expected: All required selectors are present and visible
    Evidence: .sisyphus/evidence/task-11-ui-shell.png

  Scenario: Non-GET admin requests carry the bootstrap nonce automatically
    Tool: Playwright
    Steps: Open the panel; trigger a harmless non-GET admin request from the UI (for example a no-op save in test mode); inspect network traffic
    Expected: The request includes `X-Admin-Nonce` and no token plaintext appears in the DOM or request body beyond allowed config fields
    Evidence: .sisyphus/evidence/task-11-ui-shell-error.png
  ```

  **Commit**: YES | Message: `feat(ui): add panel shell and admin client` | Files: `host/ui/`, `tests/ui/`, `playwright/`

- [x] 12. Implement Overview and Setup sections with dynamic local-install instructions

  **What to do**: Render the Overview and Setup sections from live bootstrap/status/config data. Overview must show current service status, listen URL, container URL, protocol whitelist, host whitelist, token file path, state dir path, and latest start time. Setup must render dynamic copyable snippets for: `curl .../container/install.sh | sh`, `git-credential-hostproxy` configuration command, `docker-compose` snippet, `devcontainer` snippet, and token-directory mount guidance. All generated content must derive from current `publicUrl` and state dir, and must recommend mounting the containing token directory (not a single file) so rotation works.
  **Must NOT do**: Do not display the token value; do not hardcode `/workspaces/host-git-cred-proxy`; do not require repo mounts in the generated examples.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: user-facing onboarding views.
  - Skills: `[frontend-ui-ux]` — requires concise installation guidance and copy-first layout.
  - Omitted: `[git-master]` — irrelevant.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: [18] | Blocked By: [10, 11]

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `IMPLEMENTATION_PLAN.md:309-336` — Overview and Setup requirements.
  - Pattern: `IMPLEMENTATION_PLAN.md:398-407` — token env/file precedence and default token file path.
  - Pattern: `IMPLEMENTATION_PLAN.md:436-455` — helper download route requirements.
  - Pattern: `IMPLEMENTATION_PLAN.md:500-510` — Homebrew install layout for `bin/` + `share/` assets.
  - Pattern: `examples/docker-compose.yml:1-16` — current compose example to replace.
  - Pattern: `examples/devcontainer.json:1-10` — current devcontainer example to replace.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun run test:ui -- host/ui/src/pages/overview-setup.test.tsx` verifies all Overview and Setup fields are populated from bootstrap/config payloads.
  - [ ] The Setup view renders a mount-directory path under `/run/host-git-cred-proxy` and never renders the token value itself.
  - [ ] Copyable snippets update automatically when `publicUrl`, `host`, `port`, or state-dir-derived token path changes.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Dynamic setup snippets match current config
    Tool: Playwright
    Steps: Start the service; open the panel; read `[data-testid="setup-install-command"]`, `[data-testid="setup-compose-snippet"]`, and `[data-testid="setup-devcontainer-snippet"]`
    Expected: All snippets include the current `publicUrl`; directory mount guidance references the token directory and not a repo path
    Evidence: .sisyphus/evidence/task-12-overview-setup.png

  Scenario: Token value never leaks into Overview or Setup
    Tool: Playwright
    Steps: Capture page text and HTML after bootstrap
    Expected: The token file path is present but the token value string is absent from the DOM
    Evidence: .sisyphus/evidence/task-12-overview-setup-error.png
  ```

  **Commit**: YES | Message: `feat(ui): add overview and setup sections` | Files: `host/ui/src/pages/`, `tests/ui/`, `playwright/`

- [x] 13. Implement Requests and Logs sections backed by redacted polling APIs

  **What to do**: Build the Requests and Logs views using polling only. Requests must render a table with columns `time`, `action`, `protocol`, `host`, `path`, `outcome`, and `duration`. Logs must render the newest lines returned by `GET /api/admin/logs` with clear empty-state and truncation indicators. Poll intervals are fixed for MVP: 5 seconds for Requests and 5 seconds for Logs, pausing when the tab is hidden if the client utility already supports it; otherwise keep the simple interval.
  **Must NOT do**: Do not add SSE/WebSocket; do not render any secret-bearing fields; do not fetch unbounded log/request histories.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: data-heavy but straightforward dashboard views.
  - Skills: `[frontend-ui-ux]` — ensure dense but readable table/log presentation.
  - Omitted: `[playwright]` — verification only.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: [18] | Blocked By: [10, 11]

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `IMPLEMENTATION_PLAN.md:338-355` — Requests and Logs requirements.
  - Pattern: `IMPLEMENTATION_PLAN.md:272-299` — allowed request log schema.
  - Pattern: `IMPLEMENTATION_PLAN.md:354-355` — polling-only MVP requirement.
  - Pattern: `IMPLEMENTATION_PLAN.md:229-240` — `requestHistoryLimit` behavior.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun run test:ui -- host/ui/src/pages/requests-logs.test.tsx` verifies the table/log views render redacted data, empty states, and truncation banners.
  - [ ] Requests polling shows only the newest configured events and matches the column contract.
  - [ ] Logs polling shows the newest 200 lines and surfaces `truncated=true` clearly in the UI.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Requests and logs poll and render correctly
    Tool: Playwright
    Steps: Seed request and log fixtures; open the Requests and Logs tabs; wait for polling to complete
    Expected: `[data-testid="requests-table"]` shows the expected columns and rows; `[data-testid="logs-view"]` shows the newest lines
    Evidence: .sisyphus/evidence/task-13-requests-logs.png

  Scenario: Empty and truncated states are explicit
    Tool: Playwright
    Steps: Start with missing/empty files, then with a truncated logs response
    Expected: Empty state messaging appears without errors; truncation banner appears when `truncated=true`
    Evidence: .sisyphus/evidence/task-13-requests-logs-error.png
  ```

  **Commit**: YES | Message: `feat(ui): add requests and logs sections` | Files: `host/ui/src/pages/`, `tests/ui/`, `playwright/`

- [x] 14. Implement Settings save/restart/reconnect UX and token-rotate controls

  **What to do**: Build the Settings section for editing `host`, `port`, `publicUrl`, protocol whitelist, and host whitelist. The flow is fixed: `Save` calls `POST /api/admin/config`, shows `restartRequired`, and exposes the returned `nextPanelUrl`; `Restart` calls `POST /api/admin/restart`, displays `[data-testid="restart-banner"]`, waits 1500 ms, then navigates with `window.location.assign(nextPanelUrl)`; on the new origin the app re-runs bootstrap to fetch the new nonce. Add a token-rotate action that calls `POST /api/admin/token/rotate`, updates any displayed token-path metadata, and shows a non-secret success message. Keep `credential.useHttpPath` configuration messaging as informational only; it belongs to container onboarding, not panel settings.
  **Must NOT do**: Do not keep polling the old origin after restart; do not attempt cross-origin XHR to the new panel URL; do not expose token plaintext in toast/state.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: restart UX and reconnect behavior are user-critical.
  - Skills: `[frontend-ui-ux]` — needs clean, low-confusion state transitions.
  - Omitted: `[git-master]` — irrelevant.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: [18] | Blocked By: [9, 10, 11]

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `IMPLEMENTATION_PLAN.md:356-371` — Settings requirements and save-then-restart flow.
  - Pattern: `IMPLEMENTATION_PLAN.md:161-162` — bootstrap nonce comes from `/api/admin/bootstrap` and lives in memory.
  - Pattern: `IMPLEMENTATION_PLAN.md:173-179` — CLI `rotate-token` command also exists and must share backend logic.
  - Pattern: `IMPLEMENTATION_PLAN.md:224-231` — config fields editable in Settings.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun run test:e2e -- playwright/settings-restart.spec.ts` verifies save → restart-required → restart → new-origin bootstrap recovery.
  - [ ] Token rotation from the panel succeeds without revealing the token value and without requiring a service restart.
  - [ ] Settings validation rejects invalid ports and malformed `publicUrl` values before sending the admin request.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Settings restart flow reconnects on the new origin
    Tool: Playwright
    Steps: Open Settings; change the port; click `[data-testid="settings-save"]`; click `[data-testid="settings-restart"]`; allow navigation to the returned `nextPanelUrl`
    Expected: `[data-testid="restart-banner"]` appears; the browser lands on the new origin; bootstrap succeeds with a fresh nonce
    Evidence: .sisyphus/evidence/task-14-settings-restart.png

  Scenario: Invalid config and stale nonce fail safely
    Tool: Playwright
    Steps: Enter an invalid port or malformed `publicUrl`; separately replay a save request with an old nonce after restart
    Expected: Validation blocks the bad input locally; stale nonce request is rejected and the UI prompts a fresh bootstrap/reload path
    Evidence: .sisyphus/evidence/task-14-settings-restart-error.png
  ```

  **Commit**: YES | Message: `feat(ui): add settings restart and token rotation flow` | Files: `host/ui/src/pages/`, `tests/ui/`, `playwright/`

- [x] 15. Rewrite `git-credential-hostproxy` as a pure POSIX shell helper

  **What to do**: Replace the current runtime-dispatch wrapper with a pure `sh` helper that reads stdin, validates `get|store|erase`, maps them to `/fill|/approve|/reject`, resolves the token via `GIT_CRED_PROXY_TOKEN` first and `GIT_CRED_PROXY_TOKEN_FILE` second, defaults `GIT_CRED_PROXY_URL` to `http://host.docker.internal:18765`, and performs the request with `curl`. Read the token file on every invocation so rotated tokens take effect without reinstall. Preserve stdout passthrough on `200`, and stderr + exit `1` on non-200 responses.
  **Must NOT do**: Do not require `node` or `bun`; do not cache token values across invocations; do not change the environment-variable precedence.

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: self-contained shell rewrite once the contract is fixed.
  - Skills: `[]` — no special skill required.
  - Omitted: `[frontend-ui-ux]` — non-UI task.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: [16, 17, 18] | Blocked By: [6, 7]

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `IMPLEMENTATION_PLAN.md:373-408` — helper principles, env vars, and precedence.
  - Pattern: `container/helper.mjs:13-18` — supported operations.
  - Pattern: `container/helper.mjs:20-23` — proxy URL and token file defaults to replace.
  - Pattern: `container/helper.mjs:75-93` — status-code handling behavior to preserve.
  - Pattern: `container/git-credential-hostproxy:1-19` — wrapper being replaced entirely.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun test tests/container/helper-smoke.test.ts` or an equivalent shell-driven smoke suite verifies `get`, `store`, `erase`, token env precedence, token file fallback, and non-200 failure behavior.
  - [ ] `bash -n container/git-credential-hostproxy` passes and the file contains no `node`, `bun`, or `.mjs` invocation.
  - [ ] The helper reads the token file on each invocation so token rotation is observed without reinstall.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Pure shell helper proxies credentials successfully
    Tool: Bash
    Steps: Run the helper smoke suite against a fixture server; invoke `get`, `store`, and `erase` with stdin payloads
    Expected: Successful calls mirror server responses on stdout and exit 0
    Evidence: .sisyphus/evidence/task-15-shell-helper.txt

  Scenario: Missing token and non-200 proxy responses fail cleanly
    Tool: Bash
    Steps: Invoke the helper with no token env/file, then against a fixture server returning 401/502
    Expected: The helper prints an actionable stderr message and exits 1 without stack traces or runtime errors
    Evidence: .sisyphus/evidence/task-15-shell-helper-error.txt
  ```

  **Commit**: YES | Message: `feat(container): rewrite shell credential helper` | Files: `container/git-credential-hostproxy`, `tests/container/`

- [x] 16. Rewrite `container/configure-git.sh` with safe helper-chain mutation and idempotency

  **What to do**: Keep `container/configure-git.sh` as a standalone script, but change it from repo-path binding to installed-command mode. Support `--global`, `--local`, and `--repo PATH`. New mutation policy is fixed: read all existing `credential.helper` values, remove only duplicate `git-credential-hostproxy` entries, then rewrite the helper list so `git-credential-hostproxy` is first and all pre-existing non-duplicate helpers are re-added in original order. Always set `credential.useHttpPath true` in the chosen scope. Print the resulting helper chain so the user can see what changed.
  **Must NOT do**: Do not blank out `credential.helper` permanently; do not drop existing non-hostproxy helpers; do not depend on repo-relative helper paths.

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: contained shell rewrite with deterministic behavior.
  - Skills: `[]` — no special skill required.
  - Omitted: `[git-master]` — no repository-history work is needed.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: [17] | Blocked By: [1, 15]

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `IMPLEMENTATION_PLAN.md:421-432` — installed-command configuration contract.
  - Pattern: `container/configure-git.sh:9-31` — current CLI arg parsing to preserve.
  - Pattern: `container/configure-git.sh:33-46` — current destructive helper mutation to replace safely.
  - Pattern: `COMPARISON.md:16-18` — one-command configuration is still a product feature.
  - Oracle guardrail: preserve existing `credential.helper` entries instead of silently wiping them.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bash -n container/configure-git.sh` passes.
  - [ ] `bun test tests/container/configure-git.test.ts` or equivalent shell smoke verifies global/local/repo modes, idempotency, and helper-chain preservation.
  - [ ] Running the script twice does not duplicate `git-credential-hostproxy` entries.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Configure script prepends hostproxy and preserves existing helpers
    Tool: Bash
    Steps: Create a temp git config with existing helper entries; run `container/configure-git.sh --global`
    Expected: `git-credential-hostproxy` is first; existing helpers remain in order after it; `credential.useHttpPath=true`
    Evidence: .sisyphus/evidence/task-16-configure-git.txt

  Scenario: Idempotency and local repo scope work correctly
    Tool: Bash
    Steps: Run the script twice globally and once with `--local --repo <temp-repo>`
    Expected: No duplicate helper entries appear; repo-local config is mutated without touching global config
    Evidence: .sisyphus/evidence/task-16-configure-git-error.txt
  ```

  **Commit**: YES | Message: `feat(container): make configure-git safe and idempotent` | Files: `container/configure-git.sh`, `tests/container/`

- [x] 17. Add `container/install.sh` and refresh all onboarding examples to the path-free token-directory model

  **What to do**: Implement `container/install.sh` so a container can run `curl -fsSL <publicUrl>/container/install.sh | sh`. The script must default `INSTALL_DIR=/usr/local/bin`, verify `sh`, `curl`, and directory write permission, download `git-credential-hostproxy` and `configure-git.sh`, mark them executable, and print the next-step commands. If `/usr/local/bin` is not writable, exit with a clear message that names `INSTALL_DIR` as the supported override. Refresh `examples/docker-compose.yml`, `examples/devcontainer.json`, and README snippets to use install-from-host plus directory-mounted token path (`/run/host-git-cred-proxy/token`).
  **Must NOT do**: Do not require repo mounts; do not fetch from GitHub Releases inside the container installer; do not assume write access to `/usr/local/bin` without checking it.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: onboarding flow spans host templating, shell install, and example refresh.
  - Skills: `[]` — no special skill required.
  - Omitted: `[frontend-ui-ux]` — non-UI task.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: [18] | Blocked By: [7, 15, 16]

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `IMPLEMENTATION_PLAN.md:57-65` — target container flow.
  - Pattern: `IMPLEMENTATION_PLAN.md:409-455` — install script and distribution route requirements.
  - Pattern: `IMPLEMENTATION_PLAN.md:617-624` — completion criteria for container onboarding.
  - Pattern: `examples/docker-compose.yml:1-16` — current repo-mount example to replace.
  - Pattern: `examples/devcontainer.json:1-10` — current repo-mount example to replace.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bash -n container/install.sh` passes.
  - [ ] `bun run smoke:container-install` installs the helper and configure script into a temp install dir using only `sh + curl + git` in the container fixture.
  - [ ] Updated examples no longer mount the source repo and instead document the token-directory mount pattern plus `publicUrl` override guidance.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Container installer works from host download routes
    Tool: Bash
    Steps: Start the host service; run a container fixture with only `sh`, `curl`, and `git`; execute `curl -fsSL http://host.docker.internal:18765/container/install.sh | sh`
    Expected: The helper and configure script install into the selected directory and are executable
    Evidence: .sisyphus/evidence/task-17-install-sh.txt

  Scenario: Missing write permission is handled clearly
    Tool: Bash
    Steps: Run the installer in a fixture where `/usr/local/bin` is not writable and no `INSTALL_DIR` override is provided
    Expected: The script exits non-zero with a clear message naming `INSTALL_DIR` as the remedy
    Evidence: .sisyphus/evidence/task-17-install-sh-error.txt
  ```

  **Commit**: YES | Message: `feat(container): add install flow and update examples` | Files: `container/install.sh`, `examples/`, `README.md`, `tests/container/`

- [ ] 18. Add deterministic build/package scripts for UI assets, host binaries, tarballs, and checksums

  **What to do**: Implement packaging scripts that: build the UI bundle, compile `host-git-cred-proxy` for `bun-darwin-arm64` and `bun-darwin-x64`, disable runtime `.env`/`bunfig` autoload for packaged binaries, and assemble tarballs with the exact layout:
  - `bin/host-git-cred-proxy`
  - `share/host-git-cred-proxy/ui/*`
  - `share/host-git-cred-proxy/container/install.sh`
  - `share/host-git-cred-proxy/container/configure-git.sh`
  - `share/host-git-cred-proxy/container/git-credential-hostproxy`
    Emit `dist/releases/host-git-cred-proxy-darwin-arm64.tar.gz`, `dist/releases/host-git-cred-proxy-darwin-x64.tar.gz`, and `dist/releases/checksums.txt`.
  **Must NOT do**: Do not embed UI assets into the binary; do not emit ad-hoc tarball layouts; do not leave runtime config autoload nondeterministic in packaged builds.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: packaging layout is central to distribution and runtime lookup.
  - Skills: `[]` — no special skill required.
  - Omitted: `[frontend-ui-ux]` — packaging task.

  **Parallelization**: Can Parallel: NO | Wave 4 | Blocks: [19, 20] | Blocked By: [2, 4, 7, 10, 12, 13, 14, 15, 17]

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `IMPLEMENTATION_PLAN.md:468-488` — release artifact names and tarball contents.
  - Pattern: `IMPLEMENTATION_PLAN.md:490-495` — explicit choice of external static assets instead of single-file embedding.
  - Pattern: `IMPLEMENTATION_PLAN.md:630-641` — packaging phase goals and smoke requirements.
  - External: `https://bun.sh/docs/bundler/executables` — Bun compile targets and autoload flags.
  - External: `https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository` — release asset model.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun run package:release` emits both tarballs and `checksums.txt` under `dist/releases/` with the exact documented filenames.
  - [ ] `bun run smoke:tarball` extracts each tarball, starts the binary from an arbitrary cwd with `GIT_CRED_PROXY_STATE_DIR` pointed at a temp dir, and gets `ok` from `/healthz`.
  - [ ] The extracted binary resolves `share/host-git-cred-proxy/ui` and container assets correctly from the packaged layout.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Release tarballs are structurally correct and runnable
    Tool: Bash
    Steps: Run `bun run package:release` and `bun run smoke:tarball`
    Expected: Both tarballs contain the exact `bin/` + `share/` tree and the binary serves `/healthz` successfully from arbitrary cwd
    Evidence: .sisyphus/evidence/task-18-package-release.txt

  Scenario: Missing share assets fail loudly
    Tool: Bash
    Steps: Remove `share/host-git-cred-proxy/ui` from an extracted tarball and start the binary
    Expected: Startup fails with the documented missing-assets error instead of serving partial behavior or falling back to repo paths
    Evidence: .sisyphus/evidence/task-18-package-release-error.txt
  ```

  **Commit**: YES | Message: `feat(release): add packaging scripts and tarball layout` | Files: `scripts/`, `package.json`, `host/src/services/`, `tests/release/`

- [x] 19. Add GitHub Actions release workflow with native macOS smoke tests and GitHub Releases publication

  **What to do**: Implement a tag-driven GitHub Actions workflow that builds native release artifacts on both `macos-13` (Intel) and `macos-14` (Apple Silicon), runs the packaging smoke suite on each runner, uploads artifacts to a merge/release job, generates checksums, and publishes a draft GitHub Release containing the two tarballs plus `checksums.txt`. Keep release publication in the main repo; do not require a second repo for this task.
  **Must NOT do**: Do not rely solely on cross-compilation from a non-macOS runner; do not publish assets without smoke evidence; do not push the Homebrew tap from this task.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: CI orchestration and release hardening.
  - Skills: `[]` — no special skill required.
  - Omitted: `[git-master]` — not a history rewrite task.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: [20] | Blocked By: [8, 18]

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `IMPLEMENTATION_PLAN.md:457-515` — GitHub Releases + Homebrew split of responsibilities.
  - Pattern: `IMPLEMENTATION_PLAN.md:626-641` — packaging/release phase completion criteria.
  - External: `https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository` — draft release + asset upload flow.
  - External: `https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap` — tap workflow is separate from the main release publication.

  **Acceptance Criteria** (agent-executable only):
  - [ ] The workflow YAML validates and includes matrix jobs for Intel and Apple Silicon macOS runners.
  - [ ] CI runs `bun run package:release` and `bun run smoke:tarball` before publishing the draft release.
  - [ ] Release assets include `host-git-cred-proxy-darwin-arm64.tar.gz`, `host-git-cred-proxy-darwin-x64.tar.gz`, and `checksums.txt` only.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Release workflow packages and smoke-tests both macOS targets
    Tool: Bash
    Steps: Run the workflow locally where possible via a dry-run validator and in CI on a tag
    Expected: Both architecture jobs pass packaging and smoke steps before the draft release job executes
    Evidence: .sisyphus/evidence/task-19-release-workflow.txt

  Scenario: Failed smoke test blocks publication
    Tool: Bash
    Steps: Intentionally break one packaged asset in the CI fixture and rerun the workflow
    Expected: The failing architecture job stops the release job from publishing assets
    Evidence: .sisyphus/evidence/task-19-release-workflow-error.txt
  ```

  **Commit**: YES | Message: `ci(release): add macos packaging and release workflow` | Files: `.github/workflows/`, `scripts/`, `tests/release/`

- [ ] 20. Add Homebrew formula generation, local tap smoke tests, and optional remote tap automation

  **What to do**: Implement Homebrew automation in two layers:
  1. Main-repo layer: generate/update a formula template that installs `bin/host-git-cred-proxy` and `share/host-git-cred-proxy/*` from the release tarballs using arch-specific `url`/`sha256` blocks (`on_arm` + `on_intel`), then run local tap smoke tests with `brew audit --strict`, `brew install --build-from-source`, and `brew test` against a temp tap.
  2. Optional remote layer: add a script/workflow that can push the generated formula to the chosen tap repo when secrets/env vars are present.
     **[DECISION NEEDED: exact Homebrew tap owner/repo identifier]**
     Until that identifier exists, remote publication remains parameterized but local formula generation and smoke tests are mandatory.
  **Must NOT do**: Do not require Homebrew bottles; do not hardcode an unknown tap repo into the formula; do not skip local `brew test` just because remote publication is undecided.

  **Recommended Agent Profile**:
  - Category: `writing` — Reason: formula authoring plus automation/template clarity.
  - Skills: `[]` — no special skill required.
  - Omitted: `[frontend-ui-ux]` — unrelated.

  **Parallelization**: Can Parallel: NO | Wave 4 | Blocks: [] | Blocked By: [18, 19]

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `IMPLEMENTATION_PLAN.md:496-510` — Homebrew responsibilities.
  - Pattern: `IMPLEMENTATION_PLAN.md:514-522` — npm is not the main install channel.
  - External: `https://docs.brew.sh/Formula-Cookbook` — formula structure, `bin.install`, `test do`, audit expectations.
  - External: `https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap` — tap naming/layout and publication patterns.
  - Research: Homebrew formula should use release tarballs with arch-specific URL/SHA blocks and install `share/host-git-cred-proxy/*` alongside the binary.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun run smoke:brew` creates a temp tap, writes the generated formula, runs `brew audit --strict`, installs from the local tarballs, and runs `brew test`.
  - [ ] The formula installs `host-git-cred-proxy` into `bin/` and the UI/container assets into `share/host-git-cred-proxy/`.
  - [ ] Remote tap publication is gated behind environment configuration and documents the missing tap identifier as `[DECISION NEEDED]` rather than hardcoding guesses.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Local Homebrew tap install works from generated formula
    Tool: Bash
    Steps: Run `bun run smoke:brew`; install into a temporary tap; run `brew test host-git-cred-proxy`
    Expected: Audit passes, installation succeeds, and the formula test starts the service with a temp state dir and confirms `/healthz`
    Evidence: .sisyphus/evidence/task-20-homebrew.txt

  Scenario: Missing tap configuration does not break local formula smoke
    Tool: Bash
    Steps: Run the remote-publication step with tap env vars unset
    Expected: Local formula smoke still passes; remote publication is skipped with an explicit `[DECISION NEEDED]` notice naming the missing tap repo identifier
    Evidence: .sisyphus/evidence/task-20-homebrew-error.txt
  ```

  **Commit**: YES | Message: `feat(homebrew): add formula generation and smoke automation` | Files: `packaging/homebrew/`, `scripts/`, `tests/release/`, `.github/workflows/`

<!-- TASKS INSERTED BEFORE FINAL VERIFICATION WAVE -->

## Final Verification Wave (4 parallel agents, ALL must APPROVE)
- [ ] F1. Plan Compliance Audit — oracle

  **What to verify**: Confirm every implemented file/change maps back to Tasks 1-20, every `[DECISION NEEDED]` remains explicit rather than guessed, and no task acceptance criterion was skipped or replaced with manual-only validation.
  **Tool**: `task(subagent_type="oracle")`
  **Steps**:
  1. Compare the final diff and produced artifacts against Tasks 1-20.
  2. Verify each changed path belongs to planned scope.
  3. Verify packaging, admin, container, and UI work all point to their planned evidence files.
  **Expected**: Oracle returns explicit approval with no missing task-to-change mapping and no hidden scope additions.
  **Evidence**: `.sisyphus/evidence/f1-plan-compliance.md`

- [ ] F2. Code Quality Review — unspecified-high

  **What to verify**: Confirm the shipped code is internally consistent, typed, testable, and free of banned patterns: repo-relative runtime lookup, Node/Bun dependency in the shell helper, secret logging, destructive helper wiping, and ad-hoc release layout drift.
  **Tool**: `task(category="unspecified-high")`
  **Steps**:
  1. Run `bun run check`, `bun test`, and `bun run test:ui`.
  2. Inspect the implemented host/container/release files for banned patterns from “Must NOT Have”.
  3. Verify `container/git-credential-hostproxy` and `container/configure-git.sh` remain POSIX shell and idempotent.
  **Expected**: Reviewer approves only if all automated quality gates pass and no banned implementation pattern is present.
  **Evidence**: `.sisyphus/evidence/f2-code-quality.md`

- [ ] F3. Real UI QA (agent-executed) — unspecified-high (+ playwright if UI)

  **What to verify**: Execute the user-visible product flows end to end: panel load, Overview/Setup rendering, Requests/Logs polling, Settings save/restart, token rotation, container install, packaged tarball startup, and Homebrew smoke.
  **Tool**: `task(category="unspecified-high")` + Playwright
  **Steps**:
  1. Run `bun run test:e2e` for browser flows.
  2. Run `bun run smoke:container-install`, `bun run smoke:tarball`, and `bun run smoke:brew`.
  3. Capture screenshots/logs for Overview, Setup, Requests, Logs, and Settings restart recovery.
  **Expected**: All product-facing flows pass without human intervention and the evidence set shows the exact shipped UX.
  **Evidence**: `.sisyphus/evidence/f3-real-ui-qa.md`

- [ ] F4. Scope Fidelity Check — deep

  **What to verify**: Confirm the delivered work matches MVP scope exactly and excludes forbidden extras: launchd, SSE/WebSocket, remote admin, npm-first install, Windows/Linux first-class release support, repo-bound runtime dependencies, and UI token disclosure.
  **Tool**: `task(category="deep")`
  **Steps**:
  1. Compare implemented features to the “Must Have” and “Must NOT Have” sections.
  2. Verify the container onboarding path uses host download routes and token-directory mounting, not repo mounts.
  3. Verify release output remains GitHub Releases + Homebrew tap only.
  **Expected**: Reviewer approves only if no out-of-scope features or silent contract changes slipped in.
  **Evidence**: `.sisyphus/evidence/f4-scope-fidelity.md`

## Commit Strategy
- Keep commits atomic and green. Use this sequence unless a smaller earlier fix is required by a failing gate:
  1. `chore(workspace): scaffold bun typescript vite test scripts`
  2. `test(proxy): add characterization coverage for existing credential semantics`
  3. `feat(state): add config state resource and token services`
  4. `feat(proxy): implement elysia proxy and container download routes`
  5. `feat(cli): add process manager and host commands`
  6. `feat(admin): add guarded admin api and restart contract`
  7. `feat(ui): add local panel views and reconnect flow`
  8. `feat(container): add shell helper install and configure flow`
  9. `feat(release): add packaging workflows and brew automation`

## Success Criteria
- A user can install the product without cloning this repo.
- `host-git-cred-proxy start` starts a background service and reports a working panel URL and state dir.
- `host-git-cred-proxy open` opens the local panel.
- Containers can install the helper from `/container/install.sh` using only `sh + curl + git`.
- Proxy semantics match the current prototype for success, deny, missing-credential, and body-limit cases.
- UI/admin are denied from non-loopback clients even when the service binds more broadly for compatibility.
- Token rotation updates both server auth and the mounted-directory helper flow without exposing token plaintext in UI.
- Both architecture-specific macOS tarballs are produced and installable.
- Homebrew install path is defined and validated, with only the tap repo identifier left as `[DECISION NEEDED]`.
