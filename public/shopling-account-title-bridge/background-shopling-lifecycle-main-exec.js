"use strict";

const SHOPLING_LIFECYCLE_MAIN_EXEC_MESSAGE = "commerce-os-shopling-lifecycle-main-execute";

function executeShoplingLifecycleMutationInMainWorld(token, action, allowDelete) {
  const SESSION_KEY = "commerceOsShoplingLifecycleTaskContext";
  const BRIDGE_VERSION = "v0.6.0";

  const text = (value) => String(value ?? "").normalize("NFKC").trim();
  const cleanToken = text(token);
  const cleanAction = text(action);

  if (!/^[A-Za-z0-9._:-]{12,180}$/.test(cleanToken)) {
    return { ok: false, error: "lifecycle_main_exec_token_invalid" };
  }
  if (!["status-change", "delete"].includes(cleanAction)) {
    return { ok: false, error: "lifecycle_main_exec_action_invalid" };
  }
  if (location.hostname !== "a.shopling.co.kr" || location.pathname !== "/prod/prodLst.phtml") {
    return { ok: false, error: "lifecycle_main_exec_wrong_page" };
  }

  let stored = null;
  try {
    stored = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
  } catch {
    stored = null;
  }
  if (!stored || typeof stored !== "object") {
    return { ok: false, error: "lifecycle_main_exec_context_missing" };
  }

  const runId = text(stored.runId);
  const taskId = text(stored.taskId);
  const desiredState = text(stored.desiredState);
  const storedToken = `${runId}:${taskId}`.slice(0, 180);
  if (storedToken !== cleanToken) {
    return { ok: false, error: "lifecycle_main_exec_context_mismatch" };
  }
  if (cleanAction === "delete") {
    if (desiredState !== "DELETE" || stored.allowDelete !== true || allowDelete !== true) {
      return { ok: false, error: "delete_canary_not_armed" };
    }
  } else if (!["SELLING", "SOLD_OUT"].includes(desiredState)) {
    return { ok: false, error: "lifecycle_main_exec_state_mismatch" };
  }

  const buttons = [...document.querySelectorAll('button, input[type="button"], input[type="submit"], a')];
  const button = buttons.find((node) => {
    const label = text(node.value || node.textContent || node.innerText || "");
    const onclick = text(node.getAttribute?.("onclick"));
    if (cleanAction === "delete") return label === "선택삭제" || /del_submit\s*\(/i.test(onclick);
    return label === "선택상태변경" || /status_chg\s*\(/i.test(onclick);
  }) || null;

  if (!(button instanceof HTMLElement)) {
    return { ok: false, error: "lifecycle_submit_button_missing" };
  }

  const originalConfirm = window.confirm;
  try {
    sessionStorage.setItem("commerceOsShoplingLifecycleMainScheduled", JSON.stringify({
      token: cleanToken,
      action: cleanAction,
      bridgeVersion: BRIDGE_VERSION,
      scheduledAt: Date.now(),
    }));
    window.confirm = () => true;
    window.setTimeout(() => {
      try {
        button.click();
      } finally {
        window.setTimeout(() => {
          try {
            window.confirm = originalConfirm;
          } catch {
            // Navigation may already have replaced the page.
          }
        }, 1500);
      }
    }, 0);
    return { ok: true, scheduled: true, bridgeVersion: BRIDGE_VERSION };
  } catch (error) {
    try {
      window.confirm = originalConfirm;
    } catch {
      // Non-blocking cleanup.
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error || "lifecycle_main_exec_failed"),
    };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object" || message.type !== SHOPLING_LIFECYCLE_MAIN_EXEC_MESSAGE) return false;

  const tabId = sender?.tab?.id;
  const frameId = Number.isInteger(sender?.frameId) ? sender.frameId : 0;
  if (!Number.isInteger(tabId) || frameId !== 0) {
    sendResponse({ ok: false, error: "lifecycle_main_exec_sender_invalid" });
    return false;
  }

  chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    world: "MAIN",
    func: executeShoplingLifecycleMutationInMainWorld,
    args: [String(message.token || ""), String(message.action || ""), message.allowDelete === true],
  })
    .then((results) => {
      const result = Array.isArray(results) ? results[0]?.result : null;
      sendResponse(result && typeof result === "object" ? result : { ok: false, error: "lifecycle_main_exec_result_missing" });
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error || "lifecycle_main_exec_injection_failed"),
      });
    });
  return true;
});
