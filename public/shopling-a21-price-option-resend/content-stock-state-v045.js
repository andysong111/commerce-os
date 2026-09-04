(() => {
  const VERSION = "0.4.5";
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const norm = (value) =>
    String(value ?? "")
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim();
  const bodyText = () =>
    norm(document.body?.innerText || document.body?.textContent || "");
  let running = false;

  function visible(element) {
    if (!(element instanceof HTMLElement)) return true;
    const rect = element.getBoundingClientRect();
    return element.offsetParent !== null || rect.width > 0 || rect.height > 0;
  }

  function controlText(element) {
    if (!element) return "";
    const chunks = [
      element.textContent || "",
      element.value || "",
      element.title || "",
      element.alt || "",
      element.name || "",
      element.id || "",
      element.getAttribute?.("aria-label") || "",
    ];
    const parent = element.closest?.("label,tr,td,div");
    if (parent) chunks.push(parent.textContent || "");
    return norm(chunks.join(" "));
  }

  function role() {
    const text = bodyText();
    if (/상품판매상태송신/.test(text) && /상품수정\s*송신/.test(text)) {
      return "A21_POPUP";
    }
    if (/상품옵션\s*수정\s*전송이\s*완료되었습니다/.test(text)) {
      return "A22_RESULT";
    }
    if (/상품\s*수정\s*전송이\s*완료되었습니다/.test(text)) {
      return "A21_RESULT";
    }
    if (/쇼핑몰상품옵션전송/.test(text) || /상품옵션전송/.test(text)) {
      return "A22";
    }
    if (/옵션대량수정/.test(text) && /일괄\s*상태변경/.test(text)) {
      return "A6";
    }
    if (/쇼핑몰상품수정/.test(text) && /상품\s*수정전송/.test(text)) {
      return "A21";
    }
    if (/처리중입니다|성공건수|실패건수|수정\s*전송\s*결과/.test(text)) {
      return "RESULT";
    }
    return "OTHER";
  }

  function setSelectByText(select, wanted) {
    if (!(select instanceof HTMLSelectElement)) return false;
    const target = norm(wanted);
    const option = [...select.options].find(
      (item) => norm(item.textContent) === target,
    ) || [...select.options].find((item) => norm(item.textContent).includes(target));
    if (!option) return false;
    select.value = option.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return select.value === option.value;
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

  function clickNode(node) {
    if (!node) return false;
    try {
      node.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      );
      node.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      );
      node.click();
      return true;
    } catch {
      return false;
    }
  }

  function clickableNodes() {
    return [
      ...document.querySelectorAll(
        'a,button,input[type="button"],input[type="submit"],input[type="image"],[onclick],img[alt],img[title]',
      ),
    ].filter(visible);
  }

  function findClickable(pattern, exact = false) {
    const nodes = clickableNodes();
    const candidates = nodes.filter((node) => {
      const label = controlText(node);
      return exact ? label === pattern : pattern.test(label);
    });
    candidates.sort((left, right) => {
      const leftText = controlText(left).length;
      const rightText = controlText(right).length;
      return leftText - rightText;
    });
    const candidate = candidates[0] || null;
    if (candidate instanceof HTMLImageElement) {
      return candidate.closest("a,button,input,[onclick]") || candidate;
    }
    return candidate;
  }

  function findMenuLink(labelPattern) {
    const nodes = [
      ...document.querySelectorAll('a,[onclick],td,li,span'),
    ].filter(visible);
    const candidates = nodes.filter((node) => labelPattern.test(controlText(node)));
    candidates.sort((left, right) => {
      const leftLink = left.closest("a,[onclick]") ? 0 : 1;
      const rightLink = right.closest("a,[onclick]") ? 0 : 1;
      return leftLink - rightLink || controlText(left).length - controlText(right).length;
    });
    const node = candidates[0] || null;
    return node?.closest?.("a,[onclick]") || node;
  }

  function findSearchSelect(label) {
    const target = norm(label);
    const selects = [...document.querySelectorAll("select")].filter(
      (select) =>
        visible(select) &&
        [...select.options].some((option) =>
          norm(option.textContent).includes(target),
        ),
    );
    selects.sort((left, right) => {
      const leftContext = controlText(left);
      const rightContext = controlText(right);
      return Number(!leftContext.includes("검색항목")) - Number(!rightContext.includes("검색항목"));
    });
    return selects[0] || null;
  }

  function findSearchInput(select) {
    const scopes = [
      select?.closest?.("form"),
      select?.closest?.("table"),
      select?.parentElement?.parentElement,
      document,
    ].filter(Boolean);
    for (const scope of scopes) {
      const inputs = [
        ...scope.querySelectorAll('input[type="text"],textarea'),
      ].filter((input) => !input.disabled && visible(input));
      const ranked = inputs
        .map((input) => ({
          input,
          score:
            (controlText(input).includes("검색") ? 10 : 0) +
            (input.closest("tr") === select?.closest("tr") ? 10 : 0) -
            (/^20\d{6}$/.test(norm(input.value)) ? 20 : 0),
        }))
        .sort((left, right) => right.score - left.score);
      if (ranked[0]?.input) return ranked[0].input;
    }
    return null;
  }

  function clickSearch(input) {
    const scope = input?.form || input?.closest?.("table") || document;
    const candidates = [
      ...scope.querySelectorAll(
        'a,button,input[type="button"],input[type="submit"],input[type="image"],[onclick]',
      ),
    ].filter((node) => norm(controlText(node)) === "검색");
    if (!candidates.length) {
      const fallback = findClickable(/^검색$/);
      return clickNode(fallback);
    }
    const inputTop = input.getBoundingClientRect().top;
    candidates.sort(
      (left, right) =>
        Math.abs(left.getBoundingClientRect().top - inputTop) -
        Math.abs(right.getBoundingClientRect().top - inputTop),
    );
    return clickNode(candidates[0]);
  }

  function configureSearch(label, value) {
    const select = findSearchSelect(label);
    if (!select || !setSelectByText(select, label)) {
      return { ok: false, error: `${label} 검색항목을 찾지 못했습니다.` };
    }
    const input = findSearchInput(select);
    if (!input) return { ok: false, error: "검색 입력칸을 찾지 못했습니다." };
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    if (!clickSearch(input)) {
      return { ok: false, error: "검색 버튼을 클릭하지 못했습니다." };
    }
    return { ok: true };
  }

  function rowsContaining(value) {
    const target = norm(value);
    return [...document.querySelectorAll("tr")].filter((row) => {
      if (!visible(row)) return false;
      const rowText = norm(row.textContent || "");
      return rowText.includes(target) && row.querySelector('input[type="checkbox"]');
    });
  }

  function selectRows(value) {
    const rows = rowsContaining(value);
    let checked = 0;
    for (const row of rows) {
      const checkbox = [...row.querySelectorAll('input[type="checkbox"]')].find(
        (input) => !input.disabled,
      );
      if (checkbox && setCheck(checkbox, true)) checked += 1;
    }
    return { rows, checked };
  }

  function targetKoreanState(task) {
    return task.targetState === "SOLD_OUT" ? "품절" : "판매중";
  }

  function setA6State(task, rows) {
    const wanted = targetKoreanState(task);
    let changed = 0;
    for (const row of rows) {
      const selects = [...row.querySelectorAll("select")].filter((select) =>
        [...select.options].some((option) =>
          ["판매중", "품절"].includes(norm(option.textContent)),
        ),
      );
      for (const select of selects) {
        if (setSelectByText(select, wanted)) changed += 1;
      }
      if (!selects.length) {
        const controls = [
          ...row.querySelectorAll('input[type="radio"],input[type="checkbox"]'),
        ].filter((control) => controlText(control).includes(wanted));
        for (const control of controls) {
          if (setCheck(control, true)) changed += 1;
        }
      }
    }
    if (changed > 0) return true;

    const globalSelects = [...document.querySelectorAll("select")].filter((select) => {
      const options = [...select.options].map((option) => norm(option.textContent));
      return options.includes("판매중") && options.includes("품절");
    });
    for (const select of globalSelects) {
      if (setSelectByText(select, wanted)) return true;
    }
    const globalControl = [
      ...document.querySelectorAll('input[type="radio"],input[type="checkbox"]'),
    ].find((control) => controlText(control).includes(wanted));
    return setCheck(globalControl, true);
  }

  function resultCounts() {
    const text = bodyText();
    const successMatch = text.match(/성공건수\s*[:：]?\s*([\d,]+)/i);
    const failureMatch = text.match(/실패건수\s*[:：]?\s*([\d,]+)/i);
    return {
      success: successMatch ? Number(successMatch[1].replace(/,/g, "")) : 0,
      failure: failureMatch ? Number(failureMatch[1].replace(/,/g, "")) : 0,
    };
  }

  async function stage(task, nextStage, message, redispatch = false) {
    return chrome.runtime.sendMessage({
      type: "COMMERCE_OS_STOCK_STAGE",
      taskId: task.taskId,
      stage: nextStage,
      message,
      redispatch,
      version: VERSION,
    });
  }

  async function finish(task, success, message, payload = null) {
    return chrome.runtime.sendMessage({
      type: "COMMERCE_OS_STOCK_TASK_RESULT",
      taskId: task.taskId,
      success,
      message,
      payload,
      version: VERSION,
    });
  }

  async function navigateMenu(task, nextStage, pattern, label) {
    const link = findMenuLink(pattern);
    if (!link) {
      await finish(task, false, `${label} 메뉴를 찾지 못했습니다.`);
      return;
    }
    await stage(task, nextStage, `${label} 이동 중`);
    clickNode(link);
  }

  async function handleA6(task, currentStage) {
    if (currentStage === "NAVIGATE_A6") {
      if (role() !== "A6") {
        return navigateMenu(task, "A6_SEARCH", /\[?6\]?\s*옵션대량수정|옵션대량수정/, "A6 옵션대량수정");
      }
      await stage(task, "A6_SEARCH", `${task.barcode} A6 검색 준비`, true);
      return;
    }
    if (role() !== "A6") {
      return navigateMenu(task, "A6_SEARCH", /\[?6\]?\s*옵션대량수정|옵션대량수정/, "A6 옵션대량수정");
    }
    if (currentStage === "A6_SEARCH") {
      await stage(task, "A6_APPLY", `${task.barcode} 옵션자체관리코드 검색 결과 대기`);
      const result = configureSearch("옵션자체관리코드", task.barcode);
      if (!result.ok) await finish(task, false, result.error);
      return;
    }
    if (currentStage === "A6_APPLY") {
      await sleep(500);
      const selected = selectRows(task.barcode);
      if (!selected.rows.length || selected.checked <= 0) {
        await finish(task, false, `${task.barcode} A6 검색 결과 행을 찾지 못했습니다.`);
        return;
      }
      if (!setA6State(task, selected.rows)) {
        await finish(task, false, `${task.barcode} 옵션상태 ${targetKoreanState(task)} 선택을 찾지 못했습니다.`);
        return;
      }
      const bulk = findClickable(/일괄\s*상태변경/);
      if (!bulk) {
        await finish(task, false, "A6 일괄 상태변경 버튼을 찾지 못했습니다.");
        return;
      }
      await stage(task, "A6_VERIFY", `${task.barcode} A6 ${targetKoreanState(task)} 저장 실행`);
      clickNode(bulk);
      await sleep(1200);
      const nextStage = task.productKind === "OPTION" ? "NAVIGATE_A22" : "NAVIGATE_A21";
      await stage(task, nextStage, `${task.barcode} A6 변경 완료 · 마켓 전송 준비`, true);
      return;
    }
    if (currentStage === "A6_VERIFY") {
      const nextStage = task.productKind === "OPTION" ? "NAVIGATE_A22" : "NAVIGATE_A21";
      await stage(task, nextStage, `${task.barcode} A6 변경 완료 · 마켓 전송 준비`, true);
    }
  }

  async function handleA22(task, currentStage) {
    if (currentStage === "NAVIGATE_A22") {
      if (role() !== "A22") {
        return navigateMenu(task, "A22_SEARCH", /\[?22\]?\s*쇼핑몰상품옵션전송|쇼핑몰상품옵션전송/, "A22 쇼핑몰상품옵션전송");
      }
      await stage(task, "A22_SEARCH", `${task.barcode} A22 검색 준비`, true);
      return;
    }
    if (role() !== "A22" && role() !== "A22_RESULT" && role() !== "RESULT") {
      return navigateMenu(task, "A22_SEARCH", /\[?22\]?\s*쇼핑몰상품옵션전송|쇼핑몰상품옵션전송/, "A22 쇼핑몰상품옵션전송");
    }
    if (currentStage === "A22_SEARCH") {
      await stage(task, "A22_SEND", `${task.barcode} A22 검색 결과 대기`);
      const result = configureSearch("옵션자체관리코드", task.barcode);
      if (!result.ok) await finish(task, false, result.error);
      return;
    }
    if (currentStage === "A22_SEND") {
      await sleep(500);
      const selected = selectRows(task.barcode);
      if (!selected.rows.length || selected.checked <= 0) {
        await finish(task, false, `${task.barcode} A22 전송행을 찾지 못했습니다.`);
        return;
      }
      const send = findClickable(/상품옵션전송/);
      if (!send) {
        await finish(task, false, "A22 상품옵션전송 버튼을 찾지 못했습니다.");
        return;
      }
      await stage(task, "A22_WAIT", `${task.barcode} 상품옵션전송 완료 대기`);
      clickNode(send);
      return;
    }
    if (currentStage === "A22_WAIT") {
      const text = bodyText();
      if (/처리중입니다|잠시만\s*기다려주시기\s*바랍니다/.test(text)) return;
      if (/상품옵션\s*수정\s*전송이\s*완료되었습니다/.test(text)) {
        const counts = resultCounts();
        await finish(
          task,
          counts.failure <= 0,
          counts.failure > 0
            ? `${task.barcode} 옵션전송 완료 · 실패 ${counts.failure}건`
            : `${task.barcode} ${targetKoreanState(task)} 옵션전송 완료`,
          counts,
        );
      }
    }
  }

  function configureA21SaleState(task) {
    const wantedMode = "상품판매상태송신";
    const radios = [...document.querySelectorAll('input[type="radio"]')].filter(visible);
    const mode = radios.find((radio) => controlText(radio).includes(wantedMode));
    if (!setCheck(mode, true)) return { ok: false, error: "상품판매상태송신 모드를 찾지 못했습니다." };
    const wanted = targetKoreanState(task);
    const stateRadios = radios.filter((radio) => {
      const label = controlText(radio);
      return label.includes(wanted) && !label.includes(wantedMode);
    });
    if (!stateRadios.length || !setCheck(stateRadios[0], true)) {
      return { ok: false, error: `상품판매상태 ${wanted} 버튼을 찾지 못했습니다.` };
    }
    return { ok: true };
  }

  async function handleA21(task, currentStage) {
    if (currentStage === "NAVIGATE_A21") {
      if (role() !== "A21") {
        return navigateMenu(task, "A21_SEARCH", /\[?21\]?\s*쇼핑몰상품수정|쇼핑몰상품수정/, "A21 쇼핑몰상품수정");
      }
      await stage(task, "A21_SEARCH", `${task.modelNo} A21 검색 준비`, true);
      return;
    }
    if (currentStage === "A21_SEARCH") {
      if (role() !== "A21") {
        return navigateMenu(task, "A21_SEARCH", /\[?21\]?\s*쇼핑몰상품수정|쇼핑몰상품수정/, "A21 쇼핑몰상품수정");
      }
      await stage(task, "A21_OPEN", `${task.modelNo} A21 검색 결과 대기`);
      const result = configureSearch("모델번호", task.modelNo || "");
      if (!result.ok) await finish(task, false, result.error);
      return;
    }
    if (currentStage === "A21_OPEN") {
      await sleep(500);
      const selected = selectRows(task.modelNo || task.barcode);
      if (!selected.rows.length || selected.checked <= 0) {
        await finish(task, false, `${task.modelNo || task.barcode} A21 전송행을 찾지 못했습니다.`);
        return;
      }
      const open = findClickable(/상품\s*수정전송/);
      if (!open) {
        await finish(task, false, "A21 상품 수정전송 버튼을 찾지 못했습니다.");
        return;
      }
      await stage(task, "A21_POPUP", `${task.barcode} 판매상태 송신 팝업 대기`);
      clickNode(open);
      return;
    }
    if (currentStage === "A21_POPUP") {
      if (role() !== "A21_POPUP") return;
      const configured = configureA21SaleState(task);
      if (!configured.ok) {
        await finish(task, false, configured.error);
        return;
      }
      const submit = findClickable(/상품수정\s*송신/);
      if (!submit) {
        await finish(task, false, "A21 상품수정 송신 버튼을 찾지 못했습니다.");
        return;
      }
      await stage(task, "A21_WAIT", `${task.barcode} 단품 ${targetKoreanState(task)} 전송 완료 대기`);
      clickNode(submit);
      return;
    }
    if (currentStage === "A21_WAIT") {
      const text = bodyText();
      if (/처리중입니다|잠시만\s*기다려주시기\s*바랍니다/.test(text)) return;
      if (/상품\s*수정\s*전송이\s*완료되었습니다/.test(text)) {
        const counts = resultCounts();
        await finish(
          task,
          counts.failure <= 0,
          counts.failure > 0
            ? `${task.barcode} 단품 판매상태 전송 완료 · 실패 ${counts.failure}건`
            : `${task.barcode} 단품 ${targetKoreanState(task)} 전송 완료`,
          counts,
        );
      }
    }
  }

  async function runAssignment(task, currentStage) {
    if (running || !task?.taskId) return;
    running = true;
    try {
      if (["NAVIGATE_A6", "A6_SEARCH", "A6_APPLY", "A6_VERIFY"].includes(currentStage)) {
        await handleA6(task, currentStage);
      } else if (["NAVIGATE_A22", "A22_SEARCH", "A22_SEND", "A22_WAIT"].includes(currentStage)) {
        await handleA22(task, currentStage);
      } else if (["NAVIGATE_A21", "A21_SEARCH", "A21_OPEN", "A21_POPUP", "A21_WAIT"].includes(currentStage)) {
        await handleA21(task, currentStage);
      }
    } catch (error) {
      await finish(task, false, String(error?.message || error || "Shopling 판매상태 자동화 예외"));
    } finally {
      running = false;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "COMMERCE_OS_STOCK_TASK_ASSIGNMENT") return false;
    sendResponse({ ok: true, role: role(), version: VERSION });
    void runAssignment(message.task, message.stage);
    return false;
  });

  async function bootstrap() {
    try {
      const state = await chrome.runtime.sendMessage({
        type: "COMMERCE_OS_STOCK_GET_ACTIVE",
        version: VERSION,
      });
      if (state?.active) await runAssignment(state.active, state.stage);
    } catch {
      // No active stock-state task.
    }
  }

  setTimeout(() => void bootstrap(), 150);
  window.addEventListener("load", () => setTimeout(() => void bootstrap(), 250), { once: true });
})();
