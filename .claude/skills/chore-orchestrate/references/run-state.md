# Run state and published records

Run state lives on the run issue and the pull requests. Local scratch files are disposable and are never evidence.

Every fact has one owner. The run issue owns what belongs to the run: why it exists, its criteria, the plan, the coordination record, the snapshot, and the retrospective. Each pull request owns what belongs to its repository: the diff, the review cycles, the verification comment, and the merge. Neither restates the other; they link.

## The run issue

An issue in the resolved `coordination_repository`, created by the sponsor before kickoff. Each repository issue the run needs is one of its sub-issues. The manager reads it and writes comments on it, and never creates, edits, or closes an issue.

A run issue can hold several runs: a retry after `NEEDS_REFINEMENT` is a new `run_id` on the same issue. Every comment below carries its `run_id`.

## Run identifier

One `run_id` per invocation: `chore-<UTC YYYYMMDDTHHMMSSZ>`. A correction after a terminal signal starts a new `run_id` and never edits an earlier record.

## Coordination record

A marker comment on the run issue, **appended** at every phase change and whenever a pull request opens. Never edit one. Each marker is complete, not a delta: a fresh manager resumes from the latest marker for the current `run_id`, and the earlier markers are the run's history.

```text
**chore-orchestrate** run chore-20260915T142530Z — phase `implement`

<!-- chore-orchestrate
{"run_id":"chore-20260915T142530Z","phase":"implement","repos":[{"name":"<repo>","work_item":"<repository issue URL, or null>","baseline":"<sha>","branch":"<branch>","profile_inherited":["merge_method"],"profile_defaults":["autonomy"],"pull_request":null}],"plan":"<plan comment URL, or null>","plan_accepted":true,"review_invocations":{"<repo>":1},"deferred":[],"updated":"2026-09-15T14:25:30Z"}
-->
```

- The visible line is for a reader scrolling the issue; the marker below it is what a manager parses.
- `phase` is one of `readiness`, `resolve`, `plan`, `implement`, `publish`, `review`, `verify`, `merge_ready`, `retrospective`. Publish precedes review: the review capability posts to a pull request and cannot create one, so a run that reviews first has no thread to post to, no fix loop, and no re-review.
- `work_item` is the repository's issue, a sub-issue of the run issue, or `null` where that repository's `tracking` is `none`.
- `plan` links the current plan revision. The plan's text lives only in that comment.
- `profile_inherited` lists fields the repository did not state that came from the workspace profile.
- `profile_defaults` lists fields neither profile stated, which fell back to the field table. A field in neither list was stated by the repository itself.

  The three sources are recorded separately because they carry different weight. A defaulted field means nobody decided; an inherited one means the workspace decided for a repository that may later disagree. Collapsing them hides which is which, and a later phase — or a fresh manager resuming from this record — then reads an inherited value as a repository requirement.
- `review_invocations` counts invocations of the review skill per repository, against the budget of two. It does not count the review-and-fix cycles the review skill runs inside one invocation, of which there are up to three. The field is named for what it counts because the shorter name read as cycles and misled both a sponsor and a supervisor during the first pilot.
- `deferred` holds records of scope pushed out of this run: `{"summary": "...", "reason": "...", "work_item": null}`.
- The record holds identity — URLs, SHAs, branch names — and the run's own state. It never copies a pull request's state, such as open, a review score, or check results; read those from the pull request.
- Only the manager writes markers, one at a time.

## Plan comment

Posted on the run issue once the plan is accepted, before implementation. A correction round posts the next revision as a new comment; an earlier revision is never edited.

```markdown
### Chore plan — run <run_id>, revision <n>

<the accepted plan, as the plan agent returned it>
```

## Pull request body

Each pull request links both ways:

- `Closes #<n>` for its own repository issue, when `work_item` is not `null`. Same repository only.
- One plain line naming the run issue: `Run: <run issue URL>`. Never a closing keyword: a cross-repository keyword closes the run issue when the first pull request of a pair merges.

## Verification comment

One comment per pull request, posted by the verify agent:

```markdown
### Chore verification — run <run_id>

**Inputs:** <exactly what the verifier was given: run issue URL, repository, pull request, head SHA>

| Criterion | Check | Disposition | Evidence |
| --- | --- | --- | --- |
| <criterion text, verbatim> | <the check that would show it unmet> | pass \| fail \| not_verified \| underived | <command and inspected output, path:line, or link> |

**Quality commands:** <source that supplied them: repository profile, workspace profile, or manifest> — <command> — <result>
**Replaced checks:** <criterion — old check — reason tied to the criterion's text, or none>
```

- A disposition with no evidence is invalid. An exit code counts only when the agent inspected the output it refers to.
- `underived` means no check could falsify the criterion; it states why and is never a pass.
- A check that passes against the baseline commit proves nothing and is replaced, with the reason recorded.

## Terminal snapshot

Appended to the run issue once, when the run reaches its terminal signal, and never edited. It freezes what the sponsor is handed.

```text
**chore-orchestrate** run chore-20260915T142530Z — terminal `READY_TO_MERGE`

<!-- chore-orchestrate-snapshot
{"run_id":"chore-20260915T142530Z","signal":"READY_TO_MERGE","repos":[{"name":"<repo>","pull_request":"<URL>","head_sha":"<sha>","review_comment":"<URL of the final review comment, or null>","verification_comment":"<URL, or null>"}],"written":"2026-09-15T16:02:11Z"}
-->
```

Merge commits are not recorded: the sponsor merges after the run ends, and the pull request records the merge.

## Retrospective

One comment on the run issue per terminal path, including failures and blocked runs:

```markdown
### Chore retrospective — run <run_id>

**Outcome:** <signal>

**Observations**

- <observation> — Adopt | Revise | Defer | Reject — <owner and the check that will confirm it, for Adopt and Revise>
```

No transcripts, no raw logs, and no restating the diff. An `Adopt` or `Revise` observation without an owner and a future check is incomplete.
