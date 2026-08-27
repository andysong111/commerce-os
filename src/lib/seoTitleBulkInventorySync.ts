import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  SEO_TITLE_DEFAULT_ROUNDS,
  SEO_TITLE_FULL_MARKET_SIZE,
  SEO_TITLE_GROUP_QUOTAS,
  type SeoTitleProductGroup,
} from "@/lib/seoTitleInventoryGenerator";
import { generateFinalKeywordOnlySeoTitleInventory } from "@/lib/seoTitleFinalKeywordInventoryGenerator";
import {
  KEYWORD_ELON_LONG_TITLE_HARD_MIN_BYTES,
  KEYWORD_ELON_LONG_TITLE_IDEAL_MIN_BYTES,
  KEYWORD_ELON_LONG_TITLE_RECOMMENDED_MIN_BYTES,
  KEYWORD_ELON_LONG_TITLE_TARGET_BYTES,
} from "@/lib/keywordEngineElonLongTitlePriority";
import {
  normalizeKeywordElonTitleIntentClass,
  type KeywordElonTitleExpansionMaterial,
} from "@/lib/keywordEngineElonTitleExpansion";
import {
  findSeoTitleLedgerByKey,
  insertSeoTitleInventory,
  listSeoTitleInventoryFingerprints,
  patchSeoTitleLedger,
  upsertSeoTitleLedger,
  type SeoTitleLedgerContext,
  type SeoTitleLedgerRow,
} from "@/lib/seoTitleLedgerServer";
import {
  keywordElonSeoCanonical,
  keywordElonSeoUtf8Bytes,
} from "@/lib/keywordEngineElonLabSeoOutput";
import {
  parse1688OfferId,
  validate1688Url,
} from "@/lib/keywordEngineElonLabV2";
import { readProductLaunchNormalizedItem } from "@/lib/productLaunchTrackerNormalizedStore";
import {
  readProductLaunchError,
  readResponseJson,
} from "@/lib/productLaunchTrackerServer";

const GROUPS = ["도매1", "도매2", "도매3", "도매4", "소매1", "소매2"] as const;
const STRICT_ENGINE_REVISION = "seo-bulk-cloud-inventory-v6-long-title-priority";
const COMPATIBLE_ENGINE_REVISIONS = new Set([
  STRICT_ENGINE_REVISION,
  "seo-bulk-cloud-inventory-v5-category-intent-expansion",
]);
const TRUSTED_FINAL_SOURCES = new Set([
  "seo-bulk-cloud-long-title-priority-v6",
  "seo-bulk-cloud-category-intent-v5",
]);
const TITLE_EXPANSION_META_GROUP_KEYS = [
  { key: "__seoTitleExpansionV6", version: 6 },
  { key: "__seoTitleExpansionV5", version: 5 },
] as const;
const CHANNEL_BY_GROUP: Record<SeoTitleProductGroup, string> = {
  도매1: "wholesale1",
  도매2: "wholesale2",
  도매3: "wholesale3",
  도매4: "wholesale4",
  소매1: "retail1",
  소매2: "retail2",
};

type UnknownRecord = Record<string, unknown>;
type CurrentAssignment = {
  productGroup: SeoTitleProductGroup;
  title: string;
  titleFingerprint: string;
  semanticFingerprint: string;
  mallKey: string;
  marketName: string;
  goodsKey: string;
};

export type SeoBulkInventorySyncResult = {
  itemId: string;
  synced: boolean;
  reason?: string;
  ledgerId?: string;
  modelNumber?: string;
  fullGoodsKeys?: boolean;
  currentAssignmentCount?: number;
  insertedInventoryCount?: number;
  availableCount?: number;
  status?: string;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function stringArray(value: unknown, limit = 100) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    const normalized = text(entry);
    const key = keywordElonSeoCanonical(normalized);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function number100(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, numeric));
}

function parseExpansionPool(value: unknown): KeywordElonTitleExpansionMaterial[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: KeywordElonTitleExpansionMaterial[] = [];
  for (const entry of value) {
    const row = record(entry);
    const keyword = text(row.keyword);
    const key = keywordElonSeoCanonical(keyword);
    if (!key || seen.has(key) || row.categoryAligned !== true) continue;
    const categoryMatch = number100(row.categoryMatch);
    const relevance = number100(row.relevance);
    const shoppingIntent = number100(row.shoppingIntent);
    const qualityScore = number100(row.qualityScore);
    if (
      categoryMatch < 85 ||
      relevance < 85 ||
      shoppingIntent < 70 ||
      qualityScore < 60
    ) {
      continue;
    }
    seen.add(key);
    result.push({
      keyword,
      intentClass: normalizeKeywordElonTitleIntentClass(row.intentClass),
      categoryAligned: true,
      categoryMatch,
      relevance,
      shoppingIntent,
      specificity: number100(row.specificity),
      qualityScore,
      competitionOpportunity: number100(row.competitionOpportunity),
      totalSearch:
        row.totalSearch === null || !Number.isFinite(Number(row.totalSearch))
          ? null
          : Math.max(0, Number(row.totalSearch)),
      expansionScore: Number.isFinite(Number(row.expansionScore))
        ? Number(row.expansionScore)
        : 0,
    });
    if (result.length >= 30) break;
  }
  return result;
}

function expansionPoolFromCurrentSeoFinal(
  seoFinal: UnknownRecord,
): KeywordElonTitleExpansionMaterial[] {
  if (!TRUSTED_FINAL_SOURCES.has(text(seoFinal.source))) return [];
  const directPool = parseExpansionPool(seoFinal.titleExpansionPool);
  if (directPool.length) return directPool;

  const groupProductNames = record(seoFinal.groupProductNames);
  for (const metadataKey of TITLE_EXPANSION_META_GROUP_KEYS) {
    const raw = text(groupProductNames[metadataKey.key]);
    if (!raw) continue;
    try {
      const metadata = record(JSON.parse(raw));
      if (Number(metadata.version) !== metadataKey.version) continue;
      const pool = parseExpansionPool(metadata.pool);
      if (pool.length) return pool;
    } catch {
      // Ignore an invalid legacy metadata row and try the next compatible key.
    }
  }
  return [];
}

function expansionPoolFromExistingLedger(
  ledger: SeoTitleLedgerRow | null,
): KeywordElonTitleExpansionMaterial[] {
  if (
    !ledger ||
    !COMPATIBLE_ENGINE_REVISIONS.has(text(ledger.engine_revision))
  ) {
    return [];
  }
  return parseExpansionPool(record(ledger.source_payload).titleExpansionPool);
}

function isGroup(value: string): value is SeoTitleProductGroup {
  return (GROUPS as readonly string[]).includes(value);
}

function goodsKeysByGroup(item: UnknownRecord) {
  const products = record(item.shoplingProducts);
  return Object.fromEntries(
    GROUPS.map((group) => {
      const channel = record(products[CHANNEL_BY_GROUP[group]]);
      return [group, text(channel.goodsKey)];
    }),
  ) as Record<SeoTitleProductGroup, string>;
}

function currentAssignments(
  seoFinal: UnknownRecord,
  goodsKeys: Record<SeoTitleProductGroup, string>,
) {
  const rows = Array.isArray(seoFinal.mallTitles) ? seoFinal.mallTitles : [];
  const byFingerprint = new Map<string, CurrentAssignment>();
  for (const value of rows) {
    const row = record(value);
    const productGroup = text(row.productGroup);
    const title = text(row.title);
    if (!isGroup(productGroup) || !title) continue;
    const titleFingerprint = keywordElonSeoCanonical(title);
    if (!titleFingerprint || byFingerprint.has(titleFingerprint)) continue;
    byFingerprint.set(titleFingerprint, {
      productGroup,
      title,
      titleFingerprint,
      semanticFingerprint: `current:${productGroup}:${titleFingerprint}`,
      mallKey: text(row.mallKey),
      marketName: text(row.marketName),
      goodsKey: goodsKeys[productGroup],
    });
  }
  return [...byFingerprint.values()];
}

function currentGroupCounts(rows: Array<{ product_group: string; status: string }>) {
  const counts = Object.fromEntries(GROUPS.map((group) => [group, 0])) as Record<
    SeoTitleProductGroup,
    number
  >;
  for (const row of rows) {
    if (!["available", "reserved"].includes(row.status)) continue;
    if (isGroup(row.product_group)) counts[row.product_group] += 1;
  }
  return counts;
}

async function upsertCurrentAssignments(
  context: SeoTitleLedgerContext,
  ledgerId: string,
  assignments: CurrentAssignment[],
) {
  if (!assignments.length) return [];
  const now = new Date().toISOString();
  const rows = assignments.map((row) => ({
    owner_id: context.identity.userId,
    ledger_id: ledgerId,
    product_group: row.productGroup,
    title: row.title,
    title_fingerprint: row.titleFingerprint,
    semantic_fingerprint: row.semanticFingerprint,
    generation_batch: 1,
    quality_score: 0,
    source_materials: [],
    status: "used",
    reservation_id: null,
    reservation_expires_at: null,
    dispatch_id: null,
    mall_key: row.mallKey,
    goods_key: row.goodsKey,
    used_at: now,
    metadata: {
      source: "seo-bulk-cloud-final",
      currentAssignment: true,
      marketName: row.marketName,
      pendingRegistration: false,
    },
  }));
  const result: UnknownRecord[] = [];
  const chunkSize = 100;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const response = await fetch(
      `${context.config.supabaseUrl}/rest/v1/seo_title_inventory?on_conflict=ledger_id,title_fingerprint`,
      {
        method: "POST",
        headers: {
          ...createSupabaseAdminHeaders(context.config.secretKey),
          Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify(chunk),
        cache: "no-store",
      },
    );
    const body = await readResponseJson(response);
    if (!response.ok) {
      throw new Error(readProductLaunchError(body, response.status));
    }
    if (Array.isArray(body)) result.push(...body.map(record));
  }
  return result;
}

async function purgeLegacyUnissuedInventory(
  context: SeoTitleLedgerContext,
  ledgerId: string,
  fingerprints: Array<{ status: string }>,
) {
  if (fingerprints.some((row) => row.status === "reserved")) return false;
  const params = new URLSearchParams({
    ledger_id: `eq.${ledgerId}`,
    status: "in.(available,review)",
  });
  const response = await fetch(
    `${context.config.supabaseUrl}/rest/v1/seo_title_inventory?${params.toString()}`,
    {
      method: "DELETE",
      headers: {
        ...createSupabaseAdminHeaders(context.config.secretKey),
        Prefer: "return=minimal",
      },
      cache: "no-store",
    },
  );
  const body = await readResponseJson(response);
  if (!response.ok) throw new Error(readProductLaunchError(body, response.status));
  return true;
}

export async function syncSeoTitleBulkInventoryForItem(
  context: SeoTitleLedgerContext,
  itemId: string,
): Promise<SeoBulkInventorySyncResult> {
  const normalizedId = text(itemId);
  if (!normalizedId) {
    return { itemId: "", synced: false, reason: "missing_item_id" };
  }

  const item = record(
    await readProductLaunchNormalizedItem(
      context.config,
      context.identity.userId,
      normalizedId,
    ),
  );
  if (!text(item.id)) {
    return { itemId: normalizedId, synced: false, reason: "item_not_found" };
  }

  const seoFinal = record(item.seoFinal);
  const modelName = text(seoFinal.productName);
  const searchKeywords = stringArray(seoFinal.searchKeywords, 10);
  const mallTitles = Array.isArray(seoFinal.mallTitles) ? seoFinal.mallTitles : [];
  if (!modelName || searchKeywords.length !== 10 || !mallTitles.length) {
    return {
      itemId: normalizedId,
      synced: false,
      reason: "seo_final_not_ready",
      modelNumber: text(item.modelNumber),
    };
  }
  if (keywordElonSeoUtf8Bytes(modelName) > 36) {
    return {
      itemId: normalizedId,
      synced: false,
      reason: "model_name_too_long",
      modelNumber: text(item.modelNumber),
    };
  }

  const links = stringArray(item.chinaProductLinks, 5);
  const sourceUrl = text(seoFinal.sourceUrl) || links[0] || "";
  if (!validate1688Url(sourceUrl)) {
    return {
      itemId: normalizedId,
      synced: false,
      reason: "source_url_not_ready",
      modelNumber: text(item.modelNumber),
    };
  }

  const ledgerKey = `launch:${normalizedId}`;
  const existingLedger = await findSeoTitleLedgerByKey(context, ledgerKey);
  const currentExpansionPool = expansionPoolFromCurrentSeoFinal(seoFinal);
  const storedExpansionPool = expansionPoolFromExistingLedger(existingLedger);
  const titleExpansionPool = currentExpansionPool.length
    ? currentExpansionPool
    : storedExpansionPool;

  const now = new Date().toISOString();
  const goodsKeys = goodsKeysByGroup(item);
  const fullGoodsKeys = GROUPS.every((group) => Boolean(goodsKeys[group]));
  const assignments = currentAssignments(seoFinal, goodsKeys);

  if (
    existingLedger &&
    text(existingLedger.engine_revision) !== STRICT_ENGINE_REVISION
  ) {
    const legacyFingerprints = await listSeoTitleInventoryFingerprints(
      context,
      existingLedger.ledger_id,
    );
    const upgraded = await purgeLegacyUnissuedInventory(
      context,
      existingLedger.ledger_id,
      legacyFingerprints,
    );
    if (!upgraded) {
      return {
        itemId: normalizedId,
        synced: false,
        reason: "inventory_upgrade_deferred_active_reservation",
        ledgerId: existingLedger.ledger_id,
        modelNumber: text(item.modelNumber),
        fullGoodsKeys,
      };
    }
  }

  const ledger = await upsertSeoTitleLedger(context, {
    ledger_key: ledgerKey,
    launch_item_id: normalizedId,
    tracker_row_number: Number(item.trackerRowNumber) || null,
    model_number: text(item.modelNumber),
    source_url: sourceUrl,
    offer_id: text(seoFinal.offerId) || parse1688OfferId(sourceUrl),
    model_name: modelName,
    model_name_source: "seo_bulk_final",
    common_search_keywords: searchKeywords,
    common_search_line: searchKeywords.join(","),
    source_payload: {
      source: text(seoFinal.source) || "seo-bulk-cloud",
      seoFinal,
      titleExpansionPool,
      launchContext: {
        itemId: normalizedId,
        trackerRowNumber: Number(item.trackerRowNumber) || null,
        modelNumber: text(item.modelNumber),
        shoplingCategory: text(item.shoplingCategory),
      },
      inventoryPolicy: {
        titleMaterialPolicy: titleExpansionPool.length
          ? "final10-plus-priority-expansion-long-title-v6"
          : "final10-long-title-v6-fallback",
        titleByteRange: [
          KEYWORD_ELON_LONG_TITLE_HARD_MIN_BYTES,
          50,
        ],
        recommendedMinBytes: KEYWORD_ELON_LONG_TITLE_RECOMMENDED_MIN_BYTES,
        idealByteRange: [KEYWORD_ELON_LONG_TITLE_IDEAL_MIN_BYTES, 50],
        targetBytes: KEYWORD_ELON_LONG_TITLE_TARGET_BYTES,
        adjacentExpansionFallback: true,
        currentFinalTitlesAreConsumed: fullGoodsKeys,
        targetRounds: SEO_TITLE_DEFAULT_ROUNDS,
      },
    },
    engine_revision: STRICT_ENGINE_REVISION,
    target_inventory_count:
      SEO_TITLE_FULL_MARKET_SIZE * SEO_TITLE_DEFAULT_ROUNDS,
    status: "generating",
    last_generated_at: now,
    updated_at: now,
  });

  if (fullGoodsKeys) {
    await upsertCurrentAssignments(context, ledger.ledger_id, assignments);
  }

  const fingerprints = await listSeoTitleInventoryFingerprints(
    context,
    ledger.ledger_id,
  );
  const counts = currentGroupCounts(fingerprints);
  const generationBatch =
    Math.max(
      0,
      ...fingerprints.map((row) => Number(row.generation_batch) || 0),
    ) + 1;

  const generation = generateFinalKeywordOnlySeoTitleInventory({
    finalKeywords: searchKeywords,
    titleExpansionPool,
    rounds: SEO_TITLE_DEFAULT_ROUNDS,
    existingTitleFingerprints: fingerprints.map(
      (row) => row.title_fingerprint,
    ),
  });

  const missingByGroup = Object.fromEntries(
    GROUPS.map((group) => [
      group,
      Math.max(
        0,
        SEO_TITLE_GROUP_QUOTAS[group] * SEO_TITLE_DEFAULT_ROUNDS -
          counts[group],
      ),
    ]),
  ) as Record<SeoTitleProductGroup, number>;
  const selectedByGroup = new Map<SeoTitleProductGroup, number>();
  const selected = generation.candidates.filter((candidate) => {
    const used = selectedByGroup.get(candidate.productGroup) ?? 0;
    if (used >= missingByGroup[candidate.productGroup]) return false;
    selectedByGroup.set(candidate.productGroup, used + 1);
    return true;
  });

  const inserted = await insertSeoTitleInventory(
    context,
    selected.map((candidate) => ({
      ledger_id: ledger.ledger_id,
      product_group: candidate.productGroup,
      title: candidate.title,
      title_fingerprint: candidate.titleFingerprint,
      semantic_fingerprint: candidate.semanticFingerprint,
      generation_batch: generationBatch,
      quality_score: candidate.qualityScore,
      source_materials: candidate.sourceMaterials,
      status: "available",
      metadata: {
        ...candidate.metadata,
        source: STRICT_ENGINE_REVISION,
      },
    })),
  );

  const finalFingerprints = await listSeoTitleInventoryFingerprints(
    context,
    ledger.ledger_id,
  );
  const finalCounts = currentGroupCounts(finalFingerprints);
  const shortages = GROUPS.filter(
    (group) =>
      finalCounts[group] <
      SEO_TITLE_GROUP_QUOTAS[group] * SEO_TITLE_DEFAULT_ROUNDS,
  );
  const status = shortages.length ? "needs_review" : "ready";
  await patchSeoTitleLedger(context, ledger.ledger_id, {
    status,
    last_generated_at: now,
    updated_at: now,
  });

  return {
    itemId: normalizedId,
    synced: true,
    ledgerId: ledger.ledger_id,
    modelNumber: text(item.modelNumber),
    fullGoodsKeys,
    currentAssignmentCount: fullGoodsKeys ? assignments.length : 0,
    insertedInventoryCount: inserted.length,
    availableCount: GROUPS.reduce(
      (sum, group) => sum + finalCounts[group],
      0,
    ),
    status,
    reason: existingLedger ? "updated" : "created",
  };
}
