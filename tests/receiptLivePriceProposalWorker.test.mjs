import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [worker, cron, page, scheduler] = await Promise.all([
  readFile("src/lib/receiptLivePriceProposalWorker.ts", "utf8"),
  readFile("src/app/api/cron/receipt-live-price-proposals/route.ts", "utf8"),
  readFile("src/app/stage8-receipt-live-price-proposals/page.tsx", "utf8"),
  readFile("supabase/migrations/202608280009_ops_adaptive_dispatcher.sql", "utf8"),
]);

test("worker creates a rollout marker so historical receipt events are never backfilled automatically", () => {
  assert.match(worker, /RECEIPT_LIVE_PRICE_PROPOSAL_ROLLOUT/);
  assert.match(worker, /receipt-live-price-proposal-rollout:v1/);
  assert.match(worker, /policy: "new-receipt-events-only"/);
  assert.match(worker, /return \{ startedAt: rolloutStartedAt, sourceEventId: "" \}/);
  assert.match(worker, /query\.set\("started_at", `gt\.\$\{cursor\.startedAt\}`\)/);
  assert.match(page, /기존 입고는 소급 가격변경하지 않습니다/);
});

test("processed receipt cursor advances by receipt started_at plus source_event_id so later events cannot starve", () => {
  assert.match(worker, /receiptOperationStartedAt/);
  assert.match(worker, /receiptEventId/);
  assert.match(worker, /proposalCursor/);
  assert.match(worker, /started_at\.gt\.\$\{cursor\.startedAt\}/);
  assert.match(worker, /started_at\.eq\.\$\{cursor\.startedAt\}/);
  assert.match(worker, /source_event_id\.gt\.\$\{cursor\.sourceEventId\}/);
  assert.match(worker, /order: "started_at\.asc,source_event_id\.asc"/);
  assert.match(worker, /MAX_EVENT_SCAN = 100/);
});

test("each receipt event is idempotently converted into one durable internal proposal", () => {
  assert.match(worker, /PRICE_ANALYSIS_FROM_RECEIPT/);
  assert.match(worker, /RECEIPT_LIVE_SHOPLING_PRICE_PROPOSAL/);
  assert.match(worker, /proposalSourceEventId/);
  assert.match(worker, /on_conflict: "source_event_id"/);
  assert.match(worker, /resolution=ignore-duplicates/);
});

test("worker proves the exact China batch before any affected Shopling price lookup", () => {
  const sourceIndex = worker.indexOf(
    "loadConfirmedReceiptBatchSource(event.batchId)",
  );
  const liveIndex = worker.indexOf(
    "loadShoplingCurrentPriceSnapshot(affectedPlanning)",
  );
  assert.ok(sourceIndex >= 0);
  assert.ok(liveIndex > sourceIndex);
  assert.match(worker, /RECEIPT_LIVE_PRICE_SOURCE_SCOPE_MISMATCH/);
  assert.match(worker, /RECEIPT_LIVE_PRICE_SOURCE_NOT_READY/);
});

test("only affected planning products are queried from Shopling", () => {
  assert.match(worker, /affectedBarcodes/);
  assert.match(worker, /affectedPlanning = planning\.products\.filter/);
  assert.match(
    worker,
    /affectedBarcodes\.has\(barcodeKey\(product\.barcode\)\)/,
  );
  assert.match(worker, /loadShoplingCurrentPriceSnapshot\(affectedPlanning\)/);
});

test("proposal worker and cron never write Shopling prices", () => {
  assert.match(worker, /writesEnabled: false/);
  assert.match(cron, /shoplingPriceWritesEnabled: false/);
  assert.match(page, /0 · READ ONLY/);
  assert.doesNotMatch(
    `${worker}\n${cron}`,
    /dispatchShoplingPriceModifyActions|prod_modify_api|shopling-price-adjustment\/canary\/run/i,
  );
});

test("protected cron is an operational adaptive-dispatcher task", () => {
  assert.match(cron, /CRON_SECRET/);
  assert.match(cron, /runReceiptLivePriceProposalStep/);
  assert.match(
    scheduler,
    /'receipt-live-price-proposals', '\/api\/cron\/receipt-live-price-proposals', 'operational', 140, true, 3600, 300, 21600/,
  );
});
