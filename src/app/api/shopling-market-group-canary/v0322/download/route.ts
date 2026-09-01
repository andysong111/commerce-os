import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getV0321Package } from "../../v0321/download/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.3.22";

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
    .replaceAll("0.3.21", VERSION)
    .replaceAll("V0321", "V0322")
    .replaceAll("v0321", "v0322");
}

function rewriteBackground(source: string) {
  let rewritten = rewriteRuntime(source);
  rewritten = rewritten.replace(
    'const LEGACY_WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0320";',
    'const LEGACY_WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0321";',
  );

  const oldPolicy = [
    "  const hasSuccess = frames.some((row) => row.success === true);",
    "  const nonIgnoredFailure = frames.some((row) => row.failure === true && row.isSelpa !== true);",
    "  const anyFailure = frames.some((row) => row.failure === true);",
    "  let outcome = '';",
    "  let reasonCode = '';",
    "  let message = '';",
    "  if (nonIgnoredFailure || (!hasSuccess && anyFailure)) {",
    "    outcome = 'confirm_needed';",
    "    reasonCode = 'shopling_result_background_direct_failure_v0322';",
    "    message = (assignment?.task?.profile || '채널') + ' · background가 cassnet/shopling 결과 프레임 전체에서 비셀파 실패를 확인했습니다. 자동 재송신하지 않습니다.';",
    "  } else if (hasSuccess) {",
    "    outcome = 'sent';",
    "    reasonCode = 'shopling_result_background_direct_success_v0322';",
    "    message = (assignment?.task?.profile || '채널') + ' · background가 cassnet/shopling 결과 프레임 전체를 직접 스캔해 성공을 확인했습니다.';",
    "  } else {",
  ].join("\n");

  const newPolicy = [
    "  const hasSuccess = frames.some((row) => row.success === true);",
    "  const anyFailure = frames.some((row) => row.failure === true);",
    "  let outcome = '';",
    "  let reasonCode = '';",
    "  let message = '';",
    "  if (hasSuccess) {",
    "    outcome = 'sent';",
    "    reasonCode = 'shopling_result_any_success_v0322';",
    "    message = (assignment?.task?.profile || '채널') + ' · Shopling 결과 중 1개 이상 성공이 확인되어 운영정책상 전체 채널을 성공 처리했습니다.';",
    "  } else if (anyFailure) {",
    "    outcome = 'confirm_needed';",
    "    reasonCode = 'shopling_result_all_failed_v0322';",
    "    message = (assignment?.task?.profile || '채널') + ' · Shopling 결과에 성공이 0건이고 실패만 확인되어 자동 재송신 없이 확인필요로 보존합니다.';",
    "  } else {",
  ].join("\n");

  rewritten = replaceRequired(
    rewritten,
    oldPolicy,
    newPolicy,
    "v0322_background_any_success_policy_missing",
  );

  assertScript("background-v0322", rewritten);
  return rewritten;
}

function rewriteContent(source: string) {
  let rewritten = rewriteRuntime(source);
  rewritten = rewritten
    .replace('const LEGACY_RUN_STATE_KEY = "commerceOsShoplingParallelRunV0320";', 'const LEGACY_RUN_STATE_KEY = "commerceOsShoplingParallelRunV0321";')
    .replace('const LEGACY_WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0320";', 'const LEGACY_WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0321";')
    .replace('const LEGACY_SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0320";', 'const LEGACY_SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0321";')
    .replace('const LEGACY_SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0320";', 'const LEGACY_SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0321";');

  const oldOutcome = [
    "    if (hasFailure) {",
    "      await failTask(state, \"shopling_submit_result_has_nonselfa_failure\", `${task.profile} 송신 결과에 셀파 외 실패가 있어 이 채널만 확인필요로 보존합니다.`);",
    "      return;",
    "    }",
    "    if (hasSuccess) {",
  ].join("\n");

  const newOutcome = [
    "    if (hasSuccess) {",
  ].join("\n");

  rewritten = replaceRequired(
    rewritten,
    oldOutcome,
    newOutcome,
    "v0322_content_any_success_priority_missing",
  );

  const oldSuccess = [
    "        \"sent\",",
    "        \"shopling_submit_success_parallel_worker_v0322\",",
    "        `${task.profile} 실제 Shopling 결과창/쇼핑몰별 결과 프레임에서 비셀파 성공을 확인했습니다${ignored}.`,",
    "      );",
    "      return;",
    "    }",
    "    if (!direct.processing && age >= SUBMIT_CONFIRM_TIMEOUT_MS) {",
  ].join("\n");

  const newSuccess = [
    "        \"sent\",",
    "        \"shopling_submit_any_success_parallel_worker_v0322\",",
    "        `${task.profile} Shopling 결과 중 1개 이상 성공이 확인되어 운영정책상 성공 처리했습니다${ignored}.`,",
    "      );",
    "      return;",
    "    }",
    "    if (hasFailure) {",
    "      await failTask(state, \"shopling_submit_result_all_failed_v0322\", `${task.profile} 송신 결과에 성공이 0건이고 실패만 확인되어 이 채널을 확인필요로 보존합니다.`);",
    "      return;",
    "    }",
    "    if (!direct.processing && age >= SUBMIT_CONFIRM_TIMEOUT_MS) {",
  ].join("\n");

  rewritten = replaceRequired(
    rewritten,
    oldSuccess,
    newSuccess,
    "v0322_content_all_failed_fallback_missing",
  );

  assertScript("content-v0322", rewritten);
  return rewritten;
}

function rewritePopup(source: string) {
  let rewritten = rewriteRuntime(source);
  rewritten = rewritten
    .replace('const LEGACY_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0320";', 'const LEGACY_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0321";')
    .replace('const LEGACY_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0320";', 'const LEGACY_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0321";');
  assertScript("popup-v0322", rewritten);
  return rewritten;
}

export async function GET() {
  const response = await getV0321Package();
  if (!response.ok) throw new Error(`shopling_market_sender_v0321_source_http_${response.status}`);
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));

  const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as { version?: string; description?: string };
  if (manifest.version !== "0.3.21") throw new Error("shopling_market_sender_v0322_source_version_mismatch");
  manifest.version = VERSION;
  manifest.description = "Shopling 채널 결과에서 1개 이상 성공이 확인되면 일부 마켓 실패가 있어도 해당 도매/소매 채널을 성공 처리하는 내부 운영 버전입니다.";
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  entries["background-root.mjs"] = strToU8(rewriteBackground(strFromU8(entries["background-root.mjs"])));
  entries["content-group-canary.mjs"] = strToU8(rewriteContent(strFromU8(entries["content-group-canary.mjs"])));
  entries["popup.js"] = strToU8(rewritePopup(strFromU8(entries["popup.js"])));
  entries["popup.html"] = strToU8(rewriteRuntime(strFromU8(entries["popup.html"])));
  entries["VERSION.txt"] = strToU8(`Commerce OS Shopling Market Sender v${VERSION}\n`);

  const previousReadme = strFromU8(entries["README.txt"] || new Uint8Array());
  entries["README.txt"] = strToU8(
    `v0.3.22 ANY-SUCCESS SUCCESS POLICY\n` +
    `- Shopling의 한 도매/소매 채널은 여러 마켓 결과를 포함할 수 있습니다.\n` +
    `- 해당 결과들 중 성공이 1건 이상이면 다른 마켓의 실패가 함께 있어도 채널 전체를 sent로 확정합니다.\n` +
    `- 성공이 0건이고 실패만 확인된 경우에만 confirm_needed로 보존합니다.\n` +
    `- 일부 실패 상세는 결과창에 남을 수 있지만 다음 채널/다음 상품 진행을 막지 않습니다.\n` +
    `- 관리자 A18 원본은 계속 1개만 사용하고 상품 내부 3+3 병렬 구조를 유지합니다.\n\n` +
    previousReadme,
  );

  const output = zipSync(entries, { level: 0 });
  return new Response(Buffer.from(output), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=commerce-os-shopling-market-sender-v0.3.22.zip",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
