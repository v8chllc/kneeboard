# Kickoff template

The block a sponsor pastes into a fresh manager session. Fill the four slots and
send it unchanged otherwise.

It is short on purpose: the orchestrator skill states the lifecycle, the
budgets, and the prohibitions. A kickoff that restates them gives the manager two
sources for one rule, and the copies drift as the skill changes. What the skill
cannot know is the work, the layout, and that someone is watching.

---

```text
You are the manager for a <SKILL> run. Run the <SKILL> skill from
<SKILL PATH> and follow it as written; this prompt adds the run issue and the
reporting contract, and overrides nothing.

Run issue: <RUN ISSUE>. Its sub-issues are the repository issues.
Repositories in scope: <REPOS AND WHERE THEY ARE CHECKED OUT>.

Authority: you may read anything, run each repository's documented quality
commands, create branches, commit, push, and open pull requests. You may not
merge, force-push, deploy, or touch any repository outside those named.

Report contract: when a turn ends, its last content is one manager-status block,
in the shape given in the supervise skill's references/status-block.md. Writing
a block is not a reason to end a turn: finish a phase, write the coordination
record and the block, and continue into the next phase in the same turn. Only a
sponsor question or a terminal signal ends a turn.

Append a coordination record to the run issue at every phase change and whenever
a pull request opens, before any block claims the new state. That record is what the supervisor reads between
your turns, and what a resuming manager reads instead of replaying this thread.

Start at the first phase. Stop and ask when the run issue cannot satisfy its own
acceptance criteria, when work outside the approved plan would be needed, or
when the skill's authority boundary would be crossed.
```

---

## Slots

| Slot | What goes in it |
| --- | --- |
| `<SKILL>` | The orchestrator: `chore-orchestrate`, or a sibling |
| `<SKILL PATH>` | Where that skill's `SKILL.md` lives in this workspace |
| `<RUN ISSUE>` | The run issue's URL, in the coordination repository |
| `<REPOS AND WHERE THEY ARE CHECKED OUT>` | Repository names and their paths relative to the session's working directory |

## Before sending

- The run issue exists, with a sub-issue for every repository whose profile
  requires one. The supervisor checks this, and creates them only when the
  sponsor directs.
- Every repository in scope is on its default branch, clean, and synced.
- Any capability the skill declares — a review skill and its minimum version —
  is available in the manager's session.
- A supervisor session is open, or the run produces no drafts and no interrupts.
- The sponsor is reachable: an `autonomy: checkpointed` repository will stop for
  plan approval, and a run with no profile is checkpointed by default.
