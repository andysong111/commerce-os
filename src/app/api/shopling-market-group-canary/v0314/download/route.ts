import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getV0313Package } from "../../v0313/download/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.3.14";

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
    .replaceAll("0.3.13", VERSION)
    .replaceAll("V0313", "V0314")
    .replaceAll("v0313", "v0314");
}

function rewriteBackground(source: string) {
  let rewritten = rewriteRuntime(source);

  rewritten = replaceOnce(
    rewritten,
    `async function recordWorkerContext(sender, allowOpener = true) {`,
    `async function recordWorkerContext(sender, allowOpener = true, rawCandidateGoodsKeys = []) {`,
    "v0314_background_context_signature_anchor_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `  if (!assignment) return { worker: false, control, runId: meta.runId };`,
    `  if (!assignment) {\n    const candidateGoodsKeys = new Set((Array.isArray(rawCandidateGoodsKeys) ? rawCandidateGoodsKeys : [])\n      .map(text)\n      .filter((value) => /^\\d{5,9}$/.test(value)));\n    if (candidateGoodsKeys.size) {\n      assignment = assignmentArray(meta).find((candidate) =>\n        candidate?.status === "active" && candidateGoodsKeys.has(text(candidate.goodsKey))\n      ) || null;\n    }\n  }\n  if (!assignment) return { worker: false, control, runId: meta.runId };`,
    "v0314_background_result_context_fallback_anchor_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `    recordWorkerContext(sender, true).then(sendResponse).catch(() => sendResponse({ worker: false, control: false }));`,
    `    recordWorkerContext(sender, true, message.candidateGoodsKeys).then(sendResponse).catch(() => sendResponse({ worker: false, control: false }));`,
    "v0314_background_context_message_anchor_missing",
  );

  assertScript("background-v0314", rewritten);
  return rewritten;
}

function rewriteContent(source: string) {
  let rewritten = rewriteRuntime(source);

  rewritten = replaceOnce(
    rewritten,
    `  async function workerContext() {\n    const response = await sendMessage({ type: CONTEXT_MESSAGE });\n    return response || { worker: false, control: false };\n  }`,
    `  function resultContextGoodsKeys() {\n    if (!isSubmitResultPage() && !isMallResultFrame()) return [];\n    const body = bodyText();\n    return [...new Set([...body.matchAll(/(?:^|\\D)(\\d{5,9})(?=\\D|$)/g)].map((match) => match[1]))].slice(0, 20);\n  }\n\n  async function workerContext() {\n    const response = await sendMessage({\n      type: CONTEXT_MESSAGE,\n      candidateGoodsKeys: resultContextGoodsKeys(),\n    });\n    return response || { worker: false, control: false };\n  }`,
    "v0314_content_result_context_goodskey_anchor_missing",
  );

  assertScript("content-v0314", rewritten);
  return rewritten;
}

export async function GET() {
  const response = await getV0313Package();
  if (!response.ok) throw new Error(`shopling_market_sender_v0313_source_http_${response.status}`);
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));

  const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as { version?: string; description?: string };
  if (manifest.version !== "0.3.13") throw new Error("shopling_market_sender_v0314_source_version_mismatch");
  manifest.version = VERSION;
  manifest.description = "Commerce OS Shopling 마켓등록 결과 팝업이 opener 연결을 잃어도 결과 화면의 goods_key로 병렬 Worker 문맥을 복구해 sent/confirm_needed를 확정하는 내부 운영 버전입니다.";
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  const background = rewriteBackground(strFromU8(entries["background-root.mjs"]));
  const content = rewriteContent(strFromU8(entries["content-group-canary.mjs"]));
  const popup = rewriteRuntime(strFromU8(entries["popup.js"]));
  const popupHtml = rewriteRuntime(strFromU8(entries["popup.html"]));

  entries["background-root.mjs"] = strToU8(background);
  entries["content-group-canary.mjs"] = strToU8(content);
  entries["popup.js"] = strToU8(popup);
  entries["popup.html"] = strToU8(popupHtml);
  entries["VERSION.txt"] = strToU8(`Commerce OS Shopling Market Sender v${VERSION}\n`);
  entries["README.txt"] = strToU8(
    `v${VERSION} RESULT CONTEXT RECOVERY\n` +
    `- v0.3.13에서 실제 Shopling 송신 성공 결과창까지 도달했지만 결과 팝업이 Worker opener 문맥을 잃으면 Commerce OS 원장이 submit_armed에 남는 문제를 수정합니다.\n` +
    `- Shopling 결과 페이지/쇼핑몰별 결과 프레임에서 보이는 숫자 중 현재 active assignment의 goods_key와 일치하는 값을 찾아 Worker 문맥을 재결합합니다.\n` +
    `- 문맥 복구 후 결과 성공이면 sent, 비셀파 실패면 confirm_needed로 기존 안전정책대로 확정합니다.\n` +
    `- A18 대상 선정은 계속 Commerce OS SEO 대량등록 Shopling 업로드 기록 기준입니다.\n` +
    `- 상품은 순차 처리, 상품 내부 채널은 3+3 병렬을 유지합니다.\n\n` +
    strFromU8(entries["README.txt"]),
  );

  if (!background.includes("rawCandidateGoodsKeys")) throw new Error("v0314_background_candidate_goodskeys_missing");
  if (!background.includes("candidateGoodsKeys.has(text(candidate.goodsKey))")) throw new Error("v0314_background_active_assignment_match_missing");
  if (!background.includes("message.candidateGoodsKeys")) throw new Error("v0314_background_context_message_candidate_missing");
  if (!content.includes("resultContextGoodsKeys")) throw new Error("v0314_content_result_goodskeys_missing");
  if (!content.includes("candidateGoodsKeys: resultContextGoodsKeys()")) throw new Error("v0314_content_context_candidate_send_missing");
  if (content.includes("document.documentElement.appendChild(box)")) throw new Error("v0314_shopling_dom_panel_present");

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
