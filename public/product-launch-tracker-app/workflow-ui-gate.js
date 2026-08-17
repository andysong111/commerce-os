const WORKFLOW_API = "/api/product-launch-tracker/optimized";
const PROBE_TIMEOUT_MS = 4_500;
const IDLE_RETRY_MS = 30_000;
const HIDDEN_RETRY_MS = 60_000;

let installed = false;
let optimizedAppPromise = null;
let probeTimer = null;
let probeInFlight = false;

export function installWorkflowUiGate() {
  if (installed) return;
  installed = true;
  document.documentElement.dataset.opsWorkflowUi = "probing";

  const onVisible = () => {
    if (document.visibilityState === "visible" && !optimizedAppPromise) {
      scheduleProbe(500);
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
  try {
    const params = new URLSearchParams({
      mode: "page",
      page: "1",
      pageSize: "1",
      unfinishedOnly: "false",
    });
    const response = await fetch(`${WORKFLOW_API}?${params.toString()}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body?.ok === true && body?.stateExists !== false) {
      document.documentElement.dataset.opsWorkflowUi = "loading";
      optimizedAppPromise = import("./optimized-app.js")
        .then(() => {
          document.documentElement.dataset.opsWorkflowUi = "live";
          return true;
        })
        .catch((error) => {
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
