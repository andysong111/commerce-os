"use client";

import { useLayoutEffect } from "react";

const CATEGORY_STATUS_PATH = "/api/shopling-categories/status";
const CATEGORY_TASK_KEY = "commerce-os-work-assistant:category-update:v1";

type LocalCategoryTask = {
  mode?: string;
  active?: boolean;
  requestId?: string;
  status?: string;
  message?: string;
  categoryCount?: number;
  updatedAt?: string;
};

declare global {
  interface Window {
    __commerceOsLocalCategoryStatusBridge?: boolean;
  }
}

function readLocalTask(): LocalCategoryTask | null {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(CATEGORY_TASK_KEY) || "null",
    ) as LocalCategoryTask | null;
    return parsed && parsed.mode === "local" ? parsed : null;
  } catch {
    return null;
  }
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function OpsLocalCategoryStatusBridge() {
  useLayoutEffect(() => {
    if (window.__commerceOsLocalCategoryStatusBridge) return;
    window.__commerceOsLocalCategoryStatusBridge = true;

    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const localTask = readLocalTask();
      if (
        url.includes(CATEGORY_STATUS_PATH) &&
        localTask?.active === true &&
        localTask.mode === "local"
      ) {
        const body = {
          ok: true,
          status: {
            status: localTask.status || "running",
            requestId: localTask.requestId || "",
            message:
              localTask.message ||
              "승준님 PC에서 샵플링 표준카테고리를 수집하고 있습니다.",
            categoryCount: Number(localTask.categoryCount || 0),
            checkedAt: localTask.updatedAt || new Date().toISOString(),
          },
          snapshot: null,
          run: {
            active: true,
            terminal: false,
            source: "local_shopling_category_runner",
          },
        };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      }
      return nativeFetch(input, init);
    };
  }, []);

  return null;
}
