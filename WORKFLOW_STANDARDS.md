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
