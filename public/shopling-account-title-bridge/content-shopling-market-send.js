(() => {
  "use strict";

  const MARKET_SEND_START_MESSAGE = "commerce-os-shopling-market-send-start";
  const MARKET_SEND_CONTEXT_MESSAGE = "commerce-os-shopling-market-send-context";
  const MARKET_SEND_STAGE_MESSAGE = "commerce-os-shopling-market-send-stage";
  const MARKET_SEND_RESULT_MESSAGE = "commerce-os-shopling-market-send-result";
  const MARKET_SEND_PROGRESS_MESSAGE = "commerce-os-shopling-market-send-progress";
  const MARKET_LAST_RUN_STORAGE_KEY = "commerceOsShoplingMarketSendLastRun";
  const PANEL_ID = "commerce-os-shopling-market-send-panel";
  const STATUS_ID = `${PANEL_ID}-status`;
  const BUTTON_ID = `${PANEL_ID}-button`;
  const DETAILS_ID = `${PANEL_ID}-details`;
  const TOKEN_SESSION_KEY = "commerceOsShoplingMarketToken";
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
    const match = text(value).match(/commerce-os-market:([A-Za-z0-9._-]+)/);
    return match?.[1] || "";
  }

  function discoverWorkerToken() {
    const queryToken = new URLSearchParams(location.search).get("commerce_os_market_token") || "";
    if (queryToken) return queryToken;
    try {
      const stored = sessionStorage.getItem(TOKEN_SESSION_KEY) || "";
      if (stored) return stored;
    } catch {
      // sessionStorage is an optimization only.
    }
    const own = tokenFromWindowName(window.name);
    if (own) return own;
    try {
      const openerToken = tokenFromWindowName(window.opener?.name || "");
      if (openerToken) return openerToken;
    } catch {
      // Cross-window access may be denied during navigation.
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
      window.name = `commerce-os-market:${token}`;
    } catch {
      // Non-blocking.
    }
  }

  function stageStorageKey(token) {
    return `commerceOsMarketStage:${token}`;
  }

  function getLocalStage(token) {
    try {
      return sessionStorage.getItem(stageStorageKey(token)) || "";
    } catch {
      return "";
    }
  }

  function setLocalStage(token, stage) {
    try {
      sessionStorage.setItem(stageStorageKey(token), stage);
    } catch {
      // Non-blocking.
    }
  }

  async function reportStage(token, stage, message = "") {
    setLocalStage(token, stage);
    return sendRuntimeMessage({
      type: MARKET_SEND_STAGE_MESSAGE,
      token,
      stage,
      message,
    });
  }

  async function reportResult(token, outcome, reasonCode, message, retryable = true) {
    setLocalStage(token, "finished");
    return sendRuntimeMessage({
      type: MARKET_SEND_RESULT_MESSAGE,
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

  function isProductListPage() {
    if (location.hostname !== "a.shopling.co.kr") return false;
    if (location.pathname.startsWith("/prodlinkage/")) return false;
    const content = bodyText();
    return /총\s*조회수/.test(content) && document.querySelectorAll("tr").length > 2;
  }

  function expectedResultCount() {
    const match = bodyText().match(/총\s*조회수\s*[:：]?\s*([\d,]+)\s*건/);
    return match ? Number(match[1].replace(/,/g, "")) || 0 : -1;
  }

  function selectWithOption(pattern, scope = document) {
    for (const select of scope.querySelectorAll("select")) {
      const options = [...select.options];
      if (options.some((option) => pattern.test(text(option.textContent)))) return select;
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
    while (node && hops < 5) {
      hops += 1;
      if (node instanceof HTMLInputElement || node instanceof HTMLSelectElement) break;
      const value = text(node.textContent || node.nodeValue || "");
      if (value) pieces.push(value);
      node = node.nextSibling;
    }
    if (pieces.length) return text(pieces.join(" "));
    return "";
  }

  function findChoiceByLabel(pattern, type = "radio") {
    const controls = [...document.querySelectorAll(`input[type="${type}"]:not([disabled])`)];
    return controls.find((control) => pattern.test(controlLabel(control))) || null;
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
        return {
          input,
          distance: Math.abs(rect.top - anchorRect.top) * 3 + Math.abs(rect.left - anchorRect.right),
        };
      })
      .sort((left, right) => left.distance - right.distance)[0]?.input || null;
  }

  function candidateButtons(scope, pattern) {
    return [...scope.querySelectorAll('button, input[type="button"], input[type="submit"], a')]
      .filter((element) => !element.disabled && isVisible(element))
      .filter((element) => pattern.test(text(element.value || element.innerText || element.textContent || "")));
  }

  function nearestButton(scope, pattern, anchor = null) {
    const candidates = candidateButtons(scope, pattern);
    if (!candidates.length) return null;
    if (!(anchor instanceof Element)) {
      return candidates.sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top)[0];
    }
    const anchorRect = anchor.getBoundingClientRect();
    return candidates
      .map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          button,
          distance: Math.abs(rect.top - anchorRect.top) * 3 + Math.abs(rect.left - anchorRect.right),
        };
      })
      .sort((left, right) => left.distance - right.distance)[0]?.button || null;
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

  function checkRows(rows) {
    let changed = 0;
    for (const entry of rows) {
      const control = entry.checkbox;
      if (!control.checked) {
        control.click();
        if (!control.checked) {
          control.checked = true;
          control.dispatchEvent(new Event("input", { bubbles: true }));
          control.dispatchEvent(new Event("change", { bubbles: true }));
        }
        if (control.checked) changed += 1;
      }
    }
    return changed;
  }

  async function handleProductListWorker(token, context) {
    const stage = getLocalStage(token);
    if (!stage || ["opening", "worker-opened", "retrying"].includes(stage)) {
      const searchType = selectWithOption(/자사\s*상품\s*코드|자체\s*상품\s*코드|자사\s*코드/i);
      if (!searchType) {
        await reportResult(
          token,
          "failed",
          "self_code_filter_missing",
          `${context.searchCode} 검색용 자사상품코드 조건을 찾지 못했습니다.`,
        );
        return;
      }
      const form = searchType.closest("form") || document;
      const searchInput = nearestTextInput(searchType, form);
      if (!searchInput) {
        await reportResult(token, "failed", "search_input_missing", "상품조회 검색어 입력칸을 찾지 못했습니다.");
        return;
      }
      if (!setSelectByPattern(searchType, /자사\s*상품\s*코드|자체\s*상품\s*코드|자사\s*코드/i)) {
        await reportResult(token, "failed", "self_code_filter_apply_failed", "자사상품코드 검색 조건을 적용하지 못했습니다.");
        return;
      }

      const unregisteredSelect = selectWithOption(/쇼핑몰.*미등록|미등록.*쇼핑몰|미등록\s*상품/i, form)
        || selectWithOption(/쇼핑몰.*미등록|미등록.*쇼핑몰|미등록\s*상품/i, document);
      let unregisteredApplied = false;
      if (unregisteredSelect) {
        unregisteredApplied = setSelectByPattern(unregisteredSelect, /쇼핑몰.*미등록|미등록.*쇼핑몰|미등록\s*상품/i);
      }
      if (!unregisteredApplied) {
        unregisteredApplied = selectChoiceByLabel(/쇼핑몰.*미등록|미등록.*쇼핑몰|미등록\s*상품/i, "radio")
          || selectChoiceByLabel(/쇼핑몰.*미등록|미등록.*쇼핑몰|미등록\s*상품/i, "checkbox");
      }
      if (!unregisteredApplied) {
        await reportResult(
          token,
          "failed",
          "unregistered_filter_missing",
          "'쇼핑몰에 미등록된 상품' 조건을 찾지 못해 안전상 전송하지 않았습니다.",
          false,
        );
        return;
      }

      setInputValue(searchInput, context.searchCode);
      const searchButton = nearestButton(form, /^(?:검색|조회)$/i, searchInput)
        || nearestButton(document, /^(?:검색|조회)$/i, searchInput);
      await reportStage(token, "search-submitted", `${context.searchCode} 미등록 상품 조회`);
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
      const count = expectedResultCount();
      if (count === 0) {
        await reportResult(
          token,
          "skipped",
          "no_unregistered_products",
          `${context.searchCode} 미등록 상품이 없어 건너뜁니다.`,
          false,
        );
        return;
      }
      const rows = dataRowsWithCheckboxes().filter((entry) => {
        if (!context.searchCode) return true;
        return entry.label.toUpperCase().includes(context.searchCode.toUpperCase()) || count > 0;
      });
      if (!rows.length) {
        await reportResult(
          token,
          "failed",
          "product_rows_missing",
          `${context.searchCode} 조회결과 ${count >= 0 ? `${count}건` : ""}에서 선택 가능한 상품행을 찾지 못했습니다.`,
        );
        return;
      }
      checkRows(rows);
      const checked = rows.filter((entry) => entry.checkbox.checked).length;
      if (!checked) {
        await reportResult(token, "failed", "product_select_failed", `${context.searchCode} 상품 선택에 실패했습니다.`);
        return;
      }

      const registerButton = nearestButton(
        document,
        /쇼핑몰\s*상품\s*등록(?:하기)?|쇼핑몰상품등록(?:하기)?|상품\s*등록\s*하기/i,
      );
      if (!registerButton) {
        await reportResult(
          token,
          "failed",
          "market_register_button_missing",
          "'쇼핑몰 상품등록하기' 버튼을 찾지 못했습니다.",
        );
        return;
      }
      await reportStage(token, "registration-opening", `${context.searchCode} ${checked}개 상품 등록창 열기`);
      clickElement(registerButton);
      return;
    }
  }

  function isIdChoicePage() {
    return /\/prodlinkage\/goods_mallReg_idChoice\.phtml$/i.test(location.pathname);
  }

  function isPreProdChoicePage() {
    return /\/prodlinkage\/goods_mallReg_preProdChoice\.phtml$/i.test(location.pathname);
  }

  function profileSelect() {
    const known = new Set(CHANNELS.map(([, profile]) => profile));
    return [...document.querySelectorAll("select")].find((select) => {
      const optionTexts = [...select.options].map((option) => text(option.textContent));
      return optionTexts.filter((value) => known.has(value)).length >= 3;
    }) || null;
  }

  async function continueIdChoice(token, context) {
    const select = profileSelect();
    if (!select || !setSelectByPattern(select, new RegExp(`^${context.profile}$`))) {
      await reportResult(
        token,
        "confirm",
        "saved_profile_missing",
        `${context.profile} 저장 검색관리를 찾지 못해 전송을 중단했습니다.`,
        false,
      );
      return;
    }

    const rows = dataRowsWithCheckboxes();
    let selected = rows.filter((entry) => entry.checkbox.checked);
    if (!selected.length) {
      if (rows.length > 0 && rows.length <= 12) {
        checkRows(rows);
        selected = rows.filter((entry) => entry.checkbox.checked);
      } else {
        await reportResult(
          token,
          "confirm",
          "saved_profile_not_narrowed",
          `${context.profile} 적용 후 선택 대상이 ${rows.length}행입니다. 저장검색이 계정군을 좁혔다고 확신할 수 없어 전송하지 않았습니다.`,
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
    const select = profileSelect();
    if (!select) {
      await reportResult(token, "confirm", "saved_profile_select_missing", "검색관리 저장조건 선택창을 찾지 못했습니다.", false);
      return;
    }
    const selectedText = text(select.options[select.selectedIndex]?.textContent || "");
    if (selectedText !== context.profile) {
      await reportStage(token, "profile-applying", `${context.profile} 저장 검색관리 적용`);
      if (!setSelectByPattern(select, new RegExp(`^${context.profile}$`))) {
        await reportResult(token, "confirm", "saved_profile_missing", `${context.profile} 저장 검색관리를 찾지 못했습니다.`, false);
        return;
      }
      setTimeout(() => {
        void continueIdChoice(token, context);
      }, 1400);
      return;
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
    const failure = /(?:등록|전송|송신).{0,30}(?:실패|오류|에러|불가)|(?:실패|오류|에러).{0,30}(?:등록|전송|송신)/i.test(content);
    if (failure) return "failed";
    const success = /(?:등록|전송|송신).{0,30}(?:완료|성공|되었습니다)|(?:완료|성공).{0,30}(?:등록|전송|송신)/i.test(content);
    if (success) return "sent";
    return "";
  }

  async function handleSubmittedPage(token, context) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const outcome = submissionOutcomeFromPage();
    if (outcome === "failed") {
      await reportResult(
        token,
        "confirm",
        "shopling_submit_reported_failure",
        `${context.searchCode}→${context.profile} 송신 후 Shopling 화면에서 실패/오류 문구를 감지했습니다. 중복 재전송은 하지 않았습니다.`,
        false,
      );
      return;
    }
    if (outcome === "sent") {
      await reportResult(token, "sent", "shopling_submit_success", `${context.searchCode}→${context.profile} Shopling 송신 완료를 확인했습니다.`, false);
    }
  }

  async function handlePreProdChoiceWorker(token, context) {
    const mapping = applyMappingSelections();
    if (!mapping.ok) {
      await reportResult(
        token,
        "confirm",
        "mapping_controls_missing",
        `쇼핑몰 연동 정보 ${mapping.missing.join(", ")} 항목을 정확히 찾지 못해 안전상 송신하지 않았습니다.`,
        false,
      );
      return;
    }

    const sendButton = nearestButton(document, /^상품\s*등록\s*송신$/i)
      || nearestButton(document, /상품등록송신/i);
    if (!sendButton) {
      await reportResult(token, "confirm", "registration_send_button_missing", "상품등록송신 버튼을 찾지 못했습니다.", false);
      return;
    }

    await reportStage(token, "submitted", `${context.searchCode}→${context.profile} 상품등록송신 클릭`);
    clickElement(sendButton);

    setTimeout(() => {
      void (async () => {
        if (getLocalStage(token) !== "submitted") return;
        const outcome = submissionOutcomeFromPage();
        if (outcome === "failed") {
          await reportResult(
            token,
            "confirm",
            "shopling_submit_reported_failure",
            `${context.searchCode}→${context.profile} 송신 후 실패/오류 문구를 감지했습니다. 중복 재전송은 하지 않았습니다.`,
            false,
          );
          return;
        }
        if (outcome === "sent") {
          await reportResult(token, "sent", "shopling_submit_success", `${context.searchCode}→${context.profile} Shopling 송신 완료를 확인했습니다.`, false);
          return;
        }
        await reportResult(
          token,
          "confirm",
          "submit_result_ambiguous",
          `${context.searchCode}→${context.profile} 송신 클릭은 완료했지만 20초 안에 결과 문구를 판별하지 못했습니다. 중복 재전송은 막았습니다.`,
          false,
        );
      })();
    }, 20000);
  }

  async function runWorker(token) {
    persistWorkerToken(token);
    const context = await sendRuntimeMessage({
      type: MARKET_SEND_CONTEXT_MESSAGE,
      token,
    });
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
    if (isProductListPage()) {
      await handleProductListWorker(token, context);
      return;
    }

    setTimeout(() => {
      void (async () => {
        if (isIdChoicePage() || isPreProdChoicePage() || isProductListPage()) {
          await runWorker(token);
          return;
        }
        await reportResult(
          token,
          "failed",
          "unexpected_shopling_page",
          `예상하지 못한 Shopling 화면에서 자동화가 멈췄습니다: ${location.pathname}`,
        );
      })();
    }, 2200);
  }

  function setPanelStatus(message, kind = "info") {
    const node = document.getElementById(STATUS_ID);
    if (!node) return;
    node.textContent = message;
    node.style.color = kind === "error" ? "#b91c1c" : kind === "success" ? "#166534" : "#475569";
  }

  function setPanelBusy(busy) {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;
    button.disabled = Boolean(busy);
    button.style.opacity = busy ? "0.6" : "1";
    button.textContent = busy ? "마켓 자동전송 진행 중..." : "마켓 자동전송 시작 · 동시 2창";
  }

  function renderTaskDetails(tasks) {
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
      row.textContent = `${task.searchCode}→${task.profile} · ${task.message || task.reasonCode || task.outcome}`;
      details.appendChild(row);
    }
    host.appendChild(details);
  }

  async function showLastMarketRun() {
    try {
      const stored = await chrome.storage.local.get(MARKET_LAST_RUN_STORAGE_KEY);
      const run = stored?.[MARKET_LAST_RUN_STORAGE_KEY];
      if (!run || run.status !== "completed") return;
      if (Number(run.failed || 0) || Number(run.confirmNeeded || 0)) {
        renderTaskDetails(run.tasks || []);
      }
    } catch {
      // Optional diagnostics only.
    }
  }

  async function startMarketSend() {
    setPanelBusy(true);
    setPanelStatus("DM1~SM2 미등록 상품을 1:1 저장검색으로 전송 준비 중입니다.");
    const response = await sendRuntimeMessage({
      type: MARKET_SEND_START_MESSAGE,
      originUrl: location.href,
    });
    if (!response?.ok) {
      setPanelBusy(false);
      setPanelStatus(response?.message || "마켓 자동전송을 시작하지 못했습니다.", "error");
      return;
    }
    setPanelStatus(`자동전송 시작 · ${response.total}개 채널 · 동시 ${response.lanes}창`);
  }

  function mountPanel() {
    if (document.getElementById(PANEL_ID) || !isProductListPage()) return;
    const token = discoverWorkerToken();
    if (token) return;

    const box = document.createElement("div");
    box.id = PANEL_ID;
    box.style.cssText = [
      "position:fixed",
      "right:18px",
      "bottom:235px",
      "z-index:2147483646",
      "width:370px",
      "padding:12px",
      "border:1px solid #fdba74",
      "border-radius:10px",
      "background:#fff",
      "box-shadow:0 8px 30px rgba(15,23,42,.16)",
      "font:12px/1.45 Arial,sans-serif",
      "color:#0f172a",
    ].join(";");

    const title = document.createElement("div");
    title.textContent = "Commerce OS · 마켓 자동전송";
    title.style.cssText = "font-weight:700;margin-bottom:5px";

    const mapping = document.createElement("div");
    mapping.textContent = "DM1→도매1 · DM2→도매2 · DM3→도매3 · DM4→도매4 · SM1→소매1 · SM2→소매2";
    mapping.style.cssText = "font-size:11px;color:#64748b;margin-bottom:7px";

    const status = document.createElement("div");
    status.id = STATUS_ID;
    status.textContent = "미분산 일괄 처리 완료 후 실행하세요. 미등록 상품만 처리합니다.";
    status.style.cssText = "margin-bottom:8px;color:#475569";

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = "마켓 자동전송 시작 · 동시 2창";
    button.style.cssText = "width:100%;padding:9px;border:0;border-radius:7px;background:#ea580c;color:#fff;font-weight:700;cursor:pointer";
    button.addEventListener("click", () => void startMarketSend());

    const detailHost = document.createElement("div");
    detailHost.id = DETAILS_ID;

    box.append(title, mapping, status, button, detailHost);
    document.documentElement.appendChild(box);
    void showLastMarketRun();
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== MARKET_SEND_PROGRESS_MESSAGE) return;
    if (!document.getElementById(PANEL_ID)) return;
    const total = Number(message.total || 0);
    const done = Number(message.done || 0);
    const sent = Number(message.sent || 0);
    const skipped = Number(message.skipped || 0);
    const failed = Number(message.failed || 0);
    const confirmNeeded = Number(message.confirmNeeded || 0);
    const active = Array.isArray(message.active) ? message.active : [];

    if (message.status === "completed") {
      setPanelBusy(false);
      setPanelStatus(
        `완료 · ${done}/${total} · 송신 ${sent} · 미등록없음 ${skipped} · 확인필요 ${confirmNeeded} · 실패 ${failed}`,
        failed || confirmNeeded ? "error" : "success",
      );
      renderTaskDetails(message.tasks || []);
      return;
    }

    setPanelBusy(true);
    const activeLabel = active.map((task) => `${task.searchCode}→${task.profile}`).join(" / ");
    setPanelStatus(
      `진행 ${done}/${total} · 송신 ${sent} · 건너뜀 ${skipped}${activeLabel ? ` · ${activeLabel}` : ""}`,
    );
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
