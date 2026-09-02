(() => {
  const VERSION = "0.1.4";
  const OPENER_PREFIX = "commerce-os-a21-v014:";
  const READY_MESSAGE = "A21_POPUP_READY_V013";
  const GENERAL_ROWS = ["상품명", "판매가", "카테고리", "상품이미지", "수수료", "상세설명", "키워드", "유료서비스", "쇼핑몰배송정보"];
  const normalize = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const bodyText = () => normalize(document.body?.innerText || document.body?.textContent || "");
  let autonomousPopupStarted = false;

  function role() {
    const text = bodyText();
    if (/상품수정\s*송신/i.test(text) && /일반내용수정/i.test(text) && /옵션송신/i.test(text)) return "A21_POPUP";
    if (/쇼핑몰상품수정/i.test(text) && /상품\s*수정전송/i.test(text) && /검색항목/i.test(text)) return "A21_LIST";
    if (/성공건수|실패건수|성공여부|수정\s*전송\s*결과/i.test(text)) return "A21_RESULT";
    return "OTHER";
  }

  function controlText(element) {
    if (!element) return "";
    const chunks = [];
    if (element instanceof HTMLInputElement) {
      chunks.push(element.value || "", element.title || "", element.alt || "", element.name || "", element.getAttribute("aria-label") || "");
    } else {
      chunks.push(element.textContent || "", element.getAttribute?.("title") || "", element.getAttribute?.("alt") || "", element.getAttribute?.("aria-label") || "");
    }
    return normalize(chunks.join(" "));
  }

  function localControlText(control) {
    const chunks = [controlText(control)];
    if (control?.id) {
      const label = document.querySelector(`label[for="${CSS.escape(control.id)}"]`);
      if (label) chunks.push(label.textContent || "");
    }
    const wrappingLabel = control?.closest?.("label");
    if (wrappingLabel) chunks.push(wrappingLabel.textContent || "");
    for (const node of [control?.previousSibling, control?.nextSibling]) {
      if (node) chunks.push(node.textContent || "");
    }
    return normalize(chunks.join(" "));
  }

  function adjacentText(control) {
    return normalize(`${localControlText(control)} ${control?.parentElement?.textContent || ""}`);
  }

  function visible(control) {
    if (!(control instanceof HTMLElement)) return true;
    const rect = control.getBoundingClientRect();
    return rect.width >= 0 && rect.height >= 0;
  }

  function setControl(control, checked = true) {
    if (!(control instanceof HTMLInputElement) || !["radio", "checkbox"].includes(control.type)) return false;
    if (checked && !control.checked) control.click();
    if (!checked && control.checked && control.type === "checkbox") control.click();
    control.checked = checked;
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
    return control.checked === checked;
  }

  function modeRadio(target) {
    const wanted = normalize(target);
    const candidates = [...document.querySelectorAll('input[type="radio"]')]
      .filter((radio) => visible(radio) && adjacentText(radio).includes(wanted));
    candidates.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    return candidates[0] || null;
  }

  function logicalGeneralRow(label) {
    const wanted = normalize(label);
    const rows = [...document.querySelectorAll("tr")]
      .filter((row) => {
        const text = normalize(row.textContent || "");
        const radios = row.querySelectorAll('input[type="radio"]');
        return radios.length === 2 && (text === wanted || text.startsWith(`${wanted} `));
      });
    if (rows.length) return rows[0];

    const exactNodes = [...document.querySelectorAll("td,th,div,span")].filter((node) => normalize(node.textContent || "") === wanted);
    for (const node of exactNodes) {
      let cursor = node.parentElement;
      for (let depth = 0; cursor && depth < 5; depth += 1, cursor = cursor.parentElement) {
        const radios = cursor.querySelectorAll('input[type="radio"]');
        if (radios.length === 2) return cursor;
        if (radios.length > 2) break;
      }
    }
    return null;
  }

  function selectGeneralRow(label, modify) {
    const row = logicalGeneralRow(label);
    if (!row) return { ok: false, row: null };
    const radios = [...row.querySelectorAll('input[type="radio"]')];
    if (radios.length !== 2) return { ok: false, row };
    const target = modify ? radios[0] : radios[1];
    if (!setControl(target, true)) return { ok: false, row };
    return { ok: target.checked && radios[modify ? 1 : 0].checked === false, row, target };
  }

  function verifyPriceConfiguration() {
    const general = modeRadio("일반내용수정");
    if (!general?.checked) return false;
    for (const label of GENERAL_ROWS) {
      const row = logicalGeneralRow(label);
      if (!row) return false;
      const radios = [...row.querySelectorAll('input[type="radio"]')];
      if (radios.length !== 2) return false;
      const expectedIndex = label === "판매가" ? 0 : 1;
      if (!radios[expectedIndex].checked || radios[1 - expectedIndex].checked) return false;
    }
    return true;
  }

  function configurePrice() {
    const top = modeRadio("일반내용수정");
    if (!setControl(top, true)) return { ok: false, code: "A21_GENERAL_MODE_NOT_FOUND", message: "일반내용수정 모드를 찾지 못했습니다." };
    for (const label of GENERAL_ROWS) {
      const result = selectGeneralRow(label, label === "판매가");
      if (!result.ok) return { ok: false, code: "A21_GENERAL_ROW_SELECT_FAILED", message: `${label} 행의 수정/수정안함 선택을 정확히 설정하지 못했습니다.` };
    }
    if (!verifyPriceConfiguration()) {
      return { ok: false, code: "A21_PRICE_CONFIGURATION_VERIFY_FAILED", message: "판매가만 수정, 나머지는 수정안함 상태 검증에 실패했습니다." };
    }
    return { ok: true };
  }

  function optionSelectionControl() {
    const controls = [...document.querySelectorAll('input[type="radio"],input[type="checkbox"]')]
      .filter((item) => visible(item));
    const candidates = controls.filter((item) => {
      const text = adjacentText(item);
      return text.includes("옵션송신") && text.includes("선택") && !text.includes("추가상품송신") && !text.includes("옵션+추가상품송신");
    });
    candidates.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    return candidates[0] || null;
  }

  function configureOption() {
    const top = modeRadio("옵션송신");
    if (!setControl(top, true)) return { ok: false, code: "A21_OPTION_MODE_NOT_FOUND", message: "상단 옵션송신 모드를 찾지 못했습니다." };
    const control = optionSelectionControl();
    if (!setControl(control, true)) return { ok: false, code: "A21_OPTION_SELECT_NOT_FOUND", message: "옵션송신의 선택 버튼을 찾지 못했습니다." };

    for (const item of document.querySelectorAll('input[type="checkbox"]')) {
      const text = adjacentText(item);
      if (text.includes("추가상품송신") || text.includes("옵션+추가상품송신")) setControl(item, false);
    }
    if (!top.checked || !control.checked) {
      return { ok: false, code: "A21_OPTION_CONFIGURATION_VERIFY_FAILED", message: "옵션송신 단독 선택 상태 검증에 실패했습니다." };
    }
    return { ok: true };
  }

  function submitButton() {
    const selector = 'button,input[type="button"],input[type="submit"],input[type="image"],a,[onclick],img[alt],img[title]';
    const nodes = [...document.querySelectorAll(selector)].filter((node) => visible(node));
    let candidate = nodes.find((element) => /상품수정\s*송신/.test(controlText(element)));
    if (!candidate) candidate = nodes.find((element) => /상품수정\s*송신/.test(normalize(element.textContent || "")));
    if (!candidate) return null;
    if (candidate instanceof HTMLImageElement) return candidate.closest("a,button,input") || candidate;
    return candidate;
  }

  function clickSubmitButton(button) {
    if (!button) return false;
    const rect = button.getBoundingClientRect?.();
    if (rect && rect.width === 0 && rect.height === 0) return false;
    try {
      button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      button.click();
      return true;
    } catch {
      return false;
    }
  }

  async function stage(jobId, nextStage, message) {
    await chrome.runtime.sendMessage({ type: "A21_STAGE", jobId, stage: nextStage, message }).catch(() => null);
  }

  async function fail(jobId, code, message) {
    await chrome.runtime.sendMessage({ type: "A21_JOB_FAILURE", jobId, code, message }).catch(() => null);
  }

  function encodeAssignment(message) {
    try {
      return OPENER_PREFIX + encodeURIComponent(JSON.stringify({ jobId: String(message.jobId), mode: String(message.mode), runId: String(message.runId || "") }));
    } catch {
      return "";
    }
  }

  function markWorker(message) {
    if (role() !== "A21_LIST" || !message?.jobId || !message?.mode) return;
    const marker = encodeAssignment(message);
    if (marker) window.name = marker;
  }

  function assignmentFromMarker(raw) {
    if (!raw?.startsWith(OPENER_PREFIX)) return null;
    try {
      const parsed = JSON.parse(decodeURIComponent(raw.slice(OPENER_PREFIX.length)));
      if (!parsed?.jobId || !["PRICE", "OPTION"].includes(parsed.mode)) return null;
      return { jobId: String(parsed.jobId), mode: String(parsed.mode), runId: String(parsed.runId || "") };
    } catch {
      return null;
    }
  }

  function openerAssignment() {
    let own = "";
    try { own = String(window.name || ""); } catch { /* ignore */ }
    const fromOwn = assignmentFromMarker(own);
    if (fromOwn) return fromOwn;
    let opener = "";
    try { opener = String(window.opener?.name || ""); } catch { return null; }
    return assignmentFromMarker(opener);
  }

  function resultEvidence() {
    const text = bodyText();
    const successMatch = text.match(/성공건수\s*[:：]?\s*([\d,]+)/i);
    const failMatch = text.match(/실패건수\s*[:：]?\s*([\d,]+)/i);
    const success = successMatch ? Number(successMatch[1].replace(/,/g, "")) : 0;
    const failure = failMatch ? Number(failMatch[1].replace(/,/g, "")) : 0;
    const explicitSuccess = /성공여부\s*[:：]?\s*성공/i.test(text) || /정상적으로.*처리/i.test(text);
    const explicitFailure = /성공여부\s*[:：]?\s*실패/i.test(text);
    return { success, failure, explicitSuccess, explicitFailure };
  }

  async function autoResult(assignment) {
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      const evidence = resultEvidence();
      if (evidence.failure > 0 || evidence.explicitFailure) {
        return fail(assignment.jobId, "A21_SHOPLING_RESULT_FAILURE", `Shopling 결과에서 실패 ${evidence.failure || 1}건을 확인했습니다.`);
      }
      if (evidence.success > 0 || evidence.explicitSuccess) {
        await chrome.runtime.sendMessage({ type: "A21_JOB_SUCCESS", jobId: assignment.jobId, message: `${assignment.mode === "PRICE" ? "판매가" : "옵션"} 수정전송 성공 확인` }).catch(() => null);
        return;
      }
      await sleep(1000);
    }
    return fail(assignment.jobId, "A21_RESULT_TIMEOUT", "상품수정 송신 후 180초 동안 확정 성공 결과를 확인하지 못했습니다.");
  }

  async function autoPopup() {
    if (autonomousPopupStarted) return;
    const assignment = openerAssignment();
    if (!assignment) return;

    if (role() === "A21_RESULT") {
      autonomousPopupStarted = true;
      return autoResult(assignment);
    }
    if (role() !== "A21_POPUP") return;

    autonomousPopupStarted = true;
    try { window.name = encodeAssignment(assignment); } catch { /* best effort */ }
    await chrome.runtime.sendMessage({ type: READY_MESSAGE, ...assignment, version: VERSION }).catch(() => null);
    await sleep(350);

    const configured = assignment.mode === "PRICE" ? configurePrice() : configureOption();
    if (!configured.ok) return fail(assignment.jobId, configured.code || "A21_POPUP_CONFIG_FAILED", configured.message || "수정송신 팝업 설정 실패");

    await sleep(250);
    if (assignment.mode === "PRICE" && !verifyPriceConfiguration()) {
      return fail(assignment.jobId, "A21_PRICE_CONFIGURATION_CHANGED", "송신 직전 판매가 단독 수정 상태가 유지되지 않아 전송을 차단했습니다.");
    }

    const button = submitButton();
    if (!button) {
      const diagnostic = [...document.querySelectorAll('button,input,a,[onclick],img')]
        .map(controlText).filter(Boolean).filter((text) => /송신|수정/.test(text)).slice(0, 12).join(" | ");
      return fail(assignment.jobId, "A21_SUBMIT_BUTTON_NOT_FOUND_V014", `상품수정 송신 버튼을 찾지 못했습니다.${diagnostic ? ` 후보: ${diagnostic}` : ""}`);
    }

    await stage(assignment.jobId, "SUBMIT_CLICKED", `${assignment.mode === "PRICE" ? "판매가" : "옵션"} 단독 설정 검증 완료 · 상품수정 송신 클릭`);
    if (!clickSubmitButton(button)) return fail(assignment.jobId, "A21_SUBMIT_CLICK_FAILED_V014", "상품수정 송신 버튼 클릭 실행에 실패했습니다.");
    await stage(assignment.jobId, "RESULT_WAIT", "Shopling 수정전송 결과 확인 중");
    await sleep(900);
    if (role() === "A21_RESULT" || /성공건수|실패건수|성공여부/.test(bodyText())) void autoResult(assignment);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "A21_LIST_ASSIGNMENT") markWorker(message);
    return false;
  });

  setTimeout(() => void autoPopup(), 40);
  window.addEventListener("load", () => setTimeout(() => void autoPopup(), 60), { once: true });
})();
