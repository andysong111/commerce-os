import { NextRequest } from "next/server";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  getProductLaunchAdminConfig,
  readProductLaunchError,
  readProductLaunchState,
  readResponseJson,
  resolveProductLaunchIdentity,
  writeProductLaunchState,
} from "@/lib/productLaunchTrackerServer";
import type { ProductLaunchTrackerState } from "@/lib/productLaunchTrackerOptimized";

export const runtime = "nodejs";

const TABLE_NAME = "product_launch_tracker_states";
const MIGRATION_KEY = "stockSheetChinaOptionRefresh20260813V2";
const MIGRATION_VERSION = "2026-08-13-stock-sheet-china-option-refresh-v2";
const CSV_URL =
  "https://docs.google.com/spreadsheets/d/13hSSgEX5SHjoshdg89GaBdOwy4xSQjvvZB7gI_IuZ4o/export?format=csv&gid=428248334";
const MAX_REPORT_DETAILS = 160;

const PLACEHOLDER_VALUES = new Set([
  "",
  "미정",
  "ㅁ",
  "상품조합",
  "미입력",
  "확인필요",
  "검토필요",
]);

type UnknownRecord = Record<string, unknown>;
type StoredRow = {
  state_payload?: unknown;
  updated_at?: unknown;
};
type SheetRow = {
  rowNumber: number;
  modelNumber: string;
  productName: string;
  saleOption: string;
  chinaOption: string;
};
type MatchResult =
  | { ok: true; value: string; sourceRows: number[]; strategy: string }
  | {
      ok: false;
      reason: "no_match" | "ambiguous";
      candidates: string[];
      sourceRows: number[];
    };
type OptionIssue = {
  itemId: string;
  modelNumber: string;
  productName: string;
  saleOption: string;
  candidates?: string[];
  sourceRows?: number[];
};
type MigrationReport = {
  version: string;
  sourceRowCount: number;
  usableSourceRowCount: number;
  sourceModelCount: number;
  stateItemCount: number;
  matchedModelItems: number;
  changedItems: number;
  changedOptions: number;
  preservedExistingOptions: number;
  noOrderOptionItems: number;
  ambiguousOptionCount: number;
  unmatchedOptionCount: number;
  sourceRowsUsed: number[];
  ambiguousOptions: OptionIssue[];
  unmatchedOptions: OptionIssue[];
};

export async function GET(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request, {
    requireSameOrigin: false,
  });
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });

  const config = getProductLaunchAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  try {
    const row = (await readProductLaunchState(
      config.value,
      identity.value.userId,
    )) as StoredRow | null;
    if (!row || !isRecord(row.state_payload)) {
      return Response.json(
        {
          ok: false,
          code: "PRODUCT_LAUNCH_STATE_NOT_FOUND",
          message: "상품출시진행관리 서버 저장본을 찾지 못했습니다.",
        },
        { status: 404 },
      );
    }

    const currentState = row.state_payload as ProductLaunchTrackerState;
    const marker = asRecord(asRecord(currentState.serverMigrations)[MIGRATION_KEY]);
    if (text(marker.status) === "applied") {
      return Response.json({
        ok: true,
        alreadyApplied: true,
        appliedAt: text(marker.appliedAt),
        report: marker.report ?? null,
      });
    }

    const source = await readStockSheetRows();
    const prepared = prepareMigration(currentState, source.rows);
    const apply = request.nextUrl.searchParams.get("apply") === "1";

    if (!apply) {
      return Response.json({ ok: true, dryRun: true, report: prepared.report });
    }

    if (!prepared.report.usableSourceRowCount || !prepared.report.matchedModelItems) {
      return Response.json(
        {
          ok: false,
          code: "PRODUCT_LAUNCH_CHINA_OPTION_SOURCE_EMPTY",
          message: "시트의 중국옵션명 또는 상품출시진행관리 매칭 결과가 비어 있어 적용을 중단했습니다.",
          report: prepared.report,
        },
        { status: 409 },
      );
    }

    const appliedAt = new Date().toISOString();
    const nextState: ProductLaunchTrackerState = {
      ...prepared.state,
      savedAt: appliedAt,
      serverMigrations: {
        ...asRecord(prepared.state.serverMigrations),
        [MIGRATION_KEY]: {
          status: "applied",
          version: MIGRATION_VERSION,
          appliedAt,
          source: "실재고 상품 관리표/실재고 사전 B,C,E,F",
          policy: "기존 chinaOption 보존, 빈 값만 모델번호·상품명·판매옵션 기준으로 채움",
          report: prepared.report,
        },
      },
    };

    const saved = await conditionalWriteState(
      config.value,
      identity.value,
      nextState,
      nullableText(row.updated_at),
    );
    if (!saved) {
      return Response.json(
        {
          ok: false,
          code: "PRODUCT_LAUNCH_CHINA_OPTION_CONCURRENT_UPDATE",
          message: "적용 중 다른 저장이 발생했습니다. 다시 실행하세요.",
        },
        { status: 409 },
      );
    }

    return Response.json({
      ok: true,
      applied: true,
      appliedAt,
      report: prepared.report,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_LAUNCH_CHINA_OPTION_REFRESH_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "실재고표 중국옵션명 반영을 완료하지 못했습니다.",
      },
      { status: 500 },
    );
  }
}

async function readStockSheetRows() {
  const response = await fetch(CSV_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`실재고 상품 관리표 CSV를 불러오지 못했습니다. status=${response.status}`);
  }
  const input = await response.text();
  if (/<!doctype html|<html/i.test(input.slice(0, 500))) {
    throw new Error("실재고 상품 관리표 CSV 대신 HTML 응답을 받았습니다.");
  }

  const table = parseCsv(input);
  const rows: SheetRow[] = [];
  for (let index = 4; index < table.length; index += 1) {
    const source = table[index] ?? [];
    const modelNumber = normalizeModel(source[1]);
    const chinaOption = text(source[5]);
    if (!modelNumber || !isUsableChinaOption(chinaOption)) continue;
    rows.push({
      rowNumber: index + 1,
      modelNumber,
      productName: text(source[2]),
      saleOption: text(source[4]),
      chinaOption,
    });
  }
  return { table, rows };
}

function prepareMigration(
  stateInput: ProductLaunchTrackerState,
  sheetRows: SheetRow[],
): { state: ProductLaunchTrackerState; report: MigrationReport } {
  const state = cloneJson(stateInput);
  const items = Array.isArray(state.items) ? state.items.filter(isRecord) : [];
  const rowsByModel = new Map<string, SheetRow[]>();
  for (const row of sheetRows) {
    const current = rowsByModel.get(row.modelNumber) ?? [];
    current.push(row);
    rowsByModel.set(row.modelNumber, current);
  }

  const sourceRowsUsed = new Set<number>();
  const report: MigrationReport = {
    version: MIGRATION_VERSION,
    sourceRowCount: sheetRows.length,
    usableSourceRowCount: sheetRows.length,
    sourceModelCount: rowsByModel.size,
    stateItemCount: items.length,
    matchedModelItems: 0,
    changedItems: 0,
    changedOptions: 0,
    preservedExistingOptions: 0,
    noOrderOptionItems: 0,
    ambiguousOptionCount: 0,
    unmatchedOptionCount: 0,
    sourceRowsUsed: [],
    ambiguousOptions: [],
    unmatchedOptions: [],
  };

  state.items = items.map((item) => {
    const modelNumber = normalizeModel(item.modelNumber);
    const candidates = rowsByModel.get(modelNumber) ?? [];
    if (!candidates.length) return item;
    report.matchedModelItems += 1;

    const currentOptions = Array.isArray(item.orderOptions)
      ? item.orderOptions.map((option) => (isRecord(option) ? { ...option } : {}))
      : [];
    if (!currentOptions.length) {
      report.noOrderOptionItems += 1;
      return item;
    }

    let itemChanged = false;
    const nextOptions = currentOptions.map((option) => {
      if (text(option.chinaOption)) {
        report.preservedExistingOptions += 1;
        return option;
      }

      const saleOption = text(option.saleOption ?? option.value);
      const match = findChinaOptionMatch(
        text(item.productName),
        saleOption,
        currentOptions.length,
        candidates,
      );
      if (match.ok === false) {
        const issue: OptionIssue = {
          itemId: text(item.id),
          modelNumber,
          productName: text(item.productName),
          saleOption,
          candidates: match.candidates,
          sourceRows: match.sourceRows,
        };
        if (match.reason === "ambiguous") {
          report.ambiguousOptionCount += 1;
          if (report.ambiguousOptions.length < MAX_REPORT_DETAILS) {
            report.ambiguousOptions.push(issue);
          }
        } else {
          report.unmatchedOptionCount += 1;
          if (report.unmatchedOptions.length < MAX_REPORT_DETAILS) {
            report.unmatchedOptions.push(issue);
          }
        }
        return option;
      }

      itemChanged = true;
      report.changedOptions += 1;
      for (const rowNumber of match.sourceRows) sourceRowsUsed.add(rowNumber);
      return { ...option, chinaOption: match.value };
    });

    if (!itemChanged) return item;
    report.changedItems += 1;
    const now = new Date().toISOString();
    return {
      ...item,
      orderOptions: nextOptions,
      updatedAt: now,
      updatedBy: "승준",
    };
  });

  report.sourceRowsUsed = [...sourceRowsUsed].sort((left, right) => left - right);
  return { state, report };
}

function findChinaOptionMatch(
  itemProductName: string,
  saleOption: string,
  currentOptionCount: number,
  candidates: SheetRow[],
): MatchResult {
  const itemProduct = normalizeProduct(itemProductName);
  const normalizedSaleOption = normalizeOption(saleOption);
  const exactSaleRows = normalizedSaleOption
    ? candidates.filter(
        (row) => normalizeOption(row.saleOption) === normalizedSaleOption,
      )
    : [];

  const rankedExactSale = selectByProductRank(exactSaleRows, itemProduct);
  if (rankedExactSale) return rankedExactSale;

  const exactSaleFallback = selectUnique(exactSaleRows, "same-model-sale-option");
  if (exactSaleFallback) return exactSaleFallback;

  if (currentOptionCount === 1) {
    const rankedSingle = selectByProductRank(candidates, itemProduct);
    if (rankedSingle) return rankedSingle;
    const modelSingle = selectUnique(candidates, "single-option-model-fallback");
    if (modelSingle) return modelSingle;
  }

  return {
    ok: false,
    reason: exactSaleRows.length ? "ambiguous" : "no_match",
    candidates: uniqueStrings(exactSaleRows.map((row) => row.chinaOption)),
    sourceRows: exactSaleRows.map((row) => row.rowNumber),
  };
}

function selectByProductRank(rows: SheetRow[], itemProduct: string): MatchResult | null {
  if (!rows.length || !itemProduct) return null;
  for (const rank of [3, 2, 1]) {
    const ranked = rows.filter((row) => productRank(row.productName, itemProduct) === rank);
    if (!ranked.length) continue;
    return selectUnique(ranked, `product-rank-${rank}`) ?? {
      ok: false,
      reason: "ambiguous",
      candidates: uniqueStrings(ranked.map((row) => row.chinaOption)),
      sourceRows: ranked.map((row) => row.rowNumber),
    };
  }
  return null;
}

function selectUnique(rows: SheetRow[], strategy: string): MatchResult | null {
  if (!rows.length) return null;
  const values = uniqueStrings(rows.map((row) => row.chinaOption));
  if (values.length !== 1) {
    return values.length
      ? {
          ok: false,
          reason: "ambiguous",
          candidates: values,
          sourceRows: rows.map((row) => row.rowNumber),
        }
      : null;
  }
  return {
    ok: true,
    value: values[0],
    sourceRows: rows
      .filter((row) => row.chinaOption === values[0])
      .map((row) => row.rowNumber),
    strategy,
  };
}

function productRank(rowProductName: string, normalizedItemProduct: string) {
  const rowProduct = normalizeProduct(rowProductName);
  if (!rowProduct || !normalizedItemProduct) return 0;
  if (rowProduct === normalizedItemProduct) return 3;
  if (rowProduct.startsWith(normalizedItemProduct)) return 2;
  if (normalizedItemProduct.startsWith(rowProduct)) return 1;
  return 0;
}

function isUsableChinaOption(value: unknown) {
  const option = text(value);
  if (!option) return false;
  const compact = normalizeOption(option);
  if (PLACEHOLDER_VALUES.has(compact)) return false;
  const hasHangul = /[가-힣]/.test(option);
  const hasHan = /[\u3400-\u9fff]/.test(option);
  return !hasHangul || hasHan;
}

function uniqueStrings(values: unknown[]) {
  return [...new Set(values.map(text).filter(Boolean))];
}

async function conditionalWriteState(
  config: { supabaseUrl: string; secretKey: string },
  identity: { userId: string; email: string },
  state: ProductLaunchTrackerState,
  previousUpdatedAt: string | null,
) {
  if (!previousUpdatedAt) {
    return (await writeProductLaunchState(
      config,
      identity,
      state as Record<string, unknown>,
    )) as StoredRow;
  }

  const now = new Date().toISOString();
  const schemaVersion = Math.max(3, Math.floor(Number(state.schemaVersion) || 3));
  const params = new URLSearchParams({
    owner_id: `eq.${identity.userId}`,
    updated_at: `eq.${previousUpdatedAt}`,
  });
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/${TABLE_NAME}?${params.toString()}`,
    {
      method: "PATCH",
      headers: {
        ...createSupabaseAdminHeaders(config.secretKey),
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        owner_email: identity.email,
        schema_version: schemaVersion,
        state_payload: state,
        updated_at: now,
      }),
      cache: "no-store",
    },
  );
  const body = await readResponseJson(response);
  if (!response.ok) {
    throw new Error(readProductLaunchError(body, response.status));
  }
  return Array.isArray(body) ? (body[0] as StoredRow | undefined) ?? null : null;
}

function parseCsv(input: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function normalizeModel(value: unknown) {
  return text(value).normalize("NFKC").toUpperCase().replace(/\s+/g, "");
}

function normalizeProduct(value: unknown) {
  return text(value).normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

function normalizeOption(value: unknown) {
  return text(value).normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function nullableText(value: unknown) {
  const result = text(value);
  return result || null;
}
