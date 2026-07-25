import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/components/product-launch-flow/ProductLaunchFlow.tsx", import.meta.url),
  "utf8",
);

test("Product Launch exposes the two explicit manual title phases and confirmations", () => {
  for (const text of [
    "최종 상품명 1건 시험 적용",
    "상품명 1건 시험 적용 확인 중",
    "상품명·가격 정상 확인 · 나머지 적용",
    "나머지 상품명 순차 적용 확인 중",
    "전체 상품명·가격 확인 완료",
    "출시 완료",
  ]) assert.match(source, new RegExp(text.replace(/[·]/g, "·")));
  assert.match(source, /title_apply_phase: "manual_canary"/);
  assert.match(source, /title_apply_phase: "manual_remaining"/);
  assert.match(source, /confirmed_canary_goods_key: canaryGoodsKey/);
  assert.match(source, /confirmed_canary_mall_key: canaryMallKey/);
});

test("manual title phases bypass automatic final price repair and persist operator state", () => {
  assert.match(source, /if \(isManualTitlePhase\) return/);
  assert.match(source, /manualTitleOperatorConfirmedComplete/);
  assert.match(source, /manualTitleCanaryRequestId/);
  assert.match(source, /manualTitleRemainingRequestId/);
});

test("manual dispatch guards allow only terminal failure retries", () => {
  assert.match(source, /manualTitleCanaryDispatchingRef\.current/);
  assert.match(source, /manualTitleRemainingDispatchingRef\.current/);
  assert.match(source, /isRetryableManualApplyResult\(manualApplyResult\)/);
  assert.match(
    source,
    /\[[\s\S]*"failed",[\s\S]*"blocked",[\s\S]*"error",[\s\S]*"partial_failure",[\s\S]*"completed_no_artifact"[\s\S]*\]\.includes\(status\)/,
  );
  assert.match(
    source,
    /manualTitleRemainingRequestId &&\n\s+!isRetryableManualApplyResult\(manualApplyResult\)/,
  );
});

test("remaining uses an independent guard and releases it only on terminal or dispatch failure", () => {
  assert.match(
    source,
    /manualTitleRemainingRequestId === requestId\)\n\s+manualTitleRemainingDispatchingRef\.current = false/,
  );
  assert.doesNotMatch(
    source.slice(
      source.indexOf("const applyManualTitleRemaining"),
      source.indexOf("const resumeSerialMallTitleApply"),
    ),
    /serialMallTitleResumeDispatchingRef\.current = true/,
  );
});

test("remaining exact-id polling is uncapped and survives reload", () => {
  assert.match(source, /restoredSession\?\.manualTitleRemainingRequestId/);
  assert.match(
    source,
    /next >= ACTIVE_MAX_POLLS &&[\s\S]*!serialMallTitleResumeRequestId &&[\s\S]*!manualTitleRemainingRequestId/,
  );
  assert.match(source, /manualApplyResultFetchInFlightRef\.current\.has\(requestId\)/);
  assert.match(source, /activeManualApplyRequestIdRef\.current !== requestId\) return/);
});

test("verified serial and manual phases retain separate handlers", () => {
  assert.match(
    source,
    /if \(priceRepairCompletedVerificationPending\) \{\n\s+void resumeSerialMallTitleApply\(\)/,
  );
  assert.match(
    source,
    /title_apply_phase === "manual_remaining"\)\n\s+void applyManualTitleRemaining\(\)/,
  );
});

test("manual retry path cannot automatically invoke price repair", () => {
  assert.match(
    source,
    /if \(!isManualTitlePhase && manualApplyPriceRepairRequired && !finalPriceDone\)/,
  );
});
