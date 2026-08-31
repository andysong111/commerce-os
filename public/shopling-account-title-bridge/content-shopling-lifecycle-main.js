(() => {
  "use strict";

  const COMMAND_EVENT = "commerce-os-shopling-lifecycle-main-command";
  const RESULT_EVENT = "commerce-os-shopling-lifecycle-main-result";
  const SESSION_KEY = "commerceOsShoplingLifecycleTaskContext";
  const READY_ATTR = "data-commerce-os-shopling-lifecycle-main";
  const BRIDGE_VERSION = "v0.5.8";

  function text(value) {
    return String(value ?? "").normalize("NFKC").trim();
  }

  function readStoredContext() {
    try {
      const stored = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
      if (!stored || typeof stored !== "object") return null;
      const runId = text(stored.runId);
      const taskId = text(stored.taskId);
      const goodsKey = text(stored.goodsKey);
      const desiredState = text(stored.desiredState);
      if (!/^[A-Za-z0-9._:-]{12,180}$/.test(runId)) return null;
      if (!taskId || !/^\d{5,9}$/.test(goodsKey)) return null;
      if (!["SELLING", "SOLD_OUT", "DELETE"].includes(desiredState)) return null;
      return { runId, taskId, goodsKey, desiredState, allowDelete: stored.allowDelete === true };
    } catch {
      return null;
    }
  }

  function contextToken(context) {
    if (!context) return "";
    return `${context.runId}:${context.taskId}`.slice(0, 180);
  }

  function automationContextMatches(token, action, allowDelete) {
    const stored = readStoredContext();
    if (stored && contextToken(stored) === token) {
      if (action === "delete") return stored.desiredState === "DELETE" && stored.allowDelete === true && allowDelete === true;
      return ["SELLING", "SOLD_OUT"].includes(stored.desiredState);
    }
    return new URLSearchParams(location.search).get("commerce_os_lifecycle") === "1";
  }

  function exactButton(action) {
    const buttons = [...document.querySelectorAll('button, input[type="button"], input[type="submit"], a')];
    if (action === "delete") {
      return buttons.find((node) => {
        const label = text(node.value || node.textContent || node.innerText || "");
        const onclick = text(node.getAttribute?.("onclick"));
        return label === "선택삭제" || /del_submit\s*\(/i.test(onclick);
      }) || null;
    }
    return buttons.find((node) => {
      const label = text(node.value || node.textContent || node.innerText || "");
      const onclick = text(node.getAttribute?.("onclick"));
      return label === "선택상태변경" || /status_chg\s*\(/i.test(onclick);
    }) || null;
  }

  try {
    document.documentElement?.setAttribute(READY_ATTR, BRIDGE_VERSION);
  } catch {
    // Readiness marker is diagnostic only.
  }

  window.addEventListener(COMMAND_EVENT, (event) => {
    const detail = event instanceof CustomEvent && event.detail && typeof event.detail === "object"
      ? event.detail
      : {};
    const token = text(detail.token);
    const action = text(detail.action);
    const allowDelete = detail.allowDelete === true;

    if (!/^[A-Za-z0-9._:-]{12,180}$/.test(token)) return;
    if (!["status-change", "delete"].includes(action)) return;
    if (!automationContextMatches(token, action, allowDelete)) {
      window.dispatchEvent(new CustomEvent(RESULT_EVENT, {
        detail: { token, ok: false, error: "lifecycle_automation_context_mismatch" },
      }));
      return;
    }
    if (action === "delete" && !allowDelete) {
      window.dispatchEvent(new CustomEvent(RESULT_EVENT, {
        detail: { token, ok: false, error: "delete_canary_not_armed" },
      }));
      return;
    }

    const button = exactButton(action);
    if (!(button instanceof HTMLElement)) {
      window.dispatchEvent(new CustomEvent(RESULT_EVENT, {
        detail: { token, ok: false, error: "lifecycle_submit_button_missing" },
      }));
      return;
    }

    const originalConfirm = window.confirm;
    let clicked = false;
    try {
      window.confirm = () => true;
      button.click();
      clicked = true;
    } catch (error) {
      window.dispatchEvent(new CustomEvent(RESULT_EVENT, {
        detail: {
          token,
          ok: false,
          error: error instanceof Error ? error.message : String(error || "lifecycle_submit_failed"),
        },
      }));
    } finally {
      window.setTimeout(() => {
        try {
          window.confirm = originalConfirm;
        } catch {
          // Navigation may already have replaced the document.
        }
      }, 1500);
    }

    if (clicked) {
      window.dispatchEvent(new CustomEvent(RESULT_EVENT, {
        detail: { token, ok: true, clicked: true, bridgeVersion: BRIDGE_VERSION },
      }));
    }
  });
})();
