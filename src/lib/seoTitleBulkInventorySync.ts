import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  SEO_TITLE_DEFAULT_ROUNDS,
  SEO_TITLE_FULL_MARKET_SIZE,
  SEO_TITLE_GROUP_QUOTAS,
  generateSeoTitleInventory,
  type SeoTitleKeywordMaterial,
  type SeoTitleProductGroup,
} from "@/lib/seoTitleInventoryGenerator";
import {
  fillSeoTitleInventoryShortages,
  type SeoTitleFallbackCandidate,
} from "@/lib/seoTitleInventoryFallback";
import {
  findSeoTitleLedgerByKey,
  insertSeoTitleInventory,
  listSeoTitleInventoryFingerprints,
  patchSeoTitleLedger,
  upsertSeoTitleLedger,
  type SeoTitleLedgerContext,
} from "@/lib/seoTitleLedgerServer";
import {
  keywordElonSeoCanonical,
  keywordElonSeoUtf8Bytes,
} from "@/lib/keywordEngineElonLabSeoOutput";
import { parse1688OfferId } from "@/lib/keywordEngineElonLabV2";
import { readProductLaunchNormalizedItem } from "@/lib/productLaunchTrackerNormalizedStore";
import {
  readProductLaunchError,
  readResponseJson,
} from "@/lib/productLaunchTrackerServer";

const GROUPS = ["도매1", "도매2", "도매3", "도매4", "소매1", "소매2"] as const;
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
  inventoryCount?: number;
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

function neutralKeywordMaterials(keywords: string[]): SeoTitleKeywordMaterial[] {
  return keywords.map((keyword) => ({
    keyword,
    score: 0,
    relevance: 0,
    shoppingIntent: 0,
    specificity: 0,
    qualityScore: 0,
    demandScore: 0,
    totalSearch: null,
    origin: "seo_bulk_final",
    sourceMaterials: [keyword],
  }));
}

function groupCounts(
  rows: Array<{ product_group: string; status: string }>,
  statuses: string[],
) {
  const allowedStatuses = new Set(statuses);
  const counts = Object.fromEntries(GROUPS.map((group) => [group, 0])) as Record<
    SeoTitleProductGroup,
    number
  >;
  for (const row of rows) {
    if (!allowedStatuses.has(row.status)) continue;
    if (isGroup(row.product_group)) counts[row.product_group] += 1;
  }
  return counts;
}

function verifiedExtraMaterials(
  item: UnknownRecord,
  seoFinal: UnknownRecord,
  assignments: CurrentAssignment[],
) {
  const options = Array.isArray(item.orderOptions) ? item.orderOptions.map(record) : [];
  return stringArray([
    text(item.productName),
    text(item.shoplingCategory),
    ...options.flatMap((option) => [
      text(option.saleOption),
      text(option.chinaOption),
      text(option.optionName),
    ]),
    ...Object.values(record(seoFinal.groupProductNames)).map(text),
    ...assignments.map((row) => row.title),
  ], 160);
}

function sourceMode(seoFinal: UnknownRecord, sourceUrl: string) {
  const source = text(seoFinal.source);
  if (source.endsWith(":legacy_internal")) return "legacy_internal";
  if (source.endsWith(":tracker_fallback")) return "tracker_fallback";
  if (source.endsWith(":1688_server")) return "1688_server";
  return sourceUrl ? "1688_or_legacy_existing" : "legacy_internal";
}

async function upsertCurrentAssignments(
  context: SeoTitleLedgerContext,
  ledgerId: string,
  assignments: CurrentAssignment[],
  fullGoodsKeys: boolean,
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
    status: fullGoodsKeys ? "used" : "review",
    reservation_id: null,
    reservation_expires_at: null,
    dispatch_id: null,
    mall_key: row.mallKey,
    goods_key: row.goodsKey,
    used_at: fullGoodsKeys ? now : null,
    metadata: {
      source: "seo-bulk-cloud-final",
      currentAssignment: true,
      marketName: row.marketName,
      pendingRegistration: !fullGoodsKeys,
      qualityTier: "A",
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

export async function syncSeoTitleBulkInventoryForItem(
  context: SeoTitleLedgerContext,
  itemId: string,
): Promise<SeoBulkInventorySyncResult> {
  const normalizedId = text(itemId);
  if (!normalizedId) return { itemId: "", synced: false, reason: "missing_item_id" };

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
  if (!modelName || searchKeywords.length !== 10 || mallTitles.length !== 29) {
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
  const now = new Date().toISOString();
  const goodsKeys = goodsKeysByGroup(item);
  const fullGoodsKeys = GROUPS.every((group) => Boolean(goodsKeys[group]));
  const assignments = currentAssignments(seoFinal, goodsKeys);
  const ledgerKey = `launch:${normalizedId}`;
  const existingLedger = await findSeoTitleLedgerByKey(context, ledgerKey);
  const extraMaterials = verifiedExtraMaterials(item, seoFinal, assignments);
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
      source: "seo-bulk-cloud",
      sourceMode: sourceMode(seoFinal, sourceUrl),
      seoFinal,
      launchContext: {
        itemId: normalizedId,
        trackerRowNumber: Number(item.trackerRowNumber) || null,
        modelNumber: text(item.modelNumber),
      },
      verifiedExtraMaterials: extraMaterials,
      inventoryPolicy: {
        currentFinalTitlesAreConsumed: fullGoodsKeys,
        targetRounds: SEO_TITLE_DEFAULT_ROUNDS,
        fixedTargetRequired: true,
        fallbackOrder: [
          "semantic_intent",
          "fact_combination",
          "synonym_structure",
          "verified_word_order",
        ],
      },
    },
    engine_revision: "seo-bulk-cloud-inventory-v3-fixed145",
    target_inventory_count: SEO_TITLE_FULL_MARKET_SIZE * SEO_TITLE_DEFAULT_ROUNDS,
    status: "generating",
    last_generated_at: now,
    updated_at: now,
  });

  await upsertCurrentAssignments(
    context,
    ledger.ledger_id,
    assignments,
    fullGoodsKeys,
  );

  const fingerprints = await listSeoTitleInventoryFingerprints(
    context,
    ledger.ledger_id,
  );
  const counts = groupCounts(
    fingerprints,
    ["available", "reserved", "used", "review"],
  );
  const generationBatch = Math.max(
    0,
    ...fingerprints.map((row) => Number(row.generation_batch) || 0),
  ) + 1;
  const keywordMaterials = neutralKeywordMaterials(searchKeywords);

  const generation = generateSeoTitleInventory({
    modelName,
    searchKeywords: keywordMaterials,
    extraMaterials,
    rounds: SEO_TITLE_DEFAULT_ROUNDS,
    existingTitleFingerprints: fingerprints.map((row) => row.title_fingerprint),
    existingSemanticFingerprints: fingerprints.map((row) => row.semantic_fingerprint),
  });
  const guaranteed = fillSeoTitleInventoryShortages({
    modelName,
    searchKeywords: keywordMaterials,
    extraMaterials,
    rounds: SEO_TITLE_DEFAULT_ROUNDS,
    baseCandidates: generation.candidates as unknown as SeoTitleFallbackCandidate[],
    existingTitleFingerprints: fingerprints.map((row) => row.title_fingerprint),
  });

  const missingByGroup = Object.fromEntries(
    GROUPS.map((group) => [
      group,
      Math.max(
        0,
        SEO_TITLE_GROUP_QUOTAS[group] * SEO_TITLE_DEFAULT_ROUNDS - counts[group],
      ),
    ]),
  ) as Record<SeoTitleProductGroup, number>;
  const selectedByGroup = new Map<SeoTitleProductGroup, number>();
  const selected = guaranteed.candidates.filter((candidate) => {
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
        source: "seo-bulk-cloud-inventory-v3-fixed145",
        qualityTier: candidate.metadata.strategy.includes("_D_")
          ? "D"
          : candidate.metadata.strategy.includes("_C_")
            ? "C"
            : "B",
      },
    })),
  );

  const finalFingerprints = await listSeoTitleInventoryFingerprints(
    context,
    ledger.ledger_id,
  );
  const finalCounts = groupCounts(
    finalFingerprints,
    ["available", "reserved", "used", "review"],
  );
  const availableCounts = groupCounts(
    finalFingerprints,
    ["available", "reserved"],
  );
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
    currentAssignmentCount: assignments.length,
    insertedInventoryCount: inserted.length,
    availableCount: GROUPS.reduce((sum, group) => sum + availableCounts[group], 0),
    inventoryCount: GROUPS.reduce((sum, group) => sum + finalCounts[group], 0),
    status,
    reason: shortages.length
      ? `fixed_145_shortage:${shortages.join(",")}`
      : existingLedger
        ? "updated"
        : "created",
  };
}
