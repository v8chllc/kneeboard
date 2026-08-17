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
