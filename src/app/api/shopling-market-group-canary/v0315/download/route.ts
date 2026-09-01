import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getV0314Package } from "../../v0314/download/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.3.15";

function replaceOnce(source: string, anchor: string, replacement: string, code: string) {
  const first = source.indexOf(anchor);
  if (first < 0) throw new Error(code);
  if (source.indexOf(anchor, first + anchor.length) >= 0) throw new Error(`${code}_ambiguous`);
  return `${source.slice(0, first)}${replacement}${source.slice(first + anchor.length)}`;
}

function assertScript(name: string, source: string) {
  try {
    new Function(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "syntax error");
    throw new Error(`shopling_market_sender_${name}_invalid: ${message}`);
  }
}

function rewriteRuntime(source: string) {
  return source
    .replaceAll("0.3.14", VERSION)
    .replaceAll("V0314", "V0315")
    .replaceAll("v0314", "v0315");
}

function rewriteBackground(source: string) {
  let rewritten = rewriteRuntime(source);

  rewritten = replaceOnce(
    rewritten,
    `const WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0315";`,
    `const WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0315";\nconst LEGACY_WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0314";`,
    "v0315_background_legacy_meta_constant_missing",
  );

  const oldGetWorkerMeta = `function getWorkerMeta() {\n  return new Promise((resolve) => {\n    chrome.storage.local.get(WORKER_META_KEY, (stored) => {\n      void chrome.runtime.lastError;\n      resolve(stored?.[WORKER_META_KEY] || null);\n    });\n  });\n}`;
  const newGetWorkerMeta = `function getWorkerMeta() {\n  return new Promise((resolve) => {\n    chrome.storage.local.get([WORKER_META_KEY, LEGACY_WORKER_META_KEY], (stored) => {\n      void chrome.runtime.lastError;\n      const current = stored?.[WORKER_META_KEY] || null;\n      if (current) { resolve(current); return; }\n      const legacy = stored?.[LEGACY_WORKER_META_KEY] || null;\n      if (!legacy) { resolve(null); return; }\n      chrome.storage.local.set({ [WORKER_META_KEY]: legacy }, () => {\n        void chrome.runtime.lastError;\n        resolve(legacy);\n      });\n    });\n  });\n}`;
  rewritten = replaceOnce(rewritten, oldGetWorkerMeta, newGetWorkerMeta, "v0315_background_meta_migration_anchor_missing");

  rewritten = replaceOnce(
    rewritten,
    `chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {`,
    `function isShoplingResultUrl(url) {\n  try {\n    const parsed = new URL(String(url || ""));\n    if (!/shopling\\.co\\.kr$/i.test(parsed.hostname)) return false;\n    return /\\/prod_a\\/prod_rgst_(?:rspt|tsrmt)\\.phtml$/i.test(parsed.pathname)\n      || /\\/prod\\/rgst\\/[^/]+_rgst\\.phtml$/i.test(parsed.pathname);\n  } catch {\n    return false;\n  }\n}\n\nasync function injectResultRuntime(tabId) {\n  if (!Number.isInteger(tabId)) return;\n  try {\n    await chrome.scripting.executeScript({\n      target: { tabId, allFrames: true },\n      files: ["content-group-canary.mjs"],\n    });\n  } catch {\n    // Result pages can disappear quickly after a successful report.\n  }\n}\n\nchrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {\n  if (changeInfo.status !== "complete" || !isShoplingResultUrl(tab?.url)) return;\n  void injectResultRuntime(tabId);\n});\n\nvoid chrome.tabs.query({}).then((tabs) => {\n  for (const tab of tabs) {\n    if (Number.isInteger(tab?.id) && isShoplingResultUrl(tab?.url)) void injectResultRuntime(tab.id);\n  }\n}).catch(() => null);\n\nchrome.runtime.onMessage.addListener((message, sender, sendResponse) => {`,
    "v0315_background_result_injector_anchor_missing",
  );

  assertScript("background-v0315", rewritten);
  return rewritten;
}

function rewriteContent(source: string) {
  let rewritten = rewriteRuntime(source);

  rewritten = replaceOnce(
    rewritten,
    `  const RUN_STATE_KEY = "commerceOsShoplingParallelRunV0315";\n  const WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0315";`,
    `  const RUN_STATE_KEY = "commerceOsShoplingParallelRunV0315";\n  const WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0315";\n  const LEGACY_RUN_STATE_KEY = "commerceOsShoplingParallelRunV0314";\n  const LEGACY_WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0314";`,
    "v0315_content_legacy_run_constants_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `  const SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0315";\n  const SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0315";`,
    `  const SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0315";\n  const SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0315";\n  const LEGACY_SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0314";\n  const LEGACY_SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0314";`,
    "v0315_content_legacy_selection_constants_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `  function workerStateKey(runId, goodsKey) {`,
    `  async function migrateLegacyRuntimeState() {\n    const all = await storageGet(null);\n    const writes = {};\n    if (!all[RUN_STATE_KEY] && all[LEGACY_RUN_STATE_KEY]) writes[RUN_STATE_KEY] = { ...all[LEGACY_RUN_STATE_KEY], version: VERSION };\n    if (!all[SELECTION_QUEUE_KEY] && all[LEGACY_SELECTION_QUEUE_KEY]) writes[SELECTION_QUEUE_KEY] = { ...all[LEGACY_SELECTION_QUEUE_KEY], version: VERSION };\n    if (!all[SELECTION_INTENT_KEY] && all[LEGACY_SELECTION_INTENT_KEY]) writes[SELECTION_INTENT_KEY] = { ...all[LEGACY_SELECTION_INTENT_KEY], version: VERSION };\n    for (const key of Object.keys(all)) {\n      if (!key.startsWith(LEGACY_WORKER_STATE_PREFIX + ":")) continue;\n      const nextKey = WORKER_STATE_PREFIX + ":" + key.slice(LEGACY_WORKER_STATE_PREFIX.length + 1);\n      if (!all[nextKey]) writes[nextKey] = { ...all[key], version: VERSION };\n    }\n    if (Object.keys(writes).length) await storageSet(writes);\n    return writes;\n  }\n\n  function workerStateKey(runId, goodsKey) {`,
    "v0315_content_state_migration_anchor_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `      const state = await getWorkerState(context.runId, context.goodsKey);\n      if (!state || state.status !== "running") return;`,
    `      let state = await getWorkerState(context.runId, context.goodsKey);\n      if (!state || state.status !== "running") return;\n      if (isSubmitResultPage() && state.stage === "submit_armed") {\n        const recovered = await patchWorkerState(state, {\n          stage: "submit_clicked",\n          submitClickedAt: Number(state.submitClickedAt || state.submitArmedAt || Date.now()),\n          stepAt: Date.now(),\n          message: state.task.profile + " Shopling 결과 페이지에서 submit_clicked 상태를 복구했습니다.",\n        });\n        if (recovered) state = recovered;\n      }`,
    "v0315_content_submit_stage_recovery_anchor_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `  timer = setInterval(() => void drive(), 800);\n  panelTimer = setInterval(() => void selectedCoordinatorTick(), 1200);\n  void drive();\n  void selectedCoordinatorTick();`,
    `  void migrateLegacyRuntimeState();\n  timer = setInterval(() => void drive(), 800);\n  panelTimer = setInterval(() => void selectedCoordinatorTick(), 1200);\n  setTimeout(() => void drive(), 120);\n  setTimeout(() => void selectedCoordinatorTick(), 180);`,
    "v0315_content_migration_start_anchor_missing",
  );

  assertScript("content-v0315", rewritten);
  return rewritten;
}

function rewritePopup(source: string) {
  let rewritten = rewriteRuntime(source);

  rewritten = replaceOnce(
    rewritten,
    `const QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0315";\nconst INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0315";`,
    `const QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0315";\nconst INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0315";\nconst LEGACY_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0314";\nconst LEGACY_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0314";`,
    "v0315_popup_legacy_keys_anchor_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `async function refreshQueueStatus() {`,
    `async function migrateLegacyPopupState() {\n  const stored = await chrome.storage.local.get([QUEUE_KEY, INTENT_KEY, LEGACY_QUEUE_KEY, LEGACY_INTENT_KEY]);\n  const writes = {};\n  if (!stored[QUEUE_KEY] && stored[LEGACY_QUEUE_KEY]) writes[QUEUE_KEY] = { ...stored[LEGACY_QUEUE_KEY], version: VERSION };\n  if (!stored[INTENT_KEY] && stored[LEGACY_INTENT_KEY]) writes[INTENT_KEY] = { ...stored[LEGACY_INTENT_KEY], version: VERSION };\n  if (Object.keys(writes).length) await chrome.storage.local.set(writes);\n}\n\nasync function refreshQueueStatus() {`,
    "v0315_popup_migration_function_anchor_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `loadItems();`,
    `migrateLegacyPopupState().then(loadItems).catch(loadItems);`,
    "v0315_popup_migration_start_anchor_missing",
  );

  assertScript("popup-v0315", rewritten);
  return rewritten;
}

export async function GET() {
  const response = await getV0314Package();
  if (!response.ok) throw new Error(`shopling_market_sender_v0314_source_http_${response.status}`);
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));

  const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as { version?: string; description?: string };
  if (manifest.version !== "0.3.14") throw new Error("shopling_market_sender_v0315_source_version_mismatch");
  manifest.version = VERSION;
  manifest.description = "Commerce OS Shopling 결과 팝업 자동 재주입, submit 상태 복구, v0.3.14 실행상태 이관으로 결과확정을 끝까지 이어가는 내부 운영 버전입니다.";
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  const background = rewriteBackground(strFromU8(entries["background-root.mjs"]));
  const content = rewriteContent(strFromU8(entries["content-group-canary.mjs"]));
  const popup = rewritePopup(strFromU8(entries["popup.js"]));
  const popupHtml = rewriteRuntime(strFromU8(entries["popup.html"]));

  entries["background-root.mjs"] = strToU8(background);
  entries["content-group-canary.mjs"] = strToU8(content);
  entries["popup.js"] = strToU8(popup);
  entries["popup.html"] = strToU8(popupHtml);
  entries["VERSION.txt"] = strToU8(`Commerce OS Shopling Market Sender v${VERSION}\n`);
  entries["README.txt"] = strToU8(
    `v${VERSION} RESILIENT RESULT RECOVERY\n` +
    `- Shopling 결과 팝업/결과 탭이 열리면 background가 최신 결과 실행기를 모든 프레임에 자동 재주입합니다.\n` +
    `- 확장 업데이트 시 v0.3.14의 실행 queue, intent, worker state, worker assignment를 v0.3.15로 자동 이관합니다.\n` +
    `- 결과 페이지가 열렸는데 로컬 stage가 submit_armed에 남아 있으면 실제 결과 페이지 존재를 근거로 submit_clicked 상태를 복구한 뒤 결과판정을 계속합니다.\n` +
    `- 기존 goods_key 기반 결과 문맥 복구와 비셀파 실패 안전정책을 유지합니다.\n` +
    `- 상품은 순차 처리, 상품 내부 채널은 3+3 병렬을 유지합니다.\n\n` +
    strFromU8(entries["README.txt"]),
  );

  for (const [name, value] of [["background", background], ["content", content], ["popup", popup]] as const) assertScript(`${name}-v0315`, value);
  if (!background.includes("LEGACY_WORKER_META_KEY")) throw new Error("v0315_legacy_worker_meta_missing");
  if (!background.includes("chrome.tabs.onUpdated.addListener")) throw new Error("v0315_result_tab_listener_missing");
  if (!background.includes("chrome.scripting.executeScript")) throw new Error("v0315_result_reinject_missing");
  if (!content.includes("migrateLegacyRuntimeState")) throw new Error("v0315_runtime_migration_missing");
  if (!content.includes('state.stage === "submit_armed"')) throw new Error("v0315_submit_stage_recovery_missing");
  if (!popup.includes("migrateLegacyPopupState")) throw new Error("v0315_popup_migration_missing");
  if (content.includes("document.documentElement.appendChild(box)")) throw new Error("v0315_shopling_dom_panel_present");

  const archive = zipSync(entries, { level: 0 });
  return new Response(Buffer.from(archive), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename=commerce-os-shopling-market-sender-v${VERSION}.zip`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
