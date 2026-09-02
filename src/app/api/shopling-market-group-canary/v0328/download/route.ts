import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getV0327Package } from "../../v0327/download/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.3.28";

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
  return source.replaceAll("0.3.27", VERSION).replaceAll("V0327", "V0328").replaceAll("v0327", "v0328");
}

function rewriteBackground(source: string) {
  let rewritten = rewriteRuntime(source);
  rewritten = replaceRequired(
    rewritten,
    'const LEGACY_WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0326";',
    'const LEGACY_WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0327";',
    "v0328_background_legacy_meta_missing",
  );

  rewritten = replaceRequired(
    rewritten,
    "  const failure = failureCount > 0 || /성공여부\\s*실패/i.test(body);\n  return {\n    kind: 'mall_result_frame',",
    "  const failure = failureCount > 0 || /성공여부\\s*실패/i.test(body);\n  const numericTokens = [...new Set(body.match(/\\b\\d{5,9}\\b/g) || [])].slice(0, 30);\n  return {\n    kind: 'mall_result_frame',",
    "v0328_background_numeric_token_snapshot_missing",
  );
  rewritten = replaceRequired(
    rewritten,
    "    settled: Boolean(resultLike && goodsKey && (success || failure || successCount === 0 || failureCount === 0)),",
    "    settled: Boolean(resultLike && (success || failure || successCount === 0 || failureCount === 0)),",
    "v0328_background_settle_without_goods_key_missing",
  );
  rewritten = replaceRequired(
    rewritten,
    "    failureCount,\n    href: String(location.href || ''),",
    "    failureCount,\n    numericTokens,\n    href: String(location.href || ''),",
    "v0328_background_numeric_token_return_missing",
  );

  rewritten = replaceRequired(
    rewritten,
    [
      "  const settledFrames = frames.filter((row) => row.settled === true && /^\\d{5,9}$/.test(text(row.goodsKey)));",
      "  if (!settledFrames.length) {",
      "    if (attempt < DIRECT_RESULT_MAX_ATTEMPTS) scheduleDirectResultReconcile(tabId);",
      "    return;",
      "  }",
      "  const keys = [...new Set(settledFrames.map((row) => text(row.goodsKey)))];",
      "  if (keys.length !== 1) {",
      "    if (attempt < DIRECT_RESULT_MAX_ATTEMPTS) scheduleDirectResultReconcile(tabId);",
      "    return;",
      "  }",
      "  const goodsKey = keys[0];",
      "  let meta = await getWorkerMeta();",
      "  let runId = text(meta?.runId);",
      "  let assignment = meta?.assignments?.[goodsKey] || null;",
    ].join("\n"),
    [
      "  const settledAny = frames.filter((row) => row.settled === true);",
      "  if (!settledAny.length) {",
      "    if (attempt < DIRECT_RESULT_MAX_ATTEMPTS) scheduleDirectResultReconcile(tabId);",
      "    return;",
      "  }",
      "  let meta = await getWorkerMeta();",
      "  const activeGoodsKeys = new Set(assignmentArray(meta).map((row) => text(row?.goodsKey)).filter((value) => /^\\d{5,9}$/.test(value)));",
      "  const parsedKeys = [...new Set(settledAny.map((row) => text(row.goodsKey)).filter((value) => /^\\d{5,9}$/.test(value)))];",
      "  const tokenCandidates = [...new Set(settledAny.flatMap((row) => Array.isArray(row.numericTokens) ? row.numericTokens.map(text) : []).filter((value) => /^\\d{5,9}$/.test(value)))];",
      "  let goodsKey = parsedKeys.length === 1 ? parsedKeys[0] : '';",
      "  if (!goodsKey) {",
      "    const activeMatches = tokenCandidates.filter((value) => activeGoodsKeys.has(value));",
      "    if (activeMatches.length === 1) goodsKey = activeMatches[0];",
      "  }",
      "  let recoveredContext = null;",
      "  if (!goodsKey && tokenCandidates.length) {",
      "    const recoveredByTokens = await resultContextApi(tokenCandidates.slice(0, 20));",
      "    recoveredContext = recoveredByTokens?.ok && Array.isArray(recoveredByTokens.contexts) && recoveredByTokens.contexts.length === 1 ? recoveredByTokens.contexts[0] : null;",
      "    const recoveredGoodsKey = text(recoveredContext?.task?.goodsKey);",
      "    if (/^\\d{5,9}$/.test(recoveredGoodsKey)) goodsKey = recoveredGoodsKey;",
      "  }",
      "  if (!goodsKey) {",
      "    if (attempt < DIRECT_RESULT_MAX_ATTEMPTS) scheduleDirectResultReconcile(tabId);",
      "    return;",
      "  }",
      "  const settledFrames = settledAny.filter((row) => text(row.goodsKey) === goodsKey || (Array.isArray(row.numericTokens) && row.numericTokens.map(text).includes(goodsKey)));",
      "  if (!settledFrames.length) {",
      "    if (attempt < DIRECT_RESULT_MAX_ATTEMPTS) scheduleDirectResultReconcile(tabId);",
      "    return;",
      "  }",
      "  let runId = text(meta?.runId);",
      "  let assignment = meta?.assignments?.[goodsKey] || null;",
    ].join("\n"),
    "v0328_background_goods_key_token_recovery_missing",
  );

  rewritten = replaceRequired(
    rewritten,
    "    const recovered = await resultContextApi([goodsKey]);",
    "    const recovered = recoveredContext ? { ok: true, contexts: [recoveredContext] } : await resultContextApi([goodsKey]);",
    "v0328_background_context_reuse_missing",
  );

  assertScript("background-v0328", rewritten);
  return rewritten;
}

function rewriteContent(source: string) {
  const rewritten = rewriteRuntime(source)
    .replace('const LEGACY_RUN_STATE_KEY = "commerceOsShoplingParallelRunV0326";', 'const LEGACY_RUN_STATE_KEY = "commerceOsShoplingParallelRunV0327";')
    .replace('const LEGACY_WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0326";', 'const LEGACY_WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0327";')
    .replace('const LEGACY_SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0326";', 'const LEGACY_SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0327";')
    .replace('const LEGACY_SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0326";', 'const LEGACY_SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0327";');
  assertScript("content-v0328", rewritten);
  return rewritten;
}

function rewritePopup(source: string) {
  let rewritten = rewriteRuntime(source)
    .replace('const LEGACY_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0326";', 'const LEGACY_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0327";')
    .replace('const LEGACY_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0326";', 'const LEGACY_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0327";');

  rewritten = replaceRequired(
    rewritten,
    [
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
    ].join("\n"),
    [
      "function itemState(item) {",
      "  if (item.marketDoneCount >= 6) return '<span class=\"ok\">마켓완료 6/6</span>';",
      "  if (item.uploadSuccessCount < 6) return '<span class=\"danger\">Shopling ' + item.uploadSuccessCount + '/6 · 선택불가</span>';",
      "  const activeBusy = Number(item.activeBusyCount != null ? item.activeBusyCount : item.busyCount || 0);",
      "  const staleBusy = Number(item.staleBusyCount || 0);",
      "  const confirm = Number(item.confirmNeededCount || 0);",
      "  const unknown = Number(item.registrationUnknownCount || 0);",
      "  const pending = Number(item.marketPendingCount || 0);",
      "  if (activeBusy > 0) return '<span class=\"warn\">마켓 ' + item.marketDoneCount + '/6 · 처리중 ' + activeBusy + '</span>';",
      "  const parts = [];",
      "  if (staleBusy > 0) parts.push('미확정 재검증 ' + staleBusy);",
      "  if (confirm > 0) parts.push('확인필요 재검증 ' + confirm);",
      "  if (unknown > 0) parts.push('실등록 확인 ' + unknown);",
      "  if (pending > 0) parts.push('대기 ' + pending);",
      "  return '<span class=\"warn\">마켓 ' + item.marketDoneCount + '/6' + (parts.length ? ' · ' + parts.join(' · ') : '') + '</span>';",
      "}",
    ].join("\n"),
    "v0328_popup_composite_state_missing",
  );

  assertScript("popup-v0328", rewritten);
  return rewritten;
}

export async function GET() {
  const response = await getV0327Package();
  if (!response.ok) throw new Error(`shopling_market_sender_v0327_source_http_${response.status}`);
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as { version?: string; description?: string };
  if (manifest.version !== "0.3.27") throw new Error("shopling_market_sender_v0328_source_version_mismatch");
  manifest.version = VERSION;
  manifest.description = "전체병렬 결과창에서 goods_key를 숫자토큰+서버원장으로 복구해 처리중 잔류를 줄이고, 오래된 미확정/확인필요 채널을 A18 정확조회 후 안전하게 재검증할 수 있는 내부 운영 버전입니다.";
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
  entries["background-root.mjs"] = strToU8(rewriteBackground(strFromU8(entries["background-root.mjs"])));
  entries["content-group-canary.mjs"] = strToU8(rewriteContent(strFromU8(entries["content-group-canary.mjs"])));
  entries["popup.js"] = strToU8(rewritePopup(strFromU8(entries["popup.js"])));
  entries["popup.html"] = strToU8(
    rewriteRuntime(strFromU8(entries["popup.html"]))
      .replace(
        "선택상품 동시 처리 · 상품 1개당 최대 6채널 동시 · 전역 최대 3상품(18채널) 병렬",
        "선택상품 동시 처리 · 상품 1개당 최대 6채널 동시 · 전역 최대 3상품(18채널) 병렬 · 오래된 미확정/확인필요는 A18 정확조회 후 재검증",
      ),
  );
  entries["VERSION.txt"] = strToU8(`Commerce OS Shopling Market Sender v${VERSION}\n`);

  const previousReadme = strFromU8(entries["README.txt"] || new Uint8Array());
  entries["README.txt"] = strToU8(
    `v0.3.28 RESULT TOKEN RECOVERY + SAFE RESUME\n` +
    `- Shopling 결과 프레임에서 표 DOM으로 goods_key를 못 읽어도 프레임 숫자토큰과 현재 Worker/서버 submit_armed 원장을 대조해 정확한 goods_key를 복구합니다.\n` +
    `- 성공 1건 이상 확인 시 즉시 sent 확정하는 정책을 유지하고 처리중 잔류를 줄입니다.\n` +
    `- 3분 이상 미확정 submit_armed, confirm_needed, legacy_ignored는 최신 배치를 사용자가 다시 선택할 수 있습니다.\n` +
    `- 재선택된 불확실 채널은 곧바로 재송신하지 않고 기존 Worker의 goods_key+자사상품코드 A18 미등록 정확조회부터 수행합니다. 미등록 0건이면 already_registered, 정확행이 있을 때만 송신합니다.\n` +
    `- 실제로 진행 중인 3분 미만 채널은 체크를 계속 잠가 이중 실행을 막습니다.\n\n` +
    previousReadme,
  );

  const output = zipSync(entries, { level: 0 });
  return new Response(Buffer.from(output), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=commerce-os-shopling-market-sender-v0.3.28.zip",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
