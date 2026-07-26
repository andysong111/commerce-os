import { unzipSync, strFromU8 } from "fflate";

export const BULK_MAX_GOODS_KEYS = 20_000;
export const BULK_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const XLS_REJECTION_MESSAGE = "구형 .xls 파일은 .xlsx 또는 .csv로 저장해 주세요.";
const DIGITS = /^\d+$/;
const HEADERS = new Set(["goodskey", "샵플링goodskey", "샵플링상품번호", "상품번호"]);

export type BulkInputResult = { source: "paste" | "csv" | "xlsx"; goodsKeys: string[]; invalid: string[]; totalInputCount: number; validGoodsKeyCount: number; duplicateCount: number };

function headerKey(value: unknown) { return String(value ?? "").trim().toLowerCase().replace(/[\s_-]/g, ""); }
function normalize(values: unknown[], source: BulkInputResult["source"]): BulkInputResult {
  const seen = new Set<string>(); const goodsKeys: string[] = []; const invalid: string[] = []; let duplicateCount = 0; let totalInputCount = 0;
  for (const raw of values) {
    const value = String(raw ?? "").trim(); if (!value) continue; totalInputCount++;
    if (!DIGITS.test(value)) { invalid.push(value); continue; }
    if (seen.has(value)) { duplicateCount++; continue; }
    seen.add(value); goodsKeys.push(value);
  }
  if (goodsKeys.length > BULK_MAX_GOODS_KEYS) throw new Error(`유효 goods_key는 최대 ${BULK_MAX_GOODS_KEYS.toLocaleString()}개까지 입력할 수 있습니다.`);
  return { source, goodsKeys, invalid, totalInputCount, validGoodsKeyCount: goodsKeys.length, duplicateCount };
}

export function parseBulkPaste(input: string) { return normalize(input.split(/[\s,]+/), "paste"); }

export function normalizeBulkRows(rows: unknown[][], source: "csv" | "xlsx") {
  const nonEmpty = rows.filter((row) => row.some((cell) => String(cell ?? "").trim()));
  if (!nonEmpty.length) return normalize([], source);
  const width = Math.max(...nonEmpty.map((row) => row.length));
  const headerIndex = nonEmpty[0].findIndex((cell) => HEADERS.has(headerKey(cell)));
  if (headerIndex >= 0) return normalize(nonEmpty.slice(1).map((row) => row[headerIndex]), source);
  if (width === 1) return normalize(nonEmpty.map((row) => row[0]), source);
  throw new Error("여러 열에서 goods_key 열을 찾을 수 없습니다. 인식 가능한 goods_key 헤더를 추가해 주세요.");
}

function parseCsvText(text: string) {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let i = 0; i < text.length; i++) { const char = text[i]; if (char === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; } else if (char === "," && !quoted) { row.push(cell); cell = ""; } else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; } else cell += char; }
  row.push(cell); rows.push(row); return rows;
}

export function decodeCsv(bytes: Uint8Array) {
  let text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (text.includes("�")) { try { text = new TextDecoder("euc-kr", { fatal: true }).decode(bytes); } catch { /* retain UTF-8 diagnostic output */ } }
  return text.replace(/^\uFEFF/, "");
}
export function parseBulkCsv(bytes: Uint8Array) { return normalizeBulkRows(parseCsvText(decodeCsv(bytes)), "csv"); }

function xmlText(xml: string, tag: string) { const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i")); return match?.[1]?.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"); }
export function parseBulkXlsx(bytes: Uint8Array) {
  const files = unzipSync(bytes); const workbook = files["xl/workbook.xml"]; const rels = files["xl/_rels/workbook.xml.rels"];
  if (!workbook || !rels) throw new Error("올바른 .xlsx 파일이 아닙니다.");
  const workbookXml = strFromU8(workbook); const firstRel = workbookXml.match(/<sheet\b[^>]*r:id="([^"]+)"/i)?.[1];
  const target = firstRel && strFromU8(rels).match(new RegExp(`<Relationship\\b[^>]*Id="${firstRel}"[^>]*Target="([^"]+)"`, "i"))?.[1];
  const sheet = target && (files[`xl/${target.replace(/^\/?xl\//, "")}`] || files[`xl/worksheets/${target.split("/").pop()}`]);
  if (!sheet) throw new Error("첫 번째 시트를 읽을 수 없습니다.");
  const sharedXml = files["xl/sharedStrings.xml"] ? strFromU8(files["xl/sharedStrings.xml"]) : "";
  const shared = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)].map((match) => [...match[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi)].map((part) => part[1]).join(""));
  const rows = [...strFromU8(sheet).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)].map((rowMatch) => [...rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)].map((cell) => { const type = cell[1].match(/\bt="([^"]+)"/)?.[1]; const value = xmlText(cell[2], type === "inlineStr" ? "t" : "v") ?? ""; return type === "s" ? shared[Number(value)] ?? "" : value; }));
  return normalizeBulkRows(rows, "xlsx");
}

export async function parseBulkFile(file: File) {
  if (file.size > BULK_MAX_FILE_BYTES) throw new Error("업로드 파일은 최대 5MB까지 지원합니다.");
  const extension = file.name.toLowerCase().split(".").pop(); if (extension === "xls") throw new Error(XLS_REJECTION_MESSAGE);
  const bytes = new Uint8Array(await file.arrayBuffer()); if (extension === "csv") return parseBulkCsv(bytes); if (extension === "xlsx") return parseBulkXlsx(bytes);
  throw new Error(".xlsx 또는 .csv 파일만 업로드할 수 있습니다.");
}
