import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getV0328Package } from "../../v0328/download/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.3.29";

function replaceRequired(source: string, anchor: string, replacement: string, code: string) {
  if (!source.includes(anchor)) throw new Error(code);
  return source.replace(anchor, replacement);
}

function assertScript(name: string, source: string) {
  try { new Function(source); } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "syntax error");
    throw new Error(`shopling_market_sender_${name}_invalid: ${message}`);
  }
}

function rewriteRuntime(source: string) {
  return source.replaceAll("0.3.28", VERSION).replaceAll("V0328", "V0329").replaceAll("v0328", "v0329");
}

function rewriteBackground(source: string) {
  let rewritten = rewriteRuntime(source)
    .replace(
      'const LEGACY_WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0327";',
      'const LEGACY_WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0328";',
    );

  rewritten = replaceRequired(
    rewritten,
    [
      "  let meta = await getWorkerMeta();",
      "  const activeGoodsKeys = new Set(assignmentArray(meta).map((row) => text(row?.goodsKey)).filter((value) => /^\\d{5,9}$/.test(value)));",
    ].join("\n"),
    [
      "  let meta = await getWorkerMeta();",
      "  const tabAssignment = findAssignment(meta, { tab }, true);",
      "  const tabAssignedGoodsKey = text(tabAssignment?.goodsKey);",
      "  const activeGoodsKeys = new Set(assignmentArray(meta).map((row) => text(row?.goodsKey)).filter((value) => /^\\d{5,9}$/.test(value)));",
    ].join("\n"),
    "v0329_background_tab_assignment_anchor_missing",
  );

  rewritten = replaceRequired(
    rewritten,
    "  let goodsKey = parsedKeys.length === 1 ? parsedKeys[0] : '';",
    "  let goodsKey = /^\\d{5,9}$/.test(tabAssignedGoodsKey) ? tabAssignedGoodsKey : (parsedKeys.length === 1 ? parsedKeys[0] : '');",
    "v0329_background_tab_goods_key_priority_missing",
  );

  rewritten = replaceRequired(
    rewritten,
    "  const settledFrames = settledAny.filter((row) => text(row.goodsKey) === goodsKey || (Array.isArray(row.numericTokens) && row.numericTokens.map(text).includes(goodsKey)));",
    "  const settledFrames = tabAssignment ? settledAny : settledAny.filter((row) => text(row.goodsKey) === goodsKey || (Array.isArray(row.numericTokens) && row.numericTokens.map(text).includes(goodsKey)));",
    "v0329_background_tab_scoped_frames_missing",
  );

  rewritten = replaceRequired(
    rewritten,
    "  let assignment = meta?.assignments?.[goodsKey] || null;",
    "  let assignment = tabAssignment || meta?.assignments?.[goodsKey] || null;",
    "v0329_background_tab_assignment_reuse_missing",
  );

  rewritten = replaceRequired(
    rewritten,
    "  const allSettled = frames.length > 0 && frames.every((row) => row.settled === true && /^\\d{5,9}$/.test(text(row.goodsKey)));",
    "  const allSettled = frames.length > 0 && frames.every((row) => row.settled === true) && (Boolean(tabAssignment) || frames.every((row) => /^\\d{5,9}$/.test(text(row.goodsKey))));",
    "v0329_background_tab_settled_guard_missing",
  );

  assertScript("background-v0329", rewritten);
  return rewritten;
}

function rewriteContent(source: string) {
  const rewritten = rewriteRuntime(source)
    .replace('const LEGACY_RUN_STATE_KEY = "commerceOsShoplingParallelRunV0327";', 'const LEGACY_RUN_STATE_KEY = "commerceOsShoplingParallelRunV0328";')
    .replace('const LEGACY_WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0327";', 'const LEGACY_WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0328";')
    .replace('const LEGACY_SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0327";', 'const LEGACY_SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0328";')
    .replace('const LEGACY_SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0327";', 'const LEGACY_SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0328";');
  assertScript("content-v0329", rewritten);
  return rewritten;
}

function rewritePopup(source: string) {
  const rewritten = rewriteRuntime(source)
    .replace('const LEGACY_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0327";', 'const LEGACY_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0328";')
    .replace('const LEGACY_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0327";', 'const LEGACY_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0328";');
  assertScript("popup-v0329", rewritten);
  return rewritten;
}

export async function GET() {
  const response = await getV0328Package();
  if (!response.ok) throw new Error(`shopling_market_sender_v0328_source_http_${response.status}`);
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as { version?: string; description?: string };
  if (manifest.version !== "0.3.28") throw new Error("shopling_market_sender_v0329_source_version_mismatch");

  manifest.version = VERSION;
  manifest.description = "Shopling 결과창의 상품번호 파싱이 끊겨도 결과 탭/창이 어느 병렬 Worker에 속하는지 Chrome 탭 귀속으로 복구해 성공 결과를 서버 원장에 즉시 확정하는 내부 운영 버전입니다.";
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
  entries["background-root.mjs"] = strToU8(rewriteBackground(strFromU8(entries["background-root.mjs"])));
  entries["content-group-canary.mjs"] = strToU8(rewriteContent(strFromU8(entries["content-group-canary.mjs"])));
  entries["popup.js"] = strToU8(rewritePopup(strFromU8(entries["popup.js"])));
  entries["popup.html"] = strToU8(rewriteRuntime(strFromU8(entries["popup.html"])));
  entries["VERSION.txt"] = strToU8(`Commerce OS Shopling Market Sender v${VERSION}\n`);

  const previousReadme = strFromU8(entries["README.txt"] || new Uint8Array());
  entries["README.txt"] = strToU8(
    `v0.3.29 RESULT TAB IDENTITY RECOVERY\n` +
    `- 결과 프레임 내부에서 goods_key가 안 보이는 경우에도 결과 탭의 tabId/windowId/openerTabId를 현재 Worker assignment와 대조해 정확한 채널을 복구합니다.\n` +
    `- 탭 귀속이 정확히 확인된 결과창은 child frame의 상품번호 파싱이 비어 있어도 해당 채널 결과로만 해석합니다.\n` +
    `- 운영정책대로 결과 중 성공 1건 이상이면 즉시 sent로 확정하고, 성공 0건이며 모든 프레임이 실패로 정착한 경우에만 confirm_needed로 보존합니다.\n` +
    `- v0.3.28의 안전한 A18 미등록 사전검증, 오래된 미확정 재검증, 최대 3상품/18채널 전체병렬 구조는 그대로 유지합니다.\n` +
    `- 업데이트 시 v0.3.28 Worker assignment를 이관하므로 아직 열려 있는 결과창은 재송신 없이 결과 확정을 다시 시도합니다.\n\n` +
    previousReadme,
  );

  const output = zipSync(entries, { level: 0 });
  return new Response(Buffer.from(output), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=commerce-os-shopling-market-sender-v0.3.29.zip",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
