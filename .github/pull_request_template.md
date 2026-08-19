## What changed

<!-- Summarize the requested behavior change and its scope. -->

## Verification evidence

- [ ] Acceptance criteria were defined and checked.
- [ ] Relevant happy path was verified.
- [ ] Relevant failure/boundary path was verified.
- [ ] Affected existing behavior was checked for regressions.
- [ ] Relevant lint/type/test/build checks passed on the latest head SHA.

## Regression asset check

For a bug, production incident, data mismatch, edge case, or repeated operator mistake:

- [ ] A deterministic regression test was added or strengthened to protect the failed invariant, or this PR explains why the behavior cannot be tested reliably.
- [ ] The regression test is executed by an applicable GitHub Actions CI workflow; it is not an orphan test file.
- [ ] The CI run containing that exact regression test passed on the latest PR head SHA.
- [ ] Existing regression tests were not deleted, skipped, weakened, or loosened merely to make CI green.

If this is not a bug/regression change, mark these items N/A in the PR description rather than inventing meaningless tests.

## Production safety

- [ ] No unauthorized destructive production-data operation was performed.
- [ ] No authentication/authorization was weakened and no secret was exposed.
- [ ] Any real external write performed by this change was explicitly authorized and reported.

## Proof

**What proves this is working correctly?**

<!-- Link or name the relevant CI workflow/test and any browser/API/DB evidence. -->
