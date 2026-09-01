import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getV0311Package } from "../../v0311/download/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.3.12";

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
    .replaceAll("0.3.11", VERSION)
    .replaceAll("V0311", "V0312")
    .replaceAll("v0311", "v0312");
}

function rewriteContent(source: string) {
  let rewritten = rewriteRuntime(source);

  rewritten = replaceOnce(
    rewritten,
    `  const SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0312";`,
    `  const SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0312";\n  const SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0312";\n  const SELECTION_INTENT_TTL_MS = 90000;`,
    "v0312_content_intent_constants_anchor_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `  async function saveSelectionQueue(queue) {\n    await storageSet({ [SELECTION_QUEUE_KEY]: queue });\n    return queue;\n  }`,
    `  async function saveSelectionQueue(queue) {\n    await storageSet({ [SELECTION_QUEUE_KEY]: queue });\n    return queue;\n  }\n\n  async function activateSelectionIntent() {\n    const stored = await storageGet(SELECTION_INTENT_KEY);\n    const intent = stored?.[SELECTION_INTENT_KEY] || null;\n    if (!intent || intent.status !== "pending") return false;\n\n    const age = Date.now() - Number(intent.createdAt || 0);\n    if (!Number.isFinite(age) || age < 0 || age > SELECTION_INTENT_TTL_MS) {\n      await storageSet({ [SELECTION_INTENT_KEY]: { ...intent, status: "expired", expiredAt: Date.now() } });\n      return false;\n    }\n\n    const jobIds = selectedJobIds(intent.jobIds);\n    if (!jobIds.length) {\n      await storageSet({ [SELECTION_INTENT_KEY]: { ...intent, status: "invalid", finishedAt: Date.now() } });\n      return false;\n    }\n\n    const existing = await getSelectionQueue();\n    if (existing?.status === "running") {\n      await storageSet({ [SELECTION_INTENT_KEY]: { ...intent, status: "ignored_running_queue", finishedAt: Date.now() } });\n      return false;\n    }\n\n    const now = Date.now();\n    await saveSelectionQueue({\n      version: VERSION,\n      status: "running",\n      jobIds,\n      cursor: 0,\n      activeRunId: "",\n      activeJobId: "",\n      activeModelNumber: "",\n      activeTasks: [],\n      attemptedGoodsKeys: [],\n      results: [],\n      waves: [],\n      startedAt: now,\n      updatedAt: now,\n    });\n    await storageSet({ [SELECTION_INTENT_KEY]: { ...intent, status: "consumed", consumedAt: now } });\n    return true;\n  }`,
    "v0312_content_intent_activation_anchor_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `      const context = await workerContext();\n      if (context.worker || window.top !== window || !isProductListUi()) return;\n      let queue = await getSelectionQueue();`,
    `      const context = await workerContext();\n      if (context.worker || window.top !== window || !isProductListUi()) return;\n      await activateSelectionIntent();\n      let queue = await getSelectionQueue();`,
    "v0312_content_intent_tick_anchor_missing",
  );

  assertScript("content-v0312", rewritten);
  return rewritten;
}

function rewritePopup(source: string) {
  let rewritten = rewriteRuntime(source);

  rewritten = replaceOnce(
    rewritten,
    `const QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0312";`,
    `const QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0312";\nconst INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0312";`,
    "v0312_popup_intent_key_anchor_missing",
  );

  const oldStart = `startButton.addEventListener("click", async function () {\n  const jobIds = selectedJobIds();\n  if (!jobIds.length) return;\n  startButton.disabled = true;\n  statusNode.textContent = "A18 최신 실행기 적용을 위해 새로고침 중...";\n  const tab = await activeA18Tab();\n  if (!tab) {\n    statusNode.textContent = "Shopling 관리자 A18 쇼핑몰상품등록 탭을 활성화한 뒤 다시 실행하세요.";\n    updateStartButton();\n    return;\n  }\n  try {\n    const existing = (await chrome.storage.local.get(QUEUE_KEY))[QUEUE_KEY] || null;\n    if (existing && existing.status === "running") {\n      queueRunning = true;\n      statusNode.textContent = "이미 선택 상품 마켓등록이 실행 중입니다.";\n      renderItems();\n      return;\n    }\n\n    await chrome.tabs.reload(tab.id);\n    const loaded = await waitTabComplete(tab.id, 12000);\n    if (!loaded) throw new Error("A18 자동 새로고침이 12초 안에 완료되지 않았습니다.");\n    await sleep(900);\n\n    const now = Date.now();\n    const queue = {\n      version: VERSION,\n      status: "running",\n      jobIds: jobIds,\n      cursor: 0,\n      activeRunId: "",\n      activeJobId: "",\n      activeModelNumber: "",\n      activeTasks: [],\n      attemptedGoodsKeys: [],\n      results: [],\n      waves: [],\n      startedAt: now,\n      updatedAt: now,\n    };\n    await chrome.storage.local.set({ [QUEUE_KEY]: queue });\n\n    queueRunning = true;\n    statusNode.textContent = "선택 " + jobIds.length + "개 실행 대기열 등록 · A18 실행기가 자동 시작합니다.";\n    renderItems();\n  } catch (error) {\n    statusNode.textContent = "A18 실행 준비 실패: " + text(error && error.message ? error.message : error);\n    updateStartButton();\n  }\n});`;

  const newStart = `startButton.addEventListener("click", async function () {\n  const jobIds = selectedJobIds();\n  if (!jobIds.length) return;\n  startButton.disabled = true;\n  statusNode.textContent = "선택 작업을 저장하고 A18 실행기를 갱신합니다...";\n  const tab = await activeA18Tab();\n  if (!tab) {\n    statusNode.textContent = "Shopling 관리자 A18 쇼핑몰상품등록 탭을 활성화한 뒤 다시 실행하세요.";\n    updateStartButton();\n    return;\n  }\n  try {\n    const existing = (await chrome.storage.local.get(QUEUE_KEY))[QUEUE_KEY] || null;\n    if (existing && existing.status === "running") {\n      queueRunning = true;\n      statusNode.textContent = "이미 선택 상품 마켓등록이 실행 중입니다.";\n      renderItems();\n      return;\n    }\n\n    const now = Date.now();\n    await chrome.storage.local.set({\n      [INTENT_KEY]: {\n        version: VERSION,\n        status: "pending",\n        jobIds: jobIds,\n        createdAt: now,\n        controlTabId: tab.id,\n      },\n    });\n\n    queueRunning = true;\n    statusNode.textContent = "선택 " + jobIds.length + "개 시작 요청 저장 완료 · A18 새로고침 후 자동 실행됩니다.";\n    renderItems();\n    await chrome.tabs.reload(tab.id);\n  } catch (error) {\n    queueRunning = false;\n    statusNode.textContent = "A18 실행 준비 실패: " + text(error && error.message ? error.message : error);\n    updateStartButton();\n  }\n});`;

  rewritten = replaceOnce(rewritten, oldStart, newStart, "v0312_popup_durable_intent_start_anchor_missing");
  assertScript("popup-v0312", rewritten);
  return rewritten;
}

export async function GET() {
  const response = await getV0311Package();
  if (!response.ok) throw new Error(`shopling_market_sender_v0311_source_http_${response.status}`);
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));

  const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as { version?: string; description?: string };
  if (manifest.version !== "0.3.11") throw new Error("shopling_market_sender_v0312_source_version_mismatch");
  manifest.version = VERSION;
  manifest.description = "Commerce OS SEO 대량등록 Shopling 업로드 선택을 시작 의도로 먼저 저장하고 A18 새로고침 뒤 실행기가 이를 소비해 자동 시작하는, popup/페이지 생명주기 독립형 내부 운영 버전입니다.";
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  const background = rewriteRuntime(strFromU8(entries["background-root.mjs"]));
  const content = rewriteContent(strFromU8(entries["content-group-canary.mjs"]));
  const popup = rewritePopup(strFromU8(entries["popup.js"]));
  const popupHtml = rewriteRuntime(strFromU8(entries["popup.html"]));

  assertScript("background-v0312", background);

  entries["background-root.mjs"] = strToU8(background);
  entries["content-group-canary.mjs"] = strToU8(content);
  entries["popup.js"] = strToU8(popup);
  entries["popup.html"] = strToU8(popupHtml);
  entries["VERSION.txt"] = strToU8(`Commerce OS Shopling Market Sender v${VERSION}\n`);
  entries["README.txt"] = strToU8(
    `v${VERSION} DURABLE START INTENT\n` +
    `- 선택 버튼을 누르면 먼저 Chrome storage에 시작 의도를 영구 저장한 뒤 A18을 새로고침합니다.\n` +
    `- 새로고침 중 확장 팝업이 닫혀도 시작 요청은 사라지지 않습니다.\n` +
    `- 새 A18 content script가 로드되면 90초 이내의 pending 시작 의도를 자동 소비해 실행 대기열로 승격합니다.\n` +
    `- popup↔A18 message port 응답과 popup 생명주기에 시작 성공 여부가 의존하지 않습니다.\n` +
    `- 대상 선정은 Commerce OS SEO 대량등록 Shopling 업로드 기록이며 A18 화면 상품목록과 무관합니다.\n` +
    `- 상품은 순차 처리하고 각 상품은 도매1~소매2를 최대 3채널씩 3+3으로 실행합니다.\n\n` +
    strFromU8(entries["README.txt"]),
  );

  if (!popup.includes("[INTENT_KEY]")) throw new Error("v0312_popup_intent_write_missing");
  if (!popup.includes("status: \"pending\"")) throw new Error("v0312_popup_pending_intent_missing");
  if (!popup.includes("await chrome.tabs.reload(tab.id)")) throw new Error("v0312_popup_reload_missing");
  if (!content.includes("activateSelectionIntent")) throw new Error("v0312_content_intent_activation_missing");
  if (!content.includes("SELECTION_INTENT_TTL_MS = 90000")) throw new Error("v0312_content_intent_ttl_missing");
  if (!content.includes("status: \"consumed\"")) throw new Error("v0312_content_intent_consumed_missing");
  if (content.includes("document.documentElement.appendChild(box)")) throw new Error("v0312_shopling_dom_panel_present");

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
