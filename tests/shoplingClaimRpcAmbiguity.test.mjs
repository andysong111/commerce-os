import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../supabase/migrations/202608300004_shopling_claim_owner_id_ambiguity_fix.sql",
  import.meta.url,
);

test("Shopling claim RPCs disambiguate owner_id/goods_key conflict targets", async () => {
  const source = await readFile(migrationPath, "utf8");
  const executable = source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

  assert.match(executable, /claim_shopling_market_pipeline_tasks/);
  assert.match(executable, /claim_shopling_title_diversification_tasks/);
  assert.match(
    executable,
    /on conflict on constraint shopling_market_pipeline_ledger_pkey do nothing/i,
  );
  assert.match(
    executable,
    /on conflict on constraint shopling_title_diversification_ledger_pkey do nothing/i,
  );
  assert.doesNotMatch(executable, /on conflict\s*\(\s*owner_id\s*,\s*goods_key\s*\)/i);
  assert.match(executable, /revoke all on function public\.claim_shopling_market_pipeline_tasks/i);
  assert.match(executable, /revoke all on function public\.claim_shopling_title_diversification_tasks/i);
  assert.match(executable, /grant execute .* service_role/i);
});
