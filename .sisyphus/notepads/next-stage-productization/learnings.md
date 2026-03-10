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

## Task 12 Investigation: Onboarding Sources Inventory

### Authoritative Source Files (Exact Paths)

**Container Scripts (Tasks 15-17 Deliverables):**
- `/workspaces/host-git-cred-proxy/container/install.sh` — Installer script, templated with `__PUBLIC_URL__` placeholder
- `/workspaces/host-git-cred-proxy/container/configure-git.sh` — Git helper chain configuration script
- `/workspaces/host-git-cred-proxy/container/git-credential-hostproxy` — Pure POSIX sh + curl credential helper

**Example/Template Files:**
- `/workspaces/host-git-cred-proxy/examples/docker-compose.yml` — Docker Compose onboarding example
- `/workspaces/host-git-cred-proxy/examples/devcontainer.json` — VS Code devcontainer onboarding example

**Documentation:**
- `/workspaces/host-git-cred-proxy/README.md` — Full usage guide with install/configure commands

**UI Components (Snippet Generation):**
- `/workspaces/host-git-cred-proxy/host/ui/src/pages/Setup.tsx` — Setup page with compose/devcontainer snippets
- `/workspaces/host-git-cred-proxy/host/src/routes/admin.ts` — Bootstrap endpoint with `derived.installCommand`
- `/workspaces/host-git-cred-proxy/host/src/routes/container.ts` — Container asset serving with `publicUrl` templating

### Key Patterns and Constants

**Canonical Token Directory Mount Path:**
- Container mount target: `/run/host-git-cred-proxy`
- Token file path: `/run/host-git-cred-proxy/token`
- Mount MUST be directory (not single file) for token rotation safety

**Install Command Pattern (from admin.ts:71):**
```
curl -fsSL ${normalizeBaseUrl(config.publicUrl)}/container/install.sh | sh
```

**Environment Variables for Container:**
- `GIT_CRED_PROXY_URL` — Runtime proxy URL (default: `http://host.docker.internal:18765`)
- `GIT_CRED_PROXY_INSTALL_URL` — Install script download URL
- `GIT_CRED_PROXY_TOKEN_FILE` — Token file path (default: `/run/host-git-cred-proxy/token`)
- `INSTALL_DIR` — Install directory override (default: `/usr/local/bin`)

**Default Configuration Values (from config.ts:19-27):**
```typescript
host: '127.0.0.1'
port: 18765
publicUrl: 'http://host.docker.internal:18765'
protocols: ['https']
```

### Current Setup Page Snippets (Setup.tsx:34-56)

**Docker Compose Snippet:**
```yaml
services:
  dev:
    environment:
      - GIT_CRED_PROXY_URL=${d.publicUrl}
      - GIT_CRED_PROXY_TOKEN_FILE=/run/host-git-cred-proxy/token
    volumes:
      - ${d.stateDir}:/run/host-git-cred-proxy:ro
```

**Devcontainer Snippet:**
```json
"mounts": [
  "source=${d.stateDir},target=/run/host-git-cred-proxy,type=bind,readonly"
],
"containerEnv": {
  "GIT_CRED_PROXY_URL": "${d.publicUrl}",
  "GIT_CRED_PROXY_TOKEN_FILE": "/run/host-git-cred-proxy/token"
}
```

### Install Script Output Guidance (install.sh:68-73)
```
Next steps:
  1) Mount your host token directory to /run/host-git-cred-proxy (read-only).
  2) Set: export GIT_CRED_PROXY_TOKEN_FILE=/run/host-git-cred-proxy/token
  3) Set: export GIT_CRED_PROXY_URL=${base_url}
  4) Run: configure-git.sh --global
```

### Templating Mechanism
- `container/install.sh` contains `__PUBLIC_URL__` placeholder
- `host/src/routes/container.ts:renderInstallScript()` replaces with `publicUrl` at serve time
- Single-quote shell escaping applied: `value.replaceAll("'", "'\"'\"'")`

### Security Requirements
- Token plaintext MUST NEVER appear in UI snippets
- Mount is read-only (`:ro`)
- State directory path is exposed but token content is not

## Task 12 Codebase Map: Overview and Setup Sections

### UI Component Files
- `/workspaces/host-git-cred-proxy/host/ui/src/pages/Overview.tsx` — Overview component, receives `bootstrapData` prop, fetches status via `adminClient.getStatus()`, renders Service Status, Network endpoints, Security Configuration, Local State cards
- `/workspaces/host-git-cred-proxy/host/ui/src/pages/Setup.tsx` — Setup component, receives `bootstrapData` prop, renders install script, git config command, token directory guidance, Docker Compose snippet, Devcontainer snippet
- `/workspaces/host-git-cred-proxy/host/ui/src/App.tsx` — Shell app, calls `adminClient.bootstrap()`, passes `bootstrapData` to Overview and Setup, handles tab navigation

### API Client + Types
- `/workspaces/host-git-cred-proxy/host/ui/src/api.ts` — `AdminClient` class with `bootstrap()`, `getStatus()`, `getConfig()`, `saveConfig()`, `restart()`, `rotateToken()`, `getRequests()`, `getLogs()` methods
  - `BootstrapResponse`: `{ adminNonce, version, config, runtime, derived: { panelUrl, listenUrl, publicUrl, stateDir, tokenFilePath, installCommand } }`
  - `StatusResponse`: `{ running, pid, startedAt, listenUrl, publicUrl, stateDir, tokenFilePath, requestHistoryLimit }`
  - `Config`: `{ host, port, publicUrl, protocols, allowedHosts, requestHistoryLimit, openBrowserOnStart }`

### Server-Side API Routes
- `/workspaces/host-git-cred-proxy/host/src/routes/admin.ts` — Admin routes: `/api/admin/bootstrap`, `/api/admin/status`, `/api/admin/config` (GET/POST), `/api/admin/restart`, `/api/admin/token/rotate`, `/api/admin/requests`, `/api/admin/logs`
- `/workspaces/host-git-cred-proxy/host/src/routes/ui.ts` — UI routes: GET `/`, GET `/assets/*`, SPA fallback with reserved-prefix exclusion

### Tests
- `/workspaces/host-git-cred-proxy/host/ui/src/pages/overview-setup.test.tsx` — Vitest unit tests for Overview and Setup, uses mock bootstrap data, verifies all test ids render correctly
- `/workspaces/host-git-cred-proxy/host/ui/src/App.test.tsx` — Integration test for shell, verifies nav links and page content with test ids
- `/workspaces/host-git-cred-proxy/tests/host/admin-api.test.ts` — Bun test for admin API contract, validates bootstrap/status/config payload shapes

### Existing Test IDs (already implemented)
**Overview page:**
- `overview-status` — running/stopped status badge
- `overview-start-time` — latest start time
- `overview-listen-url` — listen URL (from `derived.listenUrl`)
- `overview-public-url` — container/public URL (from `derived.publicUrl`)
- `overview-protocol-whitelist` — protocol list (from `config.protocols`)
- `overview-host-whitelist` — host list (from `config.allowedHosts`)
- `overview-state-dir` — state directory (from `derived.stateDir`)
- `overview-token-file-path` — token file path (from `derived.tokenFilePath`)

**Setup page:**
- `setup-install-command` — curl install command (from `derived.installCommand`)
- `setup-configure-command` — static `git config --global credential.helper hostproxy`
- `setup-compose-snippet` — Docker Compose volume mount snippet
- `setup-devcontainer-snippet` — Devcontainer mounts snippet

**Navigation:**
- `nav-overview`, `nav-setup`, `nav-requests`, `nav-logs`, `nav-settings`

### Styles
- `/workspaces/host-git-cred-proxy/host/ui/src/index.css` — CSS variables, shell/sidebar/content layout, card styles, button styles

### Build Config
- `/workspaces/host-git-cred-proxy/host/ui/vite.config.ts` — Vite config with React plugin, jsdom test environment

### Key Data Flow
1. App.tsx calls `adminClient.bootstrap()` on mount → receives `BootstrapResponse`
2. `BootstrapResponse` passed to Overview and Setup as `bootstrapData` prop
3. Overview additionally calls `adminClient.getStatus()` for dynamic status
4. Setup renders snippets from `bootstrapData.derived` fields (publicUrl, stateDir, tokenFilePath, installCommand)
5. All snippets are dynamically generated from config (publicUrl, stateDir) — already implemented

## Task 12 Reference Documentation: Testing & Container Patterns

### React Testing Library - Dynamic Text Assertions

**Official Documentation:**
- **Main docs:** https://testing-library.com/docs/react-testing-library/intro/
- **Queries reference:** https://testing-library.com/docs/queries/about
- **ByTestId API:** https://testing-library.com/docs/queries/bytestid
- **Cheatsheet:** https://testing-library.com/docs/react-testing-library/cheatsheet
- **jest-dom matchers:** https://testing-library.com/docs/ecosystem-jest-dom

**Key Patterns for Task 12:**

1. **Asserting dynamic text content with getByText:**
```typescript
// Exact match
expect(screen.getByText('http://host.docker.internal:18765')).toBeInTheDocument()

// Substring match (case-insensitive)
expect(screen.getByText(/host\.docker\.internal/i)).toBeInTheDocument()

// Regex for dynamic values
expect(screen.getByText(/http:\/\/[\w.]+:\d+/)).toBeInTheDocument()
```

2. **Using data-testid for stable selectors (plan requires these):**
```typescript
// Component
<div data-testid="setup-install-command">curl ... | sh</div>

// Test
expect(screen.getByTestId('setup-install-command')).toBeInTheDocument()
expect(screen.getByTestId('setup-install-command')).toHaveTextContent('curl')
expect(screen.getByTestId('setup-install-command')).toHaveTextContent('http://host.docker.internal:18765')
```

3. **Asserting token value is NOT present:**
```typescript
// Verify token value never appears in DOM
expect(screen.queryByText('abc123token456')).not.toBeInTheDocument()
expect(screen.queryByTestId('token-value')).not.toBeInTheDocument()

// Verify token PATH is present
expect(screen.getByTestId('token-file-path')).toHaveTextContent('/run/host-git-cred-proxy/token')
```

4. **Testing dynamic snippets update correctly:**
```typescript
test('snippets update when config changes', async () => {
  render(<Setup bootstrap={mockBootstrap} />)
  
  // Initial state
  expect(screen.getByTestId('setup-install-command')).toHaveTextContent('http://127.0.0.1:18765')
  
  // After config change
  rerender(<Setup bootstrap={updatedBootstrap} />)
  expect(screen.getByTestId('setup-install-command')).toHaveTextContent('http://0.0.0.0:8080')
})
```

**Applicability to Task 12:**
- Use `getByTestId` for all required selectors (plan mandates: `setup-install-command`, `setup-compose-snippet`, `setup-devcontainer-snippet`, etc.)
- Use `getByText` with regex for dynamic URLs
- Use `queryByText` to assert secrets are absent
- Use `toHaveTextContent` from jest-dom for partial text matches

---

### Playwright - Stable Selector Reads & Assertions

**Official Documentation:**
- **Locators guide:** https://playwright.dev/docs/locators
- **Test assertions:** https://playwright.dev/docs/test-assertions
- **GetByTestId:** https://playwright.dev/docs/locators#locate-by-test-id
- **Auto-retrying assertions:** https://playwright.dev/docs/test-assertions#auto-retrying-assertions

**Key Patterns for Task 12:**

1. **Stable selector reads using getByTestId:**
```typescript
// Access by testid (plan's stable contract)
const installCommand = page.getByTestId('setup-install-command')
await expect(installCommand).toBeVisible()
await expect(installCommand).toContainText('curl')
await expect(installCommand).toContainText('http://host.docker.internal:18765')
```

2. **Asserting dynamic content matches:**
```typescript
// Get text content and assert with regex
const snippet = await page.getByTestId('setup-compose-snippet').textContent()
expect(snippet).toMatch(/http:\/\/[\w.]+:\d+/)
expect(snippet).toContain('volumes:')
expect(snippet).toContain('/run/host-git-cred-proxy/token')

// Use toHaveText with regex
await expect(page.getByTestId('setup-devcontainer-snippet'))
  .toHaveText(/"postCreateCommand":\s*"curl.*| sh"/)
```

3. **Asserting token value never leaks:**
```typescript
// Capture entire page text and verify token value absent
const pageText = await page.textContent('body')
expect(pageText).not.toContain('abc123token456')

// Or check specific element doesn't exist
await expect(page.getByTestId('token-value')).not.toBeVisible()
```

4. **Auto-retrying for dynamic content:**
```typescript
// Playwright auto-retries until condition met or timeout
await expect(page.getByTestId('overview-status')).toHaveText('Running', { timeout: 5000 })
await expect(page.getByTestId('setup-install-command')).toContainText('http://host.docker.internal:18765')
```

**Applicability to Task 12:**
- Use `page.getByTestId()` exclusively (aligns with plan's stable selector contract)
- Use `toContainText()` for partial matches in snippets
- Use `toHaveText()` with regex for dynamic URLs
- Use auto-retrying assertions (default 5s timeout) for reliability
- Verify token values absent using `not.toContain()` on page text

---

### Docker Compose - Mounted Directory Token Files

**Official Documentation:**
- **Compose services reference:** https://docs.docker.com/compose/compose-file/05-services/
- **Volumes reference:** https://docs.docker.com/storage/volumes/
- **Bind mounts:** https://docs.docker.com/engine/storage/bind-mounts/

**Key Patterns for Task 12:**

1. **Mount token DIRECTORY (not file) for rotation safety:**
```yaml
services:
  app:
    image: myapp:latest
    volumes:
      # MOUNT DIRECTORY - allows token file to be replaced on rotation
      - ${HOST_GIT_CRED_PROXY_TOKEN_DIR}:/run/host-git-cred-proxy:ro
    environment:
      - GIT_CRED_PROXY_URL=http://host.docker.internal:18765
```

**Why directory mount (not file mount):**
- Token rotation creates NEW file (different inode)
- File mount would point to old inode → stale token
- Directory mount sees new file automatically
- Plan explicitly requires: "mount the containing token directory (not a single file)"

2. **Install-from-host flow with curl:**
```yaml
services:
  app:
    image: myimage:latest
    environment:
      - GIT_CRED_PROXY_INSTALL_URL=http://host.docker.internal:18765
      - GIT_CRED_PROXY_URL=http://host.docker.internal:18765
    command: >
      sh -c "curl -fsSL $$GIT_CRED_PROXY_INSTALL_URL/container/install.sh | sh &&
              configure-git.sh --local &&
              my-app-command"
```

3. **No repo mounts - install-from-host only:**
```yaml
# ❌ BAD - repo mount (plan forbids)
volumes:
  - .:/app  # WRONG

# ✅ GOOD - token directory only
volumes:
  - ${HOST_GIT_CRED_PROXY_TOKEN_DIR}:/run/host-git-cred-proxy:ro
```

**Applicability to Task 12:**
- Snippets MUST show directory mount: `/run/host-git-cred-proxy/token` (directory) not individual file
- Install flow: `curl .../container/install.sh | sh` then `configure-git.sh`
- Environment variables for `GIT_CRED_PROXY_INSTALL_URL` and `GIT_CRED_PROXY_URL`
- NO source repo mounts in generated examples

---

### Dev Containers - Volume Mounts & postCreateCommand

**Official Documentation:**
- **Create dev container:** https://code.visualstudio.com/docs/devcontainers/create-dev-container
- **devcontainer.json reference:** https://code.visualstudio.com/docs/devcontainers/devcontainerjson-reference
- **Dev Containers overview:** https://code.visualstudio.com/docs/devcontainers/containers

**Key Patterns for Task 12:**

1. **Token directory mount in devcontainer.json:**
```json
{
  "image": "mcr.microsoft.com/devcontainers/typescript-node:18",
  "mounts": [
    "source=${localEnv:HOST_GIT_CRED_PROXY_TOKEN_DIR},target=/run/host-git-cred-proxy,type=bind,consistency=cached"
  ],
  "remoteEnv": {
    "GIT_CRED_PROXY_INSTALL_URL": "http://host.docker.internal:18765",
    "GIT_CRED_PROXY_URL": "http://host.docker.internal:18765"
  }
}
```

2. **Install-from-host in postCreateCommand:**
```json
{
  "postCreateCommand": "curl -fsSL ${GIT_CRED_PROXY_INSTALL_URL}/container/install.sh | sh && configure-git.sh --global"
}
```

3. **No workspace override needed - uses default mount:**
```json
// devcontainer.json automatically mounts workspace
// Only add token directory mount
{
  "mounts": [
    "source=${localEnv:HOST_GIT_CRED_PROXY_TOKEN_DIR},target=/run/host-git-cred-proxy,readonly"
  ]
}
```

**Applicability to Task 12:**
- Generated snippet shows `mounts` array with token directory
- `postCreateCommand` performs install + configure
- Uses `localEnv` for token directory path
- Sets `remoteEnv` for install/runtime URLs
- Clean, minimal config (no repo mount needed)

---

### Summary: Direct Applicability to Task 12

**Testing Requirements:**
1. React Testing Library: Use `getByTestId` for all 19 required selectors from plan
2. Assert dynamic URLs with regex in `getByText` / `toHaveTextContent`
3. Verify token value absence with `queryByText` / `not.toBeInTheDocument()`
4. Playwright: Use `page.getByTestId()` + auto-retrying `toContainText()` assertions
5. Capture full page text to verify no token leakage

**Snippet Requirements:**
1. Docker Compose: Mount `${HOST_GIT_CRED_PROXY_TOKEN_DIR}` directory (not file)
2. Install flow: `curl .../container/install.sh | sh && configure-git.sh`
3. Dev Container: `mounts` array + `postCreateCommand` + `remoteEnv`
4. NO repo mounts anywhere in generated examples
5. All URLs derive from bootstrap/config (`publicUrl`, `host`, `port`)

**Evidence Sources:**
- React Testing Library official: https://testing-library.com/
- Playwright official: https://playwright.dev/
- Docker Compose official: https://docs.docker.com/compose/
- VS Code Dev Containers: https://code.visualstudio.com/docs/devcontainers/


## Task 12 Overview + Setup UI
- The old `server.mjs` has no `/panel` route, it only serves the old proxy contract. The new TypeScript server `host/src/index.ts` serves the UI via `@elysiajs/static`.
- The new `host/src/cli.ts` provides `bun run host/src/index.ts start|stop` which properly manages the background process for the new architecture. `start.sh` and `stop.sh` still exist and point to the old `server.mjs`. Use the CLI for integration testing the new UI.
- `bun` running inside a `nohup` block with standard input closed can instantly crash depending on the environment. Using `node` or the new `Bun.spawn({ detached: true })` avoids this.
- Playwright tests require waiting for network idle or specific selectors because the server takes a moment to build and serve the UI.
- The devcontainer and docker-compose setup snippets successfully template the `publicUrl` and `stateDir` directly to give the user personalized copy-paste blocks.

## Task 19 Release Workflow
- Native macOS release smoke needs target filtering on both `package:release` and `smoke:tarball`; otherwise a single runner tries to validate the non-native Darwin archive too.
- Keeping `HOST_GIT_CRED_PROXY_RELEASE_TARGETS` optional preserves task-18's default local behavior while letting CI matrix jobs package and smoke exactly one native tarball each.


## Task 13 Reference Documentation: Polling UI & Empty-State Testing

### React Testing Library - Async Assertions for Polling

**Official Documentation:**
- **Async Methods (waitFor, findBy):** https://testing-library.com/docs/dom-testing-library/api-async/
- **Appearance/Disappearance Guide:** https://testing-library.com/docs/guide-disappearance/
- **Fake Timers:** https://testing-library.com/docs/using-fake-timers/
- **ByTestId Queries:** https://testing-library.com/docs/queries/bytestid/

**Key Patterns for Task 13:**

1. **Waiting for polling data to appear (findBy):**
```typescript
// findBy = getBy + waitFor combined, auto-retries until element appears
const requestRow = await screen.findByTestId('request-row-0', {}, { timeout: 5000 })

// Works well for polling scenarios where data arrives async
await screen.findByText('No requests yet')
```

2. **waitFor for polling assertions:**
```typescript
// waitFor retries callback until it stops throwing (default: 1000ms timeout, 50ms interval)
await waitFor(() => {
  expect(screen.getByTestId('requests-count')).toHaveTextContent('3')
}, { timeout: 3000, interval: 100 })

// For polling assertions, throw in callback to trigger retry
await waitFor(() => {
  const rows = screen.getAllByTestId(/request-row/)
  expect(rows).toHaveLength(2)
})
```

3. **Asserting empty states:**
```typescript
// Use queryBy for elements that may NOT exist (returns null, not error)
expect(screen.queryByTestId('request-row-0')).not.toBeInTheDocument()
expect(screen.queryByTestId('empty-state')).toBeInTheDocument()

// Or use queryAllBy for list assertions
expect(screen.queryAllByTestId(/request-row/)).toHaveLength(0)
```

4. **Fake timers for controlled polling tests:**
```typescript
beforeEach(() => jest.useFakeTimers())
afterEach(() => {
  jest.runOnlyPendingTimers()
  jest.useRealTimers()
})

test('polls every 5 seconds', async () => {
  render(<RequestsView />)
  jest.advanceTimersByTime(5000)
  await screen.findByTestId('request-row-0')
})
```

**Applicability to Task 13:**
- Use `findByTestId` for elements that appear after polling fetches
- Use `waitFor` with custom timeout for 5-second polling intervals
- Use `queryByTestId` to assert empty state renders correctly
- Use fake timers to control 5-second interval deterministically

---

### Playwright - Stable Selectors for Tables/Logs

**Official Documentation:**
- **Locators Guide:** https://playwright.dev/docs/locators
- **Test Assertions:** https://playwright.dev/docs/test-assertions
- **GetByTestId:** https://playwright.dev/docs/locators#locate-by-test-id
- **List Assertions:** https://playwright.dev/docs/locators#lists

**Key Patterns for Task 13:**

1. **Stable table row selectors (data-testid contract):**
```typescript
// getByTestId is the plan's stable selector contract
const rows = page.getByTestId(/request-row/)
await expect(rows).toHaveCount(3)

// Filter by content within rows
await page.getByTestId('request-row-0').filter({ hasText: 'github.com' })
```

2. **Auto-retrying assertions for async data:**
```typescript
// Playwright auto-retries until condition met (default 5s)
await expect(page.getByTestId('requests-table')).toBeVisible()
await expect(page.getByTestId('request-row-0')).toContainText('https://github.com')
await expect(page.getByTestId('logs-content')).toContainText('[INFO]')
```

3. **Asserting truncation banner visibility:**
```typescript
// Truncated=true should surface banner
await expect(page.getByTestId('truncation-banner')).toBeVisible()
await expect(page.getByTestId('truncation-banner')).toContainText('Showing last 200 lines')

// When NOT truncated, banner should not exist
await expect(page.getByTestId('truncation-banner')).not.toBeVisible()
```

4. **Count assertions for bounded lists:**
```typescript
// Request history has limit from config
await expect(page.getByTestId(/request-row/)).toHaveCount(50) // requestHistoryLimit

// Logs are bounded by line count
await expect(page.getByTestId('log-line')).toHaveCount(200)
```

5. **Capturing text content for verification:**
```typescript
// Get full text to verify no credential leakage
const logsText = await page.getByTestId('logs-content').textContent()
expect(logsText).not.toContain('password=')
expect(logsText).not.toContain('token_abc123')
```

**Applicability to Task 13:**
- Use `page.getByTestId()` for all table/log selectors (matches plan contract)
- Use auto-retrying `toContainText()` for polling data
- Assert truncation banner appears when `truncated=true`
- Use `toHaveCount()` for bounded list assertions
- Verify no credential leakage in displayed content

---

### Truncation Banner UI Patterns

**PatternFly Truncate Guidelines:**
- **Design Guidelines:** https://www.patternfly.org/components/truncate/design-guidelines
- Truncation should only be used when 3+ characters are hidden
- Always include tooltip on hover showing full content
- Use ellipsis (...) to indicate truncation

**React Truncate Libraries:**
- **react-truncate:** https://github.com/remanufacturing/react-truncate
- **Truncate.js.org:** https://truncate.js.org/
- Provides `Truncate`, `MiddleTruncate`, `ShowMore` components

**Key Patterns for Task 13:**

1. **Truncation banner component structure:**
```tsx
// When logs are truncated, show warning banner
{truncated && (
  <div data-testid="truncation-banner" role="alert" className="banner warning">
    <span className="icon">⚠️</span>
    <span>Showing last {maxLines} lines. Full log available in server.log</span>
  </div>
)}
```

2. **Testing truncation state:**
```typescript
// React Testing Library
expect(screen.getByTestId('truncation-banner')).toBeInTheDocument()
expect(screen.getByTestId('truncation-banner')).toHaveTextContent('Showing last 200')

// Playwright
await expect(page.getByTestId('truncation-banner')).toBeVisible()
await expect(page.getByTestId('truncation-banner')).toContainText('200')
```

3. **Empty state for logs/requests:**
```tsx
// When no data available
{requests.length === 0 && (
  <div data-testid="empty-state" className="empty-state">
    <p>No requests yet</p>
    <p>Requests will appear here as they are processed</p>
  </div>
)}
```

**Applicability to Task 13:**
- Truncation banner MUST show `truncated=true` clearly (plan requirement)
- Use `role="alert"` for accessibility
- Empty state should have dedicated `data-testid` for stable testing
- Banner should indicate line count limit (200 for logs)

---

### Polling Dashboard UI Patterns

**Key Requirements from Plan:**
- Fixed 5-second polling interval for MVP
- Requests data must stay redacted and bounded
- Logs view must surface `truncated=true` clearly

**Testing Patterns:**

1. **Polling-only dashboard (no manual refresh for MVP):**
```typescript
// Verify polling interval is fixed at 5 seconds
test('polls every 5 seconds', async () => {
  jest.useFakeTimers()
  render(<RequestsView />)
  
  // Initial load
  expect(mockFetch).toHaveBeenCalledTimes(1)
  
  // After 5 seconds, should refetch
  jest.advanceTimersByTime(5000)
  expect(mockFetch).toHaveBeenCalledTimes(2)
  
  jest.useRealTimers()
})
```

2. **Redacted request data display:**
```tsx
// Redact sensitive fields before display
const redactedRequest = {
  ...request,
  password: '[REDACTED]',
  authorization: '[REDACTED]',
}
```

```typescript
// Test that redacted values never appear
expect(screen.queryByText('secret-password')).not.toBeInTheDocument()
expect(screen.getByTestId('request-password')).toHaveTextContent('[REDACTED]')
```

3. **Bounded list rendering:**
```typescript
// Verify only requestHistoryLimit items displayed
const rows = screen.getAllByTestId(/request-row/)
expect(rows.length).toBeLessThanOrEqual(config.requestHistoryLimit)
```

**Applicability to Task 13:**
- Polling is automatic (no refresh button for MVP)
- 5-second interval is fixed, testable with fake timers
- All credential fields must show `[REDACTED]` in UI
- List length bounded by `requestHistoryLimit` from config

---

### Summary: Direct Applicability to Task 13

**Unit Testing Requirements (React Testing Library):**
1. Use `findByTestId` for async polling data appearance
2. Use `waitFor` with 5+ second timeout for polling assertions
3. Use `queryByTestId` for empty state assertions
4. Use fake timers to control 5-second polling deterministically
5. Verify redacted values with `not.toBeInTheDocument()`

**Browser QA Requirements (Playwright):**
1. Use `page.getByTestId()` for all table/log selectors
2. Use auto-retrying `toContainText()` for polling data
3. Assert truncation banner visible when `truncated=true`
4. Use `toHaveCount()` for bounded list assertions
5. Verify no credential leakage in page content

**UI Component Requirements:**
1. Truncation banner with `data-testid="truncation-banner"` and `role="alert"`
2. Empty state with `data-testid="empty-state"`
3. Request rows with `data-testid="request-row-{index}"`
4. Log lines with `data-testid="log-line-{index}"`
5. All credential fields show `[REDACTED]` (never plaintext)

**Evidence Sources:**
- React Testing Library Async: https://testing-library.com/docs/dom-testing-library/api-async/
- Playwright Locators: https://playwright.dev/docs/locators
- Playwright Assertions: https://playwright.dev/docs/test-assertions
- PatternFly Truncate: https://www.patternfly.org/components/truncate/design-guidelines


## Task 14 Investigation: Settings Save/Restart/Reconnect UX and Token-Rotate Controls

### Current State Inventory

#### UI Files
- `/workspaces/host-git-cred-proxy/host/ui/src/pages/Settings.tsx` — Settings component (138 lines)
  - Has all required `data-testid` attributes: `settings-host`, `settings-port`, `settings-public-url`, `settings-protocols`, `settings-allowed-hosts`, `settings-save`, `settings-restart`, `restart-banner`, `token-rotate`, `token-file-path`
  - Form fields: `host`, `port`, `publicUrl`, `protocols`, `allowedHosts`
  - State: `config`, `saving`, `restarting`

- `/workspaces/host-git-cred-proxy/host/ui/src/api.ts` — AdminClient class (161 lines)
  - `bootstrap()` — fetches `/api/admin/bootstrap`, caches nonce
  - `fetchWithNonce()` — attaches `X-Admin-Nonce` header
  - `saveConfig(config)` — POST `/api/admin/config` returns `{ ok, restartRequired, nextPanelUrl }`
  - `restart()` — POST `/api/admin/restart` returns `{ ok, restarting, nextPanelUrl }`
  - `rotateToken()` — POST `/api/admin/token/rotate` returns `{ ok, tokenFilePath }`

- `/workspaces/host-git-cred-proxy/host/ui/src/App.tsx` — Shell app (85 lines)
  - Calls `adminClient.bootstrap()` on mount
  - Passes `bootstrapData` and `onRefresh={() => window.location.reload()}` to Settings

#### Backend API Routes
- `/workspaces/host-git-cred-proxy/host/src/routes/admin.ts` — Admin routes (364 lines)
  - `POST /api/admin/config` — validates, saves config, returns `{ ok, restartRequired, nextPanelUrl }`
  - `POST /api/admin/restart` — returns response immediately, schedules restart after 150ms delay
  - `POST /api/admin/token/rotate` — rotates token, returns `{ ok, tokenFilePath }` (no token value)

#### Existing Tests
- `/workspaces/host-git-cred-proxy/host/ui/src/App.test.tsx` — App shell test
  - Already tests all Settings testids including `restart-banner` trigger (line 99-101)
  - Mocks `adminClient.restart` to return `{ restarting: true, nextPanelUrl: 'http://localhost' }`

- `/workspaces/host-git-cred-proxy/tests/host/admin-api.test.ts` — Backend API contract tests
  - Tests config save/restartRequired contract
  - Tests restart response + async handoff
  - Tests token rotation (no token plaintext in response)
  - Tests nonce validation and origin trust

- `/workspaces/host-git-cred-proxy/host/ui/src/pages/requests-logs.test.tsx` — Pattern reference for polling tests
- `/workspaces/host-git-cred-proxy/host/ui/src/pages/overview-setup.test.tsx` — Pattern reference for component tests

### Current Behavior vs Plan Requirements

#### handleSave() (lines 13-29)
**Current:**
```typescript
const res = await adminClient.saveConfig(config);
if (res.restartRequired) {
  alert('Config saved. Restart required.');
} else {
  alert('Config saved.');
}
```

**Gaps:**
- Uses `alert()` instead of proper UI notification
- Does NOT expose `nextPanelUrl` to state (needed for restart flow)
- No client-side validation before API call

#### handleRestart() (lines 31-44)
**Current:**
```typescript
setRestarting(true);
const res = await adminClient.restart();
if (res.restarting) {
  setTimeout(() => {
    window.location.href = res.nextPanelUrl;
  }, 2000);  // <-- WRONG: plan says 1500ms
}
```

**Gaps:**
- Uses `window.location.href` instead of `window.location.assign()` (plan specifies assign)
- Uses 2000ms delay instead of 1500ms (plan specifies 1500ms)
- Does NOT get `nextPanelUrl` from save response (restart returns same URL but save might return new port)

#### handleRotate() (lines 46-55)
**Current:**
```typescript
const res = await adminClient.rotateToken();
if (res.ok) {
  alert('Token rotated.');
}
```

**Gaps:**
- Uses `alert()` instead of proper UI notification
- Does NOT update displayed `tokenFilePath` from response (though path rarely changes)
- Does NOT refresh bootstrap data to get updated derived fields

#### Reconnect Flow
**Current:**
- App calls `bootstrap()` once on mount
- No re-bootstrap after navigation to new origin

**Gaps:**
- After `window.location.assign(nextPanelUrl)`, the app will naturally reload and call bootstrap again
- This is correct behavior (fresh page load = fresh bootstrap = fresh nonce)
- No explicit reconnect logic needed beyond page reload

### Test Infrastructure Gaps

#### Unit Tests
- No dedicated Settings unit test file (only tested via App.test.tsx shell)
- No test for save flow with restartRequired state
- No test for validation errors (invalid port, malformed URL)
- No test for token rotation success feedback

#### E2E Tests
- Playwright is referenced in plan but NOT installed in package.json
- No `playwright.config.ts` exists
- No `playwright/` directory exists
- `test:e2e` script exists (`bunx playwright test`) but has no tests to run
- Plan requires: `playwright/settings-restart.spec.ts`

### Concrete Gap List for Task 14 Executor

1. **Restart delay mismatch**: Change `setTimeout(..., 2000)` to `setTimeout(..., 1500)` in Settings.tsx line 38

2. **Navigation method**: Change `window.location.href = ...` to `window.location.assign(...)` in Settings.tsx line 37

3. **Save flow enhancement**:
   - Store `nextPanelUrl` from save response in component state
   - Pass this URL to restart handler (or use restart's response which returns same URL)
   - Show proper UI feedback instead of `alert()`

4. **Client-side validation** (before API call):
   - Port: integer 1-65535
   - publicUrl: starts with `http://` or `https://`
   - Block submission and show inline error on validation failure

5. **Token rotation enhancement**:
   - Show proper UI notification instead of `alert()`
   - Optionally refresh bootstrap data to update derived fields

6. **Settings unit tests** (new file `host/ui/src/pages/settings.test.tsx`):
   - Test save success + restartRequired state
   - Test validation errors
   - Test restart flow triggers navigation after 1500ms
   - Test token rotation success

7. **Playwright setup** (if not already done in task 12/13):
   - Install playwright: `bun add -d @playwright/test`
   - Create `playwright.config.ts`
   - Create `playwright/` directory
   - Create `playwright/settings-restart.spec.ts`

### Key Files to Modify
- `/workspaces/host-git-cred-proxy/host/ui/src/pages/Settings.tsx` — main component
- `/workspaces/host-git-cred-proxy/host/ui/src/App.test.tsx` — expand Settings coverage
- Create: `/workspaces/host-git-cred-proxy/host/ui/src/pages/settings.test.tsx`
- Create: `/workspaces/host-git-cred-proxy/playwright/settings-restart.spec.ts` (if Playwright setup complete)

### Existing Test IDs (already implemented)
- `settings-host` — host input
- `settings-port` — port input
- `settings-public-url` — public URL input
- `settings-protocols` — protocols input
- `settings-allowed-hosts` — allowed hosts input
- `settings-save` — save button
- `settings-restart` — restart button
- `restart-banner` — shown when `restarting` state is true
- `token-rotate` — rotate token button
- `token-file-path` — displays token file path

### Missing Test IDs (may need to add)
- `settings-save-success` — success notification
- `settings-save-error` — error notification
- `settings-validation-error` — validation error message
- `token-rotate-success` — rotation success notification

## Task 14 Reference Documentation: Mocking window.location, Testing Redirects & Restart UX

### React Testing Library - Mocking window.location.assign

**Official Documentation:**
- **Testing Library Docs:** https://testing-library.com/docs/react-testing-library/intro/
- **Jest jsdom Environment:** https://testing-library.com/docs/react-testing-library/setup
- **Jest 30+ Location Issue:** https://github.com/jestjs/jest/issues/15776

**Key Pattern 1: Object.defineProperty for window.location.assign (Jest 24-)**

**Evidence** ([Ben Ilegbodu Blog](https://www.benmvp.com/blog/mocking-window-location-methods-jest-jsdom/)):
```typescript
// Works in Jest 24 and earlier
Object.defineProperty(window.location, 'assign', {
  configurable: true,
  value: jest.fn(),
})

// In test
render(<Component />)
fireEvent.click(screen.getByText('Redirect'))

// Assertions
expect(window.location.assign).toHaveBeenCalledTimes(1)
expect(window.location.assign).toHaveBeenCalledWith(
  'https://example.com/dashboard'
)
```

**Explanation**: This approach directly modifies the `assign` method on the existing `window.location` object. Works in older Jest versions but fails in Jest 25+ due to jsdom changes.

**Key Pattern 2: Full window.location Mock (Jest 25+)**

**Evidence** ([CodeArchPedia](https://openillumi.com/en/en-jest-fix-location-href-typeerror/)):
```typescript
// Setup in beforeEach or test file
const originalLocation = window.location

beforeEach(() => {
  // Create new prototype context to bypass restrictions
  Object.defineProperty(window, 'location', {
    value: {
      href: 'http://localhost:3000',
      origin: 'http://localhost:3000',
      pathname: '/',
      assign: jest.fn(),
      replace: jest.fn(),
      reload: jest.fn(),
    },
    writable: true,
  })
})

afterEach(() => {
  // Restore original
  Object.defineProperty(window, 'location', {
    value: originalLocation,
    writable: true,
  })
})

// In test
test('redirects to dashboard after save', async () => {
  render(<Settings onSave={() => window.location.assign('/dashboard')} />)
  
  await userEvent.click(screen.getByText('Save'))
  
  expect(window.location.assign).toHaveBeenCalledWith('/dashboard')
})
```

**Explanation**: Jest 25+ uses jsdom 16+ which makes `window.location` non-configurable. Solution is to redefine the entire `location` object with a writable mock. Must restore in afterEach to prevent test pollution.

**Key Pattern 3: jest-location-mock Package (Production-Ready)**

**Evidence** ([jest-location-mock npm](https://www.npmjs.com/package/jest-location-mock)):
```typescript
// Installation
// npm install --save-dev jest-location-mock

// In setup file (jest.setup.js)
import 'jest-location-mock'

// In tests - automatic mocking
test('redirects after mutation', () => {
  render(<Component />)
  fireEvent.click(screen.getByText('Trigger Redirect'))
  
  // All location methods are automatically spied
  expect(window.location.assign).toHaveBeenCalledWith('/new-path')
  expect(window.location.replace).toHaveBeenCalled()
  expect(window.location.reload).toHaveBeenCalled()
})

// Test delayed redirect
test('redirects after 2 second delay', async () => {
  jest.useFakeTimers()
  
  render(<Component />)
  fireEvent.click(screen.getByText('Save'))
  
  // Fast-forward time
  jest.advanceTimersByTime(2000)
  
  await waitFor(() => {
    expect(window.location.assign).toHaveBeenCalledWith('/dashboard')
  })
  
  jest.useRealTimers()
})
```

**Explanation**: This package handles jsdom v21+ restrictions automatically and provides Jest spies on all location methods. Most maintainable solution for production codebases.

**Applicability to Task 14:**
- Use Pattern 2 (full mock) if avoiding external dependencies
- Use Pattern 3 (jest-location-mock) for production-ready solution
- Test delayed redirects with `jest.useFakeTimers()` + `jest.advanceTimersByTime()`
- Always restore location in afterEach to prevent cross-test pollution
- Assert both method calls AND arguments for complete verification

---

### Testing Delayed Redirect Flows

**Official Documentation:**
- **Jest Fake Timers:** https://jestjs.io/docs/timer-mocks
- **React Testing Library waitFor:** https://testing-library.com/docs/dom-testing-library/api-async/

**Key Pattern: Testing setTimeout-based Redirects**

**Evidence** ([Testing Library Async Guide](https://testing-library.com/docs/dom-testing-library/api-async/)):
```typescript
describe('Settings Restart UX', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    Object.defineProperty(window, 'location', {
      value: { assign: jest.fn(), reload: jest.fn() },
      writable: true,
    })
  })
  
  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })
  
  test('shows reconnect banner, then redirects after 3 seconds', async () => {
    const { rerender } = render(<Settings />)
    
    // Trigger mutation
    await userEvent.click(screen.getByText('Restart Service'))
    
    // Banner appears immediately
    expect(screen.getByTestId('reconnect-banner')).toBeVisible()
    expect(screen.getByTestId('reconnect-banner')).toHaveTextContent(
      'Reconnecting in 3 seconds...'
    )
    
    // Redirect has NOT happened yet
    expect(window.location.reload).not.toHaveBeenCalled()
    
    // Advance time by 1 second
    jest.advanceTimersByTime(1000)
    expect(screen.getByTestId('reconnect-banner')).toHaveTextContent(
      'Reconnecting in 2 seconds...'
    )
    
    // Advance to trigger redirect
    jest.advanceTimersByTime(2000)
    
    // Now redirect happens
    await waitFor(() => {
      expect(window.location.reload).toHaveBeenCalledTimes(1)
    })
    
    // Banner disappears after redirect
    expect(screen.queryByTestId('reconnect-banner')).not.toBeInTheDocument()
  })
  
  test('user can cancel delayed redirect', async () => {
    render(<Settings />)
    
    await userEvent.click(screen.getByText('Restart Service'))
    expect(screen.getByTestId('reconnect-banner')).toBeVisible()
    
    // Advance time but don't trigger redirect
    jest.advanceTimersByTime(1500)
    
    // User cancels
    await userEvent.click(screen.getByText('Cancel'))
    
    // Redirect should NOT happen
    jest.advanceTimersByTime(5000)
    expect(window.location.reload).not.toHaveBeenCalled()
    
    // Banner disappears
    expect(screen.queryByTestId('reconnect-banner')).not.toBeInTheDocument()
  })
})
```

**Explanation**: Fake timers allow deterministic testing of setTimeout-based delays. `jest.advanceTimersByTime()` moves time forward, and `waitFor()` ensures async state updates complete before assertions.

**Applicability to Task 14:**
- Test countdown text updates correctly at each second
- Verify redirect happens at exact timeout (not before)
- Test cancellation clears timer and removes banner
- Use `jest.runOnlyPendingTimers()` in afterEach to prevent timer leaks
- Combine fake timers with `waitFor()` for reliable async assertions

---

### Testing Mutation/Reconnect Banners

**Official Documentation:**
- **React Testing Library Appearance:** https://testing-library.com/docs/guide-disappearance/
- **ByTestId Queries:** https://testing-library.com/docs/queries/bytestid/

**Key Pattern: Banner State Transitions**

**Evidence** ([Testing Library Examples](https://testing-library.com/docs/react-testing-library/example-intro/)):
```typescript
describe('Mutation Banner UX', () => {
  test('shows reconnect banner when service restarts', async () => {
    // Mock API to simulate restart
    server.use(
      rest.post('/api/admin/restart', (req, res, ctx) => {
        return res(ctx.status(200), ctx.json({ restarting: true }))
      })
    )
    
    render(<Settings />)
    
    // Initial state - no banner
    expect(screen.queryByTestId('reconnect-banner')).not.toBeInTheDocument()
    
    // Trigger restart
    await userEvent.click(screen.getByText('Restart Service'))
    
    // Banner appears with loading state
    const banner = await screen.findByTestId('reconnect-banner')
    expect(banner).toBeVisible()
    expect(banner).toHaveTextContent('Service is restarting...')
    expect(banner).toHaveAttribute('role', 'alert') // Accessibility
    
    // Progress updates
    await waitFor(() => {
      expect(screen.getByTestId('reconnect-banner')).toHaveTextContent(
        'Waiting for service...'
      )
    })
    
    // Success state
    await waitFor(() => {
      expect(screen.getByTestId('reconnect-banner')).toHaveTextContent(
        'Reconnected successfully'
      )
    }, { timeout: 5000 })
    
    // Auto-dismiss after success
    await waitFor(() => {
      expect(screen.queryByTestId('reconnect-banner')).not.toBeInTheDocument()
    }, { timeout: 3000 })
  })
  
  test('shows error banner when reconnection fails', async () => {
    server.use(
      rest.post('/api/admin/restart', (req, res, ctx) => {
        return res(ctx.status(500), ctx.json({ error: 'Restart failed' }))
      })
    )
    
    render(<Settings />)
    
    await userEvent.click(screen.getByText('Restart Service'))
    
    const banner = await screen.findByTestId('reconnect-banner')
    expect(banner).toHaveClass('error')
    expect(banner).toHaveTextContent('Failed to restart service')
    
    // Error banner should persist (not auto-dismiss)
    jest.advanceTimersByTime(10000)
    expect(screen.getByTestId('reconnect-banner')).toBeVisible()
    
    // User can dismiss manually
    await userEvent.click(screen.getByText('Dismiss'))
    expect(screen.queryByTestId('reconnect-banner')).not.toBeInTheDocument()
  })
})
```

**Explanation**: Banner testing requires verifying multiple states (loading → progress → success/error) and timing (auto-dismiss vs persistence). Use `findByTestId` for async appearance, `waitFor` for state transitions, and `queryByTestId` for disappearance.

**Applicability to Task 14:**
- Use `role="alert"` on banners for accessibility
- Test all state transitions: loading → progress → success → dismiss
- Error banners should NOT auto-dismiss (user must acknowledge)
- Success banners auto-dismiss after timeout
- Use `toHaveClass()` for visual state (error/success/warning)

---

### Playwright - Selector & Assertion Patterns for Restart UX

**Official Documentation:**
- **Locators Guide:** https://playwright.dev/docs/locators
- **Test Assertions:** https://playwright.dev/docs/test-assertions
- **LocatorAssertions API:** https://playwright.dev/docs/api/class-locatorassertions

**Key Pattern 1: Auto-Retrying Assertions for Async UX**

**Evidence** ([Playwright LocatorAssertions](https://playwright.dev/docs/api/class-locatorassertions)):
```typescript
import { test, expect } from '@playwright/test'

test('restart button triggers reconnect banner and reload', async ({ page }) => {
  await page.goto('http://localhost:18765/settings')
  
  // Click restart button
  await page.getByTestId('restart-button').click()
  
  // Banner appears immediately (auto-retry)
  const banner = page.getByTestId('reconnect-banner')
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('Service is restarting')
  
  // Banner state changes over time (auto-retry until condition met)
  await expect(banner).toContainText('Reconnecting in', { timeout: 3000 })
  
  // Countdown visible
  await expect(banner).toContainText('3 seconds')
  await expect(banner).toContainText('2 seconds')
  await expect(banner).toContainText('1 second')
  
  // Page reloads after countdown
  await page.waitForURL('**/settings', { timeout: 10000 })
  
  // Banner disappears after reload
  await expect(banner).not.toBeVisible()
})
```

**Explanation**: Playwright assertions auto-retry until timeout (default 5s), making them ideal for async UX flows. `toContainText()` waits for text to appear, and `not.toBeVisible()` waits for disappearance.

**Key Pattern 2: Waiting for Page Reload**

**Evidence** ([Playwright Navigation Guide](https://playwright.dev/docs/api/class-page#page-wait-for-navigation)):
```typescript
test('service restart triggers page reload', async ({ page }) => {
  await page.goto('http://localhost:18765/settings')
  
  // Capture current timestamp before restart
  const initialTimestamp = await page.getByTestId('start-time').textContent()
  
  // Trigger restart
  await page.getByTestId('restart-button').click()
  
  // Wait for reconnect banner
  await expect(page.getByTestId('reconnect-banner')).toBeVisible()
  
  // Wait for page reload
  await page.waitForLoadState('reload')
  
  // OR wait for navigation event
  await Promise.all([
    page.waitForNavigation(),
    // ... action that triggers reload
  ])
  
  // Verify new timestamp after reload
  const newTimestamp = await page.getByTestId('start-time').textContent()
  expect(newTimestamp).not.toBe(initialTimestamp)
  
  // Service status shows running
  await expect(page.getByTestId('service-status')).toHaveText('Running')
})

test('token rotation updates UI without reload', async ({ page }) => {
  await page.goto('http://localhost:18765/settings')
  
  // Initial token path
  const tokenPath = await page.getByTestId('token-file-path').textContent()
  
  // Rotate token
  await page.getByTestId('rotate-token-button').click()
  
  // Success banner appears (no reload)
  await expect(page.getByTestId('success-banner')).toBeVisible()
  await expect(page.getByTestId('success-banner')).toContainText('Token rotated')
  
  // Token path unchanged (same file, new content)
  await expect(page.getByTestId('token-file-path')).toHaveText(tokenPath)
  
  // Banner auto-dismisses
  await expect(page.getByTestId('success-banner')).not.toBeVisible({ timeout: 3000 })
})
```

**Explanation**: `waitForLoadState('reload')` waits for page reload to complete. For token rotation, verify UI updates happen WITHOUT reload (SPA behavior).

**Key Pattern 3: Testing State Persistence Across Reload**

**Evidence** ([Playwright Assertions](https://playwright.dev/docs/test-assertions)):
```typescript
test('settings persist across service restart', async ({ page }) => {
  await page.goto('http://localhost:18765/settings')
  
  // Change settings
  await page.getByTestId('host-input').fill('0.0.0.0')
  await page.getByTestId('port-input').fill('8080')
  await page.getByTestId('save-button').click()
  
  // Verify saved
  await expect(page.getByTestId('success-banner')).toBeVisible()
  
  // Restart service
  await page.getByTestId('restart-button').click()
  await expect(page.getByTestId('reconnect-banner')).toBeVisible()
  
  // Wait for reload
  await page.waitForLoadState('reload')
  
  // Verify settings persisted
  await expect(page.getByTestId('host-input')).toHaveValue('0.0.0.0')
  await expect(page.getByTestId('port-input')).toHaveValue('8080')
})
```

**Applicability to Task 14:**
- Use `page.getByTestId()` for all selectors (matches plan's stable contract)
- Auto-retrying assertions handle async banner state changes
- `waitForLoadState('reload')` for page reload verification
- Test persistence across restart (config survives reload)
- Use `not.toBeVisible()` for banner disappearance assertions
- Set custom timeouts for long-running operations: `{ timeout: 10000 }`

---

### Summary: Direct Applicability to Task 14

**React Testing Library Requirements:**
1. **Mock window.location.assign**: Use full location mock or jest-location-mock package
2. **Test delayed redirects**: Combine `jest.useFakeTimers()` + `jest.advanceTimersByTime()`
3. **Test banner states**: Use `findByTestId` for appearance, `waitFor` for transitions
4. **Assert banner timing**: Verify countdown text, cancellation clears timers
5. **Accessibility**: Ensure banners have `role="alert"`

**Playwright Requirements:**
1. **Auto-retry assertions**: `expect(locator).toContainText()` waits for async state
2. **Page reload detection**: `page.waitForLoadState('reload')` for restart flows
3. **State persistence**: Verify config survives across restart/reload
4. **Banner visibility**: `toBeVisible()` for appearance, `not.toBeVisible()` for dismissal
5. **Custom timeouts**: Use `{ timeout: 10000 }` for long-running restart operations

**Test Coverage for Task 14:**
1. **Restart button** → reconnect banner → countdown → page reload
2. **Token rotation** → success banner → auto-dismiss (no reload)
3. **Cancel restart** → clears timer → removes banner → no reload
4. **Failed restart** → error banner persists → manual dismiss
5. **Settings persistence** → restart → reload → verify config unchanged

**Evidence Sources:**
- React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
- Jest Location Mock: https://www.npmjs.com/package/jest-location-mock
- Jest Fake Timers: https://jestjs.io/docs/timer-mocks
- Playwright Locators: https://playwright.dev/docs/locators
- Playwright Assertions: https://playwright.dev/docs/test-assertions
- Playwright LocatorAssertions API: https://playwright.dev/docs/api/class-locatorassertions

- For Vitest module-method mocks in UI tests, prefer local typed aliases like `const getRequestsMock = vi.mocked(adminClient.getRequests)` over `(fn as any).mockResolvedValue(...)` to preserve type safety without changing assertions.


## Task 18 Investigation: Build/Package Scripts for UI Assets, Host Binaries, Tarballs, and Checksums

### Current State Summary

#### Existing Build Infrastructure

**package.json scripts (lines 14-18):**
```json
"build:host": "bun build host/src/index.ts --target=bun --outdir=dist/host",
"build:ui": "vite build --config host/ui/vite.config.ts",
"build": "bun run build:host && bun run build:ui",
"package:release": "echo 'not yet implemented'",
"smoke:tarball": "echo 'not yet implemented'",
```

**Current build outputs:**
- `dist/host/index.js` — Bun bundle of host entrypoint (188 bytes)
- `host/ui/dist/index.html` — Vite-built UI HTML entry
- `host/ui/dist/assets/index-*.js` — UI JavaScript bundle (152KB)
- `host/ui/dist/assets/index-*.css` — UI stylesheet (2KB)

#### Missing Infrastructure

1. **No `scripts/` packaging scripts exist** — only `smoke-network-contract.sh`
2. **No `dist/releases/` directory** — tarballs and checksums location undefined
3. **No GitHub Actions workflows** — `.github/workflows/` is empty
4. **No Homebrew packaging** — `packaging/homebrew/` does not exist
5. **No `bun compile` usage** — current `build:host` only bundles, doesn't compile to binary

### Runtime Asset Resolution (Already Implemented)

**File:** `/workspaces/host-git-cred-proxy/host/src/services/ui-assets.ts`

The runtime asset resolution is already correctly implemented:

```typescript
// Resolution order (lines 6-38):
1. GIT_CRED_PROXY_SHARE_DIR env var override
2. Installed layout: process.execPath/../share/host-git-cred-proxy
3. Dev fallback: repo-relative host/ui/dist + container/

// isPackagedLayout() check (lines 56-58):
- Requires: ui/ directory AND container/ directory
- Used for: share/host-git-cred-proxy/{ui,container}

// isDevLayout() check (lines 60-64):
- Requires: host/ui/dist directory AND container/ directory
- Used for: local development
```

**File:** `/workspaces/host-git-cred-proxy/host/src/routes/container.ts`

Container asset serving (lines 47-68):
- `resolveContainerAssetPath()` tries `resolveShareDir()/container/<file>` first
- Falls back to repo-relative `container/<file>` for dev
- Serves: `install.sh`, `configure-git.sh`, `git-credential-hostproxy`

### Required Tarball Layout (from IMPLEMENTATION_PLAN.md:468-488)

```
host-git-cred-proxy-darwin-{arm64,x64}.tar.gz
├── bin/
│   └── host-git-cred-proxy          # Compiled Bun binary
└── share/
    └── host-git-cred-proxy/
        ├── ui/
        │   ├── index.html
        │   └── assets/
        │       ├── index-*.js
        │       └── index-*.css
        └── container/
            ├── install.sh
            ├── configure-git.sh
            └── git-credential-hostproxy
```

### Files Atlas Will Need to Change for Task 18

#### Must Create (New Files)
1. **`scripts/package-release.ts`** — Main packaging script
   - Build UI (`bun run build:ui`)
   - Compile binary for target architecture (`bun build --compile`)
   - Assemble tarball with bin/ + share/ layout
   - Generate SHA256 checksums
   - Output to `dist/releases/`

2. **`scripts/smoke-tarball.ts`** — Tarball smoke test
   - Extract tarball to temp directory
   - Start binary with `GIT_CRED_PROXY_STATE_DIR=/tmp`
   - Verify `/healthz` returns 200
   - Test from arbitrary cwd

3. **`tests/release/package-release.test.ts`** — Packaging tests
   - Verify tarball structure matches spec
   - Verify binary is executable
   - Verify checksums are valid

4. **`packaging/homebrew/host-git-cred-proxy.rb`** — Homebrew formula template
   - Architecture-specific URL/SHA256 blocks
   - Install `bin/host-git-cred-proxy`
   - Install `share/host-git-cred-proxy/*`

#### Must Modify (Existing Files)
1. **`package.json`** — Replace placeholder scripts
   - `"package:release": "bun run scripts/package-release.ts"`
   - `"smoke:tarball": "bun run scripts/smoke-tarball.ts"`

2. **`host/src/services/ui-assets.ts`** — May need adjustment
   - Current logic assumes `process.execPath` resolves to binary location
   - Verify works with compiled binary (not bun runtime)

3. **`host/src/services/process-manager.ts`** — May need adjustment
   - Line 207: `Bun.spawn(['bun', 'run', entrypoint, 'serve'], ...)`
   - For packaged binary, should call binary directly: `Bun.spawn([entrypoint, 'serve'], ...)`
   - Requires detection of compiled vs dev mode

### Key Bun Compile Flags Required

From Bun documentation (`https://bun.sh/docs/bundler/executables`):

```bash
# Compile for current platform
bun build --compile ./host/src/index.ts --outfile dist/bin/host-git-cred-proxy

# Cross-compile for specific targets
bun build --compile ./host/src/index.ts --target=bun-darwin-arm64 --outfile dist/bin/host-git-cred-proxy
bun build --compile ./host/src/index.ts --target=bun-darwin-x64 --outfile dist/bin/host-git-cred-proxy

# Disable autoload flags (plan requirement: "disable runtime .env/bunfig autoload")
# Note: Bun compile doesn't support explicit --no-env flag; 
# ensure code doesn't rely on .env files at runtime
```

### Container Scripts Source Location

**Already exist in `container/` directory:**
- `/workspaces/host-git-cred-proxy/container/install.sh` (2123 bytes)
- `/workspaces/host-git-cred-proxy/container/configure-git.sh` (1773 bytes)
- `/workspaces/host-git-cred-proxy/container/git-credential-hostproxy` (2057 bytes)

These are already served via `/container/*` routes and templated with `publicUrl`.

### Test Gaps

**No tests currently exist for:**
1. Tarball structure verification
2. Binary execution from arbitrary cwd
3. Packaged asset resolution (share/host-git-cred-proxy/ui)
4. Checksum generation/validation
5. Homebrew formula installation

**Existing related tests:**
- `/workspaces/host-git-cred-proxy/tests/host/state-config.test.ts` — Tests asset resolution logic with mock `process.execPath`
- `/workspaces/host-git-cred-proxy/tests/host/ui-routes.test.ts` — Tests UI route serving
- `/workspaces/host-git-cred-proxy/tests/container/install-smoke.test.ts` — Tests container installer

### Process Manager Packaging Consideration

**Critical Issue in `process-manager.ts` line 207:**
```typescript
const subprocess = Bun.spawn(['bun', 'run', entrypoint, 'serve'], {
  detached: true,
  // ...
});
```

**Problem:** For packaged binary, this spawns `bun run <binary> serve` instead of `<binary> serve`.

**Solution Options:**
1. Detect compiled mode: Check if `process.execPath` ends with `host-git-cred-proxy`
2. Use self-execution: `Bun.spawn([process.execPath, 'serve'], ...)`
3. Add compile-time flag injection to detect packaged mode

### Acceptance Criteria Checklist (from plan)

- [ ] `bun run package:release` emits both tarballs and `checksums.txt` under `dist/releases/`
- [ ] Tarball filenames: `host-git-cred-proxy-darwin-arm64.tar.gz`, `host-git-cred-proxy-darwin-x64.tar.gz`
- [ ] `bun run smoke:tarball` extracts tarball, starts binary, gets `ok` from `/healthz`
- [ ] Binary resolves `share/host-git-cred-proxy/ui` correctly from packaged layout
- [ ] Binary resolves `share/host-git-cred-proxy/container/*` correctly
- [ ] Binary works from arbitrary cwd with `GIT_CRED_PROXY_STATE_DIR` override
- [ ] Checksums.txt contains SHA256 hashes for both tarballs

### Recommended Implementation Order

1. Create `scripts/package-release.ts` with:
   - UI build step
   - Binary compile step (single arch first for testing)
   - Tarball assembly
   - Checksum generation

2. Update `package.json` scripts

3. Create `scripts/smoke-tarball.ts`

4. Fix process-manager spawn logic for compiled binary

5. Add multi-architecture support (arm64 + x64)

6. Create packaging tests

7. Add Homebrew formula template (for task 20)

## Task 18: Bun Executable Compilation, Environment Controls, and Tarball/Checksum Packaging

### Official Documentation Sources

**Primary Sources:**
- Bun Single-file Executable: https://bun.com/docs/bundler/executables
- Bun Archive API: https://bun.com/docs/runtime/archive
- Bun Hashing API: https://bun.com/docs/runtime/hashing
- Context7 Library ID: `/oven-sh/bun` (high reputation, 81.99 benchmark score)

### 1. Compile Targets for Darwin (macOS)

**Supported Darwin Targets:**
```typescript
type Target =
  | "bun-darwin-x64"           // Intel-based Macs
  | "bun-darwin-x64-baseline"  // Older Intel Macs (pre-2013, Nehalem)
  | "bun-darwin-arm64"         // Apple Silicon (M1/M2/M3)
```

**Compilation Examples:**

CLI:
```bash
# macOS ARM64 (Apple Silicon)
bun build --compile --target=bun-darwin-arm64 ./path/to/app.ts --outfile myapp

# macOS x64 (Intel)
bun build --compile --target=bun-darwin-x64 ./path/to/app.ts --outfile myapp

# With optimizations for production
bun build --compile --target=bun-darwin-arm64 --minify --sourcemap --bytecode ./app.ts --outfile myapp
```

JavaScript API:
```typescript
await Bun.build({
  entrypoints: ["./app.ts"],
  compile: {
    target: "bun-darwin-arm64",
    outfile: "./myapp",
  },
  minify: true,
  sourcemap: "linked",
  bytecode: true,
});
```

**Important Notes:**
- Darwin x64 has baseline/modern variants for CPU compatibility
- Darwin arm64 has no baseline variant (N/A in table)
- Windows `.exe` extension added automatically when needed
- All imported files and packages bundled with Bun runtime
- All built-in Bun and Node.js APIs supported

### 2. Environment/Autoload Controls for Deterministic Binaries

**Default Behavior:**
- `tsconfig.json` and `package.json` loading: **DISABLED** by default
- `.env` and `bunfig.toml` loading: **ENABLED** by default
- Future versions may disable `.env` and `bunfig.toml` by default for determinism

**JavaScript API Configuration:**
```typescript
await Bun.build({
  entrypoints: ["./app.ts"],
  compile: {
    outfile: "./myapp",
    
    // Enable runtime config loading (disabled by default)
    autoloadTsconfig: true,        // Enable tsconfig.json
    autoloadPackageJson: true,     // Enable package.json
    
    // Disable runtime config loading (enabled by default)
    autoloadDotenv: false,         // Disable .env
    autoloadBunfig: false,         // Disable bunfig.toml
  },
});
```

**CLI Flags:**
```bash
# Enable config loading
bun build --compile --compile-autoload-tsconfig --compile-autoload-package-json ./app.ts

# Disable config loading for deterministic execution
bun build --compile --no-compile-autoload-dotenv --no-compile-autoload-bunfig ./app.ts
```

**For Deterministic Packaged Binaries (Atlas recommendation):**
```typescript
await Bun.build({
  entrypoints: ["./src/index.ts"],
  compile: {
    target: "bun-darwin-arm64",
    outfile: "./dist/host-git-cred-proxy-darwin-arm64",
    
    // Disable ALL config loading for deterministic behavior
    autoloadDotenv: false,
    autoloadBunfig: false,
    
    // Optional: embed runtime arguments
    execArgv: ["--smol"],  // e.g., reduced memory mode
  },
  minify: true,
  sourcemap: "linked",
  bytecode: true,
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    VERSION: JSON.stringify("1.0.0"),
  },
});
```

**Runtime Arguments via Environment:**
- `BUN_OPTIONS` env var applies to compiled executables without recompiling
- Example: `BUN_OPTIONS="--cpu-prof" ./myapp`
- Useful for debugging/profiling production executables

### 3. Tarball and Checksum Packaging Patterns

#### A. Bun.Archive API for Tarball Creation

**Basic Archive Creation:**
```typescript
// Create uncompressed tar
const archive = new Bun.Archive({
  "README.md": "# My Project",
  "binary": await Bun.file("./myapp").bytes(),
});

await Bun.write("output.tar", archive);

// Create gzipped tar with compression level (1-12)
const compressed = new Bun.Archive(
  { "binary": await Bun.file("./myapp").bytes() },
  { compress: "gzip", level: 12 }
);

await Bun.write("output.tar.gz", compressed);
```

**Supported Compression:**
- No options/undefined: Uncompressed tar (default)
- `{ compress: "gzip" }`: Gzip at level 6
- `{ compress: "gzip", level: number }`: Gzip with level 1-12 (1=fastest, 12=smallest)

**Archive Input Types:**
- Strings (text content)
- Blobs (binary data)
- TypedArrays (Uint8Array)
- ArrayBuffers

#### B. Bun.CryptoHasher for SHA256 Checksums

**Generate SHA256 Checksum:**
```typescript
import { CryptoHasher } from "bun";

// Method 1: Quick hash
const fileBytes = await Bun.file("./myapp").bytes();
const hasher = new CryptoHasher("sha256");
hasher.update(fileBytes);
const checksum = hasher.digest("hex");

// Method 2: Streaming hash for large files
const file = Bun.file("./large-binary");
const streamHasher = new CryptoHasher("sha256");
for await (const chunk of file.stream()) {
  streamHasher.update(chunk);
}
const checksum = streamHasher.digest("hex");
```

**Available Algorithms:**
- SHA family: `"sha1"`, `"sha224"`, `"sha256"`, `"sha384"`, `"sha512"`, `"sha512-224"`, `"sha512-256"`, `"sha3-224"`, `"sha3-256"`, `"sha3-384"`, `"sha3-512"`
- BLAKE: `"blake2b256"`, `"blake2b512"`
- Legacy: `"md4"`, `"md5"`, `"ripemd160"`

**Output Encodings:**
- `"hex"`: Hexadecimal string (recommended for checksums)
- `"base64"`: Base64-encoded string
- `"base64url"`: URL-safe base64
- Default: `Uint8Array` if no encoding specified

#### C. Complete Release Packaging Script Pattern

```typescript
import { $ } from "bun";

const version = process.env.npm_package_version || "1.0.0";
const binaryName = "host-git-cred-proxy";

// Build targets
const targets = [
  { target: "bun-darwin-arm64", name: `${binaryName}-darwin-arm64` },
  { target: "bun-darwin-x64", name: `${binaryName}-darwin-x64` },
];

const checksums: string[] = [];

for (const { target, name } of targets) {
  console.log(`Building ${name}...`);
  
  // Compile binary
  await Bun.build({
    entrypoints: ["./src/index.ts"],
    compile: {
      target,
      outfile: `./dist/${name}`,
      autoloadDotenv: false,
      autoloadBunfig: false,
    },
    minify: true,
    sourcemap: "linked",
    bytecode: true,
    define: {
      VERSION: JSON.stringify(version),
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
  });
  
  // Create tarball
  const binary = await Bun.file(`./dist/${name}`).bytes();
  const tarball = new Bun.Archive(
    { [name]: binary },
    { compress: "gzip", level: 9 }
  );
  const tarballPath = `./dist/${name}.tar.gz`;
  await Bun.write(tarballPath, tarball);
  
  // Generate checksum
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await Bun.file(tarballPath).bytes());
  const checksum = hasher.digest("hex");
  checksums.push(`${checksum}  ${name}.tar.gz`);
  
  console.log(`  Created ${tarballPath}`);
  console.log(`  SHA256: ${checksum}`);
}

// Write checksums file
await Bun.write("./dist/checksums.txt", checksums.join("\n") + "\n");
console.log("Release packaging complete!");
```

**Checksum File Format (checksums.txt):**
```
a1b2c3d4e5f6...  host-git-cred-proxy-darwin-arm64.tar.gz
f6e5d4c3b2a1...  host-git-cred-proxy-darwin-x64.tar.gz
```

### 4. Additional Production Deployment Flags

**Recommended for Production:**
```bash
bun build --compile --minify --sourcemap --bytecode \
  --no-compile-autoload-dotenv --no-compile-autoload-bunfig \
  --define VERSION='"1.0.0"' \
  ./src/index.ts --outfile myapp
```

**What Each Flag Does:**
- `--minify`: Optimizes transpiled output size (megabytes for large apps)
- `--sourcemap`: Embeds compressed sourcemap (zstd) for error stack traces
- `--bytecode`: Moves parsing from runtime to bundle time (2x faster startup for large apps)
- `--no-compile-autoload-*`: Ensures deterministic runtime behavior
- `--define`: Inject build-time constants (version, timestamps)

### 5. Cross-Compilation Notes

- Cross-compilation from any platform to any target supported
- No native dependencies required for cross-compilation
- `bun-linux-x64-baseline` for pre-2013 CPUs (Nehalem)
- `bun-linux-x64-modern` for 2013+ CPUs (Haswell) - faster but less compatible
- Windows ARM64 supported as of Bun v1.3.10
- `BUN_BE_BUN=1` env var lets compiled executable act as full `bun` CLI

### 6. Integration Recommendations for Atlas

**For Task 18 Implementation:**

1. **Build Script**: Use JavaScript API with explicit target list
2. **Determinism**: Disable ALL autoload options (`autoloadDotenv: false`, `autoloadBunfig: false`)
3. **Optimization**: Enable `minify`, `sourcemap`, `bytecode` for production
4. **Tarball**: Use `Bun.Archive` with `{ compress: "gzip", level: 9 }`
5. **Checksum**: Use `Bun.CryptoHasher("sha256")` with hex encoding
6. **Artifacts**: Generate both tarballs and `checksums.txt` in single script
7. **Verification**: Users can verify with `shasum -a 256 -c checksums.txt` (macOS) or `sha256sum -c checksums.txt` (Linux)

**Example Output Structure:**
```
dist/
├── host-git-cred-proxy-darwin-arm64
├── host-git-cred-proxy-darwin-arm64.tar.gz
├── host-git-cred-proxy-darwin-x64
├── host-git-cred-proxy-darwin-x64.tar.gz
└── checksums.txt
```

**Checksum Verification Command:**
```bash
# Verify all checksums
sha256sum -c checksums.txt

# Or on macOS
shasum -a 256 -c checksums.txt
```

### References

- Bun v1.3.6 introduced `Bun.Archive` API (Jan 2026)
- Bun v1.3.9 added ESM bytecode compilation support
- Bun v1.3.10 added Windows ARM64 support
- Checksum action example: https://github.com/thewh1teagle/checksum
- Node.js signing pattern: SHASUMS256.txt.asc (clearsigned GPG)


## Task 19 Investigation: GitHub Actions Release Workflow State and Gaps

### Current `.github/workflows` State
- **Directory does NOT exist** — no `.github/workflows/` directory or files present
- **No existing CI/CD infrastructure** — this is greenfield for GitHub Actions
- Task 19 will need to create the entire `.github/workflows/` structure from scratch

### Task 18 Packaging Outputs (Task 19 Inputs)

#### Build Script
- **Path:** `/workspaces/host-git-cred-proxy/scripts/package-release.ts`
- **Command:** `bun run package:release`
- **Behavior:**
  - Builds UI via `bun run build:ui`
  - Compiles host binary for both `bun-darwin-arm64` and `bun-darwin-x64`
  - Creates deterministic tarballs with fixed mtime (epoch 0)
  - Outputs to `dist/releases/` directory

#### Release Artifacts (from Task 18)
- **Output Directory:** `/workspaces/host-git-cred-proxy/dist/releases/`
- **Tarballs:**
  1. `host-git-cred-proxy-darwin-arm64.tar.gz`
  2. `host-git-cred-proxy-darwin-x64.tar.gz`
- **Checksums:** `checksums.txt` (SHA256 format: `<sha256>  <filename>`)
- **Tarball Layout:**
  - `bin/host-git-cred-proxy` — compiled binary (mode 0755)
  - `share/host-git-cred-proxy/ui/*` — UI assets including `index.html`
  - `share/host-git-cred-proxy/container/install.sh`
  - `share/host-git-cred-proxy/container/configure-git.sh`
  - `share/host-git-cred-proxy/container/git-credential-hostproxy`

#### Smoke Test Command
- **Command:** `bun run smoke:tarball`
- **Test File:** `/workspaces/host-git-cred-proxy/tests/release/tarball-smoke.test.ts`
- **Behavior:**
  - Extracts each tarball to temp directory
  - Validates tarball layout (binary, UI assets, container scripts)
  - Validates Mach-O CPU type for architecture correctness
  - **Runtime smoke SKIPPED on non-macOS** (current CI would skip actual execution)
  - Missing asset tests verify loud failure when UI assets removed

### Key Integration Points for Task 19

#### 1. Workflow Triggers
- **Tag-driven:** Trigger on version tags (e.g., `v*.*.*`)
- **Optional:** Manual workflow dispatch for testing

#### 2. Runner Matrix (from plan lines 885-906)
- `macos-13` (Intel/x64)
- `macos-14` (Apple Silicon/arm64)
- Both runners must perform native builds and smoke tests

#### 3. Job Structure (likely pattern)
```
build-darwin-arm64 (macos-14)
  ├─ bun install
  ├─ bun run build
  ├─ bun run package:release (arm64 only)
  └─ bun run smoke:tarball (native macOS runtime verification)

build-darwin-x64 (macos-13)
  ├─ bun install
  ├─ bun run build
  ├─ bun run package:release (x64 only)
  └─ bun run smoke:tarball (native macOS runtime verification)

release (needs: [build-darwin-arm64, build-darwin-x64])
  ├─ Download artifacts from both build jobs
  ├─ Generate/verify checksums
  └─ Create draft GitHub Release with tarballs + checksums.txt
```

#### 4. Bun Installation in CI
- GitHub Actions doesn't have native Bun runner
- Options:
  1. Use `oven-sh/setup-bun` action
  2. Use official Bun install script: `curl -fsSL https://bun.sh/install | bash`
- Bun version requirement from package.json: `">=1.3.10"`

#### 5. Artifact Upload/Download
- Use `actions/upload-artifact` for per-architecture tarballs
- Use `actions/download-artifact` in release job
- Merge both tarballs + checksums into single release

#### 6. GitHub Release Publication
- Use `softprops/action-gh-release` or `gh` CLI
- Draft release mode (per plan)
- Assets: 2 tarballs + checksums.txt only
- **Do NOT** push Homebrew tap from this task (Task 20 responsibility)

### Exact Files Atlas Will Need to Create

1. **`.github/workflows/release.yml`** — Main release workflow
   - Tag trigger pattern
   - Matrix strategy for macOS runners
   - Build jobs for each architecture
   - Release job with draft publication
   - Smoke test execution before publication

### Current Gaps

1. **No `.github/` directory exists** — must create from scratch
2. **No existing workflow patterns to follow** — greenfield implementation
3. **No Bun setup in CI** — must add `setup-bun` action
4. **Smoke tests skip runtime verification on Linux** — native macOS runners are essential for honest smoke
5. **No version extraction mechanism** — workflow must derive version from git tag for release notes

### Workflow Constraints (from plan)

**Must Do:**
- Build on native macOS runners (no cross-compilation)
- Run smoke tests before publishing
- Publish draft release (not auto-publish)
- Include only: 2 tarballs + checksums.txt

**Must NOT Do:**
- Rely on cross-compilation from non-macOS runners
- Publish assets without smoke evidence
- Push Homebrew tap (Task 20 scope)

### Evidence Paths for Task 19
- Success: `.sisyphus/evidence/task-19-release-workflow.txt`
- Error: `.sisyphus/evidence/task-19-release-workflow-error.txt`

### Acceptance Criteria (from plan lines 903-906)
- [ ] Workflow YAML validates and includes matrix jobs for Intel and Apple Silicon macOS runners
- [ ] CI runs `bun run package:release` and `bun run smoke:tarball` before publishing the draft release
- [ ] Release assets include `host-git-cred-proxy-darwin-arm64.tar.gz`, `host-git-cred-proxy-darwin-x64.tar.gz`, and `checksums.txt` only

### QA Scenarios (from plan lines 908-921)
1. **Happy path:** Both architecture jobs pass packaging and smoke steps before draft release
2. **Failure path:** Failed smoke test blocks publication

### Dependencies
- Task 19 depends on: Tasks 8, 18 (both complete)
- Task 19 blocks: Task 20 (Homebrew automation)


## Task 20 Investigation: Homebrew Automation State and Gaps

### Current State Summary

#### Existing Infrastructure (From Tasks 18-19)

**Task 18 Packaging (COMPLETE):**
- **Packaging Script:** `/workspaces/host-git-cred-proxy/scripts/package-release.ts`
- **Smoke Test:** `/workspaces/host-git-cred-proxy/tests/release/tarball-smoke.test.ts`
- **Output Directory:** `/workspaces/host-git-cred-proxy/dist/releases/`
- **Release Tarballs (already built):**
  - `host-git-cred-proxy-darwin-arm64.tar.gz` (23MB)
  - `host-git-cred-proxy-darwin-x64.tar.gz` (25MB)
  - `checksums.txt` (210 bytes)

**Task 19 Release Workflow (COMPLETE):**
- **Workflow:** `/workspaces/host-git-cred-proxy/.github/workflows/release.yml`
- **Workflow Validator:** `/workspaces/host-git-cred-proxy/scripts/validate-release-workflow.ts`
- **Triggers:** Tag-driven (`v*` tags)
- **Matrix:** `macos-14` (arm64) + `macos-14-large` (x64)
- **Draft Release:** Uses `softprops/action-gh-release@v2`

#### Homebrew-Related Files: NONE EXIST

**Search Results:**
- No `packaging/` directory exists
- No `.github/workflows/homebrew*` files exist
- No `*.rb` formula files in repository
- No references to "brew", "formula", "homebrew", or "tap" in code files
- `smoke:brew` script in package.json: `echo 'not yet implemented'`

**Local Environment:**
- `brew` is NOT installed in this workspace
- Local brew smoke test will require either:
  1. Installing brew in the workspace, OR
  2. Running smoke in a macOS CI environment (via Task 19 workflow extension)

### Required Tarball Layout (Already Implemented by Task 18)

```
host-git-cred-proxy-darwin-{arm64,x64}.tar.gz
├── bin/
│   └── host-git-cred-proxy          # Compiled Bun binary (mode 0755)
└── share/
    └── host-git-cred-proxy/
        ├── ui/
        │   ├── index.html
        │   └── assets/
        │       ├── index-*.js
        │       └── index-*.css
        └── container/
            ├── install.sh
            ├── configure-git.sh
            └── git-credential-hostproxy
```

### Task 20 Acceptance Criteria (from plan lines 948-951)

- [ ] `bun run smoke:brew` creates a temp tap, writes the generated formula, runs `brew audit --strict`, installs from the local tarballs, and runs `brew test`
- [ ] The formula installs `host-git-cred-proxy` into `bin/` and the UI/container assets into `share/host-git-cred-proxy/`
- [ ] Remote tap publication is gated behind environment configuration and documents the missing tap identifier as `[DECISION NEEDED]` rather than hardcoding guesses

### Exact Files Atlas Will Need to Create

#### 1. Formula Template
**Path:** `/workspaces/host-git-cred-proxy/packaging/homebrew/host-git-cred-proxy.rb`

**Required Structure (from IMPLEMENTATION_PLAN.md:496-510):**
```ruby
class HostGitCredProxy < Formula
  desc "Host Git credential proxy for container credential forwarding"
  homepage "https://github.com/<OWNER>/<REPO>"  # [DECISION NEEDED]
  version "0.1.0"  # Should be templated from package.json version

  on_arm do
    url "https://github.com/<OWNER>/<REPO>/releases/download/v#{version}/host-git-cred-proxy-darwin-arm64.tar.gz"
    sha256 "<COMPUTED_FROM_CHECKSUMS>"
  end

  on_intel do
    url "https://github.com/<OWNER>/<REPO>/releases/download/v#{version}/host-git-cred-proxy-darwin-x64.tar.gz"
    sha256 "<COMPUTED_FROM_CHECKSUMS>"
  end

  def install
    bin.install "bin/host-git-cred-proxy"
    share.install Dir["share/host-git-cred-proxy"]
  end

  test do
    # Create temp state dir
    state_dir = mkpath "#{testpath}/state"
    
    # Start service
    pid = spawn({"GIT_CRED_PROXY_STATE_DIR" => state_dir.to_s}, 
                bin/"host-git-cred-proxy", "serve")
    
    # Wait for healthz
    sleep 2
    output = shell_output("curl -s http://127.0.0.1:18765/healthz")
    assert_match "ok", output
    
    # Cleanup
    Process.kill("TERM", pid)
    Process.wait(pid)
  end
end
```

#### 2. Formula Generator Script
**Path:** `/workspaces/host-git-cred-proxy/scripts/generate-homebrew-formula.ts`

**Responsibilities:**
- Read version from `package.json`
- Read checksums from `dist/releases/checksums.txt`
- Template formula with arch-specific URL/SHA256 blocks
- Accept optional `TAP_REPO` env var for remote publication
- Output to `packaging/homebrew/` or stdout

#### 3. Local Brew Smoke Test
**Path:** `/workspaces/host-git-cred-proxy/tests/release/brew-smoke.test.ts`

**Responsibilities:**
- Skip gracefully if `brew` not installed (record in evidence)
- Create temp tap directory
- Generate formula pointing to local tarballs
- Run `brew audit --strict` on formula
- Run `brew install --build-from-source` with `--formula` flag
- Run `brew test host-git-cred-proxy`
- Cleanup temp tap

#### 4. Remote Tap Automation (Optional)
**Path:** `/workspaces/host-git-cred-proxy/scripts/publish-homebrew-tap.ts`

**Responsibilities:**
- Gate on `HOMEBREW_TAP_REPO` env var (e.g., `owner/homebrew-tap`)
- Fail with `[DECISION NEEDED]` notice if not configured
- Clone tap repo, update formula, commit, push
- Integrate into release workflow as optional step

### Current Blockers

#### 1. Missing Tap Repository Identifier
- **Status:** `[DECISION NEEDED]`
- **Impact:** Cannot hardcode GitHub release URLs or tap repo path
- **Workaround:** Use environment variable, document as required for remote publication

#### 2. Local `brew` Availability
- **Status:** `BREW_NOT_INSTALLED` in current workspace
- **Impact:** Local `smoke:brew` cannot run natively
- **Options:**
  1. Install brew in workspace (adds dependency)
  2. Run smoke in CI only (macOS runners have brew)
  3. Make smoke conditional with skip marker

#### 3. GitHub Release URLs
- **Status:** Requires tap repo owner/repo to construct URLs
- **Impact:** Formula `url` fields cannot be finalized until tap repo is known
- **Workaround:** Template URLs, require `GITHUB_REPOSITORY` or similar env var

### Key Files to Modify

#### package.json (lines 7-21)
Current:
```json
"smoke:brew": "echo 'not yet implemented'"
```

Required:
```json
"smoke:brew": "bun test tests/release/brew-smoke.test.ts",
"generate:formula": "bun run scripts/generate-homebrew-formula.ts",
"publish:tap": "bun run scripts/publish-homebrew-tap.ts"
```

### Recommended Implementation Order

1. Create `packaging/homebrew/` directory
2. Implement `scripts/generate-homebrew-formula.ts`
3. Create formula template `packaging/homebrew/host-git-cred-proxy.rb`
4. Implement `tests/release/brew-smoke.test.ts` with graceful skip
5. Update `package.json` scripts
6. (Optional) Implement `scripts/publish-homebrew-tap.ts` for remote automation
7. (Optional) Add brew smoke step to `.github/workflows/release.yml`

### Reference Documentation

**Official Homebrew Docs:**
- Formula Cookbook: https://docs.brew.sh/Formula-Cookbook
- How to Create and Maintain a Tap: https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap
- Formula API Reference: https://rubydoc.brew.sh/Formula

**Key Patterns:**
- `on_arm` / `on_intel` blocks for arch-specific URLs
- `bin.install` for executables
- `share.install Dir["share/*"]` for asset directories
- `test do` block for `brew test` verification
- `audit --strict` for formula validation

### Evidence Paths for Task 20
- Success: `.sisyphus/evidence/task-20-homebrew.txt`
- Error: `.sisyphus/evidence/task-20-homebrew-error.txt`

### Dependencies
- Task 20 depends on: Tasks 18, 19 (both COMPLETE)
- Task 20 blocks: Nothing (final task in Wave 4)
- Container environment lacks `brew` and `ruby`, blocking native macOS smoke tests for tarballs and Homebrew formulas. Handoff to host is required for Tasks 18 and 20.
