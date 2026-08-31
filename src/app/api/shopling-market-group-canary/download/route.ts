import { readFile } from "node:fs/promises";
import path from "node:path";
import { strToU8, zipSync } from "fflate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.3.4";
const VERSION = "0.3.5";
const BASE_OVERLAY = "content-version-v034.mjs";
const OUTPUT_OVERLAY = "content-version-v035.mjs";

function assertScript(name: string, source: string) {
  try {
    new Function(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "syntax error");
    throw new Error(`shopling_parallel_worker_${name}_invalid: ${message}`);
  }
}

function replaceOnce(source: string, anchor: string, replacement: string, errorCode: string) {
  const first = source.indexOf(anchor);
  if (first < 0) throw new Error(errorCode);
  if (source.indexOf(anchor, first + anchor.length) >= 0) throw new Error(`${errorCode}_ambiguous`);
  return `${source.slice(0, first)}${replacement}${source.slice(first + anchor.length)}`;
}

function rewriteBackground(source: string) {
  const rewritten = replaceOnce(
    source,
    'const WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV034";',
    'const WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV035";',
    "shopling_parallel_worker_v035_background_state_anchor_missing",
  );
  assertScript("background-root-v035", rewritten);
  return rewritten;
}

function rewriteContent(source: string) {
  let rewritten = source;
  rewritten = replaceOnce(
    rewritten,
    'const VERSION = "0.3.4";',
    'const VERSION = "0.3.5";',
    "shopling_parallel_worker_v035_content_version_anchor_missing",
  );
  rewritten = replaceOnce(
    rewritten,
    'const RUN_STATE_KEY = "commerceOsShoplingParallelRunV034";',
    'const RUN_STATE_KEY = "commerceOsShoplingParallelRunV035";',
    "shopling_parallel_worker_v035_run_state_anchor_missing",
  );
  rewritten = replaceOnce(
    rewritten,
    'const WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV034";',
    'const WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV035";',
    "shopling_parallel_worker_v035_worker_state_anchor_missing",
  );
  rewritten = replaceOnce(
    rewritten,
    "  const SUBMIT_CONFIRM_TIMEOUT_MS = 90000;",
    "  const SUBMIT_CONFIRM_TIMEOUT_MS = 90000;\n  const A18_NAVIGATION_TIMEOUT_MS = 20000;",
    "shopling_parallel_worker_v035_a18_timeout_anchor_missing",
  );
  rewritten = replaceOnce(
    rewritten,
    '    if (!["worker_opening", "await_a18", "a18_clicked"].includes(state.stage)) return;',
    '    if (!["worker_opening", "await_a18"].includes(state.stage)) return;',
    "shopling_parallel_worker_v035_repeat_a18_gate_anchor_missing",
  );

  const driveAnchor = `      if (isIdChoicePage()) { await driveIdChoice(state); return; }\n      if (isPreProdChoicePage()) { await drivePreProd(state); return; }\n      if (isProductListUi()) { await driveProductList(state); return; }\n      if (window.top === window && isAdminShell()) await navigateWorkerShell(state);`;
  const driveReplacement = `      if (isIdChoicePage()) { await driveIdChoice(state); return; }\n      if (isPreProdChoicePage()) { await drivePreProd(state); return; }\n      if (isProductListUi()) { await driveProductList(state); return; }\n      if (state.stage === "a18_clicked") {\n        const age = Date.now() - Number(state.stepAt || 0);\n        if (age >= A18_NAVIGATION_TIMEOUT_MS) {\n          await failTask(\n            state,\n            "a18_navigation_timeout",\n            "A18 진입 클릭 후 상품등록 화면을 확인하지 못했습니다. 메뉴를 반복 클릭하지 않고 이 채널만 안전중단했습니다.",\n          );\n        }\n        return;\n      }\n      if (window.top === window && isAdminShell()) await navigateWorkerShell(state);`;
  rewritten = replaceOnce(
    rewritten,
    driveAnchor,
    driveReplacement,
    "shopling_parallel_worker_v035_drive_wait_anchor_missing",
  );

  const panelAnchor = `      "position:fixed",\n      "right:18px",\n      "bottom:40px",\n      "z-index:2147483647",\n      "width:450px",`;
  const panelReplacement = `      "position:fixed!important",\n      "right:18px!important",\n      "bottom:40px!important",\n      "left:auto!important",\n      "top:auto!important",\n      "z-index:2147483647!important",\n      "display:block!important",\n      "width:450px!important",\n      "height:auto!important",\n      "min-height:0!important",\n      "max-width:calc(100vw - 36px)!important",\n      "max-height:calc(100vh - 80px)!important",\n      "box-sizing:border-box!important",\n      "margin:0!important",\n      "transform:none!important",\n      "overflow:visible!important",\n      "contain:layout paint style!important",\n      "isolation:isolate!important",\n      "pointer-events:none!important",\n      "cursor:default!important",`;
  rewritten = replaceOnce(
    rewritten,
    panelAnchor,
    panelReplacement,
    "shopling_parallel_worker_v035_panel_geometry_anchor_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    '    title.style.cssText = "font-weight:700;margin-bottom:5px;color:#0f766e";',
    '    title.style.cssText = "position:static!important;display:block!important;pointer-events:none!important;font-weight:700;margin-bottom:5px;color:#0f766e";',
    "shopling_parallel_worker_v035_title_style_anchor_missing",
  );
  rewritten = replaceOnce(
    rewritten,
    '    guide.style.cssText = "font-size:11px;color:#64748b;margin-bottom:7px";',
    '    guide.style.cssText = "position:static!important;display:block!important;pointer-events:none!important;font-size:11px;color:#64748b;margin-bottom:7px";',
    "shopling_parallel_worker_v035_guide_style_anchor_missing",
  );
  rewritten = replaceOnce(
    rewritten,
    '    status.style.cssText = "margin-bottom:8px;color:#475569";',
    '    status.style.cssText = "position:static!important;display:block!important;pointer-events:none!important;margin-bottom:8px;color:#475569";',
    "shopling_parallel_worker_v035_status_style_anchor_missing",
  );
  rewritten = replaceOnce(
    rewritten,
    '    button.style.cssText = "width:100%;padding:10px;border:0;border-radius:7px;background:#0f766e;color:#fff;font-weight:700;cursor:pointer";',
    '    button.style.cssText = "position:static!important;inset:auto!important;display:block!important;width:100%!important;height:auto!important;min-height:0!important;max-height:none!important;box-sizing:border-box!important;margin:0!important;padding:10px!important;border:0!important;border-radius:7px!important;background:#0f766e!important;color:#fff!important;font:700 12px/1.45 Arial,sans-serif!important;pointer-events:auto!important;cursor:pointer!important;transform:none!important";',
    "shopling_parallel_worker_v035_button_style_anchor_missing",
  );
  rewritten = replaceOnce(
    rewritten,
    '    guard.style.cssText = "font-size:10px;color:#0f766e;margin-top:7px";',
    '    guard.style.cssText = "position:static!important;display:block!important;pointer-events:none!important;font-size:10px;color:#0f766e;margin-top:7px";',
    "shopling_parallel_worker_v035_guard_style_anchor_missing",
  );

  assertScript("content-group-canary-v035", rewritten);
  return rewritten;
}

function rewriteOverlay(source: string) {
  let rewritten = replaceOnce(
    source,
    'const DISPLAY_VERSION = "0.3.4";',
    'const DISPLAY_VERSION = "0.3.5";',
    "shopling_parallel_worker_v035_overlay_version_anchor_missing",
  );
  rewritten = replaceOnce(
    rewritten,
    "v0\\.3\\.4",
    "v0\\.3\\.5",
    "shopling_parallel_worker_v035_overlay_regex_anchor_missing",
  );
  assertScript("content-version-v035", rewritten);
  return rewritten;
}

export async function GET() {
  const root = path.join(process.cwd(), "public", "shopling-market-group-canary");
  const entries: Record<string, Uint8Array> = {};

  const manifestSource = await readFile(path.join(root, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestSource) as {
    version?: string;
    description?: string;
    permissions?: string[];
    content_scripts?: Array<{ js?: string[] }>;
  };
  if (manifest.version !== BASE_VERSION) throw new Error("shopling_parallel_worker_base_manifest_version_mismatch");
  if (manifest.permissions?.includes("contentSettings")) throw new Error("shopling_parallel_worker_obsolete_popup_permission_present");
  if (manifest.permissions?.includes("scripting")) throw new Error("shopling_parallel_worker_obsolete_launcher_script_permission_present");
  if (!manifest.content_scripts?.[0]?.js?.includes(BASE_OVERLAY)) throw new Error("shopling_parallel_worker_v034_overlay_missing");

  manifest.version = VERSION;
  manifest.description = "Shopling A18 UI를 가로막지 않도록 패널 클릭영역을 격리하고, 복제 Worker의 A18 메뉴 진입을 1회만 수행하는 병렬 등록 핫픽스입니다.";
  manifest.content_scripts = (manifest.content_scripts || []).map((entry) => ({
    ...entry,
    js: (entry.js || []).map((name) => name === BASE_OVERLAY ? OUTPUT_OVERLAY : name),
  }));
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  const backgroundSource = await readFile(path.join(root, "background-root.mjs"), "utf8");
  const contentSource = await readFile(path.join(root, "content-group-canary.mjs"), "utf8");
  const overlaySource = await readFile(path.join(root, BASE_OVERLAY), "utf8");
  entries["background-root.mjs"] = strToU8(rewriteBackground(backgroundSource));
  entries["content-group-canary.mjs"] = strToU8(rewriteContent(contentSource));
  entries[OUTPUT_OVERLAY] = strToU8(rewriteOverlay(overlaySource));

  const background = new TextDecoder().decode(entries["background-root.mjs"]);
  const content = new TextDecoder().decode(entries["content-group-canary.mjs"]);
  if (!background.includes("chrome.tabs.duplicate")) throw new Error("shopling_parallel_worker_a18_duplicate_missing");
  if (!background.includes("Promise.allSettled")) throw new Error("shopling_parallel_worker_parallel_clone_missing");
  if (!background.includes("assignments")) throw new Error("shopling_parallel_worker_assignment_map_missing");
  if (!background.includes("parallel: true")) throw new Error("shopling_parallel_worker_parallel_contract_missing");
  if (!background.includes("commerceOsShoplingParallelWorkerMetaV035")) throw new Error("shopling_parallel_worker_v035_background_state_isolation_missing");
  if (background.includes("clickManagerAccessOnLauncher")) throw new Error("shopling_parallel_worker_obsolete_manager_launcher_present");
  if (background.includes("chrome.contentSettings")) throw new Error("shopling_parallel_worker_obsolete_popup_logic_present");
  if (!background.includes("group-canary-release-v0.3.2")) throw new Error("shopling_parallel_worker_claim_release_missing");
  if (!content.includes("commerceOsShoplingParallelWorkerV035")) throw new Error("shopling_parallel_worker_v035_state_isolation_missing");
  if (!content.includes("commerceOsShoplingParallelRunV035")) throw new Error("shopling_parallel_worker_v035_run_isolation_missing");
  if (content.includes('["worker_opening", "await_a18", "a18_clicked"]')) throw new Error("shopling_parallel_worker_repeat_a18_click_gate_present");
  if (!content.includes("a18_navigation_timeout")) throw new Error("shopling_parallel_worker_a18_one_shot_timeout_missing");
  if (!content.includes("pointer-events:none!important")) throw new Error("shopling_parallel_worker_panel_passthrough_missing");
  if (!content.includes("pointer-events:auto!important")) throw new Error("shopling_parallel_worker_button_pointer_restore_missing");
  if (!content.includes("1채널=1복제창")) throw new Error("shopling_parallel_worker_channel_contract_missing");
  if (!content.includes("ignoredSelpaFailures")) throw new Error("shopling_parallel_worker_selfa_policy_missing");
  if (!content.includes("nonIgnoredFailure")) throw new Error("shopling_parallel_worker_nonselfa_failure_guard_missing");
  if (!content.includes("isSubmitResultPage")) throw new Error("shopling_parallel_worker_result_guard_missing");

  const readme = await readFile(path.join(root, "README.txt"), "utf8");
  entries["README.txt"] = strToU8(
    `v${VERSION} HOTFIX\n- A18 패널 바깥 클릭을 완전히 통과시킵니다.\n- 복제 Worker의 A18 메뉴 hover/click은 최초 1회만 수행합니다.\n- 20초 안에 A18 화면 전환이 확인되지 않으면 반복 클릭 대신 해당 채널만 안전중단합니다.\n\n${readme}`,
  );
  entries["VERSION.txt"] = strToU8(`Commerce OS Shopling Market Parallel Fresh Worker Canary v${VERSION}\n`);

  const archive = zipSync(entries, { level: 0 });
  return new Response(Buffer.from(archive), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename=commerce-os-shopling-market-parallel-fresh-worker-canary-v${VERSION}.zip`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
