# CodeRabbit review

The review loop a run follows when the profile's `review_capability` is
`coderabbit`. One pass of this loop is one review invocation against the budget
in `SKILL.md`.

The orchestrator triggers every review. The repository keeps CodeRabbit's
automatic review off (`reviews.auto_review.enabled: false` in
`.coderabbit.yaml`), so every review is one the orchestrator asked for and
counted against the budget, and a pull request's draft state never decides
whether a review runs.

## The loop

1. **Trigger the review of the head.** Comment `@coderabbitai review` on the
   pull request, then follow the rules below until CodeRabbit's review of the
   current head SHA is finished. That command reviews the commits since the
   last review; use `@coderabbitai full review` when the whole diff needs a
   fresh review. If nothing arrives, comment once more. If that also produces
   nothing, the gate is unavailable: stop `BLOCKED`, naming it. Silence is
   never a pass.
2. **Collect the findings on that head.** Take every actionable review comment,
   inline thread, and summary item that CodeRabbit raised against the head. A
   finished review with nothing actionable ends the invocation clean.
3. **Send every finding to the retained builder.** The builder gives each
   finding exactly one disposition: `fixed`, `declined` with a technical
   reason, or `deferred` with a work-item record. When at least one finding is
   `fixed`, it applies the fixes, runs the quality commands, and pushes one
   commit whose body lists every disposition and the validation it ran. When
   none is, it changes nothing and pushes nothing. No other agent writes to the
   branch: CodeRabbit's own autofix and suggested-change commits are not used.
4. **Post the dispositions.** Comment once on the pull request, naming the
   reviewed head and each finding's disposition.
5. **Review the new head.** When step 3 pushed a commit, repeat from step 1
   against the new head, up to three reviews in this invocation. When it pushed
   nothing, the reviewed head is still the head: the invocation ends with every
   finding dispositioned and no further review.

A commit pushed after the third review leaves a head no review has covered.
The invocation ends with that head pending review, never reported as reviewed:
the run starts its next review invocation, or, with the budget spent, asks the
sponsor for one before verification or merge-ready can use the head.

A review that arrives for a head whose findings were already dispositioned
reopens disposition for its own findings. It does not start another review.

## Waiting for a review

CodeRabbit answers in more than one shape, so read all of them against the head
rather than counting responses.

- **The status decides.** CodeRabbit publishes a commit status, not a check
  run: read the commit status for the head SHA with context `CodeRabbit`. The
  review is finished only when that status is terminal, postdates the trigger
  comment it should answer, and reads the same on two consecutive probes. Two
  `pending` reads mean it is still running.
- **Only `success` completes a review.** A terminal `failure` or `error` is a
  failed gate, not a finished review: trigger once more, and stop `BLOCKED`,
  naming the gate, if it repeats.
- **Match the head.** Tie review objects and inline comments to the head by
  their `commit_id`. A review of an earlier head does not cover this one, and
  an acknowledgment comment is not a review.
- **A review object is not the result.** A review object can arrive while the
  status still reads in progress, carrying only part of the findings. Wait for
  the status.
- **`success` with no review object is clean.** A `success` status with no
  review object means CodeRabbit reviewed the head and found nothing
  actionable.
- **Poll patiently.** Probe no faster than every 30 seconds, survive a failed
  call, and end on a distinct timed-out result so silence never reads as still
  waiting. A first review of a small pull request has taken about three
  minutes.
