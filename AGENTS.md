# Agent Guidance


## Memory Fast-Track Workflow

When explicitly requested by the user, agents may fast-track memory-only updates
so other systems that read `origin/main` can pick them up quickly.

Trigger phrases include:

- "fast-track memory updates"
- "commit and merge memory"
- "push memory to origin"
- "make these memories available to other systems"
- "fast-track memory by direct push" - use only for the direct-push exception

This workflow is allowed only when all pending changes are limited to memory or
memory/procedural-memory guidance files:

- `AGENTS.md`
- `CODING_STANDARDS.md`
- `WORKFLOW_STANDARDS.md`
- `.remember/MEMORY.md`
- `.remember/memory/*.md`

If any other tracked, staged, modified, deleted, or untracked path is present,
stop and ask the user whether to handle that work separately. Do not include
non-memory files in a memory fast-track.

Required sequence:

1. Confirm the user explicitly requested a memory fast-track.
2. Inspect `git status --short` and fail closed unless only allowed memory paths
   are present.
3. Fetch and integrate the latest `origin/main` before committing.
4. Resolve conflicts only in allowed memory files; preserve journal chronology
   and update the single active `context` entry instead of duplicating it.
5. Review memory content for obvious secrets or sensitive account data.
6. Run `git diff --check`.
7. Commit with a conventional memory message such as
   `chore(memory): fast-track memory updates`.
8. Prefer a short-lived branch plus a pull request; use `gh pr merge` when available.
9. Use direct push to `origin/main` only when the user explicitly requests
   direct-push fast-tracking.
10. Fetch after merge or push and verify `origin/main` contains the memory
    commit before reporting completion.
