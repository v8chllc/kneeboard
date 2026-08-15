# Build execution strategy

Status: **Approved 2026-08-12; manager supervision approved 2026-08-13.** This
document describes how an agent or agent team should implement the Kneeboard
MVP. It is not permission to deploy infrastructure or perform production
operations; those remain separately authorized. The approved orchestration
choices are recorded under
[Approved execution choices](#approved-execution-choices).

## Objective

Produce a locally verified MVP release candidate while preserving the product,
domain, privacy, and architecture decisions already recorded in this repository.
The build process should make steady autonomous progress without allowing an
agent loop to invent product behavior, conceal unresolved decisions, or treat a
passing build as proof that the application is ready for production.

The execution source of truth remains [the project task list](task-list.md).
This document governs how that list is executed; it does not duplicate its
feature requirements or completion state.

## Agent surface

This document is deliberately surface-neutral. It names required capabilities
and boundaries rather than a specific assistant, product, or vendor surface,
because surfaces change faster than the requirements they serve. The kickoff
prompt names the surface actually hosting a given goal.

A surface is suitable when it can:

- delegate bounded read-only investigation and receive a short evidence-based
  summary rather than raw output;
- give a supervising manager a durable, addressable communication channel to
  one persistent primary build agent when manager-supervised execution is used;
- preserve the build agent's separate context across routine checkpoint
  approvals and follow-up instructions;
- isolate concurrent write work in separate checkouts and branches;
- run the canonical local quality commands established in task-list section 4;
- record durable progress in the repository rather than only in model context;
  and
- support an independent review pass over a combined diff.

An ordinary independent chat or terminal session does not satisfy the manager
communication requirement merely because it shares a checkout. Where a surface
lacks a required capability, the corresponding practice below is performed
manually by the user rather than skipped.

## Recommended method

Use one primary build agent running a structured sequence of bounded goals. The
user may supervise that agent directly or may authorize a read-only manager
agent to supervise routine checkpoints within the authority defined below.
Within each goal, use the useful properties of a Ralph-style loop:

- one coherent unit of work at a time;
- durable progress recorded outside the model context;
- fresh investigation of the current repository state;
- automated checks as backpressure; and
- iteration until the bounded unit is genuinely complete.

Do not begin with an unbounded `while true` loop around the entire MVP. A pure
Ralph loop favors eventual self-correction, while Kneeboard has tightly ordered
dependencies, safety language, sensitive-data boundaries, and domain invariants
that should fail closed at the first conflict. A single enormous agent turn has
the opposite weakness: it preserves continuity but accumulates noisy context
and delays integration feedback. The structured method keeps one accountable
integrator while resetting scope at deliberate checkpoints.

## Sources of authority

At the start of every implementation goal, the primary build agent follows the
read order in [`AGENTS.md`](../AGENTS.md). A manager independently reads enough
of the same authority to evaluate bounds, evidence, and stop conditions. The
decision documents govern behavior. The task list governs execution order. This
strategy governs orchestration. Working memory and journals provide context
only and never override those sources.

An agent must stop and surface a conflict when code, an upstream dependency, or
a proposed implementation disagrees with a governing decision. It must not
quietly update the decision to match its code.

## Execution units

The default unit is one numbered implementation section of the task list, but a
section may be divided into smaller coherent slices when its changes cannot be
reviewed safely as one unit. A slice must leave the repository locally runnable
and must have observable completion evidence.

The build proceeds in dependency order:

1. Local development foundation and CI parity.
2. Framework-independent domain types, parsing, transitions, and tests.
3. Local and production-shaped persistence with migrations.
4. Authentication, email delivery adapters, and account isolation.
5. The authenticated OFP-to-tracker vertical slice.
6. Responsive and accessibility completion, manual E2E coverage, and local
   release-candidate validation.
7. A separate, supervised production-launch goal.

The primary build goal ends at a locally verified release candidate. Vercel,
Neon, Resend, DNS, production secrets, and production migrations require
explicit authority and belong to the supervised launch goal even though their
preparation and validation procedures are part of MVP readiness.

## Supervision roles and modes

The user is the human sponsor. The sponsor may supervise the primary build
agent directly or delegate routine checkpoint supervision to one manager agent
for a stated section or smaller execution unit. That delegation does not
transfer product authority or expand the actions already authorized by this
document.

Direct supervision remains valid: the primary build agent reports checkpoints
to the user and waits for direction. Under manager supervision:

- the manager starts or resumes one persistent, separate-context primary build
  agent and retains its address or agent identity for the execution unit;
- the manager remains read-only with respect to tracked repository files and
  the section branch, enforced by surface permissions where available and by
  its execution contract everywhere;
- the primary build agent remains the sole writer and integration owner;
- the manager evaluates bounds, validation evidence, diffs, and stop conditions
  before authorizing routine continuation; and
- the manager reports to the user whenever a decision exceeds its delegated
  authority.

Manager-to-builder delegation is supervision, not parallel writing. If the
communication channel or persistent build-agent context is lost, the manager
stops and reports the failure. It must not silently substitute a new writer or
infer completion from the working tree alone.

### Manager authority

Within an approved execution unit, the manager may:

- approve a proposed slice bound only when the outcome, files or modules,
  constraints, tests, and non-goals are explicit and follow dependency order;
- authorize implementation, in-scope repairs, applicable validation, the
  agreed slice commit, and the next bounded slice;
- request missing evidence or reject a checkpoint that does not support its
  completion claims;
- authorize a section-branch push or draft pull request only when the user's
  kickoff authorization explicitly includes that external write; and
- coordinate CodeRabbit triage and in-scope repairs without weakening the
  independent review gate.

The manager must escalate to the user, rather than decide, when:

- any condition in [Stop and approval boundaries](#stop-and-approval-boundaries)
  is met;
- exceptional parallel writing is proposed;
- accepting a review finding as-is would change a governing decision or weaken
  a boundary;
- the section boundary, capped-loop slice ceiling, or other user-set authority
  limit is reached and the next action was not explicitly preauthorized;
- a merge, push to `main`, deployment, production operation, credential use,
  provider configuration, or external message is proposed; or
- graduation from interactive execution to capped-loop eligibility is proposed.

### Routine checkpoint decision

The primary build agent's checkpoint report contains:

- the slice and bound actually implemented;
- files changed and the resulting commit, if any;
- focused checks, canonical gates, and relevant runtime verification;
- its combined-diff review;
- task-list or decision-document changes and their evidence;
- deviations, unverified claims, risks, and stop conditions; and
- the proposed next slice or exact next action.

The manager authorizes routine slice continuation only when the work remained
inside the approved bound, the expected evidence exists, every currently
applicable gate passed, checked tasks are supported, no governing conflict or
open decision appeared, no stop condition applies, and the next slice follows
dependency order. At a section or other authority boundary it follows only an
explicit kickoff preauthorization; otherwise it escalates to the user.

## Primary build-agent responsibilities

The primary build agent is the only integration owner. It:

- reads the governing context and inspects the current implementation;
- selects the next incomplete task-list slice in dependency order;
- identifies decisions or upstream facts that must be resolved first;
- assigns bounded subagent work with explicit ownership;
- integrates changes and resolves cross-layer contracts;
- runs or delegates validation without delegating the final judgment;
- reviews the combined diff against the governing documents;
- records completion evidence and updates checked tasks only after verification;
  and
- stops at the approval boundaries in this document.

The primary build agent should not use its main context for large raw searches,
test logs, or repetitive inspection when a bounded read-only subagent can
return a short evidence-based summary.

## Delegation and parallelism

Parallel delegation is preferred for independent, read-heavy work such as:

- locating code paths and established patterns;
- checking current upstream documentation;
- analyzing fixture or test coverage;
- running independent correctness, architecture, accessibility, privacy, or
  security reviews; and
- diagnosing separate test failures.

Parallel write-heavy work is exceptional. Every writing agent must receive an
exclusive file or module boundary, be told that other work may be occurring,
and avoid reverting unrelated changes. Two agents must not edit the same
checkout or shared contract concurrently. When write streams are genuinely
independent, use separate Git worktrees and branches, then integrate them through
the primary build agent.

The primary build agent waits for all requested review or exploration results
and synthesizes them before choosing the next action. Subagent output is
evidence, not an independent source of product authority.

The approved concurrency limits are recorded under
[Delegation and parallel-write limits](#3-delegation-and-parallel-write-limits).

## Slice lifecycle

Each slice follows the same gated lifecycle:

1. **Orient** — read required guidance, inspect the working tree, and confirm
   the task is still incomplete.
2. **Bound** — state the intended outcome, files or modules in scope,
   constraints, tests, and explicit non-goals.
3. **Research** — verify version-sensitive framework or provider behavior from
   primary upstream documentation.
4. **Implement** — make the smallest complete change that satisfies the slice.
5. **Validate narrowly** — run focused tests and checks while iterating.
6. **Validate broadly** — run every currently applicable canonical quality
   command and exercise the relevant local runtime path.
7. **Review independently** — inspect the combined diff for correctness,
   architecture, privacy, security, accessibility, and missing tests.
8. **Repair and repeat** — address accepted findings and rerun affected gates.
9. **Record evidence** — update the task-list checkbox or implementation
   decision only when the evidence exists.
10. **Checkpoint** — prepare the agreed commit or pull-request boundary and
    report what was and was not verified.

A failing check is normal backpressure, not permission to weaken the check or
change a requirement. A flaky or environment-blocked check must be diagnosed
and reported accurately.

### Stop conditions by lifecycle step

The lifecycle above and
[Stop and approval boundaries](#stop-and-approval-boundaries) are separate flat
lists. This mapping says where each condition surfaces, so the check is
performed at a defined moment rather than re-derived by each agent. It matters
most in a capped loop, where nobody is present to notice a condition the agent
did not think to look for.

| Step | Conditions that surface here |
| --- | --- |
| 1. Orient | Unexpected user changes overlap the planned edit and cannot be preserved. A governing document already conflicts with what is in the working tree. |
| 2. Bound | An open choice would materially change product behavior or architecture. The slice cannot be bounded without crossing into a module another slice owns. |
| 3. Research | Upstream behavior contradicts a governing decision. The section needs a runtime dependency the task list does not anticipate. Verification would require credentials or provider configuration. |
| 4. Implement | The change requires editing outside the scope stated at step 2. The only available implementation weakens a safety, privacy, authorization, or test boundary. A production operation is required. |
| 5. Validate narrowly | A required result cannot be verified. Passing the test would require contacting live SimBrief, Resend, or production infrastructure. |
| 6. Validate broadly | A gate is environment-blocked or flaky and cannot be diagnosed. Verification needs production data or infrastructure. |
| 7. Review independently | Review surfaces a governing-document conflict, or a finding whose remedy is an architecture change rather than a repair. |
| 8. Repair and repeat | Three consecutive repair iterations fail the same gate. The only available fix weakens a gate or boundary, or pushes edits outside the stated scope. |
| 9. Record evidence | The evidence for a checkbox does not exist. Reconciling code with a governing decision would require editing the decision. |
| 10. Checkpoint | The slice ceiling is reached. The section boundary is reached. A pull request, merge, push to `main`, or deployment is the next action. |

Two clarifications the mapping depends on.

A failing gate at step 5 or 6 is not a stop condition. It returns to step 8,
which repairs and re-runs. Only the three-consecutive-same-gate rule converts
repeated failure into a stop, and without that rule a loop would grind
indefinitely against one gate.

Scope creep is checked twice, at step 4 and again at step 8, and is the
condition most likely to fire in practice. Both checks measure against the
scope stated at step 2, so a vague Bound statement disables them silently. A
Bound statement that cannot name its files, tests, and non-goals is itself
reason to stop.

## Progress state and context control

Do not create a second feature backlog or copy the repository tree into another
planning artifact. The task list is the durable progress ledger. Governing
documents are updated only when a real decision changes or a just-in-time open
choice is resolved.

Use one chat or goal per coherent execution unit. Keep related repair work in
that context; start a fresh goal at a section boundary. A later goal must inspect
the code and task list rather than assuming a prior agent completed everything
it claimed.

Operational lessons that should affect future runs may be added concisely to
`AGENTS.md`. Status narration, test output, and implementation diaries do not
belong there.

## Quality gates

The exact commands are established in task-list section 4 and then remain the
canonical local and CI commands. As they become available, a slice cannot be
complete until all applicable gates pass:

- formatting or diff hygiene;
- lint;
- TypeScript type checking;
- focused and complete Vitest suites;
- production build;
- empty-database migration and relevant database integration tests;
- privacy and account-isolation tests;
- locally triggered Playwright journeys using sanitized fixtures, Mailpit, and
  an isolated test database; and
- a completed CodeRabbit review on the section pull request, with every finding
  triaged and all accepted findings resolved.

Tests must never call live SimBrief, Resend, or production infrastructure.
Passing tests do not replace manual verification of the simulation-only warning,
responsive layout, keyboard interaction, focus visibility, or cascade copy.

## Stop and approval boundaries

[Stop conditions by lifecycle step](#stop-conditions-by-lifecycle-step) records
where each of these surfaces during a slice.

The primary build agent stops and reports to its supervisor when:

- a governing document conflicts with implementation reality;
- an open choice would materially change product behavior or architecture;
- unexpected user changes overlap the planned edit and cannot be preserved;
- credentials, DNS, provider configuration, external messages, production data,
  deployment, or production migrations are required;
- the only available action would weaken a safety, privacy, authorization, or
  test boundary;
- a required result cannot be verified; or
- the approved slice or iteration limit has been reached.

When the supervisor is a manager, it applies the authority rules above and
escalates these conditions to the user. Autonomy does not broaden authority. In
particular, no build loop or manager may push to `main`, merge a pull request,
deploy, change DNS, send production email, or run a production migration unless
the user explicitly authorizes that action.

## Completion definitions

### Local MVP release candidate

The build goal is complete when:

- every locally executable task through MVP readiness is implemented;
- the documented fresh-clone setup produces a runnable application;
- all canonical quality gates pass;
- committed migrations apply to an empty local database and the documented
  local reset path works;
- the manual Playwright suite passes against Mailpit and isolated test data;
- the full authenticated OFP-load and tracker workflow works with sanitized
  fixtures or mocked upstream responses;
- the simulation-only warning, account isolation, and sensitive-log exclusions
  have been verified; and
- remaining production-only operations are listed with prerequisites and
  validation steps rather than represented as complete.

### Production launch

Production is complete only after a separately authorized run configures the
providers and domain, applies migrations manually, validates the deployed flows,
and captures rollback and validation evidence. A locally complete application
is not by itself a completed launch.

## Approved execution choices

Approved 2026-08-12, closing the pre-build execution gate.

### 1. Agent surface

Unspecified by design. See [Agent surface](#agent-surface). Kickoff selects the
surface in use; this document names the capabilities it must provide.
Model and reasoning choices are selected at kickoff from current guidance and
tested against the actual workload rather than pinned here, where they would
become stale.

The surface may use direct user supervision or manager supervision. A managed
run must provide the durable manager-to-builder communication and persistent
separate-context build agent described under
[Supervision roles and modes](#supervision-roles-and-modes). Shared filesystem
access alone is insufficient.

### 2. Checkpoint cadence

One feature branch and one pull request per numbered task-list section. One
conventional commit per completed slice within that section, so the pull request
reads as an ordered sequence rather than a single opaque diff.

A section may be split across two pull requests when its diff cannot be reviewed
safely as one unit, but a pull request never spans two sections. No build goal
commits directly to `main`.

### 3. Delegation and parallel-write limits

- Read-only delegation: at most four concurrent subagents, each with a bounded
  question and an expected summary shape.
- Parallel writing: zero by default. The primary build agent is the only writer.
- Exceptional parallel writing requires all of: genuinely independent module
  boundaries, separate worktrees and branches, at most two concurrent writers,
  and explicit user approval before the work starts. Integration back to the
  section branch is always performed by the primary build agent.

### 4. Mandatory independent review

CodeRabbit is the independent review gate. Every section pull request must carry
a completed CodeRabbit review before it is eligible to merge. Every finding is
triaged: accepted findings are fixed and the affected quality gates re-run, and
a finding accepted as-is requires a recorded reason in the pull request. An
unreviewed or partially triaged pull request is not mergeable regardless of
whether the local gates pass.

CodeRabbit reviews an open pull request, so the sequence at a section boundary
is: local gates pass, the pull request opens, CodeRabbit reviews, findings are
triaged and fixed, affected gates re-run, then merge. The gate is section-level
either way, so an unattended loop reaches independent review at the same point
it always would — the section boundary.

The mechanism in this workspace is the `coderabbit-review` skill to run the
review and post its findings as a durable audit comment on the pull request,
and the `coderabbit-fix` skill to apply accepted findings and post a
fixes-applied comment. Both require an open pull request and a clean worktree.
The requirement is the reviewed and triaged pull request; the tooling that
produces it may change.

This gate is distinct from step 7 of the [slice lifecycle](#slice-lifecycle),
where the agent inspects its own combined diff. Step 7 catches mechanical
problems early but shares the blind spots of whatever produced the code, which
is the reason an independent gate exists at all. Step 7 is not optional and does
not substitute for the section-level gate; the reverse is equally true.

Additional review inside a section is at the primary build agent's or manager's
discretion.

No review runs on CodeRabbit's default profile. `.coderabbit.yaml` is committed
at the root and is read from the feature branch under review rather than from
`main`, so it governs every pull request including the one that introduced it.
It is tuned further in task-list section 4, once the application stack it
describes actually exists.

### 5. Loop policy

Sections 4 and 5 run as interactive bounded goals only, with the user or a
user-authorized manager supervising each checkpoint. A manager-supervised goal
is interactive because the primary build agent stops for an independent
checkpoint decision; it is not a capped or unattended loop. These two sections
establish the canonical quality commands and the domain invariants, so an
unattended error there is the most expensive kind.

From section 6 onward, a deliberately capped loop is permitted once sections 4
and 5 have both completed without an unreported gate failure and without a
divergence from the governing documents found late. A permitted loop must:

- carry a slice ceiling: a fixed maximum number of slices it may complete before
  it stops and reports regardless of success, set in the goal that authorizes
  the loop. This bounds how far the loop can travel unattended and is distinct
  from the repair cap in
  [Status-checkpoint limits](#6-status-checkpoint-limits), which bounds attempts
  within one slice;
- stop hard at the section boundary;
- honor every condition in [Stop and approval boundaries](#stop-and-approval-boundaries),
  checked at the lifecycle steps given in
  [Stop conditions by lifecycle step](#stop-conditions-by-lifecycle-step); and
- never open a pull request, merge, push to `main`, or perform a production
  operation.

If a capped loop produces a slice that fails section-level review, the build
returns to interactive bounded goals for the remainder of that section.

The slice ceiling is three slices: a loop completes at most three before it
stops and reports, whether or not they succeeded. Graduation from interactive
to loop-eligible is the user's call, made at the section 5 pull request. A loop
may push its own branch; it may not open a pull request, merge, deploy, or
perform a production operation.

### 6. Status-checkpoint limits

The primary build agent stops and reports status to its supervisor, rather than
continuing autonomously, when any of these is true:

- three consecutive repair iterations fail the same quality gate;
- a slice requires editing files or modules outside the scope it stated when it
  was bounded;
- a section requires a new runtime dependency that the task list does not
  anticipate; or
- any condition in [Stop and approval boundaries](#stop-and-approval-boundaries)
  is met.

A status checkpoint reports what is verified, what is not, and the exact next
action. It is not a request to weaken the gate that triggered it.

### 7. Section pull-request evidence

A section pull request is eligible to merge only when its description records:

- a slice-by-slice summary of what changed;
- the exact canonical quality commands run and their results;
- confirmation that CodeRabbit reviewed the final state of the branch, and the
  disposition of every finding it raised, including a reason for each accepted
  as-is;
- the task-list checkboxes changed, with the evidence supporting each;
- any governing-document change and the decision that motivated it;
- what was deliberately not verified, and why; and
- remaining risks and follow-up work, including anything deferred to the
  supervised production-launch goal.

## Kickoff prompts

These prompts are compact because the durable requirements already live in the
repository. Directly supervised work uses only the primary build-agent prompt.
Manager-supervised work starts with the manager prompt, which gives the primary
build-agent prompt to one persistent worker through the surface's supported
communication channel.

### Manager kickoff prompt

```text
Role: supervise the approved Kneeboard execution unit as its read-only manager.
Do not edit tracked repository files, integrate changes, or act as a second
writer. Start or resume one persistent, separate-context primary build agent;
retain its address for the entire execution unit; and make it the sole writer
and integrator.

Authority: follow AGENTS.md, the decision documents it names,
docs/task-list.md for execution order, and docs/build-execution-strategy.md for
orchestration. Your delegated authority covers routine bounded-slice decisions
only. It does not let you resolve product or architecture choices, weaken a
boundary, authorize parallel writing, merge or push to main, perform production
operations, use credentials, configure providers, or communicate externally.

Supervision: require the build agent to bound and report each slice using the
documented checkpoint fields. Independently inspect enough repository state,
diff, and evidence to evaluate the report. Authorize continuation only when the
work stayed in scope, every applicable gate passed, completion claims have
evidence, no governing conflict or open decision appeared, no stop condition
applies, and the proposed next slice follows dependency order. Otherwise request
an in-scope correction or escalate to the user.

Continuity: communicate approval and follow-up work to the same build agent. If
its context or communication channel is lost, stop and report; do not silently
replace it or infer completion from the checkout. Stop at every authority limit
and report what is verified, what is not, the reason for stopping, and the exact
next action requiring user direction.
```

### Primary build-agent kickoff prompt

```text
Goal: build the locally verified Kneeboard MVP release candidate. Stop at the
local release candidate defined in docs/build-execution-strategy.md. Production
operations are a separately authorized goal and are out of scope.

Authority, in this order: AGENTS.md; the decision documents it names; the task
list in docs/task-list.md for execution order; docs/build-execution-strategy.md
for orchestration. Working memory and journals are context only and never
override those sources. If code, an upstream dependency, or your intended
implementation disagrees with a governing decision, stop and surface the
conflict. Do not edit a decision to match your code.

Starting point: confirm the pre-build execution gate in docs/task-list.md is
closed and the working tree is clean and current. Inspect the task list and
current section branch to identify the next incomplete slice rather than
assuming a prior completion report is accurate.

Execution contract: work one bounded task-list slice at a time. Remain the only
integrator and the only writer. Before each slice, state its intended outcome,
files in scope, tests, and non-goals. Delegate only bounded read-only
investigation, at most four at a time, and treat what comes back as evidence
rather than authority. Parallel writing requires explicit approval first.

Verification: run focused checks while iterating, then every applicable
canonical quality gate, then inspect your own combined diff before opening the
section pull request. CodeRabbit reviews the open pull request and its findings
must be triaged, fixed where accepted, and the affected gates re-run before
merge. Update a task-list checkbox only when the evidence for it exists.

Boundaries: preserve the MVP exclusions in docs/planning-status.md and do not
build deferred features or infrastructure early. Automated tests never contact
live SimBrief, Resend, or production infrastructure. Never push to main, merge a
pull request, deploy, change DNS, send production email, or run a production
migration. Stop and report to your supervisor when a governing document
conflicts with reality, when an open choice would change product behavior or
architecture, when the only available action would weaken a safety, privacy,
authorization, or test boundary, or when a required result cannot be verified.

Reporting: at each checkpoint report the slice and bound actually implemented,
files changed and commit, focused checks, canonical gates, runtime verification,
combined-diff review, task-list changes and evidence, deviations or unverified
claims, risks and stop conditions, and the exact proposed next task. Wait for
direction from the user or manager supervising the goal. Do not describe a
passing build as production readiness.
```

## Surface profiles

These profiles explain how current surfaces can satisfy the contract. They are
non-authoritative adapters, not additional requirements; current vendor
documentation must be checked at kickoff because product mechanics can change.

### Codex CLI

- Run the manager in the main thread and the primary build agent as one
  persistent subagent with a separate context.
- Let the main thread collect checkpoint results and send follow-up direction
  to that same agent. Use the CLI's agent inspection controls when human
  inspection is needed.
- The persistent primary build agent may spawn its own bounded read-only
  investigator subagents. Those investigators report to the primary build
  agent, which synthesizes their evidence before reporting to the manager; they
  do not become additional writers or independent integration owners.
- Apply the read-only delegation ceiling subject to the session's shared agent
  capacity. Count the manager, primary build agent, and investigators together;
  do not assume all four policy-permitted investigators can run concurrently.
- Do not use unrelated top-level sessions as manager and builder unless an
  explicit durable communication mechanism connects them.

### Claude Code subagents

This profile applies when Agent Teams is unavailable, which has been the common
case in practice.

- Run the manager in the main session and the primary build agent as one spawned
  subagent with a separate context.
- Record the subagent's agent identity at spawn and address every later
  instruction to it, so it resumes with its context intact. Spawning again
  rather than messaging the existing agent starts a new context and silently
  replaces the writer, which is the failure this profile most needs to prevent.
- The manager is read-only by execution contract rather than by surface
  permission, because the main session is not restricted. It may inspect files,
  diffs, and history and may spawn bounded read-only investigators for its own
  evaluation; it may not edit files or run a mutating Git command.
- Verify at kickoff whether the build subagent can itself delegate bounded
  read-only investigation. Where it cannot, that ceiling is reported as a
  tooling limitation; the manager does not write on the builder's behalf or
  raise its own concurrency to compensate.
- Losing the subagent's address ends the execution unit. The working tree
  containing the expected files is not evidence that a slice completed as
  bounded.

### Claude Code Agent Teams

- Run the manager as team lead and create exactly one writing teammate as the
  persistent primary build agent.
- Use the team mailbox and direct teammate messaging for checkpoint reports and
  follow-up direction. The shared task list may reflect coordination state, but
  it never replaces `docs/task-list.md` as the progress ledger.
- Keep the lead read-only and the teammate the sole writer. Because Agent Teams
  is experimental, verify current availability, permission behavior, resumption,
  and cleanup limitations before kickoff. When it is unavailable, use the
  [Claude Code subagents](#claude-code-subagents) profile instead.

## References

These vendor guides informed the draft. They describe one surface's
implementation of the practices above; the requirements in this document are
surface-neutral and do not depend on them.

- [OpenAI: Best practices for working with Codex](https://learn.chatgpt.com/guides/best-practices)
- [OpenAI: Long-running work](https://learn.chatgpt.com/docs/long-running-work)
- [OpenAI: Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [OpenAI: Git worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees)
- [Anthropic: Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams)
- [Anthropic: Claude Code subagents](https://code.claude.com/docs/en/sub-agents)
- [Ralph Wiggum technique guide](https://github.com/ghuntley/how-to-ralph-wiggum)
