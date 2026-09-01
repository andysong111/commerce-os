(() => {
  const VERSION = "0.1.0";
  const MAX_VISIBLE_RESULTS = 500;
  const normalize = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const bodyText = () => normalize(document.body?.innerText || document.body?.textContent || "");
  const handledListAssignments = new Set();
  const handledPopupAssignments = new Set();

  function localControlText(control) {
    const chunks = [];
    if (control.id) {
      const label = document.querySelector(`label[for="${CSS.escape(control.id)}"]`);
      if (label) chunks.push(label.textContent || "");
    }
    const wrappingLabel = control.closest("label");
    if (wrappingLabel) chunks.push(wrappingLabel.textContent || "");
    for (const node of [control.previousSibling, control.nextSibling]) {
      if (!node) continue;
      chunks.push(node.nodeType === Node.TEXT_NODE ? node.textContent || "" : node.textContent || "");
    }
    return normalize(chunks.join(" "));
  }

  function adjacentText(control) {
    const local = localControlText(control);
    const parent = normalize(control.parentElement?.textContent || "");
    return normalize(`${local} ${parent}`);
  }

  function clickableText(element) {
    if (!element) return "";
    if (element instanceof HTMLInputElement) return normalize(element.value || element.getAttribute("title") || "");
    return normalize(element.textContent || element.getAttribute("title") || "");
  }

  function role() {
    const text = bodyText();
    if (/상품수정\s*송신/i.test(text) && /일반내용수정/i.test(text) && /옵션송신/i.test(text)) return "A21_POPUP";
    if (/쇼핑몰상품수정/i.test(text) && /상품\s*수정전송/i.test(text) && /검색항목/i.test(text)) return "A21_LIST";
    return "OTHER";
  }

  function setControl(control, checked = true) {
    if (!control) return false;
    if (control instanceof HTMLInputElement && ["radio", "checkbox"].includes(control.type)) {
      if (checked && !control.checked) control.click();
      if (!checked && control.checked && control.type === "checkbox") control.click();
      control.checked = checked;
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
      return control.checked === checked;
    }
    return false;
  }

  function radioByAdjacentText(text, scope = document) {
    const target = normalize(text);
    const radios = [...scope.querySelectorAll('input[type="radio"]')];
    const localExact = radios.find((radio) => {
      const local = localControlText(radio);
      return local === target || local.startsWith(`${target} `);
    });
    if (localExact) return localExact;
    const localContains = radios.find((radio) => localControlText(radio).includes(target));
    if (localContains) return localContains;
    return radios.find((radio) => adjacentText(radio).includes(target)) || null;
  }

  function rowByLeadingText(text) {
    const target = normalize(text);
    const rows = [...document.querySelectorAll("tr")];
    return rows.find((row) => {
      const value = normalize(row.textContent || "");
      return value === target || value.startsWith(`${target} `);
    }) || rows.find((row) => normalize(row.textContent || "").includes(target)) || null;
  }

  function chooseRadioInRow(row, label) {
    if (!row) return false;
    const target = normalize(label);
    const radios = [...row.querySelectorAll('input[type="radio"]')];
    let candidate = radios.find((radio) => {
      const text = localControlText(radio);
      return text === target || text.startsWith(`${target} `);
    });
    if (!candidate) candidate = radios.find((radio) => localControlText(radio).includes(target));
    if (!candidate && target === "수정안함" && radios.length >= 2) candidate = radios[radios.length - 1];
    if (!candidate && target === "수정" && radios.length >= 1) candidate = radios[0];
    return setControl(candidate, true);
  }

  function selectOptionByText(select, text) {
    const target = normalize(text);
    const option = [...select.options].find((item) => normalize(item.textContent) === target)
      || [...select.options].find((item) => normalize(item.textContent).includes(target));
    if (!option) return false;
    select.value = option.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function setSearchFieldToGoodsKey() {
    const selects = [...document.querySelectorAll("select")].filter((select) =>
      [...select.options].some((option) => normalize(option.textContent).includes("샵플링상품코드")),
    );
    let changed = 0;
    for (const select of selects) if (selectOptionByText(select, "샵플링상품코드")) changed += 1;
    return changed > 0;
  }

  function setPageSize500() {
    const selects = [...document.querySelectorAll("select")];
    const candidate = selects.find((select) => {
      const labels = [...select.options].map((option) => normalize(option.textContent));
      return labels.includes("500") && (labels.includes("200") || labels.includes("100"));
    });
    return candidate ? selectOptionByText(candidate, "500") : false;
  }

  function findSearchInput() {
    const inputs = [...document.querySelectorAll('input[type="text"], textarea')].filter((input) => !input.disabled && input.offsetParent !== null);
    let best = null;
    let bestScore = -999;
    for (const input of inputs) {
      const row = input.closest("tr") || input.parentElement;
      const context = normalize(row?.textContent || input.parentElement?.textContent || "");
      let score = 0;
      if (context.includes("검색항목")) score += 10;
      if (context.includes("다중검색")) score += 10;
      if (context.includes("샵플링상품코드")) score += 8;
      if (context.includes("가격검색")) score -= 8;
      if (/^20\d{6}$/.test(normalize(input.value))) score -= 10;
      if (String(input.name || "").toLowerCase().includes("date")) score -= 10;
      if (score > bestScore) { best = input; bestScore = score; }
    }
    return bestScore >= 8 ? best : null;
  }

  function clickSearchNear(input) {
    const form = input?.form || input?.closest("form") || document;
    const candidates = [...form.querySelectorAll('button, input[type="button"], input[type="submit"], a')]
      .filter((element) => clickableText(element) === "검색");
    if (!candidates.length) return false;
    const inputRect = input.getBoundingClientRect();
    candidates.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return Math.abs(ar.top - inputRect.top) - Math.abs(br.top - inputRect.top);
    });
    candidates[0].click();
    return true;
  }

  function selectMallSpecificPriceSource() {
    const radios = [...document.querySelectorAll('input[type="radio"]')];
    const candidate = radios.find((radio) => {
      const text = adjacentText(radio);
      return text.includes("쇼핑몰별판매가");
    });
    return setControl(candidate, true);
  }

  function parseTotalCount() {
    const match = bodyText().match(/총\s*조회수\s*[:：]?\s*([\d,]+)\s*건/i);
    return match ? Number(match[1].replace(/,/g, "")) : 0;
  }

  function findResultRows(goodsKeys) {
    const target = new Set(goodsKeys.map(String));
    const rows = [...document.querySelectorAll("tr")].filter((row) => row.querySelector('input[type="checkbox"]'));
    const matched = [];
    const seen = new Set();
    for (const row of rows) {
      const text = normalize(row.textContent || "");
      const keys = goodsKeys.filter((key) => new RegExp(`(^|\\D)${String(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\D|$)`).test(text));
      if (!keys.length) continue;
      const checkbox = row.querySelector('input[type="checkbox"]');
      if (!checkbox || checkbox.disabled) continue;
      matched.push({ row, checkbox, keys });
      keys.forEach((key) => seen.add(String(key)));
    }
    return { matched, seen, target };
  }

  function clickModifySend() {
    const candidates = [...document.querySelectorAll('button, input[type="button"], input[type="submit"], a')]
      .filter((element) => /상품\s*수정전송/.test(clickableText(element)));
    if (!candidates.length) return false;
    candidates[0].click();
    return true;
  }

  async function fail(jobId, code, message) {
    await chrome.runtime.sendMessage({ type: "A21_JOB_FAILURE", jobId, code, message }).catch(() => null);
  }

  async function stage(jobId, nextStage, extra = {}) {
    await chrome.runtime.sendMessage({ type: "A21_STAGE", jobId, stage: nextStage, ...extra }).catch(() => null);
  }

  async function configureAndSearch(assignment) {
    if (role() !== "A21_LIST") return fail(assignment.jobId, "A21_LIST_NOT_DETECTED", "A21 목록 화면을 확인하지 못했습니다.");
    if (!Array.isArray(assignment.goodsKeys) || assignment.goodsKeys.length < 1 || assignment.goodsKeys.length > 200) {
      return fail(assignment.jobId, "A21_GOODSKEY_BATCH_INVALID", "검색 GOODSKEY 묶음이 1~200개 범위를 벗어났습니다.");
    }
    setPageSize500();
    if (!setSearchFieldToGoodsKey()) return fail(assignment.jobId, "A21_GOODSKEY_SEARCH_SELECT_NOT_FOUND", "검색항목의 샵플링상품코드 선택을 찾지 못했습니다.");
    if (!selectMallSpecificPriceSource()) return fail(assignment.jobId, "A21_MALL_PRICE_SOURCE_NOT_FOUND", "쇼핑몰별판매가 버튼을 찾지 못했습니다.");
    const input = findSearchInput();
    if (!input) return fail(assignment.jobId, "A21_MULTI_SEARCH_INPUT_NOT_FOUND", "샵플링상품코드 다중검색 입력칸을 찾지 못했습니다.");
    input.value = assignment.goodsKeys.join(",");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await stage(assignment.jobId, "SEARCH_SUBMITTED", { message: `${assignment.goodsKeys.length}개 GOODSKEY 검색` });
    if (!clickSearchNear(input)) return fail(assignment.jobId, "A21_SEARCH_BUTTON_NOT_FOUND", "검색 버튼을 찾지 못했습니다.");
  }

  async function selectRowsAndOpenPopup(assignment) {
    if (role() !== "A21_LIST") return;
    await sleep(500);
    const total = parseTotalCount();
    if (total > MAX_VISIBLE_RESULTS) {
      await chrome.runtime.sendMessage({ type: "A21_SPLIT_REQUIRED", jobId: assignment.jobId, totalResultCount: total }).catch(() => null);
      return;
    }
    if (total <= 0) return fail(assignment.jobId, "A21_EMPTY_RESULT", "검색 결과가 0건이어서 전송하지 않았습니다.");
    if (!selectMallSpecificPriceSource()) return fail(assignment.jobId, "A21_MALL_PRICE_SOURCE_RESET", "검색 후 쇼핑몰별판매가 선택이 유지되지 않아 전송을 차단했습니다.");
    const { matched, seen, target } = findResultRows(assignment.goodsKeys);
    const missing = [...target].filter((key) => !seen.has(key));
    if (missing.length) return fail(assignment.jobId, "A21_GOODSKEY_RESULT_MISSING", `검색 결과에 GOODSKEY ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? " 외" : ""}가 없습니다.`);
    if (matched.length !== total) {
      return fail(assignment.jobId, "A21_VISIBLE_ROW_COUNT_MISMATCH", `조회수 ${total}건 중 안전하게 식별한 행은 ${matched.length}건이라 전송하지 않았습니다.`);
    }
    for (const item of matched) setControl(item.checkbox, true);
    const checked = matched.filter((item) => item.checkbox.checked).length;
    if (checked !== total) return fail(assignment.jobId, "A21_ROW_SELECTION_MISMATCH", `${total}건 중 ${checked}건만 선택되어 전송을 차단했습니다.`);
    await stage(assignment.jobId, "POPUP_OPENING", { selectedRowCount: checked, totalResultCount: total, message: `${checked}개 쇼핑몰 행 선택 완료` });
    if (!clickModifySend()) return fail(assignment.jobId, "A21_MODIFY_SEND_BUTTON_NOT_FOUND", "상품 수정전송 버튼을 찾지 못했습니다.");
  }

  function setNormalRowsToNoChange(exceptRow) {
    const rows = [...document.querySelectorAll("tr")];
    for (const row of rows) {
      if (row === exceptRow) continue;
      const text = normalize(row.textContent || "");
      if (!text.includes("수정안함") || !text.includes("수정")) continue;
      chooseRadioInRow(row, "수정안함");
    }
  }

  function configurePricePopup() {
    const top = radioByAdjacentText("일반내용수정");
    if (!setControl(top, true)) return { ok: false, code: "A21_GENERAL_MODE_NOT_FOUND", message: "일반내용수정 모드를 찾지 못했습니다." };
    const priceRow = rowByLeadingText("판매가");
    if (!priceRow || !chooseRadioInRow(priceRow, "수정")) return { ok: false, code: "A21_PRICE_MODIFY_NOT_FOUND", message: "판매가 수정 선택을 찾지 못했습니다." };
    setNormalRowsToNoChange(priceRow);
    if (!radioByAdjacentText("일반내용수정")?.checked) return { ok: false, code: "A21_GENERAL_MODE_NOT_SELECTED", message: "일반내용수정 모드 선택 검증에 실패했습니다." };
    const priceRadios = [...priceRow.querySelectorAll('input[type="radio"]')];
    if (!priceRadios.some((radio) => radio.checked && adjacentText(radio).includes("수정"))) return { ok: false, code: "A21_PRICE_MODIFY_NOT_SELECTED", message: "판매가 수정 체크가 실제로 선택되지 않았습니다." };
    return { ok: true };
  }

  function configureOptionPopup() {
    const top = radioByAdjacentText("옵션송신");
    if (!setControl(top, true)) return { ok: false, code: "A21_OPTION_MODE_NOT_FOUND", message: "옵션송신 모드를 찾지 못했습니다." };
    const rows = [...document.querySelectorAll("tr")];
    const optionRow = rows.find((row) => {
      const text = normalize(row.textContent || "");
      return text.startsWith("옵션송신 ") && text.includes("선택") && !text.includes("추가상품송신");
    }) || rows.find((row) => normalize(row.textContent || "") === "옵션송신 선택");
    if (!optionRow) return { ok: false, code: "A21_OPTION_ROW_NOT_FOUND", message: "옵션송신 선택 행을 찾지 못했습니다." };
    const control = [...optionRow.querySelectorAll('input[type="radio"], input[type="checkbox"]')]
      .find((item) => adjacentText(item).includes("선택")) || optionRow.querySelector('input[type="radio"], input[type="checkbox"]');
    if (!setControl(control, true)) return { ok: false, code: "A21_OPTION_SELECT_NOT_FOUND", message: "옵션송신 선택 버튼을 찾지 못했습니다." };
    const extraRows = rows.filter((row) => /추가상품송신/.test(normalize(row.textContent || "")) && row !== optionRow);
    for (const row of extraRows) {
      for (const item of row.querySelectorAll('input[type="checkbox"]')) setControl(item, false);
    }
    if (!top.checked || !control.checked) return { ok: false, code: "A21_OPTION_SELECTION_VERIFY_FAILED", message: "옵션송신 단독 선택 검증에 실패했습니다." };
    return { ok: true };
  }

  function submitPopup() {
    const candidates = [...document.querySelectorAll('button, input[type="button"], input[type="submit"], a')]
      .filter((element) => /상품수정\s*송신/.test(clickableText(element)));
    if (!candidates.length) return false;
    candidates[0].click();
    return true;
  }

  function resultEvidence() {
    const text = bodyText();
    const successMatch = text.match(/성공건수\s*[:：]?\s*([\d,]+)/i);
    const failMatch = text.match(/실패건수\s*[:：]?\s*([\d,]+)/i);
    const success = successMatch ? Number(successMatch[1].replace(/,/g, "")) : 0;
    const failure = failMatch ? Number(failMatch[1].replace(/,/g, "")) : 0;
    const explicitSuccess = /성공여부\s*[:：]?\s*성공/i.test(text) || /정상적으로.*처리/i.test(text);
    const explicitFailure = /성공여부\s*[:：]?\s*실패/i.test(text);
    return { success, failure, explicitSuccess, explicitFailure, text };
  }

  async function waitForResult(assignment) {
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      const evidence = resultEvidence();
      if (evidence.failure > 0 || evidence.explicitFailure) {
        return fail(assignment.jobId, "A21_SHOPLING_RESULT_FAILURE", `샵플링 결과에서 실패 ${evidence.failure || 1}건을 확인했습니다.`);
      }
      if (evidence.success > 0 || evidence.explicitSuccess) {
        await chrome.runtime.sendMessage({
          type: "A21_JOB_SUCCESS",
          jobId: assignment.jobId,
          message: `${assignment.mode === "PRICE" ? "판매가" : "옵션"} 수정전송 성공 확인`,
        }).catch(() => null);
        return;
      }
      await sleep(1000);
    }
    return fail(assignment.jobId, "A21_RESULT_TIMEOUT", "상품수정 송신 후 180초 동안 확정 성공 결과를 확인하지 못했습니다.");
  }

  async function configureAndSubmitPopup(assignment) {
    if (role() !== "A21_POPUP") return fail(assignment.jobId, "A21_POPUP_NOT_DETECTED", "상품수정 송신 팝업을 확인하지 못했습니다.");
    const result = assignment.mode === "PRICE" ? configurePricePopup() : configureOptionPopup();
    if (!result.ok) return fail(assignment.jobId, result.code, result.message);
    await stage(assignment.jobId, "SUBMIT_CLICKED", { message: `${assignment.mode === "PRICE" ? "판매가" : "옵션"} 단독 전송 클릭` });
    if (!submitPopup()) return fail(assignment.jobId, "A21_SUBMIT_BUTTON_NOT_FOUND", "상품수정 송신 버튼을 찾지 못했습니다.");
    await stage(assignment.jobId, "RESULT_WAIT", { message: "샵플링 결과 확인 중" });
    await sleep(700);
    await waitForResult(assignment);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    void (async () => {
      try {
        if (message?.type === "A21_IDENTIFY") {
          sendResponse({ ok: true, role: role(), version: VERSION });
          return;
        }
        if (message?.type === "A21_LIST_ASSIGNMENT") {
          sendResponse({ ok: true, accepted: true });
          const key = `${message.jobId}:${message.stage}`;
          if (handledListAssignments.has(key)) return;
          handledListAssignments.add(key);
          if (message.stage === "SEARCH_SUBMITTED") await selectRowsAndOpenPopup(message);
          else if (["POPUP_OPENING", "POPUP_CONFIG", "SUBMIT_CLICKED", "RESULT_WAIT"].includes(message.stage)) return;
          else await configureAndSearch(message);
          return;
        }
        if (message?.type === "A21_POPUP_ASSIGNMENT") {
          sendResponse({ ok: true, accepted: true });
          const key = `${message.jobId}:submit`;
          if (handledPopupAssignments.has(key)) return;
          handledPopupAssignments.add(key);
          await configureAndSubmitPopup(message);
          return;
        }
        if (message?.type === "A21_POPUP_RESULT_ASSIGNMENT") {
          sendResponse({ ok: true, accepted: true });
          const key = `${message.jobId}:result`;
          if (handledPopupAssignments.has(key)) return;
          handledPopupAssignments.add(key);
          await waitForResult(message);
          return;
        }
        sendResponse({ ok: false, error: "unsupported_message" });
      } catch (error) {
        if (message?.jobId) await fail(message.jobId, "A21_CONTENT_EXCEPTION", error instanceof Error ? error.message : String(error));
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  });
})();
