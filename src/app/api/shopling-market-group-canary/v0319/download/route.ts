import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getV0318Package } from "../../v0318/download/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.3.19";
const CASSNET_MATCH = "*://*.cassnet.co.kr/*";

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
    .replaceAll("0.3.18", VERSION)
    .replaceAll("V0318", "V0319")
    .replaceAll("v0318", "v0319");
}

function rewriteBackground(source: string) {
  let rewritten = rewriteRuntime(source);
  rewritten = rewritten.replace(
    `    if (!/shopling\\.co\\.kr$/i.test(parsed.hostname)) return false;`,
    `    if (!/(?:shopling|cassnet)\\.co\\.kr$/i.test(parsed.hostname)) return false;`,
  );
  if (!rewritten.includes("(?:shopling|cassnet)\\.co\\.kr")) {
    throw new Error("v0319_background_cassnet_result_host_missing");
  }
  assertScript("background-v0319", rewritten);
  return rewritten;
}

function rewriteContent(source: string) {
  let rewritten = rewriteRuntime(source);
  rewritten = rewritten.replaceAll(
    `/shopling\\.co\\.kr$/i.test(location.hostname)`,
    `/(?:shopling|cassnet)\\.co\\.kr$/i.test(location.hostname)`,
  );
  rewritten = rewritten.replace(
    `    if (!/shopling\\.co\\.kr$/i.test(hostname)) return;`,
    `    if (!/(?:shopling|cassnet)\\.co\\.kr$/i.test(hostname)) return;`,
  );
  if (!rewritten.includes("(?:shopling|cassnet)\\.co\\.kr")) {
    throw new Error("v0319_content_cassnet_result_host_missing");
  }
  assertScript("content-v0319", rewritten);
  return rewritten;
}

export async function GET() {
  const response = await getV0318Package();
  if (!response.ok) throw new Error(`shopling_market_sender_v0318_source_http_${response.status}`);
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));

  const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as {
    version?: string;
    description?: string;
    host_permissions?: string[];
    content_scripts?: Array<{ matches?: string[] }>;
  };
  if (manifest.version !== "0.3.18") throw new Error("shopling_market_sender_v0319_source_version_mismatch");
  manifest.version = VERSION;
  manifest.description = "Shopling 결과창 내부의 cassnet.co.kr 쇼핑몰 결과 프레임까지 직접 읽어 1차 3채널 결과를 sent/confirm_needed로 자동확정하고 2차 3채널을 이어 실행하는 내부 운영 버전입니다.";
  manifest.host_permissions = [...new Set([...(manifest.host_permissions || []), CASSNET_MATCH])];
  manifest.content_scripts = (manifest.content_scripts || []).map((script) => ({
    ...script,
    matches: [...new Set([...(script.matches || []), CASSNET_MATCH])],
  }));
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  entries["background-root.mjs"] = strToU8(rewriteBackground(strFromU8(entries["background-root.mjs"])));
  entries["content-group-canary.mjs"] = strToU8(rewriteContent(strFromU8(entries["content-group-canary.mjs"])));
  entries["popup.js"] = strToU8(rewriteRuntime(strFromU8(entries["popup.js"])));
  entries["popup.html"] = strToU8(rewriteRuntime(strFromU8(entries["popup.html"])));
  entries["VERSION.txt"] = strToU8(`Commerce OS Shopling Market Sender v${VERSION}\n`);

  const previousReadme = strFromU8(entries["README.txt"] || new Uint8Array());
  entries["README.txt"] = strToU8(
    `v0.3.19 CASSNET RESULT FRAME SUPPORT\n` +
    `- 실제 Shopling 결과창은 일부 쇼핑몰 결과를 buss.cassnet.co.kr 같은 cross-origin frame으로 표시합니다.\n` +
    `- cassnet.co.kr을 host_permissions/content_scripts에 추가해 해당 frame의 goods_key와 성공/실패를 직접 수집합니다.\n` +
    `- 1차 3채널 결과가 원장에 확정되지 않아 2차 3채널이 멈추는 현상을 제거합니다.\n` +
    `- 관리자 A18 원본 탭은 1개면 충분하며 별도 관리자 화면을 2개 띄울 필요가 없습니다.\n\n` +
    previousReadme,
  );

  const output = zipSync(entries, { level: 0 });
  return new Response(Buffer.from(output), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=commerce-os-shopling-market-sender-v0.3.19.zip",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
