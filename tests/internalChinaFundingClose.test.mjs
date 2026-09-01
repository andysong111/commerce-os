import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, route, panel, history, workflow] = await Promise.all([
  readFile("src/lib/internalChinaFundingClose.ts", "utf8"),
  readFile("src/app/api/china-order-manager/funding-close/route.ts", "utf8"),
  readFile("src/components/china-order-manager/InternalChinaFundingClosePanel.tsx", "utf8"),
  readFile("src/components/china-order-manager/InternalChinaForwarderCloseHistory.tsx", "utf8"),
  readFile(".github/workflows/china-order-ledger-ci.yml", "utf8"),
]);

test("funding close is a dedicated monthly ledger operation and never rewrites the landed-cost close", () => {
  assert.ok(engine.includes('"INTERNAL_CHINA_MONTHLY_FUNDING_CLOSE"'));
  assert.ok(engine.includes('const FORWARDER_OPERATION_TYPE = "INTERNAL_CHINA_FORWARDER_COST_CLOSE"'));
  assert.ok(engine.includes("readForwarderClose"));
  assert.ok(engine.includes("storeFundingClose"));
  assert.equal(engine.includes("method: \"PATCH\""), false);
});

test("monthly funding close treats WorldFirst transfer as allocation and calculates the Korean wallet and emergency reserve", () => {
  assert.ok(engine.includes("totalSpendingBudgetKrw = integer(budgetMonthRevenueKrw / 2)"));
  assert.ok(engine.includes("koreaAccountAvailableKrw = totalSpendingBudgetKrw - worldFirstTransferKrw"));
  assert.ok(engine.includes("koreaAccountRemainingKrw -" ) === false);
  assert.ok(engine.includes("koreaAccountAvailableKrw - koreaAccountSpentKrw"));
  assert.ok(engine.includes("emergencyReserveTransferKrw: koreaAccountRemainingKrw"));
  assert.ok(engine.includes("worldFirstEndingUsd"));
  assert.ok(engine.includes("worldFirstEndingCnh"));
});

test("funding close is only allowed after final landed cost and cannot understate Korean-account forwarder spending", () => {
  assert.ok(engine.includes("CHINA_FUNDING_CLOSE_FORWARDER_REQUIRED"));
  assert.ok(engine.includes("CHINA_FUNDING_CLOSE_KOREA_SPEND_BELOW_FORWARDER"));
  assert.ok(engine.includes("koreaAccountSpentKrw < actualForwarderCostKrw"));
  assert.ok(engine.includes("CHINA_FUNDING_CLOSE_KOREA_SPEND_EXCEEDED"));
});

test("funding close API is same-origin guarded and reports both wallets", () => {
  assert.ok(route.includes("isSameOriginOpsRequest"));
  assert.ok(route.includes("recordInternalChinaFundingClose"));
  assert.ok(route.includes("WorldFirst"));
  assert.ok(route.includes("한국계좌"));
  assert.ok(route.includes("비상금"));
  assert.ok(route.includes("USD"));
  assert.ok(route.includes("CNH"));
});

test("funding close UI stays simple: four inputs, automatic Korean allocation and automatic emergency reserve", () => {
  assert.ok(panel.includes("WorldFirst 송금액(원)"));
  assert.ok(panel.includes("WorldFirst 기말 USD"));
  assert.ok(panel.includes("WorldFirst 기말 CNH"));
  assert.ok(panel.includes("한국계좌 실제 지출액(원)"));
  assert.ok(panel.includes("한국계좌 배정 가능액"));
  assert.ok(panel.includes("비상금 계좌 적립액"));
  assert.ok(panel.includes("WorldFirst 송금은 비용이 아니라 자금이동"));
  assert.ok(panel.includes("한국계좌 남은금액은 전액 비상금 적립"));
});

test("recent landed-cost history exposes the final funding close and keeps a monthly funding history", () => {
  assert.ok(history.includes("loadInternalChinaFundingClose"));
  assert.ok(history.includes("InternalChinaFundingClosePanel"));
  assert.ok(history.includes("월 자금 마감 이력"));
  assert.ok(history.includes("WorldFirst 송금"));
  assert.ok(history.includes("WF 기말 USD"));
  assert.ok(history.includes("WF 기말 CNH"));
  assert.ok(history.includes("비상금 적립"));
});

test("funding close regression is wired into China order CI", () => {
  assert.ok(workflow.includes("src/lib/internalChinaFundingClose.ts"));
  assert.ok(workflow.includes("src/app/api/china-order-manager/funding-close/route.ts"));
  assert.ok(workflow.includes("src/components/china-order-manager/InternalChinaFundingClosePanel.tsx"));
  assert.ok(workflow.includes("tests/internalChinaFundingClose.test.mjs"));
});
