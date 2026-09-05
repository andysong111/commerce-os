(() => {
  const VERSION = "0.1.1";
  const IS_TOP = window.top === window;
  const MAIN_REQUEST = "commerce-os-stock-main-click";
  const MAIN_RESULT = "commerce-os-stock-main-click-result";
  const MAIN_TOKEN_ATTRIBUTE = "data-commerce-os-stock-click-token";
  const handled = new Set();
  let lastEvidenceSignature = "";

  const norm = (value) =>
    String(value ?? "")
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const bodyText = () =>
    norm(
      document.body?.innerText ||
        document.body?.textContent ||
        document.documentElement?.innerText ||
        "",
    );

  function visible(element) {
    if (!(element instanceof HTMLElement)) return true;
    const rect = element.getBoundingClientRect();
    return element.offsetParent !== null || rect.width > 0 || rect.height > 0;
  }

  function controlText(element) {
    if (!element) return "";
    const values = [
      element.textContent,
      element.value,
      element.title,
      element.alt,
      element.name,
      element.id,
      element.getAttribute?.("aria-label"),
    ];
    if (element.id) {
      const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
      if (label) values.push(label.textContent);
    }
    const wrappingLabel = element.closest?.("label");
    if (wrappingLabel) values.push(wrappingLabel.textContent);
    return norm(values.filter(Boolean).join(" "));
  }

  function localText(element) {
    const values = [controlText(element)];
    let cursor = element?.parentElement;
    for (let depth = 0; cursor && depth < 3; depth += 1) {
      values.push(cursor.textContent || "");
      cursor = cursor.parentElement;
    }
    return norm(values.join(" "));
  }

  function role() {
    const text = bodyText();
    const href = String(location.href || "");
    if (
      /상품수정\s*송신/i.test(text) &&
      /상품판매상태송신/i.test(text)
    ) {
      return "A21_POPUP";
    }
    if (
      /상품(?:옵션)?\s*(?:수정\s*)?전송이\s*완료되었습니다/i.test(text) ||
      /처리중입니다/i.test(text) ||
      /성공건수\s*[:：]/i.test(text)
    ) {
      return "RESULT";
    }
    if (
      /\[?A?6\]?\s*옵션(?:대량|상품)?수정/i.test(text) &&
      /일괄\s*상태변경/i.test(text)
    ) {
      return "A6";
    }
    if (/쇼핑몰상품옵션전송/i.test(text) && /상품옵션전송/i.test(text)) {
      return "A22";
    }
    if (
      /쇼핑몰상품수정/i.test(text) &&
      /상품\s*수정전송/i.test(text) &&
      !/goods_mallMdfy_trsmt\.phtml/i.test(href)
    ) {
      return "A21_LIST";
    }
    return "OTHER";
  }

  function pageInfo(stage = "") {
    return {
      role: role(),
      href: String(location.href || ""),
      title: String(document.title || ""),
      top: IS_TOP,
      canNavigate: Boolean(menuTarget(menuPatternFor(stage))),
    };
  }

  async function send(message) {
    return chrome.runtime.sendMessage({ ...message, version: VERSION }).catch(() => null);
  }

  async function waitFor(check, timeoutMs = 30_000, intervalMs = 250) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        const value = await check();
        if (value) return value;
      } catch (error) {
        lastError = error;
      }
      await sleep(intervalMs);
    }
    if (lastError) throw lastError;
    return null;
  }

  function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function exactTokenRegex(token) {
    return new RegExp(
      `(^|[^A-Z0-9-])${escapeRegex(norm(token).toUpperCase())}([^A-Z0-9-]|$)`,
      "i",
    );
  }

  function clickDirect(element) {
    if (!element) return false;
    try {
      element.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      );
      element.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      );
      element.click();
      return true;
    } catch {
      return false;
    }
  }

  function clickViaMain(element) {
    return new Promise((resolve) => {
      if (!element) {
        resolve({ ok: false, code: "CLICK_TARGET_MISSING", alerts: [] });
        return;
      }
      const token = `stock-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      element.setAttribute(MAIN_TOKEN_ATTRIBUTE, token);
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        window.removeEventListener(MAIN_RESULT, listener);
        resolve(value);
      };
      const listener = (event) => {
        if (norm(event?.detail?.token) !== token) return;
        finish(event.detail || { ok: false, code: "MAIN_CLICK_EMPTY_RESULT" });
      };
      window.addEventListener(MAIN_RESULT, listener);
      window.dispatchEvent(new CustomEvent(MAIN_REQUEST, { detail: { token } }));
      window.setTimeout(
        () => finish({ ok: true, code: "MAIN_CLICK_NAVIGATED_OR_PENDING", alerts: [] }),
        3_500,
      );
    });
  }

  function setInput(input, value) {
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) {
      return false;
    }
    const descriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input),
      "value",
    );
    if (descriptor?.set) descriptor.set.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return norm(input.value) === norm(value);
  }

  function setCheck(control, checked = true) {
    if (!(control instanceof HTMLInputElement)) return false;
    if (!["checkbox", "radio"].includes(control.type)) return false;
    if (control.checked !== checked) control.click();
    control.checked = checked;
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
    return control.checked === checked;
  }

  function selectByText(select, label, exact = false) {
    if (!(select instanceof HTMLSelectElement)) return false;
    const wanted = norm(label);
    const options = [...select.options];
    const option =
      options.find((item) => norm(item.textContent) === wanted) ||
      (!exact
        ? options.find((item) => norm(item.textContent).includes(wanted))
        : null);
    if (!option) return false;
    select.value = option.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return select.value === option.value;
  }

  function selectWithOption(label) {
    const wanted = norm(label);
    return [...document.querySelectorAll("select")]
      .filter(visible)
      .filter((select) =>
        [...select.options].some((option) =>
          norm(option.textContent).includes(wanted),
        ),
      );
  }

  function findSearchInput(fieldSelect) {
    const candidates = [
      ...(fieldSelect?.closest("tr")?.querySelectorAll(
        'input[type="text"],input:not([type]),textarea',
      ) || []),
      ...(fieldSelect?.form?.querySelectorAll(
        'input[type="text"],input:not([type]),textarea',
      ) || []),
      ...document.querySelectorAll(
        'input[type="text"],input:not([type]),textarea',
      ),
    ].filter(
      (input, index, all) =>
        all.indexOf(input) === index && !input.disabled && visible(input),
    );
    let best = null;
    let bestScore = -999;
    for (const input of candidates) {
      const context = localText(input);
      let score = 0;
      if (/검색항목|다중검색|자사상품코드|옵션자체관리코드|모델번호/i.test(context)) {
        score += 15;
      }
      if (/가격검색|일자|날짜/i.test(context)) score -= 15;
      if (/^20\d{6}$/.test(norm(input.value))) score -= 20;
      if (fieldSelect) {
        const left = fieldSelect.getBoundingClientRect();
        const right = input.getBoundingClientRect();
        score -= Math.min(20, Math.abs(left.top - right.top) / 20);
      }
      if (score > bestScore) {
        best = input;
        bestScore = score;
      }
    }
    return bestScore >= 0 ? best : null;
  }

  function buttonByText(pattern, root = document) {
    const selector =
      'button,input[type="button"],input[type="submit"],input[type="image"],a,[onclick],img[alt],img[title]';
    const candidates = [...root.querySelectorAll(selector)].filter(visible);
    const matches = candidates.filter((element) => pattern.test(controlText(element)));
    matches.sort((left, right) => {
      const leftText = controlText(left).length;
      const rightText = controlText(right).length;
      return leftText - rightText;
    });
    const candidate = matches[0] || null;
    if (candidate instanceof HTMLImageElement) {
      return candidate.closest("a,button,input,[onclick]") || candidate;
    }
    return candidate;
  }

  function clickSearch(input) {
    const root = input?.form || input?.closest("table") || document;
    const candidates = [
      ...root.querySelectorAll(
        'button,input[type="button"],input[type="submit"],input[type="image"],a,[onclick]',
      ),
    ].filter(
      (element) => visible(element) && /^검색$/.test(controlText(element)),
    );
    if (!candidates.length) return false;
    const inputRect = input.getBoundingClientRect();
    candidates.sort(
      (left, right) =>
        Math.abs(left.getBoundingClientRect().top - inputRect.top) -
        Math.abs(right.getBoundingClientRect().top - inputRect.top),
    );
    return clickDirect(candidates[0]);
  }

  function matchingRows(token) {
    const regex = exactTokenRegex(token);
    return [...document.querySelectorAll("tr")]
      .filter((row) => visible(row) && regex.test(norm(row.textContent).toUpperCase()))
      .map((row) => ({
        row,
        checkbox: row.querySelector('input[type="checkbox"]'),
        text: norm(row.textContent),
      }))
      .filter((entry) => entry.checkbox && !entry.checkbox.disabled);
  }

  function selectOnlyMatchingRows(token) {
    const matches = matchingRows(token);
    if (!matches.length) return { ok: false, count: 0, rows: [] };
    const resultRows = [...document.querySelectorAll("tr")].filter((row) =>
      row.querySelector('input[type="checkbox"]'),
    );
    for (const row of resultRows) {
      const checkbox = row.querySelector('input[type="checkbox"]');
      if (!checkbox || checkbox.disabled) continue;
      const matched = matches.some((entry) => entry.row === row);
      setCheck(checkbox, matched);
    }
    const selected = matches.filter((entry) => entry.checkbox.checked);
    return {
      ok: selected.length === matches.length && selected.length > 0,
      count: selected.length,
      rows: matches,
    };
  }

  async function searchExact(fieldLabel, token) {
    const fieldCandidates = selectWithOption(fieldLabel);
    const fieldSelect = fieldCandidates[0] || null;
    if (!fieldSelect || !selectByText(fieldSelect, fieldLabel)) {
      return {
        ok: false,
        code: "SEARCH_FIELD_NOT_FOUND",
        message: `${fieldLabel} 검색항목을 찾지 못했습니다.`,
      };
    }
    const input = findSearchInput(fieldSelect);
    if (!input || !setInput(input, token)) {
      return {
        ok: false,
        code: "SEARCH_INPUT_NOT_FOUND",
        message: `${fieldLabel} 검색 입력칸을 찾지 못했습니다.`,
      };
    }
    if (!clickSearch(input)) {
      return {
        ok: false,
        code: "SEARCH_BUTTON_NOT_FOUND",
        message: "검색 버튼을 찾지 못했습니다.",
      };
    }
    const rows = await waitFor(() => matchingRows(token), 35_000, 400);
    if (!rows?.length) {
      return {
        ok: false,
        code: "EXACT_RESULT_NOT_FOUND",
        message: `${token} 정확 일치 검색결과가 없습니다.`,
      };
    }
    return { ok: true, rows };
  }

  function menuPatternFor(stage) {
    if (stage === "A6") return /(?:\[?6\]?|A6)\s*옵션(?:대량|상품)?수정/i;
    if (stage === "A22") return /(?:\[?22\]?|A22)\s*쇼핑몰상품옵션전송/i;
    if (stage === "A21_LIST") return /(?:\[?21\]?|A21)\s*쇼핑몰상품수정/i;
    return /$a/;
  }

  function menuTarget(labelPattern) {
    if (!labelPattern) return null;
    const candidates = [
      ...document.querySelectorAll("a,[onclick],li,td,span,div"),
    ].filter((element) => {
      if (!visible(element)) return false;
      const value = norm(element.textContent);
      if (!value || value.length > 80) return false;
      return labelPattern.test(value);
    });
    candidates.sort((left, right) => {
      const leftAnchor = left.matches("a,[onclick]") ? 0 : 1;
      const rightAnchor = right.matches("a,[onclick]") ? 0 : 1;
      return (
        leftAnchor - rightAnchor ||
        norm(left.textContent).length - norm(right.textContent).length
      );
    });
    const target = candidates[0] || null;
    return target?.closest("a,[onclick]") || target;
  }

  async function navigateTo(target) {
    const element = menuTarget(menuPatternFor(target));
    if (!element || !clickDirect(element)) {
      return {
        ok: false,
        code: "SHOPLING_MENU_NOT_FOUND",
        message: `${target} 메뉴를 찾지 못했습니다.`,
      };
    }
    return { ok: true, navigating: true, message: `${target} 화면으로 이동 중입니다.` };
  }

  function desiredKorean(status) {
    return status === "SOLD_OUT" ? "품절" : "판매중";
  }

  function alertFailure(alerts) {
    const message = norm((alerts || []).join(" "));
    if (!message) return null;
    if (/실패|오류|불가|없습니다|선택해|확인해|잘못/i.test(message)) {
      return message;
    }
    return null;
  }

  async function runA6(job) {
    if (role() !== "A6") return navigateTo("A6");
    const search = await searchExact("옵션자체관리코드", job.barcode);
    if (!search.ok) return search;
    const selected = selectOnlyMatchingRows(job.barcode);
    if (!selected.ok || selected.count !== 1) {
      return {
        ok: false,
        code: "A6_EXACT_ROW_SELECTION_FAILED",
        message: `${job.barcode} 정확 일치 행 1건을 단독 선택하지 못했습니다.`,
        evidence: { selectedCount: selected.count },
      };
    }
    const targetLabel = desiredKorean(job.desiredStatus);
    const selector = selectWithOption("옵션상태")[0] || null;
    if (!selector || !selectByText(selector, "옵션상태")) {
      return {
        ok: false,
        code: "A6_OPTION_STATUS_FIELD_NOT_FOUND",
        message: "A6 선택정보의 옵션상태를 찾지 못했습니다.",
      };
    }
    const targetSelects = selectWithOption(targetLabel).filter(
      (select) => select !== selector,
    );
    targetSelects.sort((left, right) => {
      const base = selector.getBoundingClientRect();
      return (
        Math.abs(left.getBoundingClientRect().top - base.top) -
        Math.abs(right.getBoundingClientRect().top - base.top)
      );
    });
    const statusSelect = targetSelects[0] || null;
    if (!statusSelect || !selectByText(statusSelect, targetLabel, true)) {
      return {
        ok: false,
        code: "A6_TARGET_STATUS_NOT_FOUND",
        message: `A6 옵션상태 ${targetLabel} 선택값을 찾지 못했습니다.`,
      };
    }
    const button = buttonByText(/^일괄\s*상태변경$/i);
    if (!button) {
      return {
        ok: false,
        code: "A6_BULK_STATUS_BUTTON_NOT_FOUND",
        message: "A6 일괄 상태변경 버튼을 찾지 못했습니다.",
      };
    }
    const click = await clickViaMain(button);
    const failure = alertFailure(click.alerts);
    if (!click.ok || failure) {
      return {
        ok: false,
        code: "A6_STATUS_CHANGE_REJECTED",
        message: failure || click.message || "A6 상태변경 클릭이 거절됐습니다.",
        evidence: click,
      };
    }
    const verified = await waitFor(() => {
      const rows = matchingRows(job.barcode);
      if (!rows.length) return null;
      const targetMatches = rows.filter((entry) =>
        new RegExp(`(^|\\s)${escapeRegex(targetLabel)}($|\\s)`).test(entry.text),
      );
      if (targetMatches.length === rows.length) return rows;
      const page = bodyText();
      if (/변경.*완료|정상.*처리|수정.*완료/i.test(page)) return rows;
      return null;
    }, 20_000, 500);
    if (!verified) {
      return {
        ok: false,
        uncertain: true,
        code: "A6_STATUS_CHANGE_UNVERIFIED",
        message: `A6 ${targetLabel} 요청은 전송했지만 결과 행에서 상태를 확정하지 못했습니다.`,
        evidence: { alerts: click.alerts, selectedRows: selected.count },
      };
    }
    return {
      ok: true,
      completed: true,
      step: "A6",
      message: `A6 ${job.barcode} 옵션상태를 ${targetLabel}로 확인했습니다.`,
      evidence: {
        selectedRows: selected.count,
        targetLabel,
        alerts: click.alerts,
      },
    };
  }

  async function runA22(job) {
    if (role() !== "A22") return navigateTo("A22");
    const search = await searchExact("옵션자체관리코드", job.barcode);
    if (!search.ok) return search;
    const selected = selectOnlyMatchingRows(job.barcode);
    if (!selected.ok || selected.count !== 1) {
      return {
        ok: false,
        code: "A22_EXACT_ROW_SELECTION_FAILED",
        message: `${job.barcode} A22 정확 일치 행 1건을 단독 선택하지 못했습니다.`,
        evidence: { selectedCount: selected.count },
      };
    }
    const button = buttonByText(/^상품옵션전송$/i);
    if (!button) {
      return {
        ok: false,
        code: "A22_TRANSMIT_BUTTON_NOT_FOUND",
        message: "A22 상품옵션전송 버튼을 찾지 못했습니다.",
      };
    }
    const click = await clickViaMain(button);
    const failure = alertFailure(click.alerts);
    if (!click.ok || failure) {
      return {
        ok: false,
        code: "A22_TRANSMIT_REJECTED",
        message: failure || click.message || "A22 옵션전송 요청이 거절됐습니다.",
        evidence: click,
      };
    }
    return {
      ok: true,
      submitted: true,
      step: "A22_SUBMITTED",
      message: `A22 ${job.barcode} 상품옵션전송을 요청했습니다. 최종 완료문구를 기다립니다.`,
      evidence: { selectedRows: selected.count, alerts: click.alerts },
    };
  }

  async function runA21List(job) {
    if (role() !== "A21_LIST") return navigateTo("A21_LIST");
    if (!job.modelNo) {
      return {
        ok: false,
        code: "A21_MODEL_NO_REQUIRED",
        message: "단품 A21 검색에 필요한 모델번호가 없습니다.",
      };
    }
    const search = await searchExact("모델번호", job.modelNo);
    if (!search.ok) return search;
    const selected = selectOnlyMatchingRows(job.modelNo);
    if (!selected.ok || selected.count !== 1) {
      return {
        ok: false,
        code: "A21_EXACT_ROW_SELECTION_FAILED",
        message: `${job.modelNo} A21 정확 일치 행 1건을 단독 선택하지 못했습니다.`,
        evidence: { selectedCount: selected.count },
      };
    }
    const button = buttonByText(/^상품\s*수정전송$/i);
    if (!button) {
      return {
        ok: false,
        code: "A21_MODIFY_SEND_BUTTON_NOT_FOUND",
        message: "A21 상품 수정전송 버튼을 찾지 못했습니다.",
      };
    }
    const click = await clickViaMain(button);
    const failure = alertFailure(click.alerts);
    if (!click.ok || failure) {
      return {
        ok: false,
        code: "A21_POPUP_OPEN_REJECTED",
        message: failure || click.message || "A21 수정전송 팝업을 열지 못했습니다.",
        evidence: click,
      };
    }
    return {
      ok: true,
      submitted: true,
      step: "A21_LIST_SUBMITTED",
      message: `A21 ${job.modelNo} 정확 일치 상품의 수정전송 팝업을 열었습니다.`,
      evidence: { selectedRows: selected.count, alerts: click.alerts },
    };
  }

  function radioByAdjacentText(pattern) {
    const candidates = [...document.querySelectorAll('input[type="radio"]')]
      .filter(visible)
      .filter((radio) => pattern.test(localText(radio)));
    candidates.sort((left, right) => {
      const leftText = localText(left).length;
      const rightText = localText(right).length;
      return leftText - rightText;
    });
    return candidates[0] || null;
  }

  async function runA21Popup(job) {
    if (role() !== "A21_POPUP") {
      return {
        ok: false,
        waiting: true,
        code: "A21_POPUP_WAIT",
        message: "A21 상품판매상태 송신 팝업 생성을 기다립니다.",
      };
    }
    const mode = radioByAdjacentText(/상품판매상태송신/i);
    if (!mode || !setCheck(mode, true)) {
      return {
        ok: false,
        code: "A21_SALE_STATUS_MODE_NOT_FOUND",
        message: "A21 상품판매상태송신 모드를 선택하지 못했습니다.",
      };
    }
    const targetLabel = desiredKorean(job.desiredStatus);
    const target = radioByAdjacentText(
      new RegExp(`(^|\\s)${escapeRegex(targetLabel)}($|\\s)`),
    );
    if (!target || !setCheck(target, true)) {
      return {
        ok: false,
        code: "A21_TARGET_STATUS_NOT_FOUND",
        message: `A21 상품판매상태 ${targetLabel} 버튼을 찾지 못했습니다.`,
      };
    }
    if (!mode.checked || !target.checked) {
      return {
        ok: false,
        code: "A21_STATUS_CONFIGURATION_CHANGED",
        message: "A21 송신 직전 상품판매상태 설정이 유지되지 않았습니다.",
      };
    }
    const button = buttonByText(/^상품수정\s*송신$/i);
    if (!button) {
      return {
        ok: false,
        code: "A21_STATUS_SUBMIT_BUTTON_NOT_FOUND",
        message: "A21 상품수정 송신 버튼을 찾지 못했습니다.",
      };
    }
    const click = await clickViaMain(button);
    const failure = alertFailure(click.alerts);
    if (!click.ok || failure) {
      return {
        ok: false,
        code: "A21_STATUS_SUBMIT_REJECTED",
        message: failure || click.message || "A21 상품상태 송신이 거절됐습니다.",
        evidence: click,
      };
    }
    return {
      ok: true,
      submitted: true,
      step: "A21_POPUP_SUBMITTED",
      message: `A21 상품판매상태 ${targetLabel} 송신을 요청했습니다. 최종 완료문구를 기다립니다.`,
      evidence: { targetLabel, alerts: click.alerts },
    };
  }

  function parseCounts(text) {
    const success = [...text.matchAll(/성공건수\s*[:：]?\s*([\d,]+)/gi)].reduce(
      (total, match) => total + Number(match[1].replace(/,/g, "")),
      0,
    );
    const failure = [...text.matchAll(/실패건수\s*[:：]?\s*([\d,]+)/gi)].reduce(
      (total, match) => total + Number(match[1].replace(/,/g, "")),
      0,
    );
    return { success, failure };
  }

  function resultEvidence() {
    const text = bodyText();
    const counts = parseCounts(text);
    const processing =
      /처리중입니다/i.test(text) ||
      /잠시만\s*기다려주시기\s*바랍니다/i.test(text);
    const optionComplete =
      /상품\s*옵션\s*(?:수정\s*)?전송이\s*완료되었습니다/i.test(text) ||
      /상품옵션\s*전송이\s*완료되었습니다/i.test(text);
    const productComplete = /상품\s*수정\s*전송이\s*완료되었습니다/i.test(text);
    const explicitFailure =
      /성공여부\s*[:：]?\s*실패/i.test(text) ||
      /전송\s*실패|처리\s*실패/i.test(text);
    return {
      processing,
      optionComplete,
      productComplete,
      explicitFailure,
      successCount: counts.success,
      failureCount: counts.failure,
      readyState: document.readyState,
      href: String(location.href || ""),
      title: String(document.title || ""),
      textSample: text.slice(-900),
      top: IS_TOP,
    };
  }

  async function publishEvidence() {
    const evidence = resultEvidence();
    if (
      !evidence.processing &&
      !evidence.optionComplete &&
      !evidence.productComplete &&
      evidence.successCount <= 0 &&
      evidence.failureCount <= 0
    ) {
      return;
    }
    const signature = JSON.stringify({
      processing: evidence.processing,
      optionComplete: evidence.optionComplete,
      productComplete: evidence.productComplete,
      explicitFailure: evidence.explicitFailure,
      successCount: evidence.successCount,
      failureCount: evidence.failureCount,
      href: evidence.href,
      textSample: evidence.textSample,
    });
    if (signature === lastEvidenceSignature) return;
    lastEvidenceSignature = signature;
    await send({ type: "STOCK_SYNC_RESULT_EVIDENCE", evidence });
  }

  function retryable(result) {
    return Boolean(
      result?.navigating ||
        result?.waiting ||
        [
          "SEARCH_FIELD_NOT_FOUND",
          "SEARCH_INPUT_NOT_FOUND",
          "SEARCH_BUTTON_NOT_FOUND",
          "SHOPLING_MENU_NOT_FOUND",
          "A21_POPUP_WAIT",
        ].includes(String(result?.code || "")),
    );
  }

  async function runStage(stage, job) {
    if (stage === "A6") return runA6(job);
    if (stage === "A22") return runA22(job);
    if (stage === "A21_LIST") return runA21List(job);
    if (stage === "A21_POPUP") return runA21Popup(job);
    return {
      ok: false,
      code: "STOCK_SYNC_STAGE_INVALID",
      message: `지원하지 않는 단계 ${stage}`,
    };
  }

  async function execute(message) {
    const job = message.job || {};
    const stage = String(message.stage || "");
    const expectedRole = String(message.expectedRole || "");
    const current = role();
    const canNavigate = Boolean(menuTarget(menuPatternFor(stage)));
    if (current !== expectedRole && !canNavigate) {
      return {
        ok: false,
        ignored: true,
        code: "SHOPLING_FRAME_NOT_TARGET",
        message: `현재 프레임은 ${expectedRole || stage} 실행 대상이 아닙니다.`,
      };
    }
    const key = `${job.jobId || "unknown"}:${stage}:${location.href}`;
    if (handled.has(key)) return { ok: true, duplicate: true };
    handled.add(key);
    let result;
    try {
      result = await runStage(stage, job);
    } catch (error) {
      result = {
        ok: false,
        code: "STOCK_SYNC_CONTENT_EXCEPTION",
        message: norm(error?.message || error || "Shopling 자동화 예외"),
      };
    }
    if (retryable(result)) handled.delete(key);
    await send({
      type: "STOCK_SYNC_STEP_RESULT",
      jobId: job.jobId,
      stage,
      result,
      page: pageInfo(stage),
    });
    return result;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "STOCK_SYNC_PROBE") {
      sendResponse({ ok: true, page: pageInfo(String(message.stage || "")), version: VERSION });
      return;
    }
    if (message?.type !== "STOCK_SYNC_EXECUTE") return;
    void execute(message)
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          ok: false,
          code: "STOCK_SYNC_EXECUTE_FAILED",
          message: norm(error?.message || error),
        }),
      );
    return true;
  });

  void send({
    type: "STOCK_SYNC_PAGE_READY",
    page: pageInfo(""),
  });
  void publishEvidence();
  window.setInterval(() => void publishEvidence(), 800);
})();