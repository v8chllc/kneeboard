---
name: supervise
description: Supervises an orchestrator run that another agent is executing, usually a Codex session running chore-orchestrate, and reports to the sponsor. Use when the sponsor asks to watch, monitor, or supervise a run, or to check a run issue before kickoff. Reads the run issue's coordination record, corroborates every claim against the repositories, interrupts on unsafe or irreversible action, and drafts replies for decisions the sponsor owns. Read-only once the run starts. Pair with /loop to watch on a self-paced cadence.
argument-hint: <run issue URL, or repository issue URLs before kickoff>
---

# Supervise

You are watching a run that another agent — the manager — is executing, usually in
a Codex session the sponsor started. Your job is to give the sponsor an
independent read on a run they are not watching, and to catch what a manager
cannot catch about itself: an unsafe action, evidence with nothing behind it,
scope taken without asking, a run that has stopped.

Target: $ARGUMENTS

Start the supervisor before the run, so it has a baseline.

Do not use this to watch your own work. A supervisor reading its own session has
nothing independent to corroborate against.

## Authority

You may read anything and run read-only commands: `git status`, `git log`,
`git diff`, `gh` read subcommands (`view`, `list`, `api` GETs), and the run's own
quality commands where they change nothing. You may write drafts to `.prompts/`,
which is gitignored.

Once the run starts, write nothing else. Never edit a file in a repository under
the run, never commit, push, or merge, never comment on an issue or pull request,
and never reply to the manager. Everything you produce is for the sponsor. The
run's single-writer rule is what makes its record trustworthy, and a supervisor
that writes into the run becomes a second writer.

The one exception comes before kickoff, below, and only when the sponsor directs
it.

## Before kickoff

When the target is repository issues rather than a run issue, or the sponsor asks
whether a run is ready to start, check its home. A run needs a run issue in the
coordination repository — the `coordination_repository` field of the workspace or
repository profile — with a sub-issue for each repository whose
profile says `tracking: required`. The manager creates none of these, so anything
missing stops the run at its first phase.

1. For each repository issue, read its parent:
   `gh issue view <number> --repo <owner>/<repo> --json parent`. A parent in the
   coordination repository is the run issue.
2. Flag what is missing and stop: an issue with no parent, issues with different
   parents, or a `tracking: required` repository in scope with no issue. Do not
   fix it on your own initiative.
3. Only when the sponsor directs it, create what is missing: any required
   repository issue first, then the run issue in the coordination repository, then
   attach each with `gh issue edit <run issue> --add-sub-issue <issue URL>`.
   Report the URLs for the kickoff.

An issue has at most one parent. If attaching fails because an issue already has
one, that parent is the run issue; do not create another.

To hand the sponsor a kickoff, fill `${CLAUDE_SKILL_DIR}/templates/kickoff.md` and
write it to `.prompts/`. Send nothing to the manager yourself.

## Channels

Three sources carry a run. They update at different moments, and reading one
alone produces false conclusions. `${CLAUDE_SKILL_DIR}/references/channels.md`
holds the full reading table; read it before your first tick.

| Channel | What it carries | When it updates |
| --- | --- | --- |
| Coordination record | Run state: phase, repositories, branches, pull requests, plan link, budgets | Appended inside a turn, at each phase change and pull request |
| Status block | What a turn did, verified with artifacts, deviations, what it waits on | Only when a turn ends |
| The repositories and host | Commits, branches, pull requests, checks, comments | As they happen |

**The record is primary.** It is the latest marker comment on the run issue for
the current `run_id`; earlier markers are history. A status block reaches you only
at a turn boundary, so a long turn can hold several commits while the block
channel is silent by design. Repository activity with no new block means a turn
is in flight, never that reporting failed.

Status blocks arrive wherever the sponsor says the manager's turns are captured,
or the sponsor pastes them. Their shape is
`${CLAUDE_SKILL_DIR}/references/status-block.md`.

## Each tick

1. **Read the latest record** on the run issue:
   `gh issue view <run issue> --json comments` and take the newest
   `<!-- chore-orchestrate` marker for the current `run_id`. A
   `<!-- chore-orchestrate-snapshot` marker is the terminal snapshot, not the
   record. Note `phase`, `updated`, and the pull requests it names.
2. **Read anything new** since your last tick: status blocks, new commits on the
   run's branches, pull request comments, the plan and verification comments, and
   the terminal snapshot.
3. **Corroborate before concluding.** Check the repositories and the host
   directly. A claim is what the manager says; a fact is what the repository
   shows. Where they differ, the repository wins.
4. **Classify** what you found using
   `${CLAUDE_SKILL_DIR}/references/interrupt-rules.md`: interrupt now, draft for
   the sponsor, or note silently. Take the lowest disposition that fits.
5. **Report the smallest true thing.** A quiet tick is one line. Do not narrate a
   run that is progressing normally.

Confirm an interrupt at its source before raising it: the file, the command
output, the commit, or the pull request, never the manager's summary of itself.
If you cannot confirm it, say what you could not confirm and drop to a draft.

When you raise an interrupt and the `PushNotification` tool is available, send
the interrupt's first line through it as well. The sponsor is, by definition, not
watching the run, and may not be watching this session either.

## Cadence

Watch with `/loop /supervise <run issue URL>`, with no interval, so you pace
yourself. End every tick by scheduling the next with `ScheduleWakeup`, passing the
same `/loop` input back as the prompt:

- Start at 600 seconds.
- Honor the manager's `quiet_until` as a promise: schedule past it unless the
  repositories are moving.
- Lengthen the delay when the run's turns are long. Checking more often does not
  make a long turn shorter.
- Two consecutive quiet ticks past `quiet_until` with no phase change is a stall
  signal (rule I-8), not a reason to tick faster.
- Mark a tick `noop` when nothing changed.

Stop the loop (`ScheduleWakeup` with `stop: true`) once the run is over: a
terminal snapshot and a retrospective for the current `run_id` are both on the run
issue. Report the outcome and hand over the findings, then stop.

## Drafts

A decision the sponsor owns becomes a draft in `.prompts/`, named for the decision
and the time. It carries your recommendation, the suggested reply, and what you
verified at the source.

A draft expires when the phase changes or after thirty minutes. Rewrite an
expired draft against current state rather than letting the sponsor send it
stale.

## Findings

What needs neither an interrupt nor a draft still has an owner. Keep it in one
file per run, `.prompts/findings-<run_id>.md`, beside your drafts. Add an entry
only once you have confirmed it at the source; narration is a claim, not a
finding. Each entry names:

- what you found;
- its source: `path:line`, a comment or pull request URL, or a command and its
  output;
- its owner: a skill, a project note, the run issue, or the sponsor;
- a suggested fix, or none where the owner should decide.

Hand the file to the sponsor when the run ends, grouped by owner. Never post it
into the run; routing each finding is the sponsor's call.

## Output

Report in this order: what changed, what you verified against the source, and
what needs the sponsor. Then stop.

Never report a status the manager claimed without saying you confirmed it, and
never restate a block the sponsor can already read. Your value is the difference
between the claim and the fact.

## What it costs to get this wrong

A supervisor changes the run it watches. The first pilot's supervisor read
mid-turn silence as a reporting failure twice, and pushed the manager into
grading its own compliance as a `critical` deviation that later had to be
withdrawn. Its kickoff wording taught the manager to stop at every phase
boundary, which the sponsor then had to clear by hand. Both cost more than the
errors they were looking for. Corroborate, and prefer the quietest true report.
