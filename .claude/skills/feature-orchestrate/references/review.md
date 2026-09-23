# Review

The review phase settles an independent review of the pull request's head before any claim is scoped or proved. The profile's `review_capability` names the gate of record, and the manager triggers every review of it: nothing reviews a pull request on its own, so a pull request's draft state never decides whether a review runs.

## Who fixes

| `review_capability` | Who applies fixes |
| --- | --- |
| `consensus-review` | The review skill's own fixer, inside its invocation. Give the skill the approved plan through its plan input. After each fix commit, the manager checks the commit against the approved plan: a fix that removes something the plan requires is reverted by the builder and reported, never kept. |
| `coderabbit` | The retained builder, following the loop in `references/coderabbit-review.md`. CodeRabbit's own autofix and suggested-change commits are not used. |

These are the only two writers a run has: the builder, and consensus-review's fixer while it is the gate of record.

## What counts as a finding

Under `coderabbit`, everything CodeRabbit raises against any head the run reviewed needs a disposition: inline comments, "outside diff range" comments, and nitpicks. Declining a nitpick needs only a one-line reason. A repository that wants no nitpicks turns them off in its own CodeRabbit configuration; the skill does not filter them.

A finding from an earlier head stays open until the run records its disposition. CodeRabbit's "addressed in commit" mark is evidence for a `fixed` disposition, never the disposition itself.

**Clean** means a completed review of the current head, and a disposition on every finding from every review of the pull request. A pass that fixes something pushes a new head, which needs its own review. A pass whose findings are all `declined` or `deferred` pushes nothing, so the reviewed head is still current and the review is clean once those dispositions are recorded. An incremental review never raises old findings again, so a quiet latest review alone cannot establish clean while an earlier finding is still open.

Trigger with `@coderabbitai review`, which reviews the commits since the last review. Use `@coderabbitai full review` when the last reviewed commit is no longer an ancestor of the head, as after a rebase.

## Dispositions

Every finding ends as `fixed`, `declined` with a technical reason, or `deferred` with a work-item record the sponsor can open. The builder dispositions findings under `coderabbit`; consensus-review dispositions its own under `consensus-review`. The manager records every disposition in one comment on the pull request per review pass, naming the reviewed head.

## Accepting a finding as-is

`declined` because the behavior is intended is accepting the finding as-is. It needs a citation: the governing document and passage that already sanctions the behavior. Without one, the finding is fixed or escalated.

A finding that touches a safety, privacy, authorization, or test boundary is never accepted as-is, whatever a citation would say.

A bounded read-only subagent checks the citation, never the manager or the builder, using this prompt unchanged:

```text
Read the finding below and the repository's governing documents. Report whether
any governing document already sanctions the behavior the finding objects to.
Answer with the document and passage, or with "no citation found". Do not
evaluate whether the finding is worth fixing, and do not consider who wrote the
code. Report "no citation found" when uncertain.
```

Record the subagent's answer in the finding's disposition. "No citation found" leaves only fix or escalate. A rewritten prompt, an unrecorded result, or an accepted finding with no check is itself a deviation to report.

## Class audit

A finding that names a class of defect, rather than one instance, triggers an audit for other instances of that class. The audit is not bounded to the diff, because the most serious instance may sit in code that already merged. Record the audit's result next to the finding's disposition.

## Late reviews

A review that arrives for a head whose triage is already complete reopens triage for its own findings. It does not consume a review cycle, because no repair round was spent on it.

## An additional review

Only the sponsor directs an additional review, at kickoff, for a particular run. It runs without a pull request, so it reports and never writes. The manager posts its report on the pull request, and its findings are dispositioned like the gate's: a finding is not invalid because the gate of record did not raise it. It sits outside the review budget, because the sponsor authorized it separately.
