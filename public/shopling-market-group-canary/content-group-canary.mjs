(() => {
  "use strict";

  const VERSION = "0.2.0";
  const STATE_KEY = "commerceOsShoplingMarketGroupCanaryV020";
  const CLAIM_MESSAGE = "commerce-os-shopling-group-canary-claim";
  const ARM_MESSAGE = "commerce-os-shopling-group-canary-arm";
  const REPORT_MESSAGE = "commerce-os-shopling-group-canary-report";
  const PANEL_ID = "commerce-os-shopling-market-group-canary-panel";
  const STATUS_ID = `${PANEL_ID}-status`;
  const BUTTON_ID = `${PANEL_ID}-button`;
  const SUBMIT_CONFIRM_TIMEOUT_MS = 20000;

  let driving = false;
  let timer = null;

  function text(value) {
    return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  }

  function canonical(value) {
    return text(value).replace(/\s+/g, "").toUpperCase();
  }

  function escapeRegex(value) {
    return text(value).replace(/[|\\{}()[\]^$+*?.-]/g, "\\$&");
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

  function isIdChoicePage() {
    return location.hostname === "a.shopling.co.kr" && /\/prodlinkage\/goods_mallReg_idChoice\.phtml$/i.test(location.pathname);
  }

  function isPreProdChoicePage() {
    return location.hostname === "a.shopling.co.kr" && /\/prodlinkage\/goods_mallReg_preProdChoice\.phtml$/i.test(location.pathname);
  }

  function isProductListUi() {
    if (location.hostname !== "a.shopling.co.kr") return false;
    if (isIdChoicePage() || isPreProdChoicePage()) return false;
    const body = bodyText();
    return /쇼핑몰\s*상품등록(?:하기)?/i.test(body)
      && /쇼핑몰\s*미등록\s*검색/i.test(body)
      && /총\s*조회수\s*[:：]?\s*[\d,]+\s*건/i.test(body);
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

  function currentTask(state) {
    const tasks = Array.isArray(state?.tasks) ? state.tasks : [];
    const index = Number(state?.index || 0);
    return tasks[index] || null;
  }

  function newRunId() {
    return `canary-group-v020-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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

  function findUnregisteredControls(profile) {
    const heading = findTextElement(/^쇼핑몰\s*미등록\s*검색$/i)
      || findTextElement(/쇼핑몰\s*미등록\s*검색/i);
    if (!heading) return { ok: false, reason: "unregistered_heading_missing" };
    const rect = heading.getBoundingClientRect();
    const maxTop = rect.bottom + 105;
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
    const profilePattern = new RegExp(`^${escapeRegex(profile)}$`);
    const profileSelect = selects.find((select) => selectHas(select, profilePattern)) || null;
    const searchType = selects.find((select) => selectHas(select, /자사\s*상품\s*코드|자체\s*상품\s*코드|자사\s*코드/i))
      || selects.find((select) => /검색항목/i.test(optionText(select)))
      || null;
    const input = inputs.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0] || null;
    const searchButton = nearbyButtons
      .filter((element) => /^(검색|조회)$/i.test(buttonText(element)))
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0] || null;
    return { ok: true, heading, profileSelect, searchType, input, searchButton };
  }

  function rowMatchesExactIdentity(row, task) {
    const label = text(row?.innerText || row?.textContent || "");
    const code = text(task?.ptnGoodsCd);
    const goodsKey = text(task?.goodsKey);
    if (!code || !/^\d{5,9}$/.test(goodsKey)) return false;
    const codePattern = new RegExp(`(?:^|[^A-Z0-9_])${escapeRegex(code)}(?:[^A-Z0-9_]|$)`, "i");
    const goodsKeyPattern = new RegExp(`(?:^|\\D)${escapeRegex(goodsKey)}(?:\\D|$)`);
    return codePattern.test(label) && goodsKeyPattern.test(label);
  }

  function exactProductRows(task) {
    return [...document.querySelectorAll("tr")]
      .filter((row) => row.querySelectorAll(":scope > td").length >= 3)
      .map((row) => ({
        row,
        checkbox: row.querySelector('input[type="checkbox"]:not([disabled])'),
      }))
      .filter((entry) => entry.checkbox && visible(entry.checkbox) && rowMatchesExactIdentity(entry.row, task));
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
    const profilePattern = new RegExp(`^${escapeRegex(profile)}$`);
    const candidates = [...document.querySelectorAll("select")]
      .filter(visible)
      .filter((select) => selectHas(select, profilePattern));
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
    return [...document.querySelectorAll('input[type="checkbox"]:checked:not([disabled])')].filter(visible);
  }

  function topSelectButton() {
    return buttons(/^선택$/).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0] || null;
  }

  function applyPreProdMapping() {
    const required = [
      { name: "쇼핑몰별 상품판매가", pattern: /^쇼핑몰별\s*상품판매가$/ },
      { name: "상품설명", pattern: /^상품설명$/ },
      { name: "쇼핑몰별 상품명", pattern: /^쇼핑몰별\s*상품명$/ },
      { name: "검색어", pattern: /^검색어$/ },
      { name: "옵션명", pattern: /^옵션명$/ },
      { name: "매핑된 카테고리로 전송", pattern: /^매핑된\s*카테고리로\s*전송$/ },
      { name: "매핑없음 기본카테고리", pattern: /무시하고.*쇼핑몰기본정보.*카테고리로\s*전송/i },
    ];
    const missing = [];
    for (const item of required) {
      if (!chooseRadio(item.pattern)) missing.push(item.name);
    }
    return { ok: missing.length === 0, missing };
  }

  function submitEvidence() {
    const body = bodyText();
    const successCounts = [...body.matchAll(/성공건수\s*[:：]?\s*([\d,]+)/g)]
      .map((match) => Number(match[1].replace(/,/g, "")) || 0);
    const failureCounts = [...body.matchAll(/실패건수\s*[:：]?\s*([\d,]+)/g)]
      .map((match) => Number(match[1].replace(/,/g, "")) || 0);
    const resultLike = /상품\s*등록.{0,20}(결과|완료|성공)|등록\s*중\s*전송\s*결과/i.test(body);
    const success = resultLike && (successCounts.some((value) => value > 0) || /성공여부\s*성공/i.test(body));
    const failure = resultLike && (failureCounts.some((value) => value > 0) || /성공여부\s*실패/i.test(body));
    return { success: success && !failure, failure };
  }

  async function releaseTasks(state, fromIndex, reasonCode, message) {
    const tasks = Array.isArray(state?.tasks) ? state.tasks : [];
    let allOk = true;
    for (let index = fromIndex; index < tasks.length; index += 1) {
      const task = tasks[index];
      const response = await sendMessage({
        type: REPORT_MESSAGE,
        runId: state.runId,
        goodsKey: task.goodsKey,
        outcome: "failed",
        reasonCode,
        message,
      });
      if (!response?.ok) allOk = false;
    }
    return allOk;
  }

  async function reportAndAdvance(state, outcome, reasonCode, message) {
    const task = currentTask(state);
    if (!task) return;
    const response = await sendMessage({
      type: REPORT_MESSAGE,
      runId: state.runId,
      goodsKey: task.goodsKey,
      outcome,
      reasonCode,
      message,
    });
    if (!response?.ok) {
      await saveState({
        ...state,
        status: "confirm_needed",
        stage: "report_failed",
        message: `Commerce OS 원장 기록 실패: ${text(response?.message || response?.error)}`,
        updatedAt: Date.now(),
      });
      return;
    }
    const results = Array.isArray(state.results) ? [...state.results] : [];
    results.push({
      goodsKey: task.goodsKey,
      ptnGoodsCd: task.ptnGoodsCd,
      profile: task.profile,
      outcome,
      reasonCode,
    });
    const nextIndex = Number(state.index || 0) + 1;
    if (nextIndex >= state.tasks.length) {
      await saveState({
        ...state,
        results,
        index: nextIndex,
        status: "completed",
        stage: "finished",
        message: `1상품 검증 완료 · ${results.length}개 채널 종료`,
        finishedAt: Date.now(),
        updatedAt: Date.now(),
      });
    } else {
      const nextTask = state.tasks[nextIndex];
      await saveState({
        ...state,
        results,
        index: nextIndex,
        status: "running",
        stage: "claimed",
        submitClickedAt: 0,
        message: `${nextTask.ptnGoodsCd} → ${nextTask.profile} 다음 채널 시작`,
        updatedAt: Date.now(),
      });
    }
    if (!isProductListUi() && window.top === window) {
      setTimeout(() => {
        try { window.close(); } catch { /* best effort */ }
      }, 350);
    }
  }

  async function failAndStop(state, reasonCode, message) {
    const task = currentTask(state);
    if (!task) return;
    if (["submit_armed", "submit_clicked"].includes(state.stage)) {
      const response = await sendMessage({
        type: REPORT_MESSAGE,
        runId: state.runId,
        goodsKey: task.goodsKey,
        outcome: "confirm_needed",
        reasonCode,
        message,
      });
      await saveState({
        ...state,
        status: "confirm_needed",
        stage: "stopped_after_submit_boundary",
        message: response?.ok ? message : `송신경계 이후 원장기록도 확인필요: ${text(response?.message || response?.error)}`,
        updatedAt: Date.now(),
      });
      return;
    }
    const currentRelease = await sendMessage({
      type: REPORT_MESSAGE,
      runId: state.runId,
      goodsKey: task.goodsKey,
      outcome: "failed",
      reasonCode,
      message,
    });
    const remainingReleased = await releaseTasks(
      state,
      Number(state.index || 0) + 1,
      "group_canary_aborted_unstarted",
      "앞선 채널 검증이 송신 전에 중단되어 아직 시작하지 않은 채널을 원복했습니다.",
    );
    await saveState({
      ...state,
      status: currentRelease?.ok && remainingReleased ? "failed" : "confirm_needed",
      stage: "stopped",
      message: currentRelease?.ok && remainingReleased
        ? `${message} · 현재/미시작 채널은 대기열로 원복했습니다.`
        : `${message} · 일부 원복 결과를 확인해야 합니다. 다시 실행하지 마세요.`,
      updatedAt: Date.now(),
    });
  }

  async function startGroupCanary() {
    const existing = await getState();
    if (existing?.status === "running") return;
    const runId = newRunId();
    setPanelStatus("Commerce OS 원장에서 신규상품 1개를 확보 중입니다.", "info", true);
    const claim = await sendMessage({ type: CLAIM_MESSAGE, runId });
    if (!claim?.ok) {
      setPanelStatus(`대상 확보 실패: ${text(claim?.message || claim?.error)}`, "error", false);
      return;
    }
    const tasks = Array.isArray(claim.tasks) ? claim.tasks : [];
    if (!tasks.length) {
      setPanelStatus("검증 가능한 신규상품 채널 대기건이 없습니다.", "success", false);
      return;
    }
    const first = tasks[0];
    await saveState({
      version: VERSION,
      runId,
      tasks,
      index: 0,
      results: [],
      status: "running",
      stage: "claimed",
      startedAt: Date.now(),
      updatedAt: Date.now(),
      message: `1상품 ${tasks.length}개 남은 채널 확보 · ${first.ptnGoodsCd} → ${first.profile} 시작`,
    });
    void drive();
  }

  async function driveProductList(state) {
    const task = currentTask(state);
    if (!task) return;
    if (state.stage === "claimed") {
      const controls = findUnregisteredControls(task.profile);
      if (!controls.ok) {
        await failAndStop(state, controls.reason, "'쇼핑몰 미등록 검색' 영역을 찾지 못했습니다.");
        return;
      }
      const profilePattern = new RegExp(`^${escapeRegex(task.profile)}$`);
      if (!controls.profileSelect || !setSelect(controls.profileSelect, profilePattern)) {
        await failAndStop(state, "unregistered_profile_apply_failed", `쇼핑몰 미등록 검색의 ${task.profile} 그룹 적용에 실패했습니다.`);
        return;
      }
      if (controls.searchType && selectHas(controls.searchType, /자사\s*상품\s*코드|자체\s*상품\s*코드|자사\s*코드/i)) {
        setSelect(controls.searchType, /자사\s*상품\s*코드|자체\s*상품\s*코드|자사\s*코드/i);
      }
      if (!controls.input || !controls.searchButton) {
        await failAndStop(state, "unregistered_search_controls_missing", "쇼핑몰 미등록 검색의 입력칸/검색 버튼을 찾지 못했습니다.");
        return;
      }
      setInput(controls.input, task.ptnGoodsCd);
      await patchState({ stage: "unregistered_search_submitted", message: `${task.ptnGoodsCd} · ${task.profile} 미등록 조회` });
      click(controls.searchButton);
      return;
    }

    if (state.stage === "unregistered_search_submitted") {
      await sleep(700);
      const rows = exactProductRows(task);
      if (rows.length === 0) {
        await reportAndAdvance(
          state,
          "already_registered",
          "no_exact_unregistered_identity",
          `${task.goodsKey} + ${task.ptnGoodsCd}는 ${task.profile} 미등록 검색에 없어 재송신하지 않습니다.`,
        );
        return;
      }
      if (rows.length !== 1) {
        await failAndStop(
          state,
          "exact_product_identity_ambiguous",
          `${task.goodsKey} + ${task.ptnGoodsCd} 동시 정확일치 행이 ${rows.length}개라 중단했습니다.`,
        );
        return;
      }
      if (!checkOnly(rows[0])) {
        await failAndStop(state, "exact_product_select_failed", "상품번호+자사상품코드 정확일치 행 선택에 실패했습니다.");
        return;
      }
      const registerButton = buttons(/^(쇼핑몰\s*상품등록(?:하기)?|쇼핑몰\s*상품\s*등록(?:하기)?)$/i)[0]
        || buttons(/쇼핑몰\s*상품등록(?:하기)?/i)[0];
      if (!registerButton) {
        await failAndStop(state, "mall_register_button_missing", "'쇼핑몰 상품등록하기' 버튼을 찾지 못했습니다.");
        return;
      }
      await patchState({ stage: "register_clicked", message: `${task.goodsKey} + ${task.ptnGoodsCd} 정확일치 · 등록 팝업 호출` });
      click(registerButton);
    }
  }

  async function driveIdChoice(state) {
    const task = currentTask(state);
    if (!task || !["register_clicked", "id_profile_selected", "id_choice_ready"].includes(state.stage)) return;
    const profilePattern = new RegExp(`^${escapeRegex(task.profile)}$`);
    const select = savedProfileSelect(task.profile);
    if (!select) {
      await failAndStop(state, "saved_profile_select_missing", `쇼핑몰 ID 선택 화면에서 검색관리 '${task.profile}'을 찾지 못했습니다.`);
      return;
    }
    if (optionText(select) !== task.profile) {
      await patchState({ stage: "id_profile_selected", message: `쇼핑몰 ID 선택 · ${task.profile} 저장검색 적용` });
      setSelect(select, profilePattern);
      await sleep(800);
      return;
    }
    await sleep(500);
    const checked = checkedMallIds();
    if (!checked.length) {
      await failAndStop(state, "saved_profile_no_mall_ids", `${task.profile} 적용 후 선택된 쇼핑몰 ID가 0개입니다.`);
      return;
    }
    const selectButton = topSelectButton();
    if (!selectButton) {
      await failAndStop(state, "mall_id_select_button_missing", "쇼핑몰 ID 선택 화면의 상단 '선택' 버튼을 찾지 못했습니다.");
      return;
    }
    await patchState({ stage: "id_choice_ready", message: `${task.profile} 저장검색 · 쇼핑몰 ID ${checked.length}개 확인` });
    await patchState({ stage: "id_choice_submitted", message: "쇼핑몰 ID 선택 완료 · 연동정보 화면 이동" });
    click(selectButton);
  }

  async function drivePreProd(state) {
    const task = currentTask(state);
    if (!task || !["id_choice_submitted", "pre_profile_selected", "pre_mapping_ready", "arming"].includes(state.stage)) return;
    const profilePattern = new RegExp(`^${escapeRegex(task.profile)}$`);
    const select = savedProfileSelect(task.profile);
    if (!select) {
      await failAndStop(state, "preprod_saved_profile_missing", `쇼핑몰 연동 정보 화면에서 검색관리 '${task.profile}'을 찾지 못했습니다.`);
      return;
    }
    if (optionText(select) !== task.profile) {
      await patchState({ stage: "pre_profile_selected", message: `쇼핑몰 연동 정보 · ${task.profile} 저장검색 적용` });
      setSelect(select, profilePattern);
      await sleep(800);
      return;
    }
    await sleep(500);
    const mapping = applyPreProdMapping();
    if (!mapping.ok) {
      await failAndStop(state, "mapping_controls_missing", `${task.profile} 연동정보 중 누락: ${mapping.missing.join(", ")}`);
      return;
    }
    const sendButton = buttons(/^상품등록송신$/i)[0] || buttons(/상품\s*등록\s*송신/i)[0];
    if (!sendButton) {
      await failAndStop(state, "submit_button_missing", "'상품등록송신' 버튼을 찾지 못했습니다.");
      return;
    }
    await patchState({ stage: "pre_mapping_ready", message: `${task.profile} 연동정보 7개 항목 검증 완료` });
    await patchState({ stage: "arming", message: "송신 직전 Commerce OS 영구잠금 확인" });
    const arm = await sendMessage({ type: ARM_MESSAGE, runId: state.runId, goodsKey: task.goodsKey });
    if (!arm?.ok) {
      await failAndStop(state, "submit_lock_failed", `송신 잠금 실패: ${text(arm?.message || arm?.error)}`);
      return;
    }
    const latest = await getState();
    if (!latest || latest.runId !== state.runId || latest.status !== "running") return;
    await patchState({
      stage: "submit_clicked",
      submitArmedAt: Date.now(),
      submitClickedAt: Date.now(),
      message: `${task.profile} 영구잠금 완료 · Shopling 상품등록송신 클릭`,
    });
    click(sendButton);
  }

  async function checkSubmitOutcome(state) {
    if (state.stage !== "submit_clicked") return;
    const task = currentTask(state);
    if (!task) return;
    const evidence = submitEvidence();
    if (evidence.success) {
      await reportAndAdvance(
        state,
        "sent",
        "shopling_submit_success",
        `${task.profile} Shopling 결과 화면에서 성공건수>0, 실패건수=0을 확인했습니다.`,
      );
      return;
    }
    if (evidence.failure) {
      await failAndStop(
        state,
        "shopling_submit_result_has_failure",
        `${task.profile} 송신 결과에 실패건수가 있어 재송신하지 않고 확인필요로 중단합니다.`,
      );
      return;
    }
    const age = Date.now() - Number(state.submitClickedAt || 0);
    if (age >= SUBMIT_CONFIRM_TIMEOUT_MS) {
      await failAndStop(
        state,
        "submit_result_requires_manual_check",
        `${task.profile} 상품등록송신 클릭 후 ${SUBMIT_CONFIRM_TIMEOUT_MS / 1000}초 동안 성공결과를 확인하지 못했습니다.`,
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
        if (isProductListUi() || isIdChoicePage() || isPreProdChoicePage()) return;
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
      if (isProductListUi()) await driveProductList(state);
    } catch (error) {
      const state = await getState();
      if (state?.status === "running") {
        await failAndStop(state, "group_canary_unhandled_exception", error instanceof Error ? error.message : String(error || "Group Canary 오류"));
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
      button.textContent = busy ? "1상품 채널 검증 진행 중..." : "신규상품 1개 · 남은 채널 실전검증";
    }
  }

  function updatePanelFromState(state) {
    if (!document.getElementById(PANEL_ID) || !state) return;
    const task = currentTask(state);
    const total = Array.isArray(state.tasks) ? state.tasks.length : 0;
    const done = Array.isArray(state.results) ? state.results.length : 0;
    if (state.status === "running") {
      setPanelStatus(
        `${done}/${total} 완료 · ${text(task?.ptnGoodsCd)} → ${text(task?.profile)} · ${text(state.stage)} · ${text(state.message)}`,
        "info",
        true,
      );
    } else if (state.status === "completed") {
      const sent = (state.results || []).filter((row) => row.outcome === "sent").length;
      const skipped = (state.results || []).filter((row) => row.outcome === "already_registered").length;
      setPanelStatus(`1상품 검증 완료 · 송신 ${sent} · 이미등록/미등록없음 ${skipped}`, "success", false);
    } else if (state.status === "failed") {
      setPanelStatus(`송신 전 안전중단 · ${text(state.message)}`, "error", false);
    } else if (state.status === "confirm_needed") {
      setPanelStatus(`확인필요 · ${text(state.message)} · 다시 누르지 마세요.`, "error", true);
    }
  }

  function mount() {
    if (!isProductListUi() || document.getElementById(PANEL_ID)) return;
    const box = document.createElement("div");
    box.id = PANEL_ID;
    box.style.cssText = [
      "position:fixed", "right:18px", "bottom:40px", "z-index:2147483647", "width:430px",
      "padding:12px", "border:2px solid #b45309", "border-radius:10px", "background:#fff",
      "box-shadow:0 8px 30px rgba(15,23,42,.18)", "font:12px/1.45 Arial,sans-serif", "color:#0f172a",
    ].join(";");
    const title = document.createElement("div");
    title.textContent = `Commerce OS · 1상품 채널 검증 Canary v${VERSION}`;
    title.style.cssText = "font-weight:700;margin-bottom:5px;color:#92400e";
    const guide = document.createElement("div");
    guide.textContent = "신규상품 1개만 확보 → 완료채널 제외 → 남은 DM/SM 채널을 1건씩 순차 송신";
    guide.style.cssText = "font-size:11px;color:#64748b;margin-bottom:7px";
    const status = document.createElement("div");
    status.id = STATUS_ID;
    status.textContent = "버튼을 누르면 원장에서 1상품만 잡습니다. 상품번호+자사상품코드가 모두 맞아야 송신합니다.";
    status.style.cssText = "margin-bottom:8px;color:#475569";
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = "신규상품 1개 · 남은 채널 실전검증";
    button.style.cssText = "width:100%;padding:10px;border:0;border-radius:7px;background:#d97706;color:#fff;font-weight:700;cursor:pointer";
    button.addEventListener("click", () => void startGroupCanary());
    const guard = document.createElement("div");
    guard.textContent = "순차 1건씩 · goods_key+자사상품코드 이중일치 · 미등록 재확인 · 송신 전 영구잠금 · 송신 전 실패는 원복";
    guard.style.cssText = "font-size:10px;color:#92400e;margin-top:7px";
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
  const observer = new MutationObserver(() => mount());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  timer = setInterval(() => void drive(), 1000);
  void drive();

  window.addEventListener("pagehide", () => {
    if (timer) clearInterval(timer);
  }, { once: true });
})();
