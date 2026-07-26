import { parseShoplingPriceBulkInput } from "./shoplingPriceModifyBulk";

const HEADERS = new Set(["goodskey", "샵플링goodskey", "샵플링상품번호", "상품번호"]);
const normalize = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/[\s_-]/g, "");

export function valuesFromBulkRows(rows: unknown[][]) {
  if (!rows.length) return [];
  const width = Math.max(...rows.map((row) => row.length));
  const headerIndex = rows[0].findIndex((cell) => HEADERS.has(normalize(cell)));
  if (headerIndex >= 0) return rows.slice(1).map((row) => row[headerIndex]);
  if (width === 1) return rows.map((row) => row[0]);
  throw new Error("goods_key 헤더가 없는 여러 열 파일은 열을 임의로 추측할 수 없습니다.");
}

export function parseBulkCsv(text: string) {
  const rows = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean).map((line) => line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, "")));
  return parseShoplingPriceBulkInput(valuesFromBulkRows(rows).join("\n"));
}

export async function parseBulkFile(file: File) {
  if (file.size > 5 * 1024 * 1024) throw new Error("파일은 최대 5MB입니다.");
  const extension = file.name.toLowerCase().split(".").pop();
  if (extension === "xls") throw new Error(".xls는 지원하지 않습니다. .xlsx 또는 .csv를 사용하세요.");
  if (extension === "csv") return parseBulkCsv(await file.text());
  if (extension !== "xlsx") throw new Error(".xlsx 또는 .csv 파일만 사용할 수 있습니다.");
  // SheetJS is loaded only for XLSX uploads; the original bytes never leave the browser.
  const xlsx = await Function("return import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs')")() as {
    read: (input: ArrayBuffer, options: object) => { Sheets: Record<string, unknown>; SheetNames: string[] };
    utils: { sheet_to_json: (sheet: unknown, options: object) => unknown[][] };
  };
  const workbook = xlsx.read(await file.arrayBuffer(), { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return parseShoplingPriceBulkInput(valuesFromBulkRows(xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false })).join("\n"));
}
