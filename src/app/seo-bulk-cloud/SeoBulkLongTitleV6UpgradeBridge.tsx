"use client";

import { useLayoutEffect } from "react";

const BATCH_STORAGE_KEY = "commerceOs.seoBulkCloud.batch.v1";
const CURRENT_SEO_FINAL_SOURCE = "seo-bulk-cloud-long-title-priority-v6";
const ACTIVE_SHOPLING_STATUSES = new Set([
  "submitting",
  "queued",
  "running",
  "success",
]);

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

export default function SeoBulkLongTitleV6UpgradeBridge() {
  useLayoutEffect(() => {
    let parsed: UnknownRecord;
    try {
      const raw = window.localStorage.getItem(BATCH_STORAGE_KEY);
      parsed = record(raw ? JSON.parse(raw) : null);
    } catch {
      return;
    }

    const items = Array.isArray(parsed.items) ? parsed.items : [];
    if (!items.length) return;

    let upgradedCount = 0;
    const nextItems = items.map((value) => {
      const run = record(value);
      const seoFinal = record(run.seoFinal);
      const source = text(seoFinal.source);
      const shoplingStatus = text(run.shoplingStatus) || "idle";
      if (
        !source ||
        source === CURRENT_SEO_FINAL_SOURCE ||
        ACTIVE_SHOPLING_STATUSES.has(shoplingStatus)
      ) {
        return run;
      }

      upgradedCount += 1;
      return {
        ...run,
        generationStatus: "idle",
        generationError: "",
        seoFinal: null,
        shoplingStatus: shoplingStatus === "failed" ? "idle" : shoplingStatus,
        shoplingError: "",
        jobId: "",
        policyUpgrade: {
          fromSource: source,
          toSource: CURRENT_SEO_FINAL_SOURCE,
          upgradedAt: new Date().toISOString(),
          reason: "long_title_priority_v6",
        },
      };
    });
    if (!upgradedCount) return;

    const next = {
      ...parsed,
      version: Math.max(3, Number(parsed.version) || 3),
      items: nextItems,
      revision: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      autoStart: true,
    };
    const serialized = JSON.stringify(next);
    window.localStorage.setItem(BATCH_STORAGE_KEY, serialized);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: BATCH_STORAGE_KEY,
        newValue: serialized,
        storageArea: window.localStorage,
      }),
    );
  }, []);

  return null;
}
