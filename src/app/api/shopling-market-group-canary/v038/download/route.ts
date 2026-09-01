import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getV037Package } from "../../download/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.3.8";

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
    throw new Error(`shopling_parallel_worker_${name}_invalid: ${message}`);
  }
}

function rewriteBackground(source: string) {
  let rewritten = source
    .replaceAll("commerceOsShoplingParallelWorkerMetaV037", "commerceOsShoplingParallelWorkerMetaV038")
    .replaceAll("v037", "v038");

  rewritten = replaceOnce(
    rewritten,
    `function claimApi(runId) {\n  return requestJson(CLAIM_API_ENDPOINT, { bridge: CLAIM_API_BRIDGE, runId });\n}`,
    `function normalizeVisibleGoodsKeys(raw) {\n  return [...new Set((Array.isArray(raw) ? raw : []).map(text).filter((key) => /^\\d{5,9}$/.test(key)))].slice(0, 25);\n}\n\nfunction claimApi(runId, rawVisibleGoodsKeys) {\n  const visibleGoodsKeys = normalizeVisibleGoodsKeys(rawVisibleGoodsKeys);\n  return requestJson(CLAIM_API_ENDPOINT, { bridge: CLAIM_API_BRIDGE, runId, visibleGoodsKeys });\n}`,
    "shopling_parallel_worker_v038_claim_api_anchor_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `async function claimOneProduct(runId) {\n  if (!validRunId(runId)) return { ok: false, error: "invalid_group_canary_run_id" };\n  const response = await claimApi(runId);`,
    `async function claimOneProduct(runId, rawVisibleGoodsKeys) {\n  if (!validRunId(runId)) return { ok: false, error: "invalid_group_canary_run_id" };\n  const visibleGoodsKeys = normalizeVisibleGoodsKeys(rawVisibleGoodsKeys);\n  if (!visibleGoodsKeys.length) return { ok: false, error: "visible_a18_goods_keys_missing" };\n  const response = await claimApi(runId, visibleGoodsKeys);`,
    "shopling_parallel_worker_v038_claim_driver_anchor_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `    claimOneProduct(runId).then(sendResponse).catch((error) => sendResponse({`,
    `    claimOneProduct(runId, message.visibleGoodsKeys).then(sendResponse).catch((error) => sendResponse({`,
    "shopling_parallel_worker_v038_claim_listener_anchor_missing",
  );

  assertScript("background-v038", rewritten);
  return rewritten;
}

function rewriteContent(source: string) {
  let rewritten = source
    .replaceAll("0.3.7", VERSION)
    .replaceAll("V037", "V038")
    .replaceAll("v037", "v038");

  rewritten = replaceOnce(
    rewritten,
    `  const RESULT_SETTLE_MS = 2500;`,
    `  const RESULT_SETTLE_MS = 2500;\n  const UNREGISTERED_RESULT_TIMEOUT_MS = 10000;`,
    "shopling_parallel_worker_v038_search_timeout_anchor_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `  function isProductListUi() {`,
    `  function visibleProductGoodsKeys() {\n    const keys = [];\n    const seen = new Set();\n    for (const row of document.querySelectorAll("tr")) {\n      const label = text(row.innerText || row.textContent || "");\n      if (!/(?:DM[1-4]|SM[12])_[A-Z0-9]+/i.test(label)) continue;\n      const goodsKey = [...row.querySelectorAll("a")]\n        .map((anchor) => text(anchor.textContent))\n        .find((value) => /^\\d{5,9}$/.test(value));\n      if (!goodsKey || seen.has(goodsKey)) continue;\n      seen.add(goodsKey);\n      keys.push(goodsKey);\n    }\n    return keys.slice(0, 25);\n  }\n\n  function isProductListUi() {`,
    "shopling_parallel_worker_v038_visible_goods_anchor_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `    const claim = await sendMessage({ type: CLAIM_MESSAGE, runId });\n    if (!claim?.ok) {\n      setPanelStatus(\`대상 확보 실패: \${text(claim?.message || claim?.error)}\`, "error", false);\n      return;\n    }`,
    `    const visibleGoodsKeys = visibleProductGoodsKeys();\n    if (!visibleGoodsKeys.length) {\n      throw new Error("현재 A18 화면에서 상품번호를 식별하지 못했습니다. 화면을 새로고침한 뒤 다시 시도하세요.");\n    }\n    const claim = await sendMessage({ type: CLAIM_MESSAGE, runId, visibleGoodsKeys });\n    if (!claim?.ok) {\n      throw new Error(text(claim?.message || claim?.error || "A18 대상 확보 실패"));\n    }`,
    "shopling_parallel_worker_v038_visible_claim_anchor_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `      await sleep(750);\n      const rows = exactProductRows(task);\n      if (rows.length === 0) {\n        await completeTask(\n          state,\n          "already_registered",\n          "no_exact_unregistered_identity",\n          \`\${task.goodsKey} + \${task.ptnGoodsCd}는 \${task.profile} 미등록 검색에 없어 재송신하지 않습니다.\`,\n        );\n        return;\n      }`,
    `      await sleep(750);\n      const rows = exactProductRows(task);\n      if (rows.length === 0) {\n        const age = Date.now() - Number(state.stepAt || 0);\n        const body = bodyText();\n        const countMatch = body.match(/총\\s*조회수\\s*[:：]?\\s*([\\d,]+)\\s*건/i);\n        const resultCount = countMatch ? Number(String(countMatch[1]).replace(/,/g, "")) || 0 : null;\n        if (resultCount === 0 && age >= 1500) {\n          await completeTask(\n            state,\n            "already_registered",\n            "confirmed_zero_unregistered_results",\n            \`\${task.goodsKey} + \${task.ptnGoodsCd}의 \${task.profile} 미등록 검색 결과가 0건이라 재송신하지 않습니다.\`,\n          );\n          return;\n        }\n        if (age < UNREGISTERED_RESULT_TIMEOUT_MS) return;\n        await failTask(\n          state,\n          "unregistered_search_result_not_ready",\n          \`\${task.profile} 미등록 검색 결과가 \${UNREGISTERED_RESULT_TIMEOUT_MS / 1000}초 안에 정확일치로 확정되지 않았습니다. 조회수=\${resultCount == null ? "미확인" : resultCount}\`,\n        );\n        return;\n      }`,
    "shopling_parallel_worker_v038_no_exact_row_anchor_missing",
  );

  assertScript("content-v038", rewritten);
  return rewritten;
}

function rewritePopup(source: string) {
  let rewritten = source
    .replaceAll("0.3.7", VERSION)
    .replaceAll("V037", "V038")
    .replaceAll("v037", "v038");

  rewritten = replaceOnce(
    rewritten,
    `  const confirm = states.filter(function (row) { return row.status === "confirm_needed"; }).length;\n  statusNode.textContent = "v" + VERSION + " · " + text(run.status) + " · 실행 " + running + " · 성공 " + sent + " · 이미등록 " + skipped + " · 실패 " + failed + " · 확인필요 " + confirm;\n  startButton.disabled = run.status === "opening" || run.status === "running" || run.status === "confirm_needed";`,
    `  const confirm = states.filter(function (row) { return row.status === "confirm_needed"; }).length;\n  const total = Array.isArray(run.tasks) ? run.tasks.length : states.length;\n  let effectiveStatus = run.status;\n  if (running === 0 && total > 0 && states.length >= total) {\n    effectiveStatus = confirm > 0 ? "confirm_needed" : "completed";\n    if (effectiveStatus !== run.status) {\n      const nextRun = Object.assign({}, run, { status: effectiveStatus, updatedAt: Date.now() });\n      await chrome.storage.local.set({ [RUN_STATE_KEY]: nextRun });\n    }\n  }\n  statusNode.textContent = "v" + VERSION + " · " + text(effectiveStatus) + " · 실행 " + running + " · 성공 " + sent + " · 이미등록 " + skipped + " · 실패 " + failed + " · 확인필요 " + confirm;\n  startButton.disabled = effectiveStatus === "opening" || effectiveStatus === "running" || effectiveStatus === "confirm_needed";`,
    "shopling_parallel_worker_v038_popup_terminal_anchor_missing",
  );

  assertScript("popup-v038", rewritten);
  return rewritten;
}

export async function GET() {
  const response = await getV037Package();
  if (!response.ok) throw new Error(`shopling_parallel_worker_v037_source_http_${response.status}`);
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));

  const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as {
    version?: string;
    description?: string;
  };
  if (manifest.version !== "0.3.7") throw new Error("shopling_parallel_worker_v038_source_version_mismatch");
  manifest.version = VERSION;
  manifest.description = "현재 A18 화면에 실제 보이는 상품번호로 처리 대상을 고정하고, 검색결과 지연 오판과 실행상태 고착을 막은 병렬 등록 버전입니다.";
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  const background = rewriteBackground(strFromU8(entries["background-root.mjs"]));
  const content = rewriteContent(strFromU8(entries["content-group-canary.mjs"]));
  const popup = rewritePopup(strFromU8(entries["popup.js"]));
  const popupHtml = strFromU8(entries["popup.html"])
    .replaceAll("0.3.7", VERSION)
    .replace(
      "실제 Shopling 결과창의 모든 쇼핑몰 결과가 끝난 뒤 성공/실패를 자동 확정합니다.",
      "현재 A18 화면에 보이는 상품만 대상으로 고정하고, 모든 쇼핑몰 결과가 끝난 뒤 성공/실패를 자동 확정합니다.",
    );

  entries["background-root.mjs"] = strToU8(background);
  entries["content-group-canary.mjs"] = strToU8(content);
  entries["popup.js"] = strToU8(popup);
  entries["popup.html"] = strToU8(popupHtml);
  entries["VERSION.txt"] = strToU8(`Commerce OS Shopling Market Parallel Fresh Worker Canary v${VERSION}\n`);
  entries["README.txt"] = strToU8(
    `v${VERSION} A18-VISIBLE ANCHORED HOTFIX\n` +
    `- 버튼을 누른 A18 화면에서 실제 보이는 goods_key만 서버 claim 후보로 전달합니다.\n` +
    `- 과거 partially-sent 상품이나 오래된 대기상품을 임의로 선택하지 않습니다.\n` +
    `- 미등록 검색에서 행이 즉시 안 보인다는 이유만으로 already_registered 처리하지 않습니다.\n` +
    `- 총 조회수 0건이 확인돼야 already_registered, 그 외 미확정은 10초 후 해당 채널만 안전 원복합니다.\n` +
    `- 인페이지 패널이 없어도 popup이 terminal run 상태를 자동 정리하여 버튼이 running에 고착되지 않습니다.\n\n` +
    strFromU8(entries["README.txt"]),
  );

  if (!background.includes("visibleGoodsKeys")) throw new Error("shopling_parallel_worker_v038_visible_claim_missing");
  if (!background.includes("message.visibleGoodsKeys")) throw new Error("shopling_parallel_worker_v038_visible_claim_listener_missing");
  if (!content.includes("visibleProductGoodsKeys")) throw new Error("shopling_parallel_worker_v038_visible_goods_extractor_missing");
  if (!content.includes("UNREGISTERED_RESULT_TIMEOUT_MS = 10000")) throw new Error("shopling_parallel_worker_v038_search_timeout_missing");
  if (!content.includes("confirmed_zero_unregistered_results")) throw new Error("shopling_parallel_worker_v038_zero_result_guard_missing");
  if (!content.includes("unregistered_search_result_not_ready")) throw new Error("shopling_parallel_worker_v038_search_wait_guard_missing");
  if (!popup.includes("effectiveStatus")) throw new Error("shopling_parallel_worker_v038_popup_terminal_reconcile_missing");
  if (content.includes("document.documentElement.appendChild(box)")) throw new Error("shopling_parallel_worker_v038_shopling_dom_panel_present");

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
