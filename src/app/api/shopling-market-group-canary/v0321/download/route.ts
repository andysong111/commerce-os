import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getV0320Package } from "../../v0320/download/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.3.21";

function replaceRequired(source: string, anchor: string, replacement: string, code: string) {
  if (!source.includes(anchor)) throw new Error(code);
  return source.replace(anchor, replacement);
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
    .replaceAll("0.3.20", VERSION)
    .replaceAll("V0320", "V0321")
    .replaceAll("v0320", "v0321");
}

function rewriteBackground(source: string) {
  let rewritten = rewriteRuntime(source);
  rewritten = rewritten.replace(
    'const LEGACY_WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0319";',
    'const LEGACY_WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0320";',
  );

  rewritten = replaceRequired(
    rewritten,
    "const RESULT_FRAME_TTL_MS = 5 * 60 * 1000;",
    [
      "const RESULT_FRAME_TTL_MS = 5 * 60 * 1000;",
      "const DIRECT_RESULT_RETRY_MS = 1400;",
      "const DIRECT_RESULT_MAX_ATTEMPTS = 45;",
      "const directResultTimers = new Map();",
      "const directResultAttempts = new Map();",
    ].join("\n"),
    "v0321_background_direct_result_constants_missing",
  );

  const directFunctions = [
    "function scheduleDirectResultReconcile(tabId, delayMs = DIRECT_RESULT_RETRY_MS) {",
    "  if (!Number.isInteger(tabId)) return;",
    "  const existing = directResultTimers.get(tabId);",
    "  if (existing) clearTimeout(existing);",
    "  const timer = setTimeout(() => {",
    "    directResultTimers.delete(tabId);",
    "    void directReconcileResultTab(tabId);",
    "  }, Math.max(250, Number(delayMs) || DIRECT_RESULT_RETRY_MS));",
    "  directResultTimers.set(tabId, timer);",
    "}",
    "",
    "function directResultFrameSnapshot() {",
    "  const normalize = (value) => String(value == null ? '' : value).normalize('NFKC').replace(/\\s+/g, ' ').trim();",
    "  const host = String(location.hostname || '');",
    "  const path = String(location.pathname || '');",
    "  if (!/(?:shopling|cassnet)\\.co\\.kr$/i.test(host) || !/\\/prod\\/rgst\\/[^/]+_rgst\\.phtml$/i.test(path)) return null;",
    "  const raw = String(document.body?.innerText || document.body?.textContent || '');",
    "  const body = normalize(raw);",
    "  let goodsKey = '';",
    "  for (const table of document.querySelectorAll('table')) {",
    "    const rows = [...table.querySelectorAll('tr')];",
    "    for (let index = 0; index < rows.length; index += 1) {",
    "      const headerCells = [...rows[index].querySelectorAll(':scope > th, :scope > td')];",
    "      const goodsIndex = headerCells.findIndex((cell) => /^상품번호$/i.test(normalize(cell.textContent)));",
    "      if (goodsIndex < 0) continue;",
    "      for (let next = index + 1; next < Math.min(rows.length, index + 4); next += 1) {",
    "        const cells = [...rows[next].querySelectorAll(':scope > th, :scope > td')];",
    "        const value = normalize(cells[goodsIndex]?.textContent);",
    "        if (/^\\d{5,9}$/.test(value)) { goodsKey = value; break; }",
    "      }",
    "      if (goodsKey) break;",
    "    }",
    "    if (goodsKey) break;",
    "  }",
    "  const count = (pattern) => { const match = body.match(pattern); return match ? Number(String(match[1]).replace(/,/g, '')) || 0 : 0; };",
    "  const successCount = count(/성공건수\\s*[:：]?\\s*([\\d,]+)/i);",
    "  const failureCount = count(/실패건수\\s*[:：]?\\s*([\\d,]+)/i);",
    "  const resultLike = /성공건수|실패건수|성공여부|상품 등록 전송 결과|쇼핑몰 상품 등록 전송 결과/i.test(body);",
    "  const success = successCount > 0 || /성공여부\\s*성공/i.test(body);",
    "  const failure = failureCount > 0 || /성공여부\\s*실패/i.test(body);",
    "  return {",
    "    kind: 'mall_result_frame',",
    "    goodsKey,",
    "    settled: Boolean(resultLike && goodsKey && (success || failure || successCount === 0 || failureCount === 0)),",
    "    isSelpa: /셀파/i.test(body),",
    "    success,",
    "    failure,",
    "    successCount,",
    "    failureCount,",
    "    href: String(location.href || ''),",
    "  };",
    "}",
    "",
    "async function directReconcileResultTab(tabId) {",
    "  const tab = await chrome.tabs.get(tabId).catch(() => null);",
    "  if (!tab || !isShoplingResultUrl(tab.url)) { directResultAttempts.delete(tabId); return; }",
    "  const attempt = (directResultAttempts.get(tabId) || 0) + 1;",
    "  directResultAttempts.set(tabId, attempt);",
    "  let injected = [];",
    "  try {",
    "    injected = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: directResultFrameSnapshot });",
    "  } catch {",
    "    if (attempt < DIRECT_RESULT_MAX_ATTEMPTS) scheduleDirectResultReconcile(tabId);",
    "    return;",
    "  }",
    "  const frames = injected.map((row) => row?.result).filter((row) => row?.kind === 'mall_result_frame');",
    "  if (!frames.length || frames.some((row) => row.settled !== true || !/^\\d{5,9}$/.test(text(row.goodsKey)))) {",
    "    if (attempt < DIRECT_RESULT_MAX_ATTEMPTS) scheduleDirectResultReconcile(tabId);",
    "    return;",
    "  }",
    "  const keys = [...new Set(frames.map((row) => text(row.goodsKey)))];",
    "  if (keys.length !== 1) {",
    "    if (attempt < DIRECT_RESULT_MAX_ATTEMPTS) scheduleDirectResultReconcile(tabId);",
    "    return;",
    "  }",
    "  const goodsKey = keys[0];",
    "  let meta = await getWorkerMeta();",
    "  let runId = text(meta?.runId);",
    "  let assignment = meta?.assignments?.[goodsKey] || null;",
    "  if (!validRunId(runId) || !assignment) {",
    "    const recovered = await resultContextApi([goodsKey]);",
    "    const context = recovered?.ok && Array.isArray(recovered.contexts) && recovered.contexts.length === 1 ? recovered.contexts[0] : null;",
    "    runId = text(context?.runId);",
    "    if (!validRunId(runId)) {",
    "      if (attempt < DIRECT_RESULT_MAX_ATTEMPTS) scheduleDirectResultReconcile(tabId);",
    "      return;",
    "    }",
    "    meta = await getWorkerMeta();",
    "    assignment = meta?.assignments?.[goodsKey] || null;",
    "  }",
    "  const hasSuccess = frames.some((row) => row.success === true);",
    "  const nonIgnoredFailure = frames.some((row) => row.failure === true && row.isSelpa !== true);",
    "  const anyFailure = frames.some((row) => row.failure === true);",
    "  let outcome = '';",
    "  let reasonCode = '';",
    "  let message = '';",
    "  if (nonIgnoredFailure || (!hasSuccess && anyFailure)) {",
    "    outcome = 'confirm_needed';",
    "    reasonCode = 'shopling_result_background_direct_failure_v0321';",
    "    message = (assignment?.task?.profile || '채널') + ' · background가 cassnet/shopling 결과 프레임 전체에서 비셀파 실패를 확인했습니다. 자동 재송신하지 않습니다.';",
    "  } else if (hasSuccess) {",
    "    outcome = 'sent';",
    "    reasonCode = 'shopling_result_background_direct_success_v0321';",
    "    message = (assignment?.task?.profile || '채널') + ' · background가 cassnet/shopling 결과 프레임 전체를 직접 스캔해 성공을 확인했습니다.';",
    "  } else {",
    "    if (attempt < DIRECT_RESULT_MAX_ATTEMPTS) scheduleDirectResultReconcile(tabId);",
    "    return;",
    "  }",
    "  const reported = await api({ action: 'report', runId, goodsKey, outcome, reasonCode, message });",
    "  if (!reported?.ok) {",
    "    if (attempt < DIRECT_RESULT_MAX_ATTEMPTS) scheduleDirectResultReconcile(tabId);",
    "    return;",
    "  }",
    "  directResultAttempts.delete(tabId);",
    "  if (outcome === 'sent' && assignment) {",
    "    await closeParallelWorker(runId, goodsKey, null, false);",
    "  } else if (outcome === 'confirm_needed' && assignment) {",
    "    await mutateWorkerMeta((latest) => {",
    "      if (!latest || latest.runId !== runId || !latest.assignments?.[goodsKey]) return latest;",
    "      return { ...latest, assignments: { ...latest.assignments, [goodsKey]: { ...latest.assignments[goodsKey], status: 'confirm_needed', updatedAt: Date.now() } }, updatedAt: Date.now() };",
    "    });",
    "  }",
    "}",
    "",
  ].join("\n");

  rewritten = replaceRequired(
    rewritten,
    "chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {",
    directFunctions + "chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {",
    "v0321_background_direct_result_functions_missing",
  );

  rewritten = replaceRequired(
    rewritten,
    [
      "chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {",
      "  if (changeInfo.status !== \"complete\" || !isShoplingResultUrl(tab?.url)) return;",
      "  void injectResultRuntime(tabId);",
      "});",
    ].join("\n"),
    [
      "chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {",
      "  if (changeInfo.status !== \"complete\" || !isShoplingResultUrl(tab?.url)) return;",
      "  void injectResultRuntime(tabId);",
      "  scheduleDirectResultReconcile(tabId, 900);",
      "});",
    ].join("\n"),
    "v0321_background_result_tab_schedule_missing",
  );

  rewritten = replaceRequired(
    rewritten,
    "  resultFrameMutationQueue = operation.catch(() => null);\n  return operation;",
    "  resultFrameMutationQueue = operation.catch(() => null);\n  void operation.then(() => scheduleDirectResultReconcile(sender.tab.id, 650)).catch(() => null);\n  return operation;",
    "v0321_background_evidence_schedule_missing",
  );

  rewritten = replaceRequired(
    rewritten,
    "    if (Number.isInteger(tab?.id) && isShoplingResultUrl(tab?.url)) void injectResultRuntime(tab.id);",
    "    if (Number.isInteger(tab?.id) && isShoplingResultUrl(tab?.url)) { void injectResultRuntime(tab.id); scheduleDirectResultReconcile(tab.id, 900); }",
    "v0321_background_startup_reconcile_missing",
  );

  assertScript("background-v0321", rewritten);
  return rewritten;
}

function rewriteContent(source: string) {
  let rewritten = rewriteRuntime(source);
  rewritten = rewritten
    .replace('const LEGACY_RUN_STATE_KEY = "commerceOsShoplingParallelRunV0319";', 'const LEGACY_RUN_STATE_KEY = "commerceOsShoplingParallelRunV0320";')
    .replace('const LEGACY_WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0319";', 'const LEGACY_WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0320";')
    .replace('const LEGACY_SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0319";', 'const LEGACY_SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0320";')
    .replace('const LEGACY_SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0319";', 'const LEGACY_SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0320";');
  assertScript("content-v0321", rewritten);
  return rewritten;
}

function rewritePopup(source: string) {
  let rewritten = rewriteRuntime(source);
  rewritten = rewritten
    .replace('const LEGACY_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0319";', 'const LEGACY_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0320";')
    .replace('const LEGACY_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0319";', 'const LEGACY_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0320";');
  assertScript("popup-v0321", rewritten);
  return rewritten;
}

export async function GET() {
  const response = await getV0320Package();
  if (!response.ok) throw new Error(`shopling_market_sender_v0320_source_http_${response.status}`);
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));

  const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as { version?: string; description?: string };
  if (manifest.version !== "0.3.20") throw new Error("shopling_market_sender_v0321_source_version_mismatch");
  manifest.version = VERSION;
  manifest.description = "Shopling 결과 부모창에 의존하지 않고 background가 모든 cassnet/shopling 결과 프레임을 직접 스캔해 sent/confirm_needed를 확정하고 다음 3채널을 이어가는 내부 운영 버전입니다.";
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  entries["background-root.mjs"] = strToU8(rewriteBackground(strFromU8(entries["background-root.mjs"])));
  entries["content-group-canary.mjs"] = strToU8(rewriteContent(strFromU8(entries["content-group-canary.mjs"])));
  entries["popup.js"] = strToU8(rewritePopup(strFromU8(entries["popup.js"])));
  entries["popup.html"] = strToU8(rewriteRuntime(strFromU8(entries["popup.html"])));
  entries["VERSION.txt"] = strToU8(`Commerce OS Shopling Market Sender v${VERSION}\n`);

  const previousReadme = strFromU8(entries["README.txt"] || new Uint8Array());
  entries["README.txt"] = strToU8(
    `v0.3.21 BACKGROUND DIRECT RESULT RECONCILIATION\n` +
    `- v0.3.20은 서버 상태를 로컬 처리중에 반영했지만, 결과 parser가 서버를 확정하지 못하면 여전히 처리중이 남을 수 있었습니다.\n` +
    `- background가 결과 탭의 모든 shopling/cassnet child frame DOM을 scripting API로 직접 스캔합니다. 부모 결과창 postMessage에 의존하지 않습니다.\n` +
    `- 모든 결과 frame이 정착한 뒤 성공이면 sent, 비셀파 실패가 하나라도 있으면 confirm_needed로 서버 원장을 직접 확정합니다.\n` +
    `- sent는 작업창을 자동 닫고, confirm_needed는 결과창을 남겨 운영자가 실패 사유를 확인할 수 있습니다.\n` +
    `- 서버 원장 확정 후 v0.3.20 wave reconciliation이 로컬 상태를 복구하여 같은 상품의 다음 3채널 또는 다음 선택상품으로 자동 진행합니다.\n` +
    `- 관리자 A18 원본은 계속 1개만 필요합니다.\n\n` +
    previousReadme,
  );

  const output = zipSync(entries, { level: 0 });
  return new Response(Buffer.from(output), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=commerce-os-shopling-market-sender-v0.3.21.zip",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
