import "./standalone-detail-editor-link.js";
import { installProductLaunchDetailStability } from "./detail-state-stability.js";
import { installOptionBarcodeColumnAlignment } from "./option-barcode-column-alignment.js";
import { installTwoStageProductLaunchWorkflow } from "./workflow-stage-pruner.js";

const WORKFLOW_API = "/api/product-launch-tracker/normalized-optimized";
const PROBE_TIMEOUT_MS = 8_000;
const IDLE_RETRY_MS = 5_000;
const HIDDEN_RETRY_MS = 30_000;
const INITIAL_WORKFLOW_PAGE_SIZE = 25;
const WARM_HANDOFF_TTL_MS = 8_000;

let installed = false;
let optimizedAppPromise = null;
let probeTimer = null;
let probeInFlight = false;

export function installWorkflowUiGate() {
  if (installed) return;
  installed = true;
  installProductLaunchDetailStability();
  installOptionBarcodeColumnAlignment();
  installTwoStageProductLaunchWorkflow();
  document.documentElement.dataset.opsWorkflowUi = "probing";

  const onVisible = () => {
    if (document.visibilityState === "visible" && !optimizedAppPromise) {
      scheduleProbe(300);
    }
  };
  window.addEventListener("online", onVisible);
  window.addEventListener("focus", onVisible);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener(
    "pagehide",
    () => {
      window.clearTimeout(probeTimer);
      window.removeEventListener("online", onVisible);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    },
    { once: true },
  );

  scheduleProbe(0);
}

function scheduleProbe(delay) {
  if (optimizedAppPromise) return;
  window.clearTimeout(probeTimer);
  probeTimer = window.setTimeout(() => void probeWorkflow(), Math.max(0, delay));
}

async function probeWorkflow() {
  if (optimizedAppPromise || probeInFlight) return;
  if (document.visibilityState !== "visible") {
    scheduleProbe(HIDDEN_RETRY_MS);
    return;
  }

  probeInFlight = true;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const params = initialWorkflowParams();
  const targetUrl = `${WORKFLOW_API}?${params.toString()}`;
  try {
    const response = await fetch(targetUrl, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    const hasUsablePage =
      response.ok &&
      body?.ok === true &&
      body?.stateExists !== false &&
      Array.isArray(body?.items) &&
      Number(body?.pageSize || 0) >= INITIAL_WORKFLOW_PAGE_SIZE;

    if (hasUsablePage) {
      document.documentElement.dataset.opsWorkflowUi = "loading";
      const releaseWarmHandoff = installWarmWorkflowPage(targetUrl, body);
      optimizedAppPromise = import("./optimized-app.js")
        .then(() => {
          releaseWarmHandoff();
          document.documentElement.dataset.opsWorkflowUi = "live";
          return true;
        })
        .catch((error) => {
          releaseWarmHandoff();
          optimizedAppPromise = null;
          document.documentElement.dataset.opsWorkflowUi = "deferred";
          console.error("OPS Workflow UI failed to attach", error);
          scheduleProbe(IDLE_RETRY_MS);
          return false;
        });
      await optimizedAppPromise;
      return;
    }
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.debug("OPS Workflow UI probe deferred", error);
    }
  } finally {
    window.clearTimeout(timeout);
    probeInFlight = false;
  }

  document.documentElement.dataset.opsWorkflowUi = "deferred";
  scheduleProbe(IDLE_RETRY_MS);
}

function initialWorkflowParams() {
  return new URLSearchParams({
    mode: "page",
    page: "1",
    pageSize: String(INITIAL_WORKFLOW_PAGE_SIZE),
    search: "",
    batch: "",
    assignee: "",
    overall: "",
    unfinishedOnly: "true",
    sort: "",
    direction: "desc",
  });
}

function installWarmWorkflowPage(targetUrl, body) {
  const originalFetch = window.fetch;
  const target = new URL(targetUrl, window.location.href);
  let active = true;
  const expiryTimer = window.setTimeout(() => release(), WARM_HANDOFF_TTL_MS);

  window.fetch = async function commerceWorkflowWarmFetch(input, init = {}) {
    const request = input instanceof Request ? input : null;
    const method = String(init.method || request?.method || "GET").toUpperCase();
    const url = new URL(request?.url || String(input), window.location.href);
    if (
      active &&
      method === "GET" &&
      sameWorkflowPage(url, target)
    ) {
      active = false;
      window.clearTimeout(expiryTimer);
      window.fetch = originalFetch;
      if (init.signal?.aborted || request?.signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Commerce-Workflow-Warm-Handoff": "1",
        },
      });
    }
    return originalFetch.call(window, input, init);
  };

  function release() {
    if (!active) return;
    active = false;
    window.clearTimeout(expiryTimer);
    if (window.fetch?.name === "commerceWorkflowWarmFetch") {
      window.fetch = originalFetch;
    }
  }

  return release;
}

function sameWorkflowPage(left, right) {
  if (left.origin !== right.origin || left.pathname !== right.pathname) return false;
  const keys = [
    "mode",
    "page",
    "pageSize",
    "search",
    "batch",
    "assignee",
    "overall",
    "unfinishedOnly",
    "sort",
    "direction",
  ];
  return keys.every((key) => left.searchParams.get(key) === right.searchParams.get(key));
}
