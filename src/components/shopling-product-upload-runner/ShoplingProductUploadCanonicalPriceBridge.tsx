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
const PRICE_REQUEST_STORAGE_PREFIX =
  "shoplingProductUpload.canonicalPriceRequest";
const POLL_MS = 5_000;

type BridgeStatus = "idle" | "waiting" | "running" | "success" | "blocked" | "error";

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

function priceStorageKey(uploadRequestId: string) {
  return `${PRICE_REQUEST_STORAGE_PREFIX}.${uploadRequestId}`;
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

      const storageKey = priceStorageKey(uploadRequestId);
      let priceRequestId = window.localStorage.getItem(storageKey)?.trim() ?? "";
      if (!priceRequestId) {
        setState({
          status: "running",
          message: `등록된 ${targets.goodsKeys.length}개 상품을 중앙 가격정책 엔진으로 보내는 중입니다.`,
          uploadRequestId,
          goodsKeyCount: targets.goodsKeys.length,
        });
        const dispatchResponse = await fetch("/api/shopling-price-modify/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            goods_key: targets.goodsKeys.join(","),
            goods_key_group_json: targets.goodsKeyGroupJson,
            policy_overrides: [],
            reason: "canonical_after_standalone_product_upload",
            policy_version: SHOPLING_CANONICAL_PRICE_POLICY_VERSION,
          }),
        });
        const dispatchResult = await dispatchResponse.json();
        priceRequestId = String(dispatchResult.requestId ?? "").trim();
        if (!dispatchResponse.ok || !priceRequestId) {
          setState({
            status: "error",
            message:
              dispatchResult.message || "중앙 가격정책 실행을 시작하지 못했습니다.",
            uploadRequestId,
            goodsKeyCount: targets.goodsKeys.length,
          });
          return;
        }
        window.localStorage.setItem(storageKey, priceRequestId);
      }

      const priceResponse = await fetch(
        `/api/shopling-price-modify/actions-result?request_id=${encodeURIComponent(priceRequestId)}`,
        { cache: "no-store" },
      );
      const priceResult = await priceResponse.json();
      if (
        isCanonicalPricePolicyResultSuccess(
          priceResult,
          targets.goodsKeys.length,
        )
      ) {
        setState({
          status: "success",
          message: `중앙 가격정책 적용 완료 · 상품 ${targets.goodsKeys.length}개`,
          uploadRequestId,
          priceRequestId,
          goodsKeyCount: targets.goodsKeys.length,
        });
        return;
      }
      if (
        !priceResponse.ok ||
        isCanonicalPricePolicyResultTerminalFailure(priceResult)
      ) {
        setState({
          status: "error",
          message: canonicalPricePolicyResultMessage(priceResult),
          uploadRequestId,
          priceRequestId,
          goodsKeyCount: targets.goodsKeys.length,
        });
        return;
      }
      setState({
        status: "running",
        message: `중앙 가격정책 적용 중 · 상품 ${targets.goodsKeys.length}개`,
        uploadRequestId,
        priceRequestId,
        goodsKeyCount: targets.goodsKeys.length,
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
    if (state.uploadRequestId) {
      window.localStorage.removeItem(priceStorageKey(state.uploadRequestId));
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
              다시 실행
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
