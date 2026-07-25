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
  "\n  useEffect(() => {\n    if (!manualApplyPolling) return;",
);
const uploadBlock = between(
  "const runUploadRequest = useCallback",
  "\n  const runUpload = async",
);
const applyBlock = between(
  "const applyManualCandidates = useCallback",
  "\n  const resumeSerialMallTitleApply = useCallback",
);
const restoreBlock = between(
  "const [manualApplyRequestId, setManualApplyRequestId]",
  "\n  useEffect(() => {\n    if (!manualApplyPolling) return;",
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
    /setManualApplyRequestId\(requestId\);\n\s+setSerialMallTitleResumeRequestId\(requestId\);\n\s+handledResumePriceRepairRequestIdRef\.current = "";\n\s+setHandledResumePriceRepairRequestId\(""\)/,
  );
  assert.match(
    source,
    /keywordRealApplyRequestId:\n\s+manualApplyRequestId \|\|/,
  );
  assert.match(
    source,
    /serialMallTitleResumeRequestId,[\s\S]*handledResumePriceRepairRequestId,[\s\S]*finalPriceRequestId/,
  );
});

test("restored resume polls its exact id until a terminal artifact", () => {
  assert.match(
    restoreBlock,
    /restoredSession\?\.keywordRealApplyRequestId \?\?\s*""/,
  );
  assert.match(
    source,
    /fetchManualApplyResult\(\n\s+serialMallTitleResumeRequestId \|\| manualApplyRequestId/,
  );
  assert.doesNotMatch(source, /restoredRealApplyRequestId/);
  assert.match(
    source,
    /manualApplyPollCount >= ACTIVE_MAX_POLLS &&\n\s+!serialMallTitleResumeRequestId/,
  );
});

test("every restored real apply request starts exact-id polling", () => {
  assert.match(
    restoreBlock,
    /const \[manualApplyPolling, setManualApplyPolling\] = useState\([\s\S]*restoredSession\?\.manualTitleRemainingRequestId[\s\S]*restoredSession\?\.keywordRealApplyRequestId/,
  );
  assert.match(
    source,
    /fetchManualApplyResult\(\n\s*serialMallTitleResumeRequestId \|\| manualApplyRequestId,\n\s*\)/,
  );
  assert.equal(
    (source.match(/fetchManualApplyResult\(/g) ?? []).length,
    1,
    "only the polling effect may perform the initial result fetch",
  );
});

test("result polling permits only one in-flight fetch per request id", () => {
  assert.match(
    source,
    /const manualApplyResultFetchInFlightRef = useRef<Set<string>>\(new Set\(\)\)/,
  );
  assert.match(
    resultBlock,
    /manualApplyResultFetchInFlightRef\.current\.has\(requestId\)/,
  );
  assert.match(
    resultBlock,
    /manualApplyResultFetchInFlightRef\.current\.add\(requestId\)/,
  );
  assert.match(
    resultBlock,
    /finally \{\n\s+manualApplyResultFetchInFlightRef\.current\.delete\(requestId\)/,
  );
});

test("stale manual apply responses cannot mutate current request state", () => {
  assert.match(
    source,
    /const activeManualApplyRequestIdRef = useRef\([\s\S]*restoredSession\?\.keywordRealApplyRequestId \?\?\n\s*""/,
  );
  assert.match(
    resultBlock,
    /const data = await[\s\S]*activeManualApplyRequestIdRef\.current !== requestId\) return;[\s\S]*setManualApplyResult\(data\)/,
  );
  assert.match(
    resultBlock,
    /catch \(error\) \{\n\s*if \(activeManualApplyRequestIdRef\.current !== requestId\) return;/,
  );
});

test("transient active-request fetch errors always keep polling", () => {
  const catchBlock = resultBlock.slice(resultBlock.indexOf("} catch (error)"));
  assert.doesNotMatch(
    catchBlock,
    /serialMallTitleResumeDispatchingRef\.current = false/,
  );
  assert.doesNotMatch(catchBlock, /setManualApplyPolling\(false\)/);
  assert.doesNotMatch(catchBlock, /setManualApplyNextCheckIn\(0\)/);
});

test("only terminal results or the regular-request poll cap stop polling", () => {
  const pollingBlock = between(
    "useEffect(() => {\n    if (!manualApplyPolling) return;\n    if (",
    "\n\n  const applyManualCandidates = useCallback",
  );
  assert.match(
    resultBlock,
    /isFinalManualApplyResult\(data\)[\s\S]*setManualApplyPolling\(false\)/,
  );
  assert.match(
    pollingBlock,
    /next >= ACTIVE_MAX_POLLS &&[\s\S]*!serialMallTitleResumeRequestId &&[\s\S]*!manualTitleRemainingRequestId[\s\S]*setManualApplyPolling\(false\)/,
  );
  assert.equal(
    (resultBlock.match(/setManualApplyPolling\(false\)/g) ?? []).length,
    1,
    "result fetching stops only for a terminal artifact",
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

test("handled resume price repair identity survives reload", () => {
  assert.match(source, /handledResumePriceRepairRequestId\?: string/);
  assert.match(
    source,
    /useState\(restoredSession\?\.handledResumePriceRepairRequestId \?\? ""\)/,
  );
  assert.match(
    resultBlock,
    /handledResumePriceRepairRequestIdRef\.current !== requestId[\s\S]*handledResumePriceRepairRequestIdRef\.current = requestId[\s\S]*setHandledResumePriceRepairRequestId\(requestId\)[\s\S]*setFinalPriceRequestId\(""\)/,
  );
  assert.match(source, /handledResumePriceRepairRequestId,\n\s+finalPriceRequestId/);
  assert.match(
    source,
    /const handledResumePriceRepairRequestIdRef = useRef\(\n\s+restoredSession\?\.handledResumePriceRepairRequestId \?\? ""/,
  );
});

test("a fresh upload drops every prior manual apply and resume identity", () => {
  for (const reset of [
    'setManualApplyRequestId("")',
    "setManualApplyResult(null)",
    "setManualApplyPolling(false)",
    "setManualApplyPollCount(0)",
    "setManualApplyLastCheckedAt(null)",
    "setManualApplyNextCheckIn(0)",
    'setManualApplyActionsUrl("")',
    'setManualApplyRunUrl("")',
    'setManualApplyCommandPreview("")',
    'setManualApplyErrorMessage("")',
    'setSerialMallTitleResumeRequestId("")',
    'setHandledResumePriceRepairRequestId("")',
    'activeManualApplyRequestIdRef.current = ""',
    'handledResumePriceRepairRequestIdRef.current = ""',
  ]) assert.equal(uploadBlock.includes(reset), true, `missing ${reset}`);
  assert.doesNotMatch(
    source,
    /keywordApplyState\?\.realApplyRequestId \|\|\n\s+restoredSession\?\.keywordRealApplyRequestId/,
  );
  assert.doesNotMatch(source, /restoredRealApplyRequestId/);
});

test("a regular apply clears stale manual and resume state before dispatch", () => {
  const dispatchIndex = applyBlock.indexOf(
    'fetch("/api/keyword-shopling-apply/run"',
  );
  assert.notEqual(dispatchIndex, -1);
  const beforeDispatch = applyBlock.slice(0, dispatchIndex);
  for (const reset of [
    'activeManualApplyRequestIdRef.current = ""',
    'setManualApplyRequestId("")',
    "setManualApplyResult(null)",
    "setManualApplyPolling(false)",
    'setSerialMallTitleResumeRequestId("")',
    'setHandledResumePriceRepairRequestId("")',
    'handledResumePriceRepairRequestIdRef.current = ""',
    "setKeywordApplyState(null)",
  ]) assert.equal(beforeDispatch.includes(reset), true, `missing ${reset}`);
  const afterDispatch = applyBlock.slice(dispatchIndex);
  assert.match(
    afterDispatch,
    /const requestId = String\(json\.requestId \|\| ""\)[\s\S]*setKeywordApplyState\(\{[\s\S]*realApplyRequestId: requestId/,
  );
});

test("a fresh start clears the active manual apply identity", () => {
  const clearBlock = between(
    "const clearProductLaunchFailureState =",
    "\n  const resetProductLaunchSession =",
  );
  assert.match(clearBlock, /activeManualApplyRequestIdRef\.current = ""/);
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
