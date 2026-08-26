import { NextRequest } from "next/server";
import {
  SEO_TITLE_DEFAULT_ROUNDS,
  SEO_TITLE_FULL_MARKET_SIZE,
  SEO_TITLE_GROUP_QUOTAS,
  SEO_TITLE_MAX_ROUNDS,
  type SeoTitleKeywordMaterial,
  type SeoTitleProductGroup,
} from "@/lib/seoTitleInventoryGenerator";
import { generateGuaranteedSeoTitleInventory } from "@/lib/seoTitleInventoryGuaranteed";
import {
  findSeoTitleLedgerByKey,
  insertSeoTitleInventory,
  listSeoTitleInventoryFingerprints,
  listSeoTitleLedgers,
  patchSeoTitleLedger,
  readSeoTitleLedger,
  requireSeoTitleLedgerContext,
  upsertSeoTitleLedger,
} from "@/lib/seoTitleLedgerServer";
import {
  parse1688OfferId,
  validate1688Url,
} from "@/lib/keywordEngineElonLabV2";
import { keywordElonSeoUtf8Bytes } from "@/lib/keywordEngineElonLabSeoOutput";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type UnknownRecord = Record<string, unknown>;

type SaveInventoryInput = {
  action?: unknown;
  launchItemId?: unknown;
  trackerRowNumber?: unknown;
  modelNumber?: unknown;
  sourceUrl?: unknown;
  offerId?: unknown;
  rounds?: unknown;
  seoOutput?: unknown;
  sourcePayload?: unknown;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function integer(value: unknown, fallback = 0) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringArray(value: unknown, limit = 500) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of value) {
    const normalized = text(item);
    const key = normalized.toLocaleLowerCase().replace(/\s+/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
    if (output.length >= limit) break;
  }
  return output;
}

function keywordMaterials(value: unknown): SeoTitleKeywordMaterial[] {
  if (!Array.isArray(value)) return [];
  const output: SeoTitleKeywordMaterial[] = [];
  for (const item of value) {
    const row = record(item);
    const keyword = text(row.keyword);
    if (!keyword) continue;
    output.push({
      keyword,
      score: Number(row.score) || 0,
      relevance: Number(row.relevance) || 0,
      shoppingIntent: Number(row.shoppingIntent) || 0,
      specificity: Number(row.specificity) || 0,
      qualityScore: Number(row.qualityScore) || 0,
      demandScore: Number(row.demandScore) || 0,
      totalSearch:
        row.totalSearch === null || row.totalSearch === undefined
          ? null
          : Number(row.totalSearch),
      origin: text(row.origin),
      sourceMaterials: stringArray(row.sourceMaterials, 4),
    });
  }
  return output;
}

function resolveLedgerKey(input: {
  launchItemId: string;
  offerId: string;
  modelNumber: string;
  sourceUrl: string;
}) {
  if (input.launchItemId) return `launch:${input.launchItemId}`;
  if (input.offerId) return `offer:${input.offerId}`;
  if (input.modelNumber) return `model:${input.modelNumber.toLocaleLowerCase()}`;
  if (input.sourceUrl) return `url:${input.sourceUrl}`;
  throw new Error("상품명 재고를 식별할 출시상품 ID 또는 모델번호가 필요합니다.");
}

function extraMaterials(sourcePayload: UnknownRecord, seoOutput: UnknownRecord) {
  const identity = record(sourcePayload.identity);
  const candidates = Array.isArray(sourcePayload.candidates)
    ? sourcePayload.candidates.map(record)
    : [];
  const factPool = Array.isArray(sourcePayload.factPool)
    ? sourcePayload.factPool.map(record)
    : [];
  const allowedKeys = new Set(
    stringArray(sourcePayload.allowedKeys).map((value) =>
      value.toLocaleLowerCase().replace(/[^0-9a-z가-힣]/g, ""),
    ),
  );
  const candidateTerms = candidates
    .filter((candidate) => {
      const term = text(
        candidate.searchKeyword || candidate.searchKey || candidate.keyword,
      );
      const key = term.toLocaleLowerCase().replace(/[^0-9a-z가-힣]/g, "");
      return key && allowedKeys.has(key);
    })
    .map((candidate) =>
      text(candidate.searchKeyword || candidate.searchKey || candidate.keyword),
    );
  const factTerms = factPool
    .filter((fact) => fact.titleAllowed === true && ["A", "B"].includes(text(fact.confidence)))
    .map((fact) => text(fact.value));

  return stringArray(
    [
      ...candidateTerms,
      ...factTerms,
      ...stringArray(seoOutput.commonSearchKeywords, 10),
      identity.identityAnchor,
      identity.koreanProductIdentity,
      identity.coreProduct,
      ...stringArray(identity.primarySeeds, 30),
      ...stringArray(identity.conditionalSeeds, 30),
      ...stringArray(identity.functionModifiers, 30),
      ...stringArray(identity.designShapeModifiers, 30),
      ...stringArray(identity.specAttributes, 30),
    ],
    160,
  );
}

function validateSearchKeywords(value: unknown) {
  const keywords = stringArray(value, 10);
  if (keywords.length !== 10) {
    throw new Error("공통 검색어는 정확히 10개여야 합니다.");
  }
  if (keywords.some((keyword) => /\s/.test(keyword))) {
    throw new Error("공통 검색어에는 띄어쓰기를 사용할 수 없습니다.");
  }
  return keywords;
}

function groupCounts(
  rows: Array<{ product_group: string; status: string }>,
) {
  const counts = Object.fromEntries(
    Object.keys(SEO_TITLE_GROUP_QUOTAS).map((group) => [group, 0]),
  ) as Record<SeoTitleProductGroup, number>;
  for (const row of rows) {
    if (!["available", "reserved", "review", "used"].includes(row.status)) continue;
    if (row.product_group in counts) {
      counts[row.product_group as SeoTitleProductGroup] += 1;
    }
  }
  return counts;
}

export async function GET(request: NextRequest) {
  const authenticated = await requireSeoTitleLedgerContext(request);
  if (!authenticated.ok) return authenticated.response;
  const context = authenticated.value;
  const mode = request.nextUrl.searchParams.get("mode") || "list";

  try {
    if (mode === "detail") {
      const ledgerId = text(request.nextUrl.searchParams.get("ledgerId"));
      if (!ledgerId) {
        return Response.json(
          { ok: false, code: "SEO_TITLE_LEDGER_ID_REQUIRED", message: "원장 ID가 필요합니다." },
          { status: 400 },
        );
      }
      const detail = await readSeoTitleLedger(context, ledgerId);
      if (!detail) {
        return Response.json(
          { ok: false, code: "SEO_TITLE_LEDGER_NOT_FOUND", message: "상품명 원장을 찾지 못했습니다." },
          { status: 404 },
        );
      }
      return Response.json({ ok: true, ...detail });
    }

    const rows = await listSeoTitleLedgers(context, {
      search: request.nextUrl.searchParams.get("search") || "",
      limit: integer(request.nextUrl.searchParams.get("limit"), 200),
    });
    return Response.json({ ok: true, ledgers: rows, count: rows.length });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "SEO_TITLE_LEDGER_READ_FAILED",
        message: error instanceof Error ? error.message : "상품명 원장을 읽지 못했습니다.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authenticated = await requireSeoTitleLedgerContext(request);
  if (!authenticated.ok) return authenticated.response;
  const context = authenticated.value;
  const input = (await request.json().catch(() => ({}))) as SaveInventoryInput;
  const action = text(input.action) || "save_inventory";

  if (action !== "save_inventory" && action !== "replenish") {
    return Response.json(
      { ok: false, code: "SEO_TITLE_LEDGER_ACTION_INVALID", message: "지원하지 않는 원장 작업입니다." },
      { status: 400 },
    );
  }

  try {
    const rawSourceUrl = text(input.sourceUrl);
    const sourceUrl = validate1688Url(rawSourceUrl) ? rawSourceUrl : "";
    const sourceMode = sourceUrl ? "1688_full" : "legacy_fallback";
    const seoOutput = record(input.seoOutput);
    const sourcePayload = record(input.sourcePayload);
    const modelName = text(seoOutput.modelName);
    if (!modelName) throw new Error("상품 정체성을 나타내는 모델명이 필요합니다.");
    if (keywordElonSeoUtf8Bytes(modelName) > 36) {
      throw new Error("모델명은 36bytes 이하여야 합니다.");
    }
    const commonSearchKeywords = validateSearchKeywords(
      seoOutput.commonSearchKeywords,
    );
    const commonSearchLine = commonSearchKeywords.join(",");
    const searchKeywordDetails = keywordMaterials(
      seoOutput.searchKeywordDetails,
    );
    if (searchKeywordDetails.length !== 10) {
      throw new Error("검색어 10개의 품질 정보가 필요합니다.");
    }

    const launchItemId = text(input.launchItemId);
    const trackerRowNumber = integer(input.trackerRowNumber, 0) || null;
    const modelNumber = text(input.modelNumber);
    const offerId = text(input.offerId) || (sourceUrl ? parse1688OfferId(sourceUrl) : "");
    const rounds = Math.max(
      1,
      Math.min(
        SEO_TITLE_MAX_ROUNDS,
        integer(input.rounds, SEO_TITLE_DEFAULT_ROUNDS),
      ),
    );
    const ledgerKey = resolveLedgerKey({
      launchItemId,
      offerId,
      modelNumber,
      sourceUrl,
    });
    const ledgerSourceUrl = sourceUrl || `legacy://seo-ledger/${encodeURIComponent(ledgerKey)}`;
    const existingLedger = await findSeoTitleLedgerByKey(context, ledgerKey);
    const saved = await upsertSeoTitleLedger(context, {
      ledger_key: ledgerKey,
      launch_item_id: launchItemId,
      tracker_row_number: trackerRowNumber,
      model_number: modelNumber,
      source_url: ledgerSourceUrl,
      offer_id: offerId,
      model_name: modelName,
      model_name_source: text(seoOutput.modelNameSource) || (sourceMode === "1688_full" ? "seo_final" : "legacy_fallback"),
      common_search_keywords: commonSearchKeywords,
      common_search_line: commonSearchLine,
      source_payload: {
        ...sourcePayload,
        sourceMode,
        seoOutput: {
          ...seoOutput,
          modelName,
          commonSearchKeywords,
          commonSearchLine,
          searchKeywordDetails,
        },
        launchContext: {
          launchItemId,
          trackerRowNumber,
          modelNumber,
        },
        inventoryPolicy: {
          fixedTargetCount: SEO_TITLE_FULL_MARKET_SIZE * rounds,
          countAllNonRejectedTitlesTowardTarget: true,
          fallbackOrder: ["semantic", "fact_combination", "synonym_structure", "word_order"],
        },
      },
      engine_revision: "seo-title-inventory-v3",
      target_inventory_count: SEO_TITLE_FULL_MARKET_SIZE * rounds,
      status: "generating",
      last_generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const fingerprints = await listSeoTitleInventoryFingerprints(
      context,
      saved.ledger_id,
    );
    const currentByGroup = groupCounts(fingerprints);
    const generationBatch = Math.max(
      0,
      ...fingerprints.map((row) => integer(row.generation_batch, 0)),
    ) + 1;
    const generation = generateGuaranteedSeoTitleInventory({
      modelName,
      searchKeywords: searchKeywordDetails,
      extraMaterials: extraMaterials(sourcePayload, seoOutput),
      rounds,
      existingTitleFingerprints: fingerprints.map(
        (row) => row.title_fingerprint,
      ),
      existingSemanticFingerprints: fingerprints.map(
        (row) => row.semantic_fingerprint,
      ),
    });

    const missingByGroup = Object.fromEntries(
      (Object.keys(SEO_TITLE_GROUP_QUOTAS) as SeoTitleProductGroup[]).map(
        (group) => [
          group,
          Math.max(0, SEO_TITLE_GROUP_QUOTAS[group] * rounds - currentByGroup[group]),
        ],
      ),
    ) as Record<SeoTitleProductGroup, number>;
    const selectedByGroup = new Map<SeoTitleProductGroup, number>();
    const candidates = generation.candidates.filter((candidate) => {
      const used = selectedByGroup.get(candidate.productGroup) ?? 0;
      if (used >= missingByGroup[candidate.productGroup]) return false;
      selectedByGroup.set(candidate.productGroup, used + 1);
      return true;
    });
    const inserted = await insertSeoTitleInventory(
      context,
      candidates.map((candidate) => ({
        ledger_id: saved.ledger_id,
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
          sourceMode,
          source: "seo-title-inventory-v3",
        },
      })),
    );

    const finalFingerprints = await listSeoTitleInventoryFingerprints(context, saved.ledger_id);
    const finalByGroup = groupCounts(finalFingerprints);
    const shortageGroups = (Object.keys(finalByGroup) as SeoTitleProductGroup[])
      .filter((group) => finalByGroup[group] < SEO_TITLE_GROUP_QUOTAS[group] * rounds);
    const inventoryCount = Object.values(finalByGroup).reduce((sum, value) => sum + value, 0);
    await patchSeoTitleLedger(context, saved.ledger_id, {
      status:
        shortageGroups.length || inventoryCount !== SEO_TITLE_FULL_MARKET_SIZE * rounds
          ? "needs_review"
          : "ready",
      target_inventory_count: SEO_TITLE_FULL_MARKET_SIZE * rounds,
      last_generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const detail = await readSeoTitleLedger(context, saved.ledger_id);

    return Response.json({
      ok: true,
      action,
      created: !existingLedger,
      ledgerId: saved.ledger_id,
      sourceMode,
      insertedCount: inserted.length,
      inventoryCount,
      requestedRounds: rounds,
      missingByGroup,
      shortageGroups,
      gradeCounts: generation.gradeCounts,
      forcedFilledCount: generation.forcedFilledCount,
      generationWarnings: generation.warnings,
      detail,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "SEO_TITLE_LEDGER_SAVE_FAILED",
        message: error instanceof Error ? error.message : "상품명 원장을 저장하지 못했습니다.",
      },
      { status: 400 },
    );
  }
}
