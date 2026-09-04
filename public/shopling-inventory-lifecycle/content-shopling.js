(() => {
  const VERSION = "0.1.0";
  const MARKER = "commerce-os-shopling-inventory-v010:";
  const handled = new Set();
  const attempts = new Map();

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const norm = (value) =>
    String(value ?? "")
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim();
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
    return (
      element.offsetParent !== null || rect.width > 0 || rect.height > 0
    );
  }

  function elementText(element) {
    if (!element) return "";
    const chunks = [
      element.textContent || "",
      element.getAttribute?.("aria-label") || "",
      element.getAttribute?.("title") || "",
      element.getAttribute?.("alt") || "",
    ];
    if (element instanceof HTMLInputElement) {
      chunks.push(element.value || "", element.name || "");
    }
    return norm(chunks.join(" "));
  }

  function localText(element) {
    const chunks = [elementText(element)];
    if (element?.id) {
      const label = document.querySelector(
        `label[for="${CSS.escape(element.id)}"]`,
      );
      if (label) chunks.push(label.textContent || "");
    }
    const wrapping = element?.closest?.("label");
    if (wrapping) chunks.push(wrapping.textContent || "");
    if (element?.parentElement) chunks.push(element.parentElement.textContent || "");
    return norm(chunks.join(" "));
  }

  function role() {
    const text = bodyText();
    if (
      /\[?6\]?\s*옵션대량수정/i.test(text) &&
      /일괄\s*상태변경|옵션재고변경/i.test(text)
    ) {
      return "A6";
    }
    if (
      /쇼핑몰상품옵션전송/i.test(text) &&
      /상품옵션전송|전송상태/i.test(text)
    ) {
      return "A22";
    }
    if (
      /상품판매상태송신/i.test(text) &&
      /상품수정\s*송신/i.test(text)
    ) {
      return "A21_POPUP";
    }
    if (
      /쇼핑몰상품수정/i.test(text) &&
      /상품\s*수정전송/i.test(text) &&
      /검색항목/i.test(text)
    ) {
      return "A21_LIST";
    }
    if (
      /처리중입니다|잠시만\s*기다려주시기\s*바랍니다/i.test(text)
    ) {
      return "RESULT_PROCESSING";
    }
    if (
      /상품옵션\s*(수정\s*)?전송이\s*완료되었습니다|쇼핑몰\s*상품옵션\s*전송\s*결과/i.test(
        text,
      )
    ) {
      return "A22_RESULT";
    }
    if (
      /상품\s*수정\s*전송이\s*완료되었습니다|쇼핑몰\s*상품\s*수정\s*전송\s*결과/i.test(
        text,
      )
    ) {
      return "A21_RESULT";
    }
    if (
      /\[?6\]?\s*옵션대량수정|\[?21\]?\s*쇼핑몰상품수정|\[?22\]?\s*쇼핑몰상품옵션전송/i.test(
        text,
      )
    ) {
      return "MENU";
    }
    return "OTHER";
  }

  function encodeAssignment(job) {
    try {
      return MARKER + encodeURIComponent(JSON.stringify(job));
    } catch {
      return "";
    }
  }

  function parseAssignment(value) {
    if (!String(value || "").startsWith(MARKER)) return null;
    try {
      const parsed = JSON.parse(
        decodeURIComponent(String(value).slice(MARKER.length)),
      );
      if (!parsed?.jobId || !parsed?.barcode) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function openerAssignment(currentRole) {
    let own = "";
    try {
      own = String(window.name || "");
    } catch {
      // ignore
    }
    let assignment = parseAssignment(own);
    if (!assignment) {
      try {
        assignment = parseAssignment(window.opener?.name || "");
      } catch {
        assignment = null;
      }
    }
    if (!assignment) return null;
    if (currentRole === "A21_POPUP") assignment.stage = "A21_CONFIGURE";
    if (currentRole === "A21_RESULT") assignment.stage = "A21_RESULT";
    if (currentRole === "A22_RESULT") assignment.stage = "A22_RESULT";
    return assignment;
  }

  function markAssignment(job) {
    const marker = encodeAssignment(job);
    if (!marker) return;
    try {
      window.name = marker;
    } catch {
      // ignore
    }
  }

  function setSelectByText(select, candidates) {
    if (!(select instanceof HTMLSelectElement)) return false;
    const wanted = candidates.map(norm).filter(Boolean);
    const option = [...select.options].find((entry) =>
      wanted.some((candidate) => norm(entry.textContent) === candidate),
    ) || [...select.options].find((entry) =>
      wanted.some((candidate) => norm(entry.textContent).includes(candidate)),
    );
    if (!option) return false;
    select.value = option.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function setInput(input, value) {
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) {
      return false;
    }
    const prototype =
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor?.set) descriptor.set.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return norm(input.value) === norm(value);
  }

  function clickElement(element) {
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

  function exactClickable(labels) {
    const wanted = labels.map(norm);
    const selector =
      'button,input[type="button"],input[type="submit"],input[type="image"],a,[onclick],img[alt],img[title]';
    const elements = [...document.querySelectorAll(selector)].filter(visible);
    return elements.find((element) =>
      wanted.some((label) => elementText(element) === label),
    ) || elements.find((element) =>
      wanted.some((label) => elementText(element).includes(label)),
    ) || null;
  }

  function clickMenu(labels) {
    const anchors = [...document.querySelectorAll("a,[onclick]")].filter(visible);
    const target = anchors.find((element) => {
      const value = elementText(element);
      return labels.some((label) => value === norm(label));
    }) || anchors.find((element) => {
      const value = elementText(element);
      return labels.some((label) => value.includes(norm(label)));
    });
    return clickElement(target);
  }

  function searchSelect(labels) {
    const selects = [...document.querySelectorAll("select")].filter(visible);
    return selects.find((select) =>
      [...select.options].some((option) =>
        labels.some((label) => norm(option.textContent).includes(norm(label))),
      ),
    ) || null;
  }

  function nearbySearchInput(select) {
    const inputs = [
      ...document.querySelectorAll('input[type="text"],textarea'),
    ].filter((input) => !input.disabled && visible(input));
    let best = null;
    let score = -999;
    for (const input of inputs) {
      const context = norm(
        `${input.closest("tr")?.textContent || ""} ${input.parentElement?.textContent || ""}`,
      );
      let current = 0;
      if (/검색항목|다중검색|자체관리코드|상품코드/i.test(context)) current += 15;
      if (/가격검색|날짜|원가/i.test(context)) current -= 12;
      if (select) {
        const distance = Math.abs(
          input.getBoundingClientRect().top - select.getBoundingClientRect().top,
        );
        current += Math.max(0, 10 - distance / 30);
      }
      if (current > score) {
        best = input;
        score = current;
      }
    }
    return score >= 5 ? best : null;
  }

  function clickSearch(input) {
    const root = input?.form || input?.closest("form") || document;
    const candidates = [
      ...root.querySelectorAll(
        'button,input[type="button"],input[type="submit"],input[type="image"],a,[onclick]',
      ),
    ].filter((element) => elementText(element) === "검색");
    if (!candidates.length) return false;
    const top = input.getBoundingClientRect().top;
    candidates.sort(
      (left, right) =>
        Math.abs(left.getBoundingClientRect().top - top) -
        Math.abs(right.getBoundingClientRect().top - top),
    );
    return clickElement(candidates[0]);
  }

  function controlsInRow(row) {
    return [
      ...row.querySelectorAll('input[type="checkbox"],input[type="radio"]'),
    ].filter((input) => !input.disabled);
  }

  function matchingRows(needle) {
    const target = norm(needle);
    return [...document.querySelectorAll("tr")].filter((row) => {
      if (!norm(row.textContent).includes(target)) return false;
      return controlsInRow(row).some(
        (input) => input instanceof HTMLInputElement && input.type === "checkbox",
      );
    });
  }

  function checkMatchingRows(needle) {
    const rows = matchingRows(needle);
    let checked = 0;
    for (const row of rows) {
      const checkbox = controlsInRow(row).find(
        (input) => input instanceof HTMLInputElement && input.type === "checkbox",
      );
      if (!(checkbox instanceof HTMLInputElement)) continue;
      if (!checkbox.checked) clickElement(checkbox);
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      if (checkbox.checked) checked += 1;
    }
    return { rowCount: rows.length, checked };
  }

  function statusSelect() {
    const selects = [...document.querySelectorAll("select")].filter(visible);
    let best = null;
    let bestScore = -999;
    for (const select of selects) {
      const labels = [...select.options].map((option) => norm(option.textContent));
      if (!labels.some((label) => label.includes("품절"))) continue;
      if (!labels.some((label) => label.includes("판매중"))) continue;
      const context = norm(
        `${select.closest("tr")?.textContent || ""} ${select.parentElement?.textContent || ""}`,
      );
      let score = 0;
      if (/옵션상태|상태변경|판매상태/i.test(context)) score += 20;
      if (/검색|조건/i.test(context)) score -= 8;
      if (score > bestScore) {
        best = select;
        bestScore = score;
      }
    }
    return best;
  }

  function targetKoreanStatus(job) {
    return job.desiredStatus === "SOLD_OUT" ? "품절" : "판매중";
  }

  async function sendOk(job, step, message) {
    await chrome.runtime.sendMessage({
      type: "SHOPLING_LIFECYCLE_STEP_OK",
      jobId: job.jobId,
      step,
      message,
    });
  }

  async function sendFail(job, code, message) {
    await chrome.runtime.sendMessage({
      type: "SHOPLING_LIFECYCLE_STEP_FAILED",
      jobId: job.jobId,
      code,
      message,
    });
  }

  function attemptKey(job, currentRole) {
    return `${job.jobId}:${job.stage}:${currentRole}:${location.href}`;
  }

  async function retryOrFail(job, currentRole, code, message) {
    const key = attemptKey(job, currentRole);
    const count = (attempts.get(key) || 0) + 1;
    attempts.set(key, count);
    if (count >= 30) await sendFail(job, code, message);
  }

  async function handleNavigateA6(job) {
    if (!clickMenu(["[6] 옵션대량수정", "옵션대량수정"])) {
      return retryOrFail(
        job,
        role(),
        "A6_MENU_NOT_FOUND",
        "Shopling 왼쪽 메뉴에서 [6] 옵션대량수정을 찾지 못했습니다.",
      );
    }
    await sendOk(job, "MENU_A6_CLICKED", "A6 옵션대량수정 메뉴 클릭");
  }

  async function handleA6Search(job) {
    if (role() !== "A6") return;
    const select = searchSelect(["옵션자체관리코드"]);
    if (!select || !setSelectByText(select, ["옵션자체관리코드"])) {
      return retryOrFail(
        job,
        role(),
        "A6_SEARCH_FIELD_NOT_FOUND",
        "A6 검색항목에서 옵션자체관리코드를 선택하지 못했습니다.",
      );
    }
    const input = nearbySearchInput(select);
    if (!input || !setInput(input, job.barcode)) {
      return retryOrFail(
        job,
        role(),
        "A6_SEARCH_INPUT_NOT_FOUND",
        "A6 옵션자체관리코드 검색 입력칸을 찾지 못했습니다.",
      );
    }
    if (!clickSearch(input)) {
      return retryOrFail(
        job,
        role(),
        "A6_SEARCH_BUTTON_NOT_FOUND",
        "A6 검색 버튼을 찾지 못했습니다.",
      );
    }
    await sendOk(job, "A6_SEARCH_SUBMITTED", `${job.barcode} A6 검색 실행`);
  }

  async function handleA6Apply(job) {
    if (role() !== "A6") return;
    const selected = checkMatchingRows(job.barcode);
    if (!selected.rowCount || selected.checked !== selected.rowCount) {
      return retryOrFail(
        job,
        role(),
        "A6_BARCODE_ROW_NOT_FOUND",
        `A6 검색결과에서 ${job.barcode} 행을 안전하게 선택하지 못했습니다.`,
      );
    }
    const select = statusSelect();
    const target = targetKoreanStatus(job);
    if (!select || !setSelectByText(select, [target])) {
      return retryOrFail(
        job,
        role(),
        "A6_STATUS_SELECT_NOT_FOUND",
        `A6 옵션상태 ${target} 선택을 찾지 못했습니다.`,
      );
    }
    const button = exactClickable(["일괄 상태변경", "옵션상태변경"]);
    if (!button) {
      return retryOrFail(
        job,
        role(),
        "A6_STATUS_BUTTON_NOT_FOUND",
        "A6 일괄 상태변경 버튼을 찾지 못했습니다.",
      );
    }
    markAssignment(job);
    if (!clickElement(button)) {
      return sendFail(
        job,
        "A6_STATUS_CLICK_FAILED",
        "A6 일괄 상태변경 클릭에 실패했습니다.",
      );
    }
    await sleep(700);
    await sendOk(
      job,
      "A6_STATUS_APPLIED",
      `${job.barcode} A6 옵션상태 ${target} 변경 요청 완료`,
    );
  }

  async function handleNavigateA22(job) {
    if (!clickMenu(["[22] 쇼핑몰상품옵션전송", "쇼핑몰상품옵션전송"])) {
      return retryOrFail(
        job,
        role(),
        "A22_MENU_NOT_FOUND",
        "Shopling 왼쪽 메뉴에서 [22] 쇼핑몰상품옵션전송을 찾지 못했습니다.",
      );
    }
    await sendOk(job, "MENU_A22_CLICKED", "A22 상품옵션전송 메뉴 클릭");
  }

  async function handleA22Search(job) {
    if (role() !== "A22") return;
    const select = searchSelect(["옵션자체관리코드"]);
    if (!select || !setSelectByText(select, ["옵션자체관리코드"])) {
      return retryOrFail(
        job,
        role(),
        "A22_SEARCH_FIELD_NOT_FOUND",
        "A22 검색항목에서 옵션자체관리코드를 선택하지 못했습니다.",
      );
    }
    const input = nearbySearchInput(select);
    if (!input || !setInput(input, job.barcode)) {
      return retryOrFail(
        job,
        role(),
        "A22_SEARCH_INPUT_NOT_FOUND",
        "A22 B코드 입력칸을 찾지 못했습니다.",
      );
    }
    if (!clickSearch(input)) {
      return retryOrFail(
        job,
        role(),
        "A22_SEARCH_BUTTON_NOT_FOUND",
        "A22 검색 버튼을 찾지 못했습니다.",
      );
    }
    await sendOk(job, "A22_SEARCH_SUBMITTED", `${job.barcode} A22 검색 실행`);
  }

  async function handleA22Send(job) {
    if (role() !== "A22") return;
    const selected = checkMatchingRows(job.barcode);
    if (!selected.rowCount || selected.checked !== selected.rowCount) {
      return retryOrFail(
        job,
        role(),
        "A22_BARCODE_ROW_NOT_FOUND",
        `A22 검색결과에서 ${job.barcode} 행을 선택하지 못했습니다.`,
      );
    }
    const button = exactClickable(["상품옵션전송", "선택 상품옵션전송"]);
    if (!button) {
      return retryOrFail(
        job,
        role(),
        "A22_SEND_BUTTON_NOT_FOUND",
        "A22 상품옵션전송 버튼을 찾지 못했습니다.",
      );
    }
    markAssignment({ ...job, stage: "A22_RESULT" });
    if (!clickElement(button)) {
      return sendFail(
        job,
        "A22_SEND_CLICK_FAILED",
        "A22 상품옵션전송 클릭에 실패했습니다.",
      );
    }
    await sendOk(job, "A22_SEND_SUBMITTED", "A22 상품옵션전송 실행");
  }

  async function handleA22Result(job) {
    const text = bodyText();
    if (/처리중입니다|잠시만\s*기다려주시기\s*바랍니다/i.test(text)) return;
    if (
      /상품옵션\s*(수정\s*)?전송이\s*완료되었습니다|상품옵션\s*전송\s*완료/i.test(
        text,
      )
    ) {
      await sendOk(job, "A22_RESULT_SUCCEEDED", "A22 상품옵션전송 최종완료 확인");
      return;
    }
    if (/실패건수\s*[:：]?\s*[1-9]/i.test(text)) {
      await sendFail(
        job,
        "A22_RESULT_FAILED",
        "A22 상품옵션전송 결과에서 실패건수를 확인했습니다.",
      );
    }
  }

  async function handleNavigateA21(job) {
    if (!clickMenu(["[21] 쇼핑몰상품수정", "쇼핑몰상품수정"])) {
      return retryOrFail(
        job,
        role(),
        "A21_MENU_NOT_FOUND",
        "Shopling 왼쪽 메뉴에서 [21] 쇼핑몰상품수정을 찾지 못했습니다.",
      );
    }
    await sendOk(job, "MENU_A21_CLICKED", "A21 쇼핑몰상품수정 메뉴 클릭");
  }

  async function handleA21Search(job) {
    if (role() !== "A21_LIST") return;
    const select = searchSelect([
      "자사상품코드",
      "모델번호",
      "상품번호",
    ]);
    if (!select || !setSelectByText(select, ["자사상품코드", "모델번호", "상품번호"])) {
      return retryOrFail(
        job,
        role(),
        "A21_MODEL_SEARCH_FIELD_NOT_FOUND",
        "A21 모델번호 검색에 사용할 자사상품코드 검색항목을 찾지 못했습니다.",
      );
    }
    const input = nearbySearchInput(select);
    if (!input || !setInput(input, job.modelNo)) {
      return retryOrFail(
        job,
        role(),
        "A21_MODEL_SEARCH_INPUT_NOT_FOUND",
        "A21 모델번호 검색 입력칸을 찾지 못했습니다.",
      );
    }
    if (!clickSearch(input)) {
      return retryOrFail(
        job,
        role(),
        "A21_MODEL_SEARCH_BUTTON_NOT_FOUND",
        "A21 검색 버튼을 찾지 못했습니다.",
      );
    }
    await sendOk(job, "A21_SEARCH_SUBMITTED", `${job.modelNo} A21 검색 실행`);
  }

  async function handleA21OpenPopup(job) {
    if (role() !== "A21_LIST") return;
    const selected = checkMatchingRows(job.modelNo);
    if (!selected.rowCount || selected.checked !== selected.rowCount) {
      return retryOrFail(
        job,
        role(),
        "A21_MODEL_ROW_NOT_FOUND",
        `A21 검색결과에서 모델번호 ${job.modelNo} 행을 선택하지 못했습니다.`,
      );
    }
    const button = exactClickable(["상품 수정전송", "상품수정전송"]);
    if (!button) {
      return retryOrFail(
        job,
        role(),
        "A21_MODIFY_SEND_NOT_FOUND",
        "A21 상품 수정전송 버튼을 찾지 못했습니다.",
      );
    }
    markAssignment({ ...job, stage: "A21_CONFIGURE" });
    if (!clickElement(button)) {
      return sendFail(
        job,
        "A21_MODIFY_SEND_CLICK_FAILED",
        "A21 상품 수정전송 클릭에 실패했습니다.",
      );
    }
    await sendOk(job, "A21_POPUP_REQUESTED", "A21 상품판매상태 송신 팝업 열기");
  }

  function radioByText(labels, preferredContext) {
    const radios = [
      ...document.querySelectorAll('input[type="radio"]'),
    ].filter(visible);
    let best = null;
    let bestScore = -999;
    for (const radio of radios) {
      const value = localText(radio);
      if (!labels.some((label) => value.includes(norm(label)))) continue;
      const context = norm(
        `${radio.closest("tr")?.textContent || ""} ${radio.parentElement?.textContent || ""}`,
      );
      let score = 10;
      if (preferredContext && context.includes(norm(preferredContext))) score += 20;
      if (score > bestScore) {
        best = radio;
        bestScore = score;
      }
    }
    return best;
  }

  async function handleA21Configure(job) {
    if (role() !== "A21_POPUP") return;
    markAssignment({ ...job, stage: "A21_RESULT" });
    const mode = radioByText(["상품판매상태송신"], "상품판매상태송신");
    if (!(mode instanceof HTMLInputElement) || !clickElement(mode)) {
      return retryOrFail(
        job,
        role(),
        "A21_SALE_STATUS_MODE_NOT_FOUND",
        "A21 팝업에서 상품판매상태송신을 선택하지 못했습니다.",
      );
    }
    mode.checked = true;
    mode.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(120);
    const target = targetKoreanStatus(job);
    const status = radioByText([target], "상품판매상태송신");
    if (!(status instanceof HTMLInputElement) || !clickElement(status)) {
      return retryOrFail(
        job,
        role(),
        "A21_SALE_STATUS_VALUE_NOT_FOUND",
        `A21 팝업에서 상품판매상태 ${target} 버튼을 찾지 못했습니다.`,
      );
    }
    status.checked = true;
    status.dispatchEvent(new Event("change", { bubbles: true }));
    const submit = exactClickable(["상품수정 송신", "상품수정송신"]);
    if (!submit || !clickElement(submit)) {
      return retryOrFail(
        job,
        role(),
        "A21_SALE_STATUS_SUBMIT_NOT_FOUND",
        "A21 상품수정 송신 버튼을 찾지 못했습니다.",
      );
    }
    await sendOk(
      job,
      "A21_SUBMIT_CLICKED",
      `A21 상품판매상태 ${target} 수정전송 실행`,
    );
  }

  async function handleA21Result(job) {
    const text = bodyText();
    if (/처리중입니다|잠시만\s*기다려주시기\s*바랍니다/i.test(text)) return;
    if (/상품\s*수정\s*전송이\s*완료되었습니다|상품\s*수정\s*전송\s*완료/i.test(text)) {
      await sendOk(job, "A21_RESULT_SUCCEEDED", "A21 상품판매상태 최종완료 확인");
      return;
    }
    if (/실패건수\s*[:：]?\s*[1-9]/i.test(text)) {
      await sendFail(
        job,
        "A21_RESULT_FAILED",
        "A21 상품판매상태 전송 결과에서 실패건수를 확인했습니다.",
      );
    }
  }

  async function drive(job, currentRole) {
    if (!job || job.status !== "RUNNING") return;
    const key = `${job.jobId}:${job.stage}:${currentRole}:${location.href}`;
    if (handled.has(key)) return;

    let actionable = false;
    if (job.stage === "NAVIGATE_A6" && currentRole === "MENU") {
      actionable = true;
      await handleNavigateA6(job);
    } else if (job.stage === "A6_SEARCH" && currentRole === "A6") {
      actionable = true;
      await handleA6Search(job);
    } else if (job.stage === "A6_APPLY" && currentRole === "A6") {
      actionable = true;
      await handleA6Apply(job);
    } else if (job.stage === "NAVIGATE_A22" && currentRole === "MENU") {
      actionable = true;
      await handleNavigateA22(job);
    } else if (job.stage === "A22_SEARCH" && currentRole === "A22") {
      actionable = true;
      await handleA22Search(job);
    } else if (job.stage === "A22_SEND" && currentRole === "A22") {
      actionable = true;
      await handleA22Send(job);
    } else if (job.stage === "A22_RESULT" && ["A22_RESULT", "RESULT_PROCESSING"].includes(currentRole)) {
      actionable = true;
      await handleA22Result(job);
    } else if (job.stage === "NAVIGATE_A21" && currentRole === "MENU") {
      actionable = true;
      await handleNavigateA21(job);
    } else if (job.stage === "A21_SEARCH" && currentRole === "A21_LIST") {
      actionable = true;
      await handleA21Search(job);
    } else if (job.stage === "A21_OPEN_POPUP" && currentRole === "A21_LIST") {
      actionable = true;
      await handleA21OpenPopup(job);
    } else if (job.stage === "A21_CONFIGURE" && currentRole === "A21_POPUP") {
      actionable = true;
      await handleA21Configure(job);
    } else if (job.stage === "A21_RESULT" && ["A21_RESULT", "RESULT_PROCESSING"].includes(currentRole)) {
      actionable = true;
      await handleA21Result(job);
    }

    if (actionable) handled.add(key);
  }

  async function tick() {
    const currentRole = role();
    const response = await chrome.runtime
      .sendMessage({ type: "SHOPLING_LIFECYCLE_GET_JOB" })
      .catch(() => null);
    const job = response?.job || openerAssignment(currentRole);
    if (job) await drive(job, currentRole);
  }

  setInterval(() => void tick(), 800);
  setTimeout(() => void tick(), 80);
  window.addEventListener("load", () => setTimeout(() => void tick(), 120), {
    once: true,
  });
})();
