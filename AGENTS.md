# AI Development & Verification Rules

These rules apply to every AI-assisted code change in this repository.

## Definition of done
Do not report a task as complete merely because code was edited or a build passed. Completion requires evidence that the requested behavior actually works.

## Required verification
After each change, identify explicit acceptance criteria and verify the relevant normal/happy path, failure path, and boundary or abnormal cases. Verify both directions: behavior that should be allowed must work, and behavior that must not happen must be blocked.

Check for regressions in existing behavior affected by the change. Run the repository's relevant tests, type checks, lint, build, and other available checks. Do not hide, weaken, delete, or bypass tests just to make a change pass.

For runnable web UI changes, perform real browser verification when the environment and available tooling permit it: navigate like a user, click/input/refresh as relevant, and confirm the observable result. When correctness depends on more than the UI, also inspect the relevant API/backend response and persisted database/state when access is available. A correct-looking screen alone is not proof of system correctness.

If browser, database, external-service, credential, or environment access is unavailable, state that limitation explicitly. Never claim a verification step was performed when it was not.

## Root-cause standard
Distinguish hypotheses from confirmed causes. Do not call something the root cause without evidence such as logs, traces, data inspection, reproducible before/after behavior, or an equivalent direct signal. Prefer reproducing the failure before fixing it when practical, then repeat the same reproduction after the fix.

## Adversarial pass
Before finalizing, assume the implementation is wrong and actively try to break it. Consider malformed or missing input, repeated actions, refresh/retry, stale state, partial failure, permissions/authentication, concurrency where relevant, and dependencies that can fail. Use judgment; test cases should match the actual risk of the change.

## Fix-and-retest loop
If verification fails, investigate, fix, and rerun the relevant checks. Do not stop at the first patch if the acceptance criteria still fail.

## Completion report
Every completion report must state what changed, what was tested, the evidence/results, any regression checks performed, and anything not verified or still risky. End by answering: "What proves this is working correctly?"

## Safety
Prefer minimal, reversible changes. Preserve existing working behavior unless the task explicitly requires changing it. Do not perform destructive production-data operations, weaken authentication/authorization, expose secrets, or broaden access merely to make verification easier.