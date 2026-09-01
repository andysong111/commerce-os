import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getV0322Package } from "../../v0322/download/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.3.23";

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
    .replaceAll("0.3.22", VERSION)
    .replaceAll("V0322", "V0323")
    .replaceAll("v0322", "v0323");
}

function rewriteBackground(source: string) {
  let rewritten = rewriteRuntime(source);
  rewritten = rewritten.replace(
    'const LEGACY_WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0321";',
    'const LEGACY_WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0322";',
  );
  assertScript("background-v0323", rewritten);
  return rewritten;
}

function rewriteContent(source: string) {
  let rewritten = rewriteRuntime(source);
  rewritten = rewritten
    .replace('const LEGACY_RUN_STATE_KEY = "commerceOsShoplingParallelRunV0321";', 'const LEGACY_RUN_STATE_KEY = "commerceOsShoplingParallelRunV0322";')
    .replace('const LEGACY_WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0321";', 'const LEGACY_WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0322";')
    .replace('const LEGACY_SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0321";', 'const LEGACY_SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0322";')
    .replace('const LEGACY_SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0321";', 'const LEGACY_SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0322";');
  assertScript("content-v0323", rewritten);
  return rewritten;
}

function rewritePopup(source: string) {
  let rewritten = rewriteRuntime(source);
  rewritten = rewritten
    .replace('const LEGACY_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0321";', 'const LEGACY_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0322";')
    .replace('const LEGACY_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0321";', 'const LEGACY_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0322";');

  const oldState = [
    "function itemState(item) {",
    "  if (item.confirmNeededCount > 0) return '<span class=\"danger\">확인필요 ' + item.confirmNeededCount + '</span>';",
    "  if (item.busyCount > 0) return '<span class=\"warn\">처리중 ' + item.busyCount + '</span>';",
    "  if (item.marketDoneCount >= 6) return '<span class=\"ok\">마켓완료 6/6</span>';",
    "  if (item.uploadSuccessCount < 6) return '<span class=\"danger\">Shopling ' + item.uploadSuccessCount + '/6 · 선택불가</span>';",
    "  return '<span class=\"warn\">마켓 ' + item.marketDoneCount + '/6 · 대기 ' + item.marketPendingCount + '</span>';",
    "}",
  ].join("\n");

  const newState = [
    "function itemState(item) {",
    "  if (item.confirmNeededCount > 0) return '<span class=\"danger\">확인필요 ' + item.confirmNeededCount + '</span>';",
    "  if (item.busyCount > 0) return '<span class=\"warn\">처리중 ' + item.busyCount + '</span>';",
    "  if (item.marketDoneCount >= 6) return '<span class=\"ok\">마켓완료 6/6</span>';",
    "  if (item.uploadSuccessCount < 6) return '<span class=\"danger\">Shopling ' + item.uploadSuccessCount + '/6 · 선택불가</span>';",
    "  const unknown = Number(item.registrationUnknownCount || 0);",
    "  const pending = Number(item.marketPendingCount || 0);",
    "  if (unknown > 0) {",
    "    const tail = pending > 0 ? ' · 신규대기 ' + pending : '';",
    "    return '<span class=\"warn\">마켓 ' + item.marketDoneCount + '/6 · 실등록 확인 ' + unknown + tail + '</span>';",
    "  }",
    "  return '<span class=\"warn\">마켓 ' + item.marketDoneCount + '/6 · 대기 ' + pending + '</span>';",
    "}",
  ].join("\n");

  rewritten = replaceRequired(
    rewritten,
    oldState,
    newState,
    "v0323_popup_legacy_registration_state_missing",
  );
  assertScript("popup-v0323", rewritten);
  return rewritten;
}

export async function GET() {
  const response = await getV0322Package();
  if (!response.ok) throw new Error(`shopling_market_sender_v0322_source_http_${response.status}`);
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));

  const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as { version?: string; description?: string };
  if (manifest.version !== "0.3.22") throw new Error("shopling_market_sender_v0323_source_version_mismatch");
  manifest.version = VERSION;
  manifest.description = "과거 Shopling 마켓등록 이력이 원장에 없는 상품은 신규 대기로 오인하지 않고 실등록 확인 대상으로 표시하고, 선택 시 A18 미등록 검색으로 자동 교차검증하는 내부 운영 버전입니다.";
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  entries["background-root.mjs"] = strToU8(rewriteBackground(strFromU8(entries["background-root.mjs"])));
  entries["content-group-canary.mjs"] = strToU8(rewriteContent(strFromU8(entries["content-group-canary.mjs"])));
  entries["popup.js"] = strToU8(rewritePopup(strFromU8(entries["popup.js"])));
  entries["popup.html"] = strToU8(
    rewriteRuntime(strFromU8(entries["popup.html"]))
      .replace(
        "goods_key + 자사상품코드 이중검증 · 확인필요는 자동 재송신하지 않음",
        "goods_key + 자사상품코드 이중검증 · 과거건은 A18 미등록 검색으로 실등록 자동확인 · 확인필요는 자동 재송신하지 않음",
      ),
  );
  entries["VERSION.txt"] = strToU8(`Commerce OS Shopling Market Sender v${VERSION}\n`);

  const previousReadme = strFromU8(entries["README.txt"] || new Uint8Array());
  entries["README.txt"] = strToU8(
    `v0.3.23 LEGACY REGISTRATION RECONCILIATION\n` +
    `- legacy_ignored는 더 이상 신규 대기와 같은 숫자로 표시하지 않고 '실등록 확인'으로 분리합니다.\n` +
    `- 과거 확장프로그램 도입 전 이미 마켓등록된 상품이 대기 6으로 보이는 혼선을 제거합니다.\n` +
    `- 사용자가 해당 상품을 선택하면 기존 A18 미등록 검색 preflight가 각 도매1~소매2 채널의 실제 상태를 확인합니다.\n` +
    `- 미등록 검색 0건이면 already_registered로 확정하고 송신하지 않습니다. 실제 미등록 행이 있을 때만 해당 채널을 송신합니다.\n` +
    `- 신규 업로드의 queued/pending과 과거 원장 미확인 상태를 UI와 서버 집계에서 분리합니다.\n\n` +
    previousReadme,
  );

  const output = zipSync(entries, { level: 0 });
  return new Response(Buffer.from(output), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=commerce-os-shopling-market-sender-v0.3.23.zip",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
