import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const root = "public/shopling-stock-state-sync";

test("routes remain option A6-A21 and single A4-A21, no A22", async () => {
  const b = await readFile(`${root}/background-v020.js`, "utf8");
  const w = await readFile(`${root}/content-shopling-v018.js`, "utf8");
  assert.match(b, /\["A6", "A21_LIST"\]/); assert.match(b, /\["A4", "A21_LIST"\]/);
  assert.doesNotMatch(b, /A22/); assert.doesNotMatch(w, /runA22/);
  assert.match(w, /A21_OPTION_SEND_MODE_NOT_FOUND/); assert.match(w, /A21_SALE_STATUS_MODE_NOT_FOUND/);
});

test("exact goods-key and single-row gates stay in the mutation template", async () => {
  const b = await readFile(`${root}/background-v020.js`, "utf8");
  const w = await readFile(`${root}/content-shopling-v018.js`, "utf8");
  assert.match(b, /STOCK_SYNC_GOODS_KEY_REQUIRED/); assert.match(w, /샵플링상품코드/);
  for (const code of ["A4_EXACT_ROW_SELECTION_FAILED", "A21_EXACT_ROW_SELECTION_FAILED", "A6_EXACT_ROW_SELECTION_FAILED"]) assert.ok(w.includes(code));
  assert.match(w, /selected\.count !== 1/);
  assert.match(b, /PRE_SUBMIT_TIMEOUT_MS = 60_000/); assert.match(b, /STOCK_SYNC_OPPOSITE_JOB_BLOCKED/);
});

test("ZIP generates v0.3.0 price-engine package and checks all declared files", async () => {
  const r = await readFile("src/app/api/shopling-stock-state-sync/download/route.ts", "utf8");
  assert.match(r, /const VERSION = "0\.3\.0"/);
  assert.match(r, /buildStockWorkerV030/);
  assert.match(r, /content-shopling-v030\.js/);
  assert.match(r, /background-v030\.js/);
  assert.match(r, /missing_packaged_file/);
  assert.match(r, /workerSha256/);
  assert.match(r, /PRICE_ENGINE_ALL_FRAME_WORKSPACE/);
});
