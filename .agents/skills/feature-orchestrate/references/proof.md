# Proof

Proof decides whether the reviewed change does what it must, claim by claim, with evidence a later reader can follow. It runs after review settles, against one frozen head, by agents that did not build or review the change.

## Claims and obligations

After review settles, a fresh scope agent derives the **claim universe**:

- every acceptance criterion on the run issue and the repository issue; and
- every independently falsifiable claim the reviewed diff makes, including behavior the issues never mention, constraints, failure modes, and exclusions a wrong implementation could break.

For each claim it derives the **obligation**: the check that would falsify it. It works from the issues, the repository's guidance, and the reviewed diff. It is never given the builder's reports, validation reasoning, or checkpoint evidence, because one derivation shared by the builder and the prover turns implementation reasoning into proof.

An obligation is `derived` when a falsifying check exists, or `underived` with its reason stated when none does. `underived` is a gap, never a pass, and never a licence to invent a requirement or drop the claim. An obligation revised three times goes to the sponsor instead of a fourth revision.

## Acceptance responsibility

Each claim is exactly one of:

- `current`: binding for this pull request;
- `future_integration`: a governing source assigns it to a named later work item, and this pull request's issues do not make it a criterion; the scope names that work item and the governing passage; or
- `non_binding`: context or a stated non-goal that makes no positive claim.

Proof is never deferred because it is expensive. A conflict between a current criterion and a later assignment goes to the sponsor rather than being classified either way.

## Lanes

Each `current` claim gets exactly one lane, chosen by where it can be observed:

- **Journey**: an external actor of the system can observe the claim through its supported interface after deterministic setup.
- **Verification**: no supported external interface can observe the claim, so proof audits evidence pinned to the frozen head.

The basis is **Journey** when every current claim is Journey, **Verification** when every one is Verification, and **Composite** when both occur, with the claims split so no claim is in both lanes.

Verification is invalid for a claim a Journey can observe. A surface wired up only in later work is not observable yet; a surface a supported caller can reach now is, even when it is off by default. Never choose a lane because it is cheaper or because the other is missing.

## Journey coverage

The profile's `journey` field says how Journey proof is produced. For each Journey claim the scope records one coverage decision:

- `covered_existing`: a journey already in the repository proves the claim at the frozen head;
- `build`: the run adds or changes a journey to prove it, which the builder writes before the head is frozen;
- `manual`: the claim is proved by a person performing the journey, when `journey` is `"manual: <where results are recorded>"`; or
- `blocked`: fitting Journey proof needs something outside the run's authority, or `journey` is `none`.

`blocked` is a correct answer. It surfaces an inability to prove; it never moves the claim to Verification.

## The scope artifact

The manager posts the scope agent's result, unedited, as one comment on the pull request and links it from the coordination record's `scope` field:

```markdown
### Feature scope — run <run_id>

**Reviewed head:** <sha> — **Basis:** Journey | Verification | Composite

| ID | Claim | Source | Responsibility | Lane | Coverage | Falsifying check | Obligation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C-1 | <claim> | <criterion text, or "diff: path"> | current \| future_integration \| non_binding | journey \| verification \| — | covered_existing \| build \| manual \| blocked \| — | <the check that would show it false> | derived \| underived: <reason> |

**Future integration:** <claim — named work item — governing passage, or none>
**Proposed support changes:** <what the run would add to make proof possible, or none>
```

Any commit after the scope is posted invalidates it.

## Scope checkpoint

The sponsor confirms the scope before any proof runs, on every run, whatever the profile's `autonomy`. The sponsor may correct acceptance responsibility, lanes, coverage decisions, and proposed support changes. A material correction reruns the scope with a fresh agent. Confirmation never waives required proof or moves a claim to a cheaper lane.

The scope agent's independence is what hides from it that a lane cannot be reached. That is why the checkpoint belongs to someone who knows the repository's environments.

## Proof preflight and freeze

Before proof, the manager confirms every selected lane can run:

- for `automated` Journey coverage, the `journey` command and the local services it needs;
- for `manual` Journey coverage, that the place the profile names for results can be reached, and that the sponsor has named who performs each journey at the frozen head; and
- `gh` v2.99.0 or later when evidence includes images or video.

A lane that cannot run blocks; it never reassigns its claims.

The manager then records the reviewed head SHA as `frozen_sha`. Every proof artifact cites it. Any commit after the freeze invalidates review, scope, and proof, and the run returns to review.

## Fit evidence

A check proves a claim only when its assertion has been **shown to fail for the right reason**, in one of two ways:

- **at the baseline**, failing on the assertion itself, never on a missing symbol, an import, or a setup error; or
- **with the guarded behavior removed**, which is required when the behavior already exists at the baseline, because a baseline run cannot tell a meaningful assertion from an empty one there.

Evidence is `evidence_unfit` when its assertion has one of the shapes that pass while proving nothing:

- a negative assertion satisfied by the code not running at all;
- a comparison against a mock rather than the real implementation;
- a branch conditioned on whether a fixture happens to contain the case;
- a bounded search asserting exhaustion it never reached;
- an assertion over a state the implementation cannot produce; or
- a check that something changed, or that some element matches, where the exact value is knowable.

A state a test builds directly, rather than reaching through real operations, needs a forward obligation naming the later work that reaches it for real. Without one, the evidence built on it is `evidence_unfit`.

A repository may add to these rules in its own guidance, for example by requiring the removal technique even for new behavior, or naming further shapes. It may not relax them.

## Proof agents and verdicts

A fresh proof agent owns each lane's claims and never judges the other lane's. It is given identifiers only: the run issue URL, the repository, the pull request number, the frozen SHA, and the scope comment's URL.

Every claim gets exactly one verdict:

- `proved`: fit evidence shows the claim holds at the frozen head;
- `refuted`: evidence shows it does not;
- `evidence_absent`: no evidence exists;
- `evidence_unfit`: evidence exists but cannot falsify the claim, or its failure was never shown, or was shown for the wrong reason;
- `undurable`: the only evidence expires or cannot be reached later; or
- `wrong_commit`: the evidence is not pinned to the frozen head.

A claim whose obligation is `underived` is reported as `underived`. A verdict with no locator a reader can follow is invalid. A failing aggregate names each failing member.

For a `manual` Journey claim, the proof agent runs nothing. It inspects the recorded result: it must name the frozen SHA, the steps performed, and the observed outcome. A result recorded against another head is `wrong_commit`, and a missing one is `evidence_absent`.

A proof agent may re-run a cheap, deterministic check that changes no product state; it applies any behavior removal in a scratch worktree, never on the branch. A re-run can prove or refute a claim, but a missing durable artifact stays a separate `undurable` finding.

## Where evidence lives

| Evidence | Where it lives |
| --- | --- |
| Text: test output, migration runs, commands with their inspected output | Quoted in the result comment, in collapsed sections. Long output goes in a linked comment on the same pull request. |
| CI job and run links | Corroboration only. CI logs and artifacts expire, so the decisive lines are always quoted. |
| Images and video | Attached to the result comment with `gh pr comment --attach`, which needs `gh` v2.99.0 or later and push access. |
| Larger files, or binaries that are not images or video | Not supported. A claim whose only evidence is one of these is `undurable`. |

Evidence is durable only if it stays readable for as long as the pull request exists. A locator that expires may support a claim but never be its only proof.
