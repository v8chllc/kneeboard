# Status block

The block a manager emits so a supervisor reads state rather than prose. It is
the last content of a turn that ends, and it never ends a turn by itself.

An orchestrator declares this contract by pointing at this file. It is stated
here once; a skill that restates it creates a second copy that drifts.

```manager-status
run_id: chore-20260915T142530Z
turn: 7
phase: implement
repos: [<repo>@<branch>]
did: <one line — what this turn actually changed or ran>
resolved: <decisions settled this turn, or none>
verified: <claim — artifact, or none>
next: <the single next action>
waiting_on: none | sponsor: <question>
quiet_until: <duration or timestamp, or none>
budget: review_invocations <n>/2 · corrections <n>
profile_inherited: [<fields taken from the workspace profile>]
profile_defaults: [<fields neither profile stated>]
deviations: none | <severity>: <departure from plan or skill rules>
risks: <anything the sponsor would want flagged, or none>
```

## Rules for the manager

- One block per turn, always last, on an idle or blocked turn too. Long turns
  are fine: the block reports everything the turn did.
- **Writing a block never ends a turn.** Only a sponsor question or a terminal
  signal does. A manager that treats each phase's block as a stopping point
  makes the sponsor type "Continue" between phases.
- `did` states what happened, not what was intended. A turn that changed
  nothing says so.
- `verified` holds only claims with an artifact: a path, a command plus
  inspected output, a commit SHA, or a URL. A claim without one belongs in
  `next`.
- `deviations` is never silently empty. Each departure is named in the turn it
  happens, with a severity, one per line.

| Severity | Meaning | Supervisor disposition |
| --- | --- | --- |
| `minor` | Reversible and inside the plan's intent: a different file layout, an extra test, a command run in a different order | Note silently |
| `material` | Changes what the run delivers or how it is proved: a plan decision revised, a criterion approached differently, a check substituted | Draft for the sponsor |
| `critical` | Crosses a rule the sponsor set: unapproved scope taken, a budget exceeded, authority widened, evidence weakened | Interrupt now |

The manager assigns the severity. The supervisor re-reads the deviation at its
source and may raise it, never lower it. A deviation the manager omits and the
supervisor finds is `critical` by default, because the omission is the problem.

Conformance to a stated rule is not a deviation. The first pilot graded keeping
the branch name its profile prescribed as a `minor` deviation, having inferred a
stricter convention no document stated.

## Rules for the supervisor

- Read the block as a claim, never as a fact. Everything in `verified` has an
  artifact by contract; check one when it carries a decision.
- A `critical` the supervisor itself prompted is not evidence of a breach. Say
  so plainly rather than letting it stand in the record.
