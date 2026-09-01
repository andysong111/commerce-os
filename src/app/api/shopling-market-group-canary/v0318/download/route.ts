import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getV0317Package } from "../../v0317/download/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.3.18";

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
    .replaceAll("0.3.17", VERSION)
    .replaceAll("V0317", "V0318")
    .replaceAll("v0317", "v0318");
}

function rewriteBackground(source: string) {
  let rewritten = rewriteRuntime(source);

  rewritten = replaceOnce(
    rewritten,
    `const RESULT_CONTEXT_BRIDGE = "shopling-market-result-context-v0.1";`,
    `const RESULT_CONTEXT_BRIDGE = "shopling-market-result-context-v0.1";\nconst RESULT_FRAME_PUSH_MESSAGE = "commerce-os-shopling-result-frame-push-v0318";\nconst RESULT_FRAME_PULL_MESSAGE = "commerce-os-shopling-result-frame-pull-v0318";\nconst RESULT_FRAME_STORE_KEY = "commerceOsShoplingResultFrameStoreV0318";\nconst RESULT_FRAME_TTL_MS = 5 * 60 * 1000;`,
    "v0318_background_result_bus_constants_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `let metaMutationQueue = Promise.resolve();`,
    `let metaMutationQueue = Promise.resolve();\nlet resultFrameMutationQueue = Promise.resolve();`,
    "v0318_background_result_bus_queue_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `const LEGACY_WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0314";`,
    `const LEGACY_WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0317";`,
    "v0318_background_legacy_meta_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `async function verifyWorkerMessage(runId, goodsKey, sender) {`,
    `function normalizeResultFrameEvidence(raw) {\n  const goodsKey = text(raw?.goodsKey);\n  const frameId = text(raw?.frameId);\n  if (!/^\\d{5,9}$/.test(goodsKey) || !frameId) return null;\n  return {\n    goodsKey,\n    frameId: frameId.slice(0, 500),\n    isSelpa: raw?.isSelpa === true,\n    success: raw?.success === true,\n    failure: raw?.failure === true,\n    successCount: Math.max(0, Number(raw?.successCount || 0) || 0),\n    failureCount: Math.max(0, Number(raw?.failureCount || 0) || 0),\n    capturedAt: Number(raw?.capturedAt || Date.now()),\n  };\n}\n\nasync function storeResultFrameEvidence(sender, rawEvidence) {\n  if (!Number.isInteger(sender?.tab?.id)) return { ok: false, error: "result_frame_tab_missing" };\n  const evidence = normalizeResultFrameEvidence(rawEvidence);\n  if (!evidence) return { ok: false, error: "result_frame_evidence_invalid" };\n  const tabKey = String(sender.tab.id);\n  const entryKey = evidence.goodsKey + "|" + evidence.frameId;\n  const operation = resultFrameMutationQueue.then(async () => {\n    const stored = await chrome.storage.local.get(RESULT_FRAME_STORE_KEY);\n    const root = stored?.[RESULT_FRAME_STORE_KEY] && typeof stored[RESULT_FRAME_STORE_KEY] === "object"\n      ? { ...stored[RESULT_FRAME_STORE_KEY] }\n      : {};\n    const now = Date.now();\n    for (const [key, tabEntries] of Object.entries(root)) {\n      if (!tabEntries || typeof tabEntries !== "object") { delete root[key]; continue; }\n      const pruned = {};\n      for (const [candidateKey, row] of Object.entries(tabEntries)) {\n        const capturedAt = Number(row?.capturedAt || 0);\n        if (capturedAt > 0 && now - capturedAt <= RESULT_FRAME_TTL_MS) pruned[candidateKey] = row;\n      }\n      if (Object.keys(pruned).length) root[key] = pruned;\n      else delete root[key];\n    }\n    root[tabKey] = { ...(root[tabKey] || {}), [entryKey]: evidence };\n    await chrome.storage.local.set({ [RESULT_FRAME_STORE_KEY]: root });\n    return { ok: true };\n  });\n  resultFrameMutationQueue = operation.catch(() => null);\n  return operation;\n}\n\nasync function readResultFrameEvidence(sender) {\n  if (!Number.isInteger(sender?.tab?.id)) return { ok: true, evidence: [] };\n  const stored = await chrome.storage.local.get(RESULT_FRAME_STORE_KEY);\n  const root = stored?.[RESULT_FRAME_STORE_KEY] || {};\n  const tabEntries = root?.[String(sender.tab.id)] || {};\n  const now = Date.now();\n  const evidence = Object.values(tabEntries).filter((row) => {\n    const capturedAt = Number(row?.capturedAt || 0);\n    return capturedAt > 0 && now - capturedAt <= RESULT_FRAME_TTL_MS;\n  });\n  return { ok: true, evidence };\n}\n\nasync function verifyWorkerMessage(runId, goodsKey, sender) {`,
    "v0318_background_result_bus_helpers_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `  if (message.type === CLOSE_WORKER_MESSAGE) {`,
    `  if (message.type === RESULT_FRAME_PUSH_MESSAGE) {\n    storeResultFrameEvidence(sender, message.evidence).then(sendResponse).catch((error) => sendResponse({\n      ok: false,\n      error: "result_frame_store_failed",\n      message: String(error?.message || error),\n    }));\n    return true;\n  }\n\n  if (message.type === RESULT_FRAME_PULL_MESSAGE) {\n    readResultFrameEvidence(sender).then(sendResponse).catch((error) => sendResponse({\n      ok: false,\n      evidence: [],\n      error: "result_frame_read_failed",\n      message: String(error?.message || error),\n    }));\n    return true;\n  }\n\n  if (message.type === CLOSE_WORKER_MESSAGE) {`,
    "v0318_background_result_bus_listener_missing",
  );

  assertScript("background-v0318", rewritten);
  return rewritten;
}

function rewriteContent(source: string) {
  let rewritten = rewriteRuntime(source);

  rewritten = replaceOnce(
    rewritten,
    `  const RESULT_FRAME_MESSAGE = "commerce-os-shopling-result-frame-evidence-v0318";`,
    `  const RESULT_FRAME_MESSAGE = "commerce-os-shopling-result-frame-evidence-v0318";\n  const RESULT_FRAME_PUSH_MESSAGE = "commerce-os-shopling-result-frame-push-v0318";\n  const RESULT_FRAME_PULL_MESSAGE = "commerce-os-shopling-result-frame-pull-v0318";`,
    "v0318_content_result_bus_constants_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `  const LEGACY_RUN_STATE_KEY = "commerceOsShoplingParallelRunV0314";`,
    `  const LEGACY_RUN_STATE_KEY = "commerceOsShoplingParallelRunV0317";`,
    "v0318_content_legacy_run_missing",
  );
  rewritten = replaceOnce(
    rewritten,
    `  const LEGACY_WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0314";`,
    `  const LEGACY_WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0317";`,
    "v0318_content_legacy_worker_missing",
  );
  rewritten = replaceOnce(
    rewritten,
    `  const LEGACY_SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0314";`,
    `  const LEGACY_SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0317";`,
    "v0318_content_legacy_queue_missing",
  );
  rewritten = replaceOnce(
    rewritten,
    `  const LEGACY_SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0314";`,
    `  const LEGACY_SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0317";`,
    "v0318_content_legacy_intent_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `  let selectionCoordinating = false;\n  const resultFrameBus = new Map();`,
    `  let selectionCoordinating = false;\n  const resultFrameBus = new Map();\n  let lastResultEvidenceSignature = "";`,
    "v0318_content_evidence_signature_missing",
  );

  const oldProductList = `  function isProductListUi() {\n    if (location.hostname !== "a.shopling.co.kr") return false;\n    if (isIdChoicePage() || isPreProdChoicePage() || isSubmitResultPage()) return false;\n    const body = bodyText();\n    return /쇼핑몰\\s*상품등록(?:하기)?/i.test(body)\n      && /쇼핑몰\\s*미등록\\s*검색/i.test(body)\n      && /총\\s*조회수\\s*[:：]?\\s*[\\d,]+\\s*건/i.test(body);\n  }`;
  const newProductList = `  function isProductListUi() {\n    if (location.hostname !== "a.shopling.co.kr") return false;\n    if (isIdChoicePage() || isPreProdChoicePage() || isSubmitResultPage()) return false;\n    const body = bodyText();\n    return /쇼핑몰\\s*상품등록(?:하기)?/i.test(body)\n      && /쇼핑몰\\s*미등록\\s*검색/i.test(body);\n  }`;
  rewritten = replaceOnce(rewritten, oldProductList, newProductList, "v0318_content_a18_zero_search_recognition_missing");

  const oldCollected = `  async function collectedMallEvidence(state) {\n    const all = await storageGet(null);\n    const prefix = \`commerceOsShoplingParallelResultV0318:\${state.runId}:\${state.task.goodsKey}:\`;\n    const merged = new Map();\n    for (const key of Object.keys(all).filter((key) => key.startsWith(prefix))) {\n      const row = all[key];\n      if (row?.frameId) merged.set(row.frameId, row);\n    }\n    for (const row of resultFrameBus.values()) {\n      if (row?.goodsKey === state.task.goodsKey && row?.frameId) merged.set(row.frameId, row);\n    }\n    return [...merged.values()];\n  }`;
  const newCollected = `  async function collectedMallEvidence(state) {\n    const all = await storageGet(null);\n    const prefix = \`commerceOsShoplingParallelResultV0318:\${state.runId}:\${state.task.goodsKey}:\`;\n    const merged = new Map();\n    for (const key of Object.keys(all).filter((key) => key.startsWith(prefix))) {\n      const row = all[key];\n      if (row?.frameId) merged.set(row.frameId, row);\n    }\n    for (const row of resultFrameBus.values()) {\n      if (row?.goodsKey === state.task.goodsKey && row?.frameId) merged.set(row.frameId, row);\n    }\n    const shared = await sendMessage({ type: RESULT_FRAME_PULL_MESSAGE });\n    for (const row of Array.isArray(shared?.evidence) ? shared.evidence : []) {\n      if (text(row?.goodsKey) === state.task.goodsKey && row?.frameId) merged.set(text(row.frameId), row);\n    }\n    return [...merged.values()];\n  }`;
  rewritten = replaceOnce(rewritten, oldCollected, newCollected, "v0318_content_collect_shared_evidence_missing");

  rewritten = replaceOnce(
    rewritten,
    `  function broadcastMallResultEvidence(snapshot = mallResultSnapshot()) {`,
    `  async function persistMallResultEvidence(snapshot) {\n    if (!snapshot) return false;\n    const signature = [snapshot.goodsKey, snapshot.frameId, snapshot.successCount, snapshot.failureCount, snapshot.success, snapshot.failure].join("|");\n    if (signature === lastResultEvidenceSignature) return true;\n    lastResultEvidenceSignature = signature;\n    const response = await sendMessage({ type: RESULT_FRAME_PUSH_MESSAGE, evidence: snapshot });\n    return response?.ok === true;\n  }\n\n  function broadcastMallResultEvidence(snapshot = mallResultSnapshot()) {`,
    "v0318_content_persist_result_evidence_missing",
  );

  const oldResultKeys = `  function resultContextGoodsKeys() {\n    if (!isSubmitResultPage() && !isMallResultFrame()) return [];\n    const exact = exactMallResultGoodsKey();\n    const body = bodyText();\n    const generic = [...body.matchAll(/(?:^|\\D)(\\d{5,9})(?=\\D|$)/g)].map((match) => match[1]);\n    const busKeys = isSubmitResultPage()\n      ? [...resultFrameBus.values()].map((row) => text(row?.goodsKey))\n      : [];\n    return [...new Set([exact, ...busKeys, ...generic].filter((value) => /^\\d{5,9}$/.test(value)))].slice(0, 20);\n  }`;
  const newResultKeys = `  async function resultContextGoodsKeys() {\n    if (!isSubmitResultPage() && !isMallResultFrame()) return [];\n    const exact = exactMallResultGoodsKey();\n    const body = bodyText();\n    const generic = [...body.matchAll(/(?:^|\\D)(\\d{5,9})(?=\\D|$)/g)].map((match) => match[1]);\n    const busKeys = isSubmitResultPage()\n      ? [...resultFrameBus.values()].map((row) => text(row?.goodsKey))\n      : [];\n    const shared = await sendMessage({ type: RESULT_FRAME_PULL_MESSAGE });\n    const sharedKeys = Array.isArray(shared?.evidence)\n      ? shared.evidence.map((row) => text(row?.goodsKey))\n      : [];\n    return [...new Set([exact, ...busKeys, ...sharedKeys, ...generic].filter((value) => /^\\d{5,9}$/.test(value)))].slice(0, 20);\n  }`;
  rewritten = replaceOnce(rewritten, oldResultKeys, newResultKeys, "v0318_content_result_context_shared_bus_missing");

  rewritten = replaceOnce(
    rewritten,
    `    const candidateGoodsKeys = resultContextGoodsKeys();`,
    `    const candidateGoodsKeys = await resultContextGoodsKeys();`,
    "v0318_content_worker_context_async_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `      if (isMallResultFrame()) broadcastMallResultEvidence();\n      const context = await workerContext();`,
    `      if (isMallResultFrame()) {\n        const snapshot = mallResultSnapshot();\n        if (snapshot) {\n          broadcastMallResultEvidence(snapshot);\n          await persistMallResultEvidence(snapshot);\n        }\n      }\n      const context = await workerContext();`,
    "v0318_content_drive_durable_evidence_missing",
  );

  assertScript("content-v0318", rewritten);
  return rewritten;
}

function rewritePopup(source: string) {
  let rewritten = rewriteRuntime(source);
  rewritten = replaceOnce(
    rewritten,
    `const LEGACY_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0314";`,
    `const LEGACY_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0317";`,
    "v0318_popup_legacy_queue_missing",
  );
  rewritten = replaceOnce(
    rewritten,
    `const LEGACY_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0314";`,
    `const LEGACY_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0317";`,
    "v0318_popup_legacy_intent_missing",
  );
  assertScript("popup-v0318", rewritten);
  return rewritten;
}

export async function GET() {
  const response = await getV0317Package();
  if (!response.ok) throw new Error(`shopling_market_sender_v0317_source_http_${response.status}`);
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));

  const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as { version?: string; description?: string };
  if (manifest.version !== "0.3.17") throw new Error("shopling_market_sender_v0318_source_version_mismatch");
  manifest.version = VERSION;
  manifest.description = "Shopling 결과 child frame 증거를 탭 단위 Chrome storage 버스로 공유해 sent/confirm_needed 자동확정을 안정화하고, A18 최초 검색 전 빈 화면에서도 자동 검색부터 시작하는 내부 운영 버전입니다.";
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  entries["background-root.mjs"] = strToU8(rewriteBackground(strFromU8(entries["background-root.mjs"])));
  entries["content-group-canary.mjs"] = strToU8(rewriteContent(strFromU8(entries["content-group-canary.mjs"])));
  entries["popup.js"] = strToU8(rewritePopup(strFromU8(entries["popup.js"])));
  entries["popup.html"] = strToU8(rewriteRuntime(strFromU8(entries["popup.html"])));
  entries["VERSION.txt"] = strToU8(`Commerce OS Shopling Market Sender v${VERSION}\n`);

  const previousReadme = strFromU8(entries["README.txt"] || new Uint8Array());
  entries["README.txt"] = strToU8(
    `v0.3.18 DURABLE RESULT BUS + ZERO-SEARCH A18 START\n` +
    `- 각 쇼핑몰 결과 child frame이 goods_key와 성공/실패 증거를 background의 탭 단위 Chrome storage 버스에 기록합니다.\n` +
    `- 부모 결과창은 같은 탭의 증거만 읽으므로 3개 병렬 결과창이 동시에 떠도 서로 다른 goods_key가 섞이지 않습니다.\n` +
    `- 결과 팝업 opener 문맥이 끊겨도 같은 탭 증거의 goods_key로 Commerce OS 서버 원장을 복구해 sent/confirm_needed를 확정합니다.\n` +
    `- A18 최초 진입 직후 총 조회수가 아직 표시되지 않아도 쇼핑몰상품등록 + 쇼핑몰 미등록 검색 영역만 확인되면 자동 검색을 시작합니다. 사용자가 검색 버튼을 먼저 누를 필요가 없습니다.\n` +
    `- v0.3.17 실행 queue/worker/meta를 이관해 열린 결과창을 재설치 후에도 회수합니다.\n\n` +
    previousReadme,
  );

  const output = zipSync(entries, { level: 0 });
  return new Response(Buffer.from(output), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=commerce-os-shopling-market-sender-v0.3.18.zip",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
