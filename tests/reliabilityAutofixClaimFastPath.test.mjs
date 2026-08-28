import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/202608280454_reliability_autofix_claim_fast_path.sql",
    import.meta.url,
  ),
  "utf8",
);

test("autofix claim uses an existing queued job before enqueueing new candidates", () => {
  const selectPositions = [...migration.matchAll(/select j\.id into v_job_id/g)].map(
    (match) => match.index,
  );
  const enqueuePosition = migration.indexOf(
    "perform public.enqueue_reliability_autofix_candidates();",
  );

  assert.equal(selectPositions.length, 2);
  assert.ok(selectPositions[0] >= 0);
  assert.ok(enqueuePosition > selectPositions[0]);
  assert.ok(selectPositions[1] > enqueuePosition);
  assert.match(
    migration,
    /if v_job_id is null then\s+perform public\.enqueue_reliability_autofix_candidates\(\);/,
  );
});

test("autofix claim fast path keeps bounded attempt and locking semantics", () => {
  assert.match(migration, /j\.attempts < j\.max_attempts/);
  assert.match(migration, /for update of j skip locked/);
  assert.match(migration, /attempts = attempts \+ 1/);
  assert.match(migration, /claimed_at = now\(\)/);
  assert.match(migration, /github_run_id = left\(coalesce\(p_run_id, ''\), 200\)/);
  assert.doesNotMatch(migration, /attempts = attempts -/);
});
