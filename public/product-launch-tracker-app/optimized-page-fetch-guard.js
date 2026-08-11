const PAGE_ENDPOINT = "/api/product-launch-tracker/optimized";
const PAGE_TIMEOUT_MS = 10_000;
const PAGE_RETRY_DELAY_MS = 400;
const PAGE_MAX_ATTEMPTS = 2;
const nativeFetch = window.fetch.bind(window);

window.fetch = async function commerceOsProductLaunchFetch(input, init = {}) {
  if (!isOptimizedPageRead(input, init)) {
    return nativeFetch(input, init);
  }
  return fetchOptimizedPageWithRetry(input, init);
};

async function fetchOptimizedPageWithRetry(input, init) {
  let lastError = null;
  for (let attempt = 0; attempt < PAGE_MAX_ATTEMPTS; attempt += 1) {
    if (init.signal?.aborted) {
      throw abortError();
    }
    try {
      return await fetchWithTimeout(input, init, PAGE_TIMEOUT_MS);
    } catch (error) {
      if (init.signal?.aborted) throw error;
      lastError = error;
      if (attempt >= PAGE_MAX_ATTEMPTS - 1) break;
      setRetryStatus();
      await waitForRetry(PAGE_RETRY_DELAY_MS, init.signal);
    }
  }
  throw lastError ?? new Error("신규 상품 출시 목록을 불러오지 못했습니다.");
}

async function fetchWithTimeout(input, init, timeoutMs) {
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  let timedOut = false;
  const forwardAbort = () => controller.abort();
  if (upstreamSignal?.aborted) {
    controller.abort();
  } else {
    upstreamSignal?.addEventListener("abort", forwardAbort, { once: true });
  }
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await nativeFetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut && !upstreamSignal?.aborted) {
      const timeoutError = new Error(
        "신규 상품 출시 목록 서버 응답이 10초 이상 지연되었습니다. 자동 재시도 후에도 완료되지 않았습니다.",
      );
      timeoutError.name = "ProductLaunchPageTimeoutError";
      throw timeoutError;
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
    upstreamSignal?.removeEventListener("abort", forwardAbort);
  }
}

function isOptimizedPageRead(input, init) {
  const method = String(init.method || (input instanceof Request ? input.method : "GET"))
    .trim()
    .toUpperCase();
  if (method !== "GET") return false;
  try {
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw, window.location.origin);
    return (
      url.origin === window.location.origin &&
      url.pathname === PAGE_ENDPOINT &&
      (url.searchParams.get("mode") || "page") === "page"
    );
  } catch {
    return false;
  }
}

function setRetryStatus() {
  const status = document.querySelector("#save-status");
  if (status) status.textContent = "목록 응답 지연 · 자동 재시도 중";
}

function waitForRetry(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError() {
  return new DOMException("The operation was aborted.", "AbortError");
}
