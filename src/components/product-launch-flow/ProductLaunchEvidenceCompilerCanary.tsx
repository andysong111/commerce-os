"use client";

import { useState } from "react";

const STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const JOBS_API = "/api/product-launch-tracker/detail-page-jobs";
const OPTIMIZED_TRACKER_API = "/api/product-launch-tracker/optimized";

type LaunchItem = {
  id?: unknown;
  productName?: unknown;
  modelNumber?: unknown;
  primaryChinaProductLink?: unknown;
  detailPageSource?: unknown;
  chinaProductLinks?: unknown;
  orderOptions?: unknown;
  detailPageAutomation?: unknown;
  [key: string]: unknown;
};
type LaunchState = {
  items?: LaunchItem[];
  partialPage?: boolean;
  savedAt?: string;
};
type DetailJob = {
  jobId?: string;
  itemId?: string;
  status?: string;
};

type Tone = "neutral" | "progress" | "success" | "error";

export function ProductLaunchEvidenceCompilerCanary() {
  const [busy, setBusy] = useState(false);
  const [tone, setTone] = useState<Tone>("neutral");
  const [message, setMessage] = useState(
    "개발 검증용입니다. 체크한 상품 1건을 1688 수집부터 Evidence Compiler v1로 새로 제작합니다.",
  );

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setTone("progress");
    setMessage("선택 상품과 기존 진행 작업을 확인하고 있습니다.");
    try {
      const iframe = document.querySelector<HTMLIFrameElement>(
        'iframe[title="신규 상품 출시 진행관리"]',
      );
      const frameDocument = iframe?.contentDocument;
      if (!frameDocument) {
        throw new Error("상품출시진행관리 화면에 연결하지 못했습니다. Ctrl+F5 후 다시 시도하세요.");
      }
      const selectedIds = [
        ...frameDocument.querySelectorAll<HTMLInputElement>(
          "#launch-table-body tr[data-id] input.row-check:checked",
        ),
      ]
        .map((input) => input.closest<HTMLTableRowElement>("tr[data-id]")?.dataset.id || "")
        .filter(Boolean);
      if (selectedIds.length !== 1) {
        throw new Error("Evidence Compiler 신규 테스트는 상품을 정확히 1건만 체크해야 합니다.");
      }

      const state = readState();
      if (!Array.isArray(state?.items)) {
        throw new Error("상품출시진행관리 저장 상태를 읽지 못했습니다.");
      }
      const itemId = selectedIds[0];
      const localItem = state.items.find((item) => String(item?.id ?? "") === itemId);
      if (!localItem) {
        throw new Error("선택 상품을 현재 출시관리 데이터에서 찾지 못했습니다.");
      }
      const item = await authoritativeItem(state, itemId, localItem);
      const sourceUrl = primaryChinaLink(item);
      const salesOptions = saleOptions(item);
      if (!sourceUrl) {
        throw new Error("선택 상품의 중국링크 고정1번을 입력한 뒤 다시 테스트하세요.");
      }
      if (!salesOptions) {
        throw new Error("선택 상품의 옵션란을 입력한 뒤 다시 테스트하세요.");
      }

      const recent = await fetch(JOBS_API, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const recentBody = (await recent.json().catch(() => ({}))) as {
        ok?: boolean;
        jobs?: DetailJob[];
        message?: string;
      };
      if (!recent.ok || recentBody.ok !== true || !Array.isArray(recentBody.jobs)) {
        throw new Error(recentBody.message || "현재 상세페이지 작업 상태를 확인하지 못했습니다.");
      }
      const active = recentBody.jobs.find(
        (job) =>
          String(job.itemId ?? "") === itemId &&
          !["success", "failed", "cancelled"].includes(String(job.status ?? "")),
      );
      if (active) {
        throw new Error("이 상품은 이미 상세페이지 작업이 진행 중입니다. 기존 작업을 끝내거나 취소한 뒤 테스트하세요.");
      }

      const productName = String(item.productName || item.modelNumber || "상품").trim();
      if (
        !window.confirm(
          `${productName}을 Evidence Compiler v1 신규 카나리로 제작할까요?\n\n1688 원본을 새로 수집하고 상품분석 후 AI가 제품 본체를 다시 그리지 않는 Compiler로 조립합니다. 기존 상품상세 이미지/HTML은 새 결과가 최종 PASS할 때만 교체됩니다.`,
        )
      ) {
        setTone("neutral");
        setMessage("신규 Compiler 테스트를 취소했습니다.");
        return;
      }

      setMessage("Evidence Compiler 신규 job을 등록하고 있습니다.");
      const jobId = crypto.randomUUID();
      const attempt = Math.max(1, automationAttempt(localItem) + 1);
      const response = await fetch(JOBS_API, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jobId,
          itemId,
          sourceUrl,
          salesOptions,
          productName,
          attempt,
          compilerCanary: true,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        job?: DetailJob & { payload?: Record<string, unknown> };
        message?: string;
      };
      if (!response.ok || body.ok !== true || !body.job) {
        throw new Error(body.message || "Evidence Compiler 신규 작업을 등록하지 못했습니다.");
      }
      if (body.job.payload?.compiler_canary !== true) {
        throw new Error("서버가 Compiler 카나리 플래그를 저장하지 못했습니다. 작업을 시작하지 않았습니다.");
      }

      const now = new Date().toISOString();
      writeAutomationState(state, itemId, {
        jobId,
        status: "queued",
        stage: "source_collection",
        message: "Evidence Compiler 신규 카나리 · 1688 원본 수집 대기 중",
        progress: 1,
        qaStatus: "pending",
        sourceUrl,
        sourceRunId: "",
        attempt,
        queuedAt: now,
        startedAt: null,
        completedAt: null,
        error: "",
        executionMode: "server-v1",
        compilerCanary: true,
      });

      setTone("success");
      setMessage(
        `${productName} · 신규 Compiler 카나리 등록 완료. 1688 수집 → 상품분석 → Evidence Compiler → 최종 픽셀검수 순서로 진행됩니다.`,
      );
    } catch (error) {
      setTone("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Evidence Compiler 신규 테스트를 시작하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };

  const toneClass =
    tone === "success"
      ? "bg-emerald-50 text-emerald-800"
      : tone === "error"
        ? "bg-rose-50 text-rose-800"
        : tone === "progress"
          ? "bg-blue-50 text-blue-800"
          : "bg-slate-50 text-slate-600";

  return (
    <div className="rounded-xl border border-violet-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-sm text-slate-950">
              Evidence Compiler v1 · 신규 1건 카나리
            </strong>
            <span className="rounded-full bg-violet-50 px-2 py-1 text-[11px] font-bold text-violet-700">
              OPS v260807 전용
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            체크한 상품 1건을 1688 수집부터 새로 실행합니다. 일반 ‘선택 상세페이지 생성’은 기존 v3 그대로 유지됩니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="shrink-0 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "신규 카나리 등록 중…" : "체크 1건 Compiler 신규 테스트"}
        </button>
      </div>
      <div className={`mt-3 rounded-lg px-3 py-2 text-xs font-semibold leading-5 ${toneClass}`}>
        {message}
      </div>
    </div>
  );
}

function readState(): LaunchState | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function authoritativeItem(
  state: LaunchState,
  itemId: string,
  localItem: LaunchItem,
) {
  if (state.partialPage !== true) return localItem;
  const params = new URLSearchParams({ mode: "items" });
  params.append("id", itemId);
  const response = await fetch(`${OPTIMIZED_TRACKER_API}?${params.toString()}`, {
    cache: "no-store",
    credentials: "same-origin",
  });
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    items?: LaunchItem[];
    message?: string;
  };
  if (!response.ok || body.ok !== true || !Array.isArray(body.items)) {
    throw new Error(body.message || "선택 상품의 최신 상세정보를 불러오지 못했습니다.");
  }
  const item = body.items.find((candidate) => String(candidate?.id ?? "") === itemId);
  if (!item) throw new Error("선택 상품의 최신 서버 정보를 찾지 못했습니다.");
  return item;
}

function primaryChinaLink(item: LaunchItem) {
  const source = record(item.detailPageSource);
  const links = Array.isArray(item.chinaProductLinks) ? item.chinaProductLinks : [];
  return String(
    item.primaryChinaProductLink || source.primaryUrl || links[0] || "",
  ).trim();
}

function saleOptions(item: LaunchItem) {
  const options = Array.isArray(item.orderOptions) ? item.orderOptions : [];
  return options
    .map((option) => String(record(option).saleOption || "").trim())
    .filter(Boolean)
    .join(" / ")
    .slice(0, 2_000);
}

function automationAttempt(item: LaunchItem) {
  const automation = record(item.detailPageAutomation);
  return Math.max(0, Number(automation.attempt) || 0);
}

function writeAutomationState(
  state: LaunchState,
  itemId: string,
  automation: Record<string, unknown>,
) {
  if (!Array.isArray(state.items)) return;
  const now = new Date().toISOString();
  state.items = state.items.map((item) =>
    String(item?.id ?? "") === itemId
      ? {
          ...item,
          detailPageAutomation: automation,
          updatedAt: now,
        }
      : item,
  );
  state.savedAt = now;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent("product-launch-tracker:external-state"));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
