"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createReviewedRows,
  type KeywordReviewRow,
} from "@/lib/keywordReviewQueue";
import {
  buildKeywordShoplingPayloadPreview,
  type KeywordPayloadPreviewResult,
} from "@/lib/keywordReviewPayloadPreview";
import {
  buildCompactKeywordApplyExecutionPlan,
  buildKeywordExecutionPreflight,
  DEFAULT_KEYWORD_EXECUTION_PREFLIGHT_CONFIG,
  formatKeywordExecutionPreflightLabels,
  type KeywordExecutionPreflightResult,
} from "@/lib/keywordReviewExecutionPreflight";
import { buildManualMallPreviewRows } from "@/lib/manualMallPreviewRows";
import {
  buildGoodsKeyGroupJson,
  buildGoodsKeyGroupMap,
  buildGoodsKeyProductGroupMap,
  dedupeGoodsKeysForPriceModify,
  expectedLaunchApplyCount,
  expectedPriceModifyUpdateCount,
  extractRowsWithGoodsKey,
  normalizeManualKeywordOverride,
  resolveManualTitleOverride,
} from "@/lib/productLaunchFlow";
import {
  clearProductLaunchSimpleSession,
  isSuccessfulSimpleUploadResult,
  readProductLaunchSimpleSession,
  writeProductLaunchSimpleSession,
  type ProductLaunchSimpleRunResult,
} from "@/lib/productLaunchSimpleSession";

const POLL_MS = 5_000;
const MAX_POLLS = 60;
const DIRECT_CONFIRMATION = "APPLY_REVIEWED_TITLES_AND_SEARCH_TO_SHOPLING";

type RunResult = ProductLaunchSimpleRunResult;
type UploadResult = RunResult;
type PriceResult = RunResult;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function status(value: unknown) {
  return text(value).toLocaleLowerCase().replace(/[\s-]+/g, "_");
}

function rawKeywords(value: string) {
  const seen = new Set<string>();
  return String(value ?? "")
    .split(/[,\n;|/]+|\s{2,}/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function runTerminal(result: RunResult | null) {
  if (!result) return false;
  const phase = status(result.phase);
  const currentStatus = status(result.status);
  return (
    ["artifact_ready", "failed", "completed_no_artifact"].includes(phase) ||
    ["error", "failed", "partial_failure", "blocked"].includes(currentStatus)
  );
}

function priceDone(result: PriceResult | null, goodsKeyCount: number) {
  if (!result || goodsKeyCount < 1) return false;
  const summary = result.summary ?? {};
  return (
    status(summary.status || result.status) === "success" &&
    number(summary.fail_count ?? summary.failed_count ?? summary.failure_count) === 0 &&
    number(summary.goods_key_count || goodsKeyCount) >= goodsKeyCount
  );
}

function applyDone(result: RunResult | null) {
  const summary = result?.summary ?? {};
  return (
    result?.phase === "artifact_ready" &&
    status(summary.status) === "success" &&
    summary.direct_apply_completed === true &&
    number(summary.failed_item_count) === 0 &&
    summary.price_repair_required === false &&
    summary.requires_final_price_pass === false
  );
}

export function ProductLaunchFlowSimple() {
  const [hydrated, setHydrated] = useState(false);
  const [rowExpression, setRowExpression] = useState("");
  const [uploadRequestId, setUploadRequestId] = useState("");
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadPolls, setUploadPolls] = useState(0);
  const [priceRequestId, setPriceRequestId] = useState("");
  const [priceResult, setPriceResult] = useState<PriceResult | null>(null);
  const [priceBusy, setPriceBusy] = useState(false);
  const [pricePolls, setPricePolls] = useState(0);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [searches, setSearches] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<KeywordPayloadPreviewResult | null>(null);
  const [preflight, setPreflight] =
    useState<KeywordExecutionPreflightResult | null>(null);
  const [directRequestId, setDirectRequestId] = useState("");
  const [directResult, setDirectResult] = useState<RunResult | null>(null);
  const [directBusy, setDirectBusy] = useState(false);
  const [directPolls, setDirectPolls] = useState(0);
  const [message, setMessage] = useState("");
  const priceStartedForUpload = useRef("");
  const operationEpoch = useRef(0);

  const uploadRows = useMemo(
    () => extractRowsWithGoodsKey(uploadResult),
    [uploadResult],
  );
  const goodsKeys = useMemo(
    () => dedupeGoodsKeysForPriceModify(uploadRows),
    [uploadRows],
  );
  const groupMap = useMemo(
    () => buildGoodsKeyGroupMap(uploadRows),
    [uploadRows],
  );
  const productGroups = useMemo(
    () => buildGoodsKeyProductGroupMap(uploadRows),
    [uploadRows],
  );
  const expectedPriceRows = expectedPriceModifyUpdateCount(productGroups);
  const expectedTitleRows = expectedLaunchApplyCount(goodsKeys, groupMap);
  const isUploadDone = isSuccessfulSimpleUploadResult(uploadResult);
  const isUploadTerminal = runTerminal(uploadResult);
  const isPriceDone = priceDone(priceResult, goodsKeys.length);
  const isPriceTerminal = runTerminal(priceResult);
  const isDirectTerminal = runTerminal(directResult);
  const isComplete = applyDone(directResult);
  const uploadActive =
    Boolean(uploadRequestId) && !isUploadTerminal && uploadPolls < MAX_POLLS;
  const priceActive =
    Boolean(priceRequestId) && !isPriceTerminal && pricePolls < MAX_POLLS;
  const directActive =
    Boolean(directRequestId) && !isDirectTerminal && directPolls < MAX_POLLS;
  const resetDisabled =
    !hydrated ||
    uploadBusy ||
    priceBusy ||
    directBusy ||
    uploadActive ||
    priceActive ||
    directActive;
  const candidatesReady =
    goodsKeys.length > 0 &&
    goodsKeys.every((goodsKey) => {
      const finalTitle = resolveManualTitleOverride(titles[goodsKey], goodsKey);
      return (
        finalTitle !== "" &&
        new TextEncoder().encode(finalTitle).length <= 100 &&
        rawKeywords(searches[goodsKey] ?? "").length === 10
      );
    });

  const clearState = useCallback((nextRowExpression = "") => {
    setRowExpression(nextRowExpression);
    setUploadRequestId("");
    setUploadResult(null);
    setUploadBusy(false);
    setUploadPolls(0);
    setPriceRequestId("");
    setPriceResult(null);
    setPriceBusy(false);
    setPricePolls(0);
    setTitles({});
    setSearches({});
    setPreview(null);
    setPreflight(null);
    setDirectRequestId("");
    setDirectResult(null);
    setDirectBusy(false);
    setDirectPolls(0);
    setMessage("");
    priceStartedForUpload.current = "";
  }, []);

  const reset = useCallback(() => {
    if (resetDisabled) return;
    operationEpoch.current += 1;
    clearProductLaunchSimpleSession(window.localStorage);
    clearState();
  }, [clearState, resetDisabled]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const restored = readProductLaunchSimpleSession(window.localStorage);
      if (cancelled) return;
      if (restored) {
        setRowExpression(restored.rowExpression);
        setUploadRequestId(restored.uploadRequestId);
        setUploadResult(restored.uploadResult);
        setUploadPolls(restored.uploadPolls);
        setPriceRequestId(restored.priceRequestId);
        setPriceResult(restored.priceResult);
        setPricePolls(restored.pricePolls);
        setTitles(restored.titles);
        setSearches(restored.searches);
        setDirectRequestId(restored.directRequestId);
        setDirectResult(restored.directResult);
        setDirectPolls(restored.directPolls);
        if (restored.priceRequestId || restored.priceResult) {
          priceStartedForUpload.current = restored.uploadRequestId;
        }
      }
      setHydrated(true);
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      writeProductLaunchSimpleSession(window.localStorage, {
        version: 1,
        rowExpression,
        uploadRequestId,
        uploadResult,
        uploadPolls,
        priceRequestId,
        priceResult,
        pricePolls,
        titles,
        searches,
        directRequestId,
        directResult,
        directPolls,
        updatedAt: new Date().toISOString(),
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    directPolls,
    directRequestId,
    directResult,
    hydrated,
    pricePolls,
    priceRequestId,
    priceResult,
    rowExpression,
    searches,
    titles,
    uploadPolls,
    uploadRequestId,
    uploadResult,
  ]);

  const reviewedRows = useCallback(() => {
    const rows: KeywordReviewRow[] = uploadRows.map((uploadRow, index) => {
      const goodsKey = text(uploadRow.goods_key);
      return {
        goodsKey,
        mallKey: "",
        originalTitle: text(
          uploadRow.title ??
            uploadRow.product_name ??
            uploadRow.productTitle ??
            uploadRow.upload_title ??
            uploadRow.registered_title ??
            uploadRow.final_title,
        ),
        recommendedTitle: resolveManualTitleOverride(titles[goodsKey], goodsKey),
        originalSiteSrch: "",
        recommendedSiteSrch: normalizeManualKeywordOverride(searches[goodsKey]),
        siteSrchKeywordCount: null,
        verifiedKeywordCount: null,
        qualityStatus: "manual",
        confidenceStatus: "manual",
        blockReason: "",
        warningFlags: "",
        reviewReason: "simple direct product launch",
        payloadStatus: "",
        approvalStatus: "approved",
        manualCandidateKeywords: normalizeManualKeywordOverride(searches[goodsKey]),
        sourceRowIndex: index + 2,
        raw: {},
        classification: "auto_apply_candidate",
      };
    });
    return createReviewedRows(rows, groupMap).map((row) => ({
      ...row,
      reviewStatus: "approved" as const,
    }));
  }, [groupMap, searches, titles, uploadRows]);

  const currentPreflight = useCallback(() => {
    const nextPreview = buildKeywordShoplingPayloadPreview(reviewedRows(), {
      expandProductGroupMarkets: true,
      manualTitleOverridesByGoodsKey: titles,
      manualKeywordOverridesByGoodsKey: searches,
      seedKeywordsByGoodsKey: {},
    });
    const nextPreflight = buildKeywordExecutionPreflight(
      { previewResult: nextPreview, finalConfirmationText: "" },
      {
        ...DEFAULT_KEYWORD_EXECUTION_PREFLIGHT_CONFIG,
        maxRows: 100,
        confirmationText: DIRECT_CONFIRMATION,
      },
    );
    setPreview(nextPreview);
    setPreflight(nextPreflight);
    return nextPreflight;
  }, [reviewedRows, searches, titles]);

  const preflightPasses = useCallback(
    (result: KeywordExecutionPreflightResult) => {
      const summary = result.summary;
      return (
        candidatesReady &&
        summary.blockedCount === 0 &&
        summary.coverageMismatchGoodsKeyCount === 0 &&
        summary.generatedTitleTargetCount === summary.expectedTitleTargetCount &&
        summary.eligibleCount === summary.expectedTitleTargetCount &&
        summary.eligibleCount >= 1 &&
        summary.eligibleCount <= 100
      );
    },
    [candidatesReady],
  );

  const startUpload = useCallback(async () => {
    const rows = rowExpression.trim();
    if (!hydrated || !rows || resetDisabled) return;
    const epoch = operationEpoch.current + 1;
    operationEpoch.current = epoch;
    clearProductLaunchSimpleSession(window.localStorage);
    clearState(rows);
    setUploadBusy(true);
    try {
      const response = await fetch("/api/shopling-product-upload/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rowExpression: rows,
          channel: "",
          skip_if_goods_key: true,
          dump: false,
          sleep: "1.2",
        }),
      });
      const data = (await response.json()) as RunResult;
      if (operationEpoch.current !== epoch) return;
      const requestId = text(data.requestId);
      if (!response.ok || !requestId)
        throw new Error(data.message || "상품업로드를 시작하지 못했습니다.");
      setUploadRequestId(requestId);
      setUploadResult({
        ...data,
        status: "pending",
        phase: data.phase || "queued",
      });
    } catch (error) {
      if (operationEpoch.current === epoch) {
        setMessage(error instanceof Error ? error.message : "상품업로드 요청 오류");
      }
    } finally {
      if (operationEpoch.current === epoch) setUploadBusy(false);
    }
  }, [clearState, hydrated, resetDisabled, rowExpression]);

  const pollUpload = useCallback(async () => {
    if (!uploadRequestId || uploadBusy) return;
    const epoch = operationEpoch.current;
    setUploadBusy(true);
    try {
      const response = await fetch(
        `/api/shopling-product-upload/actions-result?request_id=${encodeURIComponent(uploadRequestId)}`,
      );
      const data = (await response.json()) as UploadResult;
      if (operationEpoch.current !== epoch) return;
      setUploadResult(data);
      setUploadPolls((count) => count + 1);
    } catch (error) {
      if (operationEpoch.current === epoch) {
        setMessage(error instanceof Error ? error.message : "상품업로드 결과 확인 오류");
      }
    } finally {
      if (operationEpoch.current === epoch) setUploadBusy(false);
    }
  }, [uploadBusy, uploadRequestId]);

  useEffect(() => {
    if (!hydrated || !uploadRequestId || isUploadTerminal) return;
    if (uploadPolls >= MAX_POLLS) return;
    const timer = window.setTimeout(() => void pollUpload(), POLL_MS);
    return () => window.clearTimeout(timer);
  }, [hydrated, isUploadTerminal, pollUpload, uploadPolls, uploadRequestId]);

  const startPrice = useCallback(async () => {
    if (!hydrated || !isUploadDone || !goodsKeys.length || priceBusy) return;
    const epoch = operationEpoch.current;
    setPriceBusy(true);
    try {
      const response = await fetch("/api/shopling-price-modify/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goods_key: goodsKeys.join(","),
          goods_key_group_json: buildGoodsKeyGroupJson(uploadRows),
          policy_overrides: [],
        }),
      });
      const data = (await response.json()) as RunResult;
      if (operationEpoch.current !== epoch) return;
      const requestId = text(data.requestId);
      if (!response.ok || !requestId)
        throw new Error(data.message || "가격설정을 시작하지 못했습니다.");
      setPriceRequestId(requestId);
      setPriceResult({
        ...data,
        status: "pending",
        phase: data.phase || "queued",
      });
      setPricePolls(0);
    } catch (error) {
      if (operationEpoch.current === epoch) {
        setMessage(error instanceof Error ? error.message : "가격설정 요청 오류");
      }
    } finally {
      if (operationEpoch.current === epoch) setPriceBusy(false);
    }
  }, [goodsKeys, hydrated, isUploadDone, priceBusy, uploadRows]);

  useEffect(() => {
    if (!hydrated || !isUploadDone || !goodsKeys.length) return;
    if (priceRequestId || priceResult || priceBusy) return;
    if (priceStartedForUpload.current === uploadRequestId) return;
    priceStartedForUpload.current = uploadRequestId;
    const timer = window.setTimeout(() => void startPrice(), 0);
    return () => window.clearTimeout(timer);
  }, [
    goodsKeys.length,
    hydrated,
    isUploadDone,
    priceBusy,
    priceRequestId,
    priceResult,
    startPrice,
    uploadRequestId,
  ]);

  const pollPrice = useCallback(async () => {
    if (!priceRequestId || priceBusy) return;
    const epoch = operationEpoch.current;
    setPriceBusy(true);
    try {
      const response = await fetch(
        `/api/shopling-price-modify/actions-result?request_id=${encodeURIComponent(priceRequestId)}`,
      );
      const data = (await response.json()) as PriceResult;
      if (operationEpoch.current !== epoch) return;
      setPriceResult(data);
      setPricePolls((count) => count + 1);
    } catch (error) {
      if (operationEpoch.current === epoch) {
        setMessage(error instanceof Error ? error.message : "가격설정 결과 확인 오류");
      }
    } finally {
      if (operationEpoch.current === epoch) setPriceBusy(false);
    }
  }, [priceBusy, priceRequestId]);

  useEffect(() => {
    if (!hydrated || !priceRequestId || isPriceTerminal) return;
    if (pricePolls >= MAX_POLLS) return;
    const timer = window.setTimeout(() => void pollPrice(), POLL_MS);
    return () => window.clearTimeout(timer);
  }, [hydrated, isPriceTerminal, pollPrice, pricePolls, priceRequestId]);

  const makePreview = useCallback(() => {
    setMessage("");
    if (!candidatesReady) {
      setMessage(
        "모든 상품의 상품명 후보를 100bytes 이하로, 검색어를 정확히 10개 입력하세요.",
      );
      return;
    }
    const result = currentPreflight();
    setMessage(
      preflightPasses(result)
        ? "반영 준비가 완료됐습니다. 대상 수를 확인한 뒤 실제 반영을 시작하세요."
        : "사전점검에서 차단된 항목이 있습니다. 아래 미리보기를 확인하세요.",
    );
  }, [candidatesReady, currentPreflight, preflightPasses]);

  const startDirectApply = useCallback(async () => {
    if (!hydrated || directBusy || directRequestId || !isPriceDone) return;
    const result = currentPreflight();
    if (!preflightPasses(result)) {
      setMessage("현재 입력값은 실제 반영 조건을 통과하지 못했습니다.");
      return;
    }
    const epoch = operationEpoch.current;
    setDirectBusy(true);
    try {
      const response = await fetch("/api/keyword-shopling-direct-apply/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          execution_plan_json: buildCompactKeywordApplyExecutionPlan(result),
          confirmation_text: DIRECT_CONFIRMATION,
          max_items: 100,
        }),
      });
      const data = (await response.json()) as RunResult;
      if (operationEpoch.current !== epoch) return;
      const requestId = text(data.requestId);
      if (!response.ok || !requestId)
        throw new Error(data.message || "상품명·검색어 반영을 시작하지 못했습니다.");
      setDirectRequestId(requestId);
      setDirectResult({
        ...data,
        status: "pending",
        phase: data.phase || "queued",
      });
      setDirectPolls(0);
    } catch (error) {
      if (operationEpoch.current === epoch) {
        setMessage(error instanceof Error ? error.message : "상품명·검색어 반영 요청 오류");
      }
    } finally {
      if (operationEpoch.current === epoch) setDirectBusy(false);
    }
  }, [
    currentPreflight,
    directBusy,
    directRequestId,
    hydrated,
    isPriceDone,
    preflightPasses,
  ]);

  const pollDirect = useCallback(async () => {
    if (!directRequestId || directBusy) return;
    const epoch = operationEpoch.current;
    setDirectBusy(true);
    try {
      const response = await fetch(
        `/api/keyword-shopling-direct-apply/actions-result?request_id=${encodeURIComponent(directRequestId)}`,
      );
      const data = (await response.json()) as RunResult;
      if (operationEpoch.current !== epoch) return;
      setDirectResult(data);
      setDirectPolls((count) => count + 1);
    } catch (error) {
      if (operationEpoch.current === epoch) {
        setMessage(error instanceof Error ? error.message : "상품명·검색어 결과 확인 오류");
      }
    } finally {
      if (operationEpoch.current === epoch) setDirectBusy(false);
    }
  }, [directBusy, directRequestId]);

  useEffect(() => {
    if (!hydrated || !directRequestId || isDirectTerminal) return;
    if (directPolls >= MAX_POLLS) return;
    const timer = window.setTimeout(() => void pollDirect(), POLL_MS);
    return () => window.clearTimeout(timer);
  }, [directPolls, directRequestId, hydrated, isDirectTerminal, pollDirect]);

  const displayRows = useMemo(
    () =>
      buildManualMallPreviewRows({
        previewResult: preview,
        preflightResult: preflight,
        applyResults: directResult?.applyResults ?? [],
        verifyResults: [],
      }),
    [directResult?.applyResults, preflight, preview],
  );
  const directSummary = directResult?.summary ?? {};
  const uploadFailed = isUploadTerminal && !isUploadDone;
  const priceFailed = isPriceTerminal && !isPriceDone;

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-emerald-800">정상 상품출시 경로</p>
            <h2 className="mt-1 text-2xl font-black text-slate-950">
              {isComplete ? "출시 준비 완료" : "상품 출시 진행 중"}
            </h2>
            <p className="mt-2 text-sm text-slate-700">
              상품업로드 → 가격설정 → 검색어 검증 → 쇼핑몰별 상품명 반영 순서입니다. 마켓 전송은 자동으로 실행하지 않습니다.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={reset}
              disabled={resetDisabled}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-300"
            >
              새 작업
            </button>
            <Link
              href="/product-launch-flow/legacy"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-500"
            >
              개발자용 이전 화면
            </Link>
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-5">
          <StatusBox
            label="상품업로드"
            value={
              isUploadDone
                ? "완료"
                : uploadFailed
                  ? "실패"
                  : uploadRequestId
                    ? "진행 중"
                    : "대기"
            }
          />
          <StatusBox
            label="가격설정"
            value={
              isPriceDone
                ? "완료"
                : priceFailed
                  ? "실패"
                  : priceRequestId
                    ? "진행 중"
                    : "대기"
            }
          />
          <StatusBox label="상품 수" value={goodsKeys.length} />
          <StatusBox label="가격 대상" value={expectedPriceRows} />
          <StatusBox label="상품명 대상" value={expectedTitleRows} />
        </div>
      </section>

      {!hydrated ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm font-bold text-slate-600">
          이전 작업 상태를 복구하고 있습니다.
        </p>
      ) : null}
      {uploadFailed ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
          상품업로드 전체가 성공하지 않아 가격설정과 상품명 반영을 시작하지 않았습니다. 결과를 확인한 뒤 새 작업으로 다시 시작하세요.
        </p>
      ) : null}
      {priceFailed ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
          가격설정이 완료되지 않아 상품명·검색어 반영을 시작하지 않았습니다.
        </p>
      ) : null}
      {message ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
          {message}
        </p>
      ) : null}

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-black">1. 상품 선택</h2>
        <p className="mt-1 text-sm text-slate-600">
          실재고 시트 행번호를 입력하면 상품업로드와 가격설정까지 자동으로 진행합니다.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <input
            value={rowExpression}
            onChange={(event) => setRowExpression(event.target.value)}
            disabled={!hydrated || Boolean(uploadRequestId) || uploadBusy}
            placeholder="예: 950 또는 950-955"
            className="min-w-[260px] flex-1 rounded-xl border border-slate-300 px-4 py-3"
          />
          <button
            type="button"
            onClick={() => void startUpload()}
            disabled={
              !hydrated ||
              !rowExpression.trim() ||
              uploadBusy ||
              uploadActive ||
              priceActive ||
              directActive ||
              Boolean(uploadRequestId)
            }
            className="rounded-xl bg-slate-950 px-5 py-3 font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {uploadBusy ? "확인 중" : "상품출시 시작"}
          </button>
        </div>
        <RequestLine label="상품업로드 request_id" value={uploadRequestId} />
        <RequestLine label="가격설정 request_id" value={priceRequestId} />
        {isUploadDone && !priceRequestId && !priceBusy ? (
          <button
            type="button"
            onClick={() => void startPrice()}
            className="mt-3 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold"
          >
            가격설정 다시 시작
          </button>
        ) : null}
      </section>

      {isPriceDone ? (
        <section className="rounded-3xl border border-blue-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-black">2. 상품명·검색어 후보 입력</h2>
          <p className="mt-1 text-sm text-slate-600">
            상품명 후보와 검색어 10개를 입력하세요. 상품그룹에 연결된 쇼핑몰은 자동 선택됩니다.
          </p>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-[1000px] w-full text-sm">
              <thead className="bg-slate-100 text-left">
                <tr>
                  <th className="px-3 py-3">goods_key</th>
                  <th className="px-3 py-3">상품그룹</th>
                  <th className="px-3 py-3">상품명 후보</th>
                  <th className="px-3 py-3">검색어 후보 10개</th>
                  <th className="px-3 py-3">상태</th>
                </tr>
              </thead>
              <tbody>
                {goodsKeys.map((goodsKey) => {
                  const count = rawKeywords(searches[goodsKey] ?? "").length;
                  const finalTitle = resolveManualTitleOverride(titles[goodsKey], goodsKey);
                  const titleBytes = new TextEncoder().encode(finalTitle).length;
                  const ready = finalTitle !== "" && titleBytes <= 100 && count === 10;
                  return (
                    <tr key={goodsKey} className="border-t border-slate-200 align-top">
                      <td className="px-3 py-3 font-mono font-bold">{goodsKey}</td>
                      <td className="px-3 py-3">{productGroups[goodsKey] || "-"}</td>
                      <td className="px-3 py-3">
                        <input
                          value={titles[goodsKey] ?? ""}
                          onChange={(event) => {
                            setTitles((current) => ({
                              ...current,
                              [goodsKey]: event.target.value,
                            }));
                            setPreview(null);
                            setPreflight(null);
                          }}
                          placeholder="쉼표로 상품명 후보 입력"
                          className="w-full rounded-lg border border-slate-300 px-3 py-2"
                        />
                        <p className={titleBytes > 100 ? "mt-1 text-red-700" : "mt-1 text-slate-500"}>
                          {titleBytes}/100bytes
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <textarea
                          value={searches[goodsKey] ?? ""}
                          onChange={(event) => {
                            setSearches((current) => ({
                              ...current,
                              [goodsKey]: event.target.value,
                            }));
                            setPreview(null);
                            setPreflight(null);
                          }}
                          placeholder="검색어 10개를 쉼표로 구분"
                          rows={2}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2"
                        />
                        <p className={count === 10 ? "mt-1 text-emerald-700" : "mt-1 text-red-700"}>
                          {count}/10개
                        </p>
                      </td>
                      <td className="px-3 py-3 font-bold">
                        {ready ? "준비 완료" : "입력 필요"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={makePreview}
              disabled={!candidatesReady || directBusy || Boolean(directRequestId)}
              className="rounded-xl border border-blue-600 px-5 py-3 font-black text-blue-700 disabled:border-slate-300 disabled:text-slate-300"
            >
              반영 내용 확인
            </button>
            <button
              type="button"
              onClick={() => void startDirectApply()}
              disabled={
                !preflight ||
                preflight.summary.blockedCount > 0 ||
                directBusy ||
                Boolean(directRequestId)
              }
              className="rounded-xl bg-blue-700 px-5 py-3 font-black text-white disabled:bg-slate-300"
            >
              {directBusy ? "확인 중" : "상품명·검색어 실제 반영 시작"}
            </button>
          </div>
        </section>
      ) : null}

      {preflight ? (
        <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
          <h2 className="text-lg font-black">3. 전체 쇼핑몰 적용 미리보기</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-5">
            <StatusBox label="전체" value={preflight.summary.totalPreviewItems} />
            <StatusBox label="반영 가능" value={preflight.summary.eligibleCount} />
            <StatusBox label="차단" value={preflight.summary.blockedCount} />
            <StatusBox label="예상 상품명" value={preflight.summary.expectedTitleTargetCount} />
            <StatusBox label="검색어 goods_key" value={preflight.summary.siteSrchGoodsKeyCount} />
          </div>
          <div className="mt-4 max-h-[520px] overflow-auto rounded-2xl border border-emerald-200 bg-white">
            <table className="min-w-[1200px] w-full text-xs">
              <thead className="sticky top-0 bg-emerald-100 text-left">
                <tr>
                  <th className="px-3 py-2">goods_key</th>
                  <th className="px-3 py-2">상품그룹</th>
                  <th className="px-3 py-2">쇼핑몰</th>
                  <th className="px-3 py-2">mall_key</th>
                  <th className="px-3 py-2">생성 상품명</th>
                  <th className="px-3 py-2">검색어</th>
                  <th className="px-3 py-2">상태</th>
                  <th className="px-3 py-2">차단 사유</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.rows.map((row, index) => (
                  <tr
                    key={`${row.goodsKey}:${row.mallKey}:${index}`}
                    className="border-t border-slate-200"
                  >
                    <td className="px-3 py-2 font-mono">{row.goodsKey}</td>
                    <td className="px-3 py-2">{row.productGroup}</td>
                    <td className="px-3 py-2">{row.marketName}</td>
                    <td className="px-3 py-2 font-mono">{row.mallKey}</td>
                    <td className="px-3 py-2 font-semibold">{row.finalTitle}</td>
                    <td className="px-3 py-2">{row.finalSiteSrch}</td>
                    <td className="px-3 py-2">
                      {row.preflightStatus === "eligible" ? "반영 가능" : "차단"}
                    </td>
                    <td className="px-3 py-2">
                      {formatKeywordExecutionPreflightLabels(row.blockingReasons) || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {directRequestId || directResult ? (
        <section className="rounded-3xl border border-indigo-200 bg-indigo-50 p-6 shadow-sm">
          <h2 className="text-lg font-black">4. 상품명·검색어 반영 결과</h2>
          <RequestLine label="request_id" value={directRequestId} />
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <StatusBox
              label="현재 상태"
              value={isComplete ? "출시 완료" : directResult?.message || "진행 중"}
            />
            <StatusBox
              label="검색어 성공"
              value={number(directSummary.search_apply_success_count)}
            />
            <StatusBox
              label="상품명 성공"
              value={number(directSummary.title_apply_success_count)}
            />
            <StatusBox label="실패" value={number(directSummary.failed_item_count)} />
          </div>
          {directResult?.runUrl || directResult?.githubActionsUrl ? (
            <a
              href={directResult.runUrl || directResult.githubActionsUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-block rounded-xl border border-indigo-300 bg-white px-4 py-2 text-sm font-bold text-indigo-700"
            >
              GitHub Actions 결과 보기
            </a>
          ) : null}
          {isComplete ? (
            <p className="mt-4 rounded-2xl border border-emerald-300 bg-white p-4 font-black text-emerald-800">
              상품업로드·가격·검색어·쇼핑몰별 상품명 반영이 완료됐습니다. 샵플링에서 마켓 전송은 직접 진행하세요.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function StatusBox({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-2xl border border-white/70 bg-white p-4 shadow-sm">
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className="mt-1 font-black text-slate-950">{String(value ?? "-")}</p>
    </div>
  );
}

function RequestLine({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <p className="mt-3 text-xs text-slate-500">
      {label}: <span className="font-mono text-slate-700">{value}</span>
    </p>
  );
}
