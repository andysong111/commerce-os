"use client";

import { useLayoutEffect } from "react";

const BATCH_STORAGE_KEY = "commerceOs.seoBulkCloud.batch.v1";

function newId(prefix: string) {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${uuid || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;
}

export default function SeoBulkRunMigrationBridge() {
  useLayoutEffect(() => {
    try {
      const raw = window.localStorage.getItem(BATCH_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { version?: unknown; items?: unknown };
      if (Number(parsed?.version) >= 3) return;
      const now = new Date().toISOString();
      window.localStorage.setItem(
        BATCH_STORAGE_KEY,
        JSON.stringify({
          version: 3,
          batchId: newId("seo-bulk"),
          createdAt: now,
          updatedAt: now,
          revision: now,
          autoStart: true,
          items: [],
          migratedFromLegacyBatch: true,
        }),
      );
    } catch {
      window.localStorage.removeItem(BATCH_STORAGE_KEY);
    }
  }, []);

  return null;
}
