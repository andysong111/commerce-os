"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

const TERMINAL_DISPATCH = new Set(["success", "partial", "failed", "cancelled", "expired"]);

type LedgerStats = {
  ledger_id: string;
  launch_item_id: string;
  model_number: string;
  source_url: string;
  offer_id: string;
  model_name: string;
  common_search_line: string;
  total_count: number;
  available_count: number;
  reserved_count: number;
  used_count: number;
  review_count: number;
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
  external_request_id?: string | null;
  result_payload?: Record<string, unknown> | null;
  reservation_expires_at: string | null;
  submitted_at?: string | null;
  completed_at?: string | null;
  created_at: string;
  updated_at?: string;
};

type ListResponse = {
  ok?: boolean;
  ledgers?: LedgerStats[];
  dispatches?: DispatchRow[];
  message?: string;
};

type LiveResponse = {
  ok?: boolean;
  status?: string;
  mode?: "apply_existing_first" | "canonical_seed" | "additional_registration";
  dispatchId?: string;
  reservationId?: string;
  productUploadJobId?: string;
  directApplyRequestId?: string;
  message?: string;
};

type DispatchResponse = {
  ok?: boolean;
  dispatch?: DispatchRow;
  items?: Array<Record<string, unknown>>;
  message?: string;
};

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function dateText(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ko-KR");
}

function phaseOf(dispatch: DispatchRow | null | undefined) {
  return text(dispatch?.result_payload?.phase);
}

function phaseLabel(dispatch: DispatchRow) {
  if (dispatch.status === "success") return "완료";
  if (dispatch.status === "failed") {
    return phaseOf(dispatch) === "review_required" ? "확인 필요" : "실패";
  }
  const phase = phaseOf(dispatch);
  if (phase === "base_upload_preparing" || phase === "base_upload_queued") return "기본상품 6개 등록 중";
  if (phase === "direct_apply_preparing" || phase === "direct_apply_queued") return "SEO 29개 반영 대기";
  if (phase === "direct_apply_running") return "SEO 29개 반영 중";
  if (phase === "completed") return "완료";
  if (phase === "review_required") return "확인 필요";
  return dispatch.status === "submitted" ? "실제등록 진행 중" : dispatch.status;
}

function modeLabel(mode: LiveResponse["mode"]) {
  if (mode === "apply_existing_first") return "기존 기준상품 6개에 첫 SEO 적용";
  if (mode === "canonical_seed") return "기준상품 6개 첫 신규등록";
  if (mode === "additional_registration") return "추가 신규등록 6개 생성";
  return "실제등록";
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    credentials: "same-origin",
    cache: "no-store",
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

export default function ShoplingSeoLiveDispatchCenter() {
  const [ledgers, setLedgers] = useState<LedgerStats[]>([]);
  const [dispatches, setDispatches] = useState<DispatchRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyLedgerId, setBusyLedgerId] = useState("");
  const [activeDispatchId, setActiveDispatchId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ mode: "list", limit: "200" });
      if (search.trim()) query.set("search", search.trim());
      const result = await requestJson<ListResponse>(`/api/seo-title-dispatch?${query.toString()}`);
      const nextLedgers = Array.isArray(result.ledgers) ? result.ledgers : [];
      const nextDispatches = Array.isArray(result.dispatches) ? result.dispatches : [];
      setLedgers(nextLedgers);
      setDispatches(nextDispatches);
      const active = nextDispatches.find((row) => row.status === "submitted");
      setActiveDispatchId((current) => current || active?.dispatch_id || "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "SEO 출고센터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!activeDispatchId) return;
    let stopped = false;
    let timer: number | null = null;
    const poll = async () => {
      try {
        const result = await requestJson<DispatchResponse>(
          `/api/seo-title-dispatch?mode=dispatch&dispatchId=${encodeURIComponent(activeDispatchId)}`,
        );
        const dispatch = result.dispatch;
        if (!dispatch || stopped) return;
        setDispatches((current) => [
          dispatch,
          ...current.filter((row) => row.dispatch_id !== dispatch.dispatch_id),
        ]);
        if (TERMINAL_DISPATCH.has(dispatch.status)) {
          setActiveDispatchId("");
          setMessage(
            dispatch.status === "success"
              ? "샵플링 전체몰 1회 실제등록이 완료됐고 상품명 29개를 사용완료 처리했습니다."
              : "실제등록이 종료됐지만 확인이 필요한 항목이 있습니다. 최근 출고 상태를 확인하세요.",
          );
          await load();
          return;
        }
      } catch {
        // Background workers continue even when this browser status request briefly fails.
      }
      if (!stopped) timer = window.setTimeout(poll, 6_000);
    };
    timer = window.setTimeout(poll, 2_000);
    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [activeDispatchId, load]);

  const totals = useMemo(
    () => ({
      products: ledgers.length,
      available: ledgers.reduce((sum, row) => sum + number(row.available_count), 0),
      used: ledgers.reduce((sum, row) => sum + number(row.used_count), 0),
      review: ledgers.reduce((sum, row) => sum + number(row.review_count), 0),
      rounds: ledgers.reduce((sum, row) => sum + number(row.full_market_rounds_available), 0),
    }),
    [ledgers],
  );

  async function liveRegister(ledger: LedgerStats) {
    if (ledger.full_market_rounds_available < 1) {
      setError(`${ledger.model_number || ledger.model_name}: 전체몰 1회분 상품명 재고 29개가 부족합니다.`);
      return;
    }
    if (ledger.review_count > 0) {
      setError(`${ledger.model_number || ledger.model_name}: 이전 실제등록의 확인필요 상품명이 남아 있어 새 등록을 차단했습니다.`);
      return;
    }
    const confirmed = window.confirm(
      `${ledger.model_number || ledger.model_name}\n\n실제 샵플링 전체몰 1회 등록을 실행할까요?\n\n- 필요 시 샵플링 상품 6개를 신규 생성\n- 쇼핑몰별 SEO 상품명 29개 실제 반영\n- 공통 검색어 10개 실제 반영\n- 성공 시 상품명 재고 29개 사용완료\n\n이 작업은 실제 외부 쓰기입니다.`,
    );
    if (!confirmed) return;

    setBusyLedgerId(ledger.ledger_id);
    setError("");
    setMessage("");
    try {
      const result = await requestJson<LiveResponse>("/api/seo-title-dispatch/live-register", {
        method: "POST",
        body: JSON.stringify({ ledgerId: ledger.ledger_id }),
      });
      if (!result.dispatchId) throw new Error(result.message || "실제등록 작업 ID를 받지 못했습니다.");
      setActiveDispatchId(result.dispatchId);
      setMessage(`${modeLabel(result.mode)} · ${result.message || "실제등록을 시작했습니다."}`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "샵플링 실제등록을 시작하지 못했습니다.");
    } finally {
      setBusyLedgerId("");
    }
  }

  return (
    <main className="mx-auto max-w-[1600px] space-y-6 px-5 py-8 text-slate-900">
      <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-violet-700">
              COMMERCE OS · SHOPLING SEO LIVE DISPATCH
            </p>
            <h1 className="mt-2 text-3xl font-black">샵플링 SEO 출고센터</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              SEO 대량등록 클라우드의 미사용 상품명 재고를 꺼내 샵플링 상품 6개와 29개 쇼핑몰별 상품명·공통 검색어를 실제 등록합니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/keyword-engine-elon-lab" className="rounded-xl border border-violet-300 bg-white px-4 py-2 text-sm font-black text-violet-800">
              SEO 대량등록 클라우드
            </Link>
            <Link href="/product-launch-tracker" className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white">
              상품출시 진행관리
            </Link>
          </div>
        </div>
        <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold leading-6 text-emerald-950">
          <strong>실제등록 연결됨.</strong> 한 번 누를 때 전체몰 1회분만 실행합니다. 첫 실행은 기존 기준상품이 있으면 그 6개에 SEO를 적용하고, 기준상품이 없으면 6개를 생성합니다. 이후 추가등록은 기존 goods_key를 덮어쓰지 않고 새 6개 상품을 만든 뒤 SEO 제목 29개를 적용합니다.
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="원장 상품" value={totals.products} suffix="개" />
        <Stat label="미사용 상품명" value={totals.available} suffix="개" />
        <Stat label="사용 완료" value={totals.used} suffix="개" />
        <Stat label="확인 필요" value={totals.review} suffix="개" />
        <Stat label="전체몰 등록 가능" value={totals.rounds} suffix="회" />
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) void load();
            }}
            placeholder="모델번호·모델명·1688 offer ID 검색"
            className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm"
          />
          <button type="button" onClick={() => void load()} disabled={loading} className="rounded-xl bg-violet-700 px-5 py-3 text-sm font-black text-white disabled:opacity-50">
            {loading ? "불러오는 중" : "재고·상태 새로고침"}
          </button>
        </div>
        {message ? <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">{message}</div> : null}
        {error ? <div className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">{error}</div> : null}
      </section>

      <section className="space-y-4">
        {loading ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-sm font-bold text-slate-500">SEO 상품명 재고를 확인하고 있습니다.</div>
        ) : ledgers.length ? (
          ledgers.map((ledger) => {
            const busy = busyLedgerId === ledger.ledger_id;
            const canRegister = ledger.full_market_rounds_available >= 1 && ledger.review_count === 0;
            const recent = dispatches.find((row) => row.ledger_id === ledger.ledger_id);
            return (
              <article key={ledger.ledger_id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">{ledger.model_number || "모델번호 없음"}</span>
                      <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-800">전체몰 {number(ledger.full_market_rounds_available)}회분</span>
                      {ledger.review_count > 0 ? <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-black text-rose-800">확인 필요 {ledger.review_count}</span> : null}
                    </div>
                    <h2 className="mt-3 text-2xl font-black">{ledger.model_name}</h2>
                    <p className="mt-1 text-xs text-slate-500">1688 offer {ledger.offer_id || "—"} · 최근 갱신 {dateText(ledger.updated_at)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs font-black">
                    <span className="rounded-xl bg-emerald-50 px-3 py-2 text-emerald-800">미사용 {number(ledger.available_count)}</span>
                    <span className="rounded-xl bg-amber-50 px-3 py-2 text-amber-900">예약 {number(ledger.reserved_count)}</span>
                    <span className="rounded-xl bg-slate-100 px-3 py-2 text-slate-700">사용 {number(ledger.used_count)}</span>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-cyan-100 bg-cyan-50/60 p-4">
                  <div className="text-xs font-black text-cyan-900">공통 검색어 10개</div>
                  <div className="mt-2 break-all font-mono text-sm font-bold text-cyan-950">{ledger.common_search_line}</div>
                </div>

                {recent ? (
                  <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm font-bold ${recent.status === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-950" : recent.status === "failed" ? "border-rose-200 bg-rose-50 text-rose-950" : "border-blue-200 bg-blue-50 text-blue-950"}`}>
                    최근 출고: {phaseLabel(recent)} · {dateText(recent.submitted_at || recent.created_at)}
                    {phaseOf(recent) ? <span className="ml-2 text-xs opacity-70">{phaseOf(recent)}</span> : null}
                  </div>
                ) : null}

                <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="text-xs leading-5 text-slate-600">
                    이번 실행: <strong>전체몰 1회 · 상품명 29개</strong><br />
                    성공 후 예상 미사용: <strong>{Math.max(0, ledger.available_count - 29).toLocaleString()}개</strong><br />
                    누적 실제 사용: <strong>{ledger.used_count.toLocaleString()}개</strong>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/keyword-engine-elon-lab?sourceUrl=${encodeURIComponent(ledger.source_url)}${ledger.launch_item_id ? `&launchItemId=${encodeURIComponent(ledger.launch_item_id)}` : ""}${ledger.model_number ? `&modelNumber=${encodeURIComponent(ledger.model_number)}` : ""}`}
                      className="rounded-xl border border-violet-300 bg-white px-4 py-3 text-sm font-black text-violet-800"
                    >
                      원장 보기·보충
                    </Link>
                    <button
                      type="button"
                      onClick={() => void liveRegister(ledger)}
                      disabled={busy || !canRegister || recent?.status === "submitted"}
                      className="rounded-xl bg-emerald-700 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {busy ? "실제등록 시작 중" : recent?.status === "submitted" ? "실제등록 진행 중" : "실제 샵플링 등록 1회"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })
        ) : (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <h2 className="text-xl font-black">저장된 SEO 상품명 재고가 없습니다.</h2>
            <p className="mt-2 text-sm text-slate-600">상품출시 진행관리에서 상품을 선택해 SEO 대량등록 클라우드 원장을 먼저 생성하세요.</p>
            <Link href="/keyword-engine-elon-lab" className="mt-4 inline-block rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white">SEO 대량등록 클라우드 열기</Link>
          </div>
        )}
      </section>

      {dispatches.length ? (
        <details className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <summary className="cursor-pointer font-black">최근 실제등록·출고 {dispatches.length}건 보기</summary>
          <div className="mt-4 space-y-2">
            {dispatches.map((dispatch) => (
              <div key={dispatch.dispatch_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm">
                <div>
                  <div className="font-black">{phaseLabel(dispatch)} · 상품명 {dispatch.reserved_title_count}개 · {dispatch.status}</div>
                  <div className="mt-1 text-xs text-slate-500">시작 {dateText(dispatch.submitted_at || dispatch.created_at)} · 완료 {dateText(dispatch.completed_at)}</div>
                </div>
                <span className="font-mono text-[11px] text-slate-400">{dispatch.dispatch_id.slice(0, 8)}</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </main>
  );
}
