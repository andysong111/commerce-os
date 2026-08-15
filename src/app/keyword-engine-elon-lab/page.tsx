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
  productName?: string;
  modelNo?: string;
  modelName?: string;
  currentSiteSearch?: string;
  detailDescriptionRawLength?: number;
  detailDescriptionTextLength?: number;
  currentEngineSeed?: string;
  currentEngineSeedSource?: string;
};

type StageTwoOutput = {
  productName?: string;
  modelName?: string;
  selectedSeed?: string;
  selectedSeedSource?: string;
  selectionReason?: string;
  currentRule?: string;
};

type StageThreeOutput = {
  rawSeed?: string;
  cleanedSeed?: string;
  removedExpressions?: Array<{ term?: string; count?: number }>;
  changed?: boolean;
  warning?: string;
  currentRule?: string;
};

type StageFourOutput = {
  baseSeed?: string;
  rawParts?: string[];
  probeTerms?: string[];
  excludedTerms?: Array<{ term?: string; reason?: string }>;
  duplicateTerms?: string[];
  probes?: string[];
  probeCount?: number;
  currentRule?: string;
  warning?: string;
};

const STAGE_ONE_KEY = "shopling_product_context";
const STAGE_TWO_KEY = "seed_selection";
const STAGE_THREE_KEY = "seed_cleaning";
const STAGE_FOUR_KEY = "probe_generation";

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 text-xs leading-5 text-slate-100">
      {JSON.stringify(value ?? {}, null, 2)}
    </pre>
  );
}

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
  const parsed = row?.updated_at ? Date.parse(row.updated_at) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function freshAfter(
  row: KeywordEngineElonLabStoredRow | undefined,
  previous: KeywordEngineElonLabStoredRow | undefined,
) {
  return Boolean(row && previous && rowTime(row) >= rowTime(previous));
}

function passCount(rows: Array<KeywordEngineElonLabStoredRow | undefined>) {
  return rows.filter((row) => row?.review_status === "pass").length;
}

function improveCount(rows: Array<KeywordEngineElonLabStoredRow | undefined>) {
  return rows.filter((row) => row?.review_status === "improve").length;
}

function allReady(rows: Array<KeywordEngineElonLabStoredRow | undefined>) {
  return (
    rows.length === KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS.length &&
    rows.every((row) => row?.run_status === "ready")
  );
}

function textList(values: string[] | undefined) {
  return values?.length ? values.join(" · ") : "없음";
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
    new Set([0, 1, 2, 3, 4, 5]),
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

  const stageOneRow = (goodsKey: string) => rowMap.get(`${STAGE_ONE_KEY}:${goodsKey}`);
  const stageTwoRow = (goodsKey: string) => {
    const previous = stageOneRow(goodsKey);
    const row = rowMap.get(`${STAGE_TWO_KEY}:${goodsKey}`);
    return freshAfter(row, previous) ? row : undefined;
  };
  const stageThreeRow = (goodsKey: string) => {
    const previous = stageTwoRow(goodsKey);
    const row = rowMap.get(`${STAGE_THREE_KEY}:${goodsKey}`);
    return freshAfter(row, previous) ? row : undefined;
  };
  const stageFourRow = (goodsKey: string) => {
    const previous = stageThreeRow(goodsKey);
    const row = rowMap.get(`${STAGE_FOUR_KEY}:${goodsKey}`);
    return freshAfter(row, previous) ? row : undefined;
  };

  const stageOneRows = KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS.map(stageOneRow);
  const stageTwoRows = KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS.map(stageTwoRow);
  const stageThreeRows = KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS.map(stageThreeRow);
  const stageFourRows = KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS.map(stageFourRow);

  const stageOnePass = passCount(stageOneRows);
  const stageTwoPass = passCount(stageTwoRows);
  const stageThreePass = passCount(stageThreeRows);
  const stageFourPass = passCount(stageFourRows);
  const stageOnePassed = stageOnePass === 6;
  const stageTwoPassed = stageTwoPass === 6;
  const stageThreePassed = stageThreePass === 6;
  const stageFourPassed = stageFourPass === 6;
  const stageOneReady = allReady(stageOneRows);
  const stageTwoReady = allReady(stageTwoRows);
  const stageThreeReady = allReady(stageThreeRows);
  const stageFourReady = allReady(stageFourRows);

  const runStage = async (
    stageKey: string,
    stageNumber: number,
    alreadyExecuted: boolean,
  ) => {
    if (alreadyExecuted) {
      const confirmed = window.confirm(
        `STEP ${stageNumber}을 다시 실행하면 이 단계의 기존 통과/개선필요 판정이 모두 검수대기로 초기화됩니다. 정말 재실행하시겠습니까?`,
      );
      if (!confirmed) return;
    }

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
        throw new Error(data.message || `STEP ${stageNumber} 실행에 실패했습니다.`);
      }
      await refresh();
      const names: Record<number, string> = {
        1: "Shopling 상품 Context",
        2: "현행 Seed 결정",
        3: "현행 Seed 잡음 제거",
        4: "현행 Probe 단어 분해",
      };
      setMessage(`STEP ${stageNumber} ${names[stageNumber] ?? ""} 6개 실행 완료 · 결과를 검수해 주세요.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : `STEP ${stageNumber} 실행에 실패했습니다.`,
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
      if (!updatedRows.length) throw new Error("서버 저장 결과 행을 확인하지 못했습니다.");
      setRows((current) => mergeStoredRows(current, updatedRows));
      const label =
        reviewStatus === "pass"
          ? "통과"
          : reviewStatus === "improve"
            ? "개선필요"
            : "검수대기";
      setReviewFeedback((current) => ({ ...current, [key]: `✓ ${label} 저장 완료` }));
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

  const reviewControls = (
    stageKey: string,
    goodsKey: string,
    row: KeywordEngineElonLabStoredRow,
    placeholder: string,
  ) => {
    const key = `${stageKey}:${goodsKey}`;
    const savingThis = reviewSaving === key;
    return (
      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <label className="text-xs font-bold text-slate-600">내 검수 메모</label>
        <textarea
          value={notes[key] ?? ""}
          onChange={(event) =>
            setNotes((current) => ({ ...current, [key]: event.target.value }))
          }
          placeholder={placeholder}
          className="mt-2 min-h-20 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            disabled={row.run_status !== "ready" || Boolean(reviewSaving)}
            onClick={() => void saveReview(stageKey, goodsKey, "pass")}
            className={`rounded-lg px-3 py-2 text-sm font-bold text-white disabled:bg-slate-300 ${
              row.review_status === "pass"
                ? "bg-emerald-800 ring-2 ring-emerald-300"
                : "bg-emerald-700"
            }`}
          >
            {savingThis
              ? "저장 중…"
              : row.review_status === "pass"
                ? "✓ 통과 완료"
                : "이 상품 통과"}
          </button>
          <button
            disabled={row.run_status !== "ready" || Boolean(reviewSaving)}
            onClick={() => void saveReview(stageKey, goodsKey, "improve")}
            className={`rounded-lg px-3 py-2 text-sm font-bold text-white disabled:bg-slate-300 ${
              row.review_status === "improve"
                ? "bg-amber-700 ring-2 ring-amber-300"
                : "bg-amber-600"
            }`}
          >
            {savingThis
              ? "저장 중…"
              : row.review_status === "improve"
                ? "✓ 개선 필요"
                : "개선 필요"}
          </button>
          <button
            disabled={Boolean(reviewSaving)}
            onClick={() => void saveReview(stageKey, goodsKey, "pending")}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 disabled:bg-slate-100"
          >
            판정 초기화
          </button>
        </div>
        {reviewFeedback[key] ? (
          <p className="mt-2 text-xs font-bold text-blue-800">{reviewFeedback[key]}</p>
        ) : null}
      </div>
    );
  };

  const stateForStage = (index: number) => {
    if (index === 0) return "고정";
    const stats = [
      null,
      { previous: true, ready: stageOneReady, pass: stageOnePass, improve: improveCount(stageOneRows) },
      { previous: stageOnePassed, ready: stageTwoReady, pass: stageTwoPass, improve: improveCount(stageTwoRows) },
      { previous: stageTwoPassed, ready: stageThreeReady, pass: stageThreePass, improve: improveCount(stageThreeRows) },
      { previous: stageThreePassed, ready: stageFourReady, pass: stageFourPass, improve: improveCount(stageFourRows) },
    ];
    if (index >= 1 && index <= 4) {
      const stat = stats[index]!;
      if (!stat.previous) return "앞 단계 대기";
      if (stat.pass === 6) return "통과";
      if (stat.improve) return "개선 중";
      if (stat.ready) return `검수 중 ${stat.pass}/6`;
      return "실행 가능";
    }
    if (index === 5 && stageFourPassed) return "다음 개발 대상";
    return "잠금";
  };

  const executionButton = (
    stageNumber: number,
    stageKey: string,
    ready: boolean,
    label: string,
  ) => (
    <button
      onClick={() => void runStage(stageKey, stageNumber, ready)}
      disabled={runningStage !== null}
      className={
        ready
          ? "rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-900 disabled:bg-slate-200"
          : "rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:bg-slate-300"
      }
    >
      {runningStage === stageNumber
        ? `STEP ${stageNumber} 실행 중…`
        : ready
          ? `STEP ${stageNumber} 결과 재실행 · 판정 초기화`
          : `STEP ${stageNumber} · 6개 모두 실행`}
      {!ready && label ? null : null}
    </button>
  );

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
        <div className="mt-4 grid gap-3 md:grid-cols-5">
          <div className="rounded-lg bg-slate-50 p-4">
            <p className="text-xs font-semibold text-slate-500">실제 실행 연결</p>
            <p className="mt-1 font-bold text-slate-950">STEP 1~4</p>
          </div>
          {[stageOnePass, stageTwoPass, stageThreePass, stageFourPass].map((count, index) => (
            <div key={index} className="rounded-lg bg-slate-50 p-4">
              <p className="text-xs font-semibold text-slate-500">STEP {index + 1}</p>
              <p className="mt-1 font-bold text-slate-950">{count}/6 통과</p>
            </div>
          ))}
        </div>
        {message ? (
          <p className="mt-4 rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800">
            {message}
          </p>
        ) : null}
      </section>

      {loading ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5">실험 이력을 불러오는 중입니다.</section>
      ) : null}

      <section className="space-y-3">
        {KEYWORD_ENGINE_ELON_LAB_STAGES.map((stage) => {
          const expanded = expandedStages.has(stage.index);
          const stateLabel = stateForStage(stage.index);
          const stateClass =
            stateLabel === "통과"
              ? "bg-emerald-100 text-emerald-800"
              : stateLabel === "개선 중"
                ? "bg-amber-100 text-amber-900"
                : stateLabel === "실행 가능" || stateLabel === "다음 개발 대상"
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
                      <p className="text-sm font-bold">실제 Input</p>
                      <JsonBlock value={{ goods_keys: KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS }} />
                      <p className="mt-4 text-sm font-bold">실제 Output</p>
                      <JsonBlock value={{ valid: true, count: 6, normalized_goods_keys: KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS }} />
                    </div>
                  ) : null}

                  {stage.index === 1 ? (
                    <div className="mt-5 space-y-4">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                        {executionButton(1, STAGE_ONE_KEY, stageOneReady, "Shopling Context")}
                        {stageOneReady ? <span className="ml-3 text-xs font-semibold text-amber-800">재실행은 기존 판정을 초기화합니다.</span> : null}
                      </div>
                      {KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS.map((goodsKey) => {
                        const row = stageOneRow(goodsKey);
                        const output = (row?.output_payload ?? {}) as StageOneOutput;
                        const badge = statusBadge(row);
                        return (
                          <div key={goodsKey} className="rounded-xl border border-slate-200 p-4">
                            <div className="flex items-center gap-2"><b>goods_key {goodsKey}</b><span className={`rounded-full px-2 py-1 text-xs font-bold ${badge.className}`}>{badge.label}</span></div>
                            {row ? <>
                              <div className="mt-4 grid gap-3 xl:grid-cols-2"><div><p className="mb-2 text-xs font-bold text-blue-700">실제 Input</p><JsonBlock value={row.input_payload} /></div><div><p className="mb-2 text-xs font-bold text-emerald-700">실제 Output</p><JsonBlock value={row.output_payload} /></div></div>
                              <div className="mt-4 space-y-2 text-sm"><p><b>prod_nm:</b> {output.productName || "—"}</p><p><b>model_no / model_nm:</b> {output.modelNo || "—"} / {output.modelName || "—"}</p><p><b>현재 site_srch:</b> {output.currentSiteSearch || "—"}</p><p><b>현행 seed 후보:</b> {output.currentEngineSeed || "—"} ({output.currentEngineSeedSource || "—"})</p><p><b>상세설명:</b> raw {output.detailDescriptionRawLength ?? 0} / text {output.detailDescriptionTextLength ?? 0}</p></div>
                              {reviewControls(STAGE_ONE_KEY, goodsKey, row, "이 Context가 다음 Seed 판단에 충분한지 기록")}
                            </> : <p className="mt-3 text-sm text-slate-500">아직 실행하지 않았습니다.</p>}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}

                  {stage.index === 2 ? (
                    <div className="mt-5 space-y-4">
                      {!stageOnePassed ? <p className="rounded-lg bg-slate-50 p-4 text-sm">STEP 1이 {stageOnePass}/6 통과 상태입니다.</p> : <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">{executionButton(2, STAGE_TWO_KEY, stageTwoReady, "Seed 결정")}<span className="ml-3 text-xs font-semibold text-slate-700">현행 규칙: prod_nm → model_nm → goods_key</span></div>}
                      {stageOnePassed ? KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS.map((goodsKey) => {
                        const row = stageTwoRow(goodsKey);
                        const output = (row?.output_payload ?? {}) as StageTwoOutput;
                        const badge = statusBadge(row);
                        return <div key={goodsKey} className="rounded-xl border border-slate-200 p-4"><div className="flex items-center gap-2"><b>goods_key {goodsKey}</b><span className={`rounded-full px-2 py-1 text-xs font-bold ${badge.className}`}>{badge.label}</span></div>{row ? <><div className="mt-4 grid gap-3 xl:grid-cols-2"><div><p className="mb-2 text-xs font-bold text-blue-700">실제 Input</p><JsonBlock value={row.input_payload} /></div><div><p className="mb-2 text-xs font-bold text-emerald-700">실제 Output</p><JsonBlock value={row.output_payload} /></div></div><div className="mt-4 space-y-2 text-sm"><p><b>prod_nm:</b> {output.productName || "—"}</p><p><b>model_nm:</b> {output.modelName || "—"}</p><p><b>선택 Seed:</b> <span className="font-bold text-blue-800">{output.selectedSeed || "—"}</span></p><p><b>Source:</b> {output.selectedSeedSource || "—"}</p><p><b>근거:</b> {output.selectionReason || "—"}</p></div>{reviewControls(STAGE_TWO_KEY, goodsKey, row, "현행 Seed 선택이 적합한지 기록")}</> : <p className="mt-3 text-sm text-slate-500">STEP 2 실행이 필요합니다.</p>}</div>;
                      }) : null}
                    </div>
                  ) : null}

                  {stage.index === 3 ? (
                    <div className="mt-5 space-y-4">
                      {!stageTwoPassed ? <p className="rounded-lg bg-slate-50 p-4 text-sm">STEP 2가 {stageTwoPass}/6 통과 상태입니다.</p> : <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">{executionButton(3, STAGE_THREE_KEY, stageThreeReady, "Seed 잡음 제거")}<span className="ml-3 text-xs font-semibold text-slate-700">현행 제거어: 색상랜덤 · 랜덤색상 · 색상 랜덤 · 랜덤 · 무료배송 · 당일배송</span></div>}
                      {stageTwoPassed ? KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS.map((goodsKey) => {
                        const row = stageThreeRow(goodsKey);
                        const output = (row?.output_payload ?? {}) as StageThreeOutput;
                        const badge = statusBadge(row);
                        return <div key={goodsKey} className="rounded-xl border border-slate-200 p-4"><div className="flex items-center gap-2"><b>goods_key {goodsKey}</b><span className={`rounded-full px-2 py-1 text-xs font-bold ${badge.className}`}>{badge.label}</span></div>{row ? <><div className="mt-4 grid gap-3 xl:grid-cols-2"><div><p className="mb-2 text-xs font-bold text-blue-700">실제 Input</p><JsonBlock value={row.input_payload} /></div><div><p className="mb-2 text-xs font-bold text-emerald-700">실제 Output</p><JsonBlock value={row.output_payload} /></div></div><div className="mt-4 space-y-2 text-sm"><p><b>정제 전:</b> {output.rawSeed || "—"}</p><p><b>정제 후:</b> <span className="font-bold text-blue-800">{output.cleanedSeed || "—"}</span></p><p><b>변경:</b> {output.changed ? "변경됨" : "변경 없음"}</p><p><b>제거:</b> {output.removedExpressions?.length ? output.removedExpressions.map((item) => `${item.term}×${item.count ?? 1}`).join(" · ") : "없음"}</p><p><b>경고:</b> {output.warning || "없음"}</p></div>{reviewControls(STAGE_THREE_KEY, goodsKey, row, "잡음 제거 결과가 적합한지 기록")}</> : <p className="mt-3 text-sm text-slate-500">STEP 3 실행이 필요합니다.</p>}</div>;
                      }) : null}
                    </div>
                  ) : null}

                  {stage.index === 4 ? (
                    <div className="mt-5 space-y-4">
                      {!stageThreePassed ? (
                        <p className="rounded-lg bg-slate-50 p-4 text-sm">STEP 3가 {stageThreePass}/6 통과 상태입니다.</p>
                      ) : (
                        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                          {executionButton(4, STAGE_FOUR_KEY, stageFourReady, "Probe 단어 분해")}
                          <span className="ml-3 text-xs font-semibold text-blue-900">
                            현행 규칙: 정제 Seed 전체 + 공백 분해한 2자 이상 고유 구성어
                          </span>
                        </div>
                      )}
                      {stageThreePassed ? KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS.map((goodsKey) => {
                        const row = stageFourRow(goodsKey);
                        const output = (row?.output_payload ?? {}) as StageFourOutput;
                        const badge = statusBadge(row);
                        return (
                          <div key={goodsKey} className="rounded-xl border border-slate-200 p-4">
                            <div className="flex items-center gap-2"><b>goods_key {goodsKey}</b><span className={`rounded-full px-2 py-1 text-xs font-bold ${badge.className}`}>{badge.label}</span></div>
                            {row ? <>
                              <div className="mt-4 grid gap-3 xl:grid-cols-2"><div><p className="mb-2 text-xs font-bold text-blue-700">실제 Input</p><JsonBlock value={row.input_payload} /></div><div><p className="mb-2 text-xs font-bold text-emerald-700">실제 Output</p><JsonBlock value={row.output_payload} /></div></div>
                              <div className="mt-4 overflow-x-auto"><table className="min-w-full text-sm"><tbody className="divide-y divide-slate-100"><tr><th className="w-44 py-2 pr-4 text-left text-slate-500">정제 Seed</th><td className="py-2 font-bold text-blue-800">{output.baseSeed || "—"}</td></tr><tr><th className="py-2 pr-4 text-left text-slate-500">공백 분해 원소</th><td className="py-2">{textList(output.rawParts)}</td></tr><tr><th className="py-2 pr-4 text-left text-slate-500">2자 이상 Probe term</th><td className="py-2">{textList(output.probeTerms)}</td></tr><tr><th className="py-2 pr-4 text-left text-slate-500">제외 단어</th><td className="py-2">{output.excludedTerms?.length ? output.excludedTerms.map((item) => `${item.term}(${item.reason})`).join(" · ") : "없음"}</td></tr><tr><th className="py-2 pr-4 text-left text-slate-500">최종 Probe 목록</th><td className="py-2 font-semibold">{textList(output.probes)}</td></tr><tr><th className="py-2 pr-4 text-left text-slate-500">Probe 수</th><td className="py-2">{output.probeCount ?? 0}</td></tr><tr><th className="py-2 pr-4 text-left text-slate-500">경고</th><td className="py-2">{output.warning || "없음"}</td></tr></tbody></table></div>
                              {reviewControls(STAGE_FOUR_KEY, goodsKey, row, "전체 Seed + 구성어 Probe 구성이 적합한지 기록")}
                            </> : <p className="mt-3 rounded-lg bg-blue-50 p-4 text-sm font-semibold text-blue-900">STEP 3는 6/6 통과했습니다. 위의 STEP 4 · 6개 모두 실행 버튼을 누르세요.</p>}
                          </div>
                        );
                      }) : null}
                    </div>
                  ) : null}

                  {stage.index >= 5 ? (
                    <div className={`mt-4 rounded-lg p-4 text-sm ${stage.index === 5 && stageFourPassed ? "bg-blue-50 text-blue-950" : "bg-slate-50 text-slate-600"}`}>
                      {stage.index === 5 && stageFourPassed
                        ? "STEP 4의 6개 결과가 모두 통과했습니다. STEP 5 연관검색어 수집이 다음 구현·개선 대상입니다."
                        : "앞 단계가 아직 통과되지 않았거나 실제 실행이 연결되지 않았습니다. Input/Output 정의만 확인할 수 있습니다."}
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
