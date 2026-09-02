(() => {
  const VERSION = "0.1.9";
  const CLAIM_MESSAGE = "A21_POPUP_CLAIM_V016";
  const TARGET_PATH = "/prodlinkage/goods_mallMdfy_trsmt.phtml";
  const GENERAL_NAMES = [
    "trsmt_env_mody_item_nm",
    "trsmt_env_mody_price",
    "trsmt_env_mody_ctg",
    "trsmt_env_mody_img",
    "trsmt_env_mody_fee",
    "trsmt_env_mody_desc",
    "trsmt_env_mody_keyword",
    "trsmt_env_mody_paysvc",
    "trsmt_env_mody_dlvyinfo",
  ];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalize = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const bodyText = () => normalize(document.body?.innerText || document.body?.textContent || "");
  const isExactPopupUrl = () => String(location.pathname || "").toLowerCase() === TARGET_PATH.toLowerCase();
  let activeAssignment = null;
  let busy = false;

  function resultEvidence() {
    const text = bodyText();
    return /성공건수|실패건수|성공여부|수정\s*전송\s*결과|상품\s*등록\s*전송\s*결과|정상적으로.*처리/i.test(text);
  }

  function role() {
    if (resultEvidence()) return "A21_RESULT";
    if (isExactPopupUrl()) return "A21_POPUP";
    return "OTHER";
  }

  function radios(name) {
    return [...document.querySelectorAll('input[type="radio"]')].filter((item) => item.name === name);
  }

  function exactRadio(name, value) {
    return radios(name).find((item) => String(item.value ?? "") === String(value ?? "")) || null;
  }

  function selectRadio(name, value, { click = false } = {}) {
    const target = exactRadio(name, value);
    if (!(target instanceof HTMLInputElement) || target.type !== "radio" || target.disabled) return false;
    const peers = radios(name);
    if (click) {
      if (!target.checked) target.click();
    } else {
      for (const peer of peers) peer.checked = peer === target;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return target.checked && peers.every((peer) => peer === target || !peer.checked);
  }

  function verifyRadio(name, value) {
    const target = exactRadio(name, value);
    return Boolean(target?.checked) && radios(name).every((item) => item === target || !item.checked);
  }

  function hiddenValues(name) {
    return [...document.querySelectorAll('input[type="hidden"]')]
      .filter((item) => item.name === name)
      .map((item) => String(item.value ?? ""));
  }

  async function chooseMode(value) {
    if (!selectRadio("modify_tp", value, { click: true })) return false;
    await sleep(120);
    return verifyRadio("modify_tp", value);
  }

  async function configurePrice() {
    if (!await chooseMode("goods_normal")) {
      return { ok: false, code: "V019_PRICE_MODE", message: "modify_tp=goods_normal 선택에 실패했습니다." };
    }

    const priceSource = hiddenValues("tsmt_sale_price_tp");
    if (!priceSource.length || priceSource.some((value) => value !== "J")) {
      return { ok: false, code: "V019_PRICE_SOURCE_NOT_MALL", message: `쇼핑몰별판매가 전송값(tsmt_sale_price_tp=J)이 아닙니다: ${priceSource.join(",") || "없음"}` };
    }

    for (const name of GENERAL_NAMES) {
      const expected = name === "trsmt_env_mody_price" ? "Y" : "";
      if (!selectRadio(name, expected)) {
        return { ok: false, code: "V019_GENERAL_FIELD_SELECT", message: `${name}=${expected || "(blank)"} 선택에 실패했습니다.` };
      }
    }

    const wrong = GENERAL_NAMES.filter((name) => {
      const expected = name === "trsmt_env_mody_price" ? "Y" : "";
      return !verifyRadio(name, expected);
    });
    if (!verifyRadio("modify_tp", "goods_normal") || wrong.length) {
      return { ok: false, code: "V019_PRICE_VERIFY", message: `판매가 단독 수정 검증 실패: ${wrong.join(",") || "modify_tp"}` };
    }
    return { ok: true };
  }

  async function configureOption() {
    if (!await chooseMode("goods_stock")) {
      return { ok: false, code: "V019_OPTION_MODE", message: "modify_tp=goods_stock 선택에 실패했습니다." };
    }
    if (!selectRadio("trsmt_env_mody_opt", "1")) {
      return { ok: false, code: "V019_OPTION_SELECT", message: "trsmt_env_mody_opt=1(옵션송신) 선택에 실패했습니다." };
    }
    if (!verifyRadio("modify_tp", "goods_stock") || !verifyRadio("trsmt_env_mody_opt", "1")) {
      return { ok: false, code: "V019_OPTION_VERIFY", message: "옵션송신 단독 상태 검증에 실패했습니다." };
    }
    return { ok: true };
  }

  function exactSubmitButton() {
    return [...document.querySelectorAll('input[type="button"]')].find((item) =>
      normalize(item.value) === "상품수정 송신" && /goods_mallMdfy_submit_sp\s*\(/.test(item.getAttribute("onclick") || ""),
    ) || null;
  }

  function verifyPayloadExists() {
    const joined = [...document.querySelectorAll('input[type="hidden"]')].filter((item) => item.name === "prod_join_chk[]");
    return joined.length > 0 && joined.every((item) => /^\d+$/.test(String(item.value || "")));
  }

  async function fail(jobId, code, message) {
    await chrome.runtime.sendMessage({ type: "A21_JOB_FAILURE", jobId, code, message }).catch(() => null);
  }

  async function stage(jobId, nextStage, message) {
    await chrome.runtime.sendMessage({ type: "A21_STAGE", jobId, stage: nextStage, message }).catch(() => null);
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
        await fail(assignment.jobId, "V019_RESULT_FAILURE", `Shopling 결과 실패 ${failure || 1}건`);
        return;
      }
      if (success > 0 || /성공여부\s*[:：]?\s*성공/i.test(text) || /정상적으로.*처리/i.test(text)) {
        await chrome.runtime.sendMessage({
          type: "A21_JOB_SUCCESS",
          jobId: assignment.jobId,
          message: `${assignment.mode === "PRICE" ? "판매가" : "옵션"} 수정전송 성공 확인`,
        }).catch(() => null);
        return;
      }
      await sleep(750);
    }
    await fail(assignment.jobId, "V019_RESULT_TIMEOUT", "상품수정 송신 후 결과를 180초 동안 확인하지 못했습니다.");
  }

  async function configureAndSubmit(assignment) {
    if (busy) return;
    busy = true;
    activeAssignment = assignment;
    try {
      if (!isExactPopupUrl()) {
        await fail(assignment.jobId, "V019_POPUP_URL", `예상 송신 URL이 아닙니다: ${location.href}`);
        return;
      }
      if (!verifyPayloadExists()) {
        await fail(assignment.jobId, "V019_PAYLOAD_MISSING", "prod_join_chk[] 전송대상 식별값이 없어 송신을 차단했습니다.");
        return;
      }

      const configured = assignment.mode === "PRICE" ? await configurePrice() : await configureOption();
      if (!configured.ok) {
        await fail(assignment.jobId, configured.code, configured.message);
        return;
      }
      await stage(assignment.jobId, "POPUP_CONFIG", `${assignment.mode === "PRICE" ? "판매가" : "옵션"} 실제 Shopling form 값 검증 완료`);
      await sleep(180);

      const recheck = assignment.mode === "PRICE" ? await configurePrice() : await configureOption();
      if (!recheck.ok) {
        await fail(assignment.jobId, "V019_PRE_SUBMIT_RECHECK", `송신 직전 상태 재검증 실패: ${recheck.message}`);
        return;
      }

      const button = exactSubmitButton();
      if (!button) {
        await fail(assignment.jobId, "V019_SUBMIT_NOT_FOUND", "onclick=goods_mallMdfy_submit_sp() 상품수정 송신 버튼을 찾지 못했습니다.");
        return;
      }
      await stage(assignment.jobId, "SUBMIT_CLICKED", `${assignment.mode === "PRICE" ? "판매가" : "옵션"} · 상품수정 송신 클릭`);
      button.click();
      await stage(assignment.jobId, "RESULT_WAIT", "Shopling 수정전송 결과 확인 중");
      await sleep(650);
      if (resultEvidence()) void waitForResult(assignment);
    } finally {
      busy = false;
    }
  }

  async function claimAndRun() {
    const currentRole = role();
    if (currentRole === "OTHER") return;
    const claim = await chrome.runtime.sendMessage({ type: CLAIM_MESSAGE, role: currentRole, href: location.href, version: VERSION }).catch(() => null);
    const assignment = claim?.assignment;
    if (!claim?.ok || !assignment?.jobId) return;
    activeAssignment = assignment;
    if (currentRole === "A21_RESULT") return waitForResult(assignment);
    return configureAndSubmit(assignment);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    void (async () => {
      try {
        if (message?.type === "A21_IDENTIFY") {
          sendResponse({ ok: true, role: role(), version: VERSION });
          return;
        }
        if (message?.type === "A21_POPUP_ASSIGNMENT") {
          sendResponse({ ok: true, accepted: true, version: VERSION });
          if (!activeAssignment || activeAssignment.jobId !== message.jobId) activeAssignment = message;
          await configureAndSubmit(message);
          return;
        }
        if (message?.type === "A21_POPUP_RESULT_ASSIGNMENT") {
          sendResponse({ ok: true, accepted: true, version: VERSION });
          activeAssignment = message;
          await waitForResult(message);
          return;
        }
        sendResponse({ ok: false, error: "unsupported_message" });
      } catch (error) {
        if (message?.jobId) await fail(message.jobId, "V019_CONTENT_EXCEPTION", error instanceof Error ? error.message : String(error));
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  });

  setTimeout(() => void claimAndRun(), 120);
  window.addEventListener("load", () => setTimeout(() => void claimAndRun(), 180), { once: true });
})();
