(() => {
  const VERSION = "0.1.3";
  const OPENER_PREFIX = "commerce-os-a21-v013:";
  const READY_MESSAGE = "A21_POPUP_READY_V013";
  const normalize = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const bodyText = () => normalize(document.body?.innerText || document.body?.textContent || "");
  let autonomousPopupStarted = false;

  function role() {
    const text = bodyText();
    if (/상품수정\s*송신/i.test(text) && /일반내용수정/i.test(text) && /옵션송신/i.test(text)) return "A21_POPUP";
    if (/쇼핑몰상품수정/i.test(text) && /상품\s*수정전송/i.test(text) && /검색항목/i.test(text)) return "A21_LIST";
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

  function setControl(control, checked = true) {
    if (!(control instanceof HTMLInputElement) || !["radio", "checkbox"].includes(control.type)) return false;
    if (checked && !control.checked) control.click();
    if (!checked && control.checked && control.type === "checkbox") control.click();
    control.checked = checked;
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
    return control.checked === checked;
  }

  function radioByText(target) {
    const wanted = normalize(target);
    const radios = [...document.querySelectorAll('input[type="radio"]')];
    return radios.find((radio) => localControlText(radio) === wanted)
      || radios.find((radio) => localControlText(radio).includes(wanted))
      || radios.find((radio) => adjacentText(radio).includes(wanted))
      || null;
  }

  function rowByText(target) {
    const wanted = normalize(target);
    const rows = [...document.querySelectorAll("tr")];
    return rows.find((row) => normalize(row.textContent || "").startsWith(`${wanted} `))
      || rows.find((row) => normalize(row.textContent || "") === wanted)
      || rows.find((row) => normalize(row.textContent || "").includes(wanted))
      || null;
  }

  function chooseRadioInRow(row, label) {
    if (!row) return false;
    const wanted = normalize(label);
    const radios = [...row.querySelectorAll('input[type="radio"]')];
    let candidate = radios.find((radio) => localControlText(radio) === wanted)
      || radios.find((radio) => localControlText(radio).includes(wanted));
    if (!candidate && wanted === "수정") candidate = radios[0] || null;
    if (!candidate && wanted === "수정안함") candidate = radios[radios.length - 1] || null;
    return setControl(candidate, true);
  }

  function configurePrice() {
    const top = radioByText("일반내용수정");
    if (!setControl(top, true)) return { ok: false, code: "A21_GENERAL_MODE_NOT_FOUND", message: "일반내용수정 모드를 찾지 못했습니다." };
    const priceRow = rowByText("판매가");
    if (!priceRow || !chooseRadioInRow(priceRow, "수정")) return { ok: false, code: "A21_PRICE_MODIFY_NOT_FOUND", message: "판매가 수정 선택을 찾지 못했습니다." };
    for (const row of document.querySelectorAll("tr")) {
      if (row === priceRow) continue;
      const text = normalize(row.textContent || "");
      if (text.includes("수정") && text.includes("수정안함")) chooseRadioInRow(row, "수정안함");
    }
    return { ok: Boolean(top.checked) };
  }

  function configureOption() {
    const top = radioByText("옵션송신");
    if (!setControl(top, true)) return { ok: false, code: "A21_OPTION_MODE_NOT_FOUND", message: "옵션송신 모드를 찾지 못했습니다." };
    const rows = [...document.querySelectorAll("tr")];
    const optionRow = rows.find((row) => {
      const text = normalize(row.textContent || "");
      return text.startsWith("옵션송신 ") && text.includes("선택") && !text.includes("추가상품송신");
    }) || rows.find((row) => normalize(row.textContent || "") === "옵션송신 선택");
    if (!optionRow) return { ok: false, code: "A21_OPTION_ROW_NOT_FOUND", message: "옵션송신 선택 행을 찾지 못했습니다." };
    const control = [...optionRow.querySelectorAll('input[type="radio"],input[type="checkbox"]')]
      .find((item) => adjacentText(item).includes("선택")) || optionRow.querySelector('input[type="radio"],input[type="checkbox"]');
    if (!setControl(control, true)) return { ok: false, code: "A21_OPTION_SELECT_NOT_FOUND", message: "옵션송신 선택 버튼을 찾지 못했습니다." };
    for (const row of rows.filter((item) => /추가상품송신/.test(normalize(item.textContent || "")) && item !== optionRow)) {
      for (const box of row.querySelectorAll('input[type="checkbox"]')) setControl(box, false);
    }
    return { ok: Boolean(top.checked && control.checked) };
  }

  function submitButton() {
    const primary = [...document.querySelectorAll('button,input[type="button"],input[type="submit"],input[type="image"],a')];
    let candidate = primary.find((element) => /상품수정\s*송신/.test(controlText(element)));
    if (candidate) return candidate;
    candidate = [...document.querySelectorAll('[onclick]')].find((element) => /상품수정\s*송신/.test(controlText(element) || normalize(element.textContent || "")));
    if (candidate) return candidate;
    const image = [...document.querySelectorAll('img[alt],img[title]')].find((element) => /상품수정\s*송신/.test(controlText(element)));
    return image?.closest("a,button") || image || null;
  }

  async function stage(jobId, nextStage, message) {
    await chrome.runtime.sendMessage({ type: "A21_STAGE", jobId, stage: nextStage, message }).catch(() => null);
  }

  async function fail(jobId, code, message) {
    await chrome.runtime.sendMessage({ type: "A21_JOB_FAILURE", jobId, code, message }).catch(() => null);
  }

  function markWorker(message) {
    if (role() !== "A21_LIST" || !message?.jobId || !message?.mode) return;
    try {
      window.name = OPENER_PREFIX + encodeURIComponent(JSON.stringify({ jobId: String(message.jobId), mode: String(message.mode), runId: String(message.runId || "") }));
    } catch { /* best effort */ }
  }

  function openerAssignment() {
    if (role() !== "A21_POPUP") return null;
    let raw = "";
    try { raw = String(window.opener?.name || ""); } catch { return null; }
    if (!raw.startsWith(OPENER_PREFIX)) return null;
    try {
      const parsed = JSON.parse(decodeURIComponent(raw.slice(OPENER_PREFIX.length)));
      if (!parsed?.jobId || !["PRICE", "OPTION"].includes(parsed.mode)) return null;
      return { jobId: String(parsed.jobId), mode: String(parsed.mode), runId: String(parsed.runId || "") };
    } catch {
      return null;
    }
  }

  async function autoPopup() {
    if (autonomousPopupStarted) return;
    const assignment = openerAssignment();
    if (!assignment) return;
    autonomousPopupStarted = true;
    await chrome.runtime.sendMessage({ type: READY_MESSAGE, ...assignment, version: VERSION }).catch(() => null);
    await sleep(500);
    if (role() !== "A21_POPUP") return;
    const configured = assignment.mode === "PRICE" ? configurePrice() : configureOption();
    if (!configured.ok) return fail(assignment.jobId, configured.code || "A21_POPUP_CONFIG_FAILED", configured.message || "수정송신 팝업 설정 실패");
    const button = submitButton();
    if (!button) {
      const diagnostic = [...document.querySelectorAll('button,input,a,[onclick]')].map(controlText).filter(Boolean).filter((text) => /송신|수정/.test(text)).slice(0, 10).join(" | ");
      return fail(assignment.jobId, "A21_SUBMIT_BUTTON_NOT_FOUND_V013", `상품수정 송신 버튼을 찾지 못했습니다.${diagnostic ? ` 후보: ${diagnostic}` : ""}`);
    }
    await stage(assignment.jobId, "SUBMIT_CLICKED", `${assignment.mode === "PRICE" ? "판매가" : "옵션"} 단독 전송 버튼 확인·클릭`);
    button.click();
    await stage(assignment.jobId, "RESULT_WAIT", "Shopling 수정전송 결과 확인 중");
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "A21_LIST_ASSIGNMENT") markWorker(message);
    return false;
  });

  setTimeout(() => void autoPopup(), 80);
})();
