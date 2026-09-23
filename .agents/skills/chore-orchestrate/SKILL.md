---
name: chore-orchestrate
description: Orchestrates a chore whose diff proves its own completion — tooling, documentation, CI, dependency, or refactor work — across one repository or one synchronized pair, from readiness through an open, merge-ready pull request.
---

# Chore Orchestrate

## Goal

Deliver one chore end to end: confirm the run issue is ready, plan what is expensive to reverse, implement it once, review it, verify it independently, publish the evidence, and leave an open pull request the sponsor can merge. The diff is the proof; a chore whose completion needs behavioral proof beyond the diff belongs to a different workflow.

## Success criteria

- The run issue's acceptance criteria are jointly satisfiable, and the approved plan satisfies every one of them.
- Exactly one agent writes to each repository.
- Review runs through the declared review capability, and its findings are dispositioned, not judged by this skill.
- Verification is performed by an agent given identifiers only, never the builder's account of its own work, and every disposition names its check and its evidence.
- Each repository ends with one open pull request carrying its verification comment, and the run issue carries a coordination record a fresh manager can resume from.
- The run ends with one terminal signal and one retrospective, whatever the outcome.

## Inputs

- **Required:** a run issue — an issue in the coordination repository, created by the sponsor, whose sub-issues are the repository issues the run needs. `references/run-state.md` defines it.
- **Optional:** an implementation plan, and a scope note limiting the change.
- **Resolved, not asked for:** the repository profile (`references/repository-profile.md`), the baseline commit of each repository, and the merge order for a synchronized pair.

## Prerequisites

- `git` and `gh`, authenticated.
- The review capability the profile's `review_capability` names. Under `consensus-review`, the default: the `consensus-review` skill, version 2.0.0 or later, reachable in this session. If it is absent, stop at the review phase with `DEPENDENCY_MISSING` rather than reviewing the work in this thread. Under `coderabbit`: CodeRabbit installed on each repository with automatic review off, reviewed through `references/coderabbit-review.md`. A CodeRabbit review that never arrives is a missing gate, handled there, not a missing dependency.
- Writable checkouts of the resolved repositories, each on its default branch, clean.

## Constraints and authority

Safe actions, taken without asking: reading any file, running the profile's quality commands, running non-destructive git commands, creating branches and commits, pushing a working branch, opening a pull request, commenting on the run issue or a pull request, and moving the run issue's board status. Creating, editing, or closing an issue is not among them: the sponsor creates the run issue and every repository issue, and a run that needs one stops rather than creating it.

Actions requiring the sponsor: adding a repository to the run, exceeding the review budget, taking work outside the approved plan, and any action the profile marks `checkpointed`.

**The review budget is two review invocations per repository.** Under `consensus-review` an invocation is one call of the review skill, which runs up to three review-and-fix cycles inside it; under `coderabbit` it is one pass of the loop in `references/coderabbit-review.md`, which also runs up to three reviews. Either way a repository gets up to six reviews before the sponsor is asked for a third invocation, unless its steering document caps reviews lower, which binds first. Count invocations, not cycles: the two numbers are nested, and `review_invocations: 2/2` in a status block does not contradict a review that reports three cycles of its own.

Never, whatever the profile or the repository's steering document says: merge, force-push, delete a branch you did not create in this run, deploy, run a production migration, read or write secrets, run bulk-data or scheduled-job commands, or point a local tool at shared or production data. The profile can forbid more; it can never permit past this list. A repository workflow that merges or pushes to a default branch, such as a memory fast-track, does not apply inside a run: this list controls, and the sponsor runs that workflow outside the run.

A defect found outside the approved plan is dispositioned once: take it only when the planned change cannot land without it, defer it to a new work item, or decline it with a reason. Record the disposition. Size, proximity, and reviewer preference never justify taking it.

## Supervision

When a supervisor is watching, end each turn that ends with the status block defined by the `supervise` skill (`.agents/skills/supervise/references/status-block.md`), and append a coordination record at every phase change and whenever a pull request opens. The record is what a supervisor reads between turns; the block only reaches it when a turn ends.

This is optional: a run with no supervisor writes the record anyway, because a resuming manager reads it.

## Continuation

The workflow below is one continuous sequence. Finishing a phase is not a
reason to end your turn: append the record, write the status block if a
supervisor is watching, and begin the next phase in the same turn.

Exactly two things end a turn. A question for the sponsor, named in
`waiting_on` — and only the four escalations above qualify. Or a terminal
signal, which ends the run. Anything else, including a completed phase, a
pushed commit, or a written report, continues.

## Workflow

1. **Readiness.** Read the run issue named at kickoff and its sub-issues; the acceptance criteria are theirs, verbatim. Kickoff that names no run issue stops here with `NEEDS_REFINEMENT` — there is nowhere to write a record, so the signal is the record. Confirm the criteria are concrete and jointly satisfiable. If they are not, name the exact collision, append the record, and stop with `NEEDS_REFINEMENT`.
2. **Resolve.** Determine the repositories, their profiles, their baseline commits, and the merge order for a synchronized pair. Where a pair is in scope, both repositories carry the same change and merge together.

   Resolve each profile field in order: the repository being changed, then the workspace steering document when the run starts from a workspace holding that repository, then the field's default. Read the keys a profile states; never infer one from surrounding prose. Record which of the three supplied each field — a later phase cannot otherwise tell a stated value from an inherited one. `references/repository-profile.md` holds the fields, the precedence rule, and the template a repository copies.

   Then confirm the run's home, in order. No `coordination_repository` resolves, or repositories resolve different ones: stop `BLOCKED`, naming the field. The run issue is not in it: stop `NEEDS_REFINEMENT`. A repository whose `tracking` is `required` has no issue among the run issue's sub-issues: stop `NEEDS_REFINEMENT`, naming the repository. Otherwise move the run issue's board status to in progress, where it is on a board, and append the record.
3. **Plan.** Delegate to `agents/plan-agent.md`. The plan covers only decisions that are expensive to reverse. Check it against every acceptance criterion before accepting it: a plan that satisfies fewer criteria than the item states returns to the plan agent once, then stops with `NEEDS_REFINEMENT`. Under `checkpointed` autonomy, the sponsor approves the plan before implementation. Post the accepted plan on the run issue as a plan comment and link it from the record before implementing; a correction round posts the next revision.
4. **Implement.** Delegate to `agents/build-agent.md`, one per repository, serialized unless each has an exclusive file boundary. The builder is retained for the whole run; corrections go back to the same builder.
5. **Publish.** Push the branch and open a **draft** pull request per repository, cross-linked where a pair is in scope, with the body `references/run-state.md` defines: closing its own repository issue when `work_item` is not `null`, and naming the run issue without a closing keyword. Append a record naming each pull request as soon as it opens, before anything else runs against it.

   This comes before review on purpose. The review capability never creates a pull request. The `consensus-review` skill, given one, posts a comment per cycle and runs its own fix-and-re-review loop; given none, it returns a report that exists only in this session, never fixes, and never re-reviews. CodeRabbit reviews only a pull request that exists. Reviewing first therefore throws away the run's strongest evidence, disables the fix loop, and spends a whole invocation on every correction. Draft, because an open pull request must not read as ready while review and verification are still running.
6. **Review.** The orchestrator triggers every review: nothing reviews a pull request on its own, so its draft state never decides whether a review runs. Run the review capability once per repository **against the pull request**. Under `consensus-review`, invoke the skill, so each cycle posts its comment to the thread. Under `coderabbit`, run the loop in `references/coderabbit-review.md`: trigger CodeRabbit's review of the head with a comment, send every finding to the retained builder, post the dispositions, and trigger the review of the new head. Re-invoke at most once more per repository; a third invocation needs the sponsor. Findings are dispositioned by the builder, never argued with here. Any commit after a review invalidates that review and the verification that followed it.
7. **Verify.** Delegate to `agents/verify-agent.md`, a fresh agent per repository. Pass identifiers only: the run issue URL, the repository, the pull request number, and the head SHA. Never a summary, a paraphrase of what the builder did, or where to look — the verifier fetches the criteria and the diff itself, and names what it was given in its comment. It posts the verification comment to the pull request. A criterion that is not `pass` sends the run back to implement, with corrections to the same builder, then through review and verify again against the new head, while a review invocation remains; with the budget spent, the run ends `VERIFICATION_FAILED`.
8. **Merge-ready.** Take the pull requests out of draft, then confirm that every resolved `required_gates` entry passes on each pull request's head SHA, polling each as the profile describes and recording the evidence for each gate. Check every gate against the one head SHA that review and verification covered. If the head has moved, the commit that moved it invalidated both, so the run returns to review. A gate that is missing or failing blocks `READY_TO_MERGE`: stop `BLOCKED`, naming the gate. Append the record, and report the state and the profile's merge method. Never merge.
9. **Retrospective.** On every terminal path, append the terminal snapshot to the run issue once, move its board status to in review when the signal is `READY_TO_MERGE`, and post one retrospective comment. The sponsor closes the run issue once every pull request has merged.

## Terminal output

End with a short report — what changed per repository, the pull-request URLs, the verification result, and anything the sponsor must decide — followed by exactly one fenced block as the last output:

```chore-orchestrate-signal
{"signal": "<SIGNAL>", "run_id": "<id>", "details": {}}
```

| Signal | When |
| --- | --- |
| `READY_TO_MERGE` | Every repository has an open pull request, review passed, every verification criterion is `pass`, and every resolved `required_gates` entry passes on the head SHA |
| `NEEDS_REFINEMENT` | The run issue, its sub-issues, or the plan cannot satisfy the criteria, or the run has no valid run issue |
| `BLOCKED` | The sponsor must decide before the run can continue; `details.question` states it |
| `VERIFICATION_FAILED` | Verification returned `fail`, `not_verified`, or `underived` for any criterion and the budget is spent |
| `QUALITY_FAILURES` | The profile's quality commands fail and the failures are not attributable to the change |
| `DEPENDENCY_MISSING` | The review capability is unavailable |
| `ABORT` | Unrecoverable; `details.reason` and `details.message` state it |

`details` also carries `repos`, `pull_requests`, `criteria` (the verification table), and `deferred` (work-item records for deferred scope). Stop after the signal block. Do not merge, deploy, or start unrequested follow-up work.
