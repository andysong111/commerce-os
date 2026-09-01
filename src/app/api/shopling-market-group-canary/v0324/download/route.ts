import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getV0323Package } from "../../v0323/download/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.3.24";

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
    .replaceAll("0.3.23", VERSION)
    .replaceAll("V0323", "V0324")
    .replaceAll("v0323", "v0324");
}

function rewriteBackground(source: string) {
  let rewritten = rewriteRuntime(source);
  rewritten = rewritten.replace(
    'const LEGACY_WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0322";',
    'const LEGACY_WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0323";',
  );
  assertScript("background-v0324", rewritten);
  return rewritten;
}

function rewriteContent(source: string) {
  let rewritten = rewriteRuntime(source);
  rewritten = rewritten
    .replace('const LEGACY_RUN_STATE_KEY = "commerceOsShoplingParallelRunV0322";', 'const LEGACY_RUN_STATE_KEY = "commerceOsShoplingParallelRunV0323";')
    .replace('const LEGACY_WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0322";', 'const LEGACY_WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0323";')
    .replace('const LEGACY_SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0322";', 'const LEGACY_SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0323";')
    .replace('const LEGACY_SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0322";', 'const LEGACY_SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0323";');
  assertScript("content-v0324", rewritten);
  return rewritten;
}

function rewritePopup(source: string) {
  let rewritten = rewriteRuntime(source);
  rewritten = rewritten
    .replace('const LEGACY_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0322";', 'const LEGACY_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0323";')
    .replace('const LEGACY_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0322";', 'const LEGACY_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0323";');

  rewritten = replaceRequired(
    rewritten,
    'const refreshButton = document.getElementById("refresh");',
    [
      'const refreshButton = document.getElementById("refresh");',
      'const uploadDate = document.getElementById("uploadDate");',
      'const dateSearch = document.getElementById("dateSearch");',
      'const dateReset = document.getElementById("dateReset");',
    ].join("\n"),
    "v0324_popup_date_nodes_missing",
  );

  rewritten = replaceRequired(
    rewritten,
    'async function loadItems() {',
    [
      'function listUrl() {',
      '  const params = new URLSearchParams({ bridge: BRIDGE });',
      '  const day = text(uploadDate && uploadDate.value);',
      '  if (day) {',
      '    const start = new Date(day + "T00:00:00");',
      '    const end = new Date(start);',
      '    end.setDate(end.getDate() + 1);',
      '    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {',
      '      params.set("from", start.toISOString());',
      '      params.set("to", end.toISOString());',
      '    }',
      '  }',
      '  return LIST_ENDPOINT + "?" + params.toString();',
      '}',
      '',
      'function batchLabel(item) {',
      '  const shortId = text(item.batchIdShort || item.jobId).slice(0, 8);',
      '  return (item.isLatestBatch ? "최신배치" : "이전배치") + (shortId ? " #" + shortId : "");',
      '}',
      '',
      'async function loadItems() {',
    ].join("\n"),
    "v0324_popup_list_url_helper_missing",
  );

  rewritten = replaceRequired(
    rewritten,
    'const response = await fetch(LIST_ENDPOINT + "?bridge=" + encodeURIComponent(BRIDGE), { cache: "no-store" });',
    'const response = await fetch(listUrl(), { cache: "no-store" });',
    "v0324_popup_date_fetch_missing",
  );

  rewritten = replaceRequired(
    rewritten,
    "'<div class=\"meta\">Shopling ' + item.uploadSuccessCount + '/6 · ' + itemState(item) + ' · ' + esc(dateLabel(item.completedAt)) + '</div></div></label>';",
    "'<div class=\"meta\">Shopling ' + item.uploadSuccessCount + '/6 · ' + itemState(item) + ' · ' + esc(dateLabel(item.completedAt)) + ' · ' + esc(batchLabel(item)) + '</div></div></label>';",
    "v0324_popup_batch_label_missing",
  );

  rewritten = replaceRequired(
    rewritten,
    'selectAll.addEventListener("change", function () {',
    [
      'dateSearch.addEventListener("click", loadItems);',
      'dateReset.addEventListener("click", function () { uploadDate.value = ""; loadItems(); });',
      'uploadDate.addEventListener("change", loadItems);',
      'selectAll.addEventListener("change", function () {',
    ].join("\n"),
    "v0324_popup_date_events_missing",
  );

  assertScript("popup-v0324", rewritten);
  return rewritten;
}

function rewritePopupHtml(source: string) {
  let rewritten = rewriteRuntime(source);
  rewritten = replaceRequired(
    rewritten,
    '.toolbar{display:flex;align-items:center;gap:8px;margin-bottom:8px}.toolbar button{width:auto;padding:6px 9px;background:#e2e8f0;color:#334155}',
    '.toolbar{display:flex;align-items:center;gap:8px;margin-bottom:8px}.toolbar button{width:auto;padding:6px 9px;background:#e2e8f0;color:#334155}.datebar{display:flex;align-items:center;gap:6px;margin-bottom:8px}.datebar input{flex:1;padding:7px;border:1px solid #cbd5e1;border-radius:7px}.datebar button{width:auto;margin-top:0;padding:7px 9px;background:#e2e8f0;color:#334155}',
    "v0324_popup_date_css_missing",
  );
  rewritten = replaceRequired(
    rewritten,
    '<div id="status" class="status">상태 확인 중...</div>',
    '<div id="status" class="status">상태 확인 중...</div>\n<div class="datebar"><input id="uploadDate" type="date" title="SEO 대량등록 Shopling 업로드 날짜"><button id="dateSearch" type="button">날짜조회</button><button id="dateReset" type="button">최근</button></div>',
    "v0324_popup_date_controls_missing",
  );
  rewritten = rewritten.replace(
    "과거건은 A18 미등록 검색으로 실등록 자동확인 · 확인필요는 자동 재송신하지 않음",
    "날짜별 업로드 조회 · 동일 B코드는 업로드 배치ID/시간으로 구분 · 과거건은 A18 미등록 검색으로 실등록 자동확인",
  );
  return rewritten;
}

export async function GET() {
  const response = await getV0323Package();
  if (!response.ok) throw new Error(`shopling_market_sender_v0323_source_http_${response.status}`);
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));

  const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as { version?: string; description?: string };
  if (manifest.version !== "0.3.23") throw new Error("shopling_market_sender_v0324_source_version_mismatch");
  manifest.version = VERSION;
  manifest.description = "SEO 대량등록 Shopling 업로드를 날짜별로 조회하고, 같은 B코드/모델번호의 반복 업로드를 고유 업로드 배치ID와 시각으로 구분하는 내부 운영 버전입니다.";
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  entries["background-root.mjs"] = strToU8(rewriteBackground(strFromU8(entries["background-root.mjs"])));
  entries["content-group-canary.mjs"] = strToU8(rewriteContent(strFromU8(entries["content-group-canary.mjs"])));
  entries["popup.js"] = strToU8(rewritePopup(strFromU8(entries["popup.js"])));
  entries["popup.html"] = strToU8(rewritePopupHtml(strFromU8(entries["popup.html"])));
  entries["VERSION.txt"] = strToU8(`Commerce OS Shopling Market Sender v${VERSION}\n`);

  const previousReadme = strFromU8(entries["README.txt"] || new Uint8Array());
  entries["README.txt"] = strToU8(
    `v0.3.24 DATE + UPLOAD BATCH LOOKUP\n` +
    `- 팝업에서 SEO 대량등록 → Shopling 업로드 완료 건을 날짜별로 조회합니다. 날짜는 사용 중인 브라우저의 로컬 자정 기준으로 서버 UTC 범위로 변환합니다.\n` +
    `- 같은 B코드/모델번호를 여러 번 업로드해도 product_launch_upload_jobs.id를 고유 batch ID로 사용해 서로 다른 행으로 표시합니다.\n` +
    `- 각 행에 업로드 완료시각 + batch short ID를 표시해 같은 모델번호 반복 업로드를 혼동하지 않습니다.\n` +
    `- 같은 launch_item의 이전 업로드 배치도 날짜 조회에서는 보이지만 중복송신 방지를 위해 이전배치는 선택불가, 최신배치만 자동전송 대상으로 유지합니다.\n` +
    `- 채널 실행 식별은 계속 goods_key + 자사상품코드 이중검증이며 모델번호 단독으로 작업을 식별하지 않습니다.\n\n` +
    previousReadme,
  );

  const output = zipSync(entries, { level: 0 });
  return new Response(Buffer.from(output), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=commerce-os-shopling-market-sender-v0.3.24.zip",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
