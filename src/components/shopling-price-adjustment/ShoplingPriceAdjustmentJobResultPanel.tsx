"use client";

import { useCallback, useEffect, useState } from "react";
import { useShoplingPriceAdjustmentApi } from "@/components/shopling-price-adjustment/ShoplingPriceAdjustmentAuthProvider";
import { SHOPLING_PRICE_ADJUSTMENT_BULK_SELECTION_STORAGE_KEY } from "@/lib/shoplingPriceAdjustmentBulkSelection";

const JOB_STORAGE_KEY = "shoplingPriceAdjustment.currentBulkJobId";
const TERMINAL_STATUSES = new Set([
  "succeeded",
  "failed",
  "dispatch_uncertain",
  "cancelled",
]);

type ExcludedItem = {
  goods_key?: string;
  ordinal?: number;
  status?: string;
  result?: unknown;
};

type JobDetail = {
  job?: {
    status?: string;
  };
  item_status_counts?: Record<string, number>;
  excluded_items?: ExcludedItem[];
  error?: string;
};

function resultReason(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "현재가·옵션 조회 결과를 만들지 못했습니다.";
  }
  const record = value as Record<string, unknown>;
  const stage = typeof record.stage === "string" ? record.stage : "";
  const error = typeof record.error === "string" ? record.error.trim() : "";
  const stageLabel = stage === "planning" ? "조회 단계" : stage;
  return [stageLabel, error].filter(Boolean).join(" · ")
    || "현재가·옵션 조회 결과를 만들지 못했습니다.";
}

export function ShoplingPriceAdjustmentJobResultPanel() {
  const requestShoplingPriceAdjustmentApi = useShoplingPriceAdjustmentApi();
  const [jobId, setJobId] = useState(() =>
    typeof window === "undefined"
      ? ""
      : localStorage.getItem(JOB_STORAGE_KEY) ?? ""
  );
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [error, setError] = useState("");

  const loadDetail = useCallback(async (targetJobId: string) => {
    if (!targetJobId) return;
    try {
      const response = await requestShoplingPriceAdjustmentApi(
        `/api/shopling-price-adjustment/bulk/jobs/${encodeURIComponent(targetJobId)}`,
        { cache: "no-store", credentials: "same-origin" },
      );
      const body = await response.json() as JobDetail;
      if (!response.ok || body.error) {
        throw new Error(body.error ?? `결과 조회 실패 status=${response.status}`);
      }
      setDetail(body);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "작업 결과를 조회하지 못했습니다.");
    }
  }, [requestShoplingPriceAdjustmentApi]);

  useEffect(() => {
    const syncJob = () => {
      const stored = localStorage.getItem(JOB_STORAGE_KEY) ?? "";
      setJobId((current) => current === stored ? current : stored);
    };
    syncJob();
    const interval = window.setInterval(syncJob, 2_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!jobId) {
      setDetail(null);
      return;
    }
    void loadDetail(jobId);
    const interval = window.setInterval(() => {
      void loadDetail(jobId);
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [jobId, loadDetail]);

  const excludedItems = Array.isArray(detail?.excluded_items)
    ? detail.excluded_items
    : [];
  const status = detail?.job?.status ?? "";
  const terminal = TERMINAL_STATUSES.has(status);

  const clearForNewJob = () => {
    localStorage.removeItem(JOB_STORAGE_KEY);
    localStorage.removeItem(
      SHOPLING_PRICE_ADJUSTMENT_BULK_SELECTION_STORAGE_KEY,
    );
    localStorage.removeItem("shoplingPriceAdjustment.currentPlanRequestId");
    localStorage.removeItem("shoplingPriceAdjustment.currentCanaryRequestId");
    window.location.reload();
  };

  if (!jobId || (!terminal && excludedItems.length === 0 && !error)) return null;

  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-950">작업 결과</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            조회 오류 상품은 가격을 변경하지 않고 미실행으로 분리합니다.
          </p>
        </div>
        {terminal ? (
          <button
            type="button"
            onClick={clearForNewJob}
            className="rounded-lg bg-slate-900 px-4 py-3 font-bold text-white"
          >
            새 작업 시작
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-900">
          {error}
        </p>
      ) : null}

      {excludedItems.length > 0 ? (
        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-bold text-amber-950">
              조회 오류·미실행 {excludedItems.length.toLocaleString("ko-KR")}개
            </h3>
            <span className="text-sm font-semibold text-amber-900">
              가격 변경 안 됨
            </span>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead>
                <tr className="border-b border-amber-200">
                  <th className="px-3 py-2">순번</th>
                  <th className="px-3 py-2">goods_key</th>
                  <th className="px-3 py-2">오류 사유</th>
                </tr>
              </thead>
              <tbody>
                {excludedItems.map((item, index) => (
                  <tr
                    key={`${item.goods_key ?? "unknown"}-${item.ordinal ?? index}`}
                    className="border-b border-amber-100 last:border-0"
                  >
                    <td className="px-3 py-3 text-slate-600">
                      {Number(item.ordinal ?? index + 1).toLocaleString("ko-KR")}
                    </td>
                    <td className="px-3 py-3 font-mono font-bold text-slate-950">
                      {item.goods_key ?? "-"}
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      {resultReason(item.result)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : terminal ? (
        <p className="mt-5 rounded-xl bg-emerald-50 p-4 font-semibold text-emerald-900">
          조회 오류 없이 작업이 종료됐습니다.
        </p>
      ) : null}
    </section>
  );
}
