# Result comment

The comment that records `feature-orchestrate`'s proof of one pull request. It is this skill's proof comment: the terminal snapshot in `references/run-state.md` links it as `verification_comment`.

A publication agent renders it from the scope comment and the proof agents' verdicts, and posts it once all selected lanes have returned. It renders decided results. It never reclassifies a claim, reruns a check, or changes a verdict.

```markdown
### Feature result — run <run_id>

**Frozen head:** <sha> — **Basis:** Journey | Verification | Composite — **Scope:** <scope comment URL>
**Result:** pass | fail

| Criterion | Status | Claims |
| --- | --- | --- |
| <criterion text, verbatim> | pass \| fail \| not_verified | C-1, C-4 |
| Delivery contract: claims the diff makes that no criterion names | pass \| fail \| not_verified | C-7 |

| Claim | Lane | Verdict | Evidence |
| --- | --- | --- | --- |
| C-1 <claim> | verification | proved \| refuted \| evidence_absent \| evidence_unfit \| undurable \| wrong_commit \| underived | <locator, and the technique that showed the assertion can fail> |

**Future integration (not counted):** <claim — named work item — governing passage, or none>
**Sign-off:** <name, declined, or not asked>

<details><summary>Evidence — C-1</summary>

<quoted command and inspected output>

</details>
```

## Roll-up

- Every current claim appears under exactly one row. A claim the scope derived from the diff, with no criterion naming it, rolls up to the delivery-contract row rather than being dropped.
- A criterion is `pass` only when every current claim mapped to it is `proved`.
- It is `fail` when any of its claims is `refuted`, `evidence_absent`, `evidence_unfit`, `undurable`, `wrong_commit`, or `underived`.
- It is `not_verified` only when a lane could not run at all.
- The result is `pass` only when every row passes, the delivery-contract row included, so every current claim is `proved`. One lane never compensates for another, and `future_integration` claims are listed but never counted.

## Evidence and sign-off

Quote text evidence in collapsed sections. Attach images and video with `gh pr comment --attach`, and link a long log from a separate comment on the same pull request. A verdict whose locator cannot be followed is invalid, so read the rendered comment back and confirm every locator resolves before reporting it posted.

When the kickoff asks for a human sign-off, the question is put only after every artifact it would attest to can be opened. Declining does not block publication.
