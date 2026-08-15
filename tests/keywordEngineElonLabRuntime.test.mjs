import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shoplingFile = await readFile(
  "src/lib/keywordEngineElonLabShopling.ts",
  "utf8",
);

test("stage one splits the six fixed goods keys into small concurrent Shopling reads", () => {
  assert.match(
    shoplingFile,
    /KEYWORD_ELON_LAB_SHOPLING_BATCH_SIZE = 2/,
  );
  assert.match(shoplingFile, /function batches\(values: string\[\]\)/);
  assert.match(shoplingFile, /Promise\.all\(/);
  assert.match(shoplingFile, /loadShoplingBatch\(config, batch\)/);
});

test("stage one returns before the Vercel route hard timeout can mask the real error", () => {
  assert.match(
    shoplingFile,
    /KEYWORD_ELON_LAB_SHOPLING_TIMEOUT_MS = 18_000/,
  );
  assert.match(
    shoplingFile,
    /timeoutMs: KEYWORD_ELON_LAB_SHOPLING_TIMEOUT_MS/,
  );
});

test("stage one still reads the same product context fields", () => {
  for (const field of [
    "goods_key",
    "ptn_goods_cd",
    "prod_nm",
    "model_no",
    "model_nm",
    "site_srch",
    "sale_status",
    "dtl_desc",
  ]) {
    assert.match(shoplingFile, new RegExp(`"${field}"`));
  }
});
