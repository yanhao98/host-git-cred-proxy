# Issues

(none yet)

## Task 11 Host UI Integration Regression (Resolved)
- Symptom: `GET /` returned non-HTML payload and proxy credential POST routes regressed to `500`.
- Resolution: migrated to explicit UI GET routing with reserved-prefix SPA fallback exclusion and route-scoped loopback checks.

### Task 12 Scope Creep Cleanup
- I accidentally committed or included `playwright` into the `package.json` + `bun.lock` dependencies to satisfy my QA evidence screenshot script. Testing dependencies should be kept separate, and test build artifacts (`host/ui/dist/*`) should not be staged/kept during development tasks unless that explicitly falls under the task's instructions (like an explicit deploy/build prep). Reverted to keep scope tight.

## Task 19 Local Validation Constraint
- Linux can validate workflow structure plus cross-compiled tarball layout, but it cannot execute the native macOS runtime smoke path locally. Added a structural validator/evidence note so the publication gate is still proven before CI runs on `macos-13`/`macos-14`.
