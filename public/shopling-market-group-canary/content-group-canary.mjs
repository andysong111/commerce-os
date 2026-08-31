(() => {
  "use strict";

  const VERSION = "0.3.4";
  const RUN_STATE_KEY = "commerceOsShoplingParallelRunV034";
  const WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV034";
  const CLAIM_MESSAGE = "commerce-os-shopling-group-canary-claim";
  const ARM_MESSAGE = "commerce-os-shopling-group-canary-arm";
  const REPORT_MESSAGE = "commerce-os-shopling-group-canary-report";
  const OPEN_WORKERS_MESSAGE = "commerce-os-shopling-parallel-workers-open";
  const CLOSE_WORKER_MESSAGE = "commerce-os-shopling-parallel-worker-close";
  const CONTEXT_MESSAGE = "commerce-os-shopling-parallel-worker-context";
  const PANEL_ID = "commerce-os-shopling-market-parallel-worker-panel";
  const STATUS_ID = `${PANEL_ID}-status`;
  const BUTTON_ID = `${PANEL_ID}-button`;
  const SUBMIT_CONFIRM_TIMEOUT_MS = 90000;

  let driving = false;
  let timer = null;
  let panelTimer = null;

  function text(value) {
    return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  }

  function escapeRegex(value) {
    return text(value).replace(/[|\\{}()[\]^$+*?.-]/g, "\\$&");
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function visible(element) {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function bodyText() {
    return text(document.body?.innerText || document.body?.textContent || "");
  }

  function rawBodyText() {
    return String(document.body?.innerText || document.body?.textContent || "");
  }

  function isIdChoicePage() {
    return location.hostname === "a.shopling.co.kr" && /\/prodlinkage\/goods_mallReg_idChoice\.phtml$/i.test(location.pathname);
  }

  function isPreProdChoicePage() {
    return location.hostname === "a.shopling.co.kr" && /\/prodlinkage\/goods_mallReg_preProdChoice\.phtml$/i.test(location.pathname);
  }

  function isSubmitResultPage() {
    return /\/prod_a\/prod_rgst_rspt\.phtml$/i.test(location.pathname)
      && /shopling\.co\.kr$/i.test(location.hostname);
  }

  function isProductListUi() {
    if (location.hostname !== "a.shopling.co.kr") return false;
    if (isIdChoicePage() || isPreProdChoicePage() || isSubmitResultPage()) return false;
    const body = bodyText();
    return /쇼핑몰\s*상품등록(?:하기)?/i.test(body)
      && /쇼핑몰\s*미등록\s*검색/i.test(body)
      && /총\s*조회수\s*[:：]?\s*[\d,]+\s*건/i.test(body);
  }

  function isAdminShell() {
    if (location.hostname !== "a.shopling.co.kr" || window.top !== window) return false;
    if (isProductListUi() || isIdChoicePage() || isPreProdChoicePage() || isSubmitResultPage()) return false;
    const body = bodyText();
    return /쇼핑몰상품등록|상품조회수정|상품등록|상품공급관리/i.test(body);
  }

  function sendMessage(payload) {
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

  function storageGet(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (stored) => {
        void chrome.runtime.lastError;
        resolve(stored || {});
      });
    });
  }

  function storageSet(values) {
    return new Promise((resolve) => {
      chrome.storage.local.set(values, () => {
        void chrome.runtime.lastError;
        resolve(values);
      });
    });
  }

  function workerStateKey(runId, goodsKey) {
    return `${WORKER_STATE_PREFIX}:${runId}:${goodsKey}`;
  }

  async function getRunState() {
    const stored = await storageGet(RUN_STATE_KEY);
    return stored?.[RUN_STATE_KEY] || null;
  }

  async function saveRunState(state) {
    await storageSet({ [RUN_STATE_KEY]: state });
    return state;
  }

  async function getWorkerState(runId, goodsKey) {
    const key = workerStateKey(runId, goodsKey);
    const stored = await storageGet(key);
    return stored?.[key] || null;
  }

  async function saveWorkerState(state) {
    const key = workerStateKey(state.runId, state.task.goodsKey);
    await storageSet({ [key]: state });
    return state;
  }

  async function patchWorkerState(state, patch) {
    const latest = await getWorkerState(state.runId, state.task.goodsKey);
    if (!latest || latest.runId !== state.runId) return null;
    const next = { ...latest, ...patch, updatedAt: Date.now() };
    await saveWorkerState(next);
    return next;
  }

  async function initializeWorkerStates(runId, tasks) {
    const now = Date.now();
    const values = {};
    for (const task of tasks) {
      values[workerStateKey(runId, task.goodsKey)] = {
        version: VERSION,
        runId,
        task,
        status: "running",
        stage: "worker_opening",
        startedAt: now,
        stepAt: now,
        submitArmedAt: 0,
        submitClickedAt: 0,
        message: `${task.ptnGoodsCd} → ${task.profile} · 병렬 A18 복제창 준비 중`,
        updatedAt: now,
      };
    }
    await storageSet(values);
  }

  function newRunId() {
    // Server claim/release APIs currently accept the v030-compatible prefix.
    return `canary-group-v030-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  async function workerContext() {
    const response = await sendMessage({ type: CONTEXT_MESSAGE });
    return response || { worker: false, control: false };
  }

  function optionText(select) {
    if (!(select instanceof HTMLSelectElement)) return "";
    return text(select.selectedOptions?.[0]?.textContent || "");
  }

  function selectHas(select, pattern) {
    return select instanceof HTMLSelectElement
      && [...select.options].some((option) => pattern.test(text(option.textContent)));
  }

  function setSelect(select, pattern) {
    if (!(select instanceof HTMLSelectElement)) return false;
    const option = [...select.options].find((row) => pattern.test(text(row.textContent)));
    if (!option) return false;
    if (select.value !== option.value) {
      select.value = option.value;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return true;
  }

  function setInput(input, value) {
    if (!(input instanceof HTMLInputElement)) return false;
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function click(element) {
    if (!(element instanceof HTMLElement)) return false;
    try { element.scrollIntoView({ block: "center", inline: "center" }); } catch { /* hidden menu is okay */ }
    element.click();
    return true;
  }

  function buttonText(element) {
    return text(element?.value || element?.innerText || element?.textContent || "");
  }

  function buttons(pattern, includeHidden = false) {
    return [...document.querySelectorAll('button, input[type="button"], input[type="submit"], a')]
      .filter((element) => includeHidden || visible(element))
      .filter((element) => !element.disabled)
      .filter((element) => pattern.test(buttonText(element)));
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
    while (node && hops < 8) {
      hops += 1;
      if (node instanceof HTMLInputElement || node instanceof HTMLSelectElement) break;
      const value = text(node.textContent || node.nodeValue || "");
      if (value) pieces.push(value);
      node = node.nextSibling;
    }
    if (pieces.length) return text(pieces.join(" "));
    const cell = control.closest("td,th");
    return text(cell?.textContent || "");
  }

  function chooseRadio(pattern) {
    const radios = [...document.querySelectorAll('input[type="radio"]:not([disabled])')];
    const match = radios.find((radio) => pattern.test(controlLabel(radio)));
    if (!match) return false;
    if (!match.checked) {
      match.click();
      if (!match.checked) {
        match.checked = true;
        match.dispatchEvent(new Event("input", { bubbles: true }));
        match.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    return match.checked;
  }

  function findTextElement(pattern) {
    const candidates = [...document.querySelectorAll("td,th,div,span,label")]
      .filter(visible)
      .filter((element) => pattern.test(text(element.textContent)));
    return candidates.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return ar.width * ar.height - br.width * br.height;
    })[0] || null;
  }

  function findUnregisteredControls(profile) {
    const heading = findTextElement(/^쇼핑몰\s*미등록\s*검색$/i)
      || findTextElement(/쇼핑몰\s*미등록\s*검색/i);
    if (!heading) return { ok: false, reason: "unregistered_heading_missing" };
    const rect = heading.getBoundingClientRect();
    const maxTop = rect.bottom + 105;
    const minTop = rect.top - 18;
    const minLeft = Math.max(0, rect.right - 15);
    const nearby = (selector) => [...document.querySelectorAll(selector)]
      .filter(visible)
      .filter((element) => {
        const r = element.getBoundingClientRect();
        return r.top >= minTop && r.top <= maxTop && r.left >= minLeft;
      });
    const selects = nearby("select");
    const inputs = nearby('input[type="text"], input:not([type])');
    const nearbyButtons = nearby('button, input[type="button"], input[type="submit"], a');
    const profilePattern = new RegExp(`^${escapeRegex(profile)}$`);
    const profileSelect = selects.find((select) => selectHas(select, profilePattern)) || null;
    const searchType = selects.find((select) => selectHas(select, /자사\s*상품\s*코드|자체\s*상품\s*코드|자사\s*코드/i))
      || selects.find((select) => /검색항목/i.test(optionText(select)))
      || null;
    const input = inputs.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0] || null;
    const searchButton = nearbyButtons
      .filter((element) => /^(검색|조회)$/i.test(buttonText(element)))
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0] || null;
    return { ok: true, profileSelect, searchType, input, searchButton };
  }

  function rowMatchesExactIdentity(row, task) {
    const label = text(row?.innerText || row?.textContent || "");
    const code = text(task?.ptnGoodsCd);
    const goodsKey = text(task?.goodsKey);
    if (!code || !/^\d{5,9}$/.test(goodsKey)) return false;
    const codePattern = new RegExp(`(?:^|[^A-Z0-9_])${escapeRegex(code)}(?:[^A-Z0-9_]|$)`, "i");
    const goodsKeyPattern = new RegExp(`(?:^|\\D)${escapeRegex(goodsKey)}(?:\\D|$)`);
    return codePattern.test(label) && goodsKeyPattern.test(label);
  }

  function exactProductRows(task) {
    return [...document.querySelectorAll("tr")]
      .filter((row) => row.querySelectorAll(":scope > td").length >= 3)
      .map((row) => ({ row, checkbox: row.querySelector('input[type="checkbox"]:not([disabled])') }))
      .filter((entry) => entry.checkbox && visible(entry.checkbox) && rowMatchesExactIdentity(entry.row, task));
  }

  function checkOnly(entry) {
    if (!(entry?.checkbox instanceof HTMLInputElement)) return false;
    for (const checkbox of document.querySelectorAll('input[type="checkbox"]:not([disabled])')) {
      if (checkbox !== entry.checkbox && checkbox.checked && visible(checkbox)) checkbox.click();
    }
    if (!entry.checkbox.checked) entry.checkbox.click();
    return entry.checkbox.checked;
  }

  function savedProfileSelect(profile) {
    const profilePattern = new RegExp(`^${escapeRegex(profile)}$`);
    const candidates = [...document.querySelectorAll("select")]
      .filter(visible)
      .filter((select) => selectHas(select, profilePattern));
    if (!candidates.length) return null;
    return candidates
      .map((select) => {
        const row = select.closest("tr");
        const rowText = text(row?.textContent || "");
        const rect = select.getBoundingClientRect();
        const score = (/검색\s*관리/i.test(rowText) ? 10000 : 0) - rect.top - rect.left / 100;
        return { select, score };
      })
      .sort((a, b) => b.score - a.score)[0]?.select || null;
  }

  function checkedMallIds() {
    return [...document.querySelectorAll('input[type="checkbox"]:checked:not([disabled])')].filter(visible);
  }

  function topSelectButton() {
    return buttons(/^선택$/).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0] || null;
  }

  function applyPreProdMapping() {
    const required = [
      { name: "쇼핑몰별 상품판매가", pattern: /^쇼핑몰별\s*상품판매가$/ },
      { name: "상품설명", pattern: /^상품설명$/ },
      { name: "쇼핑몰별 상품명", pattern: /^쇼핑몰별\s*상품명$/ },
      { name: "검색어", pattern: /^검색어$/ },
      { name: "옵션명", pattern: /^옵션명$/ },
      { name: "매핑된 카테고리로 전송", pattern: /^매핑된\s*카테고리로\s*전송$/ },
      { name: "매핑없음 기본카테고리", pattern: /무시하고.*쇼핑몰기본정보.*카테고리로\s*전송/i },
    ];
    const missing = [];
    for (const item of required) {
      if (!chooseRadio(item.pattern)) missing.push(item.name);
    }
    return { ok: missing.length === 0, missing };
  }

  function countFrom(source, pattern) {
    const match = source.match(pattern);
    return match ? Number(String(match[1]).replace(/,/g, "")) || 0 : 0;
  }

  function submitEvidence() {
    const raw = rawBodyText();
    const body = text(raw);
    const processing = /처리중입니다|잠시만\s*기다려주시기\s*바랍니다/i.test(body);
    const resultLike = /쇼핑몰\s*상품\s*등록\s*전송\s*결과|상품\s*등록.{0,30}(결과|완료|성공)|상품전송이\s*완료되었습니다/i.test(body);
    const sections = raw.split(/쇼핑몰명\s*\(ID\)\s*:\s*/i).slice(1);
    if (sections.length) {
      const parsed = sections.map((section) => {
        const head = section.split(/\r?\n/).slice(0, 4).join(" ");
        const isSelpa = /셀파/i.test(head);
        const successCount = countFrom(section, /성공건수\s*[:：]?\s*([\d,]+)/i);
        const failureCount = countFrom(section, /실패건수\s*[:：]?\s*([\d,]+)/i);
        const success = successCount > 0 || /성공여부\s*성공/i.test(section);
        const failure = failureCount > 0 || /성공여부\s*실패/i.test(section);
        return { isSelpa, success, failure, successCount, failureCount };
      });
      const hasSuccess = parsed.some((row) => row.success);
      const ignoredSelpaFailures = parsed.filter((row) => row.isSelpa && row.failure).length;
      const nonIgnoredFailure = parsed.some((row) => !row.isSelpa && row.failure);
      return {
        success: resultLike && !processing && hasSuccess && !nonIgnoredFailure,
        failure: resultLike && !processing && nonIgnoredFailure,
        processing,
        ignoredSelpaFailures,
      };
    }

    const successCounts = [...body.matchAll(/성공건수\s*[:：]?\s*([\d,]+)/g)]
      .map((match) => Number(match[1].replace(/,/g, "")) || 0);
    const failureCounts = [...body.matchAll(/실패건수\s*[:：]?\s*([\d,]+)/g)]
      .map((match) => Number(match[1].replace(/,/g, "")) || 0);
    const hasSuccess = successCounts.some((value) => value > 0) || /성공여부\s*성공/i.test(body);
    const hasFailure = failureCounts.some((value) => value > 0) || /성공여부\s*실패/i.test(body);
    return {
      success: resultLike && !processing && hasSuccess && !hasFailure,
      failure: resultLike && !processing && hasFailure,
      processing,
      ignoredSelpaFailures: 0,
    };
  }

  async function closeCurrentWorker(state, preserveSenderWindow = false) {
    return sendMessage({
      type: CLOSE_WORKER_MESSAGE,
      runId: state.runId,
      goodsKey: state.task.goodsKey,
      preserveSenderWindow,
    });
  }

  async function reportTask(state, outcome, reasonCode, message) {
    return sendMessage({
      type: REPORT_MESSAGE,
      runId: state.runId,
      goodsKey: state.task.goodsKey,
      outcome,
      reasonCode,
      message,
    });
  }

  async function completeTask(state, outcome, reasonCode, message) {
    const response = await reportTask(state, outcome, reasonCode, message);
    if (!response?.ok) {
      await patchWorkerState(state, {
        status: "confirm_needed",
        stage: "report_failed",
        message: `Commerce OS 원장 기록 실패: ${text(response?.message || response?.error)}`,
      });
      await closeCurrentWorker(state, true);
      return;
    }
    await patchWorkerState(state, {
      status: "completed",
      stage: "finished",
      outcome,
      reasonCode,
      message,
      finishedAt: Date.now(),
    });
    await closeCurrentWorker(state, false);
  }

  async function failTask(state, reasonCode, message) {
    const crossedSubmitBoundary = ["submit_armed", "submit_clicked"].includes(state.stage);
    if (crossedSubmitBoundary) {
      const response = await reportTask(state, "confirm_needed", reasonCode, message);
      await patchWorkerState(state, {
        status: "confirm_needed",
        stage: "stopped_after_submit_boundary",
        message: response?.ok
          ? message
          : `송신경계 이후 원장기록도 확인필요: ${text(response?.message || response?.error)}`,
      });
      await closeCurrentWorker(state, true);
      return;
    }

    const response = await reportTask(state, "failed", reasonCode, message);
    await patchWorkerState(state, {
      status: response?.ok ? "failed" : "confirm_needed",
      stage: response?.ok ? "stopped" : "release_failed",
      message: response?.ok
        ? `${message} · 이 채널만 대기열로 원복했습니다. 다른 병렬 채널은 계속 진행합니다.`
        : `${message} · claim 원복 결과 확인이 필요합니다. 이 채널은 다시 누르지 마세요.`,
    });
    await closeCurrentWorker(state, !response?.ok);
  }

  function findA18Link() {
    const exact = buttons(/^\[?18\]?\s*쇼핑몰\s*상품등록$/i, true)[0];
    if (exact) return exact;
    return buttons(/쇼핑몰\s*상품등록/i, true).find((element) => !/상품등록하기/i.test(buttonText(element))) || null;
  }

  function dispatchHover(element) {
    if (!(element instanceof Element)) return;
    for (const type of ["mouseenter", "mouseover", "mousemove"]) {
      element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
  }

  async function navigateWorkerShell(state) {
    if (window.top !== window || !isAdminShell()) return;
    if (!["worker_opening", "await_a18", "a18_clicked"].includes(state.stage)) return;
    const aMenu = buttons(/^\[?A\]?\s*상품$/i, true)[0] || buttons(/\[A\].*상품/i, true)[0];
    if (aMenu) dispatchHover(aMenu);
    await sleep(250);
    const a18 = findA18Link();
    if (!a18) {
      await failTask(state, "a18_menu_missing", "복제 관리자 창에서 [18] 쇼핑몰상품등록 메뉴를 찾지 못했습니다.");
      return;
    }
    await patchWorkerState(state, {
      stage: "a18_clicked",
      stepAt: Date.now(),
      message: `${state.task.profile} 복제창 · [18] 쇼핑몰상품등록 진입`,
    });
    click(a18);
  }

  async function driveProductList(state) {
    const task = state.task;
    if (["worker_opening", "await_a18", "a18_clicked"].includes(state.stage)) {
      await patchWorkerState(state, {
        stage: "claimed",
        stepAt: Date.now(),
        message: `${task.ptnGoodsCd} → ${task.profile} · 독립 A18 작업창 준비 완료`,
      });
      return;
    }

    if (state.stage === "claimed") {
      const controls = findUnregisteredControls(task.profile);
      if (!controls.ok) {
        await failTask(state, controls.reason, "'쇼핑몰 미등록 검색' 영역을 찾지 못했습니다.");
        return;
      }
      const profilePattern = new RegExp(`^${escapeRegex(task.profile)}$`);
      if (!controls.profileSelect || !setSelect(controls.profileSelect, profilePattern)) {
        await failTask(state, "unregistered_profile_apply_failed", `쇼핑몰 미등록 검색의 ${task.profile} 그룹 적용에 실패했습니다.`);
        return;
      }
      if (controls.searchType && selectHas(controls.searchType, /자사\s*상품\s*코드|자체\s*상품\s*코드|자사\s*코드/i)) {
        setSelect(controls.searchType, /자사\s*상품\s*코드|자체\s*상품\s*코드|자사\s*코드/i);
      }
      if (!controls.input || !controls.searchButton) {
        await failTask(state, "unregistered_search_controls_missing", "쇼핑몰 미등록 검색의 입력칸/검색 버튼을 찾지 못했습니다.");
        return;
      }
      setInput(controls.input, task.ptnGoodsCd);
      await patchWorkerState(state, {
        stage: "unregistered_search_submitted",
        stepAt: Date.now(),
        message: `${task.ptnGoodsCd} · ${task.profile} 미등록 조회`,
      });
      click(controls.searchButton);
      return;
    }

    if (state.stage === "unregistered_search_submitted") {
      await sleep(750);
      const rows = exactProductRows(task);
      if (rows.length === 0) {
        await completeTask(
          state,
          "already_registered",
          "no_exact_unregistered_identity",
          `${task.goodsKey} + ${task.ptnGoodsCd}는 ${task.profile} 미등록 검색에 없어 재송신하지 않습니다.`,
        );
        return;
      }
      if (rows.length !== 1) {
        await failTask(state, "exact_product_identity_ambiguous", `${task.goodsKey} + ${task.ptnGoodsCd} 동시 정확일치 행이 ${rows.length}개라 이 채널만 중단했습니다.`);
        return;
      }
      if (!checkOnly(rows[0])) {
        await failTask(state, "exact_product_select_failed", "상품번호+자사상품코드 정확일치 행 선택에 실패했습니다.");
        return;
      }
      const registerButton = buttons(/^(쇼핑몰\s*상품등록(?:하기)?|쇼핑몰\s*상품\s*등록(?:하기)?)$/i)[0]
        || buttons(/쇼핑몰\s*상품등록(?:하기)?/i)[0];
      if (!registerButton) {
        await failTask(state, "mall_register_button_missing", "'쇼핑몰 상품등록하기' 버튼을 찾지 못했습니다.");
        return;
      }
      await patchWorkerState(state, {
        stage: "register_clicked",
        stepAt: Date.now(),
        message: `${task.goodsKey} + ${task.ptnGoodsCd} 정확일치 · 등록 팝업 호출`,
      });
      click(registerButton);
    }
  }

  async function driveIdChoice(state) {
    const task = state.task;
    if (!["register_clicked", "id_profile_selected", "id_choice_ready"].includes(state.stage)) return;
    const profilePattern = new RegExp(`^${escapeRegex(task.profile)}$`);
    const select = savedProfileSelect(task.profile);
    if (!select) {
      await failTask(state, "saved_profile_select_missing", `쇼핑몰 ID 선택 화면에서 검색관리 '${task.profile}'을 찾지 못했습니다.`);
      return;
    }
    if (optionText(select) !== task.profile) {
      await patchWorkerState(state, {
        stage: "id_profile_selected",
        stepAt: Date.now(),
        message: `쇼핑몰 ID 선택 · ${task.profile} 저장검색 적용`,
      });
      setSelect(select, profilePattern);
      await sleep(850);
      return;
    }
    await sleep(500);
    const checked = checkedMallIds();
    if (!checked.length) {
      await failTask(state, "saved_profile_no_mall_ids", `${task.profile} 적용 후 선택된 쇼핑몰 ID가 0개입니다.`);
      return;
    }
    const selectButton = topSelectButton();
    if (!selectButton) {
      await failTask(state, "mall_id_select_button_missing", "쇼핑몰 ID 선택 화면의 상단 '선택' 버튼을 찾지 못했습니다.");
      return;
    }
    await patchWorkerState(state, {
      stage: "id_choice_submitted",
      stepAt: Date.now(),
      message: `${task.profile} 저장검색 · 쇼핑몰 ID ${checked.length}개 확인 · 연동정보 화면 이동`,
    });
    click(selectButton);
  }

  async function drivePreProd(state) {
    const task = state.task;
    if (!["id_choice_submitted", "pre_profile_selected", "pre_mapping_ready", "arming"].includes(state.stage)) return;
    const profilePattern = new RegExp(`^${escapeRegex(task.profile)}$`);
    const select = savedProfileSelect(task.profile);
    if (!select) {
      await failTask(state, "preprod_saved_profile_missing", `쇼핑몰 연동 정보 화면에서 검색관리 '${task.profile}'을 찾지 못했습니다.`);
      return;
    }
    if (optionText(select) !== task.profile) {
      await patchWorkerState(state, {
        stage: "pre_profile_selected",
        stepAt: Date.now(),
        message: `쇼핑몰 연동 정보 · ${task.profile} 저장검색 적용`,
      });
      setSelect(select, profilePattern);
      await sleep(850);
      return;
    }
    await sleep(500);
    const mapping = applyPreProdMapping();
    if (!mapping.ok) {
      await failTask(state, "mapping_controls_missing", `${task.profile} 연동정보 중 누락: ${mapping.missing.join(", ")}`);
      return;
    }
    const sendButton = buttons(/^상품등록송신$/i)[0] || buttons(/상품\s*등록\s*송신/i)[0];
    if (!sendButton) {
      await failTask(state, "submit_button_missing", "'상품등록송신' 버튼을 찾지 못했습니다.");
      return;
    }
    await patchWorkerState(state, {
      stage: "arming",
      stepAt: Date.now(),
      message: `${task.profile} 연동정보 검증 완료 · 이 채널의 송신 영구잠금 확인`,
    });
    const arm = await sendMessage({
      type: ARM_MESSAGE,
      runId: state.runId,
      goodsKey: task.goodsKey,
    });
    if (!arm?.ok) {
      await failTask(state, "submit_lock_failed", `송신 잠금 실패: ${text(arm?.message || arm?.error)}`);
      return;
    }
    const latest = await getWorkerState(state.runId, task.goodsKey);
    if (!latest || latest.status !== "running") return;
    const armed = await patchWorkerState(latest, {
      stage: "submit_armed",
      submitArmedAt: Date.now(),
      stepAt: Date.now(),
      message: `${task.profile} 영구잠금 완료 · Shopling 상품등록송신 클릭 직전`,
    });
    if (!armed) return;
    await patchWorkerState(armed, {
      stage: "submit_clicked",
      submitClickedAt: Date.now(),
      stepAt: Date.now(),
      message: `${task.profile} · Shopling 상품등록송신 클릭`,
    });
    click(sendButton);
  }

  async function checkSubmitOutcome(state) {
    if (state.stage !== "submit_clicked" || !isSubmitResultPage()) return;
    const task = state.task;
    const evidence = submitEvidence();
    if (evidence.success) {
      const ignored = evidence.ignoredSelpaFailures > 0
        ? ` · 셀파 실패 ${evidence.ignoredSelpaFailures}건은 운영정책상 무시`
        : "";
      await completeTask(
        state,
        "sent",
        "shopling_submit_success_parallel_worker",
        `${task.profile} 실제 Shopling 결과 화면에서 비셀파 성공을 확인했습니다${ignored}.`,
      );
      return;
    }
    if (evidence.failure) {
      await failTask(state, "shopling_submit_result_has_nonselfa_failure", `${task.profile} 송신 결과에 셀파 외 실패가 있어 이 채널만 확인필요로 보존합니다.`);
      return;
    }
    const age = Date.now() - Number(state.submitClickedAt || 0);
    if (!evidence.processing && age >= SUBMIT_CONFIRM_TIMEOUT_MS) {
      await failTask(state, "submit_result_requires_manual_check", `${task.profile} 실제 결과 페이지에서 ${SUBMIT_CONFIRM_TIMEOUT_MS / 1000}초 동안 확정 성공결과를 확인하지 못했습니다.`);
    }
  }

  async function drive() {
    if (driving) return;
    driving = true;
    try {
      const context = await workerContext();
      if (!context.worker || !context.runId || !context.goodsKey || !context.task) return;
      const state = await getWorkerState(context.runId, context.goodsKey);
      if (!state || state.status !== "running") return;
      if (state.task.goodsKey !== context.goodsKey || state.task.ptnGoodsCd !== context.task.ptnGoodsCd) {
        await failTask(state, "parallel_worker_context_identity_mismatch", "복제창과 채널 작업 식별자가 달라 이 채널만 안전중단했습니다.");
        return;
      }
      if (state.stage === "submit_clicked") {
        if (isSubmitResultPage()) await checkSubmitOutcome(state);
        return;
      }
      if (isIdChoicePage()) { await driveIdChoice(state); return; }
      if (isPreProdChoicePage()) { await drivePreProd(state); return; }
      if (isProductListUi()) { await driveProductList(state); return; }
      if (window.top === window && isAdminShell()) await navigateWorkerShell(state);
    } catch (error) {
      const context = await workerContext();
      if (context.worker && context.runId && context.goodsKey) {
        const state = await getWorkerState(context.runId, context.goodsKey);
        if (state?.status === "running") {
          await failTask(state, "parallel_worker_unhandled_exception", error instanceof Error ? error.message : String(error || "Parallel Worker 오류"));
        }
      }
    } finally {
      driving = false;
    }
  }

  async function collectRunWorkerStates(run) {
    const tasks = Array.isArray(run?.tasks) ? run.tasks : [];
    return Promise.all(tasks.map((task) => getWorkerState(run.runId, task.goodsKey)));
  }

  function setPanelStatus(message, kind = "info", busy = false) {
    const status = document.getElementById(STATUS_ID);
    const button = document.getElementById(BUTTON_ID);
    if (status) {
      status.textContent = message;
      status.style.color = kind === "error" ? "#b91c1c" : kind === "success" ? "#166534" : "#475569";
    }
    if (button) {
      button.disabled = busy;
      button.style.opacity = busy ? "0.6" : "1";
      button.textContent = busy ? "채널별 병렬 처리 중..." : "1상품 · 남은 채널 병렬 Fresh Worker";
    }
  }

  async function refreshPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const context = await workerContext();
    if (context.worker) {
      panel.style.display = "none";
      return;
    }
    panel.style.display = "block";
    const run = await getRunState();
    if (!run) {
      setPanelStatus("남은 채널마다 A18 복제창을 1개씩 만들고 동시에 처리합니다.", "info", false);
      return;
    }
    const states = (await collectRunWorkerStates(run)).filter(Boolean);
    const running = states.filter((row) => row.status === "running").length;
    const sent = states.filter((row) => row.status === "completed" && row.outcome === "sent").length;
    const skipped = states.filter((row) => row.status === "completed" && row.outcome === "already_registered").length;
    const failed = states.filter((row) => row.status === "failed").length;
    const confirm = states.filter((row) => row.status === "confirm_needed").length;
    const total = Array.isArray(run.tasks) ? run.tasks.length : states.length;

    if (running > 0 || run.status === "opening") {
      setPanelStatus(`병렬 ${total}채널 · 실행 ${running} · 성공 ${sent} · 이미등록 ${skipped} · 실패 ${failed} · 확인필요 ${confirm}`, "info", true);
      return;
    }
    if (confirm > 0) {
      setPanelStatus(`병렬 작업 종료 · 성공 ${sent} · 이미등록 ${skipped} · 실패 ${failed} · 확인필요 ${confirm} · 확인필요 채널은 재실행하지 마세요.`, "error", true);
      if (run.status !== "confirm_needed") await saveRunState({ ...run, status: "confirm_needed", updatedAt: Date.now() });
      return;
    }
    if (states.length >= total && total > 0) {
      setPanelStatus(`병렬 작업 완료 · 성공 ${sent} · 이미등록 ${skipped} · 실패/재대기 ${failed}`, failed ? "error" : "success", false);
      if (run.status !== "completed") await saveRunState({ ...run, status: "completed", finishedAt: Date.now(), updatedAt: Date.now() });
      return;
    }
    setPanelStatus("병렬 작업 상태를 동기화 중입니다.", "info", true);
  }

  async function startParallelCanary() {
    const existing = await getRunState();
    if (existing?.status === "opening" || existing?.status === "running" || existing?.status === "confirm_needed") {
      await refreshPanel();
      return;
    }

    const runId = newRunId();
    setPanelStatus("Commerce OS 원장에서 남은 채널을 확보 중입니다.", "info", true);
    const claim = await sendMessage({ type: CLAIM_MESSAGE, runId });
    if (!claim?.ok) {
      setPanelStatus(`대상 확보 실패: ${text(claim?.message || claim?.error)}`, "error", false);
      return;
    }
    const tasks = Array.isArray(claim.tasks) ? claim.tasks : [];
    if (!tasks.length) {
      setPanelStatus("검증 가능한 마켓 대기 채널이 없습니다.", "success", false);
      return;
    }

    const now = Date.now();
    const run = {
      version: VERSION,
      runId,
      tasks,
      status: "opening",
      startedAt: now,
      updatedAt: now,
      message: `남은 ${tasks.length}개 채널을 각각 독립 A18 복제창으로 병렬 시작`,
    };
    await saveRunState(run);
    await initializeWorkerStates(runId, tasks);

    const opened = await sendMessage({ type: OPEN_WORKERS_MESSAGE, runId, tasks });
    if (!opened?.ok) {
      const states = await collectRunWorkerStates(run);
      for (const state of states.filter(Boolean)) {
        if (state.status === "running") {
          await patchWorkerState(state, {
            status: "failed",
            stage: "worker_open_failed",
            message: `병렬 A18 작업창 생성 실패: ${text(opened?.message || opened?.error)}`,
          });
        }
      }
      await saveRunState({ ...run, status: "failed", updatedAt: Date.now() });
      setPanelStatus(`병렬 작업창 생성 실패: ${text(opened?.message || opened?.error)}`, "error", false);
      return;
    }

    for (const failure of Array.isArray(opened.failed) ? opened.failed : []) {
      const failedState = await getWorkerState(runId, failure.goodsKey);
      if (failedState) {
        await patchWorkerState(failedState, {
          status: failure.released ? "failed" : "confirm_needed",
          stage: "worker_open_failed",
          message: `${failure.profile} 복제창 생성 실패: ${text(failure.message || failure.error)}`,
        });
      }
    }

    await saveRunState({
      ...run,
      status: "running",
      openedCount: Number(opened.openedCount || 0),
      failedOpenCount: Number(opened.failedCount || 0),
      updatedAt: Date.now(),
    });
    await refreshPanel();
  }

  function mount() {
    if (!isProductListUi() || document.getElementById(PANEL_ID)) return;
    const box = document.createElement("div");
    box.id = PANEL_ID;
    box.style.cssText = [
      "position:fixed",
      "right:18px",
      "bottom:40px",
      "z-index:2147483647",
      "width:450px",
      "padding:12px",
      "border:2px solid #0f766e",
      "border-radius:10px",
      "background:#fff",
      "box-shadow:0 8px 30px rgba(15,23,42,.18)",
      "font:12px/1.45 Arial,sans-serif",
      "color:#0f172a",
    ].join(";");
    const title = document.createElement("div");
    title.textContent = `Commerce OS · Parallel Fresh Worker Canary v${VERSION}`;
    title.style.cssText = "font-weight:700;margin-bottom:5px;color:#0f766e";
    const guide = document.createElement("div");
    guide.textContent = "원본 A18 유지 → 남은 채널 수만큼 A18 복제창 → 각 창은 자기 채널만 독립 처리 → 동시에 진행";
    guide.style.cssText = "font-size:11px;color:#64748b;margin-bottom:7px";
    const status = document.createElement("div");
    status.id = STATUS_ID;
    status.textContent = "채널별 독립 병렬 Worker 준비";
    status.style.cssText = "margin-bottom:8px;color:#475569";
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = "1상품 · 남은 채널 병렬 Fresh Worker";
    button.style.cssText = "width:100%;padding:10px;border:0;border-radius:7px;background:#0f766e;color:#fff;font-weight:700;cursor:pointer";
    button.addEventListener("click", () => void startParallelCanary());
    const guard = document.createElement("div");
    guard.textContent = "1채널=1복제창 · goods_key+자사상품코드 동시일치 · 채널별 독립 잠금 · 셀파 실패만 무시 · 비셀파 실패는 해당 창만 확인필요";
    guard.style.cssText = "font-size:10px;color:#0f766e;margin-top:7px";
    box.append(title, guide, status, button, guard);
    document.documentElement.appendChild(box);
    void refreshPanel();
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes[RUN_STATE_KEY] || Object.keys(changes).some((key) => key.startsWith(`${WORKER_STATE_PREFIX}:`))) {
      void refreshPanel();
    }
  });

  mount();
  const observer = new MutationObserver(() => mount());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  timer = setInterval(() => void drive(), 800);
  panelTimer = setInterval(() => void refreshPanel(), 1200);
  void drive();
  window.addEventListener("pagehide", () => {
    if (timer) clearInterval(timer);
    if (panelTimer) clearInterval(panelTimer);
  }, { once: true });
})();
