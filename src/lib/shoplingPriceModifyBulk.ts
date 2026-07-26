import { unzipSync } from "fflate";

export const BULK_MAX_ITEMS = 20_000;
export const BULK_CANARY_SIZE = 10;
export const BULK_CHUNK_SIZE = 50;

export function normalizeBulkGoodsKeys(values: unknown[]) {
  const seen = new Set<string>();
  const goodsKeys: string[] = [];
  const invalid: string[] = [];
  for (const value of values) {
    const token = String(value ?? "").trim();
    if (!token) continue;
    if (!/^\d+$/.test(token)) { invalid.push(token); continue; }
    if (!seen.has(token)) { seen.add(token); goodsKeys.push(token); }
  }
  if (goodsKeys.length > BULK_MAX_ITEMS) throw new Error(`goods_key는 최대 ${BULK_MAX_ITEMS.toLocaleString()}개입니다.`);
  return { goodsKeys, invalid };
}

export function parseBulkText(input: string) {
  return normalizeBulkGoodsKeys(input.replace(/^\uFEFF/, "").split(/[\s,;|]+/));
}

/** RFC-4180 parser used locally in the browser; quoted commas/newlines and escaped quotes are preserved. */
export function parseBulkCsv(text: string) {
  const cells: string[] = []; let cell = ""; let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i += 1; } else quoted = !quoted;
    } else if (!quoted && (char === "," || char === "\n" || char === "\r")) {
      cells.push(cell); cell = ""; if (char === "\r" && source[i + 1] === "\n") i += 1;
    } else cell += char;
  }
  cells.push(cell);
  return normalizeBulkGoodsKeys(cells);
}

export function decodeBulkCsv(bytes: ArrayBuffer) {
  const raw = new Uint8Array(bytes);
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(raw); }
  catch { text = new TextDecoder("euc-kr").decode(raw); }
  return parseBulkCsv(text);
}

function xmlText(value: string) { return value.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"); }

/** Minimal local XLSX reader: reads only the first worksheet, including sparse and shared-string cells. */
export function parseBulkXlsx(bytes: ArrayBuffer) {
  const files = unzipSync(new Uint8Array(bytes));
  const decoder = new TextDecoder();
  const workbook = decoder.decode(files["xl/workbook.xml"] ?? new Uint8Array());
  const relId = workbook.match(/<sheet\b[^>]*r:id="([^"]+)"/)?.[1];
  const rels = decoder.decode(files["xl/_rels/workbook.xml.rels"] ?? new Uint8Array());
  const target = relId && rels.match(new RegExp(`<Relationship\\b[^>]*Id="${relId}"[^>]*Target="([^"]+)"`))?.[1];
  const sheetPath = target ? `xl/${target.replace(/^\/?xl\//, "")}` : "xl/worksheets/sheet1.xml";
  const sheet = decoder.decode(files[sheetPath] ?? new Uint8Array());
  if (!sheet) throw new Error("XLSX 첫 시트를 읽을 수 없습니다.");
  const sharedXml = decoder.decode(files["xl/sharedStrings.xml"] ?? new Uint8Array());
  const shared = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => xmlText(match[1]));
  const values = [...sheet.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)].map((match) => {
    const type = match[1].match(/\bt="([^"]+)"/)?.[1];
    const value = match[2].match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? match[2].match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? "";
    return type === "s" ? shared[Number(value)] ?? "" : xmlText(value);
  });
  return normalizeBulkGoodsKeys(values);
}

export function createInitialChunks(goodsKeys: string[]) {
  if (!goodsKeys.length) return [];
  const chunks = [{ kind: "canary", goodsKeys: goodsKeys.slice(0, BULK_CANARY_SIZE) }];
  for (let index = BULK_CANARY_SIZE; index < goodsKeys.length; index += BULK_CHUNK_SIZE) chunks.push({ kind: "normal", goodsKeys: goodsKeys.slice(index, index + BULK_CHUNK_SIZE) });
  return chunks;
}

export function failedKeysFromSummary(summary: Record<string, unknown>, chunkKeys: string[]) {
  const errors = Array.isArray(summary.errors) ? summary.errors : [];
  let keys = errors.map((row) => row && typeof row === "object" ? String((row as Record<string, unknown>).goods_key ?? "") : "").filter(Boolean);
  if (!keys.length && Array.isArray(summary.rows)) keys = summary.rows.filter((row) => row && typeof row === "object" && (row as Record<string, unknown>).status !== "success").map((row) => String((row as Record<string, unknown>).goods_key ?? "")).filter(Boolean);
  const allowed = new Set(chunkKeys);
  return [...new Set(keys)].filter((key) => allowed.has(key));
}
