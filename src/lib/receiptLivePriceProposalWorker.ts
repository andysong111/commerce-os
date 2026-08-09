import { loadConfirmedReceiptBatchSource } from "@/lib/confirmedReceiptBatchSource";
import { loadPriceGradeReceiptAugmentedSnapshot } from "@/lib/priceGradeReceiptCacheShadow";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import {
  buildReceiptLivePriceProposal,
  type ReceiptLivePriceEvent,
  type ReceiptLivePriceProposal,
} from "@/lib/receiptLivePriceProposal";
import { loadShoplingCurrentPriceSnapshot } from "@/lib/shopling/shoplingCurrentPrice";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";

const RECEIPT_OPERATION_TYPE = "PRICE_ANALYSIS_FROM_RECEIPT";
const PROPOSAL_OPERATION_TYPE = "RECEIPT_LIVE_SHOPLING_PRICE_PROPOSAL";
const ROLLOUT_OPERATION_TYPE = "RECEIPT_LIVE_PRICE_PROPOSAL_ROLLOUT";
const ROLLOUT_SOURCE_EVENT_ID = "receipt-live-price-proposal-rollout:v1";
const PROPOSAL_SOURCE_PREFIX = "receipt-live-price-proposal:";
const MAX_EVENT_SCAN = 20;

type OperationRow = {
  id?: unknown;
  status?: unknown;
  source_event_id?: unknown;
  correlation_id?: unknown;
  actor_id?: unknown;
  input_snapshot?: unknown;
  result_snapshot?: unknown;
  started_at?: unknown;
};

export type ReceiptLivePriceProposalWorkerResult =
  | {
      processed: false;
      state: "ROLLOUT_INITIALIZED" | "IDLE";
      rolloutStartedAt: string;
      writesEnabled: false;
      message: string;
    }
  | {
      processed: true;
      state: "PROCESSED";
      rolloutStartedAt: string;
      receiptEventId: string;
      proposal: ReceiptLivePriceProposal;
      writesEnabled: false;
      message: string;
    };

export type ReceiptLivePriceProposalStatus = {
  rolloutStartedAt: string | null;
  rolloutReady: boolean;
  pendingReceiptCount: number;
  latestProposal: ReceiptLivePriceProposal | null;
  latestProposalStartedAt: string | null;
  writesEnabled: false;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function barcodeKey(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function nonNegativeInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function iso(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function proposalSourceEventId(receiptEventId: string) {
  return `${PROPOSAL_SOURCE_PREFIX}${receiptEventId}`;
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
  table: string;
  method?: "GET" | "POST";
  query?: URLSearchParams;
  body?: unknown;
  prefer?: string;
}) {
  const { baseUrl, secret } = supabaseConnection();
  const query = input.query ?? new URLSearchParams();
  const headers = createSupabaseAdminHeaders(secret);
  if (input.prefer) headers.Prefer = input.prefer;
  const response = await fetch(
    `${baseUrl}/rest/v1/${encodeURIComponent(input.table)}?${query.toString()}`,
    {
      method: input.method ?? "GET",
      headers,
      body: input.method === "POST" ? JSON.stringify(input.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `RECEIPT_LIVE_PRICE_STORE_FAILED:${input.table}:${response.status}:${body.slice(0, 300)}`,
    );
  }
  return (body ? JSON.parse(body) : null) as T;
}

async function readOperationBySourceEvent(sourceEventId: string) {
  const query = new URLSearchParams({
    source_event_id: `eq.${sourceEventId}`,
    select:
      "id,status,source_event_id,correlation_id,actor_id,input_snapshot,result_snapshot,started_at",
    limit: "1",
  });
  const rows = await rest<OperationRow[]>({
    table: "commerce_operation_runs",
    query,
  });
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

async function ensureRolloutMarker() {
  const existing = await readOperationBySourceEvent(ROLLOUT_SOURCE_EVENT_ID);
  if (existing) {
    const startAt = iso(
      (existing.input_snapshot as Record<string, unknown> | undefined)?.startAt,
    );
    if (!startAt) throw new Error("RECEIPT_LIVE_PRICE_ROLLOUT_MARKER_INVALID");
    return { startAt, created: false };
  }
  const startAt = new Date().toISOString();
  await rest<OperationRow[]>({
    table: "commerce_operation_runs",
    method: "POST",
    query: new URLSearchParams({ on_conflict: "source_event_id" }),
    prefer: "resolution=ignore-duplicates,return=representation",
    body: [
      {
        operation_type: ROLLOUT_OPERATION_TYPE,
        status: "SUCCEEDED",
        source: "ops-center-receipt-live-price-proposal",
        source_event_id: ROLLOUT_SOURCE_EVENT_ID,
        correlation_id: ROLLOUT_SOURCE_EVENT_ID,
        actor_type: "SYSTEM",
        input_snapshot: {
          startAt,
          policy: "new-receipt-events-only",
          automaticShoplingWriteEnabled: false,
        },
        result_snapshot: {
          initialized: true,
          writesEnabled: false,
        },
        started_at: startAt,
        finished_at: startAt,
      },
    ],
  });
  const stored = await readOperationBySourceEvent(ROLLOUT_SOURCE_EVENT_ID);
  const storedStartAt = iso(
    (stored?.input_snapshot as Record<string, unknown> | undefined)?.startAt,
  );
  if (!storedStartAt) throw new Error("RECEIPT_LIVE_PRICE_ROLLOUT_STORE_FAILED");
  return { startAt: storedStartAt, created: storedStartAt === startAt };
}

function parseReceiptEvent(row: OperationRow): ReceiptLivePriceEvent {
  const eventId = text(row.source_event_id);
  const input =
    row.input_snapshot &&
    typeof row.input_snapshot === "object" &&
    !Array.isArray(row.input_snapshot)
      ? (row.input_snapshot as Record<string, unknown>)
      : {};
  const totalsRaw =
    input.totals && typeof input.totals === "object" && !Array.isArray(input.totals)
      ? (input.totals as Record<string, unknown>)
      : {};
  const receiptId = text(input.receiptId);
  const batchId = positiveInteger(input.batchId);
  const occurredAt = iso(input.occurredAt) || iso(row.started_at);
  const barcodes = [
    ...new Set(
      (Array.isArray(input.barcodes) ? input.barcodes : [])
        .map(barcodeKey)
        .filter(Boolean),
    ),
  ].sort();
  if (!eventId || !receiptId || !batchId || !occurredAt || !barcodes.length) {
    throw new Error(`RECEIPT_LIVE_PRICE_EVENT_INVALID:${eventId || "unknown"}`);
  }
  return {
    eventId,
    receiptId,
    batchId,
    occurredAt,
    barcodes,
    totals: {
      good: nonNegativeInteger(totalsRaw.good),
      damaged: nonNegativeInteger(totalsRaw.damaged),
      missing: nonNegativeInteger(totalsRaw.missing),
    },
  };
}

async function receiptOperationsAfter(startAt: string) {
  const query = new URLSearchParams({
    operation_type: `eq.${RECEIPT_OPERATION_TYPE}`,
    started_at: `gt.${startAt}`,
    select:
      "id,status,source_event_id,correlation_id,actor_id,input_snapshot,result_snapshot,started_at",
    order: "started_at.asc",
    limit: String(MAX_EVENT_SCAN),
  });
  const rows = await rest<OperationRow[]>({
    table: "commerce_operation_runs",
    query,
  });
  return Array.isArray(rows) ? rows : [];
}

async function nextPendingReceipt(startAt: string) {
  const rows = await receiptOperationsAfter(startAt);
  for (const row of rows) {
    const sourceEventId = text(row.source_event_id);
    if (!sourceEventId) continue;
    const existing = await readOperationBySourceEvent(
      proposalSourceEventId(sourceEventId),
    );
    if (!existing) return row;
  }
  return null;
}

async function storeProposal(
  eventRow: OperationRow,
  event: ReceiptLivePriceEvent,
  proposal: ReceiptLivePriceProposal,
) {
  const sourceEventId = proposalSourceEventId(event.eventId);
  const storedAt = new Date().toISOString();
  await rest<OperationRow[]>({
    table: "commerce_operation_runs",
    method: "POST",
    query: new URLSearchParams({ on_conflict: "source_event_id" }),
    prefer: "resolution=ignore-duplicates,return=representation",
    body: [
      {
        operation_type: PROPOSAL_OPERATION_TYPE,
        status: "SUCCEEDED",
        source: "ops-center-receipt-live-price-proposal",
        source_event_id: sourceEventId,
        correlation_id: event.eventId,
        actor_type: "SYSTEM",
        actor_id: text(eventRow.actor_id) || null,
        input_snapshot: {
          receiptEventId: event.eventId,
          receiptId: event.receiptId,
          batchId: event.batchId,
          occurredAt: event.occurredAt,
          barcodes: event.barcodes,
          exactReceiptRowCount: proposal.exactReceiptRowCount,
          proposalFingerprint: proposal.fingerprint,
        },
        result_snapshot: proposal,
        started_at: storedAt,
        finished_at: storedAt,
      },
    ],
  });
}

async function buildProposal(event: ReceiptLivePriceEvent) {
  const receiptSource = await loadConfirmedReceiptBatchSource(event.batchId);
  const eventBarcodes = new Set(event.barcodes.map(barcodeKey));
  const foreign = receiptSource.rows
    .map((row) => barcodeKey(row.barcode))
    .find((barcode) => barcode && !eventBarcodes.has(barcode));
  if (foreign) {
    throw new Error(`RECEIPT_LIVE_PRICE_SOURCE_SCOPE_MISMATCH:${foreign}`);
  }
  if (event.totals.good > 0 && !receiptSource.rows.length) {
    throw new Error("RECEIPT_LIVE_PRICE_SOURCE_NOT_READY");
  }

  if (!receiptSource.rows.length) {
    return buildReceiptLivePriceProposal({
      event,
      receiptSource,
      priceInputs: [],
      planningProducts: [],
      livePrices: {
        generatedAt: new Date().toISOString(),
        state: "BLOCKED",
        productCount: 0,
        readyCount: 0,
        missingCount: 0,
        conflictCount: 0,
        queriedGoodsKeyCount: 0,
        sourceRowCount: 0,
        writesEnabled: false,
        rows: [],
      },
    });
  }

  const [augmented, planning] = await Promise.all([
    loadPriceGradeReceiptAugmentedSnapshot(),
    loadProductPlanningSnapshot(),
  ]);
  const affectedBarcodes = new Set(
    receiptSource.rows.map((row) => barcodeKey(row.barcode)).filter(Boolean),
  );
  const affectedPlanning = planning.products.filter(
    (product) =>
      product.skuActive !== false && affectedBarcodes.has(barcodeKey(product.barcode)),
  );
  const livePrices = await loadShoplingCurrentPriceSnapshot(affectedPlanning);
  return buildReceiptLivePriceProposal({
    event,
    receiptSource,
    priceInputs: augmented.snapshot.inputs,
    planningProducts: planning.products,
    livePrices,
  });
}

export async function runReceiptLivePriceProposalStep(): Promise<ReceiptLivePriceProposalWorkerResult> {
  const rollout = await ensureRolloutMarker();
  if (rollout.created) {
    return {
      processed: false,
      state: "ROLLOUT_INITIALIZED",
      rolloutStartedAt: rollout.startAt,
      writesEnabled: false,
      message:
        "입고→LIVE Shopling 가격제안 rollout 기준점을 생성했습니다. 기존 입고 이벤트는 소급 처리하지 않습니다.",
    };
  }
  const eventRow = await nextPendingReceipt(rollout.startAt);
  if (!eventRow) {
    return {
      processed: false,
      state: "IDLE",
      rolloutStartedAt: rollout.startAt,
      writesEnabled: false,
      message: "새 입고확정 이벤트가 없어 LIVE 가격제안 작업을 생략했습니다.",
    };
  }
  const event = parseReceiptEvent(eventRow);
  const proposal = await buildProposal(event);
  await storeProposal(eventRow, event, proposal);
  return {
    processed: true,
    state: "PROCESSED",
    rolloutStartedAt: rollout.startAt,
    receiptEventId: event.eventId,
    proposal,
    writesEnabled: false,
    message: proposal.message,
  };
}

function proposalFromRow(row: OperationRow | undefined) {
  const value = row?.result_snapshot;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const proposal = value as ReceiptLivePriceProposal;
  if (
    !proposal.eventId ||
    !proposal.fingerprint ||
    proposal.writesEnabled !== false ||
    !Array.isArray(proposal.goodsKeyProposals)
  ) {
    return null;
  }
  return proposal;
}

export async function loadReceiptLivePriceProposalStatus(): Promise<ReceiptLivePriceProposalStatus> {
  const rollout = await readOperationBySourceEvent(ROLLOUT_SOURCE_EVENT_ID);
  const rolloutStartedAt = iso(
    (rollout?.input_snapshot as Record<string, unknown> | undefined)?.startAt,
  ) || null;
  let pendingReceiptCount = 0;
  if (rolloutStartedAt) {
    const rows = await receiptOperationsAfter(rolloutStartedAt);
    for (const row of rows) {
      const eventId = text(row.source_event_id);
      if (!eventId) continue;
      if (!(await readOperationBySourceEvent(proposalSourceEventId(eventId)))) {
        pendingReceiptCount += 1;
      }
    }
  }
  const query = new URLSearchParams({
    operation_type: `eq.${PROPOSAL_OPERATION_TYPE}`,
    status: "eq.SUCCEEDED",
    select:
      "id,status,source_event_id,correlation_id,actor_id,input_snapshot,result_snapshot,started_at",
    order: "started_at.desc",
    limit: "1",
  });
  const rows = await rest<OperationRow[]>({
    table: "commerce_operation_runs",
    query,
  });
  const latest = Array.isArray(rows) ? rows[0] : undefined;
  return {
    rolloutStartedAt,
    rolloutReady: Boolean(rolloutStartedAt),
    pendingReceiptCount,
    latestProposal: proposalFromRow(latest),
    latestProposalStartedAt: iso(latest?.started_at) || null,
    writesEnabled: false,
  };
}
