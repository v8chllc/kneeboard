# Repository profile template

Copy this block into the repository's agent steering document, under the heading
shown. The manager reads it at resolve; `references/repository-profile.md`
defines what each field means and what happens when one is absent.

A keyed block, rather than prose, for three reasons: the manager reads thirteen
values without inferring them, a reader can tell a stated value from a default,
and each key can be checked against the skill's universal prohibitions — a
profile narrows authority and can never widen it.

## The block

````markdown
## Agent workflow profile

```yaml
autonomy: checkpointed        # or: autonomous, to skip sponsor plan approval
tracking: required            # or: none
coordination_repository: <owner>/<repository where run issues live>
branch_naming: "type/short-description"
commit_style: conventional
merge_method: rebase          # reported to the sponsor; the run never merges
required_gates:
  - <external check that must pass, and how to poll it>
quality_commands:
  - <lint>
  - <format check>
  - <type check>
  - <tests>
release_steps:
  - <version bump, manifest update, or publication step a change requires>
prohibited_actions:
  - <command, branch, or path this repository forbids>
deploy_triggers: none         # or: <ref, branch, or command that reaches production>
data_sensitivity:
  - <value that must never be logged, committed, or sent to a live service>
synchronized_with: none       # or: <repository that carries the same change>
```
````

Omit a key you have no value for. An omitted key resolves from the workspace
profile when the run starts from a workspace holding this repository, and
otherwise from the conservative default in the field table. Resolution is per
field, so stating a few keys costs you nothing on the rest. The run records
which source supplied each field.

## Worked example

A public plugin repository whose releases are consumed from a cache:

````markdown
## Agent workflow profile

```yaml
autonomy: autonomous
tracking: required
branch_naming: "type/short-description"
commit_style: conventional
merge_method: rebase
required_gates:
  - CodeRabbit review status on the PR head SHA
quality_commands:
  - uv run ruff check .
  - uv run ruff format --check .
  - uv run mypy .
  - uv run pytest
release_steps:
  - bump the version in plugins/<name>/.<toolchain>-plugin/plugin.json in the
    same pull request; a merged change with no bump ships a version already
    present in installed caches
prohibited_actions:
  - never copy private vault content into this public repository
deploy_triggers: none
data_sensitivity: none
synchronized_with: <the sibling repository>
```
````

## What a missing profile costs

Nothing breaks. Every field resolves from the workspace profile when there is
one, and otherwise from the defaults: plan approval becomes a sponsor
checkpoint, a repository issue is required, every push is assumed to reach
production, and all data is treated as sensitive. The one field with no workable
default is `coordination_repository`: without it no run has a home, so a
workspace profile usually states it once for every repository it holds. The cost is interruption — the
sponsor answers questions the repository could have answered once — and, where a
workspace supplied the value instead, a rule that does not travel with the
repository to another checkout.

A rule stated in prose elsewhere in the steering document is still binding, and
the reviewers and the builder read it. It just does not reach the manager as a
profile value, so the run reports that field as defaulted.
