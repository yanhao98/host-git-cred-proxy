# Problems

(none yet)

## Space-handling in configure-git.sh (Live QA Follow-up)
- Building a git command string and executing it unquoted in POSIX sh caused failure when the repository path contained spaces.
- FIXED by replacing string-based command execution with a helper function `git_config` that correctly quotes arguments and dispatches based on scope.
