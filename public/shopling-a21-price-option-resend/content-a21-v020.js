(() => {
  const VERSION = "0.2.0";
  const CLAIM_MESSAGE = "A21_POPUP_CLAIM_V020";
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
  let busy = false;
  let activeAssignment = null;

  function overlay() {
    let node = document.getElementById("commerce-os-a21-v020-status");
    if (node) return node;
    node = document.createElement("div");
    node.id = "commerce-os-a21-v020-status";
    node.style.cssText = "position:fixed;right:12px;top:12px;z-index:2147483647;max-width:360px;padding:10px 12px;border-radius:10px;background:#0f172a;color:#fff;font:12px/1.4 Arial,sans-serif;box-shadow:0 8px 24px rgba(15,23,42,.25)";
    node.textContent = "Commerce OS v0.2.0 · 송신 작업 연결 대기";
    document.documentElement.appendChild(node);
    return node;
  }

  function status(text, tone = "dark") {
    const node = overlay();
    node.textContent = `Commerce OS v0.2.0 · ${text}`;
    node.style.background = tone === "ok" ? "#047857" : tone === "bad" ? "#b91c1c" : tone === "warn" ? "#b45309" : "#0f172a";
  }

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

  async function selectRadio(name, value) {
    const target = exactRadio(name, value);
    if (!(target instanceof HTMLInputElement) || target.type !== "radio") return false;
    if (target.disabled) return false;
    if (!target.checked) target.click();
    await sleep(35);
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    return target.checked && radios(name).every((peer) => peer === target || !peer.checked);
  }

  function verifyRadio(name, value) {
    const target = exactRadio(name, value);
    return Boolean(target?.checked) && radios(name).every((peer) => peer === target || !peer.checked);
  }

  function hiddenValues(name) {
    return [...document.querySelectorAll('input[type="hidden"]')]
      .filter((item) => item.name === name)
      .map((item) => String(item.value ?? ""));
  }

  async function chooseMode(value) {
    const ok = await selectRadio("modify_tp", value);
    if (!ok) return false;
    await sleep(180);
    return verifyRadio("modify_tp", value);
  }

  async function configurePrice() {
    status("판매가 전송 form 설정 중");
    if (!await chooseMode("goods_normal")) return { ok: false, code: "V020_PRICE_MODE", message: "modify_tp=goods_normal 선택 실패" };
    const source = hiddenValues("tsmt_sale_price_tp");
    if (!source.length || source.some((value) => value !== "J")) {
      return { ok: false, code: "V020_PRICE_SOURCE", message: `tsmt_sale_price_tp가 J가 아닙니다: ${source.join(",") || "없음"}` };
    }
    for (const name of GENERAL_NAMES) {
      const expected = name === "trsmt_env_mody_price" ? "Y" : "";
      if (!await selectRadio(name, expected)) return { ok: false, code: "V020_GENERAL_SELECT", message: `${name}=${expected || "(blank)"} 선택 실패` };
    }
    const wrong = GENERAL_NAMES.filter((name) => !verifyRadio(name, name === "trsmt_env_mody_price" ? "Y" : ""));
    if (!verifyRadio("modify_tp", "goods_normal") || wrong.length) return { ok: false, code: "V020_PRICE_VERIFY", message: `판매가 단독 검증 실패: ${wrong.join(",") || "modify_tp"}` };
    return { ok: true };
  }

  async function configureOption() {
    status("옵션 전송 form 설정 중");
    if (!await chooseMode("goods_stock")) return { ok: false, code: "V020_OPTION_MODE", message: "modify_tp=goods_stock 선택 실패" };
    await sleep(180);
    if (!await selectRadio("trsmt_env_mody_opt", "1")) return { ok: false, code: "V020_OPTION_SELECT", message: "trsmt_env_mody_opt=1 선택 실패" };
    if (!verifyRadio("modify_tp", "goods_stock") || !verifyRadio("trsmt_env_mody_opt", "1")) return { ok: false, code: "V020_OPTION_VERIFY", message: "옵션송신 단독 검증 실패" };
    return { ok: true };
  }

  function verifyPrice() {
    if (!verifyRadio("modify_tp", "goods_normal")) return false;
    if (hiddenValues("tsmt_sale_price_tp").some((value) => value !== "J")) return false;
    return GENERAL_NAMES.every((name) => verifyRadio(name, name === "trsmt_env_mody_price" ? "Y" : ""));
  }

  function verifyOption() {
    return verifyRadio("modify_tp", "goods_stock") && verifyRadio("trsmt_env_mody_opt", "1");
  }

  function payloadExists() {
    const joined = [...document.querySelectorAll('input[type="hidden"]')].filter((item) => item.name === "prod_join_chk[]");
    return joined.length > 0 && joined.every((item) => /^\d+$/.test(String(item.value || "")));
  }

  function submitButton() {
    return [...document.querySelectorAll('input[type="button"]')].find((item) =>
      normalize(item.value) === "상품수정 송신" && /goods_mallMdfy_submit_sp\s*\(/.test(item.getAttribute("onclick") || ""),
    ) || null;
  }

  async function sendFailure(jobId, code, message) {
    status(`중단 · ${message}`, "bad");
    await chrome.runtime.sendMessage({ type: "A21_JOB_FAILURE", jobId, code, message }).catch(() => null);
  }

  async function sendStage(jobId, nextStage, message) {
    await chrome.runtime.sendMessage({ type: "A21_STAGE", jobId, stage: nextStage, message }).catch(() => null);
  }

  async function configureAndSubmit(assignment) {
    if (busy) return;
    busy = true;
    activeAssignment = assignment;
    try {
      if (!isExactPopupUrl()) return sendFailure(assignment.jobId, "V020_POPUP_URL", `송신 URL 불일치: ${location.href}`);
      if (!payloadExists()) return sendFailure(assignment.jobId, "V020_PAYLOAD", "prod_join_chk[] 대상값이 없어 송신 차단");
      status(`${assignment.mode === "PRICE" ? "판매가" : "옵션"} assignment 수신`);
      const configured = assignment.mode === "PRICE" ? await configurePrice() : await configureOption();
      if (!configured.ok) return sendFailure(assignment.jobId, configured.code, configured.message);
      const valid = assignment.mode === "PRICE" ? verifyPrice() : verifyOption();
      if (!valid) return sendFailure(assignment.jobId, "V020_PRE_SUBMIT_VERIFY", "송신 직전 form 상태 검증 실패");
      status(`${assignment.mode === "PRICE" ? "판매가" : "옵션"} 설정 완료 · 1.2초 후 송신`, "ok");
      await sendStage(assignment.jobId, "POPUP_CONFIG", `${assignment.mode === "PRICE" ? "판매가" : "옵션"} 실제 form 값 검증 완료`);
      await sleep(1200);
      const stillValid = assignment.mode === "PRICE" ? verifyPrice() : verifyOption();
      if (!stillValid) return sendFailure(assignment.jobId, "V020_CONFIG_CHANGED", "대기 중 form 상태가 바뀌어 송신 차단");
      const button = submitButton();
      if (!button) return sendFailure(assignment.jobId, "V020_SUBMIT_NOT_FOUND", "goods_mallMdfy_submit_sp() 송신 버튼을 찾지 못함");
      status("상품수정 송신 클릭", "warn");
      await sendStage(assignment.jobId, "SUBMIT_CLICKED", `${assignment.mode === "PRICE" ? "판매가" : "옵션"} · 상품수정 송신 클릭`);
      button.click();
      await sendStage(assignment.jobId, "RESULT_WAIT", "Shopling 수정전송 결과 확인 중");
    } finally {
      busy = false;
    }
  }

  async function claim() {
    if (role() !== "A21_POPUP") return;
    status("송신 작업 assignment 요청 중");
    const response = await chrome.runtime.sendMessage({ type: CLAIM_MESSAGE, role: "A21_POPUP", href: location.href, version: VERSION }).catch(() => null);
    if (!response?.ok || !response.assignment?.jobId) {
      status(`assignment 대기 · ${response?.error || "응답 없음"}`, "warn");
      return;
    }
    return configureAndSubmit(response.assignment);
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
          await configureAndSubmit(message);
          return;
        }
        if (message?.type === "A21_POPUP_RESULT_ASSIGNMENT") {
          sendResponse({ ok: true, accepted: true, version: VERSION });
          return;
        }
        sendResponse({ ok: false, error: "unsupported_message" });
      } catch (error) {
        if (message?.jobId) await sendFailure(message.jobId, "V020_CONTENT_EXCEPTION", error instanceof Error ? error.message : String(error));
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  });

  overlay();
  setTimeout(() => void claim(), 120);
  window.addEventListener("load", () => setTimeout(() => void claim(), 220), { once: true });
})();
