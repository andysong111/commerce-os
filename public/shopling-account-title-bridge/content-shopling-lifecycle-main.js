(() => {
  "use strict";

  const COMMAND_EVENT = "commerce-os-shopling-lifecycle-main-command";
  const RESULT_EVENT = "commerce-os-shopling-lifecycle-main-result";

  function text(value) {
    return String(value ?? "").normalize("NFKC").trim();
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

  window.addEventListener(COMMAND_EVENT, (event) => {
    const detail = event instanceof CustomEvent && event.detail && typeof event.detail === "object"
      ? event.detail
      : {};
    const token = text(detail.token);
    const action = text(detail.action);
    const allowDelete = detail.allowDelete === true;
    const automated = new URLSearchParams(location.search).get("commerce_os_lifecycle") === "1";

    if (!automated || !/^[A-Za-z0-9._:-]{12,180}$/.test(token)) return;
    if (!["status-change", "delete"].includes(action)) return;
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
        detail: { token, ok: true, clicked: true },
      }));
    }
  });
})();
