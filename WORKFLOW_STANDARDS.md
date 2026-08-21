# Workflow Standards

Agent-facing workflow standards for this workspace.

## Prompt journal

When preserving reusable prompts for study:

- Store them under `.local/prompts/<issue-or-goal>/`.
- Keep one file per distinct stage or revision.
- Preserve every used prompt verbatim.
- Record the issue or goal, execution surface, model, date, result, commit,
  validation evidence, deviations, and lessons.
- Link to durable repository or GitHub artifacts instead of copying them.
- Never store credentials, secrets, raw OFPs, personal data, or sensitive
  command output.
- Keep the journal ignored by Git; do not commit it as an application artifact.

## Awaiting a CodeRabbit response

When polling in the background for a CodeRabbit review, fix, or reply:

- Watch every shape a response can take. CodeRabbit answers as a review object,
  as a pull-request comment, or as a status check on the head, and which one it
  uses is not predictable from the request. A watcher keyed to only one shape
  reports nothing while the answer sits unread in another.
- Know the two shapes that look like a stalled gate but are not. CodeRabbit
  publishes through a commit status rather than a check run, so a check-runs
  query returns nothing for it; query the commit status for the head instead.
  And a completed status carrying no review object means reviewed with nothing
  actionable, not not-reviewed.
- Match a response to the current head rather than counting responses. Compare a
  review's `commit_id` against the head SHA: an invocation acknowledgment is not
  a review, and a late review of an earlier head inflates the count without
  covering the commit that will merge. Both produced false positives within a
  single section. Counting answers the question "did something arrive", not the
  question the gate asks, which is "was this commit reviewed".
- Let the commit status decide that a review is finished, not the arrival of a
  review object. A review object on the current head can be a partial:
  CodeRabbit published a nitpick-only review while its status still read
  "Review in progress," and treating that as the result would have reported a
  clean gate before the actionable findings existed. Matching `commit_id`
  prevents reading the wrong head; it does not prevent reading the right head
  too early.
- Confirm the status settled rather than sampling it once. A single read can
  race a transition — one `success` was read one second after the status had
  already flipped to `pending` for a newly started review, so the query returned
  the previous value. Observe the status reach a terminal state, or require it
  to hold across two consecutive probes and to postdate the push it should
  cover.
- Filter on content, not on counts. Excluding the "Currently processing" notice
  by requiring a second comment also excludes a single substantive reply. Match
  the notice text and ignore it; trip on the first comment that is not it.
- Exit on every terminal state, including the absence of one. Print a distinct
  line for found and for timed out, so silence is never indistinguishable from
  still waiting. A watcher that only reports success cannot report a stalled
  gate, which is the case the review gate most needs surfaced.
- Tolerate transient API failure. Guard each call so one bad response does not
  end the watch; GitHub outages are a live cause of both missing auto-reviews
  and failed polls.
- Poll remote APIs no faster than every 30 seconds, and set the ceiling from
  observed behavior — the first review on a small pull request has landed in
  about three minutes.
