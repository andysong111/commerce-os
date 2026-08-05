# Commerce OS Repository Instructions

## Scope

This repository is the central Commerce OS operations console and integration hub. Make the smallest change that satisfies the request. Do not combine feature work with unrelated refactoring, dependency upgrades, authentication changes, or cross-module cleanup.

## Required validation

Use the lockfile and run the relevant full checks before reporting completion:

```bash
npm ci --no-audit --no-fund
npm run lint
npm test
npm run build
```

Pull requests must pass `CI / quality` on the latest head SHA. Never delete, skip, weaken, or rewrite a failing test to obtain a green check. Reproduce unrelated failures on current `main` and report them separately.

## Production safety

Unless explicitly authorized for a narrowly scoped write, do not execute:

- actual Shopling price, product, inventory, or order changes
- actual 1688 order placement or payment
- receipt confirmation
- Supabase or D1 deletion, initialization, replacement, or binding changes
- environment-variable, integration-secret, authentication, or scheduler removal

Use fixtures, mocks, local data, or read-only production endpoints. Never print secret values or authentication tokens.

## Integration boundaries

- Preserve existing authentication and integration-secret checks.
- Do not bypass Ops Center ownership checks for convenience.
- Proposal generation, approval, and external application are separate boundaries.
- Cross-service requests require finite timeouts, idempotency where applicable, and redacted errors.

## Database and durable jobs

Schema changes require a versioned migration and a documented recovery point. Preserve existing product, launch, sales, price, order, and integration data. Long-running work must expose job ID, status, stage, progress, heartbeat, timestamps, and redacted error codes, with atomic claims and safe stale recovery.

## Completion report

Report changed files, lint/test/build results, branch/PR/full SHA, database and configuration impact, actual deployment status and deployed SHA if verified, read-only smoke-test evidence, confirmation that prohibited writes were not executed, remaining risks, and the recovery point.
