"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  canonicalPricePolicyResultMessage,
  extractCanonicalPriceTargetsFromUploadResult,
  isCanonicalPricePolicyResultSuccess,
  isCanonicalPricePolicyResultTerminalFailure,
  SHOPLING_CANONICAL_PRICE_POLICY_VERSION,
} from "@/lib/shoplingCanonicalPricePolicy";

const UPLOAD_REQUEST_ID_STORAGE_KEY = "shoplingProductUpload.currentRequestId";
const PRICE_PLAN_STORAGE_PREFIX = "shoplingProductUpload.canonicalPricePlan";
const AUTOMATION_CUTOFF = Date.parse("2026-08-03T08:20:00.000Z");
const MAX_GOODS_KEYS_PER_REQUEST = 50;
const POLL_MS = 5_000;

type BridgeStatus = "idle" | "waiting" | "running" | "success" | "blocked" | "error";
type ChunkStatus = "pending" | "success" | "failed";

type StoredChunk = {
  goodsKeys: string[];
  groupMap: Record<string, string>;
  requestId: string;
  status: ChunkStatus;
  message: string;
};

type StoredPlan = {
  version: 1;
  policyVersion: string;
  uploadRequestId: string;
  goodsKeys: string[];
  chunks: StoredChunk[];
};

type BridgeState = {
  status: BridgeStatus;
  message: string;
  uploadRequestId?: string;
  priceRequestId?: string;
  goodsKeyCount?: number;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pricePlanStorageKey(uploadRequestId: string) {
  return `${PRICE_PLAN_STORAGE_PREFIX}.${uploadRequestId}`;
}

function parseUploadRequestTime(requestId: string) {
  const match = requestId.match(
    /^shopling-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-/i,
  );
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const timestamp = Date.parse(
    `${year}-${month}-${day}T${hour}:${minute}:${second}Z`,
  );
  return Number.isFinite(timestamp) ? timestamp : null;
}

function readStoredPlan(uploadRequestId: string): StoredPlan | null {
  try {
    const raw = window.localStorage.getItem(pricePlanStorageKey(uploadRequestId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPlan;
    if (
      parsed?.version !== 1 ||
      parsed.uploadRequestId !== uploadRequestId ||
      !Array.isArray(parsed.goodsKeys) ||
      !Array.isArray(parsed.chunks)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredPlan(plan: StoredPlan) {
  window.localStorage.setItem(
    pricePlanStorageKey(plan.uploadRequestId),
    JSON.stringify(plan),
  );
}

function buildStoredPlan(
  uploadRequestId: string,
  goodsKeys: string[],
  groupMap: Record<string, string>,
): StoredPlan {
  const chunks: StoredChunk[] = [];
  for (let index = 0; index < goodsKeys.length; index += MAX_GOODS_KEYS_PER_REQUEST) {
    const chunkGoodsKeys = goodsKeys.slice(index, index + MAX_GOODS_KEYS_PER_REQUEST);
    chunks.push({
      goodsKeys: chunkGoodsKeys,
      groupMap: Object.fromEntries(
        chunkGoodsKeys.map((goodsKey) => [goodsKey, groupMap[goodsKey]]),
      ),
      requestId: "",
      status: "pending",
      message: "",
    });
  }
  return {
    version: 1,
    policyVersion: SHOPLING_CANONICAL_PRICE_POLICY_VERSION,
    uploadRequestId,
    goodsKeys,
    chunks,
  };
}

function planMatchesGoodsKeys(plan: StoredPlan, goodsKeys: string[]) {
  return JSON.stringify(plan.goodsKeys) === JSON.stringify(goodsKeys);
}

export function ShoplingProductUploadCanonicalPriceBridge() {
  const [state, setState] = useState<BridgeState>({
    status: "idle",
    message: "상품등록 완료 후 중앙 가격정책 엔진이 자동으로 이어집니다.",
  });
  const busy = useRef(false);

  const inspect = useCallback(async () => {
    if (busy.current) return;
    const uploadRequestId = window.localStorage
      .getItem(UPLOAD_REQUEST_ID_STORAGE_KEY)
      ?.trim();
    if (!uploadRequestId) {
      setState({
        status: "idle",
        message: "상품등록 실행을 시작하면 중앙 가격정책 엔진이 자동으로 이어집니다.",
      });
      return;
    }
    const requestTime = parseUploadRequestTime(uploadRequestId);
    if (requestTime !== null && requestTime < AUTOMATION_CUTOFF) {
      setState({
        status: "idle",
        message: "기존 상품등록 기록은 자동 보정하지 않습니다. 새 상품등록부터 중앙 가격정책이 적용됩니다.",
        uploadRequestId,
      });
      return;
    }

    busy.current = true;
    try {
      const uploadResponse = await fetch(
        `/api/shopling-product-upload/actions-result?request_id=${encodeURIComponent(uploadRequestId)}`,
        { cache: "no-store" },
      );
      const uploadResult = await uploadResponse.json();
      if (!uploadResponse.ok || uploadResult.status === "error") {
        setState({
          status: "error",
          message:
            uploadResult.message || "상품등록 결과를 확인하지 못했습니다.",
          uploadRequestId,
        });
        return;
      }
      if (
        uploadResult.status !== "success" ||
        uploadResult.phase !== "artifact_ready"
      ) {
        setState({
          status: "waiting",
          message: "상품등록 완료를 확인하는 중입니다. 완료되면 가격정책이 자동 실행됩니다.",
          uploadRequestId,
        });
        return;
      }

      const summary = record(uploadResult.summary);
      const targets = extractCanonicalPriceTargetsFromUploadResult(uploadResult);
      const reportedFailures = Math.max(
        numeric(summary.fail_count),
        numeric(summary.failed_count),
        numeric(summary.failure_count),
      );
      if (
        reportedFailures > 0 ||
        targets.goodsKeys.length < 1 ||
        targets.failedRowCount > 0
      ) {
        setState({
          status: "blocked",
          message:
            "상품등록 실패행 또는 상품그룹 누락이 있어 중앙 가격정책 실행을 차단했습니다. 상품등록 결과를 먼저 확인하세요.",
          uploadRequestId,
          goodsKeyCount: targets.goodsKeys.length,
        });
        return;
      }

      let plan = readStoredPlan(uploadRequestId);
      if (!plan || !planMatchesGoodsKeys(plan, targets.goodsKeys)) {
        plan = buildStoredPlan(
          uploadRequestId,
          targets.goodsKeys,
          targets.groupMap,
        );
        writeStoredPlan(plan);
      }

      const failedChunkIndex = plan.chunks.findIndex(
        (chunk) => chunk.status === "failed",
      );
      if (failedChunkIndex >= 0) {
        const failedChunk = plan.chunks[failedChunkIndex];
        setState({
          status: "error",
          message:
            failedChunk.message ||
            `중앙 가격정책 ${failedChunkIndex + 1}/${plan.chunks.length}묶음 결과를 확인하세요.`,
          uploadRequestId,
          priceRequestId: failedChunk.requestId,
          goodsKeyCount: plan.goodsKeys.length,
        });
        return;
      }

      const chunkIndex = plan.chunks.findIndex(
        (chunk) => chunk.status !== "success",
      );
      if (chunkIndex < 0) {
        setState({
          status: "success",
          message: `중앙 가격정책 적용 완료 · 상품 ${plan.goodsKeys.length}개 · ${plan.chunks.length}묶음`,
          uploadRequestId,
          goodsKeyCount: plan.goodsKeys.length,
        });
        return;
      }

      const chunk = plan.chunks[chunkIndex];
      if (!chunk.requestId) {
        setState({
          status: "running",
          message: `중앙 가격정책 ${chunkIndex + 1}/${plan.chunks.length}묶음 실행을 시작합니다.`,
          uploadRequestId,
          goodsKeyCount: plan.goodsKeys.length,
        });
        const dispatchResponse = await fetch("/api/shopling-price-modify/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            goods_key: chunk.goodsKeys.join(","),
            goods_key_group_json: JSON.stringify(chunk.groupMap),
            policy_overrides: [],
            reason: "canonical_after_standalone_product_upload",
            policy_version: SHOPLING_CANONICAL_PRICE_POLICY_VERSION,
          }),
        });
        const dispatchResult = await dispatchResponse.json();
        chunk.requestId = String(dispatchResult.requestId ?? "").trim();
        if (!dispatchResponse.ok || !chunk.requestId) {
          chunk.status = "failed";
          chunk.message =
            dispatchResult.message || "중앙 가격정책 실행을 시작하지 못했습니다.";
          writeStoredPlan(plan);
          setState({
            status: "error",
            message: chunk.message,
            uploadRequestId,
            goodsKeyCount: plan.goodsKeys.length,
          });
          return;
        }
        writeStoredPlan(plan);
      }

      const priceResponse = await fetch(
        `/api/shopling-price-modify/actions-result?request_id=${encodeURIComponent(chunk.requestId)}`,
        { cache: "no-store" },
      );
      const priceResult = await priceResponse.json();
      if (
        isCanonicalPricePolicyResultSuccess(
          priceResult,
          chunk.goodsKeys.length,
        )
      ) {
        chunk.status = "success";
        chunk.message = "중앙 가격정책 적용 완료";
        writeStoredPlan(plan);
        const completedCount = plan.chunks.filter(
          (candidate) => candidate.status === "success",
        ).length;
        setState({
          status:
            completedCount === plan.chunks.length ? "success" : "running",
          message:
            completedCount === plan.chunks.length
              ? `중앙 가격정책 적용 완료 · 상품 ${plan.goodsKeys.length}개`
              : `중앙 가격정책 ${completedCount}/${plan.chunks.length}묶음 완료 · 다음 묶음을 준비합니다.`,
          uploadRequestId,
          priceRequestId: chunk.requestId,
          goodsKeyCount: plan.goodsKeys.length,
        });
        return;
      }
      if (
        !priceResponse.ok ||
        isCanonicalPricePolicyResultTerminalFailure(priceResult)
      ) {
        chunk.status = "failed";
        chunk.message = canonicalPricePolicyResultMessage(priceResult);
        writeStoredPlan(plan);
        setState({
          status: "error",
          message: chunk.message,
          uploadRequestId,
          priceRequestId: chunk.requestId,
          goodsKeyCount: plan.goodsKeys.length,
        });
        return;
      }
      setState({
        status: "running",
        message: `중앙 가격정책 ${chunkIndex + 1}/${plan.chunks.length}묶음 적용 중`,
        uploadRequestId,
        priceRequestId: chunk.requestId,
        goodsKeyCount: plan.goodsKeys.length,
      });
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "중앙 가격정책 연결 중 오류가 발생했습니다.",
        uploadRequestId,
      });
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    void inspect();
    const timer = window.setInterval(() => void inspect(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [inspect]);

  const retry = () => {
    if (!state.uploadRequestId) return;
    const plan = readStoredPlan(state.uploadRequestId);
    if (!plan) {
      window.localStorage.removeItem(
        pricePlanStorageKey(state.uploadRequestId),
      );
      void inspect();
      return;
    }
    const failedChunk = plan.chunks.find((chunk) => chunk.status === "failed");
    if (failedChunk) {
      failedChunk.status = "pending";
      failedChunk.requestId = "";
      failedChunk.message = "";
      writeStoredPlan(plan);
    }
    void inspect();
  };

  const tone =
    state.status === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : state.status === "blocked" || state.status === "error"
        ? "border-red-200 bg-red-50 text-red-900"
        : "border-blue-200 bg-blue-50 text-blue-900";

  return (
    <section className={`mb-6 rounded-2xl border p-4 shadow-sm ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black">중앙 가격정책 연결</p>
          <p className="mt-1 text-sm font-bold">{state.message}</p>
          <p className="mt-1 text-xs opacity-80">
            카페24 ×0.97 · 도매창고 +500원 · 에이블리 +3,000원 · 매입가 50% · 소비자가 150%
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void inspect()}
            className="rounded-lg border border-current bg-white px-3 py-2 text-xs font-black"
          >
            지금 확인
          </button>
          {state.status === "error" ? (
            <button
              type="button"
              onClick={retry}
              className="rounded-lg border border-current bg-white px-3 py-2 text-xs font-black"
            >
              실패 묶음 다시 실행
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
