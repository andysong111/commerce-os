"use client";

import { useEffect, useState } from "react";
import { useShoplingPriceAdjustmentApi } from "@/components/shopling-price-adjustment/ShoplingPriceAdjustmentAuthProvider";

const JOB_STORAGE_KEY = "shoplingPriceAdjustment.currentBulkJobId";
const PARTIAL_FAILURE_PATTERN = /partial_failure|읽기 전용 계획 검증 실패/i;

type JobDetail = {
  job?: {
    status?: string;
    last_error?: string | null;
  };
  error?: string;
};

export function ShoplingPriceAdjustmentPartialRecoveryPanel() {
  const requestApi = useShoplingPriceAdjustmentApi();
  const [jobId, setJobId] = useState("");
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setJobId(localStorage.getItem(JOB_STORAGE_KEY) ?? "");
  }, []);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const response = await requestApi(
          `/api/shopling-price-adjustment/bulk/jobs/${encodeURIComponent(jobId)}`,
          { cache: "no-store" },
        );
        const body = await response.json() as JobDetail;
        if (!cancelled) setDetail(body);
      } catch {
        if (!cancelled) setDetail(null);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [jobId, requestApi]);

  const lastError = detail?.job?.last_error ?? "";
  const recoverable = detail?.job?.status === "failed"
    && PARTIAL_FAILURE_PATTERN.test(lastError);
  if (!recoverable && !message && !error) return null;

  const recover = async () => {
    if (!jobId || loading) return;
    setLoading(true);
    setMessage("");
    setError("");
    try {
      const response = await requestApi(
        `/api/shopling-price-adjustment/bulk/jobs/${encodeURIComponent(jobId)}/recover-partial-plan`,
        { method: "POST", cache: "no-store" },
      );
      const body = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? `복구 실패 status=${response.status}`);
      setMessage(body.message ?? "부분 실패 작업을 복구했습니다.");
      window.setTimeout(() => window.location.reload(), 800);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "부분 실패 작업을 복구하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="mt-5 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 shadow-sm">
      <h2 className="text-lg font-bold text-amber-950">조회 오류 상품 격리 복구</h2>
      {recoverable ? (
        <>
          <p className="mt-2 text-sm leading-6 text-amber-900">
            기존 성공 상품은 유지합니다. 실제 변경이 시작되지 않은 실패 청크만 다시 조회하고,
            조회 불가능한 상품은 미실행으로 기록한 뒤 나머지 상품을 계속 처리합니다.
          </p>
          <p className="mt-2 break-all rounded-lg bg-white p-3 text-sm text-amber-950">{lastError}</p>
          <button
            type="button"
            disabled={loading}
            onClick={() => void recover()}
            className="mt-3 rounded-lg bg-amber-700 px-4 py-3 font-bold text-white disabled:opacity-50"
          >
            {loading ? "복구 중..." : "오류 상품 제외 후 이어서 실행 준비"}
          </button>
        </>
      ) : null}
      {message ? <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">{message}</p> : null}
      {error ? <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-900">{error}</p> : null}
    </section>
  );
}
