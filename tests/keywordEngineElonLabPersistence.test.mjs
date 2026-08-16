import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const storeFile = await readFile("src/lib/keywordEngineElonLabStore.ts", "utf8");

test("keyword lab persistence avoids the failing bulk on_conflict write path", () => {
  assert.doesNotMatch(storeFile, /on_conflict:\s*["']goods_key,stage_key["']/);
  assert.match(storeFile, /patchOrInsertKeywordEngineElonLabRow/);
  assert.match(storeFile, /method: "PATCH"/);
  assert.match(storeFile, /method: "POST"/);
});

test("keyword lab persistence retries transient gateway failures", () => {
  assert.match(storeFile, /RETRYABLE_STATUSES = new Set\(\[502, 503, 504\]\)/);
  assert.match(storeFile, /fetchWithRetry/);
  assert.match(storeFile, /KEYWORD_ELON_LAB_SUPABASE_PATCH_FAILED/);
  assert.match(storeFile, /KEYWORD_ELON_LAB_SUPABASE_INSERT_FAILED/);
});

test("keyword lab persistence surfaces Supabase response body for diagnosis", () => {
  assert.match(storeFile, /function bodySummary/);
  assert.match(storeFile, /function withBody/);
  assert.match(storeFile, /slice\(0, 500\)/);
});
