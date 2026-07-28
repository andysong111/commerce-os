"use client";

import { useState } from "react";

const STORAGE_KEY = "shoplingBarcodeSync.currentRequestId";
const VERIFIED_CANARY_KEYS =
  "117305,117308,117311,100049,100034,102648,110791,116737,109791,121102";

type RunMode = "plan" | "canary" | "apply" | "retry";
type ApplyScope = "oldest_1000" | "oldest_2000" | "all";
type DispatchResult = {
  status?: string;
  message?: string;
  requestId?: string;
  githubActionsUrl?: string;
};
type ActionsResult = {
  status?: string;
  message?: string;
  requestId?: string;
  runId?: number;
  runUrl?: string;
  runStatus?: string;
  runConclusion?: string | null;
  artifactName?: string;
  summary?: Record<string, unknown>;
};

type RunAction = {
  key: string;
  label: string;
  description: string;
  mode: RunMode;
  scope: ApplyScope;
  tone: "safe" | "test" | "write";
};

const RUN_ACTIONS: RunAction[] = [
  {
    key: "plan",
    label: "전체 상품 점검",
    description: "샵플링을 읽기만 하며 실제 바코드는 수정하지 않습니다.",
    mode: "plan",
    scope: "oldest_2000",
    tone: "safe",
  },
  {
    key: "canary",
    label: "10개 테스트 반영",
    description: "검증된 10개 상품만 실제 반영하고 즉시 다시 조회합니다.",
    mode: "canary",
    scope: "oldest_2000",
    tone: "test",
  },
  {
    key: "oldest_1000",
    label: "오래된 순 1,000개 반영",
    description: "아직 맞지 않은 상품 중 오래된 순서로 최대 1,000개를 처리합니다.",
    mode: "apply",
    scope: "oldest_1000",
    tone: "write",
  },
  {
    key: "oldest_2000",
    label: "오래된 순 2,000개 반영",
    description: "아직 맞지 않은 상품 중 오래된 순서로 최대 2,000개를 처리합니다.",
    mode: "apply",
    scope: "oldest_2000",
    tone: "write",
  },
  {
    key: "all",
    label: "남은 전체 반영",
    description: "이미 완료된 상품은 건너뛰고 남은 변경 필요 상품을 모두 처리합니다.",
    mode: "apply",
    scope: "all",
    tone: "write",
  },
];

const VERIFIED_METRICS = [
  ["조회 상품", "10,267개"],
  ["전체 옵션", "20,126개"],
  ["변경 필요 상품", "8,272개"],
  ["이미 동일", "1,995개"],
  ["구조 차단", "0개"],
  ["조회 오류", "0개"],
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function displayValue(value: unknown) {
  if (typeof value === "number") return value.toLocaleString("ko-KR");
  if (typeof value === "string" && value) return value;
  if (typeof value === "boolean") return value ? "예" : "아니오";
  return "-";
}

function confirmationText(mode: RunMode) {
  if (mode === "canary") return "테스트반영";
  if (mode === "apply") return "전체반영";
  if (mode === "retry") return "실패재시도";
  return "";
}

function shouldProceed(action: RunAction) {
  if (action.mode === "plan") {
    return window.confirm(
      "전체 상품을 읽기 전용으로 점검합니다. 실제 바코드는 바뀌지 않으며 완료까지 시간이 걸릴 수 있습니다. 시작할까요?",
    );
  }
  if (action.mode === "canary") {
    return window.confirm(
      "검증된 10개 상품의 옵션 바코드를 실제로 수정하고 재조회 검증합니다. GitHub Secret의 SHOPLING_ENABLE_WRITE가 true인 경우에만 실행됩니다. 시작할까요?",
    );
  }
  return window.confirm(
    `${action.label}을 실제로 시작합니다. 테스트 10개가 정상 통과한 뒤에만 실행해야 합니다. 계속할까요?`,
  );
}

export function ShoplingBarcodeSyncRunner() {
  const [runningKey, setRunningKey] = useState("");
  const [fetchingResult, setFetchingResult] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<DispatchResult | null>(null);
  const [actionsResult, setActionsResult] = useState<ActionsResult | null>(null);
  const [currentRequestId, setCurrentRequestId] = useState(() =>
    typeof window === "undefined" ? "" : window.localStorage.getItem(STORAGE_KEY) ?? "",
  );
  const [retryGoodsKeys, setRetryGoodsKeys] = useState("");

  const rememberRequestId = (value: string) => {
    setCurrentRequestId(value);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, value);
  };

  const run = async (action: RunAction, targetGoodsKeys = "") => {
    if (runningKey || !shouldProceed(action)) return;
    setRunningKey(action.key);
    setDispatchResult(null);
    setActionsResult(null);
    try {
      const response = await fetch("/api/shopling-barcode-sync/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: action.mode,
          apply_scope: action.scope,
          target_goods_keys:
            action.mode === "canary" ? VERIFIED_CANARY_KEYS : targetGoodsKeys,
          confirm_text: confirmationText(action.mode),
          canary_count: 10,
        }),
      });
      const data = (await response.json()) as DispatchResult;
      setDispatchResult(data);
      if (data.requestId) rememberRequestId(data.requestId);
    } catch (error) {
      setDispatchResult({
        status: "error",
        message: error instanceof Error ? error.message : "실행 요청 중 오류가 발생했습니다.",
      });
    } finally {
      setRunningKey("");
    }
  };

  const fetchResult = async () => {
    if (fetchingResult || !currentRequestId.trim()) return;
    setFetchingResult(true);
    try {
      const response = await fetch(
        `/api/shopling-barcode-sync/result?request_id=${encodeURIComponent(currentRequestId.trim())}`,
      );
      setActionsResult((await response.json()) as ActionsResult);
    } catch (error) {
      setActionsResult({
        status: "error",
        message: error instanceof Error ? error.message : "결과 확인 중 오류가 발생했습니다.",
      });
    } finally {
      setFetchingResult(false);
    }
  };

  const retryAction: RunAction = {
    key: "retry",
    label: "실패 항목만 다시 실행",
    description: "실패 보고서에 나온 goods_key만 다시 처리합니다.",
    mode: "retry",
    scope: "oldest_2000",
    tone: "test",
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-950">검증된 전체 점검 기준</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              옵션 바코드를 같은 위치의 옵션자체관리코드와 정확히 맞춥니다. 자체관리코드가 비어 있는 옵션은 해당 위치의 바코드도 비웁니다.
            </p>
          </div>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
            읽기 전용 PLAN 통과
          </span>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {VERIFIED_METRICS.map(([label, value]) => (
            <div key={label} className="rounded-xl bg-slate-50 p-4">
              <p className="text-xs font-semibold text-slate-500">{label}</p>
              <p className="mt-1 text-xl font-bold text-slate-950">{value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold text-slate-950">실행</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          먼저 전체 상품 점검, 다음으로 10개 테스트 반영, 마지막으로 1,000개 또는 2,000개 반영 순서로 진행합니다.
        </p>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {RUN_ACTIONS.map((action) => (
            <div key={action.key} className="rounded-xl border border-slate-200 p-4">
              <h3 className="font-bold text-slate-950">{action.label}</h3>
              <p className="mt-1 min-h-10 text-sm leading-5 text-slate-600">{action.description}</p>
              <button
                type="button"
                onClick={() => run(action)}
                disabled={Boolean(runningKey)}
                className={`mt-4 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:bg-slate-400 ${
                  action.tone === "safe"
                    ? "bg-slate-900"
                    : action.tone === "test"
                      ? "bg-amber-600"
                      : "bg-red-600"
                }`}
              >
                {runningKey === action.key ? "실행 요청 중..." : action.label}
              </button>
            </div>
          ))}
        </div>
        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          실제 반영은 외부 저장소의 <code>SHOPLING_ENABLE_WRITE=true</code>일 때만 가능합니다. 현재 값이 false라면 읽기 점검은 가능하지만 실제 반영은 엔진에서 차단됩니다.
        </div>
      </section>

      <details className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <summary className="cursor-pointer text-lg font-bold text-slate-950">고급: 실패 항목 재시도</summary>
        <p className="mt-3 text-sm text-slate-600">실패 결과에 기록된 숫자 goods_key만 쉼표나 줄바꿈으로 입력합니다.</p>
        <textarea
          value={retryGoodsKeys}
          onChange={(event) => setRetryGoodsKeys(event.target.value)}
          className="mt-3 min-h-28 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="예: 117305,117308"
        />
        <button
          type="button"
          onClick={() => run(retryAction, retryGoodsKeys)}
          disabled={Boolean(runningKey) || !retryGoodsKeys.trim()}
          className="mt-3 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {runningKey === "retry" ? "재시도 요청 중..." : "실패 항목만 다시 실행"}
        </button>
      </details>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold text-slate-950">현재 실행과 결과</h2>
        <label className="mt-4 block text-sm font-semibold text-slate-700">
          요청 추적 ID
          <input
            value={currentRequestId}
            onChange={(event) => rememberRequestId(event.target.value.trim())}
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
            placeholder="barcode-sync-..."
          />
        </label>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={fetchResult}
            disabled={fetchingResult || !currentRequestId.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {fetchingResult ? "결과 확인 중..." : "현재 실행 결과 확인"}
          </button>
          {dispatchResult?.githubActionsUrl ? (
            <a
              href={dispatchResult.githubActionsUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
            >
              GitHub Actions 열기
            </a>
          ) : null}
          {actionsResult?.runUrl ? (
            <a
              href={actionsResult.runUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
            >
              해당 실행 열기
            </a>
          ) : null}
        </div>

        {dispatchResult ? (
          <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm">
            <p className="font-semibold text-slate-900">실행 요청: {dispatchResult.status ?? "-"}</p>
            <p className="mt-1 text-slate-600">{dispatchResult.message}</p>
          </div>
        ) : null}

        {actionsResult ? <ResultPanel result={actionsResult} /> : null}
      </section>
    </div>
  );
}

function ResultPanel({ result }: { result: ActionsResult }) {
  const summary = result.summary;
  const selection = isRecord(summary?.execution_selection) ? summary.execution_selection : null;
  const execution = isRecord(summary?.execution) ? summary.execution : null;
  const metrics: Array<[string, unknown]> = summary
    ? [
        ["조회 상품", summary.scanned_products],
        ["전체 옵션", summary.total_options],
        ["변경 필요 상품", summary.change_required_products],
        ["이미 동일", summary.already_synced_products],
        ["구조 차단", summary.blocked_products],
        ["채우기 옵션", summary.fill_options],
        ["교체 옵션", summary.replace_options],
        ["비우기 옵션", summary.clear_options],
      ]
    : [];

  return (
    <div className="mt-5 rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-bold text-slate-950">결과 상태: {result.status ?? "-"}</p>
          <p className="mt-1 text-sm text-slate-600">{result.message}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
          GitHub: {result.runStatus ?? "대기"} / {result.runConclusion ?? "-"}
        </span>
      </div>
      {metrics.length ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {metrics.map(([label, value]) => (
            <Metric key={label} label={label} value={displayValue(value)} />
          ))}
        </div>
      ) : null}
      {selection ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Metric label="이번 실행 선택" value={displayValue(selection.selected_products)} />
          <Metric label="변경 옵션" value={displayValue(selection.selected_options_to_change)} />
          <Metric
            label="선택 후 남은 상품"
            value={displayValue(selection.remaining_change_required_after_selection)}
          />
        </div>
      ) : null}
      {execution ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="성공" value={displayValue(execution.success)} />
          <Metric label="실패" value={displayValue(execution.failed)} />
          <Metric label="불명확" value={displayValue(execution.unknown)} />
          <Metric label="미전송" value={displayValue(execution.skipped)} />
        </div>
      ) : null}
      {result.artifactName ? (
        <p className="mt-4 break-all font-mono text-xs text-slate-500">Artifact: {result.artifactName}</p>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-slate-950">{value}</p>
    </div>
  );
}
