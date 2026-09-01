import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getV0324Package } from "../../v0324/download/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.3.25";

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
    .replaceAll("0.3.24", VERSION)
    .replaceAll("V0324", "V0325")
    .replaceAll("v0324", "v0325");
}

function rewriteBackground(source: string) {
  let rewritten = rewriteRuntime(source);
  rewritten = rewritten.replace(
    'const LEGACY_WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0323";',
    'const LEGACY_WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0324";',
  );

  rewritten = replaceRequired(
    rewritten,
    [
      "  const frames = injected.map((row) => row?.result).filter((row) => row?.kind === 'mall_result_frame');",
      "  if (!frames.length || frames.some((row) => row.settled !== true || !/^\\d{5,9}$/.test(text(row.goodsKey)))) {",
      "    if (attempt < DIRECT_RESULT_MAX_ATTEMPTS) scheduleDirectResultReconcile(tabId);",
      "    return;",
      "  }",
      "  const keys = [...new Set(frames.map((row) => text(row.goodsKey)))];",
    ].join("\n"),
    [
      "  const frames = injected.map((row) => row?.result).filter((row) => row?.kind === 'mall_result_frame');",
      "  if (!frames.length) {",
      "    if (attempt < DIRECT_RESULT_MAX_ATTEMPTS) scheduleDirectResultReconcile(tabId);",
      "    return;",
      "  }",
      "  const settledFrames = frames.filter((row) => row.settled === true && /^\\d{5,9}$/.test(text(row.goodsKey)));",
      "  if (!settledFrames.length) {",
      "    if (attempt < DIRECT_RESULT_MAX_ATTEMPTS) scheduleDirectResultReconcile(tabId);",
      "    return;",
      "  }",
      "  const keys = [...new Set(settledFrames.map((row) => text(row.goodsKey)))];",
    ].join("\n"),
    "v0325_background_partial_success_gate_missing",
  );

  rewritten = replaceRequired(
    rewritten,
    [
      "  const hasSuccess = frames.some((row) => row.success === true);",
      "  const anyFailure = frames.some((row) => row.failure === true);",
    ].join("\n"),
    [
      "  const hasSuccess = settledFrames.some((row) => row.success === true);",
      "  const allSettled = frames.length > 0 && frames.every((row) => row.settled === true && /^\\d{5,9}$/.test(text(row.goodsKey)));",
      "  const anyFailure = settledFrames.some((row) => row.failure === true);",
    ].join("\n"),
    "v0325_background_any_success_missing",
  );

  rewritten = replaceRequired(
    rewritten,
    "  } else if (anyFailure) {\n    outcome = 'confirm_needed';\n    reasonCode = 'shopling_result_all_failed_v0325';",
    "  } else if (allSettled && anyFailure) {\n    outcome = 'confirm_needed';\n    reasonCode = 'shopling_result_all_failed_v0325';",
    "v0325_background_all_failed_gate_missing",
  );

  assertScript("background-v0325", rewritten);
  return rewritten;
}

function rewriteContent(source: string) {
  let rewritten = rewriteRuntime(source);
  rewritten = rewritten
    .replace('const LEGACY_RUN_STATE_KEY = "commerceOsShoplingParallelRunV0323";', 'const LEGACY_RUN_STATE_KEY = "commerceOsShoplingParallelRunV0324";')
    .replace('const LEGACY_WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0323";', 'const LEGACY_WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0324";')
    .replace('const LEGACY_SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0323";', 'const LEGACY_SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0324";')
    .replace('const LEGACY_SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0323";', 'const LEGACY_SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0324";');

  rewritten = replaceRequired(
    rewritten,
    '        success: resultLike && !processing && hasSuccess && !nonIgnoredFailure,\n        failure: resultLike && !processing && nonIgnoredFailure,',
    '        success: resultLike && !processing && hasSuccess,\n        failure: resultLike && !processing && !hasSuccess && nonIgnoredFailure,',
    "v0325_submit_evidence_section_policy_missing",
  );

  rewritten = replaceRequired(
    rewritten,
    '      success: resultLike && !processing && hasSuccess && !hasFailure,\n      failure: resultLike && !processing && hasFailure,',
    '      success: resultLike && !processing && hasSuccess,\n      failure: resultLike && !processing && !hasSuccess && hasFailure,',
    "v0325_submit_evidence_fallback_policy_missing",
  );

  rewritten = replaceRequired(
    rewritten,
    '    if (!directDefinitive && expectedFrames > 0 && !allFramesSettled) {',
    '    if (!directDefinitive && !frameHasSuccess && expectedFrames > 0 && !allFramesSettled) {',
    "v0325_frame_success_early_exit_missing",
  );

  rewritten = replaceRequired(
    rewritten,
    [
      "    const hasSuccess = direct.success || (allFramesSettled && frameHasSuccess);",
      "    const hasFailure = direct.failure || (allFramesSettled && nonIgnoredFrameFailure);",
    ].join("\n"),
    [
      "    const hasSuccess = direct.success || frameHasSuccess;",
      "    const hasFailure = !hasSuccess && (direct.failure || (allFramesSettled && nonIgnoredFrameFailure));",
    ].join("\n"),
    "v0325_frame_any_success_missing",
  );

  rewritten = replaceRequired(
    rewritten,
    [
      "      if (!claim?.ok) {",
      "        const result = selectedRunResult(queue, null, text(claim?.message || claim?.error || \"선택 상품 작업 확보 실패\"));",
    ].join("\n"),
    [
      "      if (!claim?.ok) {",
      "        const claimMessage = text(claim?.message || claim?.error || \"선택 상품 작업 확보 실패\");",
      "        if (/SHOPLING_ACTIVE_WAVE_EXISTS/i.test(claimMessage)) {",
      "          setTimeout(() => void selectedCoordinatorTick(), 450);",
      "          return;",
      "        }",
      "        const result = selectedRunResult(queue, null, claimMessage);",
    ].join("\n"),
    "v0325_active_wave_retry_missing",
  );

  assertScript("content-v0325", rewritten);
  return rewritten;
}

function rewritePopup(source: string) {
  let rewritten = rewriteRuntime(source);
  rewritten = rewritten
    .replace('const LEGACY_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0323";', 'const LEGACY_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0324";')
    .replace('const LEGACY_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0323";', 'const LEGACY_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0324";');
  assertScript("popup-v0325", rewritten);
  return rewritten;
}

export async function GET() {
  const response = await getV0324Package();
  if (!response.ok) throw new Error(`shopling_market_sender_v0324_source_http_${response.status}`);
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));

  const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as { version?: string; description?: string };
  if (manifest.version !== "0.3.24") throw new Error("shopling_market_sender_v0325_source_version_mismatch");
  manifest.version = VERSION;
  manifest.description = "복수상품 선택 시 동일 상품의 3+3 wave가 겹치지 않도록 서버 잠금을 적용하고, Shopling 결과에서 성공 1건이 확인되는 즉시 채널을 성공 확정하는 내부 운영 버전입니다.";
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  entries["background-root.mjs"] = strToU8(rewriteBackground(strFromU8(entries["background-root.mjs"])));
  entries["content-group-canary.mjs"] = strToU8(rewriteContent(strFromU8(entries["content-group-canary.mjs"])));
  entries["popup.js"] = strToU8(rewritePopup(strFromU8(entries["popup.js"])));
  entries["popup.html"] = strToU8(
    rewriteRuntime(strFromU8(entries["popup.html"]))
      .replace(
        "동일 B코드는 업로드 배치ID/시간으로 구분 · 과거건은 A18 미등록 검색으로 실등록 자동확인",
        "동일 B코드는 업로드 배치ID/시간으로 구분 · 상품별 wave 중복잠금 · 성공 1건 즉시 성공확정",
      ),
  );
  entries["VERSION.txt"] = strToU8(`Commerce OS Shopling Market Sender v${VERSION}\n`);

  const previousReadme = strFromU8(entries["README.txt"] || new Uint8Array());
  entries["README.txt"] = strToU8(
    `v0.3.25 MULTI-PRODUCT WAVE LOCK + EARLY SUCCESS SETTLEMENT\n` +
    `- 복수 상품 선택 중 같은 상품에서 1차/2차 3채널 wave가 겹쳐 서로 다른 run_id로 동시에 claim되는 경쟁조건을 서버 DB trigger로 차단합니다.\n` +
    `- active wave 충돌 응답은 실패로 넘기지 않고 짧게 대기 후 같은 상품 상태를 다시 확인합니다.\n` +
    `- Shopling 한 채널에서 성공 결과가 1건이라도 확인되면 나머지 결과 frame이 늦어도 즉시 sent로 확정합니다.\n` +
    `- 성공이 0건일 때만 모든 결과가 정착한 뒤 confirm_needed를 판정합니다.\n` +
    `- 상품은 계속 순차 처리하고 상품 내부만 최대 3채널씩 3+3 병렬로 처리합니다.\n\n` +
    previousReadme,
  );

  const output = zipSync(entries, { level: 0 });
  return new Response(Buffer.from(output), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=commerce-os-shopling-market-sender-v0.3.25.zip",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
