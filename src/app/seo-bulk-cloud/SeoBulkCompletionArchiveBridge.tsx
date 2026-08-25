"use client";

import { useLayoutEffect } from "react";

const BATCH_STORAGE_KEY = "commerceOs.seoBulkCloud.batch.v1";
const INVENTORY_SYNC_API = "/api/seo-title-ledger/sync";
const COMPLETE_GOODS_KEY_PATTERN = /goods[_ ]?key\s*(?:6\s*\/\s*6|6개\s*등록됨)/i;
const HIDDEN_ATTRIBUTE = "data-seo-bulk-goods-key-complete";

function readBatchItemIds() {
  try {
    const raw = window.localStorage.getItem(BATCH_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    return [
      ...new Set(
        items
          .map((item: unknown) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) return "";
            return String((item as Record<string, unknown>).id ?? "").trim();
          })
          .filter(Boolean),
      ),
    ].slice(0, 50);
  } catch {
    return [];
  }
}

function hideCompletedArticles() {
  const completed: string[] = [];
  for (const article of document.querySelectorAll<HTMLElement>("main article")) {
    const text = article.textContent ?? "";
    const shouldHide = COMPLETE_GOODS_KEY_PATTERN.test(text);
    if (shouldHide) {
      article.setAttribute(HIDDEN_ATTRIBUTE, "true");
      article.style.display = "none";
      const modelNumber = text.match(/AAA\d{3,}/i)?.[0]?.toUpperCase() ?? "completed";
      completed.push(modelNumber);
      continue;
    }
    if (article.getAttribute(HIDDEN_ATTRIBUTE) === "true") {
      article.removeAttribute(HIDDEN_ATTRIBUTE);
      article.style.removeProperty("display");
    }
  }
  return completed.sort().join(",");
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

export default function SeoBulkCompletionArchiveBridge() {
  useLayoutEffect(() => {
    let lastCompletedSignature = "";
    let syncTimer = 0;

    const scheduleInventorySync = (delayMs = 0) => {
      window.clearTimeout(syncTimer);
      syncTimer = window.setTimeout(() => {
        void syncTitleInventory();
      }, delayMs);
    };

    const refresh = () => {
      const signature = hideCompletedArticles();
      if (signature && signature !== lastCompletedSignature) {
        lastCompletedSignature = signature;
        scheduleInventorySync(500);
      }
    };

    refresh();
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
    };
  }, []);

  return null;
}
