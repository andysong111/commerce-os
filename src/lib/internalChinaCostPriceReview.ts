import { createHash } from "node:crypto";
import { loadInternalChinaDraftWithQuantityOverrides } from "@/lib/internalChinaDraftQuantityOverride";
import { loadInternalChinaPurchaseDraft } from "@/lib/internalChinaPurchaseDraft";
import {
  buildInternalChinaCostPriceDecision,
  costDefensePrice,
  INTERNAL_CHINA_COST_PRICE_RULE_VERSION,
  type InternalChinaCostPriceDirection,
} from "@/lib/internalChinaCostPricePolicy";
import {
  readPriceAdjustmentReceiptCache,
  type PriceAdjustmentReceipt,
} from "@/lib/priceAdjustmentReceiptCache";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { loadShoplingCurrentPriceSnapshot } from "@/lib/shopling/shoplingCurrentPrice";
import type { PlanningProduct } from "@/lib/shopling/shoplingLiveAggregation";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";

export const INTERNAL_CHINA_COST_PRICE_PROPOSAL_OPERATION_TYPE =
  "INTERNAL_CHINA_COST_PRICE_PROPOSAL";
export const INTERNAL_CHINA_COST_PRICE_APPROVAL_OPERATION_TYPE =
  "INTERNAL_CHINA_COST_PRICE_APPROVAL";

const FORWARDER_OPERATION_TYPE = "INTERNAL_CHINA_FORWARDER_COST_CLOSE";
const SOURCE = "ops-center-internal-china-cost-price-review";
const PROPOSAL_PREFIX = "internal-china-cost-price-proposal:";
const APPROVAL_PREFIX = "internal-china-cost-price-approval:";
const MAX_SCAN = 20;

type OperationRow = {
  operation_type?: unknown;
  status?: unknown;
  source_event_id?: unknown;
  correlation_id?: unknown;
  input_snapshot?: unknown;
  result_snapshot?: unknown;
  started_at?: unknown;
};

export type InternalChinaCostPriceReviewRow = {
  barcode: string;
  skuId: string;
  productName: string;
  optionName: string | null;
  goodsKey: string;
  optionId: string;
  productGroup: string;
  ptnGoodsCd: string;
  unitsPerOrder: number;
  currentPrice: number;
  latestCostKrw: number;
  previousCostKrw: number | null;
  costChangeRate: number | null;
  targetPrice: number;
  direction: InternalChinaCostPriceDirection;
  changeRequired: boolean;
  blockedReason: string | null;
  reason: string;
};

export type InternalChinaCostPriceProposal = {
  generatedAt: string;
  draftId: string;
  cycleMonth: string;
  forwarderSourceEventId: string;
  state: "AWAITING_APPROVAL" | "NO_CHANGE" | "BLOCKED";
  ruleVersion: string;
  affectedBarcodeCount: number;
  listingRowCount: number;
  increaseCount: number;
  decreaseCount: number;
  holdCount: number;
  blockedCount: number;
  changedRowCount: number;
  fingerprint: string;
  shoplingWritesEnabled: false;
  rows: InternalChinaCostPriceReviewRow[];
};

export type InternalChinaCostPriceApproval = {
  proposalFingerprint: string;
  proposalSourceEventId: string;
  approvedAt: string;
  approvedChangedRowCount: number;
  shoplingWritesEnabled: false;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function normalizeBarcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function supabaseConnection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return { baseUrl, secret };
}

async function rest<T>(input: {
  method?: "GET" | "POST";
  query: URLSearchParams;
  body?: unknown;
  prefer?: string;
}) {
  const { baseUrl, secret } = supabaseConnection();
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?${input.query.toString()}`,
    {
      method: input.method ?? "GET",
      headers: {
        ...createSupabaseAdminHeaders(secret),
        ...(input.prefer ? { Prefer: input.prefer } : {}),
      },
      body: input.method === "POST" ? JSON.stringify(input.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    },
  );
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(
      `INTERNAL_CHINA_COST_PRICE_STORE_FAILED:${response.status}:${raw.slice(0, 300)}`,
    );
  }
  return (raw ? JSON.parse(raw) : null) as T;
}

function forwarderDraftId(row: OperationRow) {
  const input = object(row.input_snapshot);
  const result = object(row.result_snapshot);
  return text(input.draftId) || text(result.draftId);
}

function forwarderCycleMonth(row: OperationRow) {
  const input = object(row.input_snapshot);
  const result = object(row.result_snapshot);
  return text(input.cycleMonth) || text(result.cycleMonth);
}

function proposalSourceEventId(draftId: string) {
  return `${PROPOSAL_PREFIX}${draftId}`;
}

function approvalSourceEventId(fingerprint: string) {
  return `${APPROVAL_PREFIX}${fingerprint.replace(/^sha256:/, "")}`;
}

function receiptSort(left: PriceAdjustmentReceipt, right: PriceAdjustmentReceipt) {
  const delta = Date.parse(right.receivedAt) - Date.parse(left.receivedAt);
  return delta || right.id.localeCompare(left.id);
}

function latestAndPreviousCost(
  receipts: PriceAdjustmentReceipt[],
  cycleBatchId: number,
) {
  const sorted = [...receipts].sort(receiptSort);
  const current = sorted.filter(
    (row) => row.batchId === cycleBatchId && row.id.startsWith("china-receipt:"),
  );
  const previous = sorted.find(
    (row) => row.batchId !== cycleBatchId && row.unitCostKrw > 0,
  );
  return {
    currentCostKrw: current.length
      ? Math.max(...current.map((row) => integer(row.unitCostKrw)))
      : 0,
    previousCostKrw: previous ? integer(previous.unitCostKrw) : null,
  };
}

function unitsPerOrder(
  product: PlanningProduct,
  goodsKey: string,
  optionId: string,
) {
  const matching = (product.listings ?? []).filter((row) => {
    if (row.active === false || text(row.goodsKey) !== goodsKey) return false;
    const plannedOptionId = text(row.optionId);
    return optionId ? plannedOptionId === optionId : !plannedOptionId;
  });
  if (matching.length !== 1) return 1;
  return Math.max(1, integer(matching[0].unitsPerOrder) || 1);
}

async function latestUnprocessedForwarderClose() {
  const closes = await rest<OperationRow[]>({
    query: new URLSearchParams({
      operation_type: `eq.${FORWARDER_OPERATION_TYPE}`,
      status: "eq.SUCCEEDED",
      select:
        "operation_type,status,source_event_id,correlation_id,input_snapshot,result_snapshot,started_at",
      order: "started_at.asc",
      limit: String(MAX_SCAN),
    }),
  });
  const proposals = await rest<OperationRow[]>({
    query: new URLSearchParams({
      operation_type: `eq.${INTERNAL_CHINA_COST_PRICE_PROPOSAL_OPERATION_TYPE}`,
      select: "source_event_id",
      limit: String(MAX_SCAN * 5),
    }),
  });
  const existing = new Set(
    (Array.isArray(proposals) ? proposals : []).map((row) => text(row.source_event_id)),
  );
  return (
    (Array.isArray(closes) ? closes : []).find((row) => {
      const draftId = forwarderDraftId(row);
      return draftId && !existing.has(proposalSourceEventId(draftId));
    }) ?? null
  );
}

async function buildProposal(
  close: OperationRow,
): Promise<InternalChinaCostPriceProposal> {
  const draftId = forwarderDraftId(close);
  const cycleMonth = forwarderCycleMonth(close);
  if (!draftId || !/^\d{4}-\d{2}$/.test(cycleMonth)) {
    throw new Error("INTERNAL_CHINA_COST_PRICE_FORWARDER_CLOSE_INVALID");
  }

  const draft = await loadInternalChinaDraftWithQuantityOverrides(
    await loadInternalChinaPurchaseDraft(draftId),
  );
  const cache = await readPriceAdjustmentReceiptCache();
  if (!cache) throw new Error("INTERNAL_CHINA_COST_PRICE_RECEIPT_CACHE_REQUIRED");

  const cycleBatchId = Number(cycleMonth.replace("-", ""));
  const affectedBarcodes = new Set<string>();
  const costs = new Map<
    string,
    { latestCostKrw: number; previousCostKrw: number | null }
  >();
  for (const line of draft.lines) {
    const barcode = normalizeBarcode(line.barcode);
    const cost = latestAndPreviousCost(
      cache.receiptsByBarcode[barcode] ?? [],
      cycleBatchId,
    );
    if (cost.currentCostKrw <= 0) continue;
    affectedBarcodes.add(barcode);
    costs.set(barcode, {
      latestCostKrw: cost.currentCostKrw,
      previousCostKrw: cost.previousCostKrw,
    });
  }

  const planning = await loadProductPlanningSnapshot();
  const planningByBarcode = new Map(
    planning.products.map((product) => [normalizeBarcode(product.barcode), product]),
  );
  const affectedPlanning = planning.products.filter(
    (product) =>
      product.skuActive !== false &&
      affectedBarcodes.has(normalizeBarcode(product.barcode)),
  );
  const live = await loadShoplingCurrentPriceSnapshot(affectedPlanning);
  const liveByBarcode = new Map(
    live.rows.map((row) => [normalizeBarcode(row.barcode), row]),
  );
  const rows: InternalChinaCostPriceReviewRow[] = [];

  for (const barcode of [...affectedBarcodes].sort()) {
    const cost = costs.get(barcode)!;
    const product = planningByBarcode.get(barcode);
    const liveRow = liveByBarcode.get(barcode);
    if (!product || !liveRow || liveRow.state !== "READY" || !liveRow.listings.length) {
      rows.push({
        barcode,
        skuId: product?.skuId ?? `sku:${barcode}`,
        productName: product?.productName ?? barcode,
        optionName: product?.optionName ?? null,
        goodsKey: "",
        optionId: "",
        productGroup: "",
        ptnGoodsCd: "",
        unitsPerOrder: 1,
        currentPrice: 0,
        latestCostKrw: cost.latestCostKrw,
        previousCostKrw: cost.previousCostKrw,
        costChangeRate: null,
        targetPrice: costDefensePrice(cost.latestCostKrw),
        direction: "BLOCKED",
        changeRequired: false,
        blockedReason: !product
          ? "PLANNING_PRODUCT_MISSING"
          : "SHOPLING_LIVE_PRICE_NOT_READY",
        reason: !product
          ? "Product Master 계획상품 연결이 없어 가격조정안을 만들지 않았습니다."
          : "Shopling 현재 판매가가 준비되지 않아 가격조정안을 만들지 않았습니다.",
      });
      continue;
    }

    for (const listing of liveRow.listings) {
      const listingUnitsPerOrder = unitsPerOrder(
        product,
        listing.goodsKey,
        listing.optionId,
      );
      const decision = buildInternalChinaCostPriceDecision({
        currentPrice: listing.effectiveSalePrice,
        latestCostKrw: cost.latestCostKrw,
        previousCostKrw: cost.previousCostKrw,
        unitsPerOrder: listingUnitsPerOrder,
      });
      rows.push({
        barcode,
        skuId: product.skuId,
        productName: product.productName,
        optionName: product.optionName ?? null,
        goodsKey: listing.goodsKey,
        optionId: listing.optionId,
        productGroup: listing.productGroup,
        ptnGoodsCd: listing.ptnGoodsCd,
        unitsPerOrder: decision.unitsPerOrder,
        currentPrice: decision.currentPrice,
        latestCostKrw: decision.latestCostKrw,
        previousCostKrw: decision.previousCostKrw,
        costChangeRate: decision.costChangeRate,
        targetPrice: decision.targetPrice,
        direction: decision.direction,
        changeRequired: decision.changeRequired,
        blockedReason: decision.blockedReason,
        reason: decision.reason,
      });
    }
  }

  rows.sort(
    (left, right) =>
      left.barcode.localeCompare(right.barcode) ||
      Number(left.goodsKey || 0) - Number(right.goodsKey || 0) ||
      left.optionId.localeCompare(right.optionId),
  );
  const increaseCount = rows.filter((row) => row.direction === "INCREASE").length;
  const decreaseCount = rows.filter((row) => row.direction === "DECREASE").length;
  const holdCount = rows.filter((row) => row.direction === "HOLD").length;
  const blockedCount = rows.filter((row) => row.direction === "BLOCKED").length;
  const changedRowCount = increaseCount + decreaseCount;
  const stable = {
    draftId,
    cycleMonth,
    forwarderSourceEventId: text(close.source_event_id),
    ruleVersion: INTERNAL_CHINA_COST_PRICE_RULE_VERSION,
    rows: rows.map((row) => ({
      barcode: row.barcode,
      goodsKey: row.goodsKey,
      optionId: row.optionId,
      unitsPerOrder: row.unitsPerOrder,
      currentPrice: row.currentPrice,
      latestCostKrw: row.latestCostKrw,
      previousCostKrw: row.previousCostKrw,
      targetPrice: row.targetPrice,
      direction: row.direction,
      blockedReason: row.blockedReason,
    })),
  };

  return {
    generatedAt: new Date().toISOString(),
    draftId,
    cycleMonth,
    forwarderSourceEventId: text(close.source_event_id),
    state:
      changedRowCount > 0
        ? "AWAITING_APPROVAL"
        : blockedCount > 0
          ? "BLOCKED"
          : "NO_CHANGE",
    ruleVersion: INTERNAL_CHINA_COST_PRICE_RULE_VERSION,
    affectedBarcodeCount: affectedBarcodes.size,
    listingRowCount: rows.length,
    increaseCount,
    decreaseCount,
    holdCount,
    blockedCount,
    changedRowCount,
    fingerprint: sha256(stable),
    shoplingWritesEnabled: false,
    rows,
  };
}

async function storeProposal(proposal: InternalChinaCostPriceProposal) {
  const now = new Date().toISOString();
  await rest<OperationRow[]>({
    method: "POST",
    query: new URLSearchParams({ on_conflict: "source_event_id" }),
    prefer: "resolution=merge-duplicates,return=representation",
    body: [
      {
        operation_type: INTERNAL_CHINA_COST_PRICE_PROPOSAL_OPERATION_TYPE,
        status:
          proposal.state === "AWAITING_APPROVAL"
            ? "AWAITING_APPROVAL"
            : "SUCCEEDED",
        source: SOURCE,
        source_event_id: proposalSourceEventId(proposal.draftId),
        correlation_id: proposal.forwarderSourceEventId,
        actor_type: "SYSTEM",
        input_snapshot: {
          draftId: proposal.draftId,
          cycleMonth: proposal.cycleMonth,
          forwarderSourceEventId: proposal.forwarderSourceEventId,
          ruleVersion: proposal.ruleVersion,
        },
        result_snapshot: proposal,
        error_message: null,
        started_at: now,
        finished_at: now,
        updated_at: now,
      },
    ],
  });
}

function parseProposal(row: OperationRow | null): InternalChinaCostPriceProposal | null {
  const value = object(row?.result_snapshot);
  if (!value.fingerprint || !Array.isArray(value.rows)) return null;
  return value as unknown as InternalChinaCostPriceProposal;
}

export async function runInternalChinaCostPriceProposalStep() {
  const close = await latestUnprocessedForwarderClose();
  if (!close) {
    return {
      processed: false,
      state: "IDLE" as const,
      shoplingWritesEnabled: false as const,
    };
  }
  const proposal = await buildProposal(close);
  await storeProposal(proposal);
  return {
    processed: true,
    state: proposal.state,
    draftId: proposal.draftId,
    changedRowCount: proposal.changedRowCount,
    proposalFingerprint: proposal.fingerprint,
    shoplingWritesEnabled: false as const,
  };
}

export async function loadLatestInternalChinaCostPriceProposal() {
  const rows = await rest<OperationRow[]>({
    query: new URLSearchParams({
      operation_type: `eq.${INTERNAL_CHINA_COST_PRICE_PROPOSAL_OPERATION_TYPE}`,
      select:
        "operation_type,status,source_event_id,correlation_id,input_snapshot,result_snapshot,started_at",
      order: "started_at.desc",
      limit: "1",
    }),
  });
  const row = Array.isArray(rows) ? rows[0] ?? null : null;
  return {
    sourceEventId: text(row?.source_event_id),
    proposal: parseProposal(row),
  };
}

export async function loadInternalChinaCostPriceApproval(
  proposalFingerprint: string,
): Promise<InternalChinaCostPriceApproval | null> {
  if (!proposalFingerprint) return null;
  const rows = await rest<OperationRow[]>({
    query: new URLSearchParams({
      operation_type: `eq.${INTERNAL_CHINA_COST_PRICE_APPROVAL_OPERATION_TYPE}`,
      source_event_id: `eq.${approvalSourceEventId(proposalFingerprint)}`,
      select: "result_snapshot,started_at",
      limit: "1",
    }),
  });
  const row = Array.isArray(rows) ? rows[0] ?? null : null;
  const value = object(row?.result_snapshot);
  return value.proposalFingerprint
    ? (value as unknown as InternalChinaCostPriceApproval)
    : null;
}

export async function approveInternalChinaCostPriceProposal(input: {
  proposalFingerprint?: unknown;
}) {
  const requestedFingerprint = text(input.proposalFingerprint);
  const latest = await loadLatestInternalChinaCostPriceProposal();
  const proposal = latest.proposal;
  if (!proposal || !latest.sourceEventId) {
    throw new Error("INTERNAL_CHINA_COST_PRICE_PROPOSAL_NOT_FOUND");
  }
  if (!requestedFingerprint || requestedFingerprint !== proposal.fingerprint) {
    throw new Error("INTERNAL_CHINA_COST_PRICE_PROPOSAL_STALE");
  }
  if (proposal.state !== "AWAITING_APPROVAL" || proposal.changedRowCount <= 0) {
    throw new Error("INTERNAL_CHINA_COST_PRICE_PROPOSAL_NOT_APPROVABLE");
  }
  const existing = await loadInternalChinaCostPriceApproval(proposal.fingerprint);
  if (existing) return existing;

  const approvedAt = new Date().toISOString();
  const approval: InternalChinaCostPriceApproval = {
    proposalFingerprint: proposal.fingerprint,
    proposalSourceEventId: latest.sourceEventId,
    approvedAt,
    approvedChangedRowCount: proposal.changedRowCount,
    shoplingWritesEnabled: false,
  };
  await rest<OperationRow[]>({
    method: "POST",
    query: new URLSearchParams({ on_conflict: "source_event_id" }),
    prefer: "resolution=ignore-duplicates,return=representation",
    body: [
      {
        operation_type: INTERNAL_CHINA_COST_PRICE_APPROVAL_OPERATION_TYPE,
        status: "SUCCEEDED",
        source: SOURCE,
        source_event_id: approvalSourceEventId(proposal.fingerprint),
        correlation_id: latest.sourceEventId,
        actor_type: "OPS_OPERATOR",
        input_snapshot: {
          proposalFingerprint: proposal.fingerprint,
          proposalSourceEventId: latest.sourceEventId,
        },
        result_snapshot: approval,
        error_message: null,
        started_at: approvedAt,
        finished_at: approvedAt,
        updated_at: approvedAt,
      },
    ],
  });
  return approval;
}
