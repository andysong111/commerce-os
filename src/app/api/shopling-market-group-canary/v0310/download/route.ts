import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getV039Package } from "../../v039/download/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.3.10";

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
    .replaceAll("0.3.9", VERSION)
    .replaceAll("V039", "V0310")
    .replaceAll("v039", "v0310");
}

function rewritePopup(source: string) {
  let rewritten = rewriteRuntime(source);

  rewritten = replaceOnce(
    rewritten,
    `function selectedJobIds() {`,
    `function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }\n\nfunction sendStart(tabId, jobIds) {\n  return new Promise(function (resolve) {\n    chrome.tabs.sendMessage(tabId, { type: START_MESSAGE, jobIds: jobIds }, function (response) {\n      const lastError = chrome.runtime.lastError;\n      resolve({\n        ok: !lastError && response && response.ok === true,\n        response: response || null,\n        error: lastError ? String(lastError.message || lastError) : \"\",\n      });\n    });\n  });\n}\n\nasync function waitTabComplete(tabId, timeoutMs) {\n  const deadline = Date.now() + timeoutMs;\n  while (Date.now() < deadline) {\n    const tab = await chrome.tabs.get(tabId).catch(function () { return null; });\n    if (tab && tab.status === \"complete\") return true;\n    await sleep(150);\n  }\n  return false;\n}\n\nasync function startWithA18Recovery(tab, jobIds) {\n  const first = await sendStart(tab.id, jobIds);\n  if (first.ok) return first;\n\n  statusNode.textContent = \"A18 실행기 연결이 없어 자동 새로고침 후 다시 연결 중...\";\n  await chrome.tabs.reload(tab.id);\n  const loaded = await waitTabComplete(tab.id, 12000);\n  if (!loaded) return { ok: false, response: null, error: \"A18 자동 새로고침이 12초 안에 완료되지 않았습니다.\" };\n  await sleep(700);\n\n  const second = await sendStart(tab.id, jobIds);\n  if (second.ok) return second;\n  return {\n    ok: false,\n    response: second.response,\n    error: text(second.error || first.error || (second.response && (second.response.message || second.response.error)) || \"A18 실행기 시작 신호 실패\"),\n  };\n}\n\nfunction selectedJobIds() {`,
    "v0310_popup_recovery_helpers_anchor_missing",
  );

  const oldStart = `startButton.addEventListener("click", async function () {\n  const jobIds = selectedJobIds();\n  if (!jobIds.length) return;\n  startButton.disabled = true;\n  statusNode.textContent = "A18 실행 템플릿 확인 중...";\n  const tab = await activeA18Tab();\n  if (!tab) {\n    statusNode.textContent = "Shopling 관리자 A18 쇼핑몰상품등록 탭을 활성화한 뒤 다시 실행하세요.";\n    updateStartButton();\n    return;\n  }\n  chrome.tabs.sendMessage(tab.id, { type: START_MESSAGE, jobIds: jobIds }, function (response) {\n    const lastError = chrome.runtime.lastError;\n    if (lastError || !response || response.ok !== true) {\n      statusNode.textContent = text(response && (response.message || response.error)) || "A18 실행 템플릿에 시작 신호를 전달하지 못했습니다. A18을 새로고침하세요.";\n      updateStartButton();\n      return;\n    }\n    queueRunning = true;\n    statusNode.textContent = "선택 " + jobIds.length + "개 등록 시작 · 상품별 3+3 채널 처리";\n    renderItems();\n  });\n});`;

  const newStart = `startButton.addEventListener("click", async function () {\n  const jobIds = selectedJobIds();\n  if (!jobIds.length) return;\n  startButton.disabled = true;\n  statusNode.textContent = "A18 실행 템플릿 확인 중...";\n  const tab = await activeA18Tab();\n  if (!tab) {\n    statusNode.textContent = "Shopling 관리자 A18 쇼핑몰상품등록 탭을 활성화한 뒤 다시 실행하세요.";\n    updateStartButton();\n    return;\n  }\n  try {\n    const started = await startWithA18Recovery(tab, jobIds);\n    if (!started.ok) {\n      statusNode.textContent = text(started.response && (started.response.message || started.response.error)) || text(started.error) || "A18 실행기에 시작 신호를 전달하지 못했습니다.";\n      updateStartButton();\n      return;\n    }\n    queueRunning = true;\n    statusNode.textContent = "선택 " + jobIds.length + "개 등록 시작 · 상품별 3+3 채널 처리";\n    renderItems();\n  } catch (error) {\n    statusNode.textContent = "A18 자동 복구 실패: " + text(error && error.message ? error.message : error);\n    updateStartButton();\n  }\n});`;

  rewritten = replaceOnce(rewritten, oldStart, newStart, "v0310_popup_start_recovery_anchor_missing");
  assertScript("popup-v0310", rewritten);
  return rewritten;
}

export async function GET() {
  const response = await getV039Package();
  if (!response.ok) throw new Error(`shopling_market_sender_v039_source_http_${response.status}`);
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));

  const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as { version?: string; description?: string };
  if (manifest.version !== "0.3.9") throw new Error("shopling_market_sender_v0310_source_version_mismatch");
  manifest.version = VERSION;
  manifest.description = "Commerce OS SEO 대량등록 Shopling 업로드 목록을 선택해 마켓등록하며, A18 실행기 미연결 시 자동 새로고침 후 1회 복구하는 내부 운영 버전입니다.";
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  const background = rewriteRuntime(strFromU8(entries["background-root.mjs"]));
  const content = rewriteRuntime(strFromU8(entries["content-group-canary.mjs"]));
  const popup = rewritePopup(strFromU8(entries["popup.js"]));
  const popupHtml = rewriteRuntime(strFromU8(entries["popup.html"]));

  assertScript("background-v0310", background);
  assertScript("content-v0310", content);

  entries["background-root.mjs"] = strToU8(background);
  entries["content-group-canary.mjs"] = strToU8(content);
  entries["popup.js"] = strToU8(popup);
  entries["popup.html"] = strToU8(popupHtml);
  entries["VERSION.txt"] = strToU8(`Commerce OS Shopling Market Sender v${VERSION}\n`);
  entries["README.txt"] = strToU8(
    `v${VERSION} A18 START RECOVERY\n` +
    `- v0.3.9의 SEO 업로드 목록 선택 / 상품 순차 / 3+3 채널 처리 구조를 그대로 유지합니다.\n` +
    `- 확장 설치·업데이트 후 기존 A18 탭에 content script가 아직 없는 경우 시작 실패로 끝내지 않습니다.\n` +
    `- 첫 시작 신호가 실패하면 해당 A18 탭만 자동 새로고침하고 로딩 완료 후 1회만 재시도합니다.\n` +
    `- 자동 복구 후에도 실패하면 실제 오류 문구를 표시하고 마켓송신은 시작하지 않습니다.\n` +
    `- 대상 선정은 계속 Commerce OS SEO 대량등록 Shopling 업로드 기록이며 A18 화면 상품목록과 무관합니다.\n\n` +
    strFromU8(entries["README.txt"]),
  );

  if (!popup.includes("startWithA18Recovery")) throw new Error("v0310_popup_auto_recovery_missing");
  if (!popup.includes("chrome.tabs.reload(tab.id)")) throw new Error("v0310_popup_auto_reload_missing");
  if (!popup.includes("waitTabComplete(tab.id, 12000)")) throw new Error("v0310_popup_reload_wait_missing");
  if (!popup.includes("await sleep(700)")) throw new Error("v0310_popup_content_injection_settle_missing");
  if (!popup.includes("const second = await sendStart(tab.id, jobIds)")) throw new Error("v0310_popup_retry_missing");
  if (content.includes("document.documentElement.appendChild(box)")) throw new Error("v0310_shopling_dom_panel_present");

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
