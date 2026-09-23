# Run state and published records

Run state lives on the run issue and the pull requests. Local scratch files are disposable and are never evidence.

Every fact has one owner. The run issue owns what belongs to the run: why it exists, its criteria, the plan, the coordination record, the snapshot, and the retrospective. Each pull request owns what belongs to its repository: the diff, the review cycles, the verification comment, and the merge. Neither restates the other; they link.

## The run issue

An issue in the resolved `coordination_repository`, created by the sponsor before kickoff. Each repository issue the run needs is one of its sub-issues. The manager reads it and writes comments on it, and never creates, edits, or closes an issue.

A run issue can hold several runs: a retry after `NEEDS_REFINEMENT` is a new `run_id` on the same issue, and a unit of work split across two pull requests gets one run per pull request. Every comment below carries its `run_id`.

## What each skill names

This contract is shared by every orchestrator skill. Each skill's `SKILL.md` has a "Run records" section that names four things:

- its **marker**, the skill's own name, used in `<!-- <marker>` and `<!-- <marker>-snapshot`;
- its **run identifier prefix**;
- its **heading word**, used in the plan and retrospective headings;
- its **phases**, the values `phase` may take, in workflow order;

plus any **extra record fields** it adds, and its proof comment. The examples below use `chore-orchestrate`, whose marker is `chore-orchestrate`, whose prefix is `chore`, and whose heading word is `Chore`.

## Run identifier

One `run_id` per invocation: `<prefix>-<UTC YYYYMMDDTHHMMSSZ>`, such as `chore-20260915T142530Z`. A correction after a terminal signal starts a new `run_id` and never edits an earlier record.

## Coordination record

A marker comment on the run issue, **appended** at every phase change and whenever a pull request opens. Never edit one. Each marker is complete, not a delta: a fresh manager resumes from the latest marker for the current `run_id`, and the earlier markers are the run's history.

```text
**chore-orchestrate** run chore-20260915T142530Z — phase `implement`

<!-- chore-orchestrate
{"run_id":"chore-20260915T142530Z","phase":"implement","repos":[{"name":"<repo>","work_item":"<repository issue URL, or null>","baseline":"<sha>","branch":"<branch>","profile_inherited":["merge_method"],"profile_defaults":["autonomy"],"pull_request":null}],"plan":"<plan comment URL, or null>","plan_accepted":true,"review_invocations":{"<repo>":1},"deferred":[],"updated":"2026-09-15T14:25:30Z"}
-->
```

- The visible line is for a reader scrolling the issue; the marker below it is what a manager parses.
- `phase` is one of the phases the skill names. Publish precedes review in every skill: the review capability posts to a pull request and cannot create one, so a run that reviews first has no thread to post to, no fix loop, and no re-review.
- `work_item` is the repository's issue, a sub-issue of the run issue, or `null` where that repository's `tracking` is `none`.
- `plan` links the current plan revision. The plan's text lives only in that comment.
- `profile_inherited` lists fields the repository did not state that came from the workspace profile.
- `profile_defaults` lists fields neither profile stated, which fell back to the field table. A field in neither list was stated by the repository itself.

  The three sources are recorded separately because they carry different weight. A defaulted field means nobody decided; an inherited one means the workspace decided for a repository that may later disagree. Collapsing them hides which is which, and a later phase — or a fresh manager resuming from this record — then reads an inherited value as a repository requirement.
- `review_invocations` counts review invocations per repository, against the budget of two: calls of the review skill under `consensus-review`, and passes of the loop in `references/coderabbit-review.md` under `coderabbit`. It does not count the review-and-fix cycles inside one invocation, of which there are up to three. The field is named for what it counts because the shorter name read as cycles and misled both a sponsor and a supervisor during the first pilot.
- `deferred` holds records of scope pushed out of this run: `{"summary": "...", "reason": "...", "work_item": null}`.
- A skill's extra record fields sit beside these. They never rename or repurpose a shared one.
- The record holds identity — URLs, SHAs, branch names — and the run's own state. It never copies a pull request's state, such as open, a review score, or check results; read those from the pull request.
- Only the manager writes markers, one at a time.

## Plan comment

Posted on the run issue once the plan is accepted, before implementation. A correction round posts the next revision as a new comment; an earlier revision is never edited.

```markdown
### <heading word> plan — run <run_id>, revision <n>

<the accepted plan, as the plan agent returned it>
```

## Pull request body

Each pull request links both ways:

- `Closes #<n>` for its own repository issue, when `work_item` is not `null`. Same repository only.
- One plain line naming the run issue: `Run: <run issue URL>`. Never a closing keyword: a cross-repository keyword closes the run issue when the first pull request of a pair merges.

## Proof comment

Each skill defines the comment that records its verification or proof of one pull request, and names it in its `SKILL.md` "Run records" section. The terminal snapshot links that comment as `verification_comment`.

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
### <heading word> retrospective — run <run_id>

**Outcome:** <signal>

**Observations**

- <observation> — Adopt | Revise | Defer | Reject — <owner and the check that will confirm it, for Adopt and Revise>
```

No transcripts, no raw logs, and no restating the diff. An `Adopt` or `Revise` observation without an owner and a future check is incomplete.
