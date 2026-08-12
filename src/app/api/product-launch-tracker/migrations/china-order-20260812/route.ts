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
const MIGRATION_KEY = "chinaOrderStockSheet20260812";
const MIGRATION_VERSION = "2026-08-12-server-v1";
const SOURCE_ASSET = "/product-launch-tracker-app/stock-sheet-china-order-sync-20260812.js";

type UnknownRecord = Record<string, unknown>;
type StoredRow = {
  state_payload?: unknown;
  updated_at?: unknown;
  schema_version?: unknown;
  owner_email?: unknown;
};
type MigrationTarget = {
  modelNumber: string;
  productName: string;
  links: string[];
  options: Record<string, string>;
};

type MigrationReport = {
  version: string;
  targetCount: number;
  stateItemCount: number;
  matchedItems: number;
  changedItems: number;
  linkChangedItems: number;
  optionChangedItems: number;
  ambiguousModels: Array<{ modelNumber: string; productName: string; candidates: string[] }>;
  optionIssues: Array<{
    modelNumber: string;
    productName: string;
    reason: string;
    saleOptions?: string[];
  }>;
};

export async function GET(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request, { requireSameOrigin: false });
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
          code: "PRODUCT_LAUNCH_MIGRATION_STATE_NOT_FOUND",
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

    const targets = await loadTargets(request.nextUrl.origin);
    const prepared = prepareMigration(currentState, targets);
    const apply = request.nextUrl.searchParams.get("apply") === "1";

    if (!apply) {
      return Response.json({
        ok: true,
        dryRun: true,
        report: prepared.report,
      });
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
          source: "실재고 상품 관리표/실재고 사전 B,C,E,F,BD:BG",
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
          code: "PRODUCT_LAUNCH_MIGRATION_CONCURRENT_UPDATE",
          message: "마이그레이션 중 다른 저장이 발생했습니다. 다시 실행하세요.",
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
        code: "PRODUCT_LAUNCH_CHINA_ORDER_MIGRATION_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "중국 주문정보 서버 마이그레이션을 완료하지 못했습니다.",
      },
      { status: 500 },
    );
  }
}

async function loadTargets(origin: string): Promise<MigrationTarget[]> {
  const response = await fetch(new URL(SOURCE_ASSET, origin), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`중국 주문 이관 원본을 불러오지 못했습니다. status=${response.status}`);
  }
  const source = await response.text();
  const marker = "const TARGETS = [";
  const start = source.indexOf(marker);
  const end = source.indexOf("\n];\n\nconst TARGET_BY_KEY", start);
  if (start < 0 || end < 0) {
    throw new Error("중국 주문 이관 원본 TARGETS 형식을 확인하지 못했습니다.");
  }
  const json = source.slice(start + "const TARGETS = ".length, end + 2);
  const parsed = JSON.parse(json) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("중국 주문 이관 원본이 배열 형식이 아닙니다.");
  }
  return parsed
    .filter(isRecord)
    .map((entry) => ({
      modelNumber: normalizeModel(entry.modelNumber),
      productName: text(entry.productName),
      links: uniqueLinks(Array.isArray(entry.links) ? entry.links : []).slice(0, 4),
      options: Object.fromEntries(
        Object.entries(asRecord(entry.options))
          .map(([saleOption, chinaOption]) => [text(saleOption), text(chinaOption)])
          .filter(([saleOption, chinaOption]) => saleOption && chinaOption),
      ),
    }))
    .filter((entry) => entry.modelNumber);
}

function prepareMigration(
  stateInput: ProductLaunchTrackerState,
  targets: MigrationTarget[],
): { state: ProductLaunchTrackerState; report: MigrationReport } {
  const state = cloneJson(stateInput);
  const items = Array.isArray(state.items) ? state.items.filter(isRecord) : [];
  const targetsByModel = new Map<string, MigrationTarget[]>();
  for (const target of targets) {
    const list = targetsByModel.get(target.modelNumber) ?? [];
    list.push(target);
    targetsByModel.set(target.modelNumber, list);
  }

  const report: MigrationReport = {
    version: MIGRATION_VERSION,
    targetCount: targets.length,
    stateItemCount: items.length,
    matchedItems: 0,
    changedItems: 0,
    linkChangedItems: 0,
    optionChangedItems: 0,
    ambiguousModels: [],
    optionIssues: [],
  };

  state.items = items.map((item) => {
    const modelNumber = normalizeModel(item.modelNumber);
    const candidates = targetsByModel.get(modelNumber) ?? [];
    if (!candidates.length) return item;

    let target: MigrationTarget | null = null;
    if (candidates.length === 1) {
      target = candidates[0];
    } else {
      const productName = normalizeProduct(item.productName);
      const exact = candidates.filter(
        (candidate) => normalizeProduct(candidate.productName) === productName,
      );
      if (exact.length === 1) target = exact[0];
    }

    if (!target) {
      report.ambiguousModels.push({
        modelNumber,
        productName: text(item.productName),
        candidates: candidates.map((candidate) => candidate.productName),
      });
      return item;
    }

    report.matchedItems += 1;
    const existingLinks = readExistingLinks(item);
    const mergedLinks = mergeLinks(target.links, existingLinks);
    const linkChanged = !sameLinks(existingLinks, mergedLinks);

    const currentOptions = Array.isArray(item.orderOptions)
      ? item.orderOptions.map((option) => (isRecord(option) ? { ...option } : {}))
      : [];
    const mappedEntries = Object.entries(target.options);
    const normalizedMap = new Map(
      mappedEntries.map(([saleOption, chinaOption]) => [normalizeOption(saleOption), chinaOption]),
    );
    const singleFallback =
      currentOptions.length === 1 && mappedEntries.length === 1
        ? mappedEntries[0][1]
        : "";

    let optionChanged = false;
    let mappedOptionCount = 0;
    const unmatchedSaleOptions: string[] = [];
    const nextOptions = currentOptions.map((option) => {
      const saleOption = text(option.saleOption ?? option.value);
      const mapped = normalizedMap.get(normalizeOption(saleOption)) ?? singleFallback;
      if (!mapped) {
        if (mappedEntries.length && saleOption) unmatchedSaleOptions.push(saleOption);
        return option;
      }
      mappedOptionCount += 1;
      if (text(option.chinaOption) === mapped) return option;
      optionChanged = true;
      return { ...option, chinaOption: mapped };
    });

    if (mappedEntries.length && !currentOptions.length) {
      report.optionIssues.push({
        modelNumber,
        productName: text(item.productName),
        reason: "출시관리 판매옵션이 없어 중국옵션명을 안전하게 연결하지 않았습니다.",
      });
    } else if (unmatchedSaleOptions.length) {
      report.optionIssues.push({
        modelNumber,
        productName: text(item.productName),
        reason: `중국옵션 ${mappedEntries.length}개 중 판매옵션 기준으로 ${mappedOptionCount}개만 연결되었습니다.`,
        saleOptions: unmatchedSaleOptions,
      });
    }

    if (!linkChanged && !optionChanged) return item;

    report.changedItems += 1;
    if (linkChanged) report.linkChangedItems += 1;
    if (optionChanged) report.optionChangedItems += 1;

    const now = new Date().toISOString();
    const next = { ...item };
    if (linkChanged) {
      const primaryUrl = mergedLinks[0] ?? "";
      next.chinaProductLinks = mergedLinks;
      next.primaryChinaProductLink = primaryUrl;
      next.detailPageSource = {
        ...asRecord(item.detailPageSource),
        primaryUrl,
        urls: mergedLinks,
        pinnedIndex: primaryUrl ? 0 : null,
        source: "product_launch_tracker",
        updatedAt: now,
      };
    }
    if (optionChanged) next.orderOptions = nextOptions;
    next.updatedAt = now;
    next.updatedBy = "승준";
    return next;
  });

  return { state, report };
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

function readExistingLinks(item: UnknownRecord) {
  const detailPageSource = asRecord(item.detailPageSource);
  return uniqueLinks([
    item.primaryChinaProductLink,
    detailPageSource.primaryUrl,
    ...(Array.isArray(item.chinaProductLinks) ? item.chinaProductLinks : []),
    ...(Array.isArray(detailPageSource.urls) ? detailPageSource.urls : []),
  ]);
}

function mergeLinks(sourceLinks: string[], existingLinks: string[]) {
  return uniqueLinks([...sourceLinks, ...existingLinks]).slice(0, 5);
}

function uniqueLinks(values: unknown[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const raw of values) {
    const value = text(raw);
    if (!value) continue;
    const key = linkIdentity(value);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

function sameLinks(left: string[], right: string[]) {
  return JSON.stringify(uniqueLinks(left).map(linkIdentity)) ===
    JSON.stringify(uniqueLinks(right).map(linkIdentity));
}

function linkIdentity(value: string) {
  const offer = value.match(/detail\.1688\.com\/offer\/(\d+)\.html/i);
  return offer ? `1688-offer:${offer[1]}` : value.toLowerCase().replace(/\/$/, "");
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
