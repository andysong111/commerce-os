"use client";

import { useLayoutEffect } from "react";

const BATCH_STORAGE_KEY = "commerceOs.seoBulkCloud.batch.v1";
const INVENTORY_SYNC_API = "/api/seo-title-ledger/sync";
const TRACKER_API = "/api/product-launch-tracker/optimized";
const EXPECTED_GOODS_KEY_COUNT = 6;
const COMPLETE_GOODS_KEY_PATTERN = /goods[_ ]?key\s*(?:6\s*\/\s*6|6개\s*등록됨)/i;
const COMPLETE_ATTRIBUTE = "data-seo-bulk-goods-key-complete";
const ARCHIVE_BUTTON_ID = "seo-bulk-completed-archive-button";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function timestampMs(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function readBatchContext() {
  try {
    const raw = window.localStorage.getItem(BATCH_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as UnknownRecord)
      : null;
  } catch {
    return null;
  }
}

function readBatchItemIds() {
  const parsed = readBatchContext();
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  return [
    ...new Set(
      items
        .map((item: unknown) => text(record(item).id))
        .filter(Boolean),
    ),
  ].slice(0, 50);
}

function itemGoodsKeyCount(item: UnknownRecord) {
  const products = record(item.shoplingProducts);
  return Object.values(products)
    .map((value) => text(record(value).goodsKey))
    .filter(Boolean).length;
}

function scanCompletedArticles() {
  const completed: string[] = [];
  for (const article of document.querySelectorAll<HTMLElement>("main article")) {
    const articleText = article.textContent ?? "";
    const isComplete = COMPLETE_GOODS_KEY_PATTERN.test(articleText);
    if (isComplete) {
      article.setAttribute(COMPLETE_ATTRIBUTE, "true");
      const modelNumber = articleText.match(/AAA\d{3,}/i)?.[0]?.toUpperCase() ?? "completed";
      completed.push(modelNumber);
      continue;
    }
    article.removeAttribute(COMPLETE_ATTRIBUTE);
  }
  return {
    count: completed.length,
    signature: completed.sort().join(","),
  };
}

async function syncTitleInventory() {
  const itemIds = readBatchItemIds();
  if (!itemIds.length) return;
  try {
    await fetch(INVENTORY_SYNC_API, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({ itemIds }),
    });
  } catch (error) {
    console.warn("[SEO bulk title inventory] background sync skipped", error);
  }
}

async function loadBatchTrackerItems() {
  const itemIds = readBatchItemIds();
  if (!itemIds.length) return [];

  const query = new URLSearchParams({ mode: "items" });
  itemIds.forEach((itemId) => query.append("id", itemId));
  const response = await fetch(`${TRACKER_API}?${query.toString()}`, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const body = (await response.json().catch(() => ({}))) as UnknownRecord;
  if (!response.ok || body.ok !== true) {
    throw new Error(text(body.message || body.error) || `HTTP ${response.status}`);
  }
  return Array.isArray(body.items) ? body.items.map(record) : [];
}

async function loadFullyRegisteredItemIds() {
  const items = await loadBatchTrackerItems();
  return items
    .filter(
      (item) =>
        !text(item.archivedAt) &&
        itemGoodsKeyCount(item) === EXPECTED_GOODS_KEY_COUNT,
    )
    .map((item) => text(item.id))
    .filter(Boolean);
}

async function loadArchivedItemIds() {
  const items = await loadBatchTrackerItems();
  return items
    .filter((item) => Boolean(text(item.archivedAt)))
    .map((item) => text(item.id))
    .filter(Boolean);
}

async function loadOneShotClearedItemIds() {
  const batch = readBatchContext();
  const batchCreatedAt = timestampMs(batch?.createdAt);
  if (!batchCreatedAt) return [];
  const items = await loadBatchTrackerItems();
  return items
    .filter(
      (item) => timestampMs(item.seoBulkBatchClearedAt) > batchCreatedAt,
    )
    .map((item) => text(item.id))
    .filter(Boolean);
}

async function archiveItems(itemIds: string[]) {
  const response = await fetch(TRACKER_API, {
    method: "PATCH",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      operation: "archive_items",
      itemIds,
      archived: true,
      updatedBy: "SEO 대량등록 클라우드 전체 보관함 이동",
    }),
  });
  const body = (await response.json().catch(() => ({}))) as UnknownRecord;
  if (!response.ok || body.ok !== true) {
    throw new Error(text(body.message || body.error) || `HTTP ${response.status}`);
  }
}

function pruneBatchItems(itemIds: string[]) {
  const parsed = readBatchContext();
  if (!parsed) return false;
  const removeIds = new Set(itemIds);
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const nextItems = items.filter(
    (item) => !removeIds.has(text(record(item).id)),
  );
  if (nextItems.length === items.length) return false;
  window.localStorage.setItem(
    BATCH_STORAGE_KEY,
    JSON.stringify({
      ...parsed,
      items: nextItems,
    }),
  );
  return true;
}

function headerActions() {
  const trackerLink = document.querySelector<HTMLAnchorElement>(
    'a[href="/product-launch-tracker"]',
  );
  return trackerLink?.parentElement instanceof HTMLElement
    ? trackerLink.parentElement
    : null;
}

export default function SeoBulkCompletionArchiveBridge() {
  useLayoutEffect(() => {
    let lastCompletedSignature = "";
    let syncTimer = 0;
    let busy = false;
    let completedCount = 0;
    let archiveButton: HTMLButtonElement | null = null;

    const scheduleInventorySync = (delayMs = 0) => {
      window.clearTimeout(syncTimer);
      syncTimer = window.setTimeout(() => {
        void syncTitleInventory();
      }, delayMs);
    };

    const syncArchiveButton = () => {
      const actions = headerActions();
      if (!actions) return;

      if (!archiveButton) {
        archiveButton = document.createElement("button");
        archiveButton.id = ARCHIVE_BUTTON_ID;
        archiveButton.type = "button";
        archiveButton.className =
          "rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-800 disabled:opacity-40";
        archiveButton.title =
          "현재 SEO 배치에서 goods_key 6/6 등록완료 상품만 Commerce OS 내부 보관함으로 이동합니다. Shopling 상품은 유지됩니다.";
        archiveButton.addEventListener("click", async () => {
          if (busy) return;
          busy = true;
          syncArchiveButton();
          try {
            const completedIds = await loadFullyRegisteredItemIds();
            if (!completedIds.length) {
              window.alert("현재 goods_key 6/6 등록완료 상품이 없습니다.");
              return;
            }
            const confirmed = window.confirm(
              `goods_key 6/6 등록완료 상품 ${completedIds.length}건을 전체 보관함으로 이동할까요?\nShopling에 등록된 상품은 삭제되지 않습니다.`,
            );
            if (!confirmed) return;

            await archiveItems(completedIds);
            pruneBatchItems(completedIds);
            window.location.reload();
          } catch (error) {
            window.alert(
              error instanceof Error
                ? error.message
                : "등록완료 상품을 보관함으로 이동하지 못했습니다.",
            );
          } finally {
            busy = false;
            syncArchiveButton();
          }
        });
        actions.appendChild(archiveButton);
      } else if (archiveButton.parentElement !== actions) {
        actions.appendChild(archiveButton);
      }

      const label = busy
        ? "등록완료 보관함 이동 중…"
        : `등록완료 전체 보관함 이동 (${completedCount})`;
      if (archiveButton.textContent !== label) archiveButton.textContent = label;
      archiveButton.disabled = busy || completedCount < 1;
    };

    const refresh = () => {
      const result = scanCompletedArticles();
      completedCount = result.count;
      syncArchiveButton();
      if (result.signature && result.signature !== lastCompletedSignature) {
        lastCompletedSignature = result.signature;
        scheduleInventorySync(500);
      }
    };

    const pruneAlreadyArchived = async () => {
      try {
        const [archivedIds, clearedIds] = await Promise.all([
          loadArchivedItemIds(),
          loadOneShotClearedItemIds(),
        ]);
        const archivedPruned = archivedIds.length
          ? pruneBatchItems(archivedIds)
          : false;
        const clearedPruned = clearedIds.length
          ? pruneBatchItems(clearedIds)
          : false;
        if (archivedPruned || clearedPruned) {
          window.location.reload();
        }
      } catch (error) {
        console.warn("[SEO bulk batch prune] server cleanup skipped", error);
      }
    };

    refresh();
    void pruneAlreadyArchived();
    scheduleInventorySync(100);
    const observer = new MutationObserver(() => refresh());
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });

    return () => {
      observer.disconnect();
      window.clearTimeout(syncTimer);
      archiveButton?.remove();
    };
  }, []);

  return null;
}
