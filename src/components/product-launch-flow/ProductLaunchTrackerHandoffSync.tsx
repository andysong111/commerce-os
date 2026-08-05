"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SHOPLING_CANONICAL_PRICE_POLICY_VERSION } from "@/lib/shoplingCanonicalPricePolicy";

const HANDOFF_KEY = "productLaunchFlow.trackerHandoff.v1";
const SIMPLE_SESSION_KEY = "productLaunchFlow.simpleSession.v1";
const TRACKER_STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const TRACKER_STATE_ENDPOINT = "/api/product-launch-tracker/state";

type HandoffItem = {
  itemId: string;
  trackerRowNumber: number | null;
  modelNumber: string;
  productName: string;
  goodsKeys: string[];
  priceRequestId: string;
  pricePolicyVersion: string;
};

type Handoff = {
  version: 2;
  items: HandoffItem[];
  goodsKeys: string[];
  startedAt: string;
  completedAt: string | null;
  status: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readJson<T>(key: string): T | null {
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

function normalizeHandoff(value: unknown): Handoff | null {
  const source = record(value);
  if (source.version === 2 && Array.isArray(source.items)) {
    const items = source.items.map(normalizeHandoffItem).filter((item) => item.itemId);
    if (!items.length) return null;
    return {
      version: 2,
      items,
      goodsKeys: stringList(source.goodsKeys),
      startedAt: String(source.startedAt ?? ""),
      completedAt: source.completedAt ? String(source.completedAt) : null,
      status: String(source.status ?? "keyword_in_progress"),
    };
  }
  if (source.version === 1) {
    const item = normalizeHandoffItem({
      itemId: source.itemId,
      trackerRowNumber: null,
      modelNumber: source.modelNumber,
      productName: source.productName,
      goodsKeys: source.goodsKeys,
      priceRequestId: "",
      pricePolicyVersion: "",
    });
    if (!item.itemId) return null;
    return {
      version: 2,
      items: [item],
      goodsKeys: item.goodsKeys,
      startedAt: String(source.startedAt ?? ""),
      completedAt: source.completedAt ? String(source.completedAt) : null,
      status: String(source.status ?? "keyword_in_progress"),
    };
  }
  return null;
}

function normalizeHandoffItem(value: unknown): HandoffItem {
  const source = record(value);
  const rowNumber = Number(source.trackerRowNumber);
  return {
    itemId: String(source.itemId ?? "").trim(),
    trackerRowNumber:
      Number.isSafeInteger(rowNumber) && rowNumber > 0 ? rowNumber : null,
    modelNumber: String(source.modelNumber ?? "").trim(),
    productName: String(source.productName ?? "").trim(),
    goodsKeys: stringList(source.goodsKeys),
    priceRequestId: String(source.priceRequestId ?? "").trim(),
    pricePolicyVersion: String(source.pricePolicyVersion ?? "").trim(),
  };
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

function directApplyCompleted(session: unknown) {
  const root = record(session);
  const result = record(root.directResult);
  const summary = record(result.summary);
  return (
    String(result.phase ?? "") === "artifact_ready" &&
    String(summary.status ?? "").toLowerCase() === "success" &&
    summary.direct_apply_completed === true &&
    Number(summary.failed_item_count ?? 0) === 0 &&
    summary.price_repair_required === false &&
    summary.requires_final_price_pass === false
  );
}

function directApplyFailed(session: unknown) {
  const root = record(session);
  const result = record(root.directResult);
  const phase = String(result.phase ?? "").toLowerCase();
  const status = String(result.status ?? "").toLowerCase();
  return ["failed", "error", "partial_failure", "blocked"].includes(
    phase || status,
  );
}

export function ProductLaunchTrackerHandoffSync() {
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [message, setMessage] = useState("");
  const syncing = useRef(false);
  const title = useMemo(() => formatHandoffTitle(handoff), [handoff]);

  useEffect(() => {
    let cancelled = false;

    const inspect = () => {
      const nextHandoff = normalizeHandoff(readJson<unknown>(HANDOFF_KEY));
      if (cancelled) return;
      setHandoff(nextHandoff);
      if (!nextHandoff || nextHandoff.completedAt || syncing.current) return;

      const session = readJson<unknown>(SIMPLE_SESSION_KEY);
      if (directApplyFailed(session)) {
        setMessage(
          "가격정책 또는 상품명·검색어 반영 결과를 확인하세요. 실패 상태에서는 진행관리를 완료 처리하지 않습니다.",
        );
        return;
      }
      if (!directApplyCompleted(session)) return;

      syncing.current = true;
      void completeTrackerStages(nextHandoff, session)
        .then((completed) => {
          if (cancelled) return;
          setHandoff(completed);
          setMessage(
            `${completed.items.length}개 상품의 중앙 가격정책과 상품명·검색어 완료 상태를 상품출시진행관리에 자동 반영했습니다.`,
          );
        })
        .catch((error) => {
          if (cancelled) return;
          syncing.current = false;
          setMessage(
            error instanceof Error
              ? error.message
              : "진행관리 완료 상태를 저장하지 못했습니다.",
          );
        });
    };

    inspect();
    const timer = window.setInterval(inspect, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!handoff) return null;

  return (
    <section className="mb-5 rounded-2xl border border-violet-200 bg-violet-50 p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black text-violet-700">
            상품출시진행관리에서 이어옴
          </p>
          <p className="mt-1 font-black text-slate-950">{title}</p>
          <p className="mt-1 text-sm text-slate-600">
            상품 {handoff.items.length}개 · goods_key {handoff.goodsKeys.length}개를 중앙 가격정책 엔진으로 정규화한 뒤 상품명·검색어를 처리합니다.
          </p>
        </div>
        <span className="rounded-full border border-violet-300 bg-white px-3 py-1.5 text-xs font-black text-violet-700">
          {handoff.completedAt ? "가격·키워드 완료" : "가격·키워드 진행 중"}
        </span>
      </div>
      {message ? (
        <p className="mt-3 rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-bold text-violet-800">
          {message}
        </p>
      ) : null}
    </section>
  );
}

async function completeTrackerStages(handoff: Handoff, session: unknown) {
  const trackerState = await readLatestTrackerState();
  const items = Array.isArray(trackerState.items)
    ? (trackerState.items as Array<Record<string, unknown>>)
    : [];
  const sessionRoot = record(session);
  const priceResult = record(sessionRoot.priceResult);
  const priceSummary = record(priceResult.summary);
  const aggregatePriceRequestId = String(sessionRoot.priceRequestId ?? "").trim();
  if (
    !aggregatePriceRequestId ||
    String(priceSummary.status ?? "").toLowerCase() !== "success"
  ) {
    throw new Error("중앙 가격정책 완료 결과를 확인하지 못했습니다.");
  }

  const now = new Date().toISOString();
  const missing: string[] = [];
  for (const handoffItem of handoff.items) {
    const item = items.find(
      (candidate) => String(candidate.id ?? "") === handoffItem.itemId,
    );
    if (!item) {
      missing.push(
        handoffItem.trackerRowNumber
          ? `${handoffItem.trackerRowNumber}행`
          : handoffItem.modelNumber || handoffItem.itemId,
      );
      continue;
    }

    const existingPrice = record(item.pricePolicy);
    const existingSucceeded =
      String(existingPrice.status ?? "").toLowerCase() === "success";
    const requestId = existingSucceeded
      ? String(existingPrice.requestId ?? "").trim() ||
        handoffItem.priceRequestId ||
        aggregatePriceRequestId
      : aggregatePriceRequestId;
    const policyVersion = existingSucceeded
      ? String(existingPrice.policyVersion ?? "").trim() ||
        handoffItem.pricePolicyVersion ||
        SHOPLING_CANONICAL_PRICE_POLICY_VERSION
      : String(priceSummary.policy_version ?? "").trim() ||
        SHOPLING_CANONICAL_PRICE_POLICY_VERSION;

    item.pricePolicy = {
      ...existingPrice,
      required: true,
      status: "success",
      requestId,
      policyVersion,
      goodsKeyCount: handoffItem.goodsKeys.length,
      message: "중앙 가격정책 적용과 검증을 완료했습니다.",
      completedAt: now,
      updatedAt: now,
    };

    const stages = record(item.stages);
    stages.priceKeyword = {
      ...record(stages.priceKeyword),
      status: "완료",
      completedAt: now,
      note: `중앙 가격정책과 goods_key ${handoffItem.goodsKeys.length}개의 상품명·검색어 반영을 완료했습니다.`,
    };
    item.stages = stages;
    item.updatedAt = now;
    item.updatedBy = "상품출시플로우";
  }
  if (missing.length) {
    throw new Error(`완료 처리할 진행관리 상품을 찾지 못했습니다: ${missing.join(", ")}`);
  }

  trackerState.savedAt = now;
  window.localStorage.setItem(
    TRACKER_STORAGE_KEY,
    JSON.stringify(trackerState),
  );

  const response = await fetch(TRACKER_STATE_ENDPOINT, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ state: trackerState }),
    credentials: "same-origin",
  });
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    message?: string;
  };
  if (!response.ok || body.ok !== true) {
    throw new Error(body.message || "진행관리 완료 상태를 서버에 저장하지 못했습니다.");
  }

  const completed: Handoff = {
    ...handoff,
    completedAt: now,
    status: "completed",
  };
  window.localStorage.setItem(HANDOFF_KEY, JSON.stringify(completed));
  return completed;
}

async function readLatestTrackerState() {
  const response = await fetch(TRACKER_STATE_ENDPOINT, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    message?: string;
    state?: unknown;
  };
  const state = record(body.state);
  if (!response.ok || body.ok !== true || !Array.isArray(state.items)) {
    throw new Error(
      body.message ||
        "최신 상품출시진행관리 상태를 서버에서 불러오지 못했습니다. 완료 처리를 중단했습니다.",
    );
  }
  window.localStorage.setItem(TRACKER_STORAGE_KEY, JSON.stringify(state));
  return state;
}

function formatHandoffTitle(handoff: Handoff | null) {
  if (!handoff?.items.length) return "";
  if (handoff.items.length === 1) {
    const item = handoff.items[0];
    const row = item.trackerRowNumber ? `${item.trackerRowNumber}행 · ` : "";
    return `${row}${item.modelNumber} · ${item.productName}`;
  }
  const first = handoff.items[0];
  return `${first.modelNumber} · ${first.productName} 외 ${handoff.items.length - 1}개`;
}
