"use client";

import { useLayoutEffect } from "react";

import {
  KEYWORD_ELON_REQUIRED_COLLECTOR_VERSION,
  parseKeywordElonBrowserImportHash,
} from "@/lib/keywordEngineElonLabBrowserImport";
import { KEYWORD_ELON_V2_STORAGE_KEY } from "@/lib/keywordEngineElonLabV2";

const COLLECTOR_PRESENCE_STORAGE_KEY = "keywordEngineElonLab.collectorPresence.v1";
const COLLECTOR_PRESENCE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const RECENT_SESSION_EVIDENCE_MS = 24 * 60 * 60 * 1000;

type CollectorPresence = {
  version: string;
  verifiedAt: string;
  source: "extension" | "collector-import" | "stored" | "recent-session";
};

function validDate(value: unknown) {
  const timestamp = Date.parse(String(value ?? ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function publishCollectorPresence(
  version: string,
  source: CollectorPresence["source"],
  verifiedAt = new Date().toISOString(),
) {
  const normalized = String(version || "").trim();
  if (!normalized) return;

  document.documentElement.dataset.commerceOsKeywordLabCollectorVersion = normalized;
  try {
    const presence: CollectorPresence = { version: normalized, verifiedAt, source };
    window.localStorage.setItem(COLLECTOR_PRESENCE_STORAGE_KEY, JSON.stringify(presence));
  } catch {
    // The dataset signal is enough for the current page even if browser storage is unavailable.
  }
  document.dispatchEvent(
    new CustomEvent("commerce-os-keyword-lab-collector-ready", {
      detail: { version: normalized, source },
    }),
  );
}

function readStoredPresence() {
  try {
    const raw = window.localStorage.getItem(COLLECTOR_PRESENCE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CollectorPresence>;
    const verifiedAt = validDate(parsed.verifiedAt);
    if (!parsed.version || !verifiedAt || Date.now() - verifiedAt > COLLECTOR_PRESENCE_MAX_AGE_MS) {
      window.localStorage.removeItem(COLLECTOR_PRESENCE_STORAGE_KEY);
      return null;
    }
    return {
      version: String(parsed.version),
      verifiedAt: new Date(verifiedAt).toISOString(),
    };
  } catch {
    return null;
  }
}

function readRecentSessionEvidence() {
  try {
    const raw = window.localStorage.getItem(KEYWORD_ELON_V2_STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as {
      source?: {
        autoStatus?: string;
        chineseTitle?: string;
        collectedAt?: string;
      };
    };
    const source = session.source;
    const collectedAt = validDate(source?.collectedAt);
    const collectorSucceeded = source?.autoStatus === "success" || source?.autoStatus === "partial";
    if (!collectorSucceeded || !source?.chineseTitle || !collectedAt) return null;
    if (Date.now() - collectedAt > RECENT_SESSION_EVIDENCE_MS) return null;
    return new Date(collectedAt).toISOString();
  } catch {
    return null;
  }
}

export default function KeywordElonCollectorPresenceBridge() {
  useLayoutEffect(() => {
    try {
      const imported = parseKeywordElonBrowserImportHash(window.location.hash);
      if (imported?.collectorVersion) {
        publishCollectorPresence(
          imported.collectorVersion,
          "collector-import",
          imported.collectedAt || new Date().toISOString(),
        );
        return;
      }
    } catch {
      // The page-level importer owns malformed payload errors.
    }

    const liveVersion = document.documentElement.dataset.commerceOsKeywordLabCollectorVersion || "";
    if (liveVersion) {
      publishCollectorPresence(liveVersion, "extension");
      return;
    }

    const stored = readStoredPresence();
    if (stored) {
      publishCollectorPresence(stored.version, "stored", stored.verifiedAt);
      return;
    }

    const recentCollectedAt = readRecentSessionEvidence();
    if (recentCollectedAt) {
      publishCollectorPresence(
        KEYWORD_ELON_REQUIRED_COLLECTOR_VERSION,
        "recent-session",
        recentCollectedAt,
      );
    }
  }, []);

  return null;
}
