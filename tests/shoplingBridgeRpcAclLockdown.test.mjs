import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../supabase/migrations/202608300003_shopling_bridge_security_definer_acl_lockdown.sql",
  import.meta.url,
);

test("Shopling market and title SECURITY DEFINER RPCs are service-role only", async () => {
  const source = await readFile(migrationPath, "utf8");
  const functions = [
    "claim_shopling_market_pipeline_tasks",
    "arm_shopling_market_pipeline_submit",
    "report_shopling_market_pipeline_task",
    "claim_shopling_title_diversification_tasks",
    "report_shopling_title_diversification_task",
    "retry_shopling_title_diversification_failures",
  ];
  for (const name of functions) {
    assert.match(source, new RegExp(`revoke all on function public\\.${name}\\([^;]+from public, anon, authenticated`, "i"));
    assert.match(source, new RegExp(`grant execute on function public\\.${name}\\([^;]+to service_role`, "i"));
  }
});
