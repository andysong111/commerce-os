import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../supabase/migrations/202608300004_shopling_claim_owner_id_ambiguity_fix.sql",
  import.meta.url,
);

test("Shopling claim RPCs disambiguate owner_id/goods_key conflict targets", async () => {
  const source = await readFile(migrationPath, "utf8");

  assert.match(source, /claim_shopling_market_pipeline_tasks/);
  assert.match(source, /claim_shopling_title_diversification_tasks/);
  assert.match(
    source,
    /on conflict on constraint shopling_market_pipeline_ledger_pkey do nothing/i,
  );
  assert.match(
    source,
    /on conflict on constraint shopling_title_diversification_ledger_pkey do nothing/i,
  );
  assert.doesNotMatch(source, /on conflict\s*\(\s*owner_id\s*,\s*goods_key\s*\)/i);
  assert.match(source, /revoke all on function public\.claim_shopling_market_pipeline_tasks/i);
  assert.match(source, /revoke all on function public\.claim_shopling_title_diversification_tasks/i);
  assert.match(source, /grant execute .* service_role/i);
});
