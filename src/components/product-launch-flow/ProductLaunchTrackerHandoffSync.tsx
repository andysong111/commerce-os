"use client";

import { useEffect, useRef, useState } from "react";

const HANDOFF_KEY = "productLaunchFlow.trackerHandoff.v1";
const SIMPLE_SESSION_KEY = "productLaunchFlow.simpleSession.v1";
const TRACKER_STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const TRACKER_STATE_ENDPOINT = "/api/product-launch-tracker/state";

type Handoff = {
  version: 1;
  itemId: string;
  modelNumber: string;
  productName: string;
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

  useEffect(() => {
    let cancelled = false;

    const inspect = () => {
      const nextHandoff = readJson<Handoff>(HANDOFF_KEY);
      if (cancelled) return;
      setHandoff(nextHandoff);
      if (!nextHandoff || nextHandoff.completedAt || syncing.current) return;

      const session = readJson<unknown>(SIMPLE_SESSION_KEY);
      if (directApplyFailed(session)) {
        setMessage(
          "상품명·검색어 반영 결과를 확인하세요. 실패 상태에서는 진행관리를 완료 처리하지 않습니다.",
        );
        return;
      }
      if (!directApplyCompleted(session)) return;

      syncing.current = true;
      void completeTrackerStage(nextHandoff)
        .then((completed) => {
          if (cancelled) return;
          setHandoff(completed);
          setMessage(
            "상품명·검색어 반영 완료 · 신규 상품 출시 진행관리에도 자동 반영했습니다.",
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
            신규 상품 출시 진행관리에서 이어옴
          </p>
          <p className="mt-1 font-black text-slate-950">
            {handoff.modelNumber} · {handoff.productName}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            기존 가격과 옵션은 유지하고, goods_key {handoff.goodsKeys.length}개의
            상품명·검색어만 처리합니다.
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

async function completeTrackerStage(handoff: Handoff) {
  const trackerState = readJson<Record<string, unknown>>(TRACKER_STORAGE_KEY);
  if (!trackerState) {
    throw new Error("신규 상품 출시 진행관리 저장본을 찾지 못했습니다.");
  }
  const items = Array.isArray(trackerState.items)
    ? (trackerState.items as Array<Record<string, unknown>>)
    : [];
  const item = items.find(
    (candidate) => String(candidate.id ?? "") === handoff.itemId,
  );
  if (!item) {
    throw new Error("완료 처리할 진행관리 상품을 찾지 못했습니다.");
  }

  const now = new Date().toISOString();
  const stages = record(item.stages);
  stages.priceKeyword = {
    ...record(stages.priceKeyword),
    status: "완료",
    completedAt: now,
    note: "goods_key 6개의 상품명·검색어 반영을 완료했습니다. 기존 가격은 유지되었습니다.",
  };
  item.stages = stages;
  item.updatedAt = now;
  item.updatedBy = "상품출시플로우";
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
