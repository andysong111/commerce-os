import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { importTranspiledTypeScript } from "./transpileTypeScript.mjs";

const { normalErrorDetail } = await importTranspiledTypeScript(
  new URL("../src/lib/shoplingPriceModifyBulkError.ts", import.meta.url),
);


test("normal diagnostics serialize objects and redact Supabase credentials", () => {
  const detail = normalErrorDetail({ message: "Authorization: Bearer eyJabc.def.ghi apikey=sb_secret_private service role key" });
  assert.match(detail, /Authorization: \[REDACTED\]/);
  assert.doesNotMatch(detail, /eyJabc|sb_secret_private/);
  assert.equal(normalErrorDetail({ reason: "safe context" }), '{"reason":"safe context"}');
  assert.equal(normalErrorDetail(new Error("safe error")), "safe error");
});

test("Bulk API returns safe copyable diagnostics and redacts secrets", async () => {
  const route = await readFile(new URL("../src/app/api/shopling-price-modify/bulk/jobs/route.ts", import.meta.url), "utf8");
  assert.match(route, /diagnostic_id/);
  assert.match(route, /BULK_PREPARED_JOB_RPC_FAILED/);
  assert.match(route, /create\.rpc\.create_shopling_price_bulk_prepared_job/);
  assert.match(route, /detail: error/);
  assert.match(route, /REDACTED_SUPABASE_SECRET/);
  assert.match(route, /REDACTED_JWT/);
});

test("Bulk UI shows a read-only diagnostic box and one-click copy button", async () => {
  const [preview, panel, client] = await Promise.all([
    readFile(new URL("../src/components/shopling-price-modify-runner/ShoplingPriceModifyBulkInputPreview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/shopling-price-modify-runner/ShoplingPriceModifyBulkErrorPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/shoplingPriceModifyBulkClient.ts", import.meta.url), "utf8"),
  ]);
  assert.match(preview, /ShoplingPriceModifyBulkErrorPanel/);
  assert.match(preview, /errorDetail/);
  assert.match(panel, /복사 가능한 오류 상세/);
  assert.match(panel, /오류 내용 복사/);
  assert.match(panel, /navigator\.clipboard\.writeText/);
  assert.match(panel, /readOnly/);
  assert.match(client, /http_status/);
  assert.match(client, /api_stage/);
  assert.match(client, /diagnostic_id/);
});
