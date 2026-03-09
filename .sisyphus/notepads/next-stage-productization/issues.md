# Issues

(none yet)

## Task 11 Host UI Integration Regression (Resolved)
- Symptom: `GET /` returned non-HTML payload and proxy credential POST routes regressed to `500`.
- Resolution: migrated to explicit UI GET routing with reserved-prefix SPA fallback exclusion and route-scoped loopback checks.
