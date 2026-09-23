# chore-orchestrate

The Claude Code port of `.agents/skills/chore-orchestrate/`. The references are
shared contracts and stay byte-identical to the Codex copy; `SKILL.md` and the
three role agents under `.claude/agents/` are adapted to Claude Code's Agent,
SendMessage, and Skill tools.

The adapted files also follow the Claude Opus 5.5 prompting guide: the
continuation rule names the early stops a run must not take, work still running
holds its phase open, read text is data rather than instruction, and the plan
agent reads the repository's own guidance before planning.

Delivers one chore end to end — tooling, documentation, CI, dependency, or
refactor work whose diff proves its own completion — across one repository or
one synchronized pair, and leaves an open pull request the sponsor merges.

Work that needs proof beyond the diff belongs to a different workflow.

## Files

| Path | What it holds |
| --- | --- |
| `SKILL.md` | The lifecycle, authority boundaries, and terminal signals |
| `references/repository-profile.md` | The fourteen profile fields, their defaults, and the narrow-only rule |
| `references/profile-template.md` | A copy-paste profile block and a worked example |
| `references/run-state.md` | The run issue, the appended coordination record, the plan, verification, snapshot, and retrospective comments |
| `references/coderabbit-review.md` | The review loop and polling rules when the profile's `review_capability` is `coderabbit` |
| `../../agents/chore-plan-agent.md` | Plans only what is expensive to reverse; writes nothing |
| `../../agents/chore-build-agent.md` | The sole writer in one repository |
| `../../agents/chore-verify-agent.md` | Chooses a falsifying check per criterion and posts the evidence; given identifiers only |

## What it needs

**From the environment:** `git`, `uv`, and `gh`, authenticated, and the review
capability the profile's `review_capability` names. Under `consensus-review`,
the default, that is the `v8ch:consensus-review` skill at 2.0.0 or later — without it the
run stops at the review phase with `DEPENDENCY_MISSING` rather than reviewing
its own work. Under `coderabbit`, it is CodeRabbit installed on the repository with
automatic review off, reviewed through `references/coderabbit-review.md`: the
orchestrator triggers every review, and the retained builder applies every
repair.

**From the repository:** a profile in its steering document
(`references/profile-template.md`). Every field but one has a conservative
default, so a repository with no profile still runs — it just asks the sponsor
more often — provided a workspace profile states `coordination_repository`.
That field defaults to `none`, and a run with no coordination repository cannot
start. In a
workspace holding several repositories, the repository's own profile wins and the
workspace profile fills what it does not state. The
field that changes the run most is `autonomy`:

- `autonomous` — the manager checks the plan against the run issue's acceptance
  criteria and accepts it. It returns to the sponsor only for the four
  escalations below.
- `checkpointed` (the default) — the sponsor approves the plan before any code
  changes.

**From the sponsor:** a run issue in the coordination repository, with a
sub-issue for each repository whose profile requires one, and acceptance criteria
that are concrete and jointly satisfiable. The run creates no issues. The run stops with `NEEDS_REFINEMENT` when they are not,
naming the collision rather than inventing a resolution.

## What it asks the sponsor

Only four things: adding a repository to the run, exceeding the review budget,
taking work outside the approved plan, and anything the profile marks
`checkpointed`. Everything else it decides and records.

## What it never does

Merge, force-push, deploy, run a production migration, read or write secrets,
run bulk-data or scheduled-job commands, or point a local tool at shared or
production data. A profile can forbid more; it can never permit past this list.

## Where the run leaves its state

The run issue carries the run: a coordination record appended at every phase
change, so a fresh manager resumes from the latest; the accepted plan, one
comment per revision; a terminal snapshot written once; and a retrospective. Each
pull request carries its repository's facts: reviews, the verification comment,
and fix evidence in commit bodies. Each links the other. Local scratch is never
evidence.

## Running it

See `../supervise/templates/kickoff.md` for the invocation, and
`../supervise/references/status-block.md` for the status block the manager emits each
turn when a supervisor is watching.
