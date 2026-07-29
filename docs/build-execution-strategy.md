# Build execution strategy

Status: **Draft for pre-build review.** This document describes how an agent or
agent team should implement the Kneeboard MVP. It is not permission to begin the
build, deploy infrastructure, or perform production operations. The unchecked
choices in the pre-build gate of [the task list](task-list.md) must be approved
first.

## Objective

Produce a locally verified MVP release candidate while preserving the product,
domain, privacy, and architecture decisions already recorded in this repository.
The build process should make steady autonomous progress without allowing an
agent loop to invent product behavior, conceal unresolved decisions, or treat a
passing build as proof that the application is ready for production.

The execution source of truth remains [the project task list](task-list.md).
This document governs how that list is executed; it does not duplicate its
feature requirements or completion state.

## Recommended method

Use one primary integration agent running a structured sequence of bounded
goals. Within each goal, use the useful properties of a Ralph-style loop:

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

At the start of every implementation goal, the primary agent follows the read
order in [`AGENTS.md`](../AGENTS.md). The decision documents govern behavior.
The task list governs execution order. This strategy governs orchestration.
Working memory and journals provide context only and never override those
sources.

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

## Primary-agent responsibilities

The primary agent is the only integration owner. It:

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

The primary agent should not use its main context for large raw searches, test
logs, or repetitive inspection when a bounded read-only subagent can return a
short evidence-based summary.

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
the primary agent.

The main agent waits for all requested review or exploration results and
synthesizes them before choosing the next action. Subagent output is evidence,
not an independent source of product authority.

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
- independent review with all accepted material findings resolved.

Tests must never call live SimBrief, Resend, or production infrastructure.
Passing tests do not replace manual verification of the simulation-only warning,
responsive layout, keyboard interaction, focus visibility, or cascade copy.

## Stop and approval boundaries

The primary agent stops and requests direction when:

- a governing document conflicts with implementation reality;
- an open choice would materially change product behavior or architecture;
- unexpected user changes overlap the planned edit and cannot be preserved;
- credentials, DNS, provider configuration, external messages, production data,
  deployment, or production migrations are required;
- the only available action would weaken a safety, privacy, authorization, or
  test boundary;
- a required result cannot be verified; or
- the approved slice or iteration limit has been reached.

Autonomy does not broaden authority. In particular, no build loop may push to
`main`, merge a pull request, deploy, change DNS, send production email, or run a
production migration unless the user explicitly authorizes that action.

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

## Draft kickoff-prompt structure

The final kickoff prompt should be compact because durable requirements already
live in the repository. It should contain:

1. **Goal** — build the locally verified Kneeboard MVP release candidate.
2. **Authority** — follow `AGENTS.md`, the decision documents, the task list,
   and this execution strategy in that order of responsibility.
3. **Starting point** — begin only after confirming the pre-build gate is
   complete and the working branch is clean and current.
4. **Execution contract** — work one bounded task-list slice at a time, retain
   one primary integrator, and delegate only clearly owned independent work.
5. **Verification** — run focused checks, full applicable gates, and independent
   review before recording completion.
6. **Boundaries** — preserve MVP exclusions and stop on conflicts, sensitive
   external actions, production operations, or missing authority.
7. **Reporting** — report completed slices, evidence, unresolved risks, and the
   exact next task without overstating verification.

The final prompt should name capabilities and completion criteria rather than
pinning a model name that may become stale. Model and reasoning choices should
be selected at kickoff from current official guidance and tested against the
actual workload.

## Choices to approve before kickoff

The strategy is not final until these questions are reviewed with the user:

1. Which Codex surface will host the primary long-running goals: desktop app,
   CLI, IDE extension, or hosted work?
2. What is the default checkpoint: one commit per coherent slice, one pull
   request per task-list section, or another reviewed cadence?
3. What maximum delegation and parallel-write limit should the primary agent
   observe?
4. At which checkpoints is an independent multi-agent consensus review
   mandatory?
5. Should the first build use interactive bounded goals only, or add a
   deliberately capped loop script after the manual workflow proves reliable?
6. What iteration, elapsed-time, or cost limit should cause a status checkpoint
   rather than continued autonomous work?
7. What exact evidence must be attached to a section-level pull request before
   it is eligible to merge?

## References

- [OpenAI: Best practices for working with Codex](https://learn.chatgpt.com/guides/best-practices)
- [OpenAI: Long-running work](https://learn.chatgpt.com/docs/long-running-work)
- [OpenAI: Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [OpenAI: Git worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees)
- [Ralph Wiggum technique guide](https://github.com/ghuntley/how-to-ralph-wiggum)
