import { unzipSync } from "fflate";

export type ShoplingPriceBulkInputResult = {
  source: "paste" | "csv" | "xlsx";
  originalCount: number;
  goodsKeys: string[];
  validCount: number;
  duplicateCount: number;
  invalid: string[];
  invalidCount: number;
};

export const SHOPLING_PRICE_BULK_MAX_FILE_SIZE = 5 * 1024 * 1024;
export const SHOPLING_PRICE_BULK_MAX_GOODS_KEYS = 20_000;
const VALID_GOODS_KEY = /^\d+$/;

function result(source: ShoplingPriceBulkInputResult["source"], values: string[]): ShoplingPriceBulkInputResult {
  const goodsKeys: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  let duplicateCount = 0;
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    if (!VALID_GOODS_KEY.test(value)) { invalid.push(value); continue; }
    if (seen.has(value)) { duplicateCount += 1; continue; }
    seen.add(value);
    goodsKeys.push(value);
    if (goodsKeys.length > SHOPLING_PRICE_BULK_MAX_GOODS_KEYS) {
      throw new Error("유효한 goods_key는 최대 20,000개까지 입력할 수 있습니다.");
    }
  }
  return { source, originalCount: values.filter((value) => value.trim()).length, goodsKeys, validCount: goodsKeys.length, duplicateCount, invalid, invalidCount: invalid.length };
}

export function parseShoplingPriceBulkPaste(input: string): ShoplingPriceBulkInputResult {
  return result("paste", input.split(/[\s,]+/));
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"' && field === "") quoted = true;
    else if (character === ",") { row.push(field); field = ""; }
    else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += character;
  }
  if (quoted) throw new Error("CSV 따옴표 형식이 올바르지 않습니다.");
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function parseShoplingPriceBulkCsvText(text: string): ShoplingPriceBulkInputResult {
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ""));
  if (rows.some((row) => row.length !== 1)) throw new Error("CSV Bulk 양식은 goods_key 1열만 사용할 수 있습니다.");
  if ((rows[0]?.[0] ?? "").trim().toLowerCase() !== "goods_key") throw new Error("CSV 첫 번째 행에 goods_key 헤더가 필요합니다.");
  return result("csv", rows.slice(1).map((row) => row[0]));
}

function decodeXml(value: string): string {
  return value.replace(/&(?:#(x[0-9a-f]+|\d+)|lt|gt|amp|quot|apos);/gi, (entity, numeric: string | undefined) => {
    if (numeric) return String.fromCodePoint(Number.parseInt(numeric.replace(/^x/i, ""), /^x/i.test(numeric) ? 16 : 10));
    return ({ "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&apos;": "'" } as Record<string, string>)[entity.toLowerCase()] ?? entity;
  });
}
function xmlAttribute(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\s${name}=["']([^"']*)["']`, "i"))?.[1];
}
function xmlText(body: string, tagName: string): string | undefined {
  const match = body.match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, "")) : undefined;
}
function normalizeZipPath(path: string): string {
  const output: string[] = [];
  for (const part of path.split("/")) {
    if (part === "..") output.pop();
    else if (part !== "." && part) output.push(part);
  }
  return output.join("/");
}

export function parseShoplingPriceBulkXlsxBytes(bytes: Uint8Array): ShoplingPriceBulkInputResult {
  let zip: Record<string, Uint8Array>;
  try { zip = unzipSync(bytes); } catch { throw new Error("XLSX 파일을 읽을 수 없습니다."); }
  const decoder = new TextDecoder("utf-8");
  const workbookBytes = zip["xl/workbook.xml"];
  const relsBytes = zip["xl/_rels/workbook.xml.rels"];
  if (!workbookBytes || !relsBytes) throw new Error("XLSX 첫 번째 시트를 읽을 수 없습니다.");
  const workbook = decoder.decode(workbookBytes);
  const firstSheetTag = workbook.match(/<sheet\b[^>]*\/>|<sheet\b[^>]*>/i)?.[0];
  const relationshipId = firstSheetTag && (xmlAttribute(firstSheetTag, "r:id") ?? xmlAttribute(firstSheetTag, "id"));
  if (!relationshipId) throw new Error("XLSX 첫 번째 시트를 읽을 수 없습니다.");
  const relationships = decoder.decode(relsBytes).match(/<Relationship\b[^>]*\/>/gi) ?? [];
  const relationship = relationships.find((tag) => xmlAttribute(tag, "Id") === relationshipId);
  const target = relationship && xmlAttribute(relationship, "Target");
  const sheetPath = target?.startsWith("/") ? target.slice(1) : target ? `xl/${target}` : undefined;
  const sheetBytes = sheetPath && zip[normalizeZipPath(sheetPath)];
  if (!sheetBytes) throw new Error("XLSX 첫 번째 시트를 읽을 수 없습니다.");

  const sharedStrings: string[] = [];
  if (zip["xl/sharedStrings.xml"]) {
    const sharedXml = decoder.decode(zip["xl/sharedStrings.xml"]);
    for (const item of sharedXml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/gi)) {
      sharedStrings.push([...item[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi)].map((match) => decodeXml(match[1])).join(""));
    }
  }
  const cells = decoder.decode(sheetBytes).matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi);
  const aValues = new Map<number, string>();
  for (const cell of cells) {
    const opening = `<c ${cell[1]}>`;
    const address = xmlAttribute(opening, "r");
    if (!address) continue;
    const addressMatch = address.match(/^([A-Z]+)(\d+)$/i);
    if (!addressMatch) continue;
    const body = cell[2] ?? "";
    const hasFormula = /<f(?:\s[^>]*)?(?:\/>|>)/i.test(body);
    const type = xmlAttribute(opening, "t");
    let value = "";
    if (type === "inlineStr") value = [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi)].map((match) => decodeXml(match[1])).join("");
    else {
      const raw = xmlText(body, "v") ?? "";
      value = type === "s" && /^\d+$/.test(raw) ? (sharedStrings[Number(raw)] ?? "") : raw;
    }
    if (hasFormula) throw new Error("XLSX 수식 셀은 사용할 수 없습니다.");
    if (addressMatch[1].toUpperCase() !== "A" && value.trim()) throw new Error("Bulk 업로드 양식은 A열 하나만 사용할 수 있습니다. B열 이후의 데이터를 제거해 주세요.");
    if (addressMatch[1].toUpperCase() === "A") aValues.set(Number(addressMatch[2]), value);
  }
  if ((aValues.get(1) ?? "").trim().toLowerCase() !== "goods_key") throw new Error("A1 셀에 goods_key 헤더가 필요합니다.");
  return result("xlsx", [...aValues.entries()].filter(([row]) => row >= 2).sort(([a], [b]) => a - b).map(([, value]) => value));
}

function decodeCsv(bytes: Uint8Array): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return new TextDecoder("euc-kr").decode(bytes); }
}
export async function parseShoplingPriceBulkFile(file: File): Promise<ShoplingPriceBulkInputResult> {
  if (file.size > SHOPLING_PRICE_BULK_MAX_FILE_SIZE) throw new Error("파일 크기는 5MB를 초과할 수 없습니다.");
  const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0];
  if (extension === ".xls") throw new Error("구형 .xls 파일은 지원하지 않습니다. .xlsx 또는 .csv로 저장해 주세요.");
  if (extension !== ".csv" && extension !== ".xlsx") throw new Error(".xlsx 또는 .csv 파일만 업로드할 수 있습니다.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  return extension === ".csv" ? parseShoplingPriceBulkCsvText(decodeCsv(bytes)) : parseShoplingPriceBulkXlsxBytes(bytes);
}

export function plannedShoplingPriceBulkChunkCount(goodsKeyCount: number): number {
  if (goodsKeyCount <= 0) return 0;
  return 1 + Math.ceil(Math.max(0, goodsKeyCount - 10) / 50);
}
