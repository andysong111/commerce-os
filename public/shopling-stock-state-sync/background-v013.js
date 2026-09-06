const VERSION = "0.1.3";
const STATE_KEY = "commerceOsShoplingStockStateSyncV013";
const LAST_RESULT_KEY = "commerceOsShoplingStockStateSyncLastResultV013";
const ALARM_NAME = "commerce-os-shopling-stock-state-watchdog-v013";
const SHOPLING_MATCH = "https://a.shopling.co.kr/*";
const OPS_MATCH = "https://commerce-os-ops-center.vercel.app/*";
const PRE_SUBMIT_TIMEOUT_MS = 5 * 60 * 1000;
const POPUP_TIMEOUT_MS = 4 * 60 * 1000;
const RESULT_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_TRANSIENT_ATTEMPTS = 4;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();

async function loadActive() {
  const stored = await chrome.storage.local.get(STATE_KEY);
  return stored[STATE_KEY] || null;
}

async function saveActive(active) {
  if (!active) {
    await chrome.storage.local.remove(STATE_KEY);
    return null;
  }
  active.version = VERSION;
  active.updatedAt = Date.now();
  await chrome.storage.local.set({ [STATE_KEY]: active });
  return active;
}

async function loadLastResult() {
  const stored = await chrome.storage.local.get(LAST_RESULT_KEY);
  return stored[LAST_RESULT_KEY] || null;
}

function validJob(input) {
  const job = input && typeof input === "object" ? input : {};
  const jobId = norm(job.jobId);
  const barcode = norm(job.barcode).toUpperCase().replace(/\s+/g, "");
  const productKind = norm(job.productKind).toUpperCase();
  const desiredStatus = norm(job.desiredStatus).toUpperCase();
  const modelNo = norm(job.modelNo) || null;
  const goodsKeys = Array.isArray(job.goodsKeys)
    ? [...new Set(job.goodsKeys.map((value) => norm(value)).filter((value) => /^\d+$/.test(value)))]
    : [];
  if (!jobId) return { ok: false, code: "STOCK_SYNC_JOB_ID_REQUIRED", message: "작업 ID가 없습니다." };
  if (!/^B[A-Z]{2}\d+-\d+$/.test(barcode)) {
    return { ok: false, code: "STOCK_SYNC_BARCODE_INVALID", message: "B코드 형식이 올바르지 않습니다." };
  }
  if (!["OPTION", "SINGLE"].includes(productKind)) {
    return { ok: false, code: "STOCK_SYNC_PRODUCT_KIND_INVALID", message: "상품형태는 옵션상품 또는 단품이어야 합니다." };
  }
  if (!["SOLD_OUT", "ON_SALE"].includes(desiredStatus)) {
    return { ok: false, code: "STOCK_SYNC_DESIRED_STATUS_INVALID", message: "목표상태는 품절 또는 판매중이어야 합니다." };
  }
  if (!goodsKeys.length) {
    return {
      ok: false,
      code: "STOCK_SYNC_GOODS_KEY_REQUIRED",
      message: "A4/A21 정확 상품 검색에 필요한 Shopling goods key가 없습니다.",
    };
  }
  return {
    ok: true,
    job: { ...job, jobId, barcode, productKind, desiredStatus, modelNo, goodsKeys },
  };
}

function statusKorean(status) {
  return status === "SOLD_OUT" ? "품절" : "판매중";
}

function currentGoodsKey(active) {
  return active?.job?.goodsKeys?.[Number(active.goodsKeyIndex || 0)] || null;
}

function stageLabel(stage, productKind) {
  if (stage === "A6") return "A6 옵션상태 변경";
  if (stage === "A4") return "A4 단품 상품상태 변경";
  if (stage === "A21_LIST") return "A21 goods key 검색·수정전송";
  if (stage === "A21_POPUP") {
    return productKind === "OPTION" ? "A21 옵션송신" : "A21 상품판매상태 송신";
  }
  if (stage === "WAIT_A21_RESULT") {
    return productKind === "OPTION" ? "A21 옵션송신 결과 대기" : "A21 상품판매상태 결과 대기";
  }
  return stage || "시작";
}

function expectedRole(stage) {
  if (stage === "A6") return "A6";
  if (stage === "A4") return "A4";
  if (stage === "A21_LIST") return "A21_LIST";
  if (stage === "A21_POPUP") return "A21_POPUP";
  return null;
}

async function broadcast(type, payload) {
  const tabs = await chrome.tabs.query({ url: OPS_MATCH }).catch(() => []);
  await Promise.all(
    tabs
      .filter((tab) => Number.isInteger(tab.id))
      .map((tab) => chrome.tabs.sendMessage(tab.id, { type, payload, version: VERSION }).catch(() => null)),
  );
}

async function progress(active, message, extra = {}) {
  active.message = message;
  active.evidence = [
    ...(active.evidence || []),
    {
      at: Date.now(),
      stage: active.stage,
      goodsKey: currentGoodsKey(active),
      message,
      ...extra,
    },
  ].slice(-120);
  await saveActive(active);
  await broadcast("STOCK_SYNC_PROGRESS", {
    jobId: active.job.jobId,
    job: active.job,
    stage: active.stage,
    stageLabel: stageLabel(active.stage, active.job.productKind),
    goodsKey: currentGoodsKey(active),
    goodsKeyIndex: active.goodsKeyIndex,
    goodsKeyCount: active.job.goodsKeys.length,
    message,
    startedAt: active.startedAt,
    updatedAt: active.updatedAt,
    ...extra,
  });
}

async function finish(active, outcome, message, evidence = {}) {
  const result = {
    jobId: active.job.jobId,
    job: active.job,
    outcome,
    message,
    evidence: {
      stage: active.stage,
      goodsKey: currentGoodsKey(active),
      goodsKeyIndex: active.goodsKeyIndex,
      history: active.evidence || [],
      ...evidence,
    },
    startedAt: active.startedAt,
    finishedAt: Date.now(),
    version: VERSION,
  };
  await chrome.storage.local.set({ [LAST_RESULT_KEY]: result });
  await saveActive(null);
  await chrome.alarms.clear(ALARM_NAME).catch(() => null);
  await broadcast("STOCK_SYNC_RESULT", result);
  return result;
}

async function findShoplingTab() {
  const tabs = await chrome.tabs.query({ url: SHOPLING_MATCH }).catch(() => []);
  if (!tabs.length) return null;
  return [...tabs].sort((left, right) => {
    const active = Number(Boolean(right.active)) - Number(Boolean(left.active));
    if (active !== 0) return active;
    return Number(right.lastAccessed || 0) - Number(left.lastAccessed || 0);
  })[0] || null;
}

async function probeFrame(tabId, frameId, active) {
  return chrome.tabs
    .sendMessage(
      tabId,
      {
        type: "STOCK_SYNC_PROBE",
        stage: active.stage,
        expectedRole: expectedRole(active.stage),
        version: VERSION,
      },
      { frameId },
    )
    .catch(() => null);
}

async function scanFrames(tabId, active) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => []);
  const candidates = [];
  for (const frame of frames || []) {
    if (!Number.isInteger(frame.frameId)) continue;
    const response = await probeFrame(tabId, frame.frameId, active);
    if (!response?.ok || !response.page) continue;
    candidates.push({ frameId: frame.frameId, parentFrameId: frame.parentFrameId, page: response.page });
  }
  const expected = expectedRole(active.stage);
  const exact = candidates.find((entry) => entry.page.role === expected);
  if (exact) return exact;
  const navigator = candidates.find((entry) => entry.page.canNavigate === true);
  if (navigator) return navigator;
  const top = candidates.find((entry) => entry.frameId === 0);
  return top || candidates[0] || null;
}

async function dispatchToFrame(active, tabId, frameId, page = null) {
  if (!active || !Number.isInteger(tabId) || !Number.isInteger(frameId)) return false;
  if (active.stage === "WAIT_A21_RESULT") return false;
  active.shoplingTabId = tabId;
  active.shoplingFrameId = frameId;
  await saveActive(active);
  const payload = {
    type: "STOCK_SYNC_EXECUTE",
    job: active.job,
    stage: active.stage,
    expectedRole: expectedRole(active.stage),
    goodsKey: currentGoodsKey(active),
    goodsKeyIndex: active.goodsKeyIndex,
    page,
    version: VERSION,
  };
  const response = await chrome.tabs.sendMessage(tabId, payload, { frameId }).catch(() => null);
  if (response) return true;
  await sleep(500);
  return Boolean(await chrome.tabs.sendMessage(tabId, payload, { frameId }).catch(() => null));
}

async function dispatchBest(active, preferredTabId = null) {
  if (!active || active.stage === "WAIT_A21_RESULT") return false;
  let tabId = Number.isInteger(preferredTabId) ? preferredTabId : active.shoplingTabId;
  if (!Number.isInteger(tabId)) tabId = (await findShoplingTab())?.id;
  if (!Number.isInteger(tabId)) return false;
  const candidate = await scanFrames(tabId, active);
  if (!candidate) return false;
  return dispatchToFrame(active, tabId, candidate.frameId, candidate.page);
}

async function start(input) {
  const normalized = validJob(input);
  if (!normalized.ok) return normalized;
  const existing = await loadActive();
  if (existing?.status === "RUNNING") {
    const opposite =
      existing.job?.barcode === normalized.job.barcode &&
      existing.job?.desiredStatus !== normalized.job.desiredStatus;
    return {
      ok: false,
      code: opposite ? "STOCK_SYNC_OPPOSITE_JOB_BLOCKED" : "STOCK_SYNC_ALREADY_RUNNING",
      message: opposite
        ? `${normalized.job.barcode}의 반대 상태 작업이 이미 실행 중이라 중복·경합을 차단했습니다.`
        : `이미 ${existing.job?.barcode || "다른 B코드"} Shopling 작업이 실행 중입니다.`,
      active: existing,
    };
  }
  const tab = await findShoplingTab();
  if (!tab || !Number.isInteger(tab.id)) {
    return {
      ok: false,
      code: "SHOPLING_LOGIN_TAB_REQUIRED",
      message: "로그인된 Shopling 탭을 먼저 열어주세요. 새 탭을 임의 생성하지 않았습니다.",
    };
  }
  const now = Date.now();
  const firstStage = normalized.job.productKind === "OPTION" ? "A6" : "A4";
  const active = {
    status: "RUNNING",
    job: normalized.job,
    stage: firstStage,
    stageStartedAt: now,
    startedAt: now,
    updatedAt: now,
    shoplingTabId: tab.id,
    shoplingFrameId: null,
    goodsKeyIndex: 0,
    attempts: {},
    evidence: [],
    message:
      normalized.job.productKind === "OPTION"
        ? "A6 옵션상태 변경 준비"
        : `A4 goods key ${normalized.job.goodsKeys[0]} 상품상태 변경 준비`,
  };
  await saveActive(active);
  await chrome.alarms.create(ALARM_NAME, { delayInMinutes: 0.5, periodInMinutes: 0.5 });
  await progress(
    active,
    normalized.job.productKind === "OPTION"
      ? `${active.job.barcode} ${statusKorean(active.job.desiredStatus)} 동기화 시작 · A6 옵션상태 변경 후 A21 goods key 옵션송신`
      : `${active.job.barcode} ${statusKorean(active.job.desiredStatus)} 동기화 시작 · A4 상품상태 변경 후 A21 상품판매상태 송신`,
  );
  await chrome.tabs.update(tab.id, { active: true }).catch(() => null);
  if (Number.isInteger(tab.windowId)) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => null);
  const dispatched = await dispatchBest(active, tab.id);
  if (!dispatched) await progress(active, "Shopling 내부 작업 프레임을 탐색 중입니다.");
  return { ok: true, active: await loadActive(), message: active.message };
}

function isTransient(result) {
  const code = String(result?.code || "");
  return Boolean(
    result?.navigating ||
      result?.waiting ||
      [
        "SEARCH_FIELD_NOT_FOUND",
        "SEARCH_INPUT_NOT_FOUND",
        "SEARCH_BUTTON_NOT_FOUND",
        "SHOPLING_MENU_NOT_FOUND",
        "SHOPLING_FRAME_NOT_READY",
        "A21_POPUP_WAIT",
      ].includes(code),
  );
}

async function handleStepResult(message, sender) {
  const active = await loadActive();
  if (!active || active.status !== "RUNNING") return { ok: false };
  if (message.jobId !== active.job.jobId || message.stage !== active.stage) {
    return { ok: false, stale: true };
  }
  const result = message.result || {};
  const tabId = sender?.tab?.id;
  const frameId = sender?.frameId;
  if (Number.isInteger(tabId)) active.shoplingTabId = tabId;
  if (Number.isInteger(frameId)) active.shoplingFrameId = frameId;

  if (result.navigating || result.waiting) {
    await progress(active, result.message || `${stageLabel(active.stage, active.job.productKind)} 화면 대기`, {
      page: message.page,
      frameId,
    });
    await sleep(result.navigating ? 900 : 500);
    await dispatchBest(active, tabId);
    return { ok: true, waiting: true };
  }

  if (!result.ok) {
    const attempts = Number(active.attempts?.[active.stage] || 0) + 1;
    active.attempts = { ...(active.attempts || {}), [active.stage]: attempts };
    if (isTransient(result) && attempts < MAX_TRANSIENT_ATTEMPTS) {
      await progress(active, `${result.message || "Shopling 화면 준비 대기"} · 재시도 ${attempts}/${MAX_TRANSIENT_ATTEMPTS}`, {
        code: result.code,
        page: message.page,
        frameId,
      });
      await sleep(900);
      await dispatchBest(active, tabId);
      return { ok: true, retrying: true };
    }
    return {
      ok: false,
      result: await finish(
        active,
        result.uncertain ? "UNCERTAIN" : "FAILED",
        result.message || `${stageLabel(active.stage, active.job.productKind)} 실행에 실패했습니다.`,
        { code: result.code || "STOCK_SYNC_STEP_FAILED", page: message.page, frameId, detail: result.evidence },
      ),
    };
  }

  if (result.step === "A6" && result.completed) {
    active.stage = "A21_LIST";
    active.stageStartedAt = Date.now();
    active.attempts = {};
    await progress(
      active,
      `A6 ${statusKorean(active.job.desiredStatus)} 확인 완료 · goods key ${currentGoodsKey(active)}를 A21에서 검색해 옵션송신`,
      { detail: result.evidence, frameId },
    );
    await sleep(500);
    await dispatchBest(active, tabId);
    return { ok: true };
  }

  if (result.step === "A4" && result.completed) {
    active.stage = "A21_LIST";
    active.stageStartedAt = Date.now();
    active.attempts = {};
    await progress(
      active,
      `A4 goods key ${currentGoodsKey(active)} 상품상태 ${statusKorean(active.job.desiredStatus)} 확인 완료 · A21 상품판매상태 송신으로 이동`,
      { detail: result.evidence, frameId },
    );
    await sleep(500);
    await dispatchBest(active, tabId);
    return { ok: true };
  }

  if (result.step === "A21_LIST_SUBMITTED" && result.submitted) {
    active.stage = "A21_POPUP";
    active.stageStartedAt = Date.now();
    active.attempts = {};
    await progress(
      active,
      active.job.productKind === "OPTION"
        ? `A21 goods key ${currentGoodsKey(active)} 수정전송 팝업 대기 · 옵션송신만 선택`
        : `A21 goods key ${currentGoodsKey(active)} 수정전송 팝업 대기 · 상품판매상태 ${statusKorean(active.job.desiredStatus)}만 송신`,
      { detail: result.evidence, frameId },
    );
    await sleep(500);
    await dispatchBest(active, null);
    return { ok: true };
  }

  if (result.step === "A21_POPUP_SUBMITTED" && result.submitted) {
    active.stage = "WAIT_A21_RESULT";
    active.stageStartedAt = Date.now();
    await progress(
      active,
      active.job.productKind === "OPTION"
        ? `A21 goods key ${currentGoodsKey(active)} 옵션송신 접수 · 최종 완료문구 확인 중`
        : `A21 goods key ${currentGoodsKey(active)} 상품판매상태 송신 접수 · 최종 완료문구 확인 중`,
      { detail: result.evidence, frameId },
    );
    return { ok: true };
  }

  return { ok: true, ignored: true };
}

async function handlePageReady(message, sender) {
  const active = await loadActive();
  if (!active || active.status !== "RUNNING") return { ok: false };
  const tabId = sender?.tab?.id;
  const frameId = sender?.frameId;
  if (!Number.isInteger(tabId) || !Number.isInteger(frameId)) return { ok: false };
  const page = message.page || {};
  const expected = expectedRole(active.stage);
  if (page.role === expected || page.canNavigate === true) {
    active.shoplingTabId = tabId;
    active.shoplingFrameId = frameId;
    await saveActive(active);
    await dispatchToFrame(active, tabId, frameId, page);
    return { ok: true, dispatched: true };
  }
  return { ok: true, ignored: true };
}

async function continueNextGoodsKey(active, sender, evidence) {
  const nextIndex = Number(active.goodsKeyIndex || 0) + 1;
  if (nextIndex >= active.job.goodsKeys.length) {
    return {
      ok: true,
      result: await finish(
        active,
        "SUCCEEDED",
        `${active.job.barcode} Shopling ${statusKorean(active.job.desiredStatus)} 반영 완료 · goods key ${active.job.goodsKeys.length}건 전송 확인`,
        { result: evidence, resultTabId: sender?.tab?.id, resultFrameId: sender?.frameId },
      ),
    };
  }
  active.goodsKeyIndex = nextIndex;
  active.stage = active.job.productKind === "OPTION" ? "A21_LIST" : "A4";
  active.stageStartedAt = Date.now();
  active.attempts = {};
  await progress(
    active,
    active.job.productKind === "OPTION"
      ? `다음 goods key ${currentGoodsKey(active)} A21 옵션송신 계속`
      : `다음 goods key ${currentGoodsKey(active)} A4 상품상태 변경부터 계속`,
  );
  await sleep(500);
  await dispatchBest(active, active.shoplingTabId);
  return { ok: true, continuing: true };
}

async function handleEvidence(message, sender) {
  const active = await loadActive();
  if (!active || active.status !== "RUNNING" || active.stage !== "WAIT_A21_RESULT") {
    return { ok: true, ignored: true };
  }
  const evidence = message.evidence || {};
  const expectedComplete =
    active.job.productKind === "OPTION" ? Boolean(evidence.optionComplete) : Boolean(evidence.productComplete);
  if (evidence.processing) {
    await progress(active, `${stageLabel(active.stage, active.job.productKind)} · Shopling 처리중`, {
      resultTabId: sender?.tab?.id,
      resultFrameId: sender?.frameId,
      result: evidence,
    });
    return { ok: true, processing: true };
  }
  if (!expectedComplete || evidence.readyState !== "complete") return { ok: true, ignored: true };
  if (Number(evidence.failureCount || 0) > 0 || evidence.explicitFailure) {
    return {
      ok: true,
      result: await finish(
        active,
        "UNCERTAIN",
        `${active.job.barcode} goods key ${currentGoodsKey(active)} 전송은 완료됐지만 실패 ${Number(evidence.failureCount || 1)}건이 있어 수동 확인이 필요합니다.`,
        { result: evidence, resultTabId: sender?.tab?.id, resultFrameId: sender?.frameId },
      ),
    };
  }
  return continueNextGoodsKey(active, sender, evidence);
}

async function watchdog() {
  const active = await loadActive();
  if (!active || active.status !== "RUNNING") {
    await chrome.alarms.clear(ALARM_NAME).catch(() => null);
    return;
  }
  const elapsed = Date.now() - Number(active.stageStartedAt || active.startedAt || 0);
  const limit =
    active.stage === "A21_POPUP"
      ? POPUP_TIMEOUT_MS
      : active.stage === "WAIT_A21_RESULT"
        ? RESULT_TIMEOUT_MS
        : PRE_SUBMIT_TIMEOUT_MS;
  if (elapsed <= limit) {
    if (active.stage !== "WAIT_A21_RESULT") await dispatchBest(active, active.shoplingTabId);
    return;
  }
  const submitted = active.stage === "WAIT_A21_RESULT";
  await finish(
    active,
    submitted ? "UNCERTAIN" : "FAILED",
    submitted
      ? `${stageLabel(active.stage, active.job.productKind)}가 ${Math.round(limit / 60_000)}분을 넘어 실제 Shopling 상태를 수동 확인해야 합니다.`
      : `${stageLabel(active.stage, active.job.productKind)} 화면 자동화가 제한시간을 넘었습니다.`,
    { code: submitted ? "STOCK_SYNC_RESULT_TIMEOUT" : "STOCK_SYNC_STEP_TIMEOUT" },
  );
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return;
  if (message.type === "STOCK_SYNC_START") {
    void start(message.job).then(sendResponse).catch((error) =>
      sendResponse({ ok: false, code: "STOCK_SYNC_START_FAILED", message: norm(error?.message || error) }),
    );
    return true;
  }
  if (message.type === "STOCK_SYNC_STEP_RESULT") {
    void handleStepResult(message, sender).then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "STOCK_SYNC_PAGE_READY") {
    void handlePageReady(message, sender).then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "STOCK_SYNC_RESULT_EVIDENCE") {
    void handleEvidence(message, sender).then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "STOCK_SYNC_GET_STATUS") {
    void Promise.all([loadActive(), loadLastResult()]).then(([active, lastResult]) =>
      sendResponse({ ok: true, active, lastResult, version: VERSION }),
    );
    return true;
  }
  if (message.type === "STOCK_SYNC_STOP") {
    void (async () => {
      const active = await loadActive();
      if (!active) return { ok: true, stopped: false };
      return {
        ok: true,
        stopped: true,
        result: await finish(active, "UNCERTAIN", "사용자가 Shopling 재고상태 동기화를 안전 중지했습니다.", {
          code: "STOCK_SYNC_OPERATOR_STOPPED",
        }),
      };
    })().then(sendResponse);
    return true;
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name === ALARM_NAME) void watchdog();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !String(tab?.url || "").startsWith("https://a.shopling.co.kr/")) return;
  void loadActive().then((active) => {
    if (!active || active.status !== "RUNNING" || active.stage === "WAIT_A21_RESULT") return;
    void dispatchBest(active, tabId);
  });
});