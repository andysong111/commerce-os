import { unzipSync } from "fflate";

export type ShoplingPriceAdjustmentSource = "paste" | "csv" | "xlsx";

export type ShoplingPriceAdjustmentRow = {
  goodsKey: string;
  adjustmentBps: number;
  adjustmentRate: string;
  direction: "increase" | "decrease" | "unchanged";
};

export type ShoplingPriceAdjustmentInputResult = {
  source: ShoplingPriceAdjustmentSource;
  originalCount: number;
  rows: ShoplingPriceAdjustmentRow[];
  goodsKeys: string[];
  validCount: number;
  duplicateCount: number;
  conflictCount: number;
  invalid: string[];
  invalidCount: number;
};

export const SHOPLING_PRICE_ADJUSTMENT_MAX_FILE_SIZE = 5 * 1024 * 1024;
export const SHOPLING_PRICE_ADJUSTMENT_MAX_ROWS = 20_000;
export const SHOPLING_PRICE_ADJUSTMENT_MIN_BPS = -9_999;
export const SHOPLING_PRICE_ADJUSTMENT_MAX_BPS = 100_000;

const GOODS_KEY_PATTERN = /^\d+$/;
const RATE_PATTERN = /^[+-]?\d+(?:\.\d{1,2})?%?$/;

type RawRow = { values: string[]; display: string };

function formatRateBps(bps: number) {
  const sign = bps > 0 ? "+" : bps < 0 ? "-" : "";
  const absolute = Math.abs(bps);
  const whole = Math.floor(absolute / 100);
  const decimals = absolute % 100;
  const decimalText = decimals === 0 ? "" : `.${String(decimals).padStart(2, "0").replace(/0$/, "")}`;
  return `${sign}${whole}${decimalText}%`;
}

export function parseShoplingPriceAdjustmentRateBps(input: string) {
  const normalized = input.trim();
  if (!RATE_PATTERN.test(normalized)) throw new Error("조정률은 -5, 7.25, +10%처럼 입력하세요.");
  const withoutPercent = normalized.endsWith("%") ? normalized.slice(0, -1) : normalized;
  const negative = withoutPercent.startsWith("-");
  const unsigned = withoutPercent.replace(/^[+-]/, "");
  const [wholeText, decimalText = ""] = unsigned.split(".");
  const whole = Number(wholeText);
  const decimals = Number(decimalText.padEnd(2, "0"));
  if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(decimals)) throw new Error("조정률이 너무 큽니다.");
  const bps = (whole * 100 + decimals) * (negative ? -1 : 1);
  if (bps < SHOPLING_PRICE_ADJUSTMENT_MIN_BPS || bps > SHOPLING_PRICE_ADJUSTMENT_MAX_BPS) {
    throw new Error("조정률은 -99.99% 이상 1,000% 이하만 사용할 수 있습니다.");
  }
  return bps;
}

function result(source: ShoplingPriceAdjustmentSource, rawRows: RawRow[]): ShoplingPriceAdjustmentInputResult {
  const invalid: string[] = [];
  const order: string[] = [];
  const rateByGoodsKey = new Map<string, number>();
  const conflicts = new Set<string>();
  let duplicateCount = 0;

  for (const rawRow of rawRows) {
    if (rawRow.values.length !== 2) {
      invalid.push(`${rawRow.display}: goods_key와 adjustment_rate 두 값이 필요합니다.`);
      continue;
    }
    const goodsKey = rawRow.values[0].trim();
    const rateText = rawRow.values[1].trim();
    if (!goodsKey || !rateText) {
      invalid.push(`${rawRow.display}: goods_key 또는 조정률이 비어 있습니다.`);
      continue;
    }
    if (!GOODS_KEY_PATTERN.test(goodsKey)) {
      invalid.push(`${rawRow.display}: goods_key는 숫자만 사용할 수 있습니다.`);
      continue;
    }

    let adjustmentBps: number;
    try {
      adjustmentBps = parseShoplingPriceAdjustmentRateBps(rateText);
    } catch (error) {
      invalid.push(`${rawRow.display}: ${error instanceof Error ? error.message : "조정률이 올바르지 않습니다."}`);
      continue;
    }

    if (conflicts.has(goodsKey)) continue;
    const existing = rateByGoodsKey.get(goodsKey);
    if (existing === undefined) {
      rateByGoodsKey.set(goodsKey, adjustmentBps);
      order.push(goodsKey);
      continue;
    }
    if (existing === adjustmentBps) {
      duplicateCount += 1;
      continue;
    }

    conflicts.add(goodsKey);
    rateByGoodsKey.delete(goodsKey);
    invalid.push(`${goodsKey}: 서로 다른 조정률 ${formatRateBps(existing)} / ${formatRateBps(adjustmentBps)}이 중복 입력되어 제외했습니다.`);
  }

  const rows = order
    .filter((goodsKey) => !conflicts.has(goodsKey))
    .map((goodsKey): ShoplingPriceAdjustmentRow => {
      const adjustmentBps = rateByGoodsKey.get(goodsKey)!;
      return {
        goodsKey,
        adjustmentBps,
        adjustmentRate: formatRateBps(adjustmentBps),
        direction: adjustmentBps > 0 ? "increase" : adjustmentBps < 0 ? "decrease" : "unchanged",
      };
    });

  if (rows.length > SHOPLING_PRICE_ADJUSTMENT_MAX_ROWS) {
    throw new Error("유효한 상품은 최대 20,000개까지 입력할 수 있습니다.");
  }

  return {
    source,
    originalCount: rawRows.length,
    rows,
    goodsKeys: rows.map((row) => row.goodsKey),
    validCount: rows.length,
    duplicateCount,
    conflictCount: conflicts.size,
    invalid,
    invalidCount: invalid.length,
  };
}

export function parseShoplingPriceAdjustmentPaste(input: string): ShoplingPriceAdjustmentInputResult {
  const rawRows: RawRow[] = [];
  const lines = input.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const values = trimmed.includes("\t") || trimmed.includes(",")
      ? trimmed.split(/[\t,]/).map((value) => value.trim())
      : trimmed.split(/\s+/);
    if (rawRows.length === 0 && values[0]?.toLowerCase() === "goods_key" && values[1]?.toLowerCase() === "adjustment_rate") continue;
    rawRows.push({ values, display: trimmed });
  }
  return result("paste", rawRows);
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

export function parseShoplingPriceAdjustmentCsvText(text: string): ShoplingPriceAdjustmentInputResult {
  const rows = parseCsvRows(text.replace(/^\uFEFF/, "")).filter((row) => row.some((value) => value.trim()));
  const headers = rows[0]?.map((value) => value.trim().toLowerCase()) ?? [];
  if (headers.length !== 2 || headers[0] !== "goods_key" || headers[1] !== "adjustment_rate") {
    throw new Error("CSV 첫 행은 goods_key,adjustment_rate 두 열이어야 합니다.");
  }
  if (rows.slice(1).some((row) => row.length !== 2)) throw new Error("CSV는 goods_key와 adjustment_rate 두 열만 사용할 수 있습니다.");
  return result("csv", rows.slice(1).map((values) => ({ values, display: values.join(",") })));
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

export function parseShoplingPriceAdjustmentXlsxBytes(bytes: Uint8Array): ShoplingPriceAdjustmentInputResult {
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

  const rowValues = new Map<number, { A?: string; B?: string }>();
  const cells = decoder.decode(sheetBytes).matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi);
  for (const cell of cells) {
    const opening = `<c ${cell[1]}>`;
    const address = xmlAttribute(opening, "r");
    if (!address) continue;
    const addressMatch = address.match(/^([A-Z]+)(\d+)$/i);
    if (!addressMatch) continue;
    const column = addressMatch[1].toUpperCase();
    const rowNumber = Number(addressMatch[2]);
    const body = cell[2] ?? "";
    if (/<f(?:\s[^>]*)?(?:\/>|>)/i.test(body)) throw new Error("XLSX 수식 셀은 사용할 수 없습니다.");
    const type = xmlAttribute(opening, "t");
    let value = "";
    if (type === "inlineStr") value = [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi)].map((match) => decodeXml(match[1])).join("");
    else {
      const raw = xmlText(body, "v") ?? "";
      value = type === "s" && /^\d+$/.test(raw) ? (sharedStrings[Number(raw)] ?? "") : raw;
    }
    if (!value.trim()) continue;
    if (!new Set(["A", "B"]).has(column)) throw new Error("XLSX는 A열 goods_key와 B열 adjustment_rate만 사용할 수 있습니다.");
    const current = rowValues.get(rowNumber) ?? {};
    current[column as "A" | "B"] = value;
    rowValues.set(rowNumber, current);
  }

  if ((rowValues.get(1)?.A ?? "").trim().toLowerCase() !== "goods_key" || (rowValues.get(1)?.B ?? "").trim().toLowerCase() !== "adjustment_rate") {
    throw new Error("XLSX A1은 goods_key, B1은 adjustment_rate 헤더여야 합니다.");
  }

  const rawRows = [...rowValues.entries()]
    .filter(([rowNumber]) => rowNumber >= 2)
    .sort(([left], [right]) => left - right)
    .map(([rowNumber, values]) => ({ values: [values.A ?? "", values.B ?? ""], display: `${rowNumber}행` }));
  return result("xlsx", rawRows);
}

function decodeCsv(bytes: Uint8Array): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return new TextDecoder("euc-kr").decode(bytes); }
}

export async function parseShoplingPriceAdjustmentFile(file: File): Promise<ShoplingPriceAdjustmentInputResult> {
  if (file.size > SHOPLING_PRICE_ADJUSTMENT_MAX_FILE_SIZE) throw new Error("파일 크기는 5MB를 초과할 수 없습니다.");
  const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0];
  if (extension === ".xls") throw new Error("구형 .xls 파일은 지원하지 않습니다. .xlsx 또는 .csv로 저장해 주세요.");
  if (extension !== ".csv" && extension !== ".xlsx") throw new Error(".xlsx 또는 .csv 파일만 업로드할 수 있습니다.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  return extension === ".csv" ? parseShoplingPriceAdjustmentCsvText(decodeCsv(bytes)) : parseShoplingPriceAdjustmentXlsxBytes(bytes);
}

export function plannedShoplingPriceAdjustmentChunkCount(goodsKeyCount: number): number {
  if (goodsKeyCount <= 0) return 0;
  return 1 + Math.ceil(Math.max(0, goodsKeyCount - 10) / 50);
}

function ceilDivide(numerator: bigint, denominator: bigint) {
  return (numerator + denominator - 1n) / denominator;
}

export function calculateShoplingAdjustedSellPrice(currentSellPrice: number, adjustmentBps: number) {
  if (!Number.isSafeInteger(currentSellPrice) || currentSellPrice <= 0) throw new Error("현재 판매가는 0보다 큰 정수여야 합니다.");
  if (!Number.isInteger(adjustmentBps) || adjustmentBps < SHOPLING_PRICE_ADJUSTMENT_MIN_BPS || adjustmentBps > SHOPLING_PRICE_ADJUSTMENT_MAX_BPS) {
    throw new Error("조정률 범위가 올바르지 않습니다.");
  }
  if (adjustmentBps === 0) return currentSellPrice;
  const factor = 10_000 + adjustmentBps;
  const adjustedWon = ceilDivide(BigInt(currentSellPrice) * BigInt(factor), 10_000n);
  const roundedToTen = ceilDivide(adjustedWon, 10n) * 10n;
  if (roundedToTen > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("계산된 판매가가 너무 큽니다.");
  return Number(roundedToTen);
}

export function calculateShoplingAdjustedPriceColumns(currentSellPrice: number, adjustmentBps: number) {
  const sellPrice = calculateShoplingAdjustedSellPrice(currentSellPrice, adjustmentBps);
  return {
    sellPrice,
    consumerPrice: Math.floor((sellPrice * 3) / 2),
    purchasePrice: Math.floor(sellPrice / 2),
  };
}

export function calculateShoplingAdjustedOptionAmount(currentOptionAmount: number, adjustmentBps: number) {
  if (!Number.isSafeInteger(currentOptionAmount) || currentOptionAmount < 0) throw new Error("옵션 추가금은 0 이상의 정수여야 합니다.");
  if (currentOptionAmount === 0) return 0;
  return calculateShoplingAdjustedSellPrice(currentOptionAmount, adjustmentBps);
}
