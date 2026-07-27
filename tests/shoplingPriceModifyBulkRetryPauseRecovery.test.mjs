import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("only an auto-managed paused canary retry can recover into normal_paused", async () => {
  const [migration, orchestrator] = await Promise.all([
    read("supabase/migrations/202607280002_shopling_price_bulk_one_click_auto.sql"),
    read("src/lib/shoplingPriceModifyBulkAutoOrchestrator.ts"),
  ]);

  const overrideStart = migration.lastIndexOf(
    "create or replace function public.finish_shopling_price_bulk_retry_chunk(",
  );
  assert.ok(overrideStart >= 0, "migration 006 must override retry completion atomically");

  const override = migration.slice(overrideStart);
  assert.match(override, /select \* into v_job[\s\S]*?for update/);
  assert.match(override, /v_job\.retry_resume_status = 'canary_succeeded'/);
  assert.match(
    override,
    /v_job\.automation_mode = 'auto'[\s\S]*?v_job\.pause_requested[\s\S]*?'normal_paused'/,
  );
  assert.match(override, /chunk_type = 'normal'[\s\S]*?status = 'pending'/);
  assert.match(override, /else[\s\S]*?v_status := 'canary_succeeded'/);
  assert.match(override, /pause_requested = \(v_status in \('normal_paused','retry_paused'\)\)/);

  const autoGuard = override.indexOf("v_job.automation_mode = 'auto'");
  const pausedDecision = override.indexOf("'normal_paused'", autoGuard);
  const manualFallback = override.indexOf("v_status := 'canary_succeeded'", pausedDecision);
  const functionEnd = override.indexOf("end;\n$$;");
  assert.ok(autoGuard >= 0 && pausedDecision > autoGuard);
  assert.ok(manualFallback > pausedDecision && functionEnd > manualFallback);

  assert.match(orchestrator, /\["normal_paused", "retry_paused"\]\.includes\(String\(state\.status\)\)/);
  assert.match(orchestrator, /outcome: "noop"[\s\S]*?안전하게 일시중지/);
});
