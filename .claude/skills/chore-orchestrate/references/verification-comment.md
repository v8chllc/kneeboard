# Verification comment

The comment that records `chore-orchestrate`'s verification of one pull request. The shared run-state contract (`references/run-state.md`) names this comment in the terminal snapshot as `verification_comment`.

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
