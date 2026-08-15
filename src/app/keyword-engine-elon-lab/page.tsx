"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import {
  KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS,
  KEYWORD_ENGINE_ELON_LAB_STAGES,
  type KeywordEngineElonLabReviewStatus,
} from "@/lib/keywordEngineElonLab";
import type { KeywordEngineElonLabStoredRow } from "@/lib/keywordEngineElonLabStore";

type ApiState = {
  ok: boolean;
  message?: string;
  rows?: KeywordEngineElonLabStoredRow[];
};

type StageOneOutput = {
  goodsKey?: string;
  found?: boolean;
  sourceRowCount?: number;
  productName?: string;
  modelNo?: string;
  modelName?: string;
  partnerGoodsCode?: string;
  currentSiteSearch?: string;
  saleStatus?: string;
  detailDescriptionRawLength?: number;
  detailDescriptionTextLength?: number;
  detailDescriptionPreview?: string;
  currentEngineSeed?: string;
  currentEngineSeedSource?: string;
};

const STAGE_ONE_KEY = "shopling_product_context";

function statusBadge(row: KeywordEngineElonLabStoredRow | undefined) {
  if (!row) return { label: "미실행", className: "bg-slate-100 text-slate-600" };
  if (row.run_status === "error") return { label: "실행오류", className: "bg-red-100 text-red-800" };
  if (row.review_status === "pass") return { label: "통과", className: "bg-emerald-100 text-emerald-800" };
  if (row.review_status === "improve") return { label: "개선필요", className: "bg-amber-100 text-amber-900" };
  return { label: "검수대기", className: "bg-blue-100 text-blue-800" };
}

function outputOf(row: KeywordEngineElonLabStoredRow | undefined) {
  return (row?.output_payload ?? {}) as StageOneOutput;
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 text-xs leading-5 text-slate-100">
      {JSON.stringify(value ?? {}, null, 2)}
    </pre>
  );
}

export default function KeywordEngineElonLabPage() {
  const [rows, setRows] = useState<KeywordEngineElonLabStoredRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [expandedStages, setExpandedStages] = useState<Set<number>>(new Set([0, 1, 2]));

  const refresh = async () => {
    const response = await fetch("/api/keyword-engine-elon-lab", { cache: "no-store" });
    const data = (await response.json()) as ApiState;
    if (!response.ok || !data.ok) throw new Error(data.message || "실험 이력을 불러오지 못했습니다.");
    setRows(data.rows ?? []);
    setNotes((current) => {
      const next = { ...current };
      for (const row of data.rows ?? []) {
        const key = `${row.stage_key}:${row.goods_key}`;
        if (next[key] === undefined) next[key] = row.review_note ?? "";
      }
      return next;
    });
  };

  // Initial lab history synchronization with the server-backed Supabase ledger.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
      .catch((error) => setMessage(error instanceof Error ? error.message : "이력을 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, []);

  const rowMap = useMemo(() => {
    const map = new Map<string, KeywordEngineElonLabStoredRow>();
    for (const row of rows) map.set(`${row.stage_key}:${row.goods_key}`, row);
    return map;
  }, [rows]);

  const stageOneRows = KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS.map((goodsKey) => rowMap.get(`${STAGE_ONE_KEY}:${goodsKey}`));
  const stageOneAllReady = stageOneRows.every((row) => row?.run_status === "ready");
  const stageOneAllPassed = stageOneRows.every((row) => row?.review_status === "pass");
  const stageOneImproveCount = stageOneRows.filter((row) => row?.review_status === "improve").length;

  const runStageOne = async () => {
    setRunning(true);
    setMessage("");
    try {
      const response = await fetch("/api/keyword-engine-elon-lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_stage", stageKey: STAGE_ONE_KEY, goodsKeys: KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS }),
      });
      const data = (await response.json()) as ApiState;
      if (!response.ok || !data.ok) throw new Error(data.message || "1단계 실행에 실패했습니다.");
      await refresh();
      setMessage("1단계 Shopling 상품 Context를 6개 goods_key 모두 새로 조회했습니다. 결과를 검수해 주세요.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "1단계 실행에 실패했습니다.");
    } finally {
      setRunning(false);
    }
  };

  const saveReview = async (goodsKey: string, reviewStatus: KeywordEngineElonLabReviewStatus) => {
    const key = `${STAGE_ONE_KEY}:${goodsKey}`;
    setMessage("");
    try {
      const response = await fetch("/api/keyword-engine-elon-lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "review_stage",
          goodsKey,
          stageKey: STAGE_ONE_KEY,
          reviewStatus,
          reviewNote: notes[key] ?? "",
        }),
      });
      const data = (await response.json()) as ApiState;
      if (!response.ok || !data.ok) throw new Error(data.message || "검수 판정을 저장하지 못했습니다.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "검수 판정을 저장하지 못했습니다.");
    }
  };

  const toggleStage = (index: number) => {
    setExpandedStages((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <div className="space-y-6 pb-16">
      <PageHeader
        title="키워드엔진 일론머스크식 분해개선작업"
        description="현재 키워드 엔진을 처음부터 한 단계씩 분해합니다. 같은 6개 상품으로 Input → Output을 직접 보고, 만족스러운 단계만 통과시킨 뒤 다음 단계로 넘어갑니다."
      />

      <section className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-950">
        <p className="font-bold">격리 테스트 원칙</p>
        <p className="mt-2">이 화면은 Shopling 상품정보를 읽기만 합니다. 키워드·상품명·가격·재고를 수정하지 않습니다. 단계 결과와 사람의 판정만 Supabase에 기록합니다.</p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-950">고정 테스트 goods_key 6개</h2>
            <p className="mt-1 text-sm text-slate-600">앞으로 단계별 비교는 이 6개를 기준으로 유지합니다.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS.map((goodsKey) => (
              <span key={goodsKey} className="rounded-full bg-slate-900 px-3 py-1 text-sm font-bold text-white">{goodsKey}</span>
            ))}
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg bg-slate-50 p-4"><p className="text-xs font-semibold text-slate-500">현재 실제 실행 연결</p><p className="mt-1 font-bold text-slate-950">1단계 · Shopling 상품 Context</p></div>
          <div className="rounded-lg bg-slate-50 p-4"><p className="text-xs font-semibold text-slate-500">6개 실행 상태</p><p className="mt-1 font-bold text-slate-950">{stageOneAllReady ? "모두 조회 완료" : "조회 필요"}</p></div>
          <div className="rounded-lg bg-slate-50 p-4"><p className="text-xs font-semibold text-slate-500">다음 단계 Gate</p><p className={`mt-1 font-bold ${stageOneAllPassed ? "text-emerald-700" : stageOneImproveCount ? "text-amber-800" : "text-slate-950"}`}>{stageOneAllPassed ? "2단계 진입 준비 완료" : stageOneImproveCount ? `개선필요 ${stageOneImproveCount}건` : "1단계 검수 필요"}</p></div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button onClick={() => void runStageOne()} disabled={running} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:bg-slate-300">
            {running ? "Shopling 조회 중…" : "1단계 · 6개 모두 다시 실행"}
          </button>
          <span className="text-xs text-slate-500">재실행하면 1단계 판정은 다시 검수대기로 초기화됩니다.</span>
        </div>
        {message ? <p className="mt-4 rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800">{message}</p> : null}
      </section>

      {loading ? <section className="rounded-xl border border-slate-200 bg-white p-5">실험 이력을 불러오는 중입니다.</section> : null}

      <section className="space-y-3">
        {KEYWORD_ENGINE_ELON_LAB_STAGES.map((stage) => {
          const expanded = expandedStages.has(stage.index);
          const isStageOne = stage.index === 1;
          const previousPassed = stage.index <= 1 ? true : stage.index === 2 ? stageOneAllPassed : false;
          const stateLabel = stage.index === 0
            ? "고정"
            : isStageOne
              ? stageOneAllPassed
                ? "통과"
                : stageOneImproveCount
                  ? "개선 중"
                  : stageOneAllReady
                    ? "검수 중"
                    : "실행 가능"
              : stage.implemented
                ? previousPassed ? "실행 가능" : "앞 단계 대기"
                : previousPassed ? "다음 개발 대상" : "잠금";
          const stateClass = stateLabel === "통과" ? "bg-emerald-100 text-emerald-800" : stateLabel === "개선 중" ? "bg-amber-100 text-amber-900" : stateLabel === "다음 개발 대상" ? "bg-blue-100 text-blue-800" : "bg-slate-100 text-slate-700";
          return (
            <article key={stage.key} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <button type="button" onClick={() => toggleStage(stage.index)} className="flex w-full items-start justify-between gap-4 p-5 text-left">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-black text-slate-500">STEP {stage.index}</span>
                    <span className={`rounded-full px-2 py-1 text-xs font-bold ${stateClass}`}>{stateLabel}</span>
                  </div>
                  <h2 className="mt-2 text-lg font-bold text-slate-950">{stage.title}</h2>
                  <p className="mt-1 text-sm text-slate-600">{stage.purpose}</p>
                </div>
                <span className="text-xl text-slate-400">{expanded ? "−" : "+"}</span>
              </button>

              {expanded ? (
                <div className="border-t border-slate-100 p-5">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                      <p className="text-xs font-black uppercase tracking-wide text-blue-700">Input</p>
                      <p className="mt-2 text-sm font-semibold text-blue-950">{stage.input}</p>
                    </div>
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                      <p className="text-xs font-black uppercase tracking-wide text-emerald-700">Output</p>
                      <p className="mt-2 text-sm font-semibold text-emerald-950">{stage.output}</p>
                    </div>
                  </div>

                  {stage.index === 0 ? (
                    <div className="mt-4 rounded-lg bg-slate-50 p-4">
                      <p className="text-sm font-bold text-slate-900">Input</p>
                      <JsonBlock value={{ goods_keys: KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS }} />
                      <p className="mt-4 text-sm font-bold text-slate-900">Output</p>
                      <JsonBlock value={{ valid: true, count: KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS.length, normalized_goods_keys: KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS }} />
                    </div>
                  ) : null}

                  {isStageOne ? (
                    <div className="mt-5 space-y-4">
                      {KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS.map((goodsKey) => {
                        const row = rowMap.get(`${STAGE_ONE_KEY}:${goodsKey}`);
                        const badge = statusBadge(row);
                        const output = outputOf(row);
                        const noteKey = `${STAGE_ONE_KEY}:${goodsKey}`;
                        return (
                          <div key={goodsKey} className="rounded-xl border border-slate-200 p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="flex items-center gap-2"><span className="text-base font-black text-slate-950">goods_key {goodsKey}</span><span className={`rounded-full px-2 py-1 text-xs font-bold ${badge.className}`}>{badge.label}</span></div>
                              {row?.engine_revision ? <span className="text-xs text-slate-400">{row.engine_revision}</span> : null}
                            </div>

                            {row ? (
                              <>
                                <div className="mt-4 grid gap-3 xl:grid-cols-2">
                                  <div><p className="mb-2 text-xs font-bold text-blue-700">실제 Input</p><JsonBlock value={row.input_payload} /></div>
                                  <div><p className="mb-2 text-xs font-bold text-emerald-700">실제 Output</p><JsonBlock value={row.output_payload} /></div>
                                </div>
                                <div className="mt-4 overflow-x-auto">
                                  <table className="min-w-full text-sm">
                                    <tbody className="divide-y divide-slate-100">
                                      <tr><th className="w-44 py-2 pr-4 text-left text-slate-500">Shopling prod_nm</th><td className="py-2 font-semibold text-slate-950">{output.productName || "—"}</td></tr>
                                      <tr><th className="py-2 pr-4 text-left text-slate-500">model_no / model_nm</th><td className="py-2">{output.modelNo || "—"} / {output.modelName || "—"}</td></tr>
                                      <tr><th className="py-2 pr-4 text-left text-slate-500">현재 site_srch</th><td className="py-2">{output.currentSiteSearch || "—"}</td></tr>
                                      <tr><th className="py-2 pr-4 text-left text-slate-500">현재 엔진 Seed</th><td className="py-2 font-bold text-blue-800">{output.currentEngineSeed || "—"} <span className="font-normal text-slate-500">({output.currentEngineSeedSource || "—"})</span></td></tr>
                                      <tr><th className="py-2 pr-4 text-left text-slate-500">상세설명</th><td className="py-2">raw {output.detailDescriptionRawLength ?? 0}자 / text {output.detailDescriptionTextLength ?? 0}자</td></tr>
                                    </tbody>
                                  </table>
                                </div>
                                {output.detailDescriptionPreview ? <details className="mt-3 rounded-lg bg-slate-50 p-3"><summary className="cursor-pointer text-sm font-bold text-slate-700">dtl_desc 텍스트 미리보기</summary><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{output.detailDescriptionPreview}</p></details> : null}
                                {row.error_message ? <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">{row.error_message}</p> : null}
                                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                                  <label className="text-xs font-bold text-slate-600">내 검수 메모</label>
                                  <textarea value={notes[noteKey] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [noteKey]: event.target.value }))} placeholder="예: prod_nm보다 model_nm을 seed로 쓰는 것이 더 적합함" className="mt-2 min-h-20 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    <button disabled={row.run_status !== "ready"} onClick={() => void saveReview(goodsKey, "pass")} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold text-white disabled:bg-slate-300">이 상품 통과</button>
                                    <button disabled={row.run_status !== "ready"} onClick={() => void saveReview(goodsKey, "improve")} className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-bold text-white disabled:bg-slate-300">개선 필요</button>
                                    <button onClick={() => void saveReview(goodsKey, "pending")} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700">판정 초기화</button>
                                  </div>
                                </div>
                              </>
                            ) : <p className="mt-4 text-sm text-slate-500">아직 실행하지 않았습니다. 위의 ‘1단계 · 6개 모두 다시 실행’을 누르세요.</p>}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}

                  {stage.index >= 2 ? (
                    <div className={`mt-4 rounded-lg p-4 text-sm ${previousPassed ? "bg-blue-50 text-blue-950" : "bg-slate-50 text-slate-600"}`}>
                      {previousPassed
                        ? stage.index === 2
                          ? "1단계 6개가 모두 통과했습니다. 이 단계가 다음 구현·개선 대상입니다. 현재 엔진의 기존 로직을 그대로 연결하기 전에 이 단계의 설계를 함께 확정합니다."
                          : "앞선 단계가 순서대로 통과될 때 열립니다."
                        : "앞 단계가 아직 통과되지 않아 잠겨 있습니다. Input/Output 정의만 먼저 확인할 수 있습니다."}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </section>
    </div>
  );
}
