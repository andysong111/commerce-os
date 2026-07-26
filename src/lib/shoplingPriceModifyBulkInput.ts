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

function resultFor(source: ShoplingPriceBulkInputResult["source"], values: string[]): ShoplingPriceBulkInputResult {
  const goodsKeys: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  let duplicateCount = 0;
  for (const raw of values) {
    const value = raw.trim();
    if (!/^\d+$/.test(value)) {
      invalid.push(value);
    } else if (seen.has(value)) {
      duplicateCount += 1;
    } else {
      seen.add(value);
      goodsKeys.push(value);
      if (goodsKeys.length > SHOPLING_PRICE_BULK_MAX_GOODS_KEYS) {
        throw new Error("유효한 goods_key는 최대 20,000개까지 입력할 수 있습니다.");
      }
    }
  }
  return { source, originalCount: values.length, goodsKeys, validCount: goodsKeys.length, duplicateCount, invalid, invalidCount: invalid.length };
}

export function parseShoplingPriceBulkPaste(input: string): ShoplingPriceBulkInputResult {
  const values = input.trim() ? input.split(/[,\s]+/u).filter(Boolean) : [];
  return resultFor("paste", values);
}

function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"' && field.length === 0) quoted = true;
    else if (character === ",") { row.push(field); field = ""; }
    else if (character === "\n" || character === "\r") {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += character;
  }
  if (quoted) throw new Error("CSV 따옴표 형식이 올바르지 않습니다.");
  if (field || row.length || (input.length > 0 && !/[\r\n]$/.test(input))) { row.push(field); rows.push(row); }
  return rows;
}

export function parseShoplingPriceBulkCsvText(input: string): ShoplingPriceBulkInputResult {
  const rows = parseCsvRows(input.replace(/^\uFEFF/, ""));
  if (rows.some((row) => row.length > 1)) throw new Error("CSV Bulk 양식은 goods_key 1열만 사용할 수 있습니다.");
  if ((rows[0]?.[0] ?? "").trim().toLowerCase() !== "goods_key") throw new Error("CSV 첫 번째 행에 goods_key 헤더가 필요합니다.");
  return resultFor("csv", rows.slice(1).map((row) => row[0] ?? "").filter((value) => value.trim() !== ""));
}

function assertFileSize(file: Pick<File, "size">) {
  if (file.size > SHOPLING_PRICE_BULK_MAX_FILE_SIZE) throw new Error("Bulk 입력 파일은 5MB 이하여야 합니다.");
}

export async function parseShoplingPriceBulkCsvFile(file: File): Promise<ShoplingPriceBulkInputResult> {
  assertFileSize(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (text.includes("\uFFFD")) {
    try { text = new TextDecoder("euc-kr", { fatal: false }).decode(bytes); } catch { /* Keep best-effort UTF-8 text. */ }
  }
  return parseShoplingPriceBulkCsvText(text);
}

function xmlText(value: string): string {
  return value.replace(/<[^>]*>/g, "").replace(/&#(x[\da-f]+|\d+);/gi, (_, code: string) => String.fromCodePoint(code[0].toLowerCase() === "x" ? Number.parseInt(code.slice(1), 16) : Number(code))).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function attribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`(?:^|\\s)${name.replace(":", "(?::)")}=["']([^"']*)["']`, "i"));
  return match?.[1];
}

function zipText(files: Record<string, Uint8Array>, path: string): string | undefined {
  const bytes = files[path.replace(/^\//, "")];
  return bytes ? new TextDecoder().decode(bytes) : undefined;
}

function sharedStrings(xml?: string): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)].map((match) => [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((part) => xmlText(part[1])).join(""));
}

function firstWorksheetPath(files: Record<string, Uint8Array>): string {
  const workbook = zipText(files, "xl/workbook.xml");
  const relationships = zipText(files, "xl/_rels/workbook.xml.rels");
  if (!workbook || !relationships) throw new Error("XLSX 첫 번째 시트를 읽을 수 없습니다.");
  const sheetTag = workbook.match(/<sheet\b[^>]*\/?\s*>/i)?.[0];
  const relationshipId = sheetTag && (attribute(sheetTag, "r:id") ?? attribute(sheetTag, "id"));
  if (!relationshipId) throw new Error("XLSX 첫 번째 시트를 읽을 수 없습니다.");
  const relationshipTag = [...relationships.matchAll(/<Relationship\b[^>]*\/?\s*>/gi)].map((match) => match[0]).find((tag) => attribute(tag, "Id") === relationshipId);
  const target = relationshipTag && attribute(relationshipTag, "Target");
  if (!target) throw new Error("XLSX 첫 번째 시트를 읽을 수 없습니다.");
  const parts = (target.startsWith("/") ? target.slice(1) : `xl/${target}`).split("/");
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === "..") normalized.pop();
    else if (part !== ".") normalized.push(part);
  }
  return normalized.join("/");
}

export function parseShoplingPriceBulkXlsxBytes(bytes: Uint8Array): ShoplingPriceBulkInputResult {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes); } catch { throw new Error("XLSX 파일을 읽을 수 없습니다."); }
  const worksheet = zipText(files, firstWorksheetPath(files));
  if (!worksheet) throw new Error("XLSX 첫 번째 시트를 읽을 수 없습니다.");
  const strings = sharedStrings(zipText(files, "xl/sharedStrings.xml"));
  const valuesByRow = new Map<number, string>();
  for (const match of worksheet.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/gi)) {
    const tag = `<c ${match[1] ?? match[3] ?? ""}>`;
    const body = match[2] ?? "";
    const address = attribute(tag, "r")?.toUpperCase();
    if (!address) continue;
    const addressMatch = address.match(/^([A-Z]+)(\d+)$/);
    if (!addressMatch) continue;
    const [, column, rowText] = addressMatch;
    const hasFormula = /<f\b/i.test(body);
    const type = attribute(tag, "t")?.toLowerCase();
    const rawValue = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1];
    const inlineValue = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((part) => xmlText(part[1])).join("");
    const value = type === "s" ? (strings[Number(xmlText(rawValue ?? ""))] ?? "") : type === "inlinestr" ? inlineValue : xmlText(rawValue ?? inlineValue);
    if (hasFormula) throw new Error("XLSX 수식 셀은 사용할 수 없습니다.");
    if (column !== "A" && value.trim() !== "") throw new Error("Bulk 업로드 양식은 A열 하나만 사용할 수 있습니다. B열 이후의 데이터를 제거해 주세요.");
    if (column === "A" && value.trim() !== "") valuesByRow.set(Number(rowText), value.trim());
  }
  if ((valuesByRow.get(1) ?? "").toLowerCase() !== "goods_key") throw new Error("A1 셀에 goods_key 헤더가 필요합니다.");
  return resultFor("xlsx", [...valuesByRow].filter(([row]) => row >= 2).sort(([a], [b]) => a - b).map(([, value]) => value));
}

export async function parseShoplingPriceBulkXlsxFile(file: File): Promise<ShoplingPriceBulkInputResult> {
  assertFileSize(file);
  return parseShoplingPriceBulkXlsxBytes(new Uint8Array(await file.arrayBuffer()));
}

export async function parseShoplingPriceBulkFile(file: File): Promise<ShoplingPriceBulkInputResult> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xls")) throw new Error("구형 .xls 파일은 지원하지 않습니다. .xlsx 또는 .csv로 저장해 주세요.");
  if (name.endsWith(".csv")) return parseShoplingPriceBulkCsvFile(file);
  if (name.endsWith(".xlsx")) return parseShoplingPriceBulkXlsxFile(file);
  throw new Error(".xlsx 또는 .csv 파일만 사용할 수 있습니다.");
}

export function plannedShoplingPriceBulkChunkCount(goodsKeyCount: number): number {
  if (goodsKeyCount <= 0) return 0;
  return 1 + Math.ceil(Math.max(0, goodsKeyCount - 10) / 50);
}
