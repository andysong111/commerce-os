import { readFile } from "node:fs/promises";
import path from "node:path";
import { strToU8, zipSync } from "fflate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Historical checkpoint markers retained for the v0.5.4 regression contract only:
// commerce-os-shopling-account-title-bridge-v0.5.4.zip
// Commerce OS Shopling Account Title Bridge v0.5.4

const FILES = [
  "manifest.json",
  "content-shopling-account-titles.js",
  "content-shopling-product-list-batch.js",
  "content-shopling-product-list-registry-bridge.js",
  "content-shopling-lifecycle-diagnostic.js",
  "content-shopling-pipeline.js",
  "content-shopling-pipeline-frame-bridge.js",
  "content-shopling-onebutton-stability-v054.js",
  "background-shopling-root.js",
  "background-shopling-title-batch.js",
  "background-shopling-title-registry.js",
  "background-shopling-seo-keywords.js",
  "background-shopling-pipeline.js",
  "background-shopling-lifecycle.js",
  "README.txt",
] as const;

const CANONICAL_SNIPPET = String.raw`  function canonical(value) {
    return text(value).replace(/\s+/g, "").toUpperCase();
  }
`;

const IDENTITY_HELPERS = String.raw`
  function escapeRegex(value) {
    return text(value).replace(/[|\\{}()[\]^$+*?.-]/g, "\\$&");
  }

  function rowMatchesExactIdentity(entry, context) {
    const label = text(entry?.label);
    const ptnGoodsCd = text(context?.ptnGoodsCd);
    const goodsKey = text(context?.goodsKey);
    if (!ptnGoodsCd || !/^\d{5,9}$/.test(goodsKey)) return false;
    const codePattern = new RegExp("(?:^|[^A-Z0-9_])" + escapeRegex(ptnGoodsCd) + "(?:[^A-Z0-9_]|$)", "i");
    const goodsKeyPattern = new RegExp("(?:^|\\D)" + escapeRegex(goodsKey) + "(?:\\D|$)");
    return codePattern.test(label) && goodsKeyPattern.test(label);
  }
`;

const LEGACY_IDENTITY_MATCH = String.raw`      const exact = canonical(context.ptnGoodsCd);
      const matchingRows = dataRowsWithCheckboxes().filter((entry) => canonical(entry.label).includes(exact));`;

const DUAL_IDENTITY_MATCH = String.raw`      const matchingRows = dataRowsWithCheckboxes().filter((entry) => rowMatchesExactIdentity(entry, context));`;

const LEGACY_AMBIGUOUS_REASON = '          "exact_product_row_ambiguous",';
const DUAL_AMBIGUOUS_REASON = '          "exact_product_identity_ambiguous",';
const LEGACY_AMBIGUOUS_MESSAGE = '          `${context.ptnGoodsCd} 정확일치 선택행이 ${matchingRows.length}개입니다. 다른 상품을 건드리지 않고 중단합니다.`,';
const DUAL_AMBIGUOUS_MESSAGE = '          `${context.ptnGoodsCd} + 상품번호 ${context.goodsKey} 동시 정확일치 행이 ${matchingRows.length}개입니다. 다른 상품을 건드리지 않고 중단합니다.`,';

const LEGACY_CATEGORY_BLOCK = String.raw`      {
        name: "카테고리 미매핑시 기본정보 카테고리",
        pattern: /매핑된\s*카테고리가\s*없을시.*무시하고.*쇼핑몰기본정보의\s*카테고리로\s*전송/,
      },`;

const VERIFIED_CATEGORY_BLOCK = String.raw`      { name: "매핑된 카테고리로 전송", pattern: /^매핑된\s*카테고리로\s*전송$/ },
      {
        name: "카테고리 미매핑시 기본정보 카테고리",
        pattern: /무시하고.*쇼핑몰기본정보.*카테고리로\s*전송/i,
      },`;

function rewritePipeline(source: string) {
  if (!source.includes(CANONICAL_SNIPPET)) throw new Error("shopling_v056_canonical_anchor_missing");
  if (!source.includes(LEGACY_IDENTITY_MATCH)) throw new Error("shopling_v056_identity_anchor_missing");
  if (!source.includes(LEGACY_CATEGORY_BLOCK)) throw new Error("shopling_v056_category_anchor_missing");

  // IMPORTANT: function replacers are required here. A plain replacement string
  // interprets `$&` inside the generated escapeRegex source as "insert the whole
  // matched canonical function", which corrupts the downloadable extension.
  const rewritten = source
    .replace(CANONICAL_SNIPPET, () => `${CANONICAL_SNIPPET}${IDENTITY_HELPERS}`)
    .replace(LEGACY_IDENTITY_MATCH, () => DUAL_IDENTITY_MATCH)
    .replace(LEGACY_AMBIGUOUS_REASON, () => DUAL_AMBIGUOUS_REASON)
    .replace(LEGACY_AMBIGUOUS_MESSAGE, () => DUAL_AMBIGUOUS_MESSAGE)
    .replace(LEGACY_CATEGORY_BLOCK, () => VERIFIED_CATEGORY_BLOCK);

  if (!rewritten.includes("rowMatchesExactIdentity(entry, context)")) throw new Error("shopling_v056_identity_rewrite_failed");
  if (!rewritten.includes("exact_product_identity_ambiguous")) throw new Error("shopling_v056_identity_reason_rewrite_failed");
  if (!rewritten.includes("/무시하고.*쇼핑몰기본정보.*카테고리로\\s*전송/i")) throw new Error("shopling_v056_category_rewrite_failed");

  // Validate the exact generated content that will be placed in the ZIP, not
  // only the source file in Git. Never distribute a syntactically broken worker.
  try {
    new Function(rewritten);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "unknown syntax error");
    throw new Error(`shopling_v056_generated_pipeline_syntax_invalid: ${message}`);
  }
  return rewritten;
}

export async function GET() {
  const root = path.join(process.cwd(), "public", "shopling-account-title-bridge");
  const entries: Record<string, Uint8Array> = {};

  for (const fileName of FILES) {
    if (fileName === "manifest.json") {
      const manifest = JSON.parse(await readFile(path.join(root, fileName), "utf8")) as Record<string, unknown>;
      manifest.version = "0.5.6";
      manifest.description = "상품번호+자사상품코드 동시 정확일치 후에만 마켓 전송하고, 상품 생애주기 판매상태 자동화를 위한 Shopling DOM은 읽기 전용으로 진단합니다.";
      entries[fileName] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
      continue;
    }

    if (fileName === "content-shopling-pipeline.js") {
      const source = await readFile(path.join(root, fileName), "utf8");
      entries[fileName] = strToU8(rewritePipeline(source));
      continue;
    }

    const bytes = await readFile(path.join(root, fileName));
    entries[fileName] = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  entries["VERSION.txt"] = strToU8("Commerce OS Shopling Account Title Bridge v0.5.6\n");
  const archive = zipSync(entries, { level: 6 });
  return new Response(Buffer.from(archive), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=commerce-os-shopling-account-title-bridge-v0.5.6.zip",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
