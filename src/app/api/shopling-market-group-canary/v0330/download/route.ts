import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  COMMERCE_OS_MARKET_AUTO_BRIDGE_V0330,
  SHOPLING_MARKET_AUTO_AGENT_V0330,
} from "@/lib/shoplingMarketAutoExtensionV0330";
import { GET as getV0329Package } from "../../v0329/download/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.3.30";

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
    .replaceAll("0.3.29", VERSION)
    .replaceAll("V0329", "V0330")
    .replaceAll("v0329", "v0330");
}

function rewriteBackground(source: string) {
  let rewritten = rewriteRuntime(source)
    .replace(
      'const LEGACY_WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0328";',
      'const LEGACY_WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0329";',
    );

  rewritten = replaceRequired(
    rewritten,
    'const WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0330";',
    [
      'const WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0330";',
      'const MARKET_AUTO_ENDPOINT = "https://commerce-os-ops-center.vercel.app/api/shopling-market-auto-orchestration";',
      'const MARKET_AUTO_BRIDGE = "shopling-market-auto-agent-v0.1";',
      'const MARKET_AUTO_BG_HANDOFF = "commerce-os-shopling-market-auto-bg-handoff-v0330";',
      'const MARKET_AUTO_BG_TICK = "commerce-os-shopling-market-auto-bg-tick-v0330";',
      'const MARKET_AUTO_BG_HEARTBEAT = "commerce-os-shopling-market-auto-bg-heartbeat-v0330";',
      'const MARKET_AUTO_BG_REPORT = "commerce-os-shopling-market-auto-bg-report-v0330";',
      'const MARKET_AUTO_TOKENS_KEY = "commerceOsShoplingMarketAutoTokensV0330";',
      'const MARKET_AUTO_AGENT_ID_KEY = "commerceOsShoplingMarketAutoAgentIdV1";',
    ].join("\n"),
    "v0330_background_auto_constants_anchor_missing",
  );

  const helpers = String.raw`
function marketAutoStorageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (stored) => {
      void chrome.runtime.lastError;
      resolve(stored || {});
    });
  });
}

function marketAutoStorageSet(values) {
  return new Promise((resolve) => {
    chrome.storage.local.set(values, () => {
      void chrome.runtime.lastError;
      resolve(values);
    });
  });
}

async function marketAutoAgentId() {
  const stored = await marketAutoStorageGet(MARKET_AUTO_AGENT_ID_KEY);
  const current = text(stored?.[MARKET_AUTO_AGENT_ID_KEY]);
  if (/^[A-Za-z0-9._:-]{12,180}$/.test(current)) return current;
  const created = "shopling-agent-" + crypto.randomUUID();
  await marketAutoStorageSet({ [MARKET_AUTO_AGENT_ID_KEY]: created });
  return created;
}

async function marketAutoTokens() {
  const stored = await marketAutoStorageGet(MARKET_AUTO_TOKENS_KEY);
  const rows = Array.isArray(stored?.[MARKET_AUTO_TOKENS_KEY]) ? stored[MARKET_AUTO_TOKENS_KEY] : [];
  return rows.map((row) => ({
    token: text(row?.token),
    orchestrationId: text(row?.orchestrationId),
    createdAt: Number(row?.createdAt || 0),
  })).filter((row) => /^[A-Za-z0-9_-]{32,180}$/.test(row.token) && /^[0-9a-f-]{36}$/i.test(row.orchestrationId));
}

async function marketAutoSaveTokens(rows) {
  const unique = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row?.token || seen.has(row.token)) continue;
    seen.add(row.token);
    unique.push(row);
  }
  await marketAutoStorageSet({ [MARKET_AUTO_TOKENS_KEY]: unique.slice(-20) });
  return unique;
}

async function marketAutoAddToken(token, orchestrationId) {
  const rows = await marketAutoTokens();
  const next = rows.filter((row) => row.token !== token && row.orchestrationId !== orchestrationId);
  next.push({ token, orchestrationId, createdAt: Date.now() });
  await marketAutoSaveTokens(next);
  return true;
}

async function marketAutoRemoveToken(token) {
  const rows = await marketAutoTokens();
  await marketAutoSaveTokens(rows.filter((row) => row.token !== token));
}

async function marketAutoRequest(action, token) {
  const agentId = await marketAutoAgentId();
  return requestJson(MARKET_AUTO_ENDPOINT, {
    action,
    bridge: MARKET_AUTO_BRIDGE,
    token,
    agentId,
  });
}

async function marketAutoTick() {
  const rows = await marketAutoTokens();
  for (const row of rows) {
    const response = await marketAutoRequest("agent_poll", row.token);
    if (!response?.ok) continue;
    if (response.terminal === true) {
      await marketAutoRemoveToken(row.token);
      continue;
    }
    if (response.ready === true && Array.isArray(response.jobIds) && response.jobIds.length) {
      return { ...response, token: row.token, ok: true };
    }
  }
  return { ok: true, ready: false };
}

async function marketAutoHeartbeat(token) {
  return marketAutoRequest("agent_heartbeat", token);
}

async function marketAutoReport(token) {
  const response = await marketAutoRequest("agent_report", token);
  if (response?.ok && response.terminal === true) await marketAutoRemoveToken(token);
  return response;
}
`;

  rewritten = replaceRequired(
    rewritten,
    "function api(body) {",
    `${helpers}\nfunction api(body) {`,
    "v0330_background_auto_helpers_anchor_missing",
  );

  rewritten = replaceRequired(
    rewritten,
    "  if (message.type === CLAIM_MESSAGE) {",
    [
      "  if (message.type === MARKET_AUTO_BG_HANDOFF) {",
      "    const token = text(message.token);",
      "    const orchestrationId = text(message.orchestrationId);",
      "    if (!/^[A-Za-z0-9_-]{32,180}$/.test(token) || !/^[0-9a-f-]{36}$/i.test(orchestrationId)) {",
      "      sendResponse({ ok: false, error: \"invalid_market_auto_handoff\" });",
      "      return false;",
      "    }",
      "    marketAutoAddToken(token, orchestrationId).then(() => marketAutoAgentId()).then((agentId) => sendResponse({ ok: true, agentId, orchestrationId })).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));",
      "    return true;",
      "  }",
      "",
      "  if (message.type === MARKET_AUTO_BG_TICK) {",
      "    marketAutoTick().then(sendResponse).catch((error) => sendResponse({ ok: false, ready: false, error: String(error?.message || error) }));",
      "    return true;",
      "  }",
      "",
      "  if (message.type === MARKET_AUTO_BG_HEARTBEAT) {",
      "    const token = text(message.token);",
      "    marketAutoHeartbeat(token).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));",
      "    return true;",
      "  }",
      "",
      "  if (message.type === MARKET_AUTO_BG_REPORT) {",
      "    const token = text(message.token);",
      "    marketAutoReport(token).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));",
      "    return true;",
      "  }",
      "",
      "  if (message.type === CLAIM_MESSAGE) {",
    ].join("\n"),
    "v0330_background_auto_handlers_anchor_missing",
  );

  assertScript("background-v0330", rewritten);
  return rewritten;
}

function rewriteContent(source: string) {
  const rewritten = rewriteRuntime(source)
    .replace(
      'const LEGACY_RUN_STATE_KEY = "commerceOsShoplingParallelRunV0328";',
      'const LEGACY_RUN_STATE_KEY = "commerceOsShoplingParallelRunV0329";',
    )
    .replace(
      'const LEGACY_WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0328";',
      'const LEGACY_WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0329";',
    )
    .replace(
      'const LEGACY_SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0328";',
      'const LEGACY_SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0329";',
    )
    .replace(
      'const LEGACY_SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0328";',
      'const LEGACY_SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0329";',
    );
  assertScript("content-v0330", rewritten);
  return rewritten;
}

function rewritePopup(source: string) {
  const rewritten = rewriteRuntime(source)
    .replace(
      'const LEGACY_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0328";',
      'const LEGACY_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0329";',
    )
    .replace(
      'const LEGACY_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0328";',
      'const LEGACY_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0329";',
    );
  assertScript("popup-v0330", rewritten);
  return rewritten;
}

export async function GET() {
  const response = await getV0329Package();
  if (!response.ok) throw new Error(`shopling_market_sender_v0329_source_http_${response.status}`);
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as {
    version?: string;
    description?: string;
    content_scripts?: Array<Record<string, unknown>>;
  };
  if (manifest.version !== "0.3.29") throw new Error("shopling_market_sender_v0330_source_version_mismatch");

  manifest.version = VERSION;
  manifest.description = "Commerce OS SEO 대량등록 클라우드의 원클릭 작업을 자동 인계받아 Shopling 업로드 완료 뒤 A18에서 최대 3상품/18채널 마켓전송까지 이어가는 브라우저 에이전트 버전입니다.";
  const existingScripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
  manifest.content_scripts = [
    ...existingScripts,
    {
      matches: ["https://commerce-os-ops-center.vercel.app/*"],
      js: ["commerce-os-market-auto-bridge.mjs"],
      run_at: "document_idle",
    },
    {
      matches: ["*://*.shopling.co.kr/*"],
      js: ["shopling-market-auto-agent.mjs"],
      all_frames: false,
      run_at: "document_idle",
    },
  ];

  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
  entries["background-root.mjs"] = strToU8(rewriteBackground(strFromU8(entries["background-root.mjs"])));
  entries["content-group-canary.mjs"] = strToU8(rewriteContent(strFromU8(entries["content-group-canary.mjs"])));
  entries["popup.js"] = strToU8(rewritePopup(strFromU8(entries["popup.js"])));
  entries["popup.html"] = strToU8(rewriteRuntime(strFromU8(entries["popup.html"])));
  entries["commerce-os-market-auto-bridge.mjs"] = strToU8(COMMERCE_OS_MARKET_AUTO_BRIDGE_V0330);
  entries["shopling-market-auto-agent.mjs"] = strToU8(SHOPLING_MARKET_AUTO_AGENT_V0330);
  entries["VERSION.txt"] = strToU8(`Commerce OS Shopling Market Sender v${VERSION}\n`);

  const previousReadme = strFromU8(entries["README.txt"] || new Uint8Array());
  entries["README.txt"] = strToU8(
    `v0.3.30 ONE-CLICK SEO CLOUD HANDOFF\n` +
      `- SEO 대량등록 클라우드의 '샵플링 일괄 대량등록 및 마켓전송' 버튼과 직접 연결됩니다.\n` +
      `- 버튼 클릭 시 서버에 durable orchestration을 만들고, Shopling 업로드가 끝날 때까지 기다린 뒤 확장프로그램이 팝업 조작 없이 자동으로 마켓전송을 시작합니다.\n` +
      `- Shopling 관리자/A18 탭 1개만 유지하면 최대 3상품/18채널 전체병렬 구조를 그대로 사용합니다.\n` +
      `- 브라우저 재시작에도 handoff token과 서버 lease를 이용해 재연결하며, 모든 송신은 기존 goods_key + 자사상품코드 A18 미등록 사전검증을 거칩니다.\n` +
      `- 성공 1건 이상이면 채널 성공, 성공 0건이면 확인필요라는 기존 운영정책을 유지합니다.\n\n` +
      previousReadme,
  );

  assertScript("commerce-os-auto-bridge-v0330", COMMERCE_OS_MARKET_AUTO_BRIDGE_V0330);
  assertScript("shopling-auto-agent-v0330", SHOPLING_MARKET_AUTO_AGENT_V0330);
  const output = zipSync(entries, { level: 0 });
  return new Response(Buffer.from(output), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=commerce-os-shopling-market-sender-v0.3.30.zip",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
