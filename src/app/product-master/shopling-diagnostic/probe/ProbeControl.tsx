"use client";

import { useState } from "react";
import type { ProductMasterShoplingProbeResult } from "@/lib/productMasterShoplingProbe";

function categoryLabel(category: ProductMasterShoplingProbeResult["category"]) {
  if (category === "SUCCESS") return "연결 성공";
  if (category === "CONFIGURATION") return "환경설정";
  if (category === "TIMEOUT") return "시간초과";
  if (category === "DNS") return "주소 확인 실패";
  if (category === "TLS") return "보안 연결 실패";
  if (category === "NETWORK") return "네트워크 연결 실패";
  if (category === "HTTP") return "HTTP 응답 오류";
  if (category === "SHOPLING_RESPONSE") return "Shopling 응답 오류";
  if (category === "PARSE") return "응답 해석 오류";
  return "원인 추가분석";
}

function tone(result: ProductMasterShoplingProbeResult) {
  return result.ok
    ? "border-emerald-200 bg-emerald-50 text-emerald-950"
    : "border-rose-200 bg-rose-50 text-rose-950";
}

export function ProbeControl({
  initialResult,
}: {
  initialResult: ProductMasterShoplingProbeResult | null;
}) {
  const [result, setResult] = useState(initialResult);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runProbe() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        "/api/product-master/shopling-diagnostic/probe",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "probe" }),
          cache: "no-store",
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        result?: ProductMasterShoplingProbeResult;
        message?: string;
      };
      if (!body.result) {
        throw new Error(
          body.message || `Shopling 연결 진단 실패 · HTTP ${response.status}`,
        );
      }
      setResult(body.result);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Shopling 연결 진단을 완료하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">
              READ ONLY · ONE-DAY PROBE
            </p>
            <h2 className="mt-2 text-xl font-black text-slate-950">
              Shopling 상품 API 최소 범위 연결 확인
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              오늘 하루 범위의 상품 API만 읽어 날짜범위 문제와 네트워크·TLS·응답
              문제를 분리합니다. 상품·옵션·가격·재고·발주 값은 변경하지 않습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={runProbe}
            disabled={busy}
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-black text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {busy ? "연결 확인 중" : "하루 범위 연결 확인"}
          </button>
        </div>
      </section>

      {error ? (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-950">
          <strong className="block">진단 실행 실패</strong>
          <p className="mt-2 break-words">{error}</p>
        </section>
      ) : null}

      {result ? (
        <section className={`rounded-2xl border p-5 ${tone(result)}`}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <strong className="block text-lg">
                {categoryLabel(result.category)}
              </strong>
              <p className="mt-2 break-words text-sm leading-6">
                {result.safeMessage}
              </p>
            </div>
            <span className="rounded-full border border-current/20 bg-white/70 px-3 py-1 text-xs font-black">
              {result.code}
            </span>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="확인 날짜" value={result.probeDate} />
            <Metric
              label="응답 시간"
              value={`${result.durationMs.toLocaleString("ko-KR")}ms`}
            />
            <Metric
              label="HTTP 상태"
              value={result.httpStatus === null ? "연결 전 실패" : String(result.httpStatus)}
            />
            <Metric
              label="응답 크기"
              value={`${result.responseBytes.toLocaleString("ko-KR")} bytes`}
            />
            <Metric
              label="상품·옵션 행"
              value={result.rowCount.toLocaleString("ko-KR")}
            />
            <Metric
              label="위치코드 바코드"
              value={result.managedBarcodeCount.toLocaleString("ko-KR")}
            />
            <Metric
              label="응답 형식"
              value={result.contentType || "확인 불가"}
            />
            <Metric
              label="진단원장"
              value={result.evidenceStored ? "저장됨" : "저장 실패"}
            />
          </div>
          <p className="mt-4 text-xs opacity-75">
            실제 쓰기 상태: 차단 · 실행시각 {new Date(result.attemptedAt).toLocaleString("ko-KR")}
          </p>
        </section>
      ) : (
        <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          아직 저장된 최소 범위 연결 진단이 없습니다.
        </section>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-xl border border-current/10 bg-white/70 p-3">
      <span className="text-xs font-semibold opacity-65">{label}</span>
      <strong className="mt-1 block break-all text-sm text-slate-950">
        {value}
      </strong>
    </article>
  );
}
