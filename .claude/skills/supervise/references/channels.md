# Channels

Three sources carry a run, they update at different moments, and reading one
alone produces false conclusions.

## What each carries

**The coordination record** — the latest marker comment on the run issue for the
current `run_id`, holding phase, per-repository issue, baseline, branch, profile
sources, pull requests, plan link, budgets, and deferred scope. The manager
appends a complete marker inside a turn, at every phase change and whenever a
pull request opens, so it is the only channel that moves between turn
boundaries. It is the primary channel, and the one a resuming manager reads.
Earlier markers are history: read them to see when a phase changed, never for
current state.

**The status block** — the last content of a turn that ends. Rich, but delivered
on the manager's turn boundaries, not the supervisor's schedule. Where the
manager's session captures turns to a local store the supervisor can read, the
block arrives there; otherwise the sponsor relays it.

**The repositories and the host** — commits, branches, pull requests, checks,
comments. This is fact rather than claim, and it is what every corroboration
resolves to.

## Reading them together

| Blocks | Repository | Record | Reading |
| --- | --- | --- | --- |
| nothing new | unchanged | current | Quiet. One line, stop. |
| nothing new | new commits | current for the phase | A turn is in flight. Wait. |
| nothing new | new commits | stale by a phase | The record rule was skipped. Raise once, not an interrupt. |
| new block, no state | any | any | A turn ended reporting nothing. A real lapse. |
| new block | contradicts the block | any | Corroboration failed. Interrupt, rule I-5. |
| nothing new | unchanged | unchanged, past `quiet_until` | Possible stall. Second consecutive tick makes it rule I-8. |

**Never read repository activity without a new block as a reporting failure.**
That is a turn in progress. The first pilot's supervisor called it a contract
violation twice, and the manager accepted the second one into its own record as
a `critical` deviation that later had to be withdrawn.

## What a supervisor cannot see

Whether the manager is thinking or has stopped. Neither the record nor the
repositories distinguish a long turn from a dead session, and a supervisor that
guesses will be wrong in both directions. Report the observable — "no activity
since 03:35, past its quiet window" — and let the sponsor look at the session.

Anything inside a turn that produced no artifact: reasoning, a discarded
approach, a tool call that changed nothing. A run's thinking is not a channel.
