(() => {
  "use strict";

  const PIPE_CLAIM_MESSAGE = "commerce-os-shopling-pipeline-claim";
  const PIPE_REPORT_MESSAGE = "commerce-os-shopling-pipeline-report";
  const PIPE_MARKET_START_MESSAGE = "commerce-os-shopling-pipeline-market-start";
  const PIPE_MARKET_CONTEXT_MESSAGE = "commerce-os-shopling-pipeline-market-context";
  const PIPE_MARKET_STAGE_MESSAGE = "commerce-os-shopling-pipeline-market-stage";
  const PIPE_MARKET_RESULT_MESSAGE = "commerce-os-shopling-pipeline-market-result";
  const PIPE_MARKET_ARM_SUBMIT_MESSAGE = "commerce-os-shopling-pipeline-market-arm-submit";
  const PIPE_MARKET_PROGRESS_MESSAGE = "commerce-os-shopling-pipeline-market-progress";
  const TITLE_BATCH_START_MESSAGE = "commerce-os-shopling-title-batch-start";
  const TITLE_BATCH_PROGRESS_MESSAGE = "commerce-os-shopling-title-batch-progress";
  const PIPE_UI_RUN_KEY = "commerceOsShoplingPipelineUiRun";
  const PIPE_MARKET_LAST_RUN_KEY = "commerceOsShoplingPipelineMarketLastRun";
  const PANEL_ID = "commerce-os-shopling-onebutton-panel";
  const STATUS_ID = `${PANEL_ID}-status`;
  const BUTTON_ID = `${PANEL_ID}-button`;
  const DETAILS_ID = `${PANEL_ID}-details`;
  const TOKEN_SESSION_KEY = "commerceOsShoplingPipelineToken";

  const CHANNELS = Object.freeze([
    ["DM1", "도매1"],
    ["DM2", "도매2"],
    ["DM3", "도매3"],
    ["DM4", "도매4"],
    ["SM1", "소매1"],
    ["SM2", "소매2"],
  ]);

  function text(value) {
    return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  }

  function canonical(value) {
    return text(value).replace(/\s+/g, "").toUpperCase();
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
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

  function tokenFromWindowName(value) {
    const match = text(value).match(/commerce-os-pipeline:([A-Za-z0-9._-]+)/);
    return match?.[1] || "";
  }

  function discoverWorkerToken() {
    const queryToken = new URLSearchParams(location.search).get("commerce_os_pipeline_token") || "";
    if (queryToken) return queryToken;
    try {
      const stored = sessionStorage.getItem(TOKEN_SESSION_KEY) || "";
      if (stored) return stored;
    } catch {
      // Optional optimization.
    }
    const own = tokenFromWindowName(window.name);
    if (own) return own;
    try {
      const opener = tokenFromWindowName(window.opener?.name || "");
      if (opener) return opener;
    } catch {
      // Cross-window access can be denied after navigation.
    }
    return "";
  }

  function persistWorkerToken(token) {
    if (!token) return;
    try {
      sessionStorage.setItem(TOKEN_SESSION_KEY, token);
    } catch {
      // Non-blocking.
    }
    try {
      window.name = `commerce-os-pipeline:${token}`;
    } catch {
      // Non-blocking.
    }
  }

  function localStageKey(token) {
    return `commerceOsShoplingPipelineStage:${token}`;
  }

  function getLocalStage(token) {
    try {
      return sessionStorage.getItem(localStageKey(token)) || "";
    } catch {
      return "";
    }
  }

  function setLocalStage(token, stage) {
    try {
      sessionStorage.setItem(localStageKey(token), stage);
    } catch {
      // Non-blocking.
    }
  }

  async function reportStage(token, stage, message = "") {
    setLocalStage(token, stage);
    return sendRuntimeMessage({ type: PIPE_MARKET_STAGE_MESSAGE, token, stage, message });
  }

  async function reportResult(token, outcome, reasonCode, message, retryable = true) {
    setLocalStage(token, "finished");
    return sendRuntimeMessage({
      type: PIPE_MARKET_RESULT_MESSAGE,
      token,
      outcome,
      reasonCode,
      message,
      retryable,
    });
  }

  function bodyText() {
    return text(document.body?.innerText || document.body?.textContent || "");
  }

  function isProductListPath() {
    return location.hostname === "a.shopling.co.kr" && /\/prod\/prodList\.phtml$/i.test(location.pathname);
  }

  function isIdChoicePage() {
    return location.hostname === "a.shopling.co.kr" && /\/prodlinkage\/goods_mallReg_idChoice\.phtml$/i.test(location.pathname);
  }

  function isPreProdChoicePage() {
    return location.hostname === "a.shopling.co.kr" && /\/prodlinkage\/goods_mallReg_preProdChoice\.phtml$/i.test(location.pathname);
  }

  function expectedResultCount() {
    const match = bodyText().match(/총\s*조회수\s*[:：]?\s*([\d,]+)\s*건/);
    return match ? Number(match[1].replace(/,/g, "")) || 0 : -1;
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

  function selectWithOption(pattern, scope = document) {
    for (const select of scope.querySelectorAll("select")) {
      if ([...select.options].some((option) => pattern.test(text(option.textContent)))) return select;
    }
    return null;
  }

  function setSelectByPattern(select, pattern) {
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
    while (node && hops < 6) {
      hops += 1;
      if (node instanceof HTMLInputElement || node instanceof HTMLSelectElement) break;
      const value = text(node.textContent || node.nodeValue || "");
      if (value) pieces.push(value);
      node = node.nextSibling;
    }
    return text(pieces.join(" "));
  }

  function findChoiceByLabel(pattern, type = "radio") {
    return [...document.querySelectorAll(`input[type="${type}"]:not([disabled])`)]
      .find((control) => pattern.test(controlLabel(control))) || null;
  }

  function selectChoiceByLabel(pattern, type = "radio") {
    const control = findChoiceByLabel(pattern, type);
    if (!control) return false;
    if (!control.checked) {
      control.click();
      if (!control.checked) {
        control.checked = true;
        control.dispatchEvent(new Event("input", { bubbles: true }));
        control.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    return control.checked;
  }

  function nearestTextInput(anchor, scope) {
    const inputs = [...scope.querySelectorAll('input[type="text"]:not([disabled]):not([readonly]), input:not([type]):not([disabled]):not([readonly])')]
      .filter(isVisible);
    if (!inputs.length) return null;
    if (!(anchor instanceof Element)) return inputs[0];
    const anchorRect = anchor.getBoundingClientRect();
    return inputs
      .map((input) => {
        const rect = input.getBoundingClientRect();
        return { input, distance: Math.abs(rect.top - anchorRect.top) * 3 + Math.abs(rect.left - anchorRect.right) };
      })
      .sort((a, b) => a.distance - b.distance)[0]?.input || null;
  }

  function candidateButtons(scope, pattern) {
    return [...scope.querySelectorAll('button, input[type="button"], input[type="submit"], a')]
      .filter((element) => !element.disabled && isVisible(element))
      .filter((element) => pattern.test(text(element.value || element.innerText || element.textContent || "")));
  }

  function nearestButton(scope, pattern, anchor = null) {
    const candidates = candidateButtons(scope, pattern);
    if (!candidates.length) return null;
    if (!(anchor instanceof Element)) return candidates[0];
    const anchorRect = anchor.getBoundingClientRect();
    return candidates
      .map((button) => {
        const rect = button.getBoundingClientRect();
        return { button, distance: Math.abs(rect.top - anchorRect.top) * 3 + Math.abs(rect.left - anchorRect.right) };
      })
      .sort((a, b) => a.distance - b.distance)[0]?.button || null;
  }

  function clickElement(element) {
    if (!(element instanceof HTMLElement)) return false;
    element.scrollIntoView({ block: "center", inline: "center" });
    element.click();
    return true;
  }

  function setInputValue(input, value) {
    if (!(input instanceof HTMLInputElement)) return false;
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
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
      .filter((entry) => entry.checkbox && isVisible(entry.checkbox));
  }

  function checkSingleRow(entry) {
    const control = entry?.checkbox;
    if (!(control instanceof HTMLInputElement)) return false;
    for (const other of dataRowsWithCheckboxes()) {
      if (other.checkbox !== control && other.checkbox.checked && other.checkbox.type === "checkbox") {
        other.checkbox.click();
      }
    }
    if (!control.checked) control.click();
    if (!control.checked) {
      control.checked = true;
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return control.checked;
  }

  async function handleProductListWorker(token, context) {
    const stage = getLocalStage(token);
    if (!stage || ["opening", "worker-opened", "retrying"].includes(stage)) {
      const searchType = await waitFor(() => selectWithOption(/자사\s*상품\s*코드|자체\s*상품\s*코드|자사\s*코드/i), 15000);
      if (!searchType) {
        await reportResult(token, "failed", "self_code_filter_missing", "자사상품코드 검색조건을 찾지 못했습니다.");
        return;
      }
      const form = searchType.closest("form") || document;
      const searchInput = nearestTextInput(searchType, form);
      if (!searchInput) {
        await reportResult(token, "failed", "search_input_missing", "상품조회 검색어 입력칸을 찾지 못했습니다.");
        return;
      }
      if (!setSelectByPattern(searchType, /자사\s*상품\s*코드|자체\s*상품\s*코드|자사\s*코드/i)) {
        await reportResult(token, "failed", "self_code_filter_apply_failed", "자사상품코드 검색조건 적용에 실패했습니다.");
        return;
      }

      const unregisteredPattern = /쇼핑몰.*미등록|미등록.*쇼핑몰|미등록\s*상품/i;
      const unregisteredSelect = selectWithOption(unregisteredPattern, form) || selectWithOption(unregisteredPattern, document);
      let unregisteredApplied = unregisteredSelect ? setSelectByPattern(unregisteredSelect, unregisteredPattern) : false;
      if (!unregisteredApplied) {
        unregisteredApplied = selectChoiceByLabel(unregisteredPattern, "radio") || selectChoiceByLabel(unregisteredPattern, "checkbox");
      }
      if (!unregisteredApplied) {
        await reportResult(token, "confirm", "unregistered_filter_missing", "'쇼핑몰에 미등록된 상품' 조건을 찾지 못해 전송하지 않았습니다.", false);
        return;
      }

      setInputValue(searchInput, context.ptnGoodsCd);
      const searchButton = nearestButton(form, /^(?:검색|조회)$/i, searchInput) || nearestButton(document, /^(?:검색|조회)$/i, searchInput);
      await reportStage(token, "search-submitted", `${context.ptnGoodsCd} 정확일치 미등록 조회`);
      if (searchButton) {
        clickElement(searchButton);
        return;
      }
      if (form instanceof HTMLFormElement) {
        if (typeof form.requestSubmit === "function") form.requestSubmit();
        else form.submit();
        return;
      }
      await reportResult(token, "failed", "search_button_missing", "상품조회 검색 버튼을 찾지 못했습니다.");
      return;
    }

    if (stage === "search-submitted") {
      await sleep(500);
      const count = expectedResultCount();
      if (count === 0) {
        await reportResult(
          token,
          "already_registered",
          "no_exact_unregistered_product",
          `${context.ptnGoodsCd}는 Shopling 미등록 조회결과가 0건입니다. 이미 등록됐거나 현재 미등록 대상이 아니므로 재전송하지 않습니다.`,
          false,
        );
        return;
      }

      const exact = canonical(context.ptnGoodsCd);
      const matchingRows = dataRowsWithCheckboxes().filter((entry) => canonical(entry.label).includes(exact));
      if (matchingRows.length !== 1) {
        await reportResult(
          token,
          "confirm",
          "exact_product_row_ambiguous",
          `${context.ptnGoodsCd} 정확일치 선택행이 ${matchingRows.length}개입니다. 다른 상품을 건드리지 않고 중단합니다.`,
          false,
        );
        return;
      }
      if (!checkSingleRow(matchingRows[0])) {
        await reportResult(token, "failed", "exact_product_select_failed", `${context.ptnGoodsCd} 정확일치 상품 선택에 실패했습니다.`);
        return;
      }

      const registerButton = nearestButton(document, /쇼핑몰\s*상품\s*등록(?:하기)?|쇼핑몰상품등록(?:하기)?|상품\s*등록\s*하기/i);
      if (!registerButton) {
        await reportResult(token, "failed", "market_register_button_missing", "'쇼핑몰 상품등록하기' 버튼을 찾지 못했습니다.");
        return;
      }
      await reportStage(token, "registration-opening", `${context.ptnGoodsCd} 1건만 상품등록창 열기`);
      clickElement(registerButton);
      return;
    }
  }

  function profileSelect() {
    const known = new Set(CHANNELS.map(([, profile]) => profile));
    return [...document.querySelectorAll("select")].find((select) => {
      const values = [...select.options].map((option) => text(option.textContent));
      return values.filter((value) => known.has(value)).length >= 3;
    }) || null;
  }

  async function continueIdChoice(token, context) {
    const select = profileSelect();
    if (!select || !setSelectByPattern(select, new RegExp(`^${context.profile}$`))) {
      await reportResult(token, "confirm", "saved_profile_missing", `${context.profile} 저장 검색관리를 찾지 못했습니다.`, false);
      return;
    }
    const rows = dataRowsWithCheckboxes();
    let selected = rows.filter((entry) => entry.checkbox.checked);
    if (!selected.length) {
      if (rows.length > 0 && rows.length <= 12) {
        for (const entry of rows) {
          if (!entry.checkbox.checked) entry.checkbox.click();
        }
        selected = rows.filter((entry) => entry.checkbox.checked);
      } else {
        await reportResult(
          token,
          "confirm",
          "saved_profile_not_narrowed",
          `${context.profile} 적용 후 선택대상이 ${rows.length}행이라 저장검색 계정군을 확신할 수 없습니다.`,
          false,
        );
        return;
      }
    }
    if (!selected.length) {
      await reportResult(token, "confirm", "mall_account_selection_empty", `${context.profile} 쇼핑몰 ID 선택이 비어 있습니다.`, false);
      return;
    }
    const selectButton = nearestButton(document, /^선택$/);
    if (!selectButton) {
      await reportResult(token, "failed", "mall_id_select_button_missing", "쇼핑몰 ID 선택 완료 버튼을 찾지 못했습니다.");
      return;
    }
    await reportStage(token, "mall-ids-selected", `${context.profile} 쇼핑몰 ID ${selected.length}개 선택`);
    clickElement(selectButton);
  }

  async function handleIdChoiceWorker(token, context) {
    const select = await waitFor(() => profileSelect(), 12000);
    if (!select) {
      await reportResult(token, "confirm", "saved_profile_select_missing", "저장 검색관리 선택창을 찾지 못했습니다.", false);
      return;
    }
    const selectedText = text(select.options[select.selectedIndex]?.textContent || "");
    if (selectedText !== context.profile) {
      await reportStage(token, "profile-applying", `${context.profile} 저장 검색관리 적용`);
      if (!setSelectByPattern(select, new RegExp(`^${context.profile}$`))) {
        await reportResult(token, "confirm", "saved_profile_missing", `${context.profile} 저장 검색관리를 찾지 못했습니다.`, false);
        return;
      }
      await sleep(1400);
    }
    await continueIdChoice(token, context);
  }

  function applyMappingSelections() {
    const required = [
      { name: "쇼핑몰별 상품판매가", pattern: /^쇼핑몰별\s*상품판매가$/ },
      { name: "상품설명", pattern: /^상품설명$/ },
      { name: "쇼핑몰별 상품명", pattern: /^쇼핑몰별\s*상품명$/ },
      { name: "검색어", pattern: /^검색어$/ },
      { name: "옵션명", pattern: /^옵션명$/ },
      {
        name: "카테고리 미매핑시 기본정보 카테고리",
        pattern: /매핑된\s*카테고리가\s*없을시.*무시하고.*쇼핑몰기본정보의\s*카테고리로\s*전송/,
      },
    ];
    const missing = [];
    for (const item of required) {
      if (!selectChoiceByLabel(item.pattern, "radio")) missing.push(item.name);
    }
    return { ok: missing.length === 0, missing };
  }

  function submissionOutcomeFromPage() {
    const content = bodyText();
    if (/(?:등록|전송|송신).{0,30}(?:실패|오류|에러|불가)|(?:실패|오류|에러).{0,30}(?:등록|전송|송신)/i.test(content)) return "failed";
    if (/(?:등록|전송|송신).{0,30}(?:완료|성공|되었습니다)|(?:완료|성공).{0,30}(?:등록|전송|송신)/i.test(content)) return "sent";
    return "";
  }

  async function handleSubmittedPage(token, context) {
    await sleep(1200);
    const outcome = submissionOutcomeFromPage();
    if (outcome === "sent") {
      await reportResult(token, "sent", "shopling_submit_success", `${context.ptnGoodsCd} Shopling 송신 완료를 확인했습니다.`, false);
    } else if (outcome === "failed") {
      await reportResult(token, "confirm", "shopling_submit_reported_failure", `${context.ptnGoodsCd} 송신 후 실패/오류 문구를 감지했습니다. 재전송하지 않습니다.`, false);
    }
  }

  async function handlePreProdChoiceWorker(token, context) {
    const mapping = applyMappingSelections();
    if (!mapping.ok) {
      await reportResult(token, "confirm", "mapping_controls_missing", `쇼핑몰 연동 정보 ${mapping.missing.join(", ")} 항목을 정확히 찾지 못했습니다.`, false);
      return;
    }
    const sendButton = nearestButton(document, /^상품\s*등록\s*송신$/i) || nearestButton(document, /상품등록송신/i);
    if (!sendButton) {
      await reportResult(token, "confirm", "registration_send_button_missing", "상품등록송신 버튼을 찾지 못했습니다.", false);
      return;
    }

    const armed = await sendRuntimeMessage({ type: PIPE_MARKET_ARM_SUBMIT_MESSAGE, token });
    if (!armed?.ok) {
      await reportResult(token, "confirm", "durable_submit_lock_failed", `Commerce OS 중복방지 송신 잠금에 실패해 클릭하지 않았습니다: ${text(armed?.message)}`, false);
      return;
    }
    const staged = await reportStage(token, "submitted", `${context.ptnGoodsCd} 송신 잠금 후 상품등록송신 클릭`);
    if (!staged?.ok) {
      await reportResult(token, "confirm", "submitted_stage_rejected", "송신 잠금 상태 검증에 실패해 상품등록송신을 클릭하지 않았습니다.", false);
      return;
    }
    clickElement(sendButton);

    setTimeout(() => {
      void (async () => {
        if (getLocalStage(token) !== "submitted") return;
        const outcome = submissionOutcomeFromPage();
        if (outcome === "sent") {
          await reportResult(token, "sent", "shopling_submit_success", `${context.ptnGoodsCd} Shopling 송신 완료를 확인했습니다.`, false);
          return;
        }
        if (outcome === "failed") {
          await reportResult(token, "confirm", "shopling_submit_reported_failure", `${context.ptnGoodsCd} 송신 후 실패/오류 문구를 감지했습니다. 재전송하지 않습니다.`, false);
          return;
        }
        await reportResult(token, "confirm", "submit_result_ambiguous", `${context.ptnGoodsCd} 송신 클릭 후 결과를 판별하지 못했습니다. 자동 재전송은 차단했습니다.`, false);
      })();
    }, 20000);
  }

  async function runWorker(token) {
    persistWorkerToken(token);
    const context = await sendRuntimeMessage({ type: PIPE_MARKET_CONTEXT_MESSAGE, token });
    if (!context?.ok) return;

    if (isIdChoicePage()) {
      await handleIdChoiceWorker(token, context);
      return;
    }
    if (isPreProdChoicePage()) {
      await handlePreProdChoiceWorker(token, context);
      return;
    }
    if (getLocalStage(token) === "submitted") {
      await handleSubmittedPage(token, context);
      return;
    }
    if (isProductListPath()) {
      await handleProductListWorker(token, context);
      return;
    }

    await sleep(2200);
    if (isIdChoicePage() || isPreProdChoicePage() || isProductListPath()) {
      await runWorker(token);
      return;
    }
    await reportResult(token, "failed", "unexpected_shopling_page", `예상하지 못한 Shopling 화면입니다: ${location.pathname}`);
  }

  function newUiRunId() {
    return `pipeline-ui-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  async function loadUiRun() {
    try {
      const stored = await chrome.storage.session.get(PIPE_UI_RUN_KEY);
      return stored?.[PIPE_UI_RUN_KEY] || null;
    } catch {
      return null;
    }
  }

  async function saveUiRun(run) {
    try {
      if (!run) await chrome.storage.session.remove(PIPE_UI_RUN_KEY);
      else await chrome.storage.session.set({ [PIPE_UI_RUN_KEY]: run });
    } catch {
      // UI state is secondary to durable server state.
    }
  }

  function setPanelStatus(message, kind = "info") {
    const node = document.getElementById(STATUS_ID);
    if (!node) return;
    node.textContent = message;
    node.style.color = kind === "error" ? "#b91c1c" : kind === "success" ? "#166534" : "#475569";
  }

  function setPanelBusy(busy, label = "") {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;
    button.disabled = Boolean(busy);
    button.style.opacity = busy ? "0.6" : "1";
    button.textContent = label || (busy ? "신규상품 자동처리 진행 중..." : "신규상품 전체 자동처리 · 동시 2창");
  }

  function renderDetails(tasks) {
    const host = document.getElementById(DETAILS_ID);
    if (!host) return;
    host.replaceChildren();
    const noteworthy = (Array.isArray(tasks) ? tasks : []).filter((task) =>
      ["failed", "confirm"].includes(task.status) || ["failed", "confirm"].includes(task.outcome),
    );
    if (!noteworthy.length) return;
    const details = document.createElement("details");
    details.style.cssText = "margin-top:7px;border-top:1px solid #fed7aa;padding-top:6px";
    const summary = document.createElement("summary");
    summary.textContent = `확인필요/실패 ${noteworthy.length}건 보기`;
    summary.style.cssText = "cursor:pointer;font-weight:700;color:#b91c1c";
    details.appendChild(summary);
    for (const task of noteworthy) {
      const row = document.createElement("div");
      row.style.cssText = "padding:4px 0;border-bottom:1px dotted #e2e8f0;font-size:11px";
      row.textContent = `${task.ptnGoodsCd || task.goodsKey || "상품"} · ${task.message || task.reasonCode || task.outcome}`;
      details.appendChild(row);
    }
    host.appendChild(details);
  }

  async function reportTitleFailures(uiRun, failures) {
    const failureMap = new Map((Array.isArray(failures) ? failures : []).map((failure) => [text(failure.goodsKey), failure]));
    const failedGoodsKeys = new Set(failureMap.keys());
    await Promise.all(uiRun.tasks.filter((task) => failedGoodsKeys.has(task.goodsKey)).map(async (task) => {
      const failure = failureMap.get(task.goodsKey) || {};
      await sendRuntimeMessage({
        type: PIPE_REPORT_MESSAGE,
        runId: uiRun.runId,
        goodsKey: task.goodsKey,
        outcome: "title_failed",
        reasonCode: text(failure.reasonCode) || "title_diversification_failed",
        message: text(failure.message) || `${task.ptnGoodsCd} 상품명 분산에 실패했습니다.`,
      });
    }));
    return failedGoodsKeys;
  }

  async function startMarketAfterTitles(uiRun, failures) {
    const failedGoodsKeys = await reportTitleFailures(uiRun, failures);
    const marketTasks = uiRun.tasks.filter((task) => !failedGoodsKeys.has(task.goodsKey));
    uiRun.stage = "market";
    uiRun.marketTaskCount = marketTasks.length;
    uiRun.titleFailed = failedGoodsKeys.size;
    await saveUiRun(uiRun);

    if (!marketTasks.length) {
      setPanelBusy(false);
      setPanelStatus(`완료 · 상품명 분산 실패 ${failedGoodsKeys.size}건 · 마켓 전송 대상 0건`, "error");
      await saveUiRun(null);
      return;
    }

    const response = await sendRuntimeMessage({
      type: PIPE_MARKET_START_MESSAGE,
      claimRunId: uiRun.runId,
      tasks: marketTasks,
    });
    if (!response?.ok) {
      await Promise.all(marketTasks.map((task) => sendRuntimeMessage({
        type: PIPE_REPORT_MESSAGE,
        runId: uiRun.runId,
        goodsKey: task.goodsKey,
        outcome: "failed",
        reasonCode: "market_queue_start_failed",
        message: text(response?.message) || "마켓 자동전송 큐를 시작하지 못했습니다.",
      })));
      setPanelBusy(false);
      setPanelStatus("마켓 자동전송 큐 시작에 실패했습니다. 해당 상품은 자동 재작업하지 않습니다.", "error");
      await saveUiRun(null);
      return;
    }
    setPanelStatus(`상품명 분산 완료 · 마켓 ${marketTasks.length}건 자동전송 시작 · 동시 ${response.lanes}창`);
  }

  async function startOneButtonPipeline() {
    const existing = await loadUiRun();
    if (existing?.status === "running") {
      setPanelStatus("이미 신규상품 자동처리가 진행 중입니다.", "error");
      return;
    }
    setPanelBusy(true, "OPS CENTER 신규등록 확인 중...");
    setPanelStatus("현재 Shopling 조회조건과 무관하게 OPS CENTER 신규등록 원장을 확인합니다.");

    const runId = newUiRunId();
    const claim = await sendRuntimeMessage({ type: PIPE_CLAIM_MESSAGE, runId });
    if (!claim?.ok) {
      setPanelBusy(false);
      setPanelStatus(`신규등록 원장 확인 실패: ${text(claim?.message || claim?.error)}`, "error");
      return;
    }
    const tasks = Array.isArray(claim.tasks) ? claim.tasks : [];
    if (!tasks.length) {
      setPanelBusy(false);
      setPanelStatus("신규 미처리 상품 0건 · 이전 처리상품은 자동 제외되었습니다.", "success");
      return;
    }

    const goodsKeys = [...new Set(tasks.map((task) => text(task.goodsKey)).filter((value) => /^\d{5,9}$/.test(value)))];
    const uiRun = {
      runId,
      status: "running",
      stage: "title",
      tasks,
      goodsKeys,
      launchItemCount: Number(claim.launchItemCount || 0),
      startedAt: new Date().toISOString(),
    };
    await saveUiRun(uiRun);

    setPanelStatus(`신규 ${uiRun.launchItemCount}개 상품군 · ${goodsKeys.length}개 채널 상품명 분산 시작`);
    setPanelBusy(true, `상품명 분산 0/${goodsKeys.length}`);
    const batch = await sendRuntimeMessage({ type: TITLE_BATCH_START_MESSAGE, goodsKeys });
    if (!batch?.ok) {
      await Promise.all(tasks.map((task) => sendRuntimeMessage({
        type: PIPE_REPORT_MESSAGE,
        runId,
        goodsKey: task.goodsKey,
        outcome: "title_failed",
        reasonCode: "title_batch_start_failed",
        message: text(batch?.message) || "상품명 일괄 분산을 시작하지 못했습니다.",
      })));
      setPanelBusy(false);
      setPanelStatus("상품명 분산 시작에 실패했습니다. claim 상품은 자동 재작업하지 않습니다.", "error");
      await saveUiRun(null);
    }
  }

  async function showLastRun() {
    try {
      const stored = await chrome.storage.local.get(PIPE_MARKET_LAST_RUN_KEY);
      const run = stored?.[PIPE_MARKET_LAST_RUN_KEY];
      if (!run || run.status !== "completed") return;
      if (Number(run.failed || 0) || Number(run.confirmNeeded || 0)) renderDetails(run.tasks || []);
    } catch {
      // Optional diagnostics only.
    }
  }

  function mountPanel() {
    if (document.getElementById(PANEL_ID) || !isProductListPath()) return;
    if (discoverWorkerToken()) return;

    const box = document.createElement("div");
    box.id = PANEL_ID;
    box.style.cssText = [
      "position:fixed",
      "right:18px",
      "bottom:235px",
      "z-index:2147483646",
      "width:390px",
      "padding:12px",
      "border:1px solid #fb923c",
      "border-radius:10px",
      "background:#fff",
      "box-shadow:0 8px 30px rgba(15,23,42,.16)",
      "font:12px/1.45 Arial,sans-serif",
      "color:#0f172a",
    ].join(";");

    const title = document.createElement("div");
    title.textContent = "Commerce OS · 신규상품 원버튼 처리";
    title.style.cssText = "font-weight:700;margin-bottom:5px";

    const mapping = document.createElement("div");
    mapping.textContent = "정확한 자사상품코드만 처리 · DM1→도매1 … SM2→소매2 · 동시 2창";
    mapping.style.cssText = "font-size:11px;color:#64748b;margin-bottom:7px";

    const status = document.createElement("div");
    status.id = STATUS_ID;
    status.textContent = "상품을 미리 검색할 필요가 없습니다. 이전 처리상품은 원장에서 제외하고 신규등록만 처리합니다.";
    status.style.cssText = "margin-bottom:8px;color:#475569";

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = "신규상품 전체 자동처리 · 동시 2창";
    button.style.cssText = "width:100%;padding:9px;border:0;border-radius:7px;background:#ea580c;color:#fff;font-weight:700;cursor:pointer";
    button.addEventListener("click", () => void startOneButtonPipeline());

    const guard = document.createElement("div");
    guard.textContent = "중복방지: Shopling 미등록 재확인 + 송신 직전 Commerce OS 영구 잠금";
    guard.style.cssText = "font-size:10px;color:#9a3412;margin-top:7px";

    const detailHost = document.createElement("div");
    detailHost.id = DETAILS_ID;

    box.append(title, mapping, status, button, guard, detailHost);
    document.documentElement.appendChild(box);
    void showLastRun();
    void (async () => {
      const existing = await loadUiRun();
      if (existing?.status === "running") {
        setPanelBusy(true);
        setPanelStatus(`이전 실행 복구 중 · 단계 ${existing.stage || "확인"}`);
      }
    })();
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== "object") return;

    if (message.type === TITLE_BATCH_PROGRESS_MESSAGE) {
      void (async () => {
        const uiRun = await loadUiRun();
        if (!uiRun || uiRun.status !== "running" || uiRun.stage !== "title") return;
        const total = Number(message.total || uiRun.goodsKeys?.length || 0);
        const done = Number(message.done || 0);
        const failed = Number(message.failed || 0);
        if (message.status === "completed") {
          setPanelBusy(true, "마켓 자동전송 준비 중...");
          setPanelStatus(`상품명 분산 완료 ${done}/${total} · 실패 ${failed} · 신규상품 마켓 전송 준비`);
          await startMarketAfterTitles(uiRun, message.failures || []);
          return;
        }
        setPanelBusy(true, `상품명 분산 ${done}/${total}`);
        setPanelStatus(`신규상품 상품명 분산 진행 ${done}/${total} · 실패 ${failed}`);
      })();
      return;
    }

    if (message.type === PIPE_MARKET_PROGRESS_MESSAGE) {
      void (async () => {
        const uiRun = await loadUiRun();
        if (!uiRun || uiRun.status !== "running" || uiRun.stage !== "market") return;
        const total = Number(message.total || 0);
        const done = Number(message.done || 0);
        const sent = Number(message.sent || 0);
        const already = Number(message.alreadyRegistered || 0);
        const failed = Number(message.failed || 0);
        const confirm = Number(message.confirmNeeded || 0);
        const active = Array.isArray(message.active) ? message.active : [];

        if (message.status === "completed") {
          setPanelBusy(false);
          setPanelStatus(
            `완료 · ${done}/${total} · 신규송신 ${sent} · 이미등록/미등록없음 ${already} · 확인필요 ${confirm} · 실패 ${failed}`,
            failed || confirm ? "error" : "success",
          );
          renderDetails(message.tasks || []);
          await saveUiRun(null);
          return;
        }

        const activeLabel = active.map((task) => `${task.ptnGoodsCd}→${task.profile}`).join(" / ");
        setPanelBusy(true, `마켓 전송 ${done}/${total}`);
        setPanelStatus(`마켓 진행 ${done}/${total} · 송신 ${sent} · 이미등록 ${already}${activeLabel ? ` · ${activeLabel}` : ""}`);
      })();
    }
  });

  const workerToken = discoverWorkerToken();
  if (workerToken) {
    persistWorkerToken(workerToken);
    void runWorker(workerToken);
  } else {
    mountPanel();
    const observer = new MutationObserver(() => mountPanel());
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
