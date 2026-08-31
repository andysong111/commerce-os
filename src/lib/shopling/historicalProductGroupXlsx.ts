import { strFromU8, unzipSync } from "fflate";
import {
  normalizeInternalPriceGroup,
  type InternalPriceGroup,
} from "@/lib/internalChinaPriceGroupPolicy";

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, raw) => String.fromCodePoint(Number(raw)))
    .replace(/&#x([0-9a-f]+);/gi, (_, raw) => String.fromCodePoint(parseInt(raw, 16)));
}

function plainXmlText(xml: string) {
  const pieces = [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi)].map(
    (match) => decodeXml(match[1].replace(/<[^>]+>/g, "")),
  );
  return pieces.join("").trim();
}

function normalizeHeader(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s_\-./()[\]{}]+/g, "")
    .trim();
}

function headerScore(value: string) {
  const header = normalizeHeader(value);
  if (!header) return 0;
  if (header === "goodskey" || header === "굿즈키") return 100;
  if (
    header === "샵플링상품코드" ||
    header === "샵플링상품번호" ||
    header === "샵플링goodskey"
  ) {
    return 95;
  }
  if (
    header === "상품코드" ||
    header === "상품번호" ||
    header === "상품키" ||
    header === "상품key"
  ) {
    return 70;
  }
  return 0;
}

function isGoodsKey(value: string) {
  return /^\d{5,9}$/.test(value.trim());
}

function columnIndex(reference: string) {
  const letters = (reference.match(/^([A-Z]+)/i)?.[1] ?? "").toUpperCase();
  let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return Math.max(0, value - 1);
}

type ParsedCell = { col: number; value: string };
type ParsedRow = { row: number; cells: ParsedCell[] };

function parseSharedStrings(entries: Record<string, Uint8Array>) {
  const raw = entries["xl/sharedStrings.xml"];
  if (!raw) return [] as string[];
  const xml = strFromU8(raw);
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/gi)].map((match) =>
    plainXmlText(match[1]),
  );
}

function parseWorksheet(xml: string, shared: string[]) {
  const rows: ParsedRow[] = [];
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/gi)) {
    const rowNo = Number(rowMatch[1].match(/\br="(\d+)"/i)?.[1] ?? rows.length + 1);
    const cells: ParsedCell[] = [];
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const reference = attrs.match(/\br="([A-Z]+\d+)"/i)?.[1] ?? "";
      const type = attrs.match(/\bt="([^"]+)"/i)?.[1] ?? "";
      let value = "";
      if (type === "inlineStr") {
        value = plainXmlText(body);
      } else {
        const rawValue = decodeXml(body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/i)?.[1] ?? "").trim();
        value = type === "s" ? shared[Number(rawValue)] ?? "" : rawValue;
      }
      cells.push({ col: columnIndex(reference), value: value.trim() });
    }
    rows.push({ row: rowNo, cells });
  }
  return rows;
}

function rowMap(row: ParsedRow) {
  return new Map(row.cells.map((cell) => [cell.col, cell.value]));
}

function findGoodsKeyColumn(rows: ParsedRow[], sheetName: string) {
  const candidates: { col: number; headerRow: number; score: number; numericCount: number }[] = [];
  for (const row of rows.slice(0, 80)) {
    for (const cell of row.cells) {
      const score = headerScore(cell.value);
      if (!score) continue;
      const numericCount = rows
        .filter((candidate) => candidate.row > row.row)
        .slice(0, 5000)
        .map(rowMap)
        .map((mapped) => mapped.get(cell.col) ?? "")
        .filter(isGoodsKey).length;
      if (numericCount > 0) {
        candidates.push({ col: cell.col, headerRow: row.row, score, numericCount });
      }
    }
  }

  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      right.numericCount - left.numericCount ||
      left.headerRow - right.headerRow ||
      left.col - right.col,
  );
  if (candidates.length) {
    const best = candidates[0];
    const tied = candidates.filter(
      (row) => row.score === best.score && row.numericCount === best.numericCount,
    );
    if (tied.length > 1 && new Set(tied.map((row) => row.col)).size > 1) {
      throw new Error(`HISTORICAL_GROUP_XLSX_GOODS_KEY_COLUMN_AMBIGUOUS:${sheetName}`);
    }
    return { col: best.col, headerRow: best.headerRow };
  }

  const stats = new Map<number, { nonEmpty: number; numeric: number; firstRow: number }>();
  for (const row of rows.slice(0, 5000)) {
    for (const cell of row.cells) {
      if (!cell.value) continue;
      const stat = stats.get(cell.col) ?? { nonEmpty: 0, numeric: 0, firstRow: row.row };
      stat.nonEmpty += 1;
      if (isGoodsKey(cell.value)) stat.numeric += 1;
      stats.set(cell.col, stat);
    }
  }
  const inferred = [...stats.entries()]
    .map(([col, stat]) => ({
      col,
      headerRow: Math.max(0, stat.firstRow - 1),
      numericCount: stat.numeric,
      density: stat.nonEmpty ? stat.numeric / stat.nonEmpty : 0,
    }))
    .filter((row) => row.numericCount >= 5 && row.density >= 0.6)
    .sort((left, right) => right.numericCount - left.numericCount || right.density - left.density);
  if (!inferred.length) return null;
  if (
    inferred.length > 1 &&
    inferred[0].numericCount === inferred[1].numericCount &&
    Math.abs(inferred[0].density - inferred[1].density) < 0.01
  ) {
    throw new Error(`HISTORICAL_GROUP_XLSX_GOODS_KEY_COLUMN_AMBIGUOUS:${sheetName}`);
  }
  return { col: inferred[0].col, headerRow: inferred[0].headerRow };
}

export function inferInternalPriceGroupFromFilename(filename: unknown): InternalPriceGroup {
  const value = String(filename ?? "").normalize("NFKC");
  const matches = ["도매1", "도매2", "도매3", "도매4", "소매1", "소매2"]
    .map((group) => normalizeInternalPriceGroup(group))
    .filter((group): group is InternalPriceGroup => Boolean(group))
    .filter((group) => value.includes(group));
  if (matches.length !== 1) {
    throw new Error(`HISTORICAL_GROUP_FILENAME_REQUIRED:${value}`);
  }
  return matches[0];
}

export function extractHistoricalGoodsKeysFromXlsx(bytes: Uint8Array) {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error("HISTORICAL_GROUP_XLSX_INVALID_ZIP");
  }
  const shared = parseSharedStrings(entries);
  const sheetEntries = Object.entries(entries)
    .filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort(([left], [right]) => left.localeCompare(right));
  if (!sheetEntries.length) throw new Error("HISTORICAL_GROUP_XLSX_SHEET_MISSING");

  const goodsKeys = new Set<string>();
  const matchedSheets: string[] = [];
  for (const [sheetName, raw] of sheetEntries) {
    const rows = parseWorksheet(strFromU8(raw), shared);
    const target = findGoodsKeyColumn(rows, sheetName);
    if (!target) continue;
    matchedSheets.push(sheetName);
    for (const row of rows) {
      if (row.row <= target.headerRow) continue;
      const value = rowMap(row).get(target.col)?.trim() ?? "";
      if (isGoodsKey(value)) goodsKeys.add(value);
    }
  }
  if (!goodsKeys.size) throw new Error("HISTORICAL_GROUP_XLSX_GOODS_KEY_NOT_FOUND");
  return {
    goodsKeys: [...goodsKeys].sort((left, right) => Number(left) - Number(right)),
    matchedSheets,
  };
}
