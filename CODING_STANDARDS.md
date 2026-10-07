# Coding Standards

These standards govern Kneeboard implementation and tests. The architecture,
domain, privacy, and testing rules below were extracted from `AGENTS.md`;
the governing decisions remain in the sibling `project-management/kneeboard/`
documents. Consult those decisions before changing governed behavior.

Read [AGENTS.md](AGENTS.md) for the reading order, working agreement, delivery
instructions, and agent workflow profile, and [WORKFLOW_STANDARDS.md](WORKFLOW_STANDARDS.md)
for workflow procedures.

## Architecture Guardrails

- Use Next.js App Router, React, TypeScript, and Tailwind CSS.
- Prefer dependency-light custom components over a broad component framework.
- Treat external responses, persisted JSON, request payloads, and environment
  configuration as untrusted boundaries validated with Zod.
- Keep tracker rules in a framework-independent domain layer.
- Implement Save, Pass, Skip, and pre-start SID/STAR inclusion changes through
  typed commands and a pure, deterministic transition engine.
- Use a shared pure domain preview for cascading Pass confirmation; do not
  reimplement cascade selection in the UI.
- Persist complete tracker snapshots; do not introduce event sourcing or a
  visible event history.
- Use server-confirmed mutations with expected snapshot versions and
  compare-and-swap persistence. Do not implement client-side conflict merging
  for MVP.
- Keep server-side authorization checks adjacent to every account-scoped read
  and mutation.
- Keep indexed relational metadata separate from large raw OFP payloads so
  recent trackers can be queried without deserializing them.

Persistence is aggregate-shaped, not relational waypoint rows: `ofp_load` for
indexed metadata, a separate `ofp_raw` table for the complete payload, and a
`tracker` row holding the immutable navlog, the mutable snapshot, and an integer
version. Do not express slot, page, or sliding-window rules in SQL.

Keep `TrackerSnapshot` minimal: persist the facts needed to reconstruct tracker
state, and derive slots, pages, the sliding window, and the procedure lock.
Pending and queued waypoint states are stored, but recompute them from the
remaining facts on every transition without consulting their previous values.
Keep `recalculateSnapshot` idempotent. Persist the complete minimal snapshot;
do not add redundant derived state to it.

Representation and interpretation are separate concerns with a fixed seam.
Representation is the shape of the incoming payload — string-to-number
coercion, collapsed single-element arrays, empty sections — and is validated
with Zod at the integration boundary, in task-list section 8. Interpretation is
the fail-closed classification order, eligibility, origin-row synthesis, and
`RDIS` derivation; it is pure domain logic, owned by task-list section 5 and
already built. Section 5 owns the domain input type. Section 8's schema must
satisfy that type rather than restate it, and must not re-decide any question
interpretation has already settled.

## Domain Invariants

Consult `../project-management/kneeboard/tracker-behavior.md` before changing
tracker logic. In particular:

- Use only the primary origin-to-destination navlog, while displaying every
  point in original route order.
- Airports and computed or informational points remain visible but never consume
  INS slots.
- Eligible fixes use repeating slots 1-9, derived from position in the eligible
  sequence. Only Skip and the SID/STAR controls renumber; Save and Pass never do.
  The minimal snapshot depends on the ordering property under §Memory slots in
  `../project-management/kneeboard/tracker-behavior.md`: because Save takes the
  earliest pending fix, every
  skip after a save is downstream of that saved fix, while any skip before it is
  already reflected in the slot the fix was written into. That slot therefore
  cannot drift once written. Permitting a saved fix to be skipped, or a save out
  of route order, would silently produce wrong slots for waypoints already
  entered into the unit.
- Only the earliest pending fix may be saved.
- Skip is terminal, applies only to queued or pending fixes, consumes no slot,
  and triggers deterministic recalculation.
- Slot release is deferred by one Pass. The most recently passed fix is the
  active leg's FROM waypoint and keeps its slot. A slot is free only when it has
  never been written or holds a passed fix that is not the most recent one.
- Passing a saved fix atomically passes every earlier saved-but-unpassed fix,
  frees every affected slot except the one holding the newly passed fix,
  promotes queued fixes into the freed slots, and recalculates pending and
  queued state. Pass does not rebuild pages.
- Pending fixes are the next eligible unsaved fixes for which a free slot
  exists. States with no pending fix are normal, not stuck.
- The sliding window is the tracker's representation of current INS unit
  contents: the nine most recently saved fixes, always saved or passed, changing
  membership only on Save. It is distinct from pages, which are display
  grouping. There is no "active page"; that concept was replaced.
- SID and STAR inclusion controls lock permanently after the first Save.
- Excluded points between a page's slot 9 and the next page's slot 1 belong to
  the preceding page.
- Derived keypad coordinates are read-only and must handle rounding, degree
  rollover, and all hemispheres correctly.

Do not duplicate these rules independently in UI or persistence code. Call the
shared domain implementation.

## SimBrief Data and Privacy

- Fetch SimBrief only on the server after an authenticated user explicitly
  requests a load.
- Use a numeric Pilot ID stored as a string, capped at 16 digits and validated
  as `^\d{1,16}$` with leading zeros preserved. The cap is a Kneeboard input
  limit, not a SimBrief rule. Do not add username login, flight-generation
  APIs, or Navigraph OAuth.
- The authenticated Load endpoint enforces a 30-second per-account cooldown
  alongside per-action idempotency. Completed idempotency-key replays bypass
  the cooldown and return the existing tracker without contacting SimBrief.
- Claim the per-account cooldown atomically before contacting SimBrief. A
  different action during the interval receives the remaining cooldown; a
  same-key request returns the completed tracker or a retryable in-progress
  response and never starts another fetch. Failed attempts create no tracker
  but retain the short cooldown.
- Bound application-side SimBrief requests with an abort timeout and response
  size limit, and test timeout, oversize, non-success, and invalid-JSON paths
  without contacting the live service.
- Accept only JSON OFPs using the LIDO layout with a detailed navlog.
- Validate and normalize only fields required by the tracker; do not attempt to
  model the complete SimBrief payload.
- Treat raw OFPs, coordinates, Pilot IDs, email addresses, sessions, and
  magic-link tokens as sensitive. Never write them to logs.
- Raw development downloads belong under `.local/simbrief/` and must not be
  committed.
- Use `uv run scripts/fetch_simbrief_ofp.py <pilot-id>` to capture the latest
  generated OFP during development.
- The endpoint returns only the most recent OFP. Verify a generated route covers
  its scenario before fetching, and record each capture in
  `.local/simbrief/manifest.md`.
- Consult `../project-management/kneeboard/simbrief-navlog-findings.md` before writing parsing or
  classification code. It records observed payload structure, the evidence
  behind each classification rule, and the gaps between the payload and
  `../project-management/kneeboard/tracker-behavior.md`.
- Treat the payload as loosely typed at the boundary. SimBrief collapses
  single-element arrays into bare objects and quotes some numeric values, so
  normalize both shapes rather than assuming consistency.
- Sanitize representative OFPs before moving them into tracked fixtures.
- Automated tests must use fixed sanitized fixtures and must never contact live
  SimBrief, Resend, or production infrastructure.

## Testing

- Prioritize tests for boundary validation, coordinate conversion, waypoint
  classification, domain transitions, cascading Pass, deferred slot release,
  sliding window movement, slot and page recalculation on Skip, zero-pending
  states, concurrency conflicts, and load idempotency.
- Confirm a new assertion fails for the right reason before trusting it, in
  one of two ways. Either it fails at the baseline on the assertion itself,
  never on a missing symbol, an import, or a setup error. Or you remove the
  behavior it guards, watch the assertion fail, then restore it. Removal is
  required when the behavior already exists at the baseline, because a
  baseline run cannot tell a meaningful assertion from an empty one there.
  Lint, type checks, and a green suite all report success on a test that
  asserts nothing, so no gate catches this. Recurring shapes that pass while
  proving nothing are a negative assertion satisfied by the code not running
  at all, a comparison against a mocked rather than the real implementation,
  a branch conditioned on whether a fixture happens to contain the case, a
  bounded search asserting exhaustion it never reached, an assertion over a
  state the implementation cannot produce, and a check that something changed
  or some element matches where the exact value is knowable, and a
  concurrency test whose writers never overlap: `Promise.all` over separate
  connections may run them in sequence, so an application check rejects the
  second write before the guarded predicate matters. Hold a row lock or
  barrier until both writers reach the write.
- When a slice must handle a state before the operation that produces it
  exists, build that state directly in its tests and record a forward
  obligation in the slice bound naming the later slice that re-reaches every
  such state through the real operation and compares the result. A directly
  built state can encode something the implementation can never produce, and
  the suite then verifies a fiction while passing.
- Where two constructors can produce the same type, prove one produces output
  identical to the other for every tracked fixture. Two normalizers that must
  agree will otherwise diverge on an edge case that no test covers, and the
  suite stays green while production fails.

## Code documentation

- Use JSDoc-style comments for TypeScript APIs and Python docstrings for modules,
  classes, and functions whose contracts need explanation.
- Document exported domain APIs and shared boundary operations. Explain purpose
  and relevant preconditions, invariants, units, ordering, error behavior, and
  side effects.
- Document operational scripts' resource ownership, destructive actions,
  environment assumptions, and cleanup behavior where applicable.
- Use implementation comments to explain nonobvious decisions and constraints.
  Avoid restating names, types, or visible control flow.
- Simple components, obvious helpers, descriptive tests, and generated code do
  not require boilerplate documentation.
- Update documentation alongside behavior changes. Review its accuracy and
  usefulness; comment presence alone does not establish correctness.
