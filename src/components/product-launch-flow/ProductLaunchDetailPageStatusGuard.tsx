"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  isDetailPageStageCompleted,
  shouldResetDetailPageStage,
} from "@/lib/productLaunchDetailPageStatus";

const TRACKER_API = "/api/product-launch-tracker/optimized";
const TRACKER_STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const PAGE_SIZE = 100;
const MAX_PAGES = 30;
const CHECK_COOLDOWN_MS = 20_000;

type UnknownRecord = Record<string, unknown>;

export function ProductLaunchDetailPageStatusGuard() {
  const checkingRef = useRef(false);
  const lastCheckedAtRef = useRef(0);
  const [correctedCount, setCorrectedCount] = useState(0);

  const verify = useCallback(async (force = false) => {
    if (checkingRef.current) return;
    if (!force && Date.now() - lastCheckedAtRef.current < CHECK_COOLDOWN_MS) return;

    checkingRef.current = true;
    lastCheckedAtRef.current = Date.now();
    try {
      const completedIds = await loadCompletedDetailPageIds();
      if (!completedIds.length) return;

      const fullItems = await loadFullItems(completedIds);
      const invalidItems = fullItems.filter(shouldResetDetailPageStage);
      if (!invalidItems.length) return;

      let changed = 0;
      for (const item of invalidItems) {
        const itemId = text(item.id);
        if (!itemId) continue;
        await patchDetailPageStageToNotStarted(itemId);
        changed += 1;
      }

      if (changed) {
        setCorrectedCount((current) => current + changed);
        reloadTrackerFrame();
      }
    } catch (error) {
      console.error("[detail-page-status-guard]", error);
    } finally {
      checkingRef.current = false;
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void verify(true), 600);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void verify();
    }, 60_000);
    const onFocus = () => void verify();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void verify();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === TRACKER_STORAGE_KEY) {
        window.setTimeout(() => void verify(), 500);
      }
    };

    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [verify]);

  if (!correctedCount) return null;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-bold text-amber-800">
      상세페이지 HTML·대표이미지가 없는 완료 표시 {correctedCount}건을 미시작으로 자동 보정했습니다.
    </div>
  );
}

async function loadCompletedDetailPageIds() {
  const ids: string[] = [];
  let page = 1;
  let pageCount = 1;

  do {
    const params = new URLSearchParams({
      mode: "page",
      page: String(page),
      pageSize: String(PAGE_SIZE),
      unfinishedOnly: "false",
    });
    const body = await requestJson(`${TRACKER_API}?${params.toString()}`);
    const items = Array.isArray(body.items) ? body.items.filter(isRecord) : [];
    for (const item of items) {
      if (!isDetailPageStageCompleted(item)) continue;
      const id = text(item.id);
      if (id) ids.push(id);
    }
    pageCount = Math.max(1, Math.floor(Number(body.pageCount) || 1));
    page += 1;
  } while (page <= pageCount && page <= MAX_PAGES);

  return [...new Set(ids)];
}

async function loadFullItems(ids: string[]) {
  const items: UnknownRecord[] = [];
  for (let offset = 0; offset < ids.length; offset += PAGE_SIZE) {
    const chunk = ids.slice(offset, offset + PAGE_SIZE);
    const params = new URLSearchParams({ mode: "items", id: chunk.join(",") });
    const body = await requestJson(`${TRACKER_API}?${params.toString()}`);
    if (Array.isArray(body.items)) {
      items.push(...body.items.filter(isRecord));
    }
  }
  return items;
}

async function patchDetailPageStageToNotStarted(itemId: string) {
  await requestJson(TRACKER_API, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operation: "patch_item",
      itemId,
      updatedBy: "상세페이지 재료 검증",
      stage: {
        stageKey: "detailPage",
        status: "미시작",
        reason: "",
      },
    }),
  });
}

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const body = (await response.json().catch(() => ({}))) as UnknownRecord;
  if (!response.ok || body.ok !== true) {
    throw new Error(text(body.message) || `상품출시진행관리 상태 확인 실패 (${response.status})`);
  }
  return body;
}

function reloadTrackerFrame() {
  try {
    const frame = document.querySelector<HTMLIFrameElement>(
      'iframe[title="신규 상품 출시 진행관리"]',
    );
    frame?.contentWindow?.location.reload();
  } catch (error) {
    console.error("[detail-page-status-guard:reload]", error);
  }
}

function text(value: unknown) {
  return typeof value === "string"
    ? value.trim()
    : value == null
      ? ""
      : String(value).trim();
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
