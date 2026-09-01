import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [archive, page] = await Promise.all([
  readFile("src/lib/productDecisionMonthlyArchive.ts", "utf8"),
  readFile("src/app/product-decision-agent/page.tsx", "utf8"),
]);

test("monthly purchase archive uses existing operation ledgers and stays read only", () => {
  assert.ok(archive.includes('"INTERNAL_CHINA_MONTHLY_FUNDING_CLOSE"'));
  assert.ok(archive.includes('"INTERNAL_CHINA_PURCHASE_PREP"'));
  assert.ok(archive.includes('"PRODUCT_DECISION_LIVE_REFRESH_REQUEST"'));
  assert.ok(archive.includes("readOnly: !current"));
  assert.equal(archive.includes('method: "POST"'), false);
  assert.equal(archive.includes('method: "PATCH"'), false);
  assert.equal(archive.includes('method: "DELETE"'), false);
});

test("closed monthly views use immutable purchase prep lines instead of a live overlay", () => {
  assert.ok(archive.includes("normalizePrep"));
  assert.ok(archive.includes("snapshot.savedAt"));
  assert.ok(archive.includes("snapshot.lines"));
  assert.ok(page.includes("if (archive?.readOnly)"));
  assert.ok(page.includes("ArchivedPurchaseMonth"));
  assert.ok(page.includes("마감 확정 발주 항목"));
  assert.ok(page.includes("마감 · READ ONLY"));
  assert.ok(page.includes("현재 재고·판매·미입고 데이터를 덧씌우거나 과거 수량을 다시 계산하지 않습니다"));
});

test("purchase recommendation page exposes month navigation and distinguishes current calculation state", () => {
  assert.ok(page.includes("MONTHLY PURCHASE CYCLES"));
  assert.ok(page.includes("월별 발주 사이클"));
  assert.ok(page.includes("?month=${month.cycleMonth}"));
  assert.ok(page.includes("진행중 · 계산 전"));
  assert.ok(page.includes("진행중 · 계산 생성"));
  assert.ok(page.includes("마감 · 읽기 전용"));
  assert.ok(page.includes("월간 발주안은 아직 생성되지 않았습니다"));
  assert.ok(page.includes("현재 월 확정안 아님"));
});

test("current month keeps the monthly calculation action while archived months only return to current", () => {
  assert.ok(page.includes('href="/product-decision-agent/live-refresh"'));
  assert.ok(page.includes("월간 발주안 계산"));
  assert.ok(page.includes("현재 월로 돌아가기"));
});
