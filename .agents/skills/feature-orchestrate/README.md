# feature-orchestrate

Delivers one pull request of product behavior in one repository whose completion needs proof beyond the diff. It carries the work from readiness through bounded implementation slices, independent review, claims derived after review, lane-fitted proof, and an open, merge-ready pull request the sponsor merges.

Use `chore-orchestrate` when the diff proves its own completion. The design, and the decisions behind it, are recorded in the `project-management` repository at `agent-workflows/feature-orchestrate-design.md`.

## Files

| Path | What it holds |
| --- | --- |
| `SKILL.md` | The lifecycle, authority boundaries, run records, and terminal signals |
| `references/slice-lifecycle.md` | The ten-step slice lifecycle, stop conditions by step, the checkpoint decision, and loop mode |
| `references/review.md` | Who fixes under each review capability, what counts as a finding, accepting a finding as-is, class audits, and additional reviews |
| `references/proof.md` | Claims, obligations, acceptance responsibility, lanes, Journey coverage, the scope artifact and checkpoint, fit evidence, verdicts, and where evidence lives |
| `references/result-comment.md` | This skill's proof comment and its roll-up rules |
| `references/run-state.md` | Shared contract: the run issue, coordination record, plan comment, snapshot, and retrospective |
| `references/repository-profile.md`, `references/profile-template.md` | Shared contract: the profile fields, including `journey` and `loop_ceiling` |
| `references/coderabbit-review.md` | Shared contract: the review loop under `review_capability: coderabbit` |
| `references/status-block.md` | Shared contract: the manager-status block a supervisor reads |
| `agents/` | The plan, build, scope, proof, and publish roles |

The shared contracts are vendored copies of `.agents/contracts/` in `v8chllc/vault`; edit the source there, never a copy.

## What it needs

**From the environment:** `git` and `gh`, authenticated, with `gh` v2.99.0 or later when evidence includes images or video; and the review capability the profile's `review_capability` names.

**From the repository:** a profile in its steering document. `journey` says how Journey proof is produced, and `loop_ceiling` caps unchecked slices; both default conservatively.

**From the sponsor:** a run issue with concrete, jointly satisfiable criteria; the split, when a unit of work needs two pull requests; and confirmation of the scope checkpoint on every run.
