const STATE_KEY = "commerceOsShoplingInventoryLifecycleV010";
const VERSION = "0.1.0";
const SHOPLING_HOME = "https://a.shopling.co.kr/";

function normalize(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function validJob(payload) {
  const barcode = normalize(payload?.barcode).toUpperCase().replace(/\s+/g, "");
  const productMode = normalize(payload?.productMode).toUpperCase();
  const desiredStatus = normalize(payload?.desiredStatus).toUpperCase();
  return (
    /^B[A-Z]{2}\d+-\d+$/.test(barcode) &&
    ["OPTION", "SINGLE"].includes(productMode) &&
    ["SOLD_OUT", "SELLING"].includes(desiredStatus) &&
    (productMode !== "SINGLE" || Boolean(normalize(payload?.modelNo)))
  );
}

async function loadState() {
  const stored = await chrome.storage.local.get(STATE_KEY);
  return stored[STATE_KEY] || null;
}

async function saveState(state) {
  if (!state) {
    await chrome.storage.local.remove(STATE_KEY);
    return null;
  }
  state.version = VERSION;
  state.updatedAt = Date.now();
  await chrome.storage.local.set({ [STATE_KEY]: state });
  return state;
}

async function broadcast(type, payload) {
  const tabs = await chrome.tabs.query({
    url: "https://commerce-os-ops-center.vercel.app/*",
  });
  await Promise.all(
    tabs.map((tab) =>
      Number.isInteger(tab.id)
        ? chrome.tabs
            .sendMessage(tab.id, { type, payload, version: VERSION })
            .catch(() => null)
        : null,
    ),
  );
}

function eventPayload(job, state, stage, message, errorCode = null) {
  return {
    jobId: job.jobId,
    barcode: job.barcode,
    modelNo: job.modelNo || null,
    productName: job.productName || job.barcode,
    productMode: job.productMode,
    desiredStatus: job.desiredStatus,
    state,
    stage,
    message,
    errorCode,
  };
}

async function publishRunning(job, message) {
  await broadcast(
    "COMMERCE_OS_SHOPLING_LIFECYCLE_EVENT",
    eventPayload(job, "RUNNING", job.stage, message),
  );
}

async function failJob(job, code, message) {
  job.status = "FAILED";
  job.errorCode = code;
  job.message = message;
  job.finishedAt = Date.now();
  await saveState(job);
  await broadcast(
    "COMMERCE_OS_SHOPLING_LIFECYCLE_RESULT",
    eventPayload(job, "FAILED", job.stage, message, code),
  );
}

async function completeJob(job, message) {
  job.status = "SUCCEEDED";
  job.stage = "COMPLETED";
  job.message = message;
  job.finishedAt = Date.now();
  await saveState(job);
  await broadcast(
    "COMMERCE_OS_SHOPLING_LIFECYCLE_RESULT",
    eventPayload(job, "SUCCEEDED", "COMPLETED", message),
  );
}

function nextStage(job, step) {
  const transitions = {
    MENU_A6_CLICKED: "A6_SEARCH",
    A6_SEARCH_SUBMITTED: "A6_APPLY",
    A6_STATUS_APPLIED:
      job.productMode === "OPTION" ? "NAVIGATE_A22" : "NAVIGATE_A21",
    MENU_A22_CLICKED: "A22_SEARCH",
    A22_SEARCH_SUBMITTED: "A22_SEND",
    A22_SEND_SUBMITTED: "A22_RESULT",
    MENU_A21_CLICKED: "A21_SEARCH",
    A21_SEARCH_SUBMITTED: "A21_OPEN_POPUP",
    A21_POPUP_REQUESTED: "A21_CONFIGURE",
    A21_SUBMIT_CLICKED: "A21_RESULT",
  };
  return transitions[step] || null;
}

async function handleStepOk(message) {
  const job = await loadState();
  if (!job || job.status !== "RUNNING") return;
  if (message.jobId !== job.jobId) return;
  const step = normalize(message.step);
  if (step === "A22_RESULT_SUCCEEDED") {
    return completeJob(
      job,
      `${job.barcode} 옵션상품 ${job.desiredStatus === "SOLD_OUT" ? "품절" : "판매중"} 반영 완료 · A6→A22`,
    );
  }
  if (step === "A21_RESULT_SUCCEEDED") {
    return completeJob(
      job,
      `${job.barcode} 단품 ${job.desiredStatus === "SOLD_OUT" ? "품절" : "판매중"} 반영 완료 · A6→A21`,
    );
  }
  const stage = nextStage(job, step);
  if (!stage) return;
  job.stage = stage;
  job.message = normalize(message.message) || `${step} 완료`;
  if (Number.isInteger(message.tabId)) job.tabId = message.tabId;
  await saveState(job);
  await publishRunning(job, job.message);
}

async function startJob(payload) {
  if (!validJob(payload)) {
    throw new Error("SHOPLING_LIFECYCLE_JOB_INVALID");
  }
  const existing = await loadState();
  if (existing?.status === "RUNNING" && existing.jobId !== payload.jobId) {
    throw new Error(`SHOPLING_LIFECYCLE_JOB_ALREADY_RUNNING:${existing.barcode}`);
  }
  const job = {
    jobId: normalize(payload.jobId),
    barcode: normalize(payload.barcode).toUpperCase().replace(/\s+/g, ""),
    modelNo: normalize(payload.modelNo) || null,
    productName: normalize(payload.productName) || normalize(payload.barcode),
    productMode: normalize(payload.productMode).toUpperCase(),
    desiredStatus: normalize(payload.desiredStatus).toUpperCase(),
    status: "RUNNING",
    stage: "NAVIGATE_A6",
    message: "Shopling A6 옵션대량수정 화면으로 이동 중",
    startedAt: Date.now(),
    updatedAt: Date.now(),
    tabId: null,
    errorCode: null,
  };
  const tab = await chrome.tabs.create({ url: SHOPLING_HOME, active: true });
  if (!Number.isInteger(tab.id)) {
    throw new Error("SHOPLING_LIFECYCLE_TAB_CREATE_FAILED");
  }
  job.tabId = tab.id;
  await saveState(job);
  await publishRunning(job, job.message);
  return job;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void (async () => {
    try {
      if (message?.type === "OPS_LIFECYCLE_PING") {
        sendResponse({ ok: true, version: VERSION, state: await loadState() });
        return;
      }
      if (message?.type === "OPS_LIFECYCLE_RUN") {
        const job = await startJob(message.payload);
        sendResponse({ ok: true, version: VERSION, job });
        return;
      }
      if (message?.type === "SHOPLING_LIFECYCLE_GET_JOB") {
        const job = await loadState();
        sendResponse({
          ok: true,
          version: VERSION,
          job:
            job?.status === "RUNNING" &&
            (!Number.isInteger(job.tabId) || job.tabId === sender.tab?.id)
              ? job
              : null,
        });
        return;
      }
      if (message?.type === "SHOPLING_LIFECYCLE_STEP_OK") {
        await handleStepOk({ ...message, tabId: sender.tab?.id });
        sendResponse({ ok: true });
        return;
      }
      if (message?.type === "SHOPLING_LIFECYCLE_STEP_FAILED") {
        const job = await loadState();
        if (job?.status === "RUNNING" && job.jobId === message.jobId) {
          await failJob(
            job,
            normalize(message.code) || "SHOPLING_LIFECYCLE_STEP_FAILED",
            normalize(message.message) || "Shopling 재고상태 작업에 실패했습니다.",
          );
        }
        sendResponse({ ok: true });
        return;
      }
      if (message?.type === "SHOPLING_LIFECYCLE_STOP") {
        const job = await loadState();
        if (job?.status === "RUNNING") {
          await failJob(job, "OPERATOR_STOPPED", "운영자가 재고상태 작업을 중지했습니다.");
        }
        sendResponse({ ok: true });
        return;
      }
      if (message?.type === "SHOPLING_LIFECYCLE_STATE") {
        sendResponse({ ok: true, state: await loadState(), version: VERSION });
        return;
      }
      sendResponse({ ok: false, error: "unsupported_message" });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const job = await loadState();
    if (job?.status === "RUNNING" && job.tabId === tabId) {
      await failJob(
        job,
        "SHOPLING_LIFECYCLE_TAB_CLOSED",
        "Shopling 작업 탭이 완료 전에 닫혔습니다.",
      );
    }
  })();
});
