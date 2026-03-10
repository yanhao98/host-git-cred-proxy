# Decisions

## Frozen Architecture
- Single port 127.0.0.1:18765, publicUrl is config-only not trust
- External share/host-git-cred-proxy/* assets, NOT Bun binary embedding
- Token rotation: atomic file write + in-memory refresh, no restart needed
- Container token: mount the directory not a single file (inode rotation safety)
- configure-git.sh: prepend hostproxy, preserve all existing helpers in order
- Process restart: current process returns JSON, spawns replacement, exits; UI navigates to nextPanelUrl
- Admin nonce: in-memory only, refreshed on restart, fetched via GET /api/admin/bootstrap

## Task 9 Admin Guard Shape
- Keep admin route protection as standalone request evaluation plus an Elysia-compatible `beforeHandle` wrapper, with optional custom IP resolution for tests and Bun `server.requestIP(request)` fallback at runtime.

## Task 16: Helper-chain Mutation Policy
- `configure-git.sh` must prepend `git-credential-hostproxy` to the helper list.
- All existing non-duplicate helpers must be re-added in their original relative order.
- Old path-based entries for `git-credential-hostproxy` must be purged during the transition to command-based mode.
- `credential.useHttpPath` must be set to `true` in the same scope as the helper configuration.

## Task 11 UI Route Wiring
- Do not mount `@elysiajs/static` at `/`; UI shell and assets are served via explicit host GET routes rooted at `resolveUiDistDir()`.
- SPA fallback stays GET-only and excludes reserved prefixes (`/api`, `/container`, `/healthz`, `/fill`, `/approve`, `/reject`, `/get`, `/store`, `/erase`).
- Loopback checks for panel access are attached only to UI GET routes, never as a plugin-wide hook that can touch proxy POST handling.

## Task 19 Release Workflow
- Release publication is tag-driven (`push` on `v*`) and stays in the main repository as a draft GitHub Release.
- Native packaging/smoke runs on a macOS matrix (`macos-13` for `darwin-x64`, `macos-14` for `darwin-arm64`), uploads only runner-specific tarball artifacts, and the release job merges those artifacts to generate the final `checksums.txt` without rebuilding binaries.
