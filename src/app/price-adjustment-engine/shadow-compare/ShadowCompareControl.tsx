"use client";

import { useState } from "react";
import type {
  PriceGradeMismatchKind,
  PriceGradeShadowResult,
} from "@/lib/priceGradeShadowComparison";

const number = new Intl.NumberFormat("ko-KR");
const won = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0,
});

function kindLabel(kind: PriceGradeMismatchKind) {
  if (kind === "missing_existing_lifecycle") return "기존 등급 없음";
  if (kind === "engine_blocked") return "입력 부족·차단";
  if (kind === "existing_stale_input") return "기존 판정이 오래됨";
  if (kind === "different_rule_source") return "구형 규칙 출처";
  return "원인 추가분석 필요";
}

function kindTone(kind: PriceGradeMismatchKind) {
  if (kind === "unexplained_difference") {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }
  if (kind === "existing_stale_input" || kind === "different_rule_source") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  return "border-slate-200 bg-slate-100 text-slate-700";
}

export function ShadowCompareControl({
  initialResult,
}: {
  initialResult: PriceGradeShadowResult | null;
}) {
  const [result, setResult] = useState(initialResult);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        "/api/price-adjustment-engine/shadow-compare",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ action: "compare" }),
          cache: "no-store",
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        result?: PriceGradeShadowResult;
        message?: string;
      };
      if (!response.ok || body.ok !== true || !body.result) {
        throw new Error(body.message || `비교 실행 실패 · HTTP ${response.status}`);
      }
      setResult(body.result);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "상품등급 그림자 비교에 실패했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  const summary = result?.summary;
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-black text-slate-950">
              자체 엔진 그림자 재계산
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              최근 24개월 판매와 최근 365일 입고원가를 다시 읽어 현재
              Product Master lifecycle과 비교합니다. 가격·등급·단종 상태는
              변경하지 않습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {busy ? "비교 계산 중" : "최신 원장으로 그림자 비교"}
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          실제 가격변경·상품등급 저장·재발주 제한 적용은 모두 차단됩니다.
        </p>
      </section>

      {error ? (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900">
          <strong className="block">비교 실행을 완료하지 못했습니다.</strong>
          <p className="mt-2 break-words">{error}</p>
        </section>
      ) : null}

      {result && summary ? (
        <>
          <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm text-blue-950">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <strong className="block text-base">
                  상품등급 그림자 비교 완료
                </strong>
                <p className="mt-1 leading-6">{result.notice}</p>
              </div>
              <span className="rounded-full border border-blue-300 bg-white px-3 py-1 text-xs font-black text-blue-800">
                실제 쓰기 차단
              </span>
            </div>
            <p className="mt-3 break-all font-mono text-[11px] text-blue-700">
              입력 지문 {result.contentFingerprint}
            </p>
          </section>

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Metric label="전체 입력" value={summary.inputCount} note="안정 SKU" />
            <Metric
              label="완전 일치"
              value={summary.exactMatchCount}
              note="등급·목표가·보호가격"
              positive
            />
            <Metric
              label="오래된 기존판정"
              value={summary.staleExistingCount}
              note="입력 이후 재계산 필요"
            />
            <Metric
              label="구형 규칙 출처"
              value={summary.differentRuleSourceCount}
              note="엔진 이전 차이"
            />
            <Metric
              label="원인 추가분석"
              value={summary.unexplainedCount}
              note="운영 전환 차단 기준"
              danger={summary.unexplainedCount > 0}
            />
          </section>

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="등급 차이"
              value={summary.gradeMismatchCount}
              note="+6~-4"
            />
            <Metric
              label="목표가 차이"
              value={summary.targetPriceMismatchCount}
              note="10원 단위 목표가"
            />
            <Metric
              label="보호가격 차이"
              value={summary.protectionMismatchCount}
              note="최근 입고 3회 최고원가×2"
            />
            <Metric
              label="입력 차단"
              value={summary.blockedCount}
              note="바코드·현재가·원가 누락"
            />
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-950">
                  차이 원인 표본
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {new Date(result.generatedAt).toLocaleString("ko-KR")} · 최대
                  500건 표시
                </p>
              </div>
              <p className="text-xs text-slate-500">
                {summary.sampleTruncated
                  ? `전체 ${number.format(summary.mismatchCount)}건 중 ${number.format(summary.sampleCount)}건 표시`
                  : `${number.format(summary.sampleCount)}건`}
              </p>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-[1350px] text-left text-sm">
                <thead className="border-b border-slate-200 text-xs font-bold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-3">상품</th>
                    <th className="px-3 py-3">분류</th>
                    <th className="px-3 py-3 text-right">기존등급</th>
                    <th className="px-3 py-3 text-right">자체등급</th>
                    <th className="px-3 py-3 text-right">기존목표가</th>
                    <th className="px-3 py-3 text-right">자체목표가</th>
                    <th className="px-3 py-3 text-right">기존보호가</th>
                    <th className="px-3 py-3 text-right">자체보호가</th>
                    <th className="px-3 py-3">차이</th>
                    <th className="px-3 py-3">근거</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {result.mismatches.length ? (
                    result.mismatches.map((row) => (
                      <tr key={`${row.skuId}:${row.kind}`}>
                        <td className="px-3 py-4">
                          <strong className="block max-w-xs text-slate-950">
                            {row.productName}
                          </strong>
                          <span className="mt-1 block font-mono text-xs text-slate-500">
                            {row.barcode}
                            {row.optionName ? ` · ${row.optionName}` : ""}
                          </span>
                        </td>
                        <td className="px-3 py-4">
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${kindTone(row.kind)}`}
                          >
                            {kindLabel(row.kind)}
                          </span>
                        </td>
                        <td className="px-3 py-4 text-right font-semibold">
                          {row.previous.grade ?? "-"}
                        </td>
                        <td className="px-3 py-4 text-right font-black text-blue-700">
                          {row.calculated.grade}
                        </td>
                        <td className="px-3 py-4 text-right">
                          {row.previous.targetPrice === null
                            ? "-"
                            : won.format(row.previous.targetPrice)}
                        </td>
                        <td className="px-3 py-4 text-right font-black text-blue-700">
                          {won.format(row.calculated.targetPrice)}
                        </td>
                        <td className="px-3 py-4 text-right">
                          {row.previous.protectionFloor === null
                            ? "-"
                            : won.format(row.previous.protectionFloor)}
                        </td>
                        <td className="px-3 py-4 text-right font-semibold">
                          {won.format(row.calculated.protectionFloor)}
                        </td>
                        <td className="px-3 py-4 text-xs text-slate-600">
                          {row.differences.join(" · ")}
                        </td>
                        <td className="px-3 py-4 text-xs leading-5 text-slate-600">
                          {[...row.blockedReasons, ...row.reasons]
                            .slice(0, 2)
                            .join(" · ") || "근거 없음"}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={10}
                        className="px-3 py-10 text-center text-emerald-700"
                      >
                        비교 가능한 기존 lifecycle과 자체 엔진 결과가 모두
                        일치합니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          아직 저장된 상품등급 그림자 비교 결과가 없습니다.
        </section>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  note,
  positive = false,
  danger = false,
}: {
  label: string;
  value: number;
  note: string;
  positive?: boolean;
  danger?: boolean;
}) {
  return (
    <article
      className={`rounded-2xl border bg-white p-5 shadow-sm ${
        danger
          ? "border-rose-200"
          : positive
            ? "border-emerald-200"
            : "border-slate-200"
      }`}
    >
      <p className="text-sm font-semibold text-slate-500">{label}</p>
      <strong
        className={`mt-2 block text-2xl font-black ${
          danger
            ? "text-rose-700"
            : positive
              ? "text-emerald-700"
              : "text-slate-950"
        }`}
      >
        {number.format(value)}
      </strong>
      <p className="mt-2 text-xs text-slate-500">{note}</p>
    </article>
  );
}
