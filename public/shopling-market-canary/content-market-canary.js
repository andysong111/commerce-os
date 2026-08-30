(() => {
  "use strict";

  const VERSION = "0.1.2";
  const STATE_KEY = "commerceOsShoplingMarketCanaryStateV012";
  const CANARY_CLAIM_MESSAGE = "commerce-os-shopling-market-canary-claim";
  const CANARY_ARM_MESSAGE = "commerce-os-shopling-market-canary-arm";
  const CANARY_REPORT_MESSAGE = "commerce-os-shopling-market-canary-report";
  const PANEL_ID = "commerce-os-shopling-market-canary-panel";
  const STATUS_ID = `${PANEL_ID}-status`;
  const BUTTON_ID = `${PANEL_ID}-button`;
  const PROFILE = "도매1";
  const SEARCH_CODE = "DM1";
  const SUBMIT_CONFIRM_TIMEOUT_MS = 10000;

  let driving = false;
  let timer = null;

  function text(value) {
    return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  }

  function canonical(value) {
    return text(value).replace(/\s+/g, "").toUpperCase();
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

  function getState() {
    return new Promise((resolve) => {
      chrome.storage.local.get(STATE_KEY, (stored) => {
        void chrome.runtime.lastError;
        resolve(stored?.[STATE_KEY] || null);
      });
    });
  }

  function saveState(state) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STATE_KEY]: state }, () => {
        void chrome.runtime.lastError;
        resolve(state);
      });
    });
  }

  async function patchState(patch) {
    const current = await getState();
    if (!current) return null;
    const next = { ...current, ...patch, updatedAt: Date.now() };
    await saveState(next);
    return next;
  }

  function newRunId() {
    return `canary-v012-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function isProductListUi() {
    if (location.hostname !== "a.shopling.co.kr" || location.pathname.startsWith("/prodlinkage/")) return false;
    const body = bodyText();
    return /쇼핑몰\s*상품등록(?:하기)?/i.test(body)
      && /쇼핑몰\s*미등록\s*검색/i.test(body)
      && /총\s*조회수\s*[:：]?\s*[\d,]+\s*건/i.test(body);
  }

  function isIdChoicePage() {
    return location.hostname === "a.shopling.co.kr" && /\/prodlinkage\/goods_mallReg_idChoice\.phtml$/i.test(location.pathname);
  }

  function isPreProdChoicePage() {
    return location.hostname === "a.shopling.co.kr" && /\/prodlinkage\/goods_mallReg_preProdChoice\.phtml$/i.test(location.pathname);
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
    element.scrollIntoView({ block: "center", inline: "center" });
    element.click();
    return true;
  }

  function buttonText(element) {
    return text(element?.value || element?.innerText || element?.textContent || "");
  }

  function buttons(pattern) {
    return [...document.querySelectorAll('button, input[type="button"], input[type="submit"], a')]
      .filter((element) => visible(element) && !element.disabled)
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

  function findUnregisteredControls() {
    const heading = findTextElement(/^쇼핑몰\s*미등록\s*검색$/i)
      || findTextElement(/쇼핑몰\s*미등록\s*검색/i);
    if (!heading) return { ok: false, reason: "unregistered_heading_missing" };
    const rect = heading.getBoundingClientRect();
    const maxTop = rect.bottom + 95;
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

    const profileSelect = selects.find((select) => selectHas(select, /^도매1$/)) || null;
    const searchType = selects.find((select) => selectHas(select, /자사\s*상품\s*코드|자체\s*상품\s*코드|자사\s*코드/i))
      || selects.find((select) => /검색항목/i.test(optionText(select)))
      || null;
    const input = inputs.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0] || null;
    const searchButton = nearbyButtons
      .filter((element) => /^(검색|조회)$/i.test(buttonText(element)))
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0] || null;

    return { ok: true, heading, profileSelect, searchType, input, searchButton };
  }

  function exactProductRows(ptnGoodsCd) {
    const exact = canonical(ptnGoodsCd);
    return [...document.querySelectorAll("tr")]
      .filter((row) => row.querySelectorAll(":scope > td").length >= 3)
      .map((row) => ({
        row,
        label: canonical(row.innerText || row.textContent || ""),
        checkbox: row.querySelector('input[type="checkbox"]:not([disabled])'),
      }))
      .filter((entry) => entry.checkbox && visible(entry.checkbox) && entry.label.includes(exact));
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
    const candidates = [...document.querySelectorAll("select")]
      .filter(visible)
      .filter((select) => selectHas(select, new RegExp(`^${profile}$`)));
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
    return [...document.querySelectorAll('input[type="checkbox"]:checked:not([disabled])')]
      .filter(visible);
  }

  function topSelectButton() {
    return buttons(/^선택$/)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0] || null;
  }

  function applyPreProdMapping() {
    const required = [
      { name: "쇼핑몰별 상품판매가", pattern: /^쇼핑몰별\s*상품판매가$/ },
      { name: "상품설명", pattern: /^상품설명$/ },
      { name: "쇼핑몰별 상품명", pattern: /^쇼핑몰별\s*상품명$/ },
      { name: "검색어", pattern: /^검색어$/ },
      { name: "옵션명", pattern: /^옵션명$/ },
      { name: "매핑된 카테고리로 전송", pattern: /^매핑된\s*카테고리로\s*전송$/ },
      { name: "매핑없음 기본카테고리", pattern: /매핑된\s*카테고리가\s*없으시?.*무시하고.*쇼핑몰기본정보.*카테고리로\s*전송/i },
    ];
    const missing = [];
    for (const item of required) {
      if (!chooseRadio(item.pattern)) missing.push(item.name);
    }
    return { ok: missing.length === 0, missing };
  }

  function explicitSuccess() {
    const body = bodyText();
    return /상품\s*등록.{0,20}(완료|성공)|(?:송신|전송).{0,20}(완료|성공)|정상적으로.{0,20}(등록|전송|송신)/i.test(body);
  }

  async function reportAndFinish(state, outcome, reasonCode, message, status) {
    if (!state?.task?.goodsKey) return;
    const response = await sendMessage({
      type: CANARY_REPORT_MESSAGE,
      runId: state.runId,
      goodsKey: state.task.goodsKey,
      outcome,
      reasonCode,
      message,
    });
    const nextStatus = response?.ok ? status : "confirm_needed";
    await saveState({
      ...state,
      status: nextStatus,
      stage: nextStatus === "confirm_needed" ? "report_failed" : "finished",
      outcome: response?.ok ? outcome : "confirm_needed",
      reasonCode: response?.ok ? reasonCode : "durable_report_failed",
      message: response?.ok ? message : `Commerce OS 원장 기록 실패: ${text(response?.message || response?.error)}`,
      finishedAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  async function failPreSubmit(state, reasonCode, message) {
    if (["submit_armed", "submit_clicked"].includes(state?.stage)) {
      await reportAndFinish(state, "confirm_needed", reasonCode, message, "confirm_needed");
      return;
    }
    await reportAndFinish(state, "failed", reasonCode, message, "failed");
  }

  async function startCanary() {
    const existing = await getState();
    if (existing?.status === "running") return;
    const runId = newRunId();
    setPanelStatus("DM1→도매1 테스트 대상 1건을 확보 중입니다.", "info", true);
    const claim = await sendMessage({ type: CANARY_CLAIM_MESSAGE, runId });
    if (!claim?.ok) {
      setPanelStatus(`대상 확보 실패: ${text(claim?.message || claim?.error)}`, "error", false);
      return;
    }
    const task = claim.task;
    if (!task) {
      setPanelStatus("테스트 가능한 신규 DM1→도매1 대기건이 없습니다.", "success", false);
      return;
    }
    if (text(task.searchCode) !== SEARCH_CODE || text(task.profile) !== PROFILE || !text(task.ptnGoodsCd)) {
      const invalidState = { runId, task, stage: "guard_failed", status: "running" };
      await failPreSubmit(invalidState, "canary_mapping_guard_failed", "DM1→도매1 이외 작업이 반환되어 중단했습니다.");
      return;
    }
    await saveState({
      version: VERSION,
      runId,
      task,
      status: "running",
      stage: "claimed",
      startedAt: Date.now(),
      updatedAt: Date.now(),
      message: `${task.ptnGoodsCd} → 도매1 수동경로 복제 시작`,
    });
    void drive();
  }

  async function driveProductList(state) {
    if (state.stage === "claimed") {
      const controls = findUnregisteredControls();
      if (!controls.ok) {
        await failPreSubmit(state, controls.reason, "'쇼핑몰 미등록 검색' 영역을 찾지 못했습니다. 창은 닫지 않습니다.");
        return;
      }
      if (!controls.profileSelect) {
        await failPreSubmit(state, "unregistered_profile_missing", "쇼핑몰 미등록 검색에서 저장 그룹 '도매1'을 찾지 못했습니다.");
        return;
      }
      if (!setSelect(controls.profileSelect, /^도매1$/)) {
        await failPreSubmit(state, "unregistered_profile_apply_failed", "쇼핑몰 미등록 검색의 도매1 그룹 적용에 실패했습니다.");
        return;
      }
      if (controls.searchType && selectHas(controls.searchType, /자사\s*상품\s*코드|자체\s*상품\s*코드|자사\s*코드/i)) {
        setSelect(controls.searchType, /자사\s*상품\s*코드|자체\s*상품\s*코드|자사\s*코드/i);
      }
      if (!controls.input || !controls.searchButton) {
        await failPreSubmit(state, "unregistered_search_controls_missing", "쇼핑몰 미등록 검색의 검색어 입력칸/검색 버튼을 찾지 못했습니다.");
        return;
      }
      setInput(controls.input, state.task.ptnGoodsCd);
      await patchState({ stage: "unregistered_search_submitted", message: `${state.task.ptnGoodsCd} 도매1 미등록 조회` });
      click(controls.searchButton);
      return;
    }

    if (state.stage === "unregistered_search_submitted") {
      await sleep(700);
      const rows = exactProductRows(state.task.ptnGoodsCd);
      if (rows.length === 0) {
        await reportAndFinish(
          state,
          "already_registered",
          "no_exact_unregistered_product",
          `${state.task.ptnGoodsCd} 도매1 미등록 검색결과에 정확일치 상품이 없습니다. 재송신하지 않습니다.`,
          "completed",
        );
        return;
      }
      if (rows.length !== 1) {
        await failPreSubmit(state, "exact_product_row_ambiguous", `정확일치 상품행이 ${rows.length}개라 다른 상품을 건드리지 않고 중단했습니다.`);
        return;
      }
      if (!checkOnly(rows[0])) {
        await failPreSubmit(state, "exact_product_select_failed", "정확일치 상품 선택에 실패했습니다.");
        return;
      }
      const registerButton = buttons(/^(쇼핑몰\s*상품등록(?:하기)?|쇼핑몰\s*상품\s*등록(?:하기)?)$/i)[0]
        || buttons(/쇼핑몰\s*상품등록(?:하기)?/i)[0];
      if (!registerButton) {
        await failPreSubmit(state, "mall_register_button_missing", "'쇼핑몰 상품등록하기' 버튼을 찾지 못했습니다.");
        return;
      }
      await patchState({ stage: "register_clicked", message: "정확일치 1건 선택 · Shopling 등록 팝업 호출" });
      click(registerButton);
    }
  }

  async function driveIdChoice(state) {
    if (!["register_clicked", "id_profile_selected", "id_choice_ready"].includes(state.stage)) return;
    const select = savedProfileSelect(PROFILE);
    if (!select) {
      await failPreSubmit(state, "saved_profile_select_missing", "쇼핑몰 아이디 선택 화면에서 검색관리 '도매1'을 찾지 못했습니다. 이 팝업은 닫지 않습니다.");
      return;
    }
    if (optionText(select) !== PROFILE) {
      await patchState({ stage: "id_profile_selected", message: "쇼핑몰 아이디 선택 · 검색관리 도매1 적용" });
      setSelect(select, /^도매1$/);
      await sleep(800);
      return;
    }
    await sleep(500);
    const checked = checkedMallIds();
    if (!checked.length) {
      await failPreSubmit(state, "saved_profile_no_mall_ids", "검색관리 도매1 적용 후 선택된 쇼핑몰 ID가 0개입니다. 이 팝업은 닫지 않습니다.");
      return;
    }
    const selectButton = topSelectButton();
    if (!selectButton) {
      await failPreSubmit(state, "mall_id_select_button_missing", "쇼핑몰 아이디 선택 화면의 상단 '선택' 버튼을 찾지 못했습니다.");
      return;
    }
    await patchState({ stage: "id_choice_ready", message: `도매1 저장검색 · 쇼핑몰 ID ${checked.length}개 확인` });
    await patchState({ stage: "id_choice_submitted", message: "쇼핑몰 ID 선택 완료 · 연동정보 화면 이동" });
    click(selectButton);
  }

  async function drivePreProd(state) {
    if (!["id_choice_submitted", "pre_profile_selected", "pre_mapping_ready", "arming"].includes(state.stage)) return;
    const select = savedProfileSelect(PROFILE);
    if (!select) {
      await failPreSubmit(state, "preprod_saved_profile_missing", "쇼핑몰 연동 정보 화면에서 검색관리 '도매1'을 찾지 못했습니다. 이 팝업은 닫지 않습니다.");
      return;
    }
    if (optionText(select) !== PROFILE) {
      await patchState({ stage: "pre_profile_selected", message: "쇼핑몰 연동 정보 · 검색관리 도매1 적용" });
      setSelect(select, /^도매1$/);
      await sleep(800);
      return;
    }

    await sleep(500);
    const mapping = applyPreProdMapping();
    if (!mapping.ok) {
      await failPreSubmit(state, "mapping_controls_missing", `도매1 연동정보 중 다음 항목을 찾지 못했습니다: ${mapping.missing.join(", ")}`);
      return;
    }
    const sendButton = buttons(/^상품등록송신$/i)[0] || buttons(/상품\s*등록\s*송신/i)[0];
    if (!sendButton) {
      await failPreSubmit(state, "submit_button_missing", "'상품등록송신' 버튼을 찾지 못했습니다.");
      return;
    }

    await patchState({ stage: "pre_mapping_ready", message: "도매1 연동정보 7개 항목 검증 완료" });
    await patchState({ stage: "arming", message: "송신 직전 Commerce OS 영구잠금 확인" });
    const arm = await sendMessage({
      type: CANARY_ARM_MESSAGE,
      runId: state.runId,
      goodsKey: state.task.goodsKey,
    });
    if (!arm?.ok) {
      await failPreSubmit(state, "submit_lock_failed", `송신 잠금 실패: ${text(arm?.message || arm?.error)}`);
      return;
    }

    const latest = await getState();
    if (!latest || latest.runId !== state.runId || latest.status !== "running") return;
    await patchState({
      stage: "submit_clicked",
      submitArmedAt: Date.now(),
      submitClickedAt: Date.now(),
      message: "영구잠금 완료 · Shopling 상품등록송신 클릭",
    });
    click(sendButton);
  }

  async function checkSubmitOutcome(state) {
    if (state.stage !== "submit_clicked") return;
    if (explicitSuccess()) {
      await reportAndFinish(state, "sent", "shopling_submit_success", "Shopling 화면에서 상품등록/송신 완료를 확인했습니다.", "completed");
      return;
    }
    const age = Date.now() - Number(state.submitClickedAt || 0);
    if (age >= SUBMIT_CONFIRM_TIMEOUT_MS) {
      await reportAndFinish(
        state,
        "confirm_needed",
        "submit_result_requires_manual_check",
        "상품등록송신 클릭까지 도달했지만 자동 성공문구를 확인하지 못했습니다. 중복 재송신은 차단합니다.",
        "confirm_needed",
      );
    }
  }

  async function drive() {
    if (driving) return;
    driving = true;
    try {
      const state = await getState();
      updatePanelFromState(state);
      if (!state || state.status !== "running") return;

      if (state.stage === "submit_clicked") {
        await checkSubmitOutcome(state);
        return;
      }
      if (isIdChoicePage()) {
        await driveIdChoice(state);
        return;
      }
      if (isPreProdChoicePage()) {
        await drivePreProd(state);
        return;
      }
      if (isProductListUi()) {
        await driveProductList(state);
      }
    } catch (error) {
      const state = await getState();
      if (state?.status === "running") {
        await failPreSubmit(state, "canary_unhandled_exception", error instanceof Error ? error.message : String(error || "Canary 오류"));
      }
    } finally {
      driving = false;
    }
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
      button.textContent = busy ? "마켓 전송 1건 테스트 진행 중..." : "마켓 전송 1건 실전테스트 · DM1→도매1";
    }
  }

  function updatePanelFromState(state) {
    if (!document.getElementById(PANEL_ID) || !state) return;
    if (state.status === "running") {
      setPanelStatus(`${text(state.task?.ptnGoodsCd || "DM1")} → 도매1 · 현재 단계: ${text(state.stage)} · ${text(state.message)}`, "info", true);
    } else if (state.status === "completed" && state.outcome === "sent") {
      setPanelStatus("Canary 성공 · 수동 경로와 동일한 확장프로그램 Shopling→도매1 송신이 확인됐습니다.", "success", false);
    } else if (state.status === "completed" && state.outcome === "already_registered") {
      setPanelStatus("Canary 안전종료 · 도매1 미등록 검색에서 대상이 없어 재송신하지 않았습니다.", "success", false);
    } else if (state.status === "failed") {
      setPanelStatus(`Canary 송신 전 실패 · ${text(state.reasonCode)} · ${text(state.message)} · DB 대기열로 원복됨`, "error", false);
    } else if (state.status === "confirm_needed") {
      setPanelStatus(`Canary 확인필요 · ${text(state.reasonCode)} · ${text(state.message)} · 다시 누르지 마세요.`, "error", true);
    }
  }

  function mount() {
    if (!isProductListUi() || document.getElementById(PANEL_ID)) return;
    const box = document.createElement("div");
    box.id = PANEL_ID;
    box.style.cssText = [
      "position:fixed", "right:18px", "bottom:40px", "z-index:2147483647", "width:420px",
      "padding:12px", "border:2px solid #dc2626", "border-radius:10px", "background:#fff",
      "box-shadow:0 8px 30px rgba(15,23,42,.18)", "font:12px/1.45 Arial,sans-serif", "color:#0f172a",
    ].join(";");
    const title = document.createElement("div");
    title.textContent = `Commerce OS · 마켓 전송 1건 Canary v${VERSION}`;
    title.style.cssText = "font-weight:700;margin-bottom:5px;color:#991b1b";
    const guide = document.createElement("div");
    guide.textContent = "수동 성공 경로 그대로: 쇼핑몰 미등록 검색 → 상품등록하기 → 도매1 ID → 도매1 연동정보 → 상품등록송신";
    guide.style.cssText = "font-size:11px;color:#64748b;margin-bottom:7px";
    const status = document.createElement("div");
    status.id = STATUS_ID;
    status.textContent = "DM1→도매1 한 건만 테스트합니다. 다른 17건은 건드리지 않습니다.";
    status.style.cssText = "margin-bottom:8px;color:#475569";
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = "마켓 전송 1건 실전테스트 · DM1→도매1";
    button.style.cssText = "width:100%;padding:10px;border:0;border-radius:7px;background:#dc2626;color:#fff;font-weight:700;cursor:pointer";
    button.addEventListener("click", () => void startCanary());
    const guard = document.createElement("div");
    guard.textContent = "새 창을 임의 생성하지 않음 · Shopling 실제 팝업 경로 사용 · 송신 전 실패는 원복 · 송신잠금 이후 재시도 금지";
    guard.style.cssText = "font-size:10px;color:#7f1d1d;margin-top:7px";
    box.append(title, guide, status, button, guard);
    document.documentElement.appendChild(box);
    void getState().then(updatePanelFromState);
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[STATE_KEY]) return;
    updatePanelFromState(changes[STATE_KEY].newValue || null);
    void drive();
  });

  mount();
  const observer = new MutationObserver(() => {
    mount();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  timer = setInterval(() => void drive(), 1000);
  void drive();

  window.addEventListener("pagehide", () => {
    if (timer) clearInterval(timer);
  }, { once: true });
})();
