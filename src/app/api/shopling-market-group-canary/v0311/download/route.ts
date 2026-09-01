import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getV0310Package } from "../../v0310/download/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.3.11";

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
    .replaceAll("0.3.10", VERSION)
    .replaceAll("V0310", "V0311")
    .replaceAll("v0310", "v0311");
}

function rewritePopup(source: string) {
  let rewritten = rewriteRuntime(source);

  const oldStart = `startButton.addEventListener("click", async function () {\n  const jobIds = selectedJobIds();\n  if (!jobIds.length) return;\n  startButton.disabled = true;\n  statusNode.textContent = "A18 실행 템플릿 확인 중...";\n  const tab = await activeA18Tab();\n  if (!tab) {\n    statusNode.textContent = "Shopling 관리자 A18 쇼핑몰상품등록 탭을 활성화한 뒤 다시 실행하세요.";\n    updateStartButton();\n    return;\n  }\n  try {\n    const started = await startWithA18Recovery(tab, jobIds);\n    if (!started.ok) {\n      statusNode.textContent = text(started.response && (started.response.message || started.response.error)) || text(started.error) || "A18 실행기에 시작 신호를 전달하지 못했습니다.";\n      updateStartButton();\n      return;\n    }\n    queueRunning = true;\n    statusNode.textContent = "선택 " + jobIds.length + "개 등록 시작 · 상품별 3+3 채널 처리";\n    renderItems();\n  } catch (error) {\n    statusNode.textContent = "A18 자동 복구 실패: " + text(error && error.message ? error.message : error);\n    updateStartButton();\n  }\n});`;

  const newStart = `startButton.addEventListener("click", async function () {\n  const jobIds = selectedJobIds();\n  if (!jobIds.length) return;\n  startButton.disabled = true;\n  statusNode.textContent = "A18 최신 실행기 적용을 위해 새로고침 중...";\n  const tab = await activeA18Tab();\n  if (!tab) {\n    statusNode.textContent = "Shopling 관리자 A18 쇼핑몰상품등록 탭을 활성화한 뒤 다시 실행하세요.";\n    updateStartButton();\n    return;\n  }\n  try {\n    const existing = (await chrome.storage.local.get(QUEUE_KEY))[QUEUE_KEY] || null;\n    if (existing && existing.status === "running") {\n      queueRunning = true;\n      statusNode.textContent = "이미 선택 상품 마켓등록이 실행 중입니다.";\n      renderItems();\n      return;\n    }\n\n    await chrome.tabs.reload(tab.id);\n    const loaded = await waitTabComplete(tab.id, 12000);\n    if (!loaded) throw new Error("A18 자동 새로고침이 12초 안에 완료되지 않았습니다.");\n    await sleep(900);\n\n    const now = Date.now();\n    const queue = {\n      version: VERSION,\n      status: "running",\n      jobIds: jobIds,\n      cursor: 0,\n      activeRunId: "",\n      activeJobId: "",\n      activeModelNumber: "",\n      activeTasks: [],\n      attemptedGoodsKeys: [],\n      results: [],\n      waves: [],\n      startedAt: now,\n      updatedAt: now,\n    };\n    await chrome.storage.local.set({ [QUEUE_KEY]: queue });\n\n    queueRunning = true;\n    statusNode.textContent = "선택 " + jobIds.length + "개 실행 대기열 등록 · A18 실행기가 자동 시작합니다.";\n    renderItems();\n  } catch (error) {\n    statusNode.textContent = "A18 실행 준비 실패: " + text(error && error.message ? error.message : error);\n    updateStartButton();\n  }\n});`;

  rewritten = replaceOnce(rewritten, oldStart, newStart, "v0311_popup_direct_queue_start_anchor_missing");
  assertScript("popup-v0311", rewritten);
  return rewritten;
}

export async function GET() {
  const response = await getV0310Package();
  if (!response.ok) throw new Error(`shopling_market_sender_v0310_source_http_${response.status}`);
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));

  const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as { version?: string; description?: string };
  if (manifest.version !== "0.3.10") throw new Error("shopling_market_sender_v0311_source_version_mismatch");
  manifest.version = VERSION;
  manifest.description = "Commerce OS SEO 대량등록 Shopling 업로드 목록을 체크해 마켓등록하며, 시작 신호를 message port에 의존하지 않고 A18 새로고침 후 공유 대기열로 직접 시작하는 내부 운영 버전입니다.";
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  const background = rewriteRuntime(strFromU8(entries["background-root.mjs"]));
  const content = rewriteRuntime(strFromU8(entries["content-group-canary.mjs"]));
  const popup = rewritePopup(strFromU8(entries["popup.js"]));
  const popupHtml = rewriteRuntime(strFromU8(entries["popup.html"]));

  assertScript("background-v0311", background);
  assertScript("content-v0311", content);

  entries["background-root.mjs"] = strToU8(background);
  entries["content-group-canary.mjs"] = strToU8(content);
  entries["popup.js"] = strToU8(popup);
  entries["popup.html"] = strToU8(popupHtml);
  entries["VERSION.txt"] = strToU8(`Commerce OS Shopling Market Sender v${VERSION}\n`);
  entries["README.txt"] = strToU8(
    `v${VERSION} DIRECT QUEUE START\n` +
    `- v0.3.10에서 발생한 'The message port closed before a response was received.' 시작 실패를 제거합니다.\n` +
    `- 시작 버튼은 A18 content script의 장시간 응답을 기다리지 않습니다.\n` +
    `- 선택 후 A18 탭을 1회 새로고침하여 현재 버전 실행기를 확실히 주입한 뒤 Chrome storage 대기열에 직접 작업을 기록합니다.\n` +
    `- A18 실행기는 1.2초 주기로 대기열을 감지하여 선택 상품을 상품별 순차 / 채널 3+3 병렬로 처리합니다.\n` +
    `- 대상 선정은 계속 Commerce OS SEO 대량등록 Shopling 업로드 기록이며 A18 화면 상품목록과 무관합니다.\n` +
    `- popup↔A18 시작 단계에서 message port 응답을 기다리지 않으므로 탭 reload/페이지 생명주기와 분리됩니다.\n\n` +
    strFromU8(entries["README.txt"]),
  );

  if (!popup.includes("await chrome.storage.local.set({ [QUEUE_KEY]: queue })")) throw new Error("v0311_popup_direct_queue_write_missing");
  if (!popup.includes("await chrome.tabs.reload(tab.id)")) throw new Error("v0311_popup_a18_reload_missing");
  if (!popup.includes("await sleep(900)")) throw new Error("v0311_popup_injection_settle_missing");
  if (!popup.includes("A18 실행기가 자동 시작합니다")) throw new Error("v0311_popup_direct_queue_status_missing");
  if (content.includes("document.documentElement.appendChild(box)")) throw new Error("v0311_shopling_dom_panel_present");

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
