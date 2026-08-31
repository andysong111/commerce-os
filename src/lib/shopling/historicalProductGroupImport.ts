import {
  INTERNAL_PRICE_GROUP_LABELS,
  groupKeyForLabel,
  searchPrefixForLabel,
  type InternalPriceGroup,
} from "@/lib/internalChinaPriceGroupPolicy";
import {
  extractHistoricalGoodsKeysFromXlsx,
  inferInternalPriceGroupFromFilename,
} from "@/lib/shopling/historicalProductGroupXlsx";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";

export type HistoricalProductGroupUpload = {
  filename: string;
  bytes: Uint8Array;
};

export type HistoricalProductGroupImportFileResult = {
  filename: string;
  productGroup: InternalPriceGroup;
  extractedCount: number;
  insertedCount: number;
  alreadySameCount: number;
  matchedSheets: string[];
};

function connection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return { baseUrl, secret };
}

async function registryRequest<T>(input: {
  method?: "GET" | "POST";
  query: URLSearchParams;
  body?: unknown;
  prefer?: string;
}) {
  const { baseUrl, secret } = connection();
  const response = await fetch(
    `${baseUrl}/rest/v1/shopling_product_group_registry?${input.query.toString()}`,
    {
      method: input.method ?? "GET",
      headers: {
        ...createSupabaseAdminHeaders(secret),
        ...(input.prefer ? { Prefer: input.prefer } : {}),
      },
      body: input.method === "POST" ? JSON.stringify(input.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    },
  );
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(
      `HISTORICAL_GROUP_REGISTRY_FAILED:${response.status}:${raw.slice(0, 300)}`,
    );
  }
  return (raw ? JSON.parse(raw) : null) as T;
}

async function resolveSingleOwnerId() {
  const rows = await registryRequest<{ owner_id: string }[]>({
    query: new URLSearchParams({ select: "owner_id", limit: "5000" }),
  });
  const owners = [...new Set((rows ?? []).map((row) => row.owner_id).filter(Boolean))];
  if (owners.length !== 1) {
    throw new Error(`HISTORICAL_GROUP_OWNER_AMBIGUOUS:${owners.length}`);
  }
  return owners[0];
}

async function loadExisting(goodsKeys: string[]) {
  const result = new Map<string, string>();
  for (let offset = 0; offset < goodsKeys.length; offset += 100) {
    const chunk = goodsKeys.slice(offset, offset + 100);
    const rows = await registryRequest<
      { goods_key: string; product_group_label: string }[]
    >({
      query: new URLSearchParams({
        select: "goods_key,product_group_label",
        goods_key: `in.(${chunk.join(",")})`,
      }),
    });
    for (const row of rows ?? []) result.set(String(row.goods_key), row.product_group_label);
  }
  return result;
}

export async function importHistoricalProductGroups(
  uploads: HistoricalProductGroupUpload[],
) {
  if (!uploads.length) throw new Error("HISTORICAL_GROUP_FILES_REQUIRED");
  const parsed = uploads.map((upload) => {
    if (!/\.xlsx$/i.test(upload.filename)) {
      throw new Error(`HISTORICAL_GROUP_XLSX_REQUIRED:${upload.filename}`);
    }
    const productGroup = inferInternalPriceGroupFromFilename(upload.filename);
    const extracted = extractHistoricalGoodsKeysFromXlsx(upload.bytes);
    return { ...upload, productGroup, ...extracted };
  });

  const groups = new Set(parsed.map((row) => row.productGroup));
  const missingGroups = INTERNAL_PRICE_GROUP_LABELS.filter((group) => !groups.has(group));
  if (groups.size !== parsed.length || missingGroups.length) {
    throw new Error(
      `HISTORICAL_GROUP_SIX_FILES_REQUIRED:missing=${missingGroups.join(",") || "none"}`,
    );
  }

  const authoritative = new Map<string, InternalPriceGroup>();
  const crossFileConflicts: string[] = [];
  for (const file of parsed) {
    for (const goodsKey of file.goodsKeys) {
      const current = authoritative.get(goodsKey);
      if (current && current !== file.productGroup) {
        crossFileConflicts.push(`${goodsKey}:${current}->${file.productGroup}`);
      } else {
        authoritative.set(goodsKey, file.productGroup);
      }
    }
  }
  if (crossFileConflicts.length) {
    throw new Error(
      `HISTORICAL_GROUP_FILE_CONFLICT:${crossFileConflicts.slice(0, 20).join("|")}`,
    );
  }

  const allGoodsKeys = [...authoritative.keys()].sort(
    (left, right) => Number(left) - Number(right),
  );
  const existing = await loadExisting(allGoodsKeys);
  const registryConflicts = allGoodsKeys
    .filter((goodsKey) => {
      const stored = existing.get(goodsKey);
      return stored && stored !== authoritative.get(goodsKey);
    })
    .map(
      (goodsKey) =>
        `${goodsKey}:${existing.get(goodsKey)}->${authoritative.get(goodsKey)}`,
    );
  if (registryConflicts.length) {
    throw new Error(
      `HISTORICAL_GROUP_EXISTING_CONFLICT:${registryConflicts.slice(0, 20).join("|")}`,
    );
  }

  const ownerId = await resolveSingleOwnerId();
  const missing = allGoodsKeys.filter((goodsKey) => !existing.has(goodsKey));
  const inserted = new Set<string>();
  for (let offset = 0; offset < missing.length; offset += 250) {
    const chunk = missing.slice(offset, offset + 250);
    const body = chunk.map((goodsKey) => {
      const productGroup = authoritative.get(goodsKey)!;
      return {
        owner_id: ownerId,
        goods_key: goodsKey,
        launch_item_id: "",
        model_number: "",
        product_group_key: groupKeyForLabel(productGroup),
        product_group_label: productGroup,
        ptn_goods_cd: "",
        search_prefix: searchPrefixForLabel(productGroup),
        code_format: "legacy_suffix",
        shopling_status: "HISTORICAL_FILE_IMPORT",
        registered_at: null,
        updated_at: new Date().toISOString(),
      };
    });
    const rows = await registryRequest<{ goods_key: string }[]>({
      method: "POST",
      query: new URLSearchParams({ on_conflict: "owner_id,goods_key" }),
      prefer: "resolution=ignore-duplicates,return=representation",
      body,
    });
    for (const row of rows ?? []) inserted.add(String(row.goods_key));
  }

  const files: HistoricalProductGroupImportFileResult[] = parsed.map((file) => ({
    filename: file.filename,
    productGroup: file.productGroup,
    extractedCount: file.goodsKeys.length,
    insertedCount: file.goodsKeys.filter((goodsKey) => inserted.has(goodsKey)).length,
    alreadySameCount: file.goodsKeys.filter(
      (goodsKey) => existing.get(goodsKey) === file.productGroup,
    ).length,
    matchedSheets: file.matchedSheets,
  }));

  return {
    ownerId,
    extractedUniqueCount: allGoodsKeys.length,
    insertedCount: inserted.size,
    alreadySameCount: allGoodsKeys.length - inserted.size,
    conflictCount: 0,
    files,
  };
}
