import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getV0326Package } from "../../v0326/download/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.3.27";

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
  return source.replaceAll("0.3.26", VERSION).replaceAll("V0326", "V0327").replaceAll("v0326", "v0327");
}

function rewriteBackground(source: string) {
  let rewritten = rewriteRuntime(source);
  rewritten = replaceRequired(
    rewritten,
    'const LEGACY_WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0325";',
    'const LEGACY_WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0326";',
    "v0327_background_legacy_meta_missing",
  );
  assertScript("background-v0327", rewritten);
  return rewritten;
}

function rewriteContent(source: string) {
  let rewritten = rewriteRuntime(source)
    .replace('const LEGACY_RUN_STATE_KEY = "commerceOsShoplingParallelRunV0325";', 'const LEGACY_RUN_STATE_KEY = "commerceOsShoplingParallelRunV0326";')
    .replace('const LEGACY_WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0325";', 'const LEGACY_WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0326";')
    .replace('const LEGACY_SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0325";', 'const LEGACY_SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0326";')
    .replace('const LEGACY_SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0325";', 'const LEGACY_SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0326";');
  assertScript("content-v0327", rewritten);
  return rewritten;
}

function rewritePopup(source: string) {
  let rewritten = rewriteRuntime(source)
    .replace('const LEGACY_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0325";', 'const LEGACY_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0326";')
    .replace('const LEGACY_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0325";', 'const LEGACY_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0326";');

  rewritten = replaceRequired(
    rewritten,
    '  if (!stored[QUEUE_KEY] && stored[LEGACY_QUEUE_KEY]) writes[QUEUE_KEY] = { ...stored[LEGACY_QUEUE_KEY], version: VERSION };',
    '  if (!stored[QUEUE_KEY] && stored[LEGACY_QUEUE_KEY]) { const legacy = stored[LEGACY_QUEUE_KEY]; writes[QUEUE_KEY] = legacy?.status === "running" ? { ...legacy, version: VERSION, status: "superseded_by_v0327", finishedAt: Date.now(), updatedAt: Date.now() } : { ...legacy, version: VERSION }; }',
    "v0327_popup_running_queue_retire_missing",
  );
  assertScript("popup-v0327", rewritten);
  return rewritten;
}

export async function GET() {
  const response = await getV0326Package();
  if (!response.ok) throw new Error(`shopling_market_sender_v0326_source_http_${response.status}`);
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as { version?: string; description?: string };
  if (manifest.version !== "0.3.26") throw new Error("shopling_market_sender_v0327_source_version_mismatch");
  manifest.version = VERSION;
  manifest.description = "선택상품 전체병렬 실행을 유지하면서 이전 버전의 로컬 처리중 큐를 새 런타임으로 잘못 승계하지 않도록 정리한 내부 운영 버전입니다.";
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
  entries["background-root.mjs"] = strToU8(rewriteBackground(strFromU8(entries["background-root.mjs"])));
  entries["content-group-canary.mjs"] = strToU8(rewriteContent(strFromU8(entries["content-group-canary.mjs"])));
  entries["popup.js"] = strToU8(rewritePopup(strFromU8(entries["popup.js"])));
  entries["popup.html"] = strToU8(rewriteRuntime(strFromU8(entries["popup.html"])));
  entries["VERSION.txt"] = strToU8(`Commerce OS Shopling Market Sender v${VERSION}\n`);

  const previousReadme = strFromU8(entries["README.txt"] || new Uint8Array());
  entries["README.txt"] = strToU8(
    `v0.3.27 CLEAN FULL-PARALLEL RUNTIME\n` +
    `- v0.3.26의 전체병렬 구조(최대 3상품 동시, 상품당 최대 6채널 동시, 전역 최대 18채널)를 그대로 유지합니다.\n` +
    `- 이전 버전에서 남은 로컬 running queue를 새 버전의 처리중으로 잘못 승계하지 않습니다. 서버 원장이 현재 상태의 최종 기준입니다.\n` +
    `- v0.3.26에서 정상 실행 중인 큐를 업데이트하는 경우에는 새 버전에서 중복재실행하지 않고 종료상태로 이관한 뒤 서버 상태로 재선택합니다.\n\n` +
    previousReadme,
  );

  const output = zipSync(entries, { level: 0 });
  return new Response(Buffer.from(output), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=commerce-os-shopling-market-sender-v0.3.27.zip",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
