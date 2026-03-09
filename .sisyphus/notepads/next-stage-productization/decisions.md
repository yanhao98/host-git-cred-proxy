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
