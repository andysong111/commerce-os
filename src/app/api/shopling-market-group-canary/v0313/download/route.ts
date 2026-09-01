import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getV0312Package } from "../../v0312/download/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.3.13";

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
    .replaceAll("0.3.12", VERSION)
    .replaceAll("V0312", "V0313")
    .replaceAll("v0312", "v0313");
}

function rewriteContent(source: string) {
  let rewritten = rewriteRuntime(source);

  rewritten = replaceOnce(
    rewritten,
    `(() => {\n  "use strict";`,
    `(() => {\n  "use strict";\n  if (globalThis.__commerceOsShoplingMarketSenderV0313) return;\n  globalThis.__commerceOsShoplingMarketSenderV0313 = true;`,
    "v0313_content_idempotent_guard_anchor_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `  function selectedJobIds(raw) {`,
    `  async function pendingSelectionIntent() {\n    const stored = await storageGet(SELECTION_INTENT_KEY);\n    const intent = stored?.[SELECTION_INTENT_KEY] || null;\n    if (!intent || intent.status !== "pending") return null;\n    const age = Date.now() - Number(intent.createdAt || 0);\n    if (!Number.isFinite(age) || age < 0 || age > SELECTION_INTENT_TTL_MS) return null;\n    return intent;\n  }\n\n  async function navigateControlToA18ForIntent() {\n    const intent = await pendingSelectionIntent();\n    if (!intent || !isAdminShell()) return false;\n    const lastRequestedAt = Number(intent.navigationRequestedAt || 0);\n    if (lastRequestedAt > 0 && Date.now() - lastRequestedAt < 10000) return false;\n\n    const aMenu = buttons(/^\\[?A\\]?\\s*상품$/i, true)[0] || buttons(/\\[A\\].*상품/i, true)[0];\n    if (aMenu) dispatchHover(aMenu);\n    await sleep(250);\n    const a18 = findA18Link();\n    if (!a18) return false;\n\n    await storageSet({\n      [SELECTION_INTENT_KEY]: {\n        ...intent,\n        navigationRequestedAt: Date.now(),\n      },\n    });\n    click(a18);\n    return true;\n  }\n\n  function selectedJobIds(raw) {`,
    "v0313_content_control_navigation_helper_anchor_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `      const context = await workerContext();\n      if (context.worker || window.top !== window || !isProductListUi()) return;\n      await activateSelectionIntent();\n      let queue = await getSelectionQueue();`,
    `      const context = await workerContext();\n      if (context.worker) return;\n      if (!isProductListUi()) {\n        if (window.top === window && isAdminShell()) await navigateControlToA18ForIntent();\n        return;\n      }\n      await activateSelectionIntent();\n      let queue = await getSelectionQueue();`,
    "v0313_content_a18_frame_coordinator_anchor_missing",
  );

  assertScript("content-v0313", rewritten);
  return rewritten;
}

function rewritePopup(source: string) {
  let rewritten = rewriteRuntime(source);

  rewritten = replaceOnce(
    rewritten,
    `    queueRunning = true;\n    statusNode.textContent = "선택 " + jobIds.length + "개 시작 요청 저장 완료 · A18 새로고침 후 자동 실행됩니다.";\n    renderItems();\n    await chrome.tabs.reload(tab.id);`,
    `    queueRunning = true;\n    statusNode.textContent = "선택 " + jobIds.length + "개 시작 요청 저장 완료 · 현재 Shopling 화면에 실행기를 연결합니다.";\n    renderItems();\n    try {\n      await chrome.scripting.executeScript({\n        target: { tabId: tab.id, allFrames: true },\n        files: ["content-group-canary.mjs"],\n      });\n      statusNode.textContent = "선택 " + jobIds.length + "개 시작 요청 전달 완료 · A18에서 자동 실행됩니다.";\n    } catch (injectError) {\n      const message = text(injectError && injectError.message ? injectError.message : injectError);\n      await chrome.storage.local.set({\n        [INTENT_KEY]: {\n          version: VERSION,\n          status: "inject_failed",\n          jobIds: jobIds,\n          createdAt: now,\n          controlTabId: tab.id,\n          error: message,\n        },\n      });\n      throw new Error("A18 실행기 주입 실패: " + message);\n    }`,
    "v0313_popup_no_reload_injection_anchor_missing",
  );

  assertScript("popup-v0313", rewritten);
  return rewritten;
}

export async function GET() {
  const response = await getV0312Package();
  if (!response.ok) throw new Error(`shopling_market_sender_v0312_source_http_${response.status}`);
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));

  const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as {
    version?: string;
    description?: string;
    permissions?: string[];
  };
  if (manifest.version !== "0.3.12") throw new Error("shopling_market_sender_v0313_source_version_mismatch");
  manifest.version = VERSION;
  manifest.description = "Commerce OS SEO 대량등록 Shopling 업로드 선택을 현재 A18 화면/프레임을 새로고침하지 않고 직접 실행기에 주입하며, A18 프레임에서 자동 실행하는 내부 운영 버전입니다.";
  manifest.permissions = [...new Set([...(manifest.permissions || []), "scripting"])];
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  const background = rewriteRuntime(strFromU8(entries["background-root.mjs"]));
  const content = rewriteContent(strFromU8(entries["content-group-canary.mjs"]));
  const popup = rewritePopup(strFromU8(entries["popup.js"]));
  const popupHtml = rewriteRuntime(strFromU8(entries["popup.html"]));

  assertScript("background-v0313", background);

  entries["background-root.mjs"] = strToU8(background);
  entries["content-group-canary.mjs"] = strToU8(content);
  entries["popup.js"] = strToU8(popup);
  entries["popup.html"] = strToU8(popupHtml);
  entries["VERSION.txt"] = strToU8(`Commerce OS Shopling Market Sender v${VERSION}\n`);
  entries["README.txt"] = strToU8(
    `v${VERSION} NO-RELOAD A18 FRAME INJECTOR\n` +
    `- Shopling은 A18이 내부 프레임으로 열려 있어 브라우저 탭 새로고침 시 메인 화면으로 돌아갑니다. 실행 시 탭을 새로고침하지 않습니다.\n` +
    `- 선택 작업은 먼저 Chrome storage의 durable intent로 저장합니다.\n` +
    `- scripting 권한으로 현재 Shopling 탭의 모든 Shopling 프레임에 최신 content 실행기를 직접 주입합니다.\n` +
    `- 실제 A18 상품등록 프레임이 pending intent를 소비해 실행 대기열을 시작합니다. top frame일 필요가 없습니다.\n` +
    `- 이미 최신 실행기가 주입된 프레임은 version sentinel로 중복 타이머/중복 실행을 막습니다.\n` +
    `- 대상 상품은 Commerce OS SEO 대량등록 Shopling 업로드 기록 기준이며 화면에 보이는 행과 무관합니다.\n` +
    `- 상품은 순차 처리, 상품 내부 채널은 3+3 병렬을 유지합니다.\n\n` +
    strFromU8(entries["README.txt"]),
  );

  if (!manifest.permissions.includes("scripting")) throw new Error("v0313_scripting_permission_missing");
  if (!popup.includes("chrome.scripting.executeScript")) throw new Error("v0313_popup_direct_injection_missing");
  if (!popup.includes('target: { tabId: tab.id, allFrames: true }')) throw new Error("v0313_popup_all_frames_injection_missing");
  if (!popup.includes('files: ["content-group-canary.mjs"]')) throw new Error("v0313_popup_content_file_missing");
  if (!content.includes("__commerceOsShoplingMarketSenderV0313")) throw new Error("v0313_content_idempotent_guard_missing");
  if (!content.includes("if (context.worker) return")) throw new Error("v0313_a18_frame_coordinator_guard_missing");
  if (!content.includes("navigateControlToA18ForIntent")) throw new Error("v0313_control_a18_navigation_missing");
  if (content.includes("document.documentElement.appendChild(box)")) throw new Error("v0313_shopling_dom_panel_present");

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
