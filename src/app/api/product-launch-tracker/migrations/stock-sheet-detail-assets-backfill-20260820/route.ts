import { NextRequest } from "next/server";
import {
  getProductLaunchAdminConfig,
  readProductLaunchState,
  resolveProductLaunchIdentity,
  writeProductLaunchState,
} from "@/lib/productLaunchTrackerServer";
import {
  applyProductLaunchTrackerMutation,
  type ProductLaunchTrackerState,
} from "@/lib/productLaunchTrackerOptimized";
import { syncProductLaunchNormalizedChangedItems } from "@/lib/productLaunchTrackerNormalizedStore";

const MIGRATION_KEY = "stockSheetDetailAssetsBackfill20260820";
const MIGRATION_SOURCE = "stock-sheet-detail-assets-backfill-20260820";
const CSV_URL =
  "https://docs.google.com/spreadsheets/d/13hSSgEX5SHjoshdg89GaBdOwy4xSQjvvZB7gI_IuZ4o/export?format=csv&gid=428248334";
const SHEET_NAME = "실재고 사전";
const STAGE_KEY = "detailPage";
const COMPLETED_STATUS = "완료";
const PENDING_STATUS = "미시작";

type UnknownRecord = Record<string, unknown>;

type SheetAsset = {
  modelNumber: string;
  rowNumber: number;
  sourceRows: number[];
  html: string;
  htmlColumns: string[];
  mainImageUrl: string;
  additionalImageUrls: string[];
  imageCount: number;
};

type SheetModelRecord = {
  modelNumber: string;
  rows: number[];
  asset: SheetAsset | null;
  hasAc: boolean;
  imageCount: number;
};

type PlannedUpdate = {
  itemId: string;
  modelNumber: string;
  productName: string;
  sheetAsset: SheetAsset;
};

export async function GET(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request, { requireSameOrigin: false });
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });

  const config = getProductLaunchAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  const apply = request.nextUrl.searchParams.get("apply") === "1";
  const force = request.nextUrl.searchParams.get("force") === "1";

  try {
    const row = (await readProductLaunchState(config.value, identity.value.userId)) as {
      state_payload?: unknown;
      updated_at?: unknown;
    } | null;
    if (!row || !isRecord(row.state_payload)) {
      return Response.json(
        {
          ok: false,
          code: "PRODUCT_LAUNCH_STATE_NOT_FOUND",
          message: "상품출시진행관리 상태를 찾지 못했습니다.",
        },
        { status: 404 },
      );
    }

    const state = row.state_payload as ProductLaunchTrackerState;
    const existingMigration = readMigration(state);
    if (existingMigration?.appliedAt && !force) {
      const report = isRecord(existingMigration.report) ? existingMigration.report : {};
      const changedIds = stringArray(report.changedIds);
      const normalizedSync =
        apply && changedIds.length
          ? await syncProductLaunchNormalizedChangedItems(
              config.value,
              identity.value,
              state,
              row.updated_at,
              changedIds,
            )
          : null;
      return Response.json({
        ok: true,
        alreadyApplied: true,
        appliedAt: existingMigration.appliedAt,
        report,
        normalizedSync,
      });
    }

    const sheetModels = await readSheetAssets();
    const plan = buildPlan(state, sheetModels);
    const report = {
      version: "2026-08-20-stock-sheet-detail-assets-backfill-v1",
      sourceFile: "실재고 상품 관리표",
      sourceSheet: SHEET_NAME,
      matchKey: "B=모델번호",
      htmlOrder: ["AL", "AN", "AC"],
      imageColumns: ["AB", "AD", "AF", "AH", "AJ"],
      pendingItemCountBefore: plan.pendingItemCount,
      sheetModelCount: sheetModels.size,
      qualifyingSheetModelCount: [...sheetModels.values()].filter((entry) => Boolean(entry.asset)).length,
      plannedItemCount: plan.updates.length,
      plannedUniqueModelCount: new Set(plan.updates.map((entry) => entry.modelNumber)).size,
      skippedItemCount: plan.skipped.length,
      changedIds: plan.updates.map((entry) => entry.itemId),
      plannedItems: plan.updates.map((entry) => ({
        itemId: entry.itemId,
        modelNumber: entry.modelNumber,
        productName: entry.productName,
        sheetRow: entry.sheetAsset.rowNumber,
        sourceRows: entry.sheetAsset.sourceRows,
        htmlColumns: entry.sheetAsset.htmlColumns,
        imageCount: entry.sheetAsset.imageCount,
      })),
      skippedItems: plan.skipped,
    };

    if (!apply) {
      return Response.json({ ok: true, dryRun: true, report });
    }

    if (!plan.updates.length) {
      return Response.json({
        ok: true,
        applied: false,
        noChanges: true,
        report,
      });
    }

    const now = new Date().toISOString();
    const updateById = new Map(plan.updates.map((entry) => [entry.itemId, entry]));
    const nextItems = (Array.isArray(state.items) ? state.items : []).map((value) => {
      if (!isRecord(value)) return value;
      const itemId = text(value.id);
      const update = updateById.get(itemId);
      if (!update) return value;

      const existingAsset = isRecord(value.detailPageAsset) ? value.detailPageAsset : {};
      return {
        ...value,
        detailPageAsset: {
          ...existingAsset,
          html: update.sheetAsset.html,
          status: "not_linked",
          resultId: "",
          syncedAt: null,
          mainImageUrl: update.sheetAsset.mainImageUrl,
          detailImageUrl: "",
          additionalImageUrls: update.sheetAsset.additionalImageUrls,
        },
        detailPageAssetSource: {
          import: MIGRATION_SOURCE,
          file: "실재고 상품 관리표",
          sheet: SHEET_NAME,
          modelNumber: update.modelNumber,
          row: update.sheetAsset.rowNumber,
          sourceRows: update.sheetAsset.sourceRows,
          htmlColumns: update.sheetAsset.htmlColumns,
          imageColumns: ["AB", "AD", "AF", "AH", "AJ"],
          updatedAt: now,
        },
        updatedAt: now,
        updatedBy: "승준",
      };
    });

    const patchedState = {
      ...state,
      items: nextItems,
      savedAt: now,
      schemaVersion: Math.max(3, Math.floor(Number(state.schemaVersion) || 3)),
    } as ProductLaunchTrackerState;
    const mutation = applyProductLaunchTrackerMutation(patchedState, {
      operation: "bulk_stage",
      itemIds: plan.updates.map((entry) => entry.itemId),
      stageKey: STAGE_KEY,
      status: COMPLETED_STATUS,
      reason: "",
      updatedBy: "승준",
    });
    const finalReport = {
      ...report,
      changedIds: mutation.changedIds,
      changedItemCount: mutation.changedIds.length,
    };
    const finalState = markApplied(mutation.state, finalReport);
    const persisted = (await writeProductLaunchState(
      config.value,
      identity.value,
      finalState as Record<string, unknown>,
    )) as { updated_at?: unknown };
    const normalizedSync = await syncProductLaunchNormalizedChangedItems(
      config.value,
      identity.value,
      finalState,
      persisted.updated_at,
      mutation.changedIds,
    );

    return Response.json({
      ok: true,
      applied: true,
      appliedAt: readMigration(finalState)?.appliedAt,
      changedIds: mutation.changedIds,
      report: finalReport,
      normalizedSync,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "STOCK_SHEET_DETAIL_ASSET_BACKFILL_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "실재고표 상세페이지 자료 일괄 입력에 실패했습니다.",
      },
      { status: 500 },
    );
  }
}

async function readSheetAssets() {
  const response = await fetch(CSV_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`실재고 상품 관리표 CSV를 불러오지 못했습니다. status=${response.status}`);
  }
  const csv = await response.text();
  if (/<!doctype html|<html/i.test(csv.slice(0, 500))) {
    throw new Error("실재고 상품 관리표 CSV 대신 HTML 응답을 받았습니다.");
  }

  const table = parseCsv(csv);
  const grouped = new Map<string, Array<{ rowNumber: number; row: string[] }>>();
  for (let index = 4; index < table.length; index += 1) {
    const row = table[index] ?? [];
    const modelNumber = normalizeModel(row[1]);
    if (!modelNumber) continue;
    const current = grouped.get(modelNumber) ?? [];
    current.push({ rowNumber: index + 1, row });
    grouped.set(modelNumber, current);
  }

  const result = new Map<string, SheetModelRecord>();
  for (const [modelNumber, rows] of grouped) {
    const candidates = rows.map(({ rowNumber, row }) => buildSheetCandidate(modelNumber, rowNumber, row));
    const best = [...candidates].sort(compareSheetCandidates)[0] ?? null;
    const asset = best && best.hasAc && best.images.length
      ? {
          modelNumber,
          rowNumber: best.rowNumber,
          sourceRows: rows.map((entry) => entry.rowNumber),
          html: best.html,
          htmlColumns: best.htmlColumns,
          mainImageUrl: best.images[0],
          additionalImageUrls: best.images.slice(1),
          imageCount: best.images.length,
        }
      : null;
    result.set(modelNumber, {
      modelNumber,
      rows: rows.map((entry) => entry.rowNumber),
      asset,
      hasAc: candidates.some((entry) => entry.hasAc),
      imageCount: Math.max(0, ...candidates.map((entry) => entry.images.length)),
    });
  }
  return result;
}

function buildSheetCandidate(modelNumber: string, rowNumber: number, row: string[]) {
  const al = cell(row[37]);
  const an = cell(row[39]);
  const ac = cell(row[28]);
  const htmlParts = [
    { column: "AL", value: al },
    { column: "AN", value: an },
    { column: "AC", value: ac },
  ].filter((entry) => Boolean(entry.value));
  const images = uniqueStrings([row[27], row[29], row[31], row[33], row[35]].map(imageUrl));
  return {
    modelNumber,
    rowNumber,
    hasAc: Boolean(ac),
    html: htmlParts.map((entry) => entry.value).join("\n"),
    htmlColumns: htmlParts.map((entry) => entry.column),
    images,
  };
}

function compareSheetCandidates(
  left: ReturnType<typeof buildSheetCandidate>,
  right: ReturnType<typeof buildSheetCandidate>,
) {
  const leftQualified = left.hasAc && left.images.length ? 1 : 0;
  const rightQualified = right.hasAc && right.images.length ? 1 : 0;
  if (leftQualified !== rightQualified) return rightQualified - leftQualified;
  if (left.htmlColumns.length !== right.htmlColumns.length) {
    return right.htmlColumns.length - left.htmlColumns.length;
  }
  if (left.images.length !== right.images.length) return right.images.length - left.images.length;
  return left.rowNumber - right.rowNumber;
}

function buildPlan(state: ProductLaunchTrackerState, sheetModels: Map<string, SheetModelRecord>) {
  const updates: PlannedUpdate[] = [];
  const skipped: Array<Record<string, unknown>> = [];
  let pendingItemCount = 0;

  for (const value of Array.isArray(state.items) ? state.items : []) {
    if (!isRecord(value)) continue;
    const status = stageStatus(value, STAGE_KEY);
    if (status !== PENDING_STATUS) continue;
    pendingItemCount += 1;

    const itemId = text(value.id);
    const modelNumber = normalizeModel(value.modelNumber);
    const productName = text(value.productName);
    if (!itemId || !modelNumber) {
      skipped.push({ itemId, modelNumber, productName, reason: "item_identity_missing" });
      continue;
    }
    const source = sheetModels.get(modelNumber);
    if (!source) {
      skipped.push({ itemId, modelNumber, productName, reason: "model_not_found_in_sheet" });
      continue;
    }
    if (!source.asset) {
      skipped.push({
        itemId,
        modelNumber,
        productName,
        reason: !source.hasAc ? "ac_html_missing" : "representative_image_missing",
        sourceRows: source.rows,
        hasAc: source.hasAc,
        imageCount: source.imageCount,
      });
      continue;
    }
    updates.push({ itemId, modelNumber, productName, sheetAsset: source.asset });
  }

  return { updates, skipped, pendingItemCount };
}

function stageStatus(item: UnknownRecord, stageKey: string) {
  const stages = isRecord(item.stages) ? item.stages : {};
  const stage = isRecord(stages[stageKey]) ? stages[stageKey] : {};
  return text(stage.status);
}

function readMigration(state: ProductLaunchTrackerState) {
  const migrations = isRecord(state.serverMigrations) ? state.serverMigrations : {};
  return isRecord(migrations[MIGRATION_KEY])
    ? (migrations[MIGRATION_KEY] as Record<string, unknown>)
    : null;
}

function markApplied(state: ProductLaunchTrackerState, report: Record<string, unknown>) {
  const migrations = isRecord(state.serverMigrations) ? { ...state.serverMigrations } : {};
  const now = new Date().toISOString();
  migrations[MIGRATION_KEY] = {
    appliedAt: now,
    source: MIGRATION_SOURCE,
    report,
  };
  return {
    ...state,
    serverMigrations: migrations,
    savedAt: now,
    schemaVersion: Math.max(3, Math.floor(Number(state.schemaVersion) || 3)),
  } as ProductLaunchTrackerState;
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
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function imageUrl(value: unknown) {
  const normalized = cell(value);
  return /^https?:\/\//i.test(normalized) ? normalized : "";
}

function normalizeModel(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function uniqueStrings(values: unknown[]) {
  return [...new Set(values.map(cell).filter(Boolean))];
}

function cell(value: unknown) {
  return String(value ?? "").trim();
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
