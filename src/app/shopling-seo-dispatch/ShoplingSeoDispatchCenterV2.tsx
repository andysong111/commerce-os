"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

const GROUPS = ["도매1", "도매2", "도매3", "도매4", "소매1", "소매2"] as const;

type LedgerStats = {
  ledger_id: string;
  launch_item_id: string;
  tracker_row_number: number | null;
  model_number: string;
  source_url: string;
  offer_id: string;
  model_name: string;
  common_search_line: string;
  target_inventory_count: number;
  status: string;
  total_count: number;
  available_count: number;
  reserved_count: number;
  used_count: number;
  review_count: number;
  rejected_count: number;
  available_wholesale1: number;
  available_wholesale2: number;
  available_wholesale3: number;
  available_wholesale4: number;
  available_retail1: number;
  available_retail2: number;
  full_market_rounds_available: number;
  replenishment_needed_count: number;
  dispatch_count: number;
  updated_at: string;
};

type DispatchRow = {
  dispatch_id: string;
  ledger_id: string;
  reservation_id: string;
  launch_item_id: string;
  status: string;
  registration_rounds: number;
  requested_title_count: number;
  reserved_title_count: number;
  reservation_expires_at: string | null;
  created_at: string;
};

type UnknownRecord = Record<string, unknown>;

type DispatchPlanItem = {
  title_id: string;
  product_group: string;
  market_name: string;
  mall_key: string;
  account_id_label: string;
  goods_key: string;
  final_title: string;
  final_site_srch: string;
  registration_round: number;
};

type DispatchPlan = {
  dispatchId: string;
  reservationId: string;
  ledgerId: string;
  modelNumber: string;
  modelName: string;
  rounds: number;
  reservedTitleCount: number;
  reservationExpiresAt: string | null;
  commonSearchLine: string;
  items: DispatchPlanItem[];
  externalSubmitEnabled: false;
};

type ListResponse = {
  ok?: boolean;
  ledgers?: LedgerStats[];
  dispatches?: DispatchRow[];
  externalSubmitEnabled?: boolean;
  message?: string;
};

type ReserveResponse = {
  ok?: boolean;
  plan?: UnknownRecord;
  code?: string;
  missingGroups?: string[];
  message?: string;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function dateText(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ko-KR");
}

function normalizePlanItem(value: unknown): DispatchPlanItem {
  const row = record(value);
  return {
    title_id: text(row.title_id ?? row.titleId),
    product_group: text(row.product_group ?? row.productGroup),
    market_name: text(row.market_name ?? row.marketName),
    mall_key: text(row.mall_key ?? row.mallKey),
    account_id_label: text(row.account_id_label ?? row.accountIdLabel),
    goods_key: text(row.goods_key ?? row.goodsKey),
    final_title: text(row.final_title ?? row.finalTitle ?? row.title),
    final_site_srch: text(row.final_site_srch ?? row.finalSiteSrch),
    registration_round: Math.max(
      1,
      Math.trunc(number(row.registration_round ?? row.registrationRound ?? 1)),
    ),
  };
}

function normalizePlan(value: unknown): DispatchPlan | null {
  const row = record(value);
  const dispatchId = text(row.dispatchId ?? row.dispatch_id);
  const reservationId = text(row.reservationId ?? row.reservation_id);
  const ledgerId = text(row.ledgerId ?? row.ledger_id);
  if (!dispatchId || !reservationId || !ledgerId) return null;
  const rawItems = Array.isArray(row.items) ? row.items : [];
  return {
    dispatchId,
    reservationId,
    ledgerId,
    modelNumber: text(row.modelNumber ?? row.model_number),
    modelName: text(row.modelName ?? row.model_name),
    rounds: Math.max(1, Math.trunc(number(row.rounds ?? row.registration_rounds ?? 1))),
    reservedTitleCount: Math.max(
      0,
      Math.trunc(number(row.reservedTitleCount ?? row.reserved_title_count ?? rawItems.length)),
    ),
    reservationExpiresAt: text(
      row.reservationExpiresAt ?? row.reservation_expires_at,
    ) || null,
    commonSearchLine: text(row.commonSearchLine ?? row.common_search_line),
    items: rawItems.map(normalizePlanItem),
    externalSubmitEnabled: false,
  };
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
    credentials: "same-origin",
  });
  const body = (await response.json().catch(() => ({}))) as T & {
    message?: string;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(body.message || body.error || `요청 실패 · HTTP ${response.status}`);
  }
  return body;
}

function Stat({ label, value, suffix = "" }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-xs font-bold text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-black tabular-nums text-slate-950">
        {value.toLocaleString()}
        {suffix ? <span className="ml-1 text-sm text-slate-500">{suffix}</span> : null}
      </div>
    </div>
  );
}

function groupAvailability(ledger: LedgerStats) {
  return {
    도매1: number(ledger.available_wholesale1),
    도매2: number(ledger.available_wholesale2),
    도매3: number(ledger.available_wholesale3),
    도매4: number(ledger.available_wholesale4),
    소매1: number(ledger.available_retail1),
    소매2: number(ledger.available_retail2),
  };
}

export default function ShoplingSeoDispatchCenterV2() {
  const [ledgers, setLedgers] = useState<LedgerStats[]>([]);
  const [dispatches, setDispatches] = useState<DispatchRow[]>([]);
  const [search, setSearch] = useState("");
  const [rounds, setRounds] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busyLedgerId, setBusyLedgerId] = useState("");
  const [busyDispatchId, setBusyDispatchId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [activePlan, setActivePlan] = useState<DispatchPlan | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ mode: "list", limit: "200" });
      if (search.trim()) query.set("search", search.trim());
      const result = await requestJson<ListResponse>(`/api/seo-title-dispatch?${query.toString()}`);
      setLedgers(Array.isArray(result.ledgers) ? result.ledgers : []);
      setDispatches(Array.isArray(result.dispatches) ? result.dispatches : []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "SEO 출고센터 데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const totals = useMemo(
    () => ({
      products: ledgers.length,
      available: ledgers.reduce((sum, row) => sum + number(row.available_count), 0),
      used: ledgers.reduce((sum, row) => sum + number(row.used_count), 0),
      dispatches: ledgers.reduce((sum, row) => sum + number(row.dispatch_count), 0),
      replenishment: ledgers.reduce((sum, row) => sum + number(row.replenishment_needed_count), 0),
    }),
    [ledgers],
  );

  async function reserve(ledger: LedgerStats) {
    const registrationRounds = Math.max(1, Math.min(20, Math.trunc(rounds[ledger.ledger_id] ?? 1)));
    if (ledger.full_market_rounds_available < registrationRounds) {
      setError(
        `${ledger.model_number || ledger.model_name}: 전체몰 ${registrationRounds}회분을 출고하려면 상품명 재고가 더 필요합니다. 현재 ${ledger.full_market_rounds_available}회분입니다.`,
      );
      return;
    }
    setBusyLedgerId(ledger.ledger_id);
    setError("");
    setMessage("");
    setActivePlan(null);
    try {
      const result = await requestJson<ReserveResponse>("/api/seo-title-dispatch", {
        method: "POST",
        body: JSON.stringify({ action: "reserve", ledgerId: ledger.ledger_id, rounds: registrationRounds }),
      });
      const plan = normalizePlan(result.plan);
      if (!plan) throw new Error(result.message || "출고 계획을 만들지 못했습니다.");
      setActivePlan(plan);
      setMessage(
        `${ledger.model_number || ledger.model_name}: ${plan.reservedTitleCount}개 상품명을 예약하고 샵플링 실행계획을 만들었습니다.`,
      );
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "출고 계획 예약에 실패했습니다.");
    } finally {
      setBusyLedgerId("");
    }
  }

  async function release(dispatchId: string) {
    setBusyDispatchId(dispatchId);
    setError("");
    setMessage("");
    try {
      const result = await requestJson<{ ok?: boolean; releasedCount?: number; message?: string }>(
        "/api/seo-title-dispatch",
        { method: "POST", body: JSON.stringify({ action: "release", dispatchId }) },
      );
      setMessage(result.message || `예약 ${number(result.releasedCount)}개를 원장 재고로 돌렸습니다.`);
      if (activePlan?.dispatchId === dispatchId) setActivePlan(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "예약 해제에 실패했습니다.");
    } finally {
      setBusyDispatchId("");
    }
  }

  return (
    <main className="mx-auto max-w-[1600px] space-y-6 px-5 py-8 text-slate-900">
      <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-violet-700">COMMERCE OS · SHOPLING SEO DISPATCH</p>
            <h1 className="mt-2 text-3xl font-black">샵플링 SEO 출고센터</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              SEO 상품명 재고 원장에서 상품그룹별 제목을 중복 없이 예약하고, 기존 샵플링 goods_key와 29개 쇼핑몰ID에 연결한 실행계획을 만듭니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/keyword-engine-elon-lab" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black">SEO 상품명 재고 원장</Link>
            <Link href="/product-launch-tracker" className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white">상품출시 진행관리</Link>
          </div>
        </div>
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950">
          현재 버전은 <strong>원장 재고 예약·실행계획 생성</strong>까지만 수행합니다. 반복 신규상품 생성형 샵플링 업로드 경로가 검증되기 전에는 외부 전송 버튼을 열지 않습니다.
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="원장 상품" value={totals.products} suffix="개" />
        <Stat label="미사용 상품명" value={totals.available} suffix="개" />
        <Stat label="사용 완료" value={totals.used} suffix="개" />
        <Stat label="누적 출고계획" value={totals.dispatches} suffix="회" />
        <Stat label="목표재고 보충 필요" value={totals.replenishment} suffix="개" />
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) void load(); }} placeholder="모델번호·모델명·1688 offer ID 검색" className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm" />
          <button type="button" onClick={() => void load()} disabled={loading} className="rounded-xl bg-violet-700 px-5 py-3 text-sm font-black text-white disabled:opacity-50">{loading ? "불러오는 중" : "원장 새로고침"}</button>
        </div>
        {message ? <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">{message}</div> : null}
        {error ? <div className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">{error}</div> : null}
      </section>

      <section className="space-y-4">
        {loading ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-sm font-bold text-slate-500">SEO 상품명 원장을 확인하고 있습니다.</div>
        ) : ledgers.length ? (
          ledgers.map((ledger) => {
            const availableByGroup = groupAvailability(ledger);
            const selectedRounds = Math.max(1, Math.min(20, Math.trunc(rounds[ledger.ledger_id] ?? 1)));
            const lowStock = ledger.full_market_rounds_available <= 2;
            return (
              <article key={ledger.ledger_id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">{ledger.model_number || "모델번호 없음"}</span>
                      <span className={`rounded-full px-3 py-1 text-xs font-black ${lowStock ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-800"}`}>전체몰 {number(ledger.full_market_rounds_available)}회분</span>
                      <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-black text-blue-800">누적 출고 {number(ledger.dispatch_count)}회</span>
                    </div>
                    <h2 className="mt-3 text-2xl font-black">{ledger.model_name}</h2>
                    <p className="mt-1 text-xs text-slate-500">1688 offer {ledger.offer_id || "—"} · 최근 갱신 {dateText(ledger.updated_at)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs font-black">
                    <span className="rounded-xl bg-emerald-50 px-3 py-2 text-emerald-800">미사용 {number(ledger.available_count)}</span>
                    <span className="rounded-xl bg-amber-50 px-3 py-2 text-amber-900">예약 {number(ledger.reserved_count)}</span>
                    <span className="rounded-xl bg-slate-100 px-3 py-2 text-slate-700">사용 {number(ledger.used_count)}</span>
                    <span className="rounded-xl bg-violet-50 px-3 py-2 text-violet-800">총 제조 {number(ledger.total_count)}</span>
                  </div>
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
                  {GROUPS.map((group) => (
                    <div key={group} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                      <div className="text-xs font-bold text-slate-500">{group}</div>
                      <div className="mt-1 font-black tabular-nums">{availableByGroup[group].toLocaleString()}개</div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 rounded-2xl border border-cyan-100 bg-cyan-50/60 p-4">
                  <div className="text-xs font-black text-cyan-900">공통 검색어</div>
                  <div className="mt-2 break-all font-mono text-sm font-bold text-cyan-950">{ledger.common_search_line}</div>
                </div>

                <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 lg:flex-row lg:items-end">
                  <label className="text-sm font-black">
                    이번 전체몰 출고 횟수
                    <select value={selectedRounds} onChange={(event) => setRounds((current) => ({ ...current, [ledger.ledger_id]: Number(event.target.value) }))} className="mt-2 block rounded-xl border border-slate-300 bg-white px-4 py-3">
                      {Array.from({ length: 20 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value}회 · 상품명 {value * 29}개</option>)}
                    </select>
                  </label>
                  <div className="flex-1 text-xs leading-5 text-slate-600">
                    전송 전 예상 잔량: <strong>{Math.max(0, number(ledger.available_count) - selectedRounds * 29).toLocaleString()}개</strong><br />
                    목표재고까지 보충 필요: <strong>{number(ledger.replenishment_needed_count).toLocaleString()}개</strong>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/keyword-engine-elon-lab?sourceUrl=${encodeURIComponent(ledger.source_url)}${ledger.launch_item_id ? `&launchItemId=${encodeURIComponent(ledger.launch_item_id)}` : ""}${ledger.model_number ? `&modelNumber=${encodeURIComponent(ledger.model_number)}` : ""}`} className="rounded-xl border border-violet-300 bg-white px-4 py-3 text-sm font-black text-violet-800">원장 보기·보충</Link>
                    <button type="button" onClick={() => void reserve(ledger)} disabled={busyLedgerId === ledger.ledger_id || ledger.full_market_rounds_available < selectedRounds} className="rounded-xl bg-violet-700 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300">{busyLedgerId === ledger.ledger_id ? "예약 중" : "출고 계획 예약"}</button>
                  </div>
                </div>
              </article>
            );
          })
        ) : (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <h2 className="text-xl font-black">저장된 SEO 상품명 원장이 없습니다.</h2>
            <p className="mt-2 text-sm text-slate-600">1688 링크를 분석한 뒤 SEO OUTPUT에서 원장 제조·저장을 실행하세요.</p>
            <Link href="/keyword-engine-elon-lab" className="mt-4 inline-block rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white">SEO 상품명 재고 원장 열기</Link>
          </div>
        )}
      </section>

      {activePlan ? (
        <section className="rounded-3xl border-2 border-violet-200 bg-violet-50/50 p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-violet-700">RESERVED DISPATCH PLAN</p>
              <h2 className="mt-1 text-2xl font-black">{activePlan.modelNumber || activePlan.modelName} · {activePlan.rounds}회분</h2>
              <p className="mt-2 text-sm text-slate-600">상품명 {activePlan.reservedTitleCount}개 예약 · 만료 {dateText(activePlan.reservationExpiresAt)}</p>
            </div>
            <button type="button" onClick={() => void release(activePlan.dispatchId)} disabled={busyDispatchId === activePlan.dispatchId} className="rounded-xl border border-rose-300 bg-white px-4 py-2 text-sm font-black text-rose-700 disabled:opacity-50">{busyDispatchId === activePlan.dispatchId ? "해제 중" : "예약 취소·재고 복귀"}</button>
          </div>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-violet-100 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-violet-50 text-xs text-violet-900"><tr><th className="px-4 py-3">회차</th><th className="px-4 py-3">상품그룹</th><th className="px-4 py-3">쇼핑몰</th><th className="px-4 py-3">goods_key</th><th className="min-w-[420px] px-4 py-3">예약 상품명</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {activePlan.items.map((item, index) => (
                  <tr key={`${item.registration_round}:${item.product_group}:${item.mall_key}:${item.account_id_label}:${index}`}>
                    <td className="px-4 py-3 font-black tabular-nums">{item.registration_round}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-black">{item.product_group}</td>
                    <td className="whitespace-nowrap px-4 py-3"><div className="font-bold">{item.market_name}</div><div className="text-[11px] text-slate-400">{item.account_id_label}</div></td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{item.goods_key}</td>
                    <td className="px-4 py-3 font-bold">{item.final_title}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 rounded-xl bg-white px-4 py-3 text-sm font-bold text-slate-700 ring-1 ring-violet-100">외부 샵플링 전송은 비활성화 상태입니다. 반복 신규등록용 API 경로가 검증되면 이 예약 계획을 그대로 제출 단계에 연결합니다.</div>
        </section>
      ) : null}

      {dispatches.length ? (
        <details className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <summary className="cursor-pointer font-black">최근 출고계획 {dispatches.length}건 보기</summary>
          <div className="mt-4 space-y-2">
            {dispatches.map((dispatch) => (
              <div key={dispatch.dispatch_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm">
                <div><div className="font-black">{dispatch.registration_rounds}회분 · 상품명 {dispatch.reserved_title_count}개 · {dispatch.status}</div><div className="mt-1 text-xs text-slate-500">생성 {dateText(dispatch.created_at)} · 예약 만료 {dateText(dispatch.reservation_expires_at)}</div></div>
                {dispatch.status === "reserved" || dispatch.status === "ready" ? <button type="button" onClick={() => void release(dispatch.dispatch_id)} disabled={busyDispatchId === dispatch.dispatch_id} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-black text-rose-700 disabled:opacity-50">예약 해제</button> : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </main>
  );
}
