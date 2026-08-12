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

const MIGRATION_KEY = "stockSheetBackfillUntil1165_20260812";
const WORK_BATCH = "등록완료건";
const CUTOFF_ROW = 1165;
const CSV_URL = "https://docs.google.com/spreadsheets/d/13hSSgEX5SHjoshdg89GaBdOwy4xSQjvvZB7gI_IuZ4o/export?format=csv&gid=428248334";
const ALLOWED_MODELS = new Set(
  "AAA001 AAA002 AAA003 AAA006 AAA007 AAA010 AAA011 AAA014 AAA015 AAA019 AAA021 AAA022 AAA023 AAA026 AAA027 AAA028 AAA030 AAA031 AAA032 AAA033 AAA035 AAA036 AAA038 AAA039 AAA041 AAA042 AAA043 AAA044 AAA045 AAA048 AAA049 AAA052 AAA056 AAA057 AAA058 AAA059 AAA061 AAA062 AAA065 AAA068 AAA069 AAA071 AAA074 AAA074-1 AAA075 AAA077 AAA078 AAA079 AAA081 AAA083 AAA086 AAA090 AAA092 AAA093 AAA094 AAA095 AAA096 AAA097 AAA098 AAA100 AAA101 AAA102 AAA106 AAA107 AAA109 AAA113 AAA115 AAA116 AAA125 AAA126 AAA127 AAA128 AAA129 AAA130 AAA131 AAA133 AAA134 AAA138 AAA139 AAA140 AAA141 AAA142 AAA143 AAA145 AAA146 AAA149 AAA150 AAA151 AAA152 AAA153 AAA154 AAA155 AAA159 AAA160 AAA162 AAA163 AAA164 AAA165 AAA166 AAA167 AAA168 AAA169 AAA170 AAA171 AAA171-1 AAA172 AAA182 AAA183 AAA186 AAA187 AAA188 AAA189 AAA190 AAA192 AAA193 AAA194 AAA200 AAA201 AAA203 AAA204 AAA205 AAA206 AAA207 AAA208 AAA209 AAA210 AAA211 AAA212 AAA213 AAA214 AAA215 AAA216 AAA219 AAA220 AAA222 AAA225 AAA228 AAA231 AAA236 AAA237 AAA238 AAA239 AAA240 AAA241 AAA242 AAA243 AAA246 AAA248 AAA249 AAA251 AAA252 AAA253 AAA254 AAA256 AAA257 AAA258 AAA260 AAA261 AAA262 AAA266 AAA267 AAA270 AAA271 AAA275 AAA278 AAA280 AAA281 AAA282 AAA284 AAA286 AAA287 AAA288 AAA289 AAA295 AAA296 AAA297 AAA298 AAA299 AAA300 AAA301 AAA302 AAA303 AAA304 AAA307 AAA309 AAA310 AAA311 AAA312 AAA313 AAA314 AAA315 AAA316 AAA318 AAA319 AAA320 AAA321 AAA323 AAA324 AAA325 AAA326 AAA327 AAA328 AAA329 AAA330 AAA331 AAA332 AAA333 AAA335 AAA336 AAA337 AAA338 AAA339 AAA340 AAA341 AAA342 AAA343 AAA344 AAA345 AAA348 AAA349 AAA351 AAA352 AAA353 AAA354 AAA355 AAA357 AAA358 AAA359 AAA362 AAA364 AAA365 AAA367 AAA368 AAA369 AAA370 AAA371 AAA372 AAA373 AAA375 AAA376 AAA377 AAA378 AAA379 AAA380 AAA381 AAA382 AAA383 AAA385 AAA386 AAA387 AAA388 AAA389 AAA390 AAA391 AAA392 AAA393 AAA394 AAA395 AAA396 AAA398 AAA399 AAA403 AAA404 AAA405 AAA406 AAA407 AAA408 AAA409 AAA415 AAA416 AAA417 AAA418 AAA419 AAA420 AAA421 AAA422 AAA423 AAA424 AAA425 AAA426 AAA427 AAA428 AAA429 AAA430 AAA431 AAA432 AAA433 AAA434 AAA435 AAA436 AAA437 AAA438 AAA439 AAA442 AAA445"
    .split(/\s+/)
    .filter(Boolean),
);

type Row = {
  rowNumber: number;
  modelNumber: string;
  productName: string;
  saleOption: string;
  chinaOption: string;
  links: string[];
};

type Target = {
  modelNumber: string;
  productName: string;
  optionLabels: string[];
  orderOptions: Array<Record<string, unknown>>;
  links: string[];
  sourceRows: number[];
};

export async function GET(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request, { requireSameOrigin: false });
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });

  const config = getProductLaunchAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  const apply = request.nextUrl.searchParams.get("apply") === "1";

  try {
    const row = (await readProductLaunchState(config.value, identity.value.userId)) as {
      state_payload?: unknown;
    } | null;
    if (!row || !isRecord(row.state_payload)) {
      return Response.json(
        { ok: false, code: "PRODUCT_LAUNCH_STATE_NOT_FOUND", message: "상품출시진행관리 상태를 찾지 못했습니다." },
        { status: 404 },
      );
    }

    const state = row.state_payload as ProductLaunchTrackerState;
    const existingMigration = readMigration(state);
    if (existingMigration?.appliedAt) {
      return Response.json({
        ok: true,
        alreadyApplied: true,
        appliedAt: existingMigration.appliedAt,
        report: existingMigration.report ?? null,
      });
    }

    const targets = await readTargetsFromStockSheet();
    const plan = buildPlan(state, targets);
    const report = {
      version: "2026-08-12-stock-sheet-backfill-v1",
      cutoffRow: CUTOFF_ROW,
      allowedModelCount: ALLOWED_MODELS.size,
      sourceTargetCount: targets.length,
      stateItemCount: Array.isArray(state.items) ? state.items.length : 0,
      plannedCreateItems: plan.items.length,
      skippedExistingModelItems: plan.skippedExisting.length,
      skippedDuplicateSourceItems: plan.skippedDuplicateSource.length,
      noLinkTargets: targets.filter((target) => !target.links.length).length,
      optionlessTargets: targets.filter((target) => !target.optionLabels.length).length,
      skippedExisting: plan.skippedExisting.slice(0, 80),
      skippedDuplicateSource: plan.skippedDuplicateSource.slice(0, 80),
    };

    if (!apply) return Response.json({ ok: true, dryRun: true, report });

    if (!plan.items.length) {
      const nextState = markApplied(state, report);
      await writeProductLaunchState(config.value, identity.value, nextState as Record<string, unknown>);
      return Response.json({ ok: true, applied: true, appliedAt: readMigration(nextState)?.appliedAt, report });
    }

    const mutation = applyProductLaunchTrackerMutation(state, {
      operation: "create_items",
      items: plan.items,
      updatedBy: "승준",
    });
    const nextState = markApplied(mutation.state, report);
    await writeProductLaunchState(config.value, identity.value, nextState as Record<string, unknown>);

    return Response.json({
      ok: true,
      applied: true,
      appliedAt: readMigration(nextState)?.appliedAt,
      createdIds: mutation.createdIds,
      changedIds: mutation.changedIds,
      report,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "STOCK_SHEET_BACKFILL_FAILED",
        message: error instanceof Error ? error.message : "실재고표 상품 추가 마이그레이션에 실패했습니다.",
      },
      { status: 500 },
    );
  }
}

async function readTargetsFromStockSheet(): Promise<Target[]> {
  const response = await fetch(CSV_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`실재고 상품 관리표 CSV를 불러오지 못했습니다. status=${response.status}`);
  }
  const text = await response.text();
  if (/<!doctype html|<html/i.test(text.slice(0, 500))) {
    throw new Error("실재고 상품 관리표 CSV 대신 HTML 응답을 받았습니다. 시트 공개/접근 권한을 확인해야 합니다.");
  }
  const table = parseCsv(text);
  const groups = new Map<string, Row[]>();

  for (let index = 4; index < Math.min(table.length, CUTOFF_ROW); index += 1) {
    const row = table[index] ?? [];
    const modelNumber = normalizeModel(row[1]);
    if (!ALLOWED_MODELS.has(modelNumber)) continue;
    const productName = cleanText(row[2]);
    if (!productName) continue;
    const sourceRow: Row = {
      rowNumber: index + 1,
      modelNumber,
      productName,
      saleOption: cleanText(row[4]),
      chinaOption: cleanText(row[5]),
      links: [row[55], row[56], row[57], row[58]].map(canonicalize1688Link).filter(Boolean),
    };
    const current = groups.get(modelNumber) ?? [];
    current.push(sourceRow);
    groups.set(modelNumber, current);
  }

  const targets: Target[] = [];
  for (const [modelNumber, rows] of groups) {
    const base = chooseBaseRow(rows);
    const links = uniqueStrings(rows.flatMap((row) => row.links)).slice(0, 4);
    const optionMap = collectOptions(rows, base);
    const optionLabels = [...optionMap.keys()];
    const finalLabels = optionLabels.length ? optionLabels : ["단품"];
    const orderOptions = finalLabels.map((label, index) => ({
      id: `stock-${modelNumber}-${index + 1}`,
      optionName: "옵션",
      saleOption: label,
      chinaOption: optionMap.get(label) ?? "",
      barcode: "",
      baseSalePriceKrw: 0,
      unitCostKrw: 0,
      sourceOrderItemId: null,
    }));
    targets.push({
      modelNumber,
      productName: base.productName,
      optionLabels: finalLabels,
      orderOptions,
      links,
      sourceRows: rows.map((row) => row.rowNumber),
    });
  }
  return targets.sort((left, right) => left.sourceRows[0] - right.sourceRows[0]);
}

function buildPlan(state: ProductLaunchTrackerState, targets: Target[]) {
  const existingModels = new Set(
    (Array.isArray(state.items) ? state.items : [])
      .filter(isRecord)
      .map((item) => normalizeModel(item.modelNumber))
      .filter(Boolean),
  );
  const plannedModels = new Set<string>();
  const skippedExisting: Array<Record<string, unknown>> = [];
  const skippedDuplicateSource: Array<Record<string, unknown>> = [];
  const items: Array<Record<string, unknown>> = [];

  for (const target of targets) {
    if (existingModels.has(target.modelNumber)) {
      skippedExisting.push({ modelNumber: target.modelNumber, productName: target.productName, rows: target.sourceRows });
      continue;
    }
    if (plannedModels.has(target.modelNumber)) {
      skippedDuplicateSource.push({ modelNumber: target.modelNumber, productName: target.productName, rows: target.sourceRows });
      continue;
    }
    plannedModels.add(target.modelNumber);
    const primaryUrl = target.links[0] ?? "";
    items.push({
      workBatch: WORK_BATCH,
      warehouseLocation: "",
      barcode: "",
      modelNumber: target.modelNumber,
      productName: target.productName,
      shoplingCategory: "",
      selfCodeBase: "",
      optionLabels: target.optionLabels,
      orderOptions: target.orderOptions,
      options: target.optionLabels,
      chinaProductLinks: target.links,
      primaryChinaProductLink: primaryUrl,
      detailPageSource: primaryUrl
        ? {
            primaryUrl,
            urls: target.links,
            pinnedIndex: 0,
            source: "stock_sheet_backfill_20260812",
            updatedAt: new Date().toISOString(),
          }
        : null,
      notes: "실재고 상품관리표 1165행 이하 등록완료건 서버 일괄 추가",
      source: {
        file: "실재고 상품 관리표",
        sheet: "실재고 사전",
        rows: target.sourceRows,
        cutoffRow: CUTOFF_ROW,
        columns: "B=모델번호,C=모델명,E=옵션명,F=중국주문옵션,BD:BG=주문링크1~4",
        import: "stock-sheet-backfill-20260812",
      },
      updatedBy: "승준",
    });
  }
  return { items, skippedExisting, skippedDuplicateSource };
}

function collectOptions(rows: Row[], base: Row) {
  const optionMap = new Map<string, string>();
  for (const row of rows) {
    const labels = splitOptionLabels(row.saleOption);
    if (labels.length !== 1) continue;
    const label = labels[0];
    if (!label || isGenericOption(label)) continue;
    if (!optionMap.has(label)) optionMap.set(label, row.chinaOption);
  }
  if (optionMap.size) return optionMap;
  for (const label of splitOptionLabels(base.saleOption)) {
    if (!label || isGenericOption(label)) continue;
    optionMap.set(label, splitOptionLabels(base.saleOption).length === 1 ? base.chinaOption : "");
  }
  return optionMap;
}

function chooseBaseRow(rows: Row[]) {
  return [...rows].sort((left, right) => {
    const leftScore = baseRowScore(left);
    const rightScore = baseRowScore(right);
    if (leftScore !== rightScore) return rightScore - leftScore;
    return left.rowNumber - right.rowNumber;
  })[0] ?? rows[0];
}

function baseRowScore(row: Row) {
  let score = 0;
  if (row.saleOption.includes(",") || /아래\s*모든/.test(row.saleOption)) score += 6;
  if (row.productName && !row.saleOption) score += 3;
  if (row.saleOption === "단품") score += 2;
  return score;
}

function splitOptionLabels(value: unknown) {
  return String(value ?? "")
    .split(/[,\n]+/)
    .map(cleanText)
    .filter(Boolean);
}

function isGenericOption(value: string) {
  const compact = normalizeForCompare(value);
  return (
    !compact ||
    compact === "아래모든옵션" ||
    compact === "아래모든옵션" ||
    compact === "전사이즈" ||
    compact === "전체" ||
    compact === "ㅁ" ||
    compact === "미정"
  );
}

function canonicalize1688Link(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const offer = text.match(/detail\.1688\.com\/offer\/(\d+)\.html/i);
  if (offer) return `https://detail.1688.com/offer/${offer[1]}.html`;
  return text.split("?")[0].replace(/\/$/, "");
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
  row.push(field);
  rows.push(row);
  return rows;
}

function readMigration(state: ProductLaunchTrackerState) {
  const migrations = isRecord(state.serverMigrations) ? state.serverMigrations : {};
  return isRecord(migrations[MIGRATION_KEY]) ? migrations[MIGRATION_KEY] as Record<string, unknown> : null;
}

function markApplied(state: ProductLaunchTrackerState, report: Record<string, unknown>) {
  const migrations = isRecord(state.serverMigrations) ? { ...state.serverMigrations } : {};
  migrations[MIGRATION_KEY] = {
    appliedAt: new Date().toISOString(),
    report,
  };
  return {
    ...state,
    serverMigrations: migrations,
    savedAt: new Date().toISOString(),
    schemaVersion: Math.max(3, Math.floor(Number(state.schemaVersion) || 3)),
  };
}

function cleanText(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function normalizeModel(value: unknown) {
  return cleanText(value).replace(/\s+/g, "").toUpperCase();
}

function normalizeForCompare(value: unknown) {
  return cleanText(value).replace(/\s+/g, "").toLowerCase();
}

function uniqueStrings(values: unknown[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
