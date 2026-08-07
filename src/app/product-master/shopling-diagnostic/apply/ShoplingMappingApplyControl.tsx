"use client";

import { useState } from "react";
import type { ProductMasterShoplingMappingApplyStatus } from "@/lib/productMasterShoplingMappingApply";

const number = new Intl.NumberFormat("ko-KR");

export function ShoplingMappingApplyControl({
  initialStatus,
}: {
  initialStatus: ProductMasterShoplingMappingApplyStatus;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState<"CANARY" | "FULL" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    const response = await fetch("/api/product-master/shopling-diagnostic/apply", {
      method: "GET",
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      status?: ProductMasterShoplingMappingApplyStatus;
      message?: string;
    };
    if (!response.ok || !payload.ok || !payload.status) {
      throw new Error(payload.message || "연결 적용 상태를 불러오지 못했습니다.");
    }
    setStatus(payload.status);
  }

  async function apply(mode: "CANARY" | "FULL") {
    if (mode === "CANARY") {
      const candidate = status.canaryCandidate;
      const confirmed = window.confirm(
        candidate
          ? `${candidate.barcode} · goods_key ${candidate.goodsKey} · 옵션 ${candidate.optionId} 연결 1건을 상품마스터에 저장하고 즉시 재검증합니다. 계속할까요?`
          : "상품마스터 연결 후보 1건을 카나리로 저장하고 재검증할까요?",
      );
      if (!confirmed) return;
    } else {
      const confirmed = window.confirm(
        `카나리 검증을 통과했습니다. 남은 안전 후보 ${number.format(status.pendingCount)}건을 상품마스터에 저장합니다. Shopling 상품·가격·재고·발주는 변경하지 않습니다. 계속할까요?`,
      );
      if (!confirmed) return;
    }

    setBusy(mode);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/product-master/shopling-diagnostic/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: mode === "CANARY" ? "canary" : "full" }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        result?: {
          message?: string;
          status?: ProductMasterShoplingMappingApplyStatus;
        };
        message?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "상품마스터 연결 적용에 실패했습니다.");
      }
      setMessage(payload.result?.message || "상품마스터 연결값을 적용했습니다.");
      if (payload.result?.status) {
        setStatus(payload.result.status);
      } else {
        await refresh();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "상품마스터 연결 적용 실패");
      await refresh().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }

  const canCanary =
    status.state === "READY_CANARY" &&
    status.pendingCount > 0 &&
    status.blockerCount === 0 &&
    !busy;
  const canFull =
    status.state === "READY_FULL" &&
    status.canaryVerified &&
    status.pendingCount > 0 &&
    status.blockerCount === 0 &&
    !busy;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
              GUARDED WRITE · PRODUCT MASTER ONLY
            </p>
            <h2 className="mt-2 text-xl font-black text-slate-950">
              Shopling 연결 후보 카나리 적용
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              완료된 전수진단 후보를 현재 상품마스터와 다시 대조한 뒤, 먼저 1건만 저장하고 planning snapshot에서 goods_key·옵션 ID·환산수량이 동일한지 재조회합니다. Shopling 자체 데이터와 가격·재고·발주는 변경하지 않습니다.
            </p>
          </div>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-black text-slate-700">
            {status.state}
          </span>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Metric label="전수진단 후보" value={status.totalCandidates} />
          <Metric label="안전 후보" value={status.safeCandidateCount} />
          <Metric label="이미 연결" value={status.alreadyAppliedCount} />
          <Metric label="남은 적용" value={status.pendingCount} warning={status.pendingCount > 0} />
          <Metric label="재검증 차단" value={status.blockerCount} danger={status.blockerCount > 0} />
        </div>

        <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-700">
          {status.message}
        </p>
        {message ? (
          <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-900">
            {error}
          </p>
        ) : null}
      </section>

      {status.canaryCandidate && !status.canaryVerified ? (
        <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-950">1건 카나리 대상</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <TextMetric label="위치코드" value={status.canaryCandidate.barcode} />
            <TextMetric label="goods_key" value={status.canaryCandidate.goodsKey} />
            <TextMetric label="옵션 ID" value={status.canaryCandidate.optionId} />
            <TextMetric label="환산수량" value={`${status.canaryCandidate.unitsPerOrder}개`} />
            <TextMetric label="옵션" value={status.canaryCandidate.listingOptionName || "단품"} />
          </div>
          <button
            type="button"
            disabled={!canCanary}
            onClick={() => apply("CANARY")}
            className="mt-5 rounded-xl bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {busy === "CANARY" ? "카나리 저장·검증 중..." : "1건 카나리 적용 및 재검증"}
          </button>
        </section>
      ) : null}

      {status.canaryVerified && status.pendingCount > 0 ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
          <h2 className="text-lg font-black text-emerald-950">카나리 검증 통과</h2>
          <p className="mt-2 text-sm leading-6 text-emerald-900">
            실제 상품마스터 저장 후 다시 읽어 동일한 연결값을 확인했습니다. 남은 후보는 같은 멱등 경로를 최대 500건씩 나누어 적용하며, 중간 실패 시 이미 성공한 연결을 다시 중복 생성하지 않습니다.
          </p>
          <button
            type="button"
            disabled={!canFull}
            onClick={() => apply("FULL")}
            className="mt-5 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {busy === "FULL"
              ? "남은 안전 후보 적용·전수검증 중..."
              : `남은 ${number.format(status.pendingCount)}건 안전 적용`}
          </button>
        </section>
      ) : null}

      {status.state === "COMPLETED" ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950 shadow-sm">
          <strong className="text-lg">Shopling 연결값 적용 완료</strong>
          <p className="mt-2 text-sm leading-6">
            자동 적용 가능한 전수진단 후보가 모두 상품마스터 planning snapshot에서 확인됩니다. 다음 단계인 판매원장 적재 검증으로 이동할 수 있습니다.
          </p>
        </section>
      ) : null}

      {status.blockers.length ? (
        <section className="rounded-2xl border border-rose-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-rose-950">자동 적용 차단</h2>
          <p className="mt-1 text-sm text-slate-600">
            전수진단 후 상품마스터가 바뀌었거나 후보를 안전하게 특정할 수 없는 항목입니다. 이 항목들은 자동 저장하지 않습니다.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-[900px] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs font-bold text-slate-500">
                <tr>
                  <th className="px-3 py-3">코드</th>
                  <th className="px-3 py-3">위치코드</th>
                  <th className="px-3 py-3">goods_key</th>
                  <th className="px-3 py-3">옵션 ID</th>
                  <th className="px-3 py-3">사유</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {status.blockers.map((blocker, index) => (
                  <tr key={`${blocker.code}:${blocker.skuId ?? ""}:${blocker.goodsKey}:${blocker.optionId}:${index}`}>
                    <td className="px-3 py-4 font-mono text-xs text-rose-800">{blocker.code}</td>
                    <td className="px-3 py-4 font-mono text-xs">{blocker.barcode || "-"}</td>
                    <td className="px-3 py-4 font-mono text-xs">{blocker.goodsKey || "-"}</td>
                    <td className="px-3 py-4 font-mono text-xs">{blocker.optionId || "-"}</td>
                    <td className="px-3 py-4 text-xs leading-5 text-slate-700">{blocker.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  warning = false,
  danger = false,
}: {
  label: string;
  value: number;
  warning?: boolean;
  danger?: boolean;
}) {
  return (
    <article className={`rounded-xl border p-4 ${danger ? "border-rose-200 bg-rose-50" : warning ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"}`}>
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong className={`mt-1 block text-xl ${danger ? "text-rose-800" : warning ? "text-amber-800" : "text-slate-950"}`}>
        {number.format(value)}
      </strong>
    </article>
  );
}

function TextMetric({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-xl border border-blue-100 bg-white p-4">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong className="mt-1 block break-words text-sm text-slate-950">{value}</strong>
    </article>
  );
}
