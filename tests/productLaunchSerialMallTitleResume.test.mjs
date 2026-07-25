import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL(
    "../src/components/product-launch-flow/ProductLaunchFlow.tsx",
    import.meta.url,
  ),
  "utf8",
);

const between = (start, end) => {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing start marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
};

const resumeBlock = between(
  "const resumeSerialMallTitleApply = useCallback",
  "\n  void openInlineKeywordReview;",
);
const unifiedBlock = between(
  "const handleUnifiedProductLaunchAction = () => {",
  "\n  };\n\n  useEffect(() => {\n    if (!autopilotEnabled) return;",
);
const resultBlock = between(
  "const fetchManualApplyResult = useCallback",
  "\n  useEffect(() => {\n    const restoredRealApplyRequestId",
);

test("pending verification exposes an enabled dedicated resume action", () => {
  assert.match(source, /"누락 상품명만 순차 이어서 반영"/);
  assert.match(source, /"누락 상품명 순차 반영 확인 중"/);
  assert.doesNotMatch(
    unifiedBlock,
    /handleProductLaunchPrimaryAction\(\);[\s\S]*priceRepairCompletedVerificationPending/,
  );
  assert.match(
    unifiedBlock,
    /priceRepairCompletedVerificationPending[\s\S]*resumeSerialMallTitleApply/,
  );
});

test("resume rebuilds current preview, exact-coverage preflight and compact plan", () => {
  for (const snippet of [
    "buildManualReviewedRows()",
    "manualTitleOverridesByGoodsKey",
    "manualKeywordOverridesByGoodsKey",
    "seedKeywordsByGoodsKey",
    "buildKeywordShoplingPayloadPreview",
    "buildKeywordExecutionPreflight",
    "buildCompactKeywordApplyExecutionPlan(preflightResult)",
  ])
    assert.equal(resumeBlock.includes(snippet), true, `missing ${snippet}`);
  assert.match(
    resumeBlock,
    /summary\.generatedTitleTargetCount !==\n\s+summary\.expectedTitleTargetCount/,
  );
  assert.match(
    resumeBlock,
    /summary\.eligibleCount !== summary\.expectedTitleTargetCount/,
  );
});

test("resume dispatch is apply-only and does not repeat other launch stages", () => {
  assert.match(resumeBlock, /\/api\/keyword-shopling-apply\/run/);
  assert.match(resumeBlock, /mode: "apply"/);
  assert.match(resumeBlock, /confirmation_text: APPLY_CONFIRMATION_TEXT/);
  for (const forbidden of [
    "runUploadRequest",
    "runPriceModify",
    "runFinalPriceModify",
    "transmit",
    "market",
  ])
    assert.equal(
      resumeBlock.includes(forbidden),
      false,
      `unexpected ${forbidden}`,
    );
});

test("a synchronous ref blocks double click and polling cannot dispatch", () => {
  assert.match(resumeBlock, /serialMallTitleResumeDispatchingRef\.current/);
  assert.match(resumeBlock, /manualApplyBusy \|\|\n\s+manualApplyPolling/);
  assert.match(
    resumeBlock,
    /serialMallTitleResumeDispatchingRef\.current = true/,
  );
  assert.equal(
    (resumeBlock.match(/keyword-shopling-apply\/run/g) ?? []).length,
    1,
  );
});

test("resume request identity is recoverable and persisted as the real apply", () => {
  assert.match(
    source,
    /serialMallTitleResumeRequestId\?: string/,
  );
  assert.match(
    source,
    /useState\(restoredSession\?\.serialMallTitleResumeRequestId \?\? ""\)/,
  );
  assert.match(
    resumeBlock,
    /setManualApplyRequestId\(requestId\);\n\s+setSerialMallTitleResumeRequestId\(requestId\);\n\s+setKeywordApplyState/,
  );
  assert.match(
    source,
    /keywordRealApplyRequestId:\n\s+manualApplyRequestId \|\|/,
  );
  assert.match(source, /serialMallTitleResumeRequestId,\n\s+finalPriceRequestId/);
});

test("restored resume polls its exact id until a terminal artifact", () => {
  assert.match(
    source,
    /restoredSession\?\.serialMallTitleResumeRequestId \?\?\n\s+restoredSession\?\.keywordRealApplyRequestId/,
  );
  assert.match(
    source,
    /fetchManualApplyResult\(\n\s+serialMallTitleResumeRequestId \|\| manualApplyRequestId/,
  );
  assert.match(
    source,
    /manualApplyPollCount >= ACTIVE_MAX_POLLS &&\n\s+!serialMallTitleResumeRequestId/,
  );
});

test("transient resume fetch errors keep the dispatch guard and polling", () => {
  const catchBlock = resultBlock.slice(resultBlock.indexOf("} catch (error)"));
  assert.doesNotMatch(
    catchBlock,
    /serialMallTitleResumeDispatchingRef\.current = false/,
  );
  assert.match(
    catchBlock,
    /serialMallTitleResumeRequestId !== requestId/,
  );
});

test("previous final-price success is retained until a terminal repair-required artifact", () => {
  assert.doesNotMatch(resumeBlock, /setFinalPriceActionsResult\(null\)/);
  assert.match(
    resultBlock,
    /serialMallTitleResumeRequestId === requestId[\s\S]*isManualApplyPriceRepairRequired\(data\)[\s\S]*setFinalPriceActionsResult\(null\)/,
  );
  assert.match(
    resultBlock,
    /finalPriceStartedForRealApplyRequestRef\.current = ""/,
  );
  assert.match(
    resultBlock,
    /handledResumePriceRepairRequestIdRef\.current !== requestId/,
  );
});

test("terminal no-repair resume preserves price and verified success can complete", () => {
  const ready = between(
    "function isManualApplyReadyForFinalPrice",
    "\n}\n\nfunction isManualApplyPriceRepairRequired",
  );
  const completion = between(
    "const actualApplyDone =",
    ";\n  const priceIssueState",
  );
  assert.match(ready, /isFinalManualApplyResult/);
  assert.match(ready, /summary\.failedCount === 0/);
  assert.match(
    completion,
    /manualApplyReadyForFinalPrice &&\n\s+finalPriceDone/,
  );
  assert.doesNotMatch(
    resultBlock,
    /else[\s\S]*setFinalPriceActionsResult\(null\)/,
  );
});

test("tests never perform real external side effects", () => {
  assert.equal(process.env.REAL_FETCH, undefined);
  assert.equal(process.env.SHOPLING_WRITE, undefined);
  assert.equal(process.env.PRICE_MODIFICATION, undefined);
  assert.equal(process.env.MARKET_TRANSMISSION, undefined);
});
