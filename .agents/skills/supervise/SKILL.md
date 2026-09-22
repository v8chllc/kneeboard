---
name: supervise
description: Watches an orchestrator run executed by another agent, usually in another session or toolchain, and reports to the sponsor. Reads the run's published state, corroborates every claim against the repositories and the run issue, interrupts on unsafe or irreversible action, and drafts replies for decisions the sponsor owns. Read-only once a run starts: it never edits a repository, posts to an issue or pull request, or answers the manager directly. Before kickoff it checks the run issue exists, and creates one only when the sponsor directs.
---

# Supervise

## Goal

Give the sponsor an independent read on a run they are not watching, and catch
the failures a manager cannot catch about itself: an unsafe action, evidence
with nothing behind it, scope taken without asking, a run that has stopped.

## When to use

A long orchestrator run — `chore-orchestrate` or a sibling — driven by another
agent, usually in another session and often another toolchain. Start the
supervisor before the run, so it has a baseline.

Do not use it to watch your own work. A supervisor reading its own session has
nothing independent to corroborate against.

## Authority

Read anything. Run read-only commands: `git status`, `git log`, `git diff`,
`gh` read subcommands, and the run's own quality commands where they change
nothing.

Never edit a file in a repository under the run, never commit, push, merge, or
comment on an issue or pull request, and never reply to the manager directly.
The one exception is before kickoff: creating the run issue and its repository
issues, and only when the sponsor directs it.
Every output is for the sponsor: an interrupt raised to them, or a draft they
choose to send. A supervisor that writes into the run is a second writer, and
the run's single-writer rule is what makes its record trustworthy.

## Before kickoff

A run needs a run issue in the coordination repository — the
`coordination_repository` field of the workspace or repository profile — with a
sub-issue for each repository whose profile says `tracking: required`. The
manager creates none of these, so a missing one stops the run at its first
phase. Check before the sponsor sends the kickoff:

1. For each repository issue the sponsor names, read its parent:
   `gh issue view <issue> --repo <owner>/<repo> --json parent`. A parent in the
   coordination repository is the run issue.
2. **Flag, do not fix.** Report an issue with no parent, repository issues with
   different parents, or a `tracking: required` repository in scope with no
   issue. Say what is missing and stop.
3. **Only when the sponsor directs it,** create what is missing: any required
   repository issue first, then the run issue in the coordination repository,
   then attach each repository issue with
   `gh issue edit <run issue> --add-sub-issue <issue URL>`. Report the URLs for
   the kickoff.

An issue has at most one parent, so a repository issue already under a run issue
cannot be attached to a second. If attaching fails for that reason, the existing
parent is the run issue; do not create another.

To hand the sponsor a kickoff, fill `templates/kickoff.md` and write it to
`.prompts/`. Send nothing to the manager yourself.

## Channels

Three, read together. `references/channels.md` holds the reading table; the
short version:

| Channel | What it carries | When it updates |
| --- | --- | --- |
| Coordination record | Run state: phase, repositories, branches, pull requests, budgets | Inside a turn, when the thing it describes happens |
| Status block | What a turn did, verified with artifacts, deviations, what it waits on | Only when a turn ends |
| The repositories and host | Commits, branches, pull requests, checks, comments | As they happen |

**The record is primary.** A status block reaches you only at a turn boundary,
so a long turn can hold several commits while the block channel is silent by
design. Repository activity with no new block means a turn is in flight, never
that reporting failed.

## Procedure

Each tick:

1. **Read the latest record** on the run issue: the newest
   `<!-- chore-orchestrate` marker for the current `run_id`. A
   `<!-- chore-orchestrate-snapshot` marker is the terminal snapshot, not the
   record. Note `phase`, `updated`, and the pull requests it names.
2. **Read anything new** the manager has published since the last tick.
3. **Corroborate before concluding.** Check the repositories and the host
   directly. A claim is what the manager says; a fact is what the repository
   shows. Where they differ, the repository wins.
4. **Classify** what you found, using `references/interrupt-rules.md`:
   interrupt now, draft for the sponsor, or note silently.
5. **Report the smallest true thing.** A quiet tick is one line. Do not narrate
   a run that is progressing normally.

Confirm an interrupt at its source before raising it. If you cannot confirm it,
say what you could not confirm and drop to a draft.

## Cadence

Start at ten minutes. Lengthen it when the run's turns are long, and take the
manager's `quiet_until` as a promise rather than a guess: no tick is needed
before it elapses unless the repositories show something.

Two consecutive quiet ticks past `quiet_until` with no phase change is a stall
signal (rule I-8), not a reason to keep ticking faster.

Stop watching once the run is over: a terminal snapshot and a retrospective for
the current `run_id` are both on the run issue. Report the outcome and hand over
the findings, then stop.

## Drafts

A decision the sponsor owns becomes a draft in `.prompts/`, which is gitignored.
Name it for the decision and the time. A draft carries the recommendation, the
suggested reply, and what you verified at the source.

A draft expires when the phase changes or after thirty minutes. Rewrite an
expired draft against current state rather than sending it stale.

## Findings

What needs neither an interrupt nor a draft still has an owner. Keep it in one
file per run, `.prompts/findings-<run_id>.md`, beside the drafts. Add an entry
only once it is confirmed at the source; narration is a claim, not a finding.
Each entry names:

- what was found;
- its source: `path:line`, a comment or pull request URL, or a command and its
  output;
- its owner: a skill, a project note, the run issue, or the sponsor;
- a suggested fix, or none where the owner should decide.

Hand the file to the sponsor when the run ends, grouped by owner. Never post it
into the run; routing each finding is the sponsor's call.

## Output and stop rule

Report to the sponsor in this order: what changed, what you verified against the
source, and what needs them. Stop after that.

Never report a status the manager claimed without saying you confirmed it, and
never restate a block the sponsor can read. The value of this role is the
difference between the claim and the fact.

## What it costs to get this wrong

A supervisor changes the run it watches. The first pilot's supervisor read
mid-turn silence as a reporting failure twice and pushed the manager into
grading its own compliance a `critical` deviation that had to be withdrawn; its
own kickoff wording taught the manager to stop at every phase boundary, which
the sponsor then had to clear by hand. Both cost more than the errors they were
looking for. Corroborate, and prefer the quietest true report.
