"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  canonicalPricePolicyResultMessage,
  extractCanonicalPriceTargetsFromTrackerItem,
  isCanonicalPricePolicyResultSuccess,
  SHOPLING_CANONICAL_PRICE_POLICY_VERSION,
} from "@/lib/shoplingCanonicalPricePolicy";

const TRACKER_STATE_ENDPOINT = "/api/product-launch-tracker/state";
const TRACKER_STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const AUTOMATION_CUTOFF = Date.parse("2026-08-03T08:20:00.000Z");
const POLL_MS = 5_000;

type BridgeStatus = "idle" | "running" | "success" | "blocked" | "error";

type BridgeState = {
  status: BridgeStatus;
  message: string;
  itemId?: string;
  modelName?: string;
  requestId?: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function qualifiesForAutomaticPolicy(item: Record<string, unknown>) {
  const policy = record(item.pricePolicy);
  if (policy.required === true || text(policy.requestId)) return true;
  const stages = record(item.stages);
  const upload = record(stages.shoplingUpload);
  const completedAt = Date.parse(text(upload.completedAt));
  return Number.isFinite(completedAt) && completedAt >= AUTOMATION_CUTOFF;
}

async function readTrackerState() {
  const response = await fetch(TRACKER_STATE_ENDPOINT, {
    cache: "no-store",
    credentials: "same-origin",
  });
  const body = await response.json();
  if (!response.ok || body.ok !== true || !body.state) {
    throw new Error(body.message || "진행관리 서버 저장본을 불러오지 못했습니다.");
  }
  return record(body.state);
}

async function saveTrackerState(state: Record<string, unknown>) {
  const response = await fetch(TRACKER_STATE_ENDPOINT, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ state }),
    credentials: "same-origin",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok !== true) {
    throw new Error(body.message || "중앙 가격정책 상태를 저장하지 못했습니다.");
  }
  window.localStorage.setItem(TRACKER_STORAGE_KEY, JSON.stringify(state));
}

function patchItemPricePolicy(
  state: Record<string, unknown>,
  itemId: string,
  patch: Record<string, unknown>,
) {
  const items = Array.isArray(state.items)
    ? (state.items as Array<Record<string, unknown>>)
    : [];
  const item = items.find((candidate) => text(candidate.id) === itemId);
  if (!item) throw new Error("가격정책 상태를 반영할 진행관리 상품을 찾지 못했습니다.");
  const now = new Date().toISOString();
  item.pricePolicy = {
    ...record(item.pricePolicy),
    required: true,
    policyVersion: SHOPLING_CANONICAL_PRICE_POLICY_VERSION,
    ...patch,
    updatedAt: now,
  };
  item.updatedAt = now;
  item.updatedBy = "중앙 가격정책 엔진";
  state.savedAt = now;
  return item;
}

export function ProductLaunchTrackerCanonicalPriceBridge() {
  const [state, setState] = useState<BridgeState>({
    status: "idle",
    message: "신규 등록 상품은 중앙 가격정책 엔진으로 자동 정규화됩니다.",
  });
  const busy = useRef(false);

  const inspect = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const trackerState = await readTrackerState();
      const items = Array.isArray(trackerState.items)
        ? (trackerState.items as Array<Record<string, unknown>>)
        : [];
      const candidate = items.find((item) => {
        if (!qualifiesForAutomaticPolicy(item)) return false;
        const targets = extractCanonicalPriceTargetsFromTrackerItem(item);
        if (targets.goodsKeys.length !== 6 || targets.failedRowCount > 0) return false;
        return text(record(item.pricePolicy).status) !== "success";
      });

      if (!candidate) {
        const blocked = items.find((item) => {
          if (!qualifiesForAutomaticPolicy(item)) return false;
          const targets = extractCanonicalPriceTargetsFromTrackerItem(item);
          return targets.goodsKeys.length > 0 && targets.goodsKeys.length < 6;
        });
        setState(
          blocked
            ? {
                status: "blocked",
                message: `${text(blocked.productName) || text(blocked.modelNumber)} · 6채널 등록이 완성되지 않아 가격정책을 대기합니다.`,
                itemId: text(blocked.id),
                modelName: text(blocked.productName),
              }
            : {
                status: "success",
                message: "중앙 가격정책 적용 대기 상품이 없습니다.",
              },
        );
        return;
      }

      const itemId = text(candidate.id);
      const modelName = text(candidate.productName) || text(candidate.modelNumber);
      const targets = extractCanonicalPriceTargetsFromTrackerItem(candidate);
      const currentPolicy = record(candidate.pricePolicy);
      let requestId = text(currentPolicy.requestId);
      if (text(currentPolicy.status) === "failed") {
        setState({
          status: "error",
          message: text(currentPolicy.message) || `${modelName} 가격정책 실행 결과를 확인하세요.`,
          itemId,
          modelName,
          requestId,
        });
        return;
      }

      if (!requestId) {
        setState({
          status: "running",
          message: `${modelName} · 중앙 가격정책 실행을 시작합니다.`,
          itemId,
          modelName,
        });
        const dispatchResponse = await fetch("/api/shopling-price-modify/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            goods_key: targets.goodsKeys.join(","),
            goods_key_group_json: targets.goodsKeyGroupJson,
            policy_overrides: [],
            reason: "canonical_after_product_launch_tracker_upload",
            policy_version: SHOPLING_CANONICAL_PRICE_POLICY_VERSION,
          }),
        });
        const dispatchResult = await dispatchResponse.json();
        requestId = text(dispatchResult.requestId);
        if (!dispatchResponse.ok || !requestId) {
          patchItemPricePolicy(trackerState, itemId, {
            status: "failed",
            message:
              dispatchResult.message || "중앙 가격정책 실행을 시작하지 못했습니다.",
          });
          await saveTrackerState(trackerState);
          throw new Error(
            dispatchResult.message || "중앙 가격정책 실행을 시작하지 못했습니다.",
          );
        }
        patchItemPricePolicy(trackerState, itemId, {
          status: "pending",
          requestId,
          goodsKeyCount: targets.goodsKeys.length,
          message: "중앙 가격정책 적용을 시작했습니다.",
        });
        await saveTrackerState(trackerState);
      }

      const priceResponse = await fetch(
        `/api/shopling-price-modify/actions-result?request_id=${encodeURIComponent(requestId)}`,
        { cache: "no-store" },
      );
      const priceResult = await priceResponse.json();
      if (
        isCanonicalPricePolicyResultSuccess(
          priceResult,
          targets.goodsKeys.length,
        )
      ) {
        patchItemPricePolicy(trackerState, itemId, {
          status: "success",
          requestId,
          goodsKeyCount: targets.goodsKeys.length,
          completedAt: new Date().toISOString(),
          message: "중앙 가격정책 적용과 검증을 완료했습니다.",
        });
        await saveTrackerState(trackerState);
        setState({
          status: "success",
          message: `${modelName} · 중앙 가격정책 적용 완료`,
          itemId,
          modelName,
          requestId,
        });
        return;
      }

      if (!priceResponse.ok || priceResult.status === "error") {
        const message = canonicalPricePolicyResultMessage(priceResult);
        patchItemPricePolicy(trackerState, itemId, {
          status: "failed",
          requestId,
          message,
        });
        await saveTrackerState(trackerState);
        setState({ status: "error", message, itemId, modelName, requestId });
        return;
      }

      setState({
        status: "running",
        message: `${modelName} · 중앙 가격정책 적용 중`,
        itemId,
        modelName,
        requestId,
      });
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "중앙 가격정책 자동화 중 오류가 발생했습니다.",
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

  const retry = async () => {
    if (!state.itemId || busy.current) return;
    busy.current = true;
    try {
      const trackerState = await readTrackerState();
      patchItemPricePolicy(trackerState, state.itemId, {
        status: "pending",
        requestId: "",
        message: "중앙 가격정책 재실행을 준비합니다.",
        completedAt: null,
      });
      await saveTrackerState(trackerState);
      setState({
        status: "running",
        message: `${state.modelName || "상품"} · 중앙 가격정책을 다시 실행합니다.`,
        itemId: state.itemId,
        modelName: state.modelName,
      });
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof Error ? error.message : "가격정책 재실행 준비에 실패했습니다.",
        itemId: state.itemId,
        modelName: state.modelName,
      });
    } finally {
      busy.current = false;
      void inspect();
    }
  };

  const tone =
    state.status === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : state.status === "error" || state.status === "blocked"
        ? "border-red-200 bg-red-50 text-red-900"
        : "border-blue-200 bg-blue-50 text-blue-900";

  return (
    <section className={`rounded-xl border px-4 py-3 shadow-sm ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <strong className="block text-sm">중앙 가격정책 자동화</strong>
          <span className="mt-1 block text-xs leading-5">{state.message}</span>
          <span className="mt-1 block text-xs opacity-80">
            등록 → goods_key 확보 → 중앙 가격정책 → 검증 완료 순서로 처리합니다.
          </span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void inspect()}
            className="rounded-lg border border-current bg-white px-3 py-2 text-xs font-black"
          >
            지금 확인
          </button>
          {state.status === "error" && state.itemId ? (
            <button
              type="button"
              onClick={() => void retry()}
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
