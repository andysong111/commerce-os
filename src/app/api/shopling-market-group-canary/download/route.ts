import { readFile } from "node:fs/promises";
import path from "node:path";
import { strToU8, zipSync } from "fflate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION_ANCHOR = 'const VERSION = "0.2.0";';
const STATE_ANCHOR = 'const STATE_KEY = "commerceOsShoplingMarketGroupCanaryV020";';
const RUN_ANCHOR = 'return `canary-group-v020-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;';
const RESULT_FUNCTION_ANCHOR = `  function isPreProdChoicePage() {
    return location.hostname === "a.shopling.co.kr" && /\\/prodlinkage\\/goods_mallReg_preProdChoice\\.phtml$/i.test(location.pathname);
  }
`;
const RESULT_FUNCTION_REPLACEMENT = `${RESULT_FUNCTION_ANCHOR}
  function isSubmitResultPage() {
    return /\\/prod_a\\/prod_rgst_rspt\\.phtml$/i.test(location.pathname)
      && /shopling\\.co\\.kr$/i.test(location.hostname);
  }
`;
const DRIVE_ANCHOR = `      if (state.stage === "submit_clicked") {
        if (isProductListUi() || isIdChoicePage() || isPreProdChoicePage()) return;
        await checkSubmitOutcome(state);
        return;
      }`;
const DRIVE_REPLACEMENT = `      if (state.stage === "submit_clicked") {
        if (isProductListUi() || isIdChoicePage() || isPreProdChoicePage()) return;
        if (!isSubmitResultPage()) return;
        await checkSubmitOutcome(state);
        return;
      }`;

function rewriteContent(source: string) {
  for (const anchor of [VERSION_ANCHOR, STATE_ANCHOR, RUN_ANCHOR, RESULT_FUNCTION_ANCHOR, DRIVE_ANCHOR]) {
    if (!source.includes(anchor)) throw new Error("shopling_group_canary_v021_anchor_missing");
  }
  const rewritten = source
    .replace(VERSION_ANCHOR, 'const VERSION = "0.2.1";')
    .replace(STATE_ANCHOR, 'const STATE_KEY = "commerceOsShoplingMarketGroupCanaryV021";')
    .replace(RUN_ANCHOR, 'return `canary-group-v021-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;')
    .replace(RESULT_FUNCTION_ANCHOR, RESULT_FUNCTION_REPLACEMENT)
    .replace(DRIVE_ANCHOR, DRIVE_REPLACEMENT);
  if (!rewritten.includes("if (!isSubmitResultPage()) return;")) throw new Error("shopling_group_canary_v021_result_guard_missing");
  try {
    new Function(rewritten);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "syntax error");
    throw new Error(`shopling_group_canary_v021_generated_content_invalid: ${message}`);
  }
  return rewritten;
}

export async function GET() {
  const root = path.join(process.cwd(), "public", "shopling-market-group-canary");
  const entries: Record<string, Uint8Array> = {};

  const manifest = await readFile(path.join(root, "manifest.json"));
  entries["manifest.json"] = new Uint8Array(manifest.buffer, manifest.byteOffset, manifest.byteLength);

  const background = await readFile(path.join(root, "background-root.mjs"), "utf8");
  try {
    new Function(background);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "syntax error");
    throw new Error(`shopling_group_canary_v021_background_invalid: ${message}`);
  }
  entries["background-root.mjs"] = strToU8(background);

  const content = await readFile(path.join(root, "content-group-canary.mjs"), "utf8");
  entries["content-group-canary.mjs"] = strToU8(rewriteContent(content));

  const readme = (await readFile(path.join(root, "README.txt"), "utf8"))
    .replace(/v0\.2\.0/g, "v0.2.1")
    .concat("\nv0.2.1: 실제 /prod_a/prod_rgst_rspt.phtml 결과 페이지에서만 송신 결과를 판정하며, 부분 완료 상품의 남은 채널을 이어서 claim합니다.\n");
  entries["README.txt"] = strToU8(readme);
  entries["VERSION.txt"] = strToU8("Commerce OS Shopling Market Group Canary v0.2.1\n");

  const archive = zipSync(entries, { level: 0 });
  return new Response(Buffer.from(archive), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=commerce-os-shopling-market-group-canary-v0.2.1.zip",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
