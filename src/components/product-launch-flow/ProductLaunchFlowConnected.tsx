"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ProductLaunchFlowSimple } from "@/components/product-launch-flow/ProductLaunchFlowSimple";
import {
  clearProductLaunchSimpleSession,
  readProductLaunchSimpleSession,
  writeProductLaunchSimpleSession,
  type ProductLaunchSimpleSession,
} from "@/lib/productLaunchSimpleSession";

const SELECTION_ENDPOINT = "/api/product-launch-tracker/flow-selection";
const UPLOAD_ENDPOINT = "/api/product-launch-tracker/shopling-upload";
const PENDING_SELECTION_KEY = "productLaunchFlow.trackerBatchSelection.v1";
const BATCH_RUN_KEY = "productLaunchFlow.trackerBatchRun.v1";
const HANDOFF_KEY = "productLaunchFlow.trackerHandoff.v1";
const MAX_ITEMS = 20;
const JOB_POLL_MS = 5_000;
const PRICE_POLL_MS = 3_000;

type ChannelSummary = {
  key: string;
  label: string;
  suffix: string;
  goodsKey: string;
  status: string;
  error: string;
  registeredAt: unknown;
  ptnGoodsCd: string;
};

type TrackerSelectionItem = {
  trackerRowNumber: number;
  id: string;
  modelNumber: string;
  productName: string;
  workBatch: string;
  barcode: string;
  selfCodeBase: string;
  channels: ChannelSummary[];
  goodsKeys: string[];
  registeredCount: number;
  registrationComplete: boolean;
  registrationPartial: boolean;
  pricePolicy: {
    required: boolean;
    status: string;
    requestId: string;
    policyVersion: string;
    goodsKeyCount: number;
    message: string;
    completedAt: unknown;
    updatedAt: unknown;
  };
};

type SelectionResponse = {
  ok?: boolean;
  message?: string;
  selectedCount?: number;
  items?: TrackerSelectionItem[];
};

type PendingSelection = {
  version: 1;
  itemIds: string[];
  rowExpression: string;
  autoStart: boolean;
  selectedAt: string;
};

type BatchRun = {
  version: 1;
  itemIds: string[];
  rowExpression: string;
  currentIndex: number;
  currentItemId: string;
  currentJobId: string;
  startedAt: string;
  updatedAt: string;
};

type StartInput = {
  rowExpression: string;
  itemIds: string[];
};

export function ProductLaunchFlowConnected() {
  const [hydrated, setHydrated] = useState(false);
  const [activeFlow, setActiveFlow] = useState(false);
  const [rowExpression, setRowExpression] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [message, setMessage] = useState("");
  const autoStarted = useRef(false);

  const startConnectedFlow = useCallback(async (input?: Partial<StartInput>) => {
    if (busy) return;
    const nextRowExpression = String(input?.rowExpression ?? rowExpression).trim();
    const itemIds = Array.isArray(input?.itemIds)
      ? [...new Set(input.itemIds.map(String).map((value) => value.trim()).filter(Boolean))]
      : [];
    if (!nextRowExpression && !itemIds.length) {
      setMessage("상품출시진행관리 행번호를 입력하세요.");
      return;
    }

    setBusy(true);
    setMessage("");
    setProgress("진행관리 상품을 확인하는 중입니다.");
    try {
      clearProductLaunchSimpleSession(window.localStorage);
      window.localStorage.removeItem(HANDOFF_KEY);
      const initial = await readSelection({
        rowExpression: nextRowExpression,
        itemIds,
      });
      validateSelection(initial.items);

      const startInput: StartInput = {
        rowExpression: nextRowExpression || formatRows(initial.items),
        itemIds: initial.items.map((item) => item.id),
      };
      setRowExpression(startInput.rowExpression);
      const existingRun = readJson<BatchRun>(BATCH_RUN_KEY);
      let run = isSameRun(existingRun, startInput)
        ? existingRun
        : createRun(startInput);
      writeJson(BATCH_RUN_KEY, run);

      for (let index = run.currentIndex; index < initial.items.length; index += 1) {
        const latest = await readSelection(startInput);
        const item = latest.items.find(
          (candidate) => candidate.id === startInput.itemIds[index],
        );
        if (!item) throw new Error("등록할 진행관리 상품을 다시 찾지 못했습니다.");
        if (item.registrationPartial) {
          throw new Error(
            `${item.trackerRowNumber}행 ${item.modelNumber}: 일부 채널만 등록되어 있습니다. 진행관리에서 실패 채널을 먼저 확인하세요.`,
          );
        }
        if (item.registrationComplete) {
          run = updateRun(run, {
            currentIndex: index + 1,
            currentItemId: "",
            currentJobId: "",
          });
          writeJson(BATCH_RUN_KEY, run);
          continue;
        }

        setProgress(
          `${index + 1}/${initial.items.length} · ${item.trackerRowNumber}행 ${item.modelNumber} 샵플링 6채널 등록 중`,
        );
        let jobId =
          run.currentItemId === item.id ? String(run.currentJobId ?? "") : "";
        if (!jobId) {
          run = updateRun(run, {
            currentIndex: index,
            currentItemId: item.id,
            currentJobId: "",
          });
          writeJson(BATCH_RUN_KEY, run);
          jobId = await startUpload(item.id);
          run = updateRun(run, { currentJobId: jobId });
          writeJson(BATCH_RUN_KEY, run);
        }
        await pollUploadJob(jobId, item);
        run = updateRun(run, {
          currentIndex: index + 1,
          currentItemId: "",
          currentJobId: "",
        });
        writeJson(BATCH_RUN_KEY, run);
      }

      setProgress("등록 결과와 중앙 가격정책 완료를 확인하는 중입니다.");
      const completed = await waitForRegistrationAndPrice(startInput);
      const session = buildConnectedSession(completed.items, startInput.rowExpression);
      writeProductLaunchSimpleSession(window.localStorage, session);
      writeJson(HANDOFF_KEY, buildBatchHandoff(completed.items));
      window.localStorage.removeItem(PENDING_SELECTION_KEY);
      window.localStorage.removeItem(BATCH_RUN_KEY);
      setProgress("");
      setMessage(
        `${completed.items.length}개 상품의 샵플링 등록을 확인했습니다. 상품명·키워드 단계로 이어갑니다.`,
      );
      setActiveFlow(true);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "상품출시플로우 연결을 시작하지 못했습니다.",
      );
      setProgress("");
    } finally {
      setBusy(false);
    }
  }, [busy, rowExpression]);

  useEffect(() => {
    const session = readProductLaunchSimpleSession(window.localStorage);
    setActiveFlow(hasActiveSession(session));
    const pending = readJson<PendingSelection>(PENDING_SELECTION_KEY);
    if (pending?.rowExpression) setRowExpression(pending.rowExpression);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || activeFlow || busy || autoStarted.current) return;
    const pending = readJson<PendingSelection>(PENDING_SELECTION_KEY);
    if (!pending?.autoStart || (!pending.rowExpression && !pending.itemIds?.length)) return;
    autoStarted.current = true;
    void startConnectedFlow({
      rowExpression: pending.rowExpression,
      itemIds: pending.itemIds,
    });
  }, [activeFlow, busy, hydrated, startConnectedFlow]);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setInterval(() => {
      const session = readProductLaunchSimpleSession(window.localStorage);
      const nextActive = hasActiveSession(session);
      setActiveFlow((current) => (current === nextActive ? current : nextActive));
      if (!nextActive) autoStarted.current = false;
    }, 750);
    return () => window.clearInterval(timer);
  }, [hydrated]);

  useEffect(() => {
    if (!activeFlow) return;
    const decorate = () => decorateLegacySelectionSection();
    decorate();
    const timer = window.setInterval(decorate, 800);
    return () => window.clearInterval(timer);
  }, [activeFlow]);

  if (!hydrated) {
    return (
      <p className="rounded-2xl border border-slate-200 bg-white p-5 text-sm font-bold text-slate-600">
        상품출시진행관리 연결 상태를 확인하고 있습니다.
      </p>
    );
  }

  if (activeFlow) {
    return <ProductLaunchFlowSimple />;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
        <p className="text-sm font-black text-emerald-800">정상 상품출시 경로</p>
        <h2 className="mt-1 text-2xl font-black text-slate-950">
          상품출시진행관리에서 시작
        </h2>
        <p className="mt-2 text-sm text-slate-700">
          진행관리 행을 기준으로 샵플링 6채널 등록 → 중앙 가격정책 → 키워드 추천 → 상품명·검색어 반영 순서로 진행합니다. 마켓 전송은 자동 실행하지 않습니다.
        </p>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-black">1. 진행관리 상품 선택</h2>
        <p className="mt-1 text-sm text-slate-600">
          상품출시진행관리 화면에 표시된 행번호를 입력하세요. 여러 행은 쉼표 또는 범위로 한 번에 진행할 수 있습니다.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <input
            value={rowExpression}
            onChange={(event) => setRowExpression(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void startConnectedFlow();
              }
            }}
            disabled={busy}
            placeholder="예: 2430 또는 2430-2434,2440"
            className="min-w-[300px] flex-1 rounded-xl border border-slate-300 px-4 py-3"
          />
          <button
            type="button"
            onClick={() => void startConnectedFlow()}
            disabled={busy || !rowExpression.trim()}
            className="rounded-xl bg-slate-950 px-5 py-3 font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {busy ? "연결 진행 중" : "상품출시 시작"}
          </button>
        </div>
        <p className="mt-3 text-xs font-bold text-slate-500">
          한 번에 최대 {MAX_ITEMS}개 상품까지 진행합니다. 진행관리에서 여러 행을 체크한 뒤 ‘선택 상품을 출시플로우로 등록 진행’ 버튼을 사용해도 됩니다.
        </p>
      </section>

      {progress ? (
        <p className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-900">
          {progress}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
          {message}
        </p>
      ) : null}
    </div>
  );
}

async function readSelection(input: StartInput) {
  const response = await fetch(SELECTION_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      rowExpression: input.rowExpression,
      itemIds: input.itemIds,
    }),
    credentials: "same-origin",
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as SelectionResponse;
  if (!response.ok || body.ok !== true || !Array.isArray(body.items)) {
    throw new Error(body.message || "상품출시진행관리 행을 불러오지 못했습니다.");
  }
  return { ...body, items: body.items } as SelectionResponse & {
    items: TrackerSelectionItem[];
  };
}

function validateSelection(items: TrackerSelectionItem[]) {
  if (!items.length) throw new Error("상품출시진행관리에서 선택된 상품이 없습니다.");
  if (items.length > MAX_ITEMS) {
    throw new Error(`한 번에 최대 ${MAX_ITEMS}개 상품까지만 진행할 수 있습니다.`);
  }
  const invalid = items.find(
    (item) => !item.id || !item.modelNumber || !item.productName || !item.selfCodeBase,
  );
  if (invalid) {
    throw new Error(
      `${invalid.trackerRowNumber}행의 상품 ID·모델번호·모델명·자사상품코드를 확인하세요.`,
    );
  }
  const partial = items.find((item) => item.registrationPartial);
  if (partial) {
    throw new Error(
      `${partial.trackerRowNumber}행 ${partial.modelNumber}: 일부 채널만 등록되어 있어 중복 등록을 차단했습니다.`,
    );
  }
}

async function startUpload(itemId: string) {
  const response = await fetch(UPLOAD_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ itemId }),
    credentials: "same-origin",
  });
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    jobId?: string;
    message?: string;
  };
  const jobId = String(body.jobId ?? "").trim();
  if (!response.ok || body.ok !== true || !jobId) {
    throw new Error(body.message || "샵플링 등록 작업을 시작하지 못했습니다.");
  }
  return jobId;
}

async function pollUploadJob(jobId: string, item: TrackerSelectionItem) {
  for (let poll = 0; poll < 360; poll += 1) {
    await wait(poll === 0 ? 1_500 : JOB_POLL_MS);
    const response = await fetch(
      `${UPLOAD_ENDPOINT}?jobId=${encodeURIComponent(jobId)}`,
      { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" },
    );
    const body = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      message?: string;
      job?: Record<string, unknown>;
    };
    if (!response.ok || body.ok !== true) {
      throw new Error(body.message || "샵플링 등록 상태를 확인하지 못했습니다.");
    }
    const job = body.job ?? {};
    const status = String(job.status ?? "");
    if (["queued", "running"].includes(status)) continue;
    if (status === "success") return;
    const errorMessage = String(job.error_message ?? "").trim();
    throw new Error(
      errorMessage ||
        `${item.trackerRowNumber}행 ${item.modelNumber} 샵플링 등록에 실패했습니다.`,
    );
  }
  throw new Error(
    `${item.trackerRowNumber}행 ${item.modelNumber} 등록 결과 확인 횟수를 초과했습니다.`,
  );
}

async function waitForRegistrationAndPrice(input: StartInput) {
  for (let poll = 0; poll < 240; poll += 1) {
    const selection = await readSelection(input);
    const partial = selection.items.find((item) => item.registrationPartial);
    if (partial) {
      throw new Error(
        `${partial.trackerRowNumber}행 ${partial.modelNumber}: 일부 채널 등록 결과를 확인하세요.`,
      );
    }
    const registrationsDone = selection.items.every(
      (item) => item.registrationComplete,
    );
    const pricePending = selection.items.some((item) =>
      ["pending", "running"].includes(
        String(item.pricePolicy.status ?? "").toLowerCase(),
      ),
    );
    if (registrationsDone && !pricePending) return selection;
    await wait(PRICE_POLL_MS);
  }
  throw new Error("샵플링 등록 또는 중앙 가격정책 결과 확인 횟수를 초과했습니다.");
}

function buildConnectedSession(
  items: TrackerSelectionItem[],
  rowExpression: string,
): ProductLaunchSimpleSession {
  const now = new Date().toISOString();
  const rows = items.flatMap((item) =>
    item.channels.map((channel, channelIndex) => ({
      row: `${item.trackerRowNumber}-${channelIndex + 1}`,
      source_row: item.id,
      tracker_row_number: item.trackerRowNumber,
      model_number: item.modelNumber,
      channel: channel.label,
      code: "000",
      success: true,
      ok: true,
      status: "success",
      goods_key: channel.goodsKey,
      ptn_goods_cd: channel.ptnGoodsCd,
      title: `${item.productName} ${channel.label}`.trim(),
      product_name: `${item.productName} ${channel.label}`.trim(),
      registered_title: `${item.productName} ${channel.label}`.trim(),
    })),
  );
  const goodsKeys = rows.map((row) => row.goods_key).filter(Boolean);
  const allPricesComplete = items.every(
    (item) => String(item.pricePolicy.status ?? "").toLowerCase() === "success",
  );
  const priceRequestIds = items
    .map((item) => item.pricePolicy.requestId)
    .filter(Boolean);
  const titles = Object.fromEntries(
    rows.map((row) => [row.goods_key, row.registered_title]),
  );

  return {
    version: 1,
    rowExpression: `진행관리:${rowExpression || formatRows(items)}`,
    uploadRequestId: `tracker-batch-upload-${Date.now()}`,
    uploadResult: {
      status: "success",
      phase: "artifact_ready",
      runConclusion: "success",
      message: "상품출시진행관리의 선택 상품 등록 결과를 불러왔습니다.",
      summary: {
        status: "success",
        fail_count: 0,
        goods_key_count: goodsKeys.length,
        exit_code: 0,
        source: "product_launch_tracker_batch",
        item_count: items.length,
        rows,
      },
      goodsKeys,
    },
    uploadPolls: 0,
    priceRequestId: allPricesComplete
      ? priceRequestIds.join(",") || `tracker-batch-price-${Date.now()}`
      : "",
    priceResult: allPricesComplete
      ? {
          status: "success",
          phase: "artifact_ready",
          runConclusion: "success",
          message: "선택 상품의 중앙 가격정책 적용을 확인했습니다.",
          summary: {
            status: "success",
            fail_count: 0,
            goods_key_count: goodsKeys.length,
            exit_code: 0,
            canonical_price_policy: true,
            source: "product_launch_tracker_batch",
          },
        }
      : null,
    pricePolls: 0,
    recommendationRequestId: "",
    recommendationResult: null,
    recommendationPolls: 0,
    titles,
    searches: {},
    directRequestId: "",
    directResult: null,
    directPolls: 0,
    updatedAt: now,
  };
}

function buildBatchHandoff(items: TrackerSelectionItem[]) {
  const now = new Date().toISOString();
  return {
    version: 2,
    items: items.map((item) => ({
      itemId: item.id,
      trackerRowNumber: item.trackerRowNumber,
      modelNumber: item.modelNumber,
      productName: item.productName,
      goodsKeys: item.goodsKeys,
      priceRequestId: item.pricePolicy.requestId,
      pricePolicyVersion: item.pricePolicy.policyVersion,
    })),
    goodsKeys: items.flatMap((item) => item.goodsKeys),
    startedAt: now,
    completedAt: null,
    status: "keyword_in_progress",
  };
}

function hasActiveSession(session: ProductLaunchSimpleSession | null) {
  return Boolean(
    session &&
      (session.uploadRequestId ||
        session.uploadResult ||
        session.priceRequestId ||
        session.priceResult ||
        session.recommendationRequestId ||
        session.recommendationResult ||
        session.directRequestId ||
        session.directResult),
  );
}

function decorateLegacySelectionSection() {
  const section = [...document.querySelectorAll("section")].find(
    (candidate) => candidate.querySelector("h2")?.textContent?.trim() === "1. 상품 선택",
  );
  if (!section) return;
  const heading = section.querySelector("h2");
  const description = heading?.nextElementSibling;
  if (heading) heading.textContent = "1. 진행관리 선택 완료";
  if (description) {
    description.textContent =
      "상품출시진행관리에서 선택한 상품의 샵플링 등록 결과를 사용하고 있습니다.";
  }
  const input = section.querySelector("input");
  if (input instanceof HTMLInputElement) {
    input.readOnly = true;
    input.title = "상품출시진행관리에서 전달된 행번호입니다.";
  }
  const button = section.querySelector("button");
  if (button instanceof HTMLButtonElement) button.hidden = true;
}

function formatRows(items: TrackerSelectionItem[]) {
  return items.map((item) => item.trackerRowNumber).join(",");
}

function createRun(input: StartInput): BatchRun {
  const now = new Date().toISOString();
  return {
    version: 1,
    itemIds: input.itemIds,
    rowExpression: input.rowExpression,
    currentIndex: 0,
    currentItemId: "",
    currentJobId: "",
    startedAt: now,
    updatedAt: now,
  };
}

function updateRun(run: BatchRun, patch: Partial<BatchRun>): BatchRun {
  return { ...run, ...patch, updatedAt: new Date().toISOString() };
}

function isSameRun(run: BatchRun | null, input: StartInput): run is BatchRun {
  return Boolean(
    run?.version === 1 &&
      run.rowExpression === input.rowExpression &&
      run.itemIds.length === input.itemIds.length &&
      run.itemIds.every((id, index) => id === input.itemIds[index]),
  );
}

function readJson<T>(key: string): T | null {
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
