(() => {
  "use strict";

  const RESULT_MESSAGE = "commerce-os-shopling-lifecycle-execution-result";
  const COMMAND_EVENT = "commerce-os-shopling-lifecycle-main-command";
  const MAIN_RESULT_EVENT = "commerce-os-shopling-lifecycle-main-result";
  const SESSION_KEY = "commerceOsShoplingLifecycleTaskContext";
  const PRODUCT_LIST_PATH = "/prod/prodLst.phtml";
  const STAGE_OPENING = "opening";
  const STAGE_SEARCHED = "search-submitted";
  const STAGE_MUTATED = "mutation-submitted";
  const STAGE_VERIFY = "verify-submitted";

  function text(value) {
    return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function contextFromQuery() {
    const params = new URLSearchParams(location.search);
    if (params.get("commerce_os_lifecycle") !== "1") return null;
    const runId = text(params.get("commerce_os_lifecycle_run"));
    const taskId = text(params.get("commerce_os_lifecycle_task"));
    const goodsKey = text(params.get("commerce_os_lifecycle_goods"));
    const desiredState = text(params.get("commerce_os_lifecycle_state"));
    const allowDelete = params.get("commerce_os_lifecycle_delete_canary") === "1";
    if (!/^[A-Za-z0-9._:-]{12,180}$/.test(runId)) return null;
    if (!taskId || !/^\d{5,9}$/.test(goodsKey)) return null;
    if (!["SELLING", "SOLD_OUT", "DELETE"].includes(desiredState)) return null;
    return { runId, taskId, goodsKey, desiredState, allowDelete, stage: STAGE_OPENING };
  }

  function loadContext() {
    const fromQuery = contextFromQuery();
    if (fromQuery) {
      try {
        const stored = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
        if (stored?.runId === fromQuery.runId && stored?.taskId === fromQuery.taskId) {
          return { ...fromQuery, stage: text(stored.stage) || STAGE_OPENING };
        }
      } catch {
        // Fall through to the fresh query context.
      }
      return fromQuery;
    }
    try {
      const stored = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
      if (!stored || typeof stored !== "object") return null;
      if (!/^[A-Za-z0-9._:-]{12,180}$/.test(text(stored.runId))) return null;
      if (!stored.taskId || !/^\d{5,9}$/.test(text(stored.goodsKey))) return null;
      if (!["SELLING", "SOLD_OUT", "DELETE"].includes(text(stored.desiredState))) return null;
      return stored;
    } catch {
      return null;
    }
  }

  function saveContext(context) {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(context));
    } catch {
      // Query parameters remain the secondary source of truth.
    }
  }

  function clearContext() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // Non-blocking cleanup.
    }
  }

  function sendRuntimeMessage(payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (response) => {
          void chrome.runtime.lastError;
          resolve(response || null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  async function finish(context, outcome, message) {
    clearContext();
    await sendRuntimeMessage({
      type: RESULT_MESSAGE,
      runId: context.runId,
      taskId: context.taskId,
      goodsKey: context.goodsKey,
      desiredState: context.desiredState,
      outcome,
      message: text(message).slice(0, 900),
    });
  }

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  async function waitFor(getter, timeoutMs = 15000, intervalMs = 250) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = getter();
      if (value) return value;
      await sleep(intervalMs);
    }
    return null;
  }

  function controlLabel(control) {
    if (!(control instanceof HTMLInputElement)) return "";
    if (control.id) {
      const explicit = document.querySelector(`label[for="${CSS.escape(control.id)}"]`);
      if (explicit) return text(explicit.textContent);
    }
    const wrapping = control.closest("label");
    if (wrapping) return text(wrapping.textContent);
    const pieces = [];
    let node = control.nextSibling;
    let hops = 0;
    while (node && hops < 5) {
      hops += 1;
      if (node instanceof HTMLInputElement || node instanceof HTMLSelectElement) break;
      const value = text(node.textContent || node.nodeValue || "");
      if (value) pieces.push(value);
      node = node.nextSibling;
    }
    return text(pieces.join(" "));
  }

  function enableAllDates(form) {
    const checkboxes = [...form.querySelectorAll('input[type="checkbox"]:not([disabled])')];
    const target = checkboxes.find((control) => /^전체$/i.test(controlLabel(control)));
    if (target instanceof HTMLInputElement && !target.checked) target.click();
  }

  function setSelectValue(select, value) {
    if (!(select instanceof HTMLSelectElement)) return false;
    const option = [...select.options].find((row) => text(row.value) === value);
    if (!option) return false;
    select.value = option.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return select.value === option.value;
  }

  function nearestTextInput(anchor, form) {
    const inputs = [...form.querySelectorAll('input[type="text"]:not([disabled]):not([readonly]), input:not([type]):not([disabled]):not([readonly])')]
      .filter(isVisible);
    if (!inputs.length) return null;
    const anchorRect = anchor.getBoundingClientRect();
    return inputs
      .map((input) => {
        const rect = input.getBoundingClientRect();
        return { input, distance: Math.abs(rect.top - anchorRect.top) * 3 + Math.abs(rect.left - anchorRect.right) };
      })
      .sort((left, right) => left.distance - right.distance)[0]?.input || null;
  }

  function searchButton(form, anchor) {
    const buttons = [...form.querySelectorAll('button, input[type="button"], input[type="submit"], a')]
      .filter((node) => isVisible(node) && !node.disabled)
      .filter((node) => /^(?:검색|조회)$/i.test(text(node.value || node.textContent || node.innerText || "")));
    if (!buttons.length) return null;
    const anchorRect = anchor.getBoundingClientRect();
    return buttons
      .map((button) => {
        const rect = button.getBoundingClientRect();
        return { button, distance: Math.abs(rect.top - anchorRect.top) * 3 + Math.abs(rect.left - anchorRect.right) };
      })
      .sort((left, right) => left.distance - right.distance)[0]?.button || null;
  }

  function automationAction(context) {
    const url = new URL(location.href);
    url.pathname = PRODUCT_LIST_PATH;
    url.search = "";
    url.searchParams.set("commerce_os_lifecycle", "1");
    url.searchParams.set("commerce_os_lifecycle_run", context.runId);
    url.searchParams.set("commerce_os_lifecycle_task", context.taskId);
    url.searchParams.set("commerce_os_lifecycle_goods", context.goodsKey);
    url.searchParams.set("commerce_os_lifecycle_state", context.desiredState);
    if (context.allowDelete) url.searchParams.set("commerce_os_lifecycle_delete_canary", "1");
    return `${url.pathname}${url.search}`;
  }

  function prepareSearch(context, includeDesiredState) {
    const sort = document.querySelector('select[name="sort_tp"]');
    if (!(sort instanceof HTMLSelectElement)) return { ok: false, error: "shopling_product_code_filter_missing" };
    const form = sort.closest("form");
    if (!(form instanceof HTMLFormElement)) return { ok: false, error: "shopling_product_list_form_missing" };
    const input = nearestTextInput(sort, form);
    if (!(input instanceof HTMLInputElement)) return { ok: false, error: "shopling_product_code_input_missing" };
    if (!setSelectValue(sort, "A")) return { ok: false, error: "shopling_product_code_filter_apply_failed" };
    input.value = context.goodsKey;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    enableAllDates(form);

    const saleStatus = document.querySelector('select[name="sale_status"], select#sale_status');
    if (includeDesiredState) {
      const desiredValue = context.desiredState === "SELLING" ? "B" : context.desiredState === "SOLD_OUT" ? "C" : "Z";
      if (!(saleStatus instanceof HTMLSelectElement) || !setSelectValue(saleStatus, desiredValue)) {
        return { ok: false, error: "shopling_sale_status_filter_missing" };
      }
    } else if (saleStatus instanceof HTMLSelectElement) {
      setSelectValue(saleStatus, "");
    }

    form.action = automationAction(context);
    return { ok: true, form, input, button: searchButton(form, input) };
  }

  function submitPreparedSearch(prepared) {
    if (!prepared?.ok || !(prepared.form instanceof HTMLFormElement)) return false;
    if (prepared.button instanceof HTMLElement) {
      prepared.button.click();
      return true;
    }
    if (typeof prepared.form.requestSubmit === "function") prepared.form.requestSubmit();
    else prepared.form.submit();
    return true;
  }

  function dataRowsWithCheckboxes() {
    return [...document.querySelectorAll("tr")]
      .filter((row) => row.querySelectorAll(":scope > td").length >= 3)
      .map((row) => ({
        row,
        checkbox: row.querySelector('input[type="checkbox"]:not([disabled]), input[type="radio"]:not([disabled])'),
        label: text(row.innerText || row.textContent || ""),
      }))
      .filter((entry) => entry.checkbox instanceof HTMLInputElement && isVisible(entry.checkbox));
  }

  function rowHasExactGoodsKey(entry, goodsKey) {
    const escaped = goodsKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?:^|\\D)${escaped}(?:\\D|$)`);
    if (pattern.test(entry.label)) return true;
    const raw = [...entry.row.querySelectorAll("a[href], [onclick], input[name], input[value]")]
      .map((node) => [node.getAttribute("href"), node.getAttribute("onclick"), node.getAttribute("name"), node.getAttribute("value")].filter(Boolean).join("="))
      .join(" ");
    return pattern.test(raw);
  }

  function matchingRows(goodsKey) {
    return dataRowsWithCheckboxes().filter((entry) => rowHasExactGoodsKey(entry, goodsKey));
  }

  function checkSingleRow(entry) {
    const control = entry?.checkbox;
    if (!(control instanceof HTMLInputElement)) return false;
    for (const other of dataRowsWithCheckboxes()) {
      if (other.checkbox !== control && other.checkbox.checked && other.checkbox.type === "checkbox") other.checkbox.click();
    }
    if (!control.checked) control.click();
    if (!control.checked) {
      control.checked = true;
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return control.checked;
  }

  function setChangeTarget(context) {
    const select = document.querySelector('select[name="sale_status_chg"], select#sale_status_chg');
    if (!(select instanceof HTMLSelectElement)) return false;
    const value = context.desiredState === "SELLING" ? "B" : context.desiredState === "SOLD_OUT" ? "C" : "Z";
    return setSelectValue(select, value);
  }

  function commandToken(context) {
    return `${context.runId}:${context.taskId}`.slice(0, 180);
  }

  function invokeMutation(context) {
    return new Promise((resolve) => {
      const token = commandToken(context);
      let settled = false;
      const handler = (event) => {
        const detail = event instanceof CustomEvent ? event.detail : null;
        if (!detail || text(detail.token) !== token || settled) return;
        settled = true;
        window.removeEventListener(MAIN_RESULT_EVENT, handler);
        resolve(detail);
      };
      window.addEventListener(MAIN_RESULT_EVENT, handler);
      window.dispatchEvent(new CustomEvent(COMMAND_EVENT, {
        detail: {
          token,
          action: context.desiredState === "DELETE" ? "delete" : "status-change",
          allowDelete: context.allowDelete === true,
        },
      }));
      window.setTimeout(() => {
        if (settled) return;
        settled = true;
        window.removeEventListener(MAIN_RESULT_EVENT, handler);
        resolve({ ok: false, error: "main_world_submit_timeout" });
      }, 2500);
    });
  }

  async function execute() {
    const context = loadContext();
    if (!context) return;
    saveContext(context);
    if (location.pathname !== PRODUCT_LIST_PATH) {
      await finish(context, "confirm_needed", `Shopling 상품조회 화면이 아닌 ${location.pathname}으로 이동했습니다. 로그인 상태를 확인해야 합니다.`);
      return;
    }

    const stage = text(context.stage) || STAGE_OPENING;
    if (stage === STAGE_OPENING) {
      const ready = await waitFor(() => document.querySelector('select[name="sort_tp"]'), 15000);
      if (!ready) {
        await finish(context, "confirm_needed", "샵플링 상품조회 검색조건을 찾지 못했습니다.");
        return;
      }
      const prepared = prepareSearch(context, false);
      if (!prepared.ok) {
        await finish(context, "confirm_needed", prepared.error);
        return;
      }
      context.stage = STAGE_SEARCHED;
      saveContext(context);
      if (!submitPreparedSearch(prepared)) await finish(context, "failed", "상품번호 조회 제출에 실패했습니다.");
      return;
    }

    if (stage === STAGE_SEARCHED) {
      await waitFor(() => document.querySelector('select[name="sale_status_chg"]'), 15000);
      const rows = matchingRows(context.goodsKey);
      if (rows.length !== 1) {
        await finish(context, "confirm_needed", `${context.goodsKey} 정확일치 상품행이 ${rows.length}개라 상태변경을 중단했습니다.`);
        return;
      }
      if (!checkSingleRow(rows[0])) {
        await finish(context, "failed", `${context.goodsKey} 정확일치 행 선택에 실패했습니다.`);
        return;
      }
      if (!setChangeTarget(context)) {
        await finish(context, "confirm_needed", "#sale_status_chg 상태변경 셀렉트를 적용하지 못했습니다.");
        return;
      }
      if (context.desiredState === "DELETE" && !context.allowDelete) {
        await finish(context, "confirm_needed", "삭제 Canary가 서버에서 승인되지 않아 삭제를 실행하지 않았습니다.");
        return;
      }
      const form = document.querySelector('select[name="sale_status_chg"]')?.closest("form");
      if (form instanceof HTMLFormElement) form.action = automationAction(context);
      context.stage = STAGE_MUTATED;
      saveContext(context);
      const result = await invokeMutation(context);
      if (result?.ok !== true) {
        await finish(context, "confirm_needed", `샵플링 상태변경 버튼 실행을 확인하지 못했습니다: ${text(result?.error)}`);
        return;
      }
      await sleep(1200);
      const current = loadContext();
      if (current?.stage === STAGE_MUTATED && document.readyState === "complete") {
        const prepared = prepareSearch(current, true);
        if (!prepared.ok) {
          await finish(current, "confirm_needed", prepared.error);
          return;
        }
        current.stage = STAGE_VERIFY;
        saveContext(current);
        submitPreparedSearch(prepared);
      }
      return;
    }

    if (stage === STAGE_MUTATED) {
      const prepared = prepareSearch(context, true);
      if (!prepared.ok) {
        await finish(context, "confirm_needed", prepared.error);
        return;
      }
      context.stage = STAGE_VERIFY;
      saveContext(context);
      if (!submitPreparedSearch(prepared)) await finish(context, "failed", "상태변경 후 검증 조회 제출에 실패했습니다.");
      return;
    }

    if (stage === STAGE_VERIFY) {
      await sleep(500);
      const rows = matchingRows(context.goodsKey);
      if (rows.length === 1) {
        await finish(context, "succeeded", `${context.goodsKey}의 Shopling 상태 ${context.desiredState} 재조회 검증에 성공했습니다.`);
        return;
      }
      if (context.desiredState === "DELETE" && rows.length === 0) {
        await finish(context, "confirm_needed", `${context.goodsKey} 삭제 후 삭제상태 재조회 결과가 0건입니다. 삭제 Canary 결과를 사람이 한 번 확인해야 합니다.`);
        return;
      }
      await finish(context, "confirm_needed", `${context.goodsKey} 상태 ${context.desiredState} 검증 결과 정확일치 행이 ${rows.length}개입니다.`);
    }
  }

  void execute();
})();
