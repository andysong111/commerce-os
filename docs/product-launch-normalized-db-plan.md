# Product Launch normalized DB rollout

1. Keep the current JSON state as rollback mirror.
2. Backfill product rows and option rows.
3. Verify exact item and option parity.
4. Enable normalized reads only after verification.
5. Fall back automatically if the normalized copy is stale.
