"use client";

import { useLayoutEffect } from "react";

const RETRY_DELAYS_MS = [0, 800, 2_000, 4_500, 8_000, 14_000, 22_000];
const RETRYABLE_STATUS = new Set([408, 425, 429, 502, 503, 504]);
const MAX_CONCURRENT_KEYWORD_REQUESTS = 2;
const TRANSIENT_500_PATTERN =
  /aborted|aborterror|operation was aborted|timeout|timed out|fetch failed|network|econn|socket|rate limit|temporar/i;

let keywordRequestsInFlight = 0;
const keywordRequestWaiters: Array<() => void> = [];

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function targetUrl(input: RequestInfo | URL) {
  try {
    if (input instanceof Request) return new URL(input.url, window.location.href);
    return new URL(String(input), window.location.href);
  } catch {
    return null;
  }
}

function shouldRecover(input: RequestInfo | URL) {
  const url = targetUrl(input);
  return Boolean(
    url
      && url.origin === window.location.origin
      && url.pathname === "/api/keyword-engine-elon-lab",
  );
}

function isIntentionalAbort(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.signal?.aborted) return true;
  return input instanceof Request && input.signal.aborted;
}

async function acquireKeywordRequestSlot() {
  if (keywordRequestsInFlight < MAX_CONCURRENT_KEYWORD_REQUESTS) {
    keywordRequestsInFlight += 1;
    return;
  }
  await new Promise<void>((resolve) => keywordRequestWaiters.push(resolve));
}

function releaseKeywordRequestSlot() {
  const next = keywordRequestWaiters.shift();
  if (next) {
    next();
    return;
  }
  keywordRequestsInFlight = Math.max(0, keywordRequestsInFlight - 1);
}

async function keywordFetch(
  nativeFetch: typeof window.fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  await acquireKeywordRequestSlot();
  try {
    return await nativeFetch.call(window, input, init);
  } finally {
    releaseKeywordRequestSlot();
  }
}

async function isRetryableResponse(response: Response) {
  if (RETRYABLE_STATUS.has(response.status)) return true;
  if (response.status !== 500) return false;
  try {
    const message = await response.clone().text();
    return TRANSIENT_500_PATTERN.test(message);
  } catch {
    return false;
  }
}

export default function SeoBulkFetchRecovery() {
  useLayoutEffect(() => {
    const nativeFetch = window.fetch;

    window.fetch = async function commerceSeoBulkRecoveringFetch(
      input: RequestInfo | URL,
      init?: RequestInit,
    ) {
      if (!shouldRecover(input)) return nativeFetch.call(window, input, init);

      let lastError: unknown = null;
      let lastResponse: Response | null = null;
      for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
        if (attempt > 0) await wait(RETRY_DELAYS_MS[attempt]);
        if (isIntentionalAbort(input, init)) {
          throw lastError instanceof Error
            ? lastError
            : new DOMException("The operation was aborted.", "AbortError");
        }
        try {
          const attemptInput = input instanceof Request ? input.clone() : input;
          const response = await keywordFetch(nativeFetch, attemptInput, init);
          lastResponse = response;
          const retryable = await isRetryableResponse(response);
          if (!retryable || attempt === RETRY_DELAYS_MS.length - 1) {
            return response;
          }
          console.warn(
            `[SEO bulk recovery] HTTP ${response.status} · retry ${attempt + 1}/${RETRY_DELAYS_MS.length - 1}`,
          );
        } catch (error) {
          lastError = error;
          if (isIntentionalAbort(input, init) || attempt === RETRY_DELAYS_MS.length - 1) {
            throw error;
          }
          const message = error instanceof Error ? error.message : String(error);
          console.warn(
            `[SEO bulk recovery] ${message || "network failure"} · retry ${attempt + 1}/${RETRY_DELAYS_MS.length - 1}`,
          );
        }
      }
      if (lastResponse) return lastResponse;
      throw lastError instanceof Error
        ? lastError
        : new Error("SEO 대량등록 네트워크 재시도 실패");
    } as typeof window.fetch;

    return () => {
      if (window.fetch.name === "commerceSeoBulkRecoveringFetch") {
        window.fetch = nativeFetch;
      }
    };
  }, []);

  return null;
}
