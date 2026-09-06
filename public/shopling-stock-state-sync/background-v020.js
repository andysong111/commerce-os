const VERSION = "0.2.0";
const STATE_KEY = "commerceOsShoplingStockStateSyncV013";
const LAST_RESULT_KEY = "commerceOsShoplingStockStateSyncLastResultV013";
const ALARM_NAME = "commerce-os-shopling-stock-state-watchdog-v020";
const SHOPLING_ORIGIN = "https://a.shopling.co.kr/";
const OPS_MATCH = "https://commerce-os-ops-center.vercel.app/*";
const PRE_SUBMIT_TIMEOUT_MS = 60_000;
const POPUP_TIMEOUT_MS = 90_000;
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
  return { ok: true, job: { ...job, jobId, barcode, productKind, desiredStatus, modelNo, goodsKeys } };
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
  if (stage === "A21_POPUP") return productKind === "OPTION" ? "A21 옵션송신" : "A21 상품판매상태 송신";
  if (stage === "WAIT_A21_RESULT") return productKind === "OPTION" ? "A21 옵션송신 결과 대기" : "A21 상품판매상태 결과 대기";
  return stage || "시작";
}

function expectedRole(stage) {
  if (stage === "A6") return "A6";
  if (stage === "A4") return "A4";
  if (stage === "A21_LIST") return "A21_LIST";
  if (stage === "A21_POPUP") return "A21_POPUP";
  return null;
}

function requiredStages(productKind) {
  return productKind === "OPTION" ? ["A6", "A21_LIST"] : ["A4", "A21_LIST"];
}

function requiredTabLabel(stage) {
  if (stage === "A6") return "A6 옵션대량수정";
  if (stage === "A4") return "A4 상품조회수정";
  if (stage === "A21_LIST") return "A21 쇼핑몰상품수정";
  return stage;
}

async function broadcast(type, payload) {
  const tabs = await chrome.tabs.query({ url: OPS_MATCH }).catch(() => []);
  await Promise.all(
    tabs.filter((tab) => Number.isInteger(tab.id)).map((tab) =>
      chrome.tabs.sendMessage(tab.id, { type, payload, version: VERSION }).catch(() => null),
    ),
  );
}

async function progress(active, message, extra = {}) {
  active.message = message;
  active.evidence = [
    ...(active.evidence || []),
    { at: Date.now(), stage: active.stage, goodsKey: currentGoodsKey(active), message, ...extra },
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

async function shoplingTabs() {
  const tabs = await chrome.tabs.query({}).catch(() => []);
  return tabs
    .filter((tab) => {
      const url = String(tab.url || tab.pendingUrl || "");
      return url.startsWith(SHOPLING_ORIGIN);
    })
    .sort((left, right) => Number(Boolean(right.active)) - Number(Boolean(left.active)) || Number(right.lastAccessed || 0) - Number(left.lastAccessed || 0));
}

async function probeFrame(tabId, frameId, stage) {
  return chrome.tabs.sendMessage(
    tabId,
    { type: "STOCK_SYNC_PROBE", stage, expectedRole: expectedRole(stage), version: VERSION },
    { frameId },
  ).catch(() => null);
}

async function exactRoleTargetInTab(tab, stage) {
  if (!Number.isInteger(tab?.id)) return null;
  const expected = expectedRole(stage);
  if (!expected) return null;
  const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id }).catch(() => []);
  for (const frame of frames || []) {
    if (!Number.isInteger(frame.frameId)) continue;
    const response = await probeFrame(tab.id, frame.frameId, stage);
    if (!response?.ok || response?.page?.role !== expected) continue;
    return { tabId: tab.id, windowId: tab.windowId, frameId: frame.frameId, page: response.page, role: expected };
  }
  return null;
}

async function findExactRoleTarget(stage) {
  for (const tab of await shoplingTabs()) {
    const target = await exactRoleTargetInTab(tab, stage);
    if (target) return target;
  }
  return null;
}

async function preflightWorkTabs(job) {
  const targets = {};
  const missing = [];
  for (const stage of requiredStages(job.productKind)) {
    const target = await findExactRoleTarget(stage);
    if (!target) missing.push(requiredTabLabel(stage));
    else targets[stage] = target;
  }
  if (missing.length) {
    return {
      ok: false,
      code: "SHOPLING_REQUIRED_WORK_TAB_MISSING",
      message: `Shopling 작업탭이 부족합니다: ${missing.join(", ")}. 로그인 후 A4/A6/A21 작업화면을 각각 탭으로 열어두세요. 관리자 메인 탭은 필요하지 않습니다.`,
      missing,
    };
  }
  return { ok: true, targets };
}

async function dispatchToTarget(active, target) {
  if (!active || !target || !Number.isInteger(target.tabId) || !Number.isInteger(target.frameId)) return false;
  if (active.stage === "WAIT_A21_RESULT") return false;
  active.shoplingTabId = target.tabId;
  active.shoplingFrameId = target.frameId;
  active.workTabs = { ...(active.workTabs || {}), [active.stage]: { tabId: target.tabId, frameId: target.frameId } };
  await saveActive(active);
  const payload = {
    type: "STOCK_SYNC_EXECUTE",
    job: active.job,
    stage: active.stage,
    expectedRole: expectedRole(active.stage),
    goodsKey: currentGoodsKey(active),
    goodsKeyIndex: active.goodsKeyIndex,
    page: target.page,
    version: VERSION,
  };
  let response = await chrome.tabs.sendMessage(target.tabId, payload, { frameId: target.frameId }).catch(() => null);
  if (!response) {
    await sleep(350);
    response = await chrome.tabs.sendMessage(target.tabId, payload, { frameId: target.frameId }).catch(() => null);
  }
  return Boolean(response && response.ignored !== true);
}

async function dispatchCurrent(active, { focus = false } = {}) {
  if (!active || active.stage === "WAIT_A21_RESULT") return false;
  const target = await findExactRoleTarget(active.stage);
  if (!target) return false;
  if (focus) {
    await chrome.tabs.update(target.tabId, { active: true }).catch(() => null);
    if (Number.isInteger(target.windowId)) await chrome.windows.update(target.windowId, { focused: true }).catch(() => null);
  }
  return dispatchToTarget(active, target);
}

async function start(input) {
  const normalized = validJob(input);
  if (!normalized.ok) return normalized;
  const existing = await loadActive();
  if (existing?.status === "RUNNING") {
    const opposite = existing.job?.barcode === normalized.job.barcode && existing.job?.desiredStatus !== normalized.job.desiredStatus;
    return {
      ok: false,
      code: opposite ? "STOCK_SYNC_OPPOSITE_JOB_BLOCKED" : "STOCK_SYNC_ALREADY_RUNNING",
      message: opposite
        ? `${normalized.job.barcode}의 반대 상태 작업이 이미 실행 중이라 중복·경합을 차단했습니다.`
        : `이미 ${existing.job?.barcode || "다른 B코드"} Shopling 작업이 실행 중입니다.`,
      active: existing,
    };
  }

  const preflight = await preflightWorkTabs(normalized.job);
  if (!preflight.ok) return preflight;

  const now = Date.now();
  const firstStage = normalized.job.productKind === "OPTION" ? "A6" : "A4";
  const active = {
    status: "RUNNING",
    job: normalized.job,
    stage: firstStage,
    stageStartedAt: now,
    startedAt: now,
    updatedAt: now,
    shoplingTabId: preflight.targets[firstStage]?.tabId || null,
    shoplingFrameId: preflight.targets[firstStage]?.frameId || null,
    workTabs: Object.fromEntries(Object.entries(preflight.targets).map(([stage, target]) => [stage, { tabId: target.tabId, frameId: target.frameId }])),
    goodsKeyIndex: 0,
    attempts: {},
    evidence: [],
    message: normalized.job.productKind === "OPTION" ? "고정 A6/A21 작업탭 확인 완료 · A6 실행 준비" : "고정 A4/A21 작업탭 확인 완료 · A4 실행 준비",
  };
  await saveActive(active);
  await chrome.alarms.create(ALARM_NAME, { delayInMinutes: 0.5, periodInMinutes: 0.5 });
  await progress(
    active,
    normalized.job.productKind === "OPTION"
      ? `${active.job.barcode} ${statusKorean(active.job.desiredStatus)} 동기화 시작 · 고정 A6 탭 → 고정 A21 탭 옵션송신`
      : `${active.job.barcode} ${statusKorean(active.job.desiredStatus)} 동기화 시작 · 고정 A4 탭 → 고정 A21 탭 상품판매상태 송신`,
    { preflightTabs: active.workTabs },
  );
  const dispatched = await dispatchCurrent(active, { focus: true });
  if (!dispatched) {
    const result = await finish(active, "FAILED", `${requiredTabLabel(firstStage)} 탭은 확인했지만 실행 메시지를 전달하지 못했습니다. 탭을 새로고침한 뒤 다시 시도하세요.`, {
      code: "SHOPLING_FIXED_TAB_DISPATCH_FAILED",
    });
    return { ok: false, code: "SHOPLING_FIXED_TAB_DISPATCH_FAILED", message: result.message, result };
  }
  return { ok: true, active: await loadActive(), message: active.message };
}

function isTransient(result) {
  const code = String(result?.code || "");
  return Boolean(
    result?.waiting ||
      ["SEARCH_FIELD_NOT_FOUND", "SEARCH_INPUT_NOT_FOUND", "SEARCH_INPUT_SET_FAILED", "SEARCH_BUTTON_NOT_FOUND", "SHOPLING_FRAME_NOT_READY", "A21_POPUP_WAIT"].includes(code),
  );
}

async function dispatchAfterMutationOrFinish(active, messageIfMissing) {
  const dispatched = await dispatchCurrent(active, { focus: true });
  if (dispatched) return { ok: true };
  return {
    ok: false,
    result: await finish(active, "UNCERTAIN", messageIfMissing, {
      code: "SHOPLING_REQUIRED_WORK_TAB_LOST_AFTER_MUTATION",
    }),
  };
}

async function handleStepResult(message, sender) {
  const active = await loadActive();
  if (!active || active.status !== "RUNNING") return { ok: false };
  if (message.jobId !== active.job.jobId || message.stage !== active.stage) return { ok: false, stale: true };
  const result = message.result || {};
  const tabId = sender?.tab?.id;
  const frameId = sender?.frameId;
  if (Number.isInteger(tabId)) active.shoplingTabId = tabId;
  if (Number.isInteger(frameId)) active.shoplingFrameId = frameId;

  if (result.navigating) {
    return {
      ok: false,
      result: await finish(active, "FAILED", "고정 작업탭 모드에서 메뉴 자동이동 요청이 발생했습니다. A4/A6/A21 작업화면이 각각 열린 탭인지 확인하세요.", {
        code: "SHOPLING_FIXED_TAB_ROLE_MISMATCH",
        page: message.page,
        frameId,
      }),
    };
  }

  if (result.waiting) {
    await progress(active, result.message || `${stageLabel(active.stage, active.job.productKind)} 화면 대기`, { page: message.page, frameId });
    await sleep(500);
    await dispatchCurrent(active);
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
      await sleep(700);
      const dispatched = await dispatchCurrent(active);
      if (dispatched) return { ok: true, retrying: true };
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
    await progress(active, `A6 ${statusKorean(active.job.desiredStatus)} 확인 완료 · 고정 A21 탭에서 goods key ${currentGoodsKey(active)} 검색 후 옵션송신`, {
      detail: result.evidence,
      frameId,
    });
    await sleep(350);
    return dispatchAfterMutationOrFinish(active, "A6 상태변경은 완료됐지만 고정 A21 쇼핑몰상품수정 탭을 찾지 못했습니다. A21 옵션송신을 수동 확인하세요.");
  }

  if (result.step === "A4" && result.completed) {
    active.stage = "A21_LIST";
    active.stageStartedAt = Date.now();
    active.attempts = {};
    await progress(active, `A4 상품상태 ${statusKorean(active.job.desiredStatus)} 확인 완료 · 고정 A21 탭에서 goods key ${currentGoodsKey(active)} 판매상태 송신`, {
      detail: result.evidence,
      frameId,
    });
    await sleep(350);
    return dispatchAfterMutationOrFinish(active, "A4 상품상태 변경은 완료됐지만 고정 A21 쇼핑몰상품수정 탭을 찾지 못했습니다. A21 상품판매상태 송신을 수동 확인하세요.");
  }

  if (result.step === "A21_LIST_SUBMITTED" && result.submitted) {
    active.stage = "A21_POPUP";
    active.stageStartedAt = Date.now();
    active.attempts = {};
    await progress(active,
      active.job.productKind === "OPTION"
        ? `A21 goods key ${currentGoodsKey(active)} 수정전송 팝업 대기 · 옵션송신만 선택`
        : `A21 goods key ${currentGoodsKey(active)} 수정전송 팝업 대기 · 상품판매상태 ${statusKorean(active.job.desiredStatus)}만 송신`,
      { detail: result.evidence, frameId },
    );
    await sleep(500);
    await dispatchCurrent(active);
    return { ok: true };
  }

  if (result.step === "A21_POPUP_SUBMITTED" && result.submitted) {
    active.stage = "WAIT_A21_RESULT";
    active.stageStartedAt = Date.now();
    await progress(active,
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
  if (!active || active.status !== "RUNNING" || active.stage === "WAIT_A21_RESULT") return { ok: false };
  const tabId = sender?.tab?.id;
  const frameId = sender?.frameId;
  if (!Number.isInteger(tabId) || !Number.isInteger(frameId)) return { ok: false };
  const page = message.page || {};
  if (page.role !== expectedRole(active.stage)) return { ok: true, ignored: true };
  active.shoplingTabId = tabId;
  active.shoplingFrameId = frameId;
  await saveActive(active);
  await dispatchToTarget(active, { tabId, windowId: sender?.tab?.windowId, frameId, page });
  return { ok: true, dispatched: true };
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
  await progress(active,
    active.job.productKind === "OPTION"
      ? `다음 goods key ${currentGoodsKey(active)} 고정 A21 탭 옵션송신 계속`
      : `다음 goods key ${currentGoodsKey(active)} 고정 A4 탭 상품상태 변경부터 계속`,
  );
  await sleep(350);
  const dispatched = await dispatchCurrent(active, { focus: true });
  if (dispatched) return { ok: true, continuing: true };
  return {
    ok: false,
    result: await finish(active, "UNCERTAIN", `다음 goods key ${currentGoodsKey(active)} 처리용 고정 작업탭을 찾지 못했습니다.`, {
      code: "SHOPLING_REQUIRED_WORK_TAB_LOST_DURING_SERIAL_RUN",
    }),
  };
}

async function handleEvidence(message, sender) {
  const active = await loadActive();
  if (!active || active.status !== "RUNNING" || active.stage !== "WAIT_A21_RESULT") return { ok: true, ignored: true };
  const evidence = message.evidence || {};
  const expectedComplete = active.job.productKind === "OPTION" ? Boolean(evidence.optionComplete) : Boolean(evidence.productComplete);
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
  const limit = active.stage === "A21_POPUP" ? POPUP_TIMEOUT_MS : active.stage === "WAIT_A21_RESULT" ? RESULT_TIMEOUT_MS : PRE_SUBMIT_TIMEOUT_MS;
  if (elapsed <= limit) {
    if (active.stage !== "WAIT_A21_RESULT") await dispatchCurrent(active);
    return;
  }
  const submitted = active.stage === "WAIT_A21_RESULT";
  await finish(
    active,
    submitted ? "UNCERTAIN" : "FAILED",
    submitted
      ? `${stageLabel(active.stage, active.job.productKind)}가 ${Math.round(limit / 60_000)}분을 넘어 실제 Shopling 상태를 수동 확인해야 합니다.`
      : `${stageLabel(active.stage, active.job.productKind)}가 ${Math.round(limit / 1000)}초를 넘었습니다. 필요한 고정 작업탭이 열린 상태인지 확인하세요.`,
    { code: submitted ? "STOCK_SYNC_RESULT_TIMEOUT" : "STOCK_SYNC_FIXED_TAB_STEP_TIMEOUT" },
  );
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return;
  if (message.type === "STOCK_SYNC_START") {
    void start(message.job).then(sendResponse).catch((error) => sendResponse({ ok: false, code: "STOCK_SYNC_START_FAILED", message: norm(error?.message || error) }));
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
    void Promise.all([loadActive(), loadLastResult()]).then(([active, lastResult]) => sendResponse({ ok: true, active, lastResult, version: VERSION }));
    return true;
  }
  if (message.type === "STOCK_SYNC_STOP") {
    void (async () => {
      const active = await loadActive();
      if (!active) return { ok: true, stopped: false };
      return {
        ok: true,
        stopped: true,
        result: await finish(active, "UNCERTAIN", "사용자가 Shopling 재고상태 동기화를 안전 중지했습니다.", { code: "STOCK_SYNC_OPERATOR_STOPPED" }),
      };
    })().then(sendResponse);
    return true;
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name === ALARM_NAME) void watchdog();
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !String(tab?.url || "").startsWith(SHOPLING_ORIGIN)) return;
  void loadActive().then((active) => {
    if (!active || active.status !== "RUNNING" || active.stage === "WAIT_A21_RESULT") return;
    void dispatchCurrent(active);
  });
});