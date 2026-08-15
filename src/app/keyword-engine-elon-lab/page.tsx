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

type StageTwoOutput = {
  goodsKey?: string;
  productName?: string;
  modelName?: string;
  selectedSeed?: string;
  selectedSeedSource?: string;
  selectionReason?: string;
  currentRule?: string;
  candidateOrder?: string[];
  productNameEqualsSeed?: boolean;
  modelNameEqualsSeed?: boolean;
};

const STAGE_ONE_KEY = "shopling_product_context";
const STAGE_TWO_KEY = "seed_selection";

function statusBadge(row: KeywordEngineElonLabStoredRow | undefined) {
  if (!row) return { label: "미실행", className: "bg-slate-100 text-slate-600" };
  if (row.run_status === "error") return { label: "실행오류", className: "bg-red-100 text-red-800" };
  if (row.review_status === "pass") return { label: "통과", className: "bg-emerald-100 text-emerald-800" };
  if (row.review_status === "improve") return { label: "개선필요", className: "bg-amber-100 text-amber-900" };
  return { label: "검수대기", className: "bg-blue-100 text-blue-800" };
}

function mergeStoredRows(
  current: KeywordEngineElonLabStoredRow[],
  incoming: KeywordEngineElonLabStoredRow[],
) {
  const map = new Map(
    current.map((row) => [`${row.stage_key}:${row.goods_key}`, row] as const),
  );
  for (const row of incoming) map.set(`${row.stage_key}:${row.goods_key}`, row);
  return [...map.values()];
}

function rowTime(row: KeywordEngineElonLabStoredRow | undefined) {
  const value = row?.updated_at ? Date.parse(row.updated_at) : 0;
  return Number.isFinite(value) ? value : 0;
}

function isFreshAfter(
  row: KeywordEngineElonLabStoredRow | undefined,
  previous: KeywordEngineElonLabStoredRow | undefined,
) {
  if (!row || !previous) return false;
  return rowTime(row) >= rowTime(previous);
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
  const [runningStage, setRunningStage] = useState<number | null>(null);
  const [reviewSaving, setReviewSaving] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [reviewFeedback, setReviewFeedback] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [expandedStages, setExpandedStages] = useState<Set<number>>(
    new Set([0, 1, 2, 3]),
  );

  const refresh = async () => {
    const response = await fetch("/api/keyword-engine-elon-lab", { cache: "no-store" });
    const data = (await response.json()) as ApiState;
    if (!response.ok || !data.ok) {
      throw new Error(data.message || "실험 이력을 불러오지 못했습니다.");
    }
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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
      .catch((error) =>
        setMessage(error instanceof Error ? error.message : "이력을 불러오지 못했습니다."),
      )
      .finally(() => setLoading(false));
  }, []);

  const rowMap = useMemo(() => {
    const map = new Map<string, KeywordEngineElonLabStoredRow>();
    for (const row of rows) map.set(`${row.stage_key}:${row.goods_key}`, row);
    return map;
  }, [rows]);

  const stageOneRows = KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS.map((goodsKey) =>
    rowMap.get(`${STAGE_ONE_KEY}:${goodsKey}`),
  );
  const stageOneAllReady = stageOneRows.every((row) => row?.run_status === "ready");
  const stageOnePassCount = stageOneRows.filter((row) => row?.review_status === "pass").length;
  const stageOneAllPassed = stageOnePassCount === KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS.length;
  const stageOneImproveCount = stageOneRows.filter(
    (row) => row?.review_status === "improve",
  ).length;

  const freshStageTwoRow = (goodsKey: string) => {
    const stageOne = rowMap.get(`${STAGE_ONE_KEY}:${goodsKey}`);
    const stageTwo = rowMap.get(`${STAGE_TWO_KEY}:${goodsKey}`);
    return isFreshAfter(stageTwo, stageOne) ? stageTwo : undefined;
  };
  const stageTwoRows = KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS.map(freshStageTwoRow);
  const stageTwoAllReady = stageTwoRows.every((row) => row?.run_status === "ready");
  const stageTwoPassCount = stageTwoRows.filter((row) => row?.review_status === "pass").length;
  const stageTwoAllPassed = stageTwoPassCount === KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS.length;
  const stageTwoImproveCount = stageTwoRows.filter(
    (row) => row?.review_status === "improve",
  ).length;

  const runStage = async (stageKey: string, stageNumber: number) => {
    setRunningStage(stageNumber);
    setMessage("");
    try {
      const response = await fetch("/api/keyword-engine-elon-lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "run_stage",
          stageKey,
          goodsKeys: KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS,
        }),
      });
      const data = (await response.json()) as ApiState;
      if (!response.ok || !data.ok) {
        throw new Error(data.message || `${stageNumber}단계 실행에 실패했습니다.`);
      }
      await refresh();
      setMessage(
        stageNumber === 1
          ? "1단계 Shopling 상품 Context를 6개 모두 새로 조회했습니다. 재실행으로 기존 1단계 판정은 검수대기로 초기화됐습니다."
          : "2단계 현행 Seed 결정 규칙을 6개 모두 실행했습니다. prod_nm / model_nm / 선택 seed를 비교해 검수해 주세요.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : `${stageNumber}단계 실행에 실패했습니다.`,
      );
    } finally {
      setRunningStage(null);
    }
  };

  const saveReview = async (
    stageKey: string,
    goodsKey: string,
    reviewStatus: KeywordEngineElonLabReviewStatus,
  ) => {
    const key = `${stageKey}:${goodsKey}`;
    setReviewSaving(key);
    setReviewFeedback((current) => ({ ...current, [key]: "저장 중…" }));
    try {
      const response = await fetch("/api/keyword-engine-elon-lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "review_stage",
          goodsKey,
          stageKey,
          reviewStatus,
          reviewNote: notes[key] ?? "",
        }),
      });
      const data = (await response.json()) as ApiState;
      if (!response.ok || !data.ok) {
        throw new Error(data.message || "검수 판정을 저장하지 못했습니다.");
      }
      const updatedRows = data.rows ?? [];
      if (!updatedRows.length) {
        throw new Error("서버 저장 결과 행을 확인하지 못했습니다.");
      }
      setRows((current) => mergeStoredRows(current, updatedRows));
      const label =
        reviewStatus === "pass"
          ? "통과"
          : reviewStatus === "improve"
            ? "개선필요"
            : "검수대기";
      setReviewFeedback((current) => ({
        ...current,
        [key]: `✓ ${label} 저장 완료`,
      }));
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "검수 판정을 저장하지 못했습니다.";
      setReviewFeedback((current) => ({
        ...current,
        [key]: `저장 실패 · ${errorMessage}`,
      }));
    } finally {
      setReviewSaving(null);
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

  function reviewControls(
    stageKey: string,
    goodsKey: string,
    row: KeywordEngineElonLabStoredRow,
    placeholder: string,
  ) {
    const noteKey = `${stageKey}:${goodsKey}`;
    const savingThis = reviewSaving === noteKey;
    return (
      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <label className="text-xs font-bold text-slate-600">내 검수 메모</label>
        <textarea
          value={notes[noteKey] ?? ""}
          onChange={(event) =>
            setNotes((current) => ({ ...current, [noteKey]: event.target.value }))
          }
          placeholder={placeholder}
          className="mt-2 min-h-20 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            disabled={row.run_status !== "ready" || Boolean(reviewSaving)}
            onClick={() => void saveReview(stageKey, goodsKey, "pass")}
            className={`rounded-lg px-3 py-2 text-sm font-bold text-white disabled:bg-slate-300 ${
              row.review_status === "pass" ? "bg-emerald-800 ring-2 ring-emerald-300" : "bg-emerald-700"
            }`}
          >
            {savingThis ? "저장 중…" : row.review_status === "pass" ? "✓ 통과 완료" : "이 상품 통과"}
          </button>
          <button
            disabled={row.run_status !== "ready" || Boolean(reviewSaving)}
            onClick={() => void saveReview(stageKey, goodsKey, "improve")}
            className={`rounded-lg px-3 py-2 text-sm font-bold text-white disabled:bg-slate-300 ${
              row.review_status === "improve" ? "bg-amber-700 ring-2 ring-amber-300" : "bg-amber-600"
            }`}
          >
            {savingThis ? "저장 중…" : row.review_status === "improve" ? "✓ 개선 필요" : "개선 필요"}
          </button>
          <button
            disabled={Boolean(reviewSaving)}
            onClick={() => void saveReview(stageKey, goodsKey, "pending")}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 disabled:bg-slate-100"
          >
            판정 초기화
          </button>
        </div>
        {reviewFeedback[noteKey] ? (
          <p className="mt-2 text-xs font-bold text-blue-800">{reviewFeedback[noteKey]}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-16">
      <PageHeader
        title="키워드엔진 일론머스크식 분해개선작업"
        description="같은 6개 상품으로 각 단계의 실제 Input → Output을 보고, 만족스러운 단계만 통과시킨 뒤 다음 단계로 이동합니다."
      />

      <section className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-950">
        <p className="font-bold">격리 테스트 원칙</p>
        <p className="mt-2">
          Shopling은 읽기만 합니다. 키워드·상품명·가격·재고를 수정하지 않습니다. 단계 결과와 사람의 판정만 Supabase에 기록합니다.
        </p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-950">고정 테스트 goods_key 6개</h2>
            <p className="mt-1 text-sm text-slate-600">이 6개를 모든 단계에서 동일하게 비교합니다.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS.map((goodsKey) => (
              <span key={goodsKey} className="rounded-full bg-slate-900 px-3 py-1 text-sm font-bold text-white">
                {goodsKey}
              </span>
            ))}
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg bg-slate-50 p-4">
            <p className="text-xs font-semibold text-slate-500">현재 실제 실행 연결</p>
            <p className="mt-1 font-bold text-slate-950">STEP 1~2</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-4">
            <p className="text-xs font-semibold text-slate-500">STEP 1 통과</p>
            <p className="mt-1 font-bold text-slate-950">{stageOnePassCount}/6</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-4">
            <p className="text-xs font-semibold text-slate-500">STEP 2 상태</p>
            <p className="mt-1 font-bold text-slate-950">
              {!stageOneAllPassed
                ? "STEP 1 통과 대기"
                : stageTwoAllPassed
                  ? "통과 완료"
                  : stageTwoAllReady
                    ? `검수 중 · ${stageTwoPassCount}/6 통과`
                    : "실행 가능"}
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={() => void runStage(STAGE_ONE_KEY, 1)}
            disabled={runningStage !== null}
            className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:bg-slate-300"
          >
            {runningStage === 1 ? "Shopling 조회 중…" : "1단계 · 6개 모두 다시 실행"}
          </button>
          <span className="text-xs text-slate-500">
            1단계를 재실행하면 1단계 판정이 초기화되고 기존 2단계 결과는 stale로 간주됩니다.
          </span>
        </div>
        {message ? (
          <p className="mt-4 rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800">{message}</p>
        ) : null}
      </section>

      {loading ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5">실험 이력을 불러오는 중입니다.</section>
      ) : null}

      <section className="space-y-3">
        {KEYWORD_ENGINE_ELON_LAB_STAGES.map((stage) => {
          const expanded = expandedStages.has(stage.index);
          const isStageOne = stage.index === 1;
          const isStageTwo = stage.index === 2;
          let stateLabel = "잠금";
          if (stage.index === 0) stateLabel = "고정";
          if (isStageOne) {
            stateLabel = stageOneAllPassed
              ? "통과"
              : stageOneImproveCount
                ? "개선 중"
                : stageOneAllReady
                  ? `검수 중 ${stageOnePassCount}/6`
                  : "실행 가능";
          }
          if (isStageTwo) {
            stateLabel = !stageOneAllPassed
              ? "앞 단계 대기"
              : stageTwoAllPassed
                ? "통과"
                : stageTwoImproveCount
                  ? "개선 중"
                  : stageTwoAllReady
                    ? `검수 중 ${stageTwoPassCount}/6`
                    : "실행 가능";
          }
          if (stage.index === 3 && stageTwoAllPassed) stateLabel = "다음 개발 대상";

          const stateClass =
            stateLabel === "통과"
              ? "bg-emerald-100 text-emerald-800"
              : stateLabel === "개선 중"
                ? "bg-amber-100 text-amber-900"
                : stateLabel === "다음 개발 대상" || stateLabel === "실행 가능"
                  ? "bg-blue-100 text-blue-800"
                  : "bg-slate-100 text-slate-700";

          return (
            <article key={stage.key} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <button
                type="button"
                onClick={() => toggleStage(stage.index)}
                className="flex w-full items-start justify-between gap-4 p-5 text-left"
              >
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
                      <p className="text-sm font-bold text-slate-900">실제 Input</p>
                      <JsonBlock value={{ goods_keys: KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS }} />
                      <p className="mt-4 text-sm font-bold text-slate-900">실제 Output</p>
                      <JsonBlock
                        value={{
                          valid: true,
                          count: KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS.length,
                          normalized_goods_keys: KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS,
                        }}
                      />
                    </div>
                  ) : null}

                  {isStageOne ? (
                    <div className="mt-5 space-y-4">
                      {KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS.map((goodsKey) => {
                        const row = rowMap.get(`${STAGE_ONE_KEY}:${goodsKey}`);
                        const badge = statusBadge(row);
                        const output = (row?.output_payload ?? {}) as StageOneOutput;
                        return (
                          <div key={goodsKey} className="rounded-xl border border-slate-200 p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="flex items-center gap-2">
                                <span className="text-base font-black text-slate-950">goods_key {goodsKey}</span>
                                <span className={`rounded-full px-2 py-1 text-xs font-bold ${badge.className}`}>{badge.label}</span>
                              </div>
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
                                      <tr><th className="py-2 pr-4 text-left text-slate-500">현행 엔진 seed 후보</th><td className="py-2 font-bold text-blue-800">{output.currentEngineSeed || "—"} <span className="font-normal text-slate-500">({output.currentEngineSeedSource || "—"})</span></td></tr>
                                      <tr><th className="py-2 pr-4 text-left text-slate-500">상세설명</th><td className="py-2">raw {output.detailDescriptionRawLength ?? 0}자 / text {output.detailDescriptionTextLength ?? 0}자</td></tr>
                                    </tbody>
                                  </table>
                                </div>
                                {output.detailDescriptionPreview ? (
                                  <details className="mt-3 rounded-lg bg-slate-50 p-3">
                                    <summary className="cursor-pointer text-sm font-bold text-slate-700">dtl_desc 텍스트 미리보기</summary>
                                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{output.detailDescriptionPreview}</p>
                                  </details>
                                ) : null}
                                {row.error_message ? <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">{row.error_message}</p> : null}
                                {reviewControls(STAGE_ONE_KEY, goodsKey, row, "예: 이 Context가 다음 Seed 판단에 충분한지 기록")}
                              </>
                            ) : (
                              <p className="mt-4 text-sm text-slate-500">아직 실행하지 않았습니다. 위의 1단계 실행 버튼을 누르세요.</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}

                  {isStageTwo ? (
                    <div className="mt-5 space-y-4">
                      {!stageOneAllPassed ? (
                        <div className="rounded-lg bg-slate-50 p-4 text-sm font-semibold text-slate-700">
                          STEP 1이 현재 {stageOnePassCount}/6 통과 상태입니다. 6개 모두 통과하면 STEP 2 실행 버튼이 활성화됩니다.
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
                          <button
                            onClick={() => void runStage(STAGE_TWO_KEY, 2)}
                            disabled={runningStage !== null}
                            className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:bg-slate-300"
                          >
                            {runningStage === 2 ? "Seed 결정 실행 중…" : stageTwoAllReady ? "2단계 · 6개 모두 다시 실행" : "2단계 · 6개 모두 실행"}
                          </button>
                          <span className="text-xs font-semibold text-blue-900">
                            현행 규칙 그대로 실행: prod_nm → model_nm → goods_key
                          </span>
                        </div>
                      )}

                      {stageOneAllPassed
                        ? KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS.map((goodsKey) => {
                            const row = freshStageTwoRow(goodsKey);
                            const badge = statusBadge(row);
                            const output = (row?.output_payload ?? {}) as StageTwoOutput;
                            return (
                              <div key={goodsKey} className="rounded-xl border border-slate-200 p-4">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <div className="flex items-center gap-2">
                                    <span className="text-base font-black text-slate-950">goods_key {goodsKey}</span>
                                    <span className={`rounded-full px-2 py-1 text-xs font-bold ${badge.className}`}>{badge.label}</span>
                                  </div>
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
                                          <tr><th className="w-44 py-2 pr-4 text-left text-slate-500">prod_nm</th><td className="py-2">{output.productName || "—"}</td></tr>
                                          <tr><th className="py-2 pr-4 text-left text-slate-500">model_nm</th><td className="py-2">{output.modelName || "—"}</td></tr>
                                          <tr><th className="py-2 pr-4 text-left text-slate-500">선택 Seed</th><td className="py-2 text-base font-black text-blue-800">{output.selectedSeed || "—"}</td></tr>
                                          <tr><th className="py-2 pr-4 text-left text-slate-500">선택 Source</th><td className="py-2 font-bold">{output.selectedSeedSource || "—"}</td></tr>
                                          <tr><th className="py-2 pr-4 text-left text-slate-500">현행 선택 규칙</th><td className="py-2 font-mono text-xs">{output.currentRule || "—"}</td></tr>
                                          <tr><th className="py-2 pr-4 text-left text-slate-500">선택 근거</th><td className="py-2">{output.selectionReason || "—"}</td></tr>
                                        </tbody>
                                      </table>
                                    </div>
                                    {reviewControls(STAGE_TWO_KEY, goodsKey, row, "예: prod_nm 대신 model_nm을 seed로 써야 함 / 현행 선택이 적합함")}
                                  </>
                                ) : (
                                  <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
                                    아직 최신 STEP 2 결과가 없습니다. 위의 2단계 실행 버튼을 누르세요.
                                  </p>
                                )}
                              </div>
                            );
                          })
                        : null}
                    </div>
                  ) : null}

                  {stage.index >= 3 ? (
                    <div className={`mt-4 rounded-lg p-4 text-sm ${stage.index === 3 && stageTwoAllPassed ? "bg-blue-50 text-blue-950" : "bg-slate-50 text-slate-600"}`}>
                      {stage.index === 3 && stageTwoAllPassed
                        ? "STEP 2의 6개 결과가 모두 통과했습니다. STEP 3 Seed 잡음 제거가 다음 구현·개선 대상입니다."
                        : "앞 단계가 아직 통과되지 않았거나 아직 실제 실행이 연결되지 않았습니다. Input/Output 정의만 확인할 수 있습니다."}
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
