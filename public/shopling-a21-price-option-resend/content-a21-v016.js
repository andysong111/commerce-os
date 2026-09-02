(() => {
  const VERSION = "0.1.6";
  const CLAIM_MESSAGE = "A21_POPUP_CLAIM_V016";
  const normalize = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const bodyText = () => normalize(document.body?.innerText || document.body?.textContent || "");
  const visible = (element) => {
    if (!(element instanceof HTMLElement)) return true;
    const rect = element.getBoundingClientRect();
    return element.offsetParent !== null || rect.width > 0 || rect.height > 0;
  };
  const setControl = (control, checked = true) => {
    if (!(control instanceof HTMLInputElement) || !["radio", "checkbox"].includes(control.type)) return false;
    if (checked && !control.checked) control.click();
    if (!checked && control.checked && control.type === "checkbox") control.click();
    control.checked = checked;
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
    return control.checked === checked;
  };
  const controlText = (element) => {
    if (!element) return "";
    const chunks = [];
    if (element instanceof HTMLInputElement) chunks.push(element.value || "", element.title || "", element.alt || "", element.name || "", element.getAttribute("aria-label") || "");
    else chunks.push(element.textContent || "", element.getAttribute?.("title") || "", element.getAttribute?.("alt") || "", element.getAttribute?.("aria-label") || "");
    return normalize(chunks.join(" "));
  };
  const role = () => {
    const text = bodyText();
    if (/상품수정\s*송신/i.test(text) && /일반내용수정/i.test(text) && /옵션송신/i.test(text)) return "A21_POPUP";
    if (/성공건수|실패건수|성공여부|수정\s*전송\s*결과|상품\s*등록\s*전송\s*결과/i.test(text)) return "A21_RESULT";
    return "OTHER";
  };

  function visibleRadios() {
    return [...document.querySelectorAll('input[type="radio"]')]
      .filter(visible)
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return ar.top - br.top || ar.left - br.left;
      });
  }

  function topModeRadios() {
    const radios = visibleRadios();
    if (!radios.length) return [];
    const minTop = radios[0].getBoundingClientRect().top;
    return radios.filter((radio) => Math.abs(radio.getBoundingClientRect().top - minTop) <= 8)
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
  }

  function clusterByTop(radios, tolerance = 5) {
    const groups = [];
    for (const radio of radios) {
      const top = radio.getBoundingClientRect().top;
      let group = groups.find((item) => Math.abs(item.top - top) <= tolerance);
      if (!group) {
        group = { top, radios: [] };
        groups.push(group);
      }
      group.radios.push(radio);
      group.top = group.radios.reduce((sum, item) => sum + item.getBoundingClientRect().top, 0) / group.radios.length;
    }
    return groups.sort((a, b) => a.top - b.top);
  }

  function geometricGeneralPairs() {
    const modes = topModeRadios();
    if (modes.length < 2) return [];
    const general = modes[0];
    const second = modes[1];
    const g = general.getBoundingClientRect();
    const boundary = (g.left + second.getBoundingClientRect().left) / 2;
    const radios = visibleRadios().filter((radio) => {
      const rect = radio.getBoundingClientRect();
      return rect.top > g.top + 8 && rect.left < boundary;
    });
    const groups = clusterByTop(radios)
      .map((group) => group.radios.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left))
      .filter((group) => group.length >= 2)
      .map((group) => [group[0], group[group.length - 1]]);
    return groups.slice(0, 9);
  }

  function configurePriceGeometry() {
    const modes = topModeRadios();
    const general = modes[0] || null;
    if (!setControl(general, true)) return { ok: false, code: "V016_GENERAL_MODE", message: "일반내용수정 라디오를 위치 기준으로 찾지 못했습니다." };
    const pairs = geometricGeneralPairs();
    if (pairs.length !== 9) return { ok: false, code: "V016_GENERAL_ROWS", message: `일반항목 라디오 9행 중 ${pairs.length}행만 식별했습니다.` };
    pairs.forEach((pair, index) => setControl(index === 1 ? pair[0] : pair[1], true));
    const valid = general.checked && pairs.every((pair, index) => {
      const expected = index === 1 ? 0 : 1;
      return pair[expected].checked && !pair[1 - expected].checked;
    });
    return valid ? { ok: true } : { ok: false, code: "V016_PRICE_VERIFY", message: "판매가만 수정 상태를 위치 기준으로 검증하지 못했습니다." };
  }

  function configureOptionGeometry() {
    const modes = topModeRadios();
    const optionMode = modes[modes.length - 1] || null;
    if (!setControl(optionMode, true)) return { ok: false, code: "V016_OPTION_MODE", message: "옵션송신 상단 라디오를 찾지 못했습니다." };
    const m = optionMode.getBoundingClientRect();
    const controls = [...document.querySelectorAll('input[type="radio"],input[type="checkbox"]')]
      .filter((item) => visible(item) && item !== optionMode)
      .filter((item) => {
        const rect = item.getBoundingClientRect();
        return rect.top > m.top + 8 && Math.abs(rect.left - m.left) < 130;
      })
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    const first = controls[0] || null;
    if (!setControl(first, true)) return { ok: false, code: "V016_OPTION_SELECT", message: "옵션송신 선택 컨트롤을 위치 기준으로 찾지 못했습니다." };
    for (const item of controls.slice(1)) if (item instanceof HTMLInputElement && item.type === "checkbox") setControl(item, false);
    return optionMode.checked && first.checked ? { ok: true } : { ok: false, code: "V016_OPTION_VERIFY", message: "옵션송신 단독 선택 상태 검증에 실패했습니다." };
  }

  function submitButton() {
    const selector = 'button,input[type="button"],input[type="submit"],input[type="image"],img[alt],img[title],[onclick],a';
    const nodes = [...document.querySelectorAll(selector)].filter(visible);
    let found = nodes.find((node) => /상품수정\s*송신/.test(controlText(node) || normalize(node.textContent || "")));
    if (found instanceof HTMLImageElement) found = found.closest("a,button,input") || found;
    if (found) return found;

    const radios = visibleRadios();
    const radioBottom = radios.length ? Math.max(...radios.map((radio) => radio.getBoundingClientRect().bottom)) : 0;
    const buttonish = [...document.querySelectorAll('button,input[type="button"],input[type="submit"],input[type="image"],img')]
      .filter(visible)
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.top > radioBottom + 20 && rect.width >= 35 && rect.height >= 14;
      });
    if (!buttonish.length) return null;
    const bottomTop = Math.max(...buttonish.map((node) => node.getBoundingClientRect().top));
    const bottomRow = buttonish.filter((node) => Math.abs(node.getBoundingClientRect().top - bottomTop) <= 12)
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    return bottomRow[0] || null;
  }

  function clickSubmit(button) {
    if (!button) return false;
    try {
      button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      button.click();
      return true;
    } catch {
      return false;
    }
  }

  async function waitForResult(assignment) {
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      const text = bodyText();
      const successMatch = text.match(/성공건수\s*[:：]?\s*([\d,]+)/i);
      const failMatch = text.match(/실패건수\s*[:：]?\s*([\d,]+)/i);
      const success = successMatch ? Number(successMatch[1].replace(/,/g, "")) : 0;
      const failure = failMatch ? Number(failMatch[1].replace(/,/g, "")) : 0;
      if (failure > 0 || /성공여부\s*[:：]?\s*실패/i.test(text)) {
        await chrome.runtime.sendMessage({ type: "A21_JOB_FAILURE", jobId: assignment.jobId, code: "V016_RESULT_FAILURE", message: `Shopling 결과 실패 ${failure || 1}건` }).catch(() => null);
        return;
      }
      if (success > 0 || /성공여부\s*[:：]?\s*성공/i.test(text) || /정상적으로.*처리/i.test(text)) {
        await chrome.runtime.sendMessage({ type: "A21_JOB_SUCCESS", jobId: assignment.jobId, message: `${assignment.mode === "PRICE" ? "판매가" : "옵션"} 수정전송 성공 확인` }).catch(() => null);
        return;
      }
      await sleep(800);
    }
    await chrome.runtime.sendMessage({ type: "A21_JOB_FAILURE", jobId: assignment.jobId, code: "V016_RESULT_TIMEOUT", message: "상품수정 송신 후 결과를 180초 동안 확인하지 못했습니다." }).catch(() => null);
  }

  async function run() {
    const currentRole = role();
    if (!/[A-Z]/.test(currentRole) || currentRole === "OTHER") return;
    const claim = await chrome.runtime.sendMessage({ type: CLAIM_MESSAGE, role: currentRole, href: location.href }).catch(() => null);
    const assignment = claim?.assignment;
    if (!claim?.ok || !assignment?.jobId) return;
    if (currentRole === "A21_RESULT") return waitForResult(assignment);
    if (currentRole !== "A21_POPUP") return;

    const configured = assignment.mode === "PRICE" ? configurePriceGeometry() : configureOptionGeometry();
    if (!configured.ok) {
      await chrome.runtime.sendMessage({ type: "A21_JOB_FAILURE", jobId: assignment.jobId, code: configured.code, message: configured.message }).catch(() => null);
      return;
    }
    await chrome.runtime.sendMessage({ type: "A21_STAGE", jobId: assignment.jobId, stage: "POPUP_CONFIG", message: `${assignment.mode === "PRICE" ? "판매가" : "옵션"} 단독 설정 검증 완료` }).catch(() => null);
    await sleep(250);
    const button = submitButton();
    if (!button) {
      await chrome.runtime.sendMessage({ type: "A21_JOB_FAILURE", jobId: assignment.jobId, code: "V016_SUBMIT_NOT_FOUND", message: "상품수정 송신 버튼을 위치/텍스트 기준 모두에서 찾지 못했습니다." }).catch(() => null);
      return;
    }
    await chrome.runtime.sendMessage({ type: "A21_STAGE", jobId: assignment.jobId, stage: "SUBMIT_CLICKED", message: `${assignment.mode === "PRICE" ? "판매가" : "옵션"} · 상품수정 송신 클릭` }).catch(() => null);
    if (!clickSubmit(button)) {
      await chrome.runtime.sendMessage({ type: "A21_JOB_FAILURE", jobId: assignment.jobId, code: "V016_SUBMIT_CLICK_FAILED", message: "상품수정 송신 버튼 클릭 실행에 실패했습니다." }).catch(() => null);
      return;
    }
    await chrome.runtime.sendMessage({ type: "A21_STAGE", jobId: assignment.jobId, stage: "RESULT_WAIT", message: "Shopling 수정전송 결과 확인 중" }).catch(() => null);
    await sleep(700);
    void waitForResult(assignment);
  }

  setTimeout(() => void run(), 120);
  window.addEventListener("load", () => setTimeout(() => void run(), 180), { once: true });
})();
