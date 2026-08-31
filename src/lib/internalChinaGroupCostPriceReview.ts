import { createHash } from "node:crypto";
import {
  loadLatestInternalChinaCostPriceProposal,
  type InternalChinaCostPriceProposal,
} from "@/lib/internalChinaCostPriceReview";
import {
  buildInternalChinaGroupCostPriceDecision,
  INTERNAL_CHINA_GROUP_COST_PRICE_RULE_VERSION,
} from "@/lib/internalChinaGroupCostPricePolicy";
import { shoplingSaleStatusActive } from "@/lib/internalChinaShoplingSaleStatus";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { loadShoplingCurrentPriceSnapshot } from "@/lib/shopling/shoplingCurrentPrice";
import {
  loadShoplingProductGroupsByGoodsKey,
  resolveInternalPriceGroup,
} from "@/lib/shopling/shoplingProductGroupRegistry";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";

export const INTERNAL_CHINA_GROUP_COST_PRICE_PROPOSAL_OPERATION_TYPE =
  "INTERNAL_CHINA_GROUP_COST_PRICE_PROPOSAL";
export const INTERNAL_CHINA_GROUP_COST_PRICE_APPROVAL_OPERATION_TYPE =
  "INTERNAL_CHINA_GROUP_COST_PRICE_APPROVAL";

const SOURCE = "ops-center-internal-china-group-cost-price-review";
const PROPOSAL_PREFIX = "internal-china-group-cost-price-proposal:v2:";
const APPROVAL_PREFIX = "internal-china-group-cost-price-approval:v2:";

type OperationRow = {
  operation_type?: unknown;
  status?: unknown;
  source_event_id?: unknown;
  correlation_id?: unknown;
  result_snapshot?: unknown;
  started_at?: unknown;
};

export type InternalChinaGroupCostPriceReviewRow = {
  barcode: string;
  skuId: string;
  productName: string;
  optionName: string | null;
  goodsKey: string;
  optionId: string;
  ptnGoodsCd: string;
  unitsPerOrder: number;
  currentPrice: number;
  latestCostKrw: number;
  previousCostKrw: number | null;
  costChangeRate: number | null;
  productGroup: string;
  productGroupSource: "OPS_REGISTRY" | "EXACT_LISTING_GROUP" | "UNRESOLVED";
  groupMultiplier: number | null;
  targetPrice: number;
  mallTargets: {
    mallKey: string;
    mallName: string;
    targetPrice: number;
    policyMultiplier: number;
    policyAddKrw: number;
  }[];
  saleStatus: string;
  saleStatusActive: boolean | null;
  direction: "INCREASE" | "DECREASE" | "HOLD" | "BLOCKED";
  changeRequired: boolean;
  blockedReason: string | null;
  reason: string;
};

export type InternalChinaGroupCostPriceProposal = {
  generatedAt: string;
  draftId: string;
  cycleMonth: string;
  v1ProposalFingerprint: string;
  state: "AWAITING_APPROVAL" | "NO_CHANGE" | "BLOCKED";
  ruleVersion: string;
  affectedBarcodeCount: number;
  listingRowCount: number;
  increaseCount: number;
  decreaseCount: number;
  holdCount: number;
  blockedCount: number;
  unresolvedGroupCount: number;
  inactiveListingCount: number;
  liveListingMissingCount: number;
  changedRowCount: number;
  fingerprint: string;
  shoplingWritesEnabled: false;
  rows: InternalChinaGroupCostPriceReviewRow[];
};

export type InternalChinaGroupCostPriceApproval = {
  proposalFingerprint: string;
  proposalSourceEventId: string;
  approvedAt: string;
  approvedChangedRowCount: number;
  excludedBlockedRowCount: number;
  excludedUnresolvedGroupCount: number;
  ruleVersion: string;
  shoplingWritesEnabled: false;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function normalizeBarcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function connection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return { baseUrl, secret };
}

async function rest<T>(input: {
  method?: "GET" | "POST" | "PATCH";
  query: URLSearchParams;
  body?: unknown;
  prefer?: string;
}) {
  const { baseUrl, secret } = connection();
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?${input.query.toString()}`,
    {
      method: input.method ?? "GET",
      headers: {
        ...createSupabaseAdminHeaders(secret),
        ...(input.prefer ? { Prefer: input.prefer } : {}),
      },
      body: input.method && input.method !== "GET" ? JSON.stringify(input.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    },
  );
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(
      `INTERNAL_CHINA_GROUP_COST_PRICE_STORE_FAILED:${response.status}:${raw.slice(0, 300)}`,
    );
  }
  return (raw ? JSON.parse(raw) : null) as T;
}

function proposalSourceEventId(draftId: string) {
  return `${PROPOSAL_PREFIX}${draftId}`;
}

function approvalSourceEventId(fingerprint: string) {
  return `${APPROVAL_PREFIX}${fingerprint.replace(/^sha256:/, "")}`;
}

function parseProposal(row: OperationRow | undefined) {
  const value = object(row?.result_snapshot);
  if (
    value.ruleVersion !== INTERNAL_CHINA_GROUP_COST_PRICE_RULE_VERSION ||
    !value.fingerprint ||
    !Array.isArray(value.rows)
  ) {
    return null;
  }
  return value as unknown as InternalChinaGroupCostPriceProposal;
}

function listingKey(barcode: unknown, goodsKey: unknown, optionId: unknown) {
  return `${normalizeBarcode(barcode)}|${text(goodsKey)}|${text(optionId)}`;
}

function approvableChangedRows(proposal: InternalChinaGroupCostPriceProposal) {
  return proposal.rows.filter(
    (row) =>
      row.changeRequired &&
      !row.blockedReason &&
      row.productGroupSource !== "UNRESOLVED" &&
      Boolean(row.goodsKey) &&
      row.saleStatusActive === true,
  );
}

async function loadLiveListingStatuses(v1: InternalChinaCostPriceProposal) {
  const affectedBarcodes = new Set(v1.rows.map((row) => normalizeBarcode(row.barcode)));
  const planning = await loadProductPlanningSnapshot();
  const affectedPlanning = planning.products.filter(
    (product) =>
      product.skuActive !== false && affectedBarcodes.has(normalizeBarcode(product.barcode)),
  );
  const live = await loadShoplingCurrentPriceSnapshot(affectedPlanning);
  const result = new Map<string, { saleStatus: string; active: boolean }>();
  for (const row of live.rows) {
    for (const listing of row.listings) {
      const saleStatus = text(listing.saleStatus);
      result.set(listingKey(row.barcode, listing.goodsKey, listing.optionId), {
        saleStatus,
        active: shoplingSaleStatusActive(saleStatus),
      });
    }
  }
  return result;
}

export async function buildInternalChinaGroupCostPriceProposal(
  v1: InternalChinaCostPriceProposal,
): Promise<InternalChinaGroupCostPriceProposal> {
  const goodsKeys = v1.rows.map((row) => row.goodsKey).filter(Boolean);
  const [registry, liveStatuses] = await Promise.all([
    loadShoplingProductGroupsByGoodsKey(goodsKeys),
    loadLiveListingStatuses(v1),
  ]);
  const rows: InternalChinaGroupCostPriceReviewRow[] = v1.rows.map((row) => {
    const resolution = resolveInternalPriceGroup({
      goodsKey: row.goodsKey,
      listingProductGroup: row.productGroup,
      registry,
    });
    const decision = buildInternalChinaGroupCostPriceDecision({
      currentPrice: row.currentPrice,
      latestCostKrw: row.latestCostKrw,
      previousCostKrw: row.previousCostKrw,
      unitsPerOrder: row.unitsPerOrder,
      productGroup: resolution.group,
    });
    const liveStatus = row.goodsKey
      ? liveStatuses.get(listingKey(row.barcode, row.goodsKey, row.optionId)) ?? null
      : null;
    const liveMissing = Boolean(row.goodsKey && !liveStatus);
    const liveInactive = Boolean(row.goodsKey && liveStatus && !liveStatus.active);
    const blockedReason = liveMissing
      ? "SHOPLING_LIVE_LISTING_NOT_FOUND"
      : liveInactive
        ? "SHOPLING_SALE_STATUS_INACTIVE"
        : decision.blockedReason;
    const reason = liveMissing
      ? "Shopling 실조회에서 현재 GOODSKEY/옵션을 다시 찾지 못해 가격조정 대상에서 제외했습니다."
      : liveInactive
        ? `Shopling sale_status=${liveStatus?.saleStatus || "(빈값)"}로 현재 판매중이 아니어서 가격조정 대상에서 제외했습니다.`
        : decision.reason;
    return {
      barcode: row.barcode,
      skuId: row.skuId,
      productName: row.productName,
      optionName: row.optionName,
      goodsKey: row.goodsKey,
      optionId: row.optionId,
      ptnGoodsCd: row.ptnGoodsCd,
      unitsPerOrder: decision.unitsPerOrder,
      currentPrice: decision.currentPrice,
      latestCostKrw: decision.latestCostKrw,
      previousCostKrw: decision.previousCostKrw,
      costChangeRate: decision.costChangeRate,
      productGroup: decision.productGroup ?? "",
      productGroupSource: resolution.source,
      groupMultiplier: decision.groupMultiplier,
      targetPrice: decision.targetPrice,
      mallTargets: decision.mallTargets,
      saleStatus: liveStatus?.saleStatus ?? "",
      saleStatusActive: row.goodsKey ? (liveStatus ? liveStatus.active : false) : null,
      direction: liveMissing || liveInactive ? "BLOCKED" : decision.direction,
      changeRequired: liveMissing || liveInactive ? false : decision.changeRequired,
      blockedReason,
      reason,
    };
  });

  const increaseCount = rows.filter((row) => row.direction === "INCREASE").length;
  const decreaseCount = rows.filter((row) => row.direction === "DECREASE").length;
  const holdCount = rows.filter((row) => row.direction === "HOLD").length;
  const blockedCount = rows.filter((row) => row.direction === "BLOCKED").length;
  const unresolvedGroupCount = rows.filter(
    (row) =>
      row.goodsKey &&
      row.saleStatusActive === true &&
      row.blockedReason === "PRODUCT_GROUP_NOT_RESOLVED",
  ).length;
  const inactiveListingCount = rows.filter(
    (row) => row.blockedReason === "SHOPLING_SALE_STATUS_INACTIVE",
  ).length;
  const liveListingMissingCount = rows.filter(
    (row) => row.blockedReason === "SHOPLING_LIVE_LISTING_NOT_FOUND",
  ).length;
  const changedRowCount = increaseCount + decreaseCount;
  const managedListingCount = increaseCount + decreaseCount + holdCount;
  const stable = {
    draftId: v1.draftId,
    cycleMonth: v1.cycleMonth,
    v1ProposalFingerprint: v1.fingerprint,
    ruleVersion: INTERNAL_CHINA_GROUP_COST_PRICE_RULE_VERSION,
    rows: rows.map((row) => ({
      barcode: row.barcode,
      goodsKey: row.goodsKey,
      optionId: row.optionId,
      productGroup: row.productGroup,
      productGroupSource: row.productGroupSource,
      groupMultiplier: row.groupMultiplier,
      unitsPerOrder: row.unitsPerOrder,
      currentPrice: row.currentPrice,
      latestCostKrw: row.latestCostKrw,
      previousCostKrw: row.previousCostKrw,
      targetPrice: row.targetPrice,
      mallTargets: row.mallTargets,
      saleStatus: row.saleStatus,
      saleStatusActive: row.saleStatusActive,
      direction: row.direction,
      blockedReason: row.blockedReason,
    })),
  };

  return {
    generatedAt: new Date().toISOString(),
    draftId: v1.draftId,
    cycleMonth: v1.cycleMonth,
    v1ProposalFingerprint: v1.fingerprint,
    state:
      changedRowCount > 0
        ? "AWAITING_APPROVAL"
        : managedListingCount > 0
          ? "NO_CHANGE"
          : blockedCount > 0
            ? "BLOCKED"
            : "NO_CHANGE",
    ruleVersion: INTERNAL_CHINA_GROUP_COST_PRICE_RULE_VERSION,
    affectedBarcodeCount: new Set(rows.map((row) => row.barcode)).size,
    listingRowCount: rows.length,
    increaseCount,
    decreaseCount,
    holdCount,
    blockedCount,
    unresolvedGroupCount,
    inactiveListingCount,
    liveListingMissingCount,
    changedRowCount,
    fingerprint: sha256(stable),
    shoplingWritesEnabled: false,
    rows,
  };
}

async function storeProposal(proposal: InternalChinaGroupCostPriceProposal) {
  const now = new Date().toISOString();
  await rest<OperationRow[]>({
    method: "POST",
    query: new URLSearchParams({ on_conflict: "source_event_id" }),
    prefer: "resolution=merge-duplicates,return=representation",
    body: [
      {
        operation_type: INTERNAL_CHINA_GROUP_COST_PRICE_PROPOSAL_OPERATION_TYPE,
        status:
          proposal.state === "AWAITING_APPROVAL"
            ? "AWAITING_APPROVAL"
            : proposal.state === "BLOCKED"
              ? "FAILED"
              : "SUCCEEDED",
        source: SOURCE,
        source_event_id: proposalSourceEventId(proposal.draftId),
        correlation_id: `internal-china-cost-price-proposal:${proposal.draftId}`,
        actor_type: "SYSTEM",
        actor_id: "ops-dispatcher",
        input_snapshot: {
          draftId: proposal.draftId,
          cycleMonth: proposal.cycleMonth,
          v1ProposalFingerprint: proposal.v1ProposalFingerprint,
          ruleVersion: proposal.ruleVersion,
        },
        result_snapshot: proposal,
        error_message:
          proposal.state === "BLOCKED"
            ? proposal.unresolvedGroupCount > 0
              ? `NO_MANAGED_PRICE_ROWS:PRODUCT_GROUP_NOT_RESOLVED:${proposal.unresolvedGroupCount}`
              : `PRICE_REVIEW_BLOCKED:${proposal.blockedCount}`
            : null,
        started_at: proposal.generatedAt,
        finished_at: now,
        updated_at: now,
      },
    ],
  });
}

export async function regenerateLatestInternalChinaGroupCostPriceProposal() {
  const latest = await loadLatestInternalChinaCostPriceProposal();
  if (!latest.proposal) {
    throw new Error("INTERNAL_CHINA_V1_COST_PRICE_PROPOSAL_NOT_FOUND");
  }
  const proposal = await buildInternalChinaGroupCostPriceProposal(latest.proposal);
  await storeProposal(proposal);
  return proposal;
}

export async function runInternalChinaGroupCostPriceProposalStep() {
  const latest = await loadLatestInternalChinaCostPriceProposal();
  if (!latest.proposal) return { processed: false, state: "IDLE" as const };
  const sourceEventId = proposalSourceEventId(latest.proposal.draftId);
  const existing = await rest<OperationRow[]>({
    query: new URLSearchParams({
      operation_type: `eq.${INTERNAL_CHINA_GROUP_COST_PRICE_PROPOSAL_OPERATION_TYPE}`,
      source_event_id: `eq.${sourceEventId}`,
      select: "source_event_id,result_snapshot,started_at",
      limit: "1",
    }),
  });
  const existingProposal = parseProposal(existing?.[0]);
  if (
    existingProposal &&
    existingProposal.v1ProposalFingerprint === latest.proposal.fingerprint
  ) {
    return {
      processed: false,
      state: existingProposal.state,
      proposalFingerprint: existingProposal.fingerprint,
    };
  }
  const proposal = await buildInternalChinaGroupCostPriceProposal(latest.proposal);
  await storeProposal(proposal);
  return {
    processed: true,
    state: proposal.state,
    proposalFingerprint: proposal.fingerprint,
    unresolvedGroupCount: proposal.unresolvedGroupCount,
    inactiveListingCount: proposal.inactiveListingCount,
    liveListingMissingCount: proposal.liveListingMissingCount,
    shoplingWritesEnabled: false as const,
  };
}

export async function loadLatestInternalChinaGroupCostPriceProposal() {
  const rows = await rest<OperationRow[]>({
    query: new URLSearchParams({
      operation_type: `eq.${INTERNAL_CHINA_GROUP_COST_PRICE_PROPOSAL_OPERATION_TYPE}`,
      select: "operation_type,status,source_event_id,correlation_id,result_snapshot,started_at",
      order: "started_at.desc",
      limit: "1",
    }),
  });
  const row = rows?.[0];
  return {
    sourceEventId: text(row?.source_event_id),
    proposal: parseProposal(row),
  };
}

export async function loadInternalChinaGroupCostPriceApproval(
  proposalFingerprint: string,
): Promise<InternalChinaGroupCostPriceApproval | null> {
  if (!proposalFingerprint) return null;
  const rows = await rest<OperationRow[]>({
    query: new URLSearchParams({
      operation_type: `eq.${INTERNAL_CHINA_GROUP_COST_PRICE_APPROVAL_OPERATION_TYPE}`,
      source_event_id: `eq.${approvalSourceEventId(proposalFingerprint)}`,
      select: "result_snapshot",
      limit: "1",
    }),
  });
  const value = object(rows?.[0]?.result_snapshot);
  return value.proposalFingerprint
    ? (value as unknown as InternalChinaGroupCostPriceApproval)
    : null;
}

export async function approveInternalChinaGroupCostPriceProposal(input: {
  proposalFingerprint?: unknown;
}) {
  const requestedFingerprint = text(input.proposalFingerprint);
  const latest = await loadLatestInternalChinaGroupCostPriceProposal();
  const proposal = latest.proposal;
  if (!proposal) throw new Error("INTERNAL_CHINA_GROUP_COST_PRICE_PROPOSAL_NOT_FOUND");
  if (
    proposal.ruleVersion !== INTERNAL_CHINA_GROUP_COST_PRICE_RULE_VERSION ||
    proposal.fingerprint !== requestedFingerprint
  ) {
    throw new Error("INTERNAL_CHINA_GROUP_COST_PRICE_PROPOSAL_STALE");
  }
  if (proposal.state !== "AWAITING_APPROVAL" || proposal.changedRowCount <= 0) {
    throw new Error("INTERNAL_CHINA_GROUP_COST_PRICE_PROPOSAL_NOT_APPROVABLE");
  }
  const approvedRows = approvableChangedRows(proposal);
  if (approvedRows.length !== proposal.changedRowCount) {
    throw new Error("INTERNAL_CHINA_GROUP_COST_PRICE_APPROVAL_SCOPE_MISMATCH");
  }

  const now = new Date().toISOString();
  const approval: InternalChinaGroupCostPriceApproval = {
    proposalFingerprint: proposal.fingerprint,
    proposalSourceEventId: latest.sourceEventId,
    approvedAt: now,
    approvedChangedRowCount: approvedRows.length,
    excludedBlockedRowCount: proposal.blockedCount,
    excludedUnresolvedGroupCount: proposal.unresolvedGroupCount,
    ruleVersion: proposal.ruleVersion,
    shoplingWritesEnabled: false,
  };
  await rest<OperationRow[]>({
    method: "POST",
    query: new URLSearchParams({ on_conflict: "source_event_id" }),
    prefer: "resolution=merge-duplicates,return=representation",
    body: [
      {
        operation_type: INTERNAL_CHINA_GROUP_COST_PRICE_APPROVAL_OPERATION_TYPE,
        status: "SUCCEEDED",
        source: SOURCE,
        source_event_id: approvalSourceEventId(proposal.fingerprint),
        correlation_id: latest.sourceEventId,
        actor_type: "USER",
        actor_id: "ops-center",
        input_snapshot: {
          proposalFingerprint: proposal.fingerprint,
          ruleVersion: proposal.ruleVersion,
        },
        result_snapshot: approval,
        started_at: now,
        finished_at: now,
        updated_at: now,
      },
    ],
  });
  return approval;
}