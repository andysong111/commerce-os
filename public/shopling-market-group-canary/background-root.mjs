"use strict";

const API_ENDPOINT = "https://commerce-os-ops-center.vercel.app/api/shopling-account-title-bridge/pipeline";
const API_BRIDGE = "v0.5.0";
const CLAIM_MESSAGE = "commerce-os-shopling-group-canary-claim";
const ARM_MESSAGE = "commerce-os-shopling-group-canary-arm";
const REPORT_MESSAGE = "commerce-os-shopling-group-canary-report";
const ALLOWED = new Map([
  ["DM1", "도매1"],
  ["DM2", "도매2"],
  ["DM3", "도매3"],
  ["DM4", "도매4"],
  ["SM1", "소매1"],
  ["SM2", "소매2"],
]);

function text(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

async function api(body) {
  try {
    const response = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bridge: API_BRIDGE, ...body }),
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true) {
      return {
        ok: false,
        error: text(payload?.error) || `group_canary_http_${response.status}`,
        message: text(payload?.message),
      };
    }
    return payload;
  } catch (error) {
    return {
      ok: false,
      error: "group_canary_transport_failed",
      message: error instanceof Error ? error.message : String(error || "group canary request failed"),
    };
  }
}

function normalizeTask(raw) {
  const goodsKey = text(raw?.goodsKey);
  const searchCode = text(raw?.searchCode).toUpperCase();
  const profile = text(raw?.profile);
  const ptnGoodsCd = text(raw?.ptnGoodsCd);
  const launchItemId = text(raw?.launchItemId);
  if (!/^\d{5,9}$/.test(goodsKey)) return null;
  if (!ALLOWED.has(searchCode) || ALLOWED.get(searchCode) !== profile) return null;
  if (!ptnGoodsCd || !ptnGoodsCd.toUpperCase().startsWith(`${searchCode}_`)) return null;
  return {
    goodsKey,
    launchItemId,
    modelNumber: text(raw?.modelNumber),
    productGroupKey: text(raw?.productGroupKey),
    searchCode,
    profile,
    ptnGoodsCd,
    registeredAt: text(raw?.registeredAt),
  };
}

async function releaseClaimed(runId, tasks, reasonCode, message) {
  const results = [];
  for (const task of tasks) {
    results.push(await api({
      action: "report",
      runId,
      goodsKey: task.goodsKey,
      outcome: "failed",
      reasonCode,
      message,
    }));
  }
  return results.every((row) => row?.ok === true);
}

async function claimOneProduct(runId) {
  if (!/^canary-group-v020-[A-Za-z0-9._:-]{12,150}$/.test(runId)) {
    return { ok: false, error: "invalid_group_canary_run_id" };
  }
  const response = await api({ action: "claim", runId, groupLimit: 1 });
  if (!response?.ok) return response;
  const rawTasks = Array.isArray(response.tasks) ? response.tasks : [];
  if (!rawTasks.length) return { ok: true, tasks: [], empty: true };
  const tasks = rawTasks.map(normalizeTask).filter(Boolean);
  const identityKeys = new Set(
    tasks.map((task) => task.launchItemId || task.modelNumber).filter(Boolean),
  );
  const valid = tasks.length === rawTasks.length
    && tasks.length >= 1
    && tasks.length <= 6
    && identityKeys.size === 1;
  if (!valid) {
    const releasable = tasks.length ? tasks : rawTasks.map((row) => ({ goodsKey: text(row?.goodsKey) })).filter((row) => /^\d{5,9}$/.test(row.goodsKey));
    const released = await releaseClaimed(
      runId,
      releasable,
      "group_canary_claim_guard_failed",
      "1개 상품의 최대 6채널 조건을 만족하지 않아 송신 전 원복했습니다.",
    );
    return {
      ok: false,
      error: released ? "group_canary_claim_guard_failed" : "group_canary_claim_guard_release_failed",
      message: "원장이 1개 상품 범위를 벗어나 자동 송신하지 않았습니다.",
    };
  }
  const order = new Map(["DM1", "DM2", "DM3", "DM4", "SM1", "SM2"].map((code, index) => [code, index]));
  tasks.sort((a, b) => (order.get(a.searchCode) ?? 99) - (order.get(b.searchCode) ?? 99));
  return {
    ok: true,
    runId,
    tasks,
    taskCount: tasks.length,
    launchItemId: tasks[0]?.launchItemId || "",
    modelNumber: tasks[0]?.modelNumber || "",
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;
  if (message.type === CLAIM_MESSAGE) {
    claimOneProduct(text(message.runId)).then(sendResponse).catch((error) => sendResponse({
      ok: false,
      error: "group_canary_claim_exception",
      message: error instanceof Error ? error.message : String(error || "claim failed"),
    }));
    return true;
  }
  if (message.type === ARM_MESSAGE) {
    api({ action: "arm-submit", runId: text(message.runId), goodsKey: text(message.goodsKey) })
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: "group_canary_arm_exception", message: String(error || "arm failed") }));
    return true;
  }
  if (message.type === REPORT_MESSAGE) {
    api({
      action: "report",
      runId: text(message.runId),
      goodsKey: text(message.goodsKey),
      outcome: text(message.outcome),
      reasonCode: text(message.reasonCode),
      message: text(message.message),
    }).then(sendResponse).catch((error) => sendResponse({
      ok: false,
      error: "group_canary_report_exception",
      message: error instanceof Error ? error.message : String(error || "report failed"),
    }));
    return true;
  }
  return false;
});
