# Problems

(none yet)

## Space-handling in configure-git.sh (Live QA Follow-up)
- Building a git command string and executing it unquoted in POSIX sh caused failure when the repository path contained spaces.
- FIXED by replacing string-based command execution with a helper function `git_config` that correctly quotes arguments and dispatches based on scope.

## Task 11 UI Integration Regressions (Fixed)
- Root-mounted static handling in UI routing caused `GET /` to resolve incorrectly and leaked into proxy paths, producing `500` failures on credential POST routes.
- FIXED by replacing root static mount + broad fallback with explicit UI GET endpoints (`/`, `/assets/*`) and a reserved-prefix-aware SPA fallback.
