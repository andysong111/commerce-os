"use client";

import { useLayoutEffect } from "react";

const JOBS_PATH = "/api/product-launch-tracker/detail-page-jobs";
const SHARED_RESULT_TTL_MS = 10_000;

type FetchArgs = Parameters<typeof window.fetch>;

export function DetailPageJobListRequestCoalescer() {
  useLayoutEffect(() => {
    const originalFetch = window.fetch;
    let cachedResponse: Response | null = null;
    let cachedAt = 0;
    let inFlight: Promise<Response> | null = null;

    const invalidate = () => {
      cachedResponse = null;
      cachedAt = 0;
    };

    const patchedFetch: typeof window.fetch = async (...args: FetchArgs) => {
      const [input, init] = args;
      const request = input instanceof Request ? input : null;
      let url: URL;
      try {
        url = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url,
          window.location.origin,
        );
      } catch {
        return originalFetch.apply(window, args);
      }

      const method = String(init?.method || request?.method || "GET").toUpperCase();
      const isJobRoute = url.pathname.startsWith(JOBS_PATH);
      const isSharedListRead =
        method === "GET" &&
        url.pathname === JOBS_PATH &&
        !url.searchParams.toString();

      if (!isSharedListRead) {
        const response = await originalFetch.apply(window, args);
        if (isJobRoute && method !== "GET" && response.ok) invalidate();
        return response;
      }

      const now = Date.now();
      if (cachedResponse && now - cachedAt < SHARED_RESULT_TTL_MS) {
        return cachedResponse.clone();
      }
      if (inFlight) {
        const shared = await inFlight;
        return shared.clone();
      }

      inFlight = originalFetch.apply(window, args);
      try {
        const response = await inFlight;
        if (response.ok) {
          cachedResponse = response.clone();
          cachedAt = Date.now();
        }
        return response.clone();
      } finally {
        inFlight = null;
      }
    };

    window.fetch = patchedFetch;
    return () => {
      if (window.fetch === patchedFetch) window.fetch = originalFetch;
    };
  }, []);

  return null;
}
