import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [service, engine, cron, page] = await Promise.all([
  readFile("src/lib/productMasterShoplingSalesDirectCodeEvidence.ts", "utf8"),
  readFile("src/lib/productMasterShoplingSalesDirectCodeEvidenceEngine.ts", "utf8"),
  readFile(
    "src/app/api/cron/product-master-shopling-sales-backfill/route.ts",
    "utf8",
  ),
  readFile(
    "src/app/product-master/shopling-sales-backfill/direct-code-evidence/page.tsx",
    "utf8",
  ),
]);

test("direct-code evidence scans Shopling orders and writes only immutable operation snapshots", () => {
  assert.match(service, /ShoplingReadClient/);
  assert.match(service, /commerce_operation_runs/);
  assert.match(service, /OPS_READ_ONLY_WORKER/);
  assert.doesNotMatch(service, /barcode-ledgers|sales-ledger|inventory-baseline|price-adjustment/i);
  assert.doesNotMatch(service, /Product Master.*method:\s*"POST"/i);
});

test("scan starts only from the currently blocked baseline and freezes planning identity", () => {
  assert.match(service, /baselineStatus\.state !== "BLOCKED"/);
  assert.match(service, /baselineRequest\.requestId !== baselineStatus\.requestId/);
  assert.match(service, /planningFingerprint/);
  assert.match(service, /DIRECT_CODE_EVIDENCE_BASELINE_CHANGED/);
  assert.match(service, /DIRECT_CODE_EVIDENCE_PLANNING_CHANGED/);
  assert.match(service, /DIRECT_CODE_EVIDENCE_UNMAPPED_BASELINE_CHANGED/);
});

test("engine requires one direct barcode, one Shopling product, current active listing and deterministic units", () => {
  assert.match(engine, /evidence\.barcodes\.size !== 1/);
  assert.match(engine, /evidence\.productIds\.size > 1/);
  assert.match(engine, /evidence\.productIds\.size !== 1/);
  assert.match(engine, /current\.activeListingCount < 1/);
  assert.match(engine, /current\.units\.size !== 1/);
  assert.match(engine, /SAFE_CURRENT_SKU/);
});

test("existing sales worker falls back to direct-code scan only when catalog shadow has no safe evidence", () => {
  assert.match(cron, /SHADOW_NO_EVIDENCE\|SHADOW_NO_SAFE_RESOLVER/);
  assert.match(cron, /createProductMasterShoplingSalesDirectCodeEvidenceRequest/);
  assert.match(cron, /runProductMasterShoplingSalesDirectCodeEvidenceStep/);
  assert.match(cron, /DIRECT_CODE_EVIDENCE_QUEUED/);
});

test("operator page does not expose order numbers or buyer data and states no business writes", () => {
  assert.doesNotMatch(page, /orderNo|orderLineId|buyer|buyerName|recipient|phone|address/i);
  assert.match(page, /NO BUSINESS WRITES/);
  assert.match(page, /Product Master 판매원장·재고·가격·발주에는 쓰지 않습니다/);
});
