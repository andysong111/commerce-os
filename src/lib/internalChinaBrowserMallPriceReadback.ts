import {
  buildInternalChinaDirectTargetExecutionPlan,
  loadInternalChinaDirectTargetExecution,
  type InternalChinaDirectTargetExecutionRow,
} from "@/lib/internalChinaGroupCostPriceExecution";
import { loadLatestInternalChinaGroupCostPriceProposal } from "@/lib/internalChinaGroupCostPriceReview";
import { INTERNAL_PRICE_GROUP_MALLS } from "@/lib/internalChinaPriceGroupPolicy";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const INTERNAL_CHINA_BROWSER_PRICE_READBACK_OPERATION_TYPE =
  "INTERNAL_CHINA_GROUP_COST_PRICE_BROWSER_READBACK";
export const INTERNAL_CHINA_BROWSER_PRICE_READBACK_ITEM_OPERATION_TYPE =
  "INTERNAL_CHINA_GROUP_COST_PRICE_BROWSER_READBACK_ITEM";
export const INTERNAL_CHINA_BROWSER_PRICE_READBACK_BRIDGE = "price-readback-v1";

const SOURCE = "ops-center-shopling-browser-price-readback";
const RUN_PREFIX = "internal-china-browser-price-readback:v1:";
const ITEM_PREFIX = "internal-china-browser-price-readback-item:v1:";
const DEFAULT_NOT_BEFORE_MS = 2 * 60_000;
const STALE_CLAIM_MS = 5 * 60_000;
const MAX_OBSERVED_ROWS = 64;

type OperationRow = {
  id?: unknown;
  operation_type?: unknown;
  status?: unknown;
  source_event_id?: unknown;
  correlation_id?: unknown;
  input_snapshot?: unknown;
  result_snapshot?: unknown;
  error_message?: unknown;
  started_at?: unknown;
  updated_at?: unknown;
};

export type BrowserMallTarget = {
  mallKey: string;
  mallName: string;
  targetSellPrice: number;
  expectedPurchasePrice: number;
  expectedConsumerPrice: number;
};

export type BrowserPriceReadbackTask = {
  taskId: string;
  proposalFingerprint: string;
  goodsKey: string;
  productGroup: string;
  targetSellPrice: number;
  mallTargets: BrowserMallTarget[];
};

export type BrowserObservedMallPrice = {
  mallKey: string;
  mallName?: string;
  sellPrice: number;
  purchasePrice: number;
  consumerPrice: number;
  accountLabel?: string;
  rowIndex?: number;
  source?: string;
};

export type BrowserPriceReadbackSummary = {
  state: "NOT_STARTED" | "QUEUED" | "RUNNING" | "VERIFIED" | "PARTIAL_FAILURE";
  proposalFingerprint: string;
  goodsKeyCount: number;
  pendingCount: number;
  runningCount: number;
  verifiedGoodsKeyCount: number;
  failedGoodsKeyCount: number;
  mallCheckCount: number;
  mallMatchCount: number;
  mallMismatchCount: number;
  mallMissingCount: number;
  readOnly: true;
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

function fingerprintHex(value: string) {
  const normalized = text(value).replace(/^sha256:/, "");
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("INTERNAL_CHINA_BROWSER_PRICE_READBACK_FINGERPRINT_INVALID");
  }
  return normalized;
}

function runSourceEventId(fingerprint: string) {
  return `${RUN_PREFIX}${fingerprintHex(fingerprint)}`;
}

function correlationId(fingerprint: string) {
  return runSourceEventId(fingerprint);
}

function itemSourceEventId(fingerprint: string, goodsKey: string) {
  return `${ITEM_PREFIX}${fingerprintHex(fingerprint)}:${goodsKey}`;
}

function expectedPurchasePrice(sellPrice: number) {
  return Math.floor(sellPrice / 2);
}

function expectedConsumerPrice(sellPrice: number) {
  return Math.floor((sellPrice * 3) / 2);
}

const mallNameByKey = new Map<string, string>();
for (const policies of Object.values(INTERNAL_PRICE_GROUP_MALLS)) {
  for (const policy of policies) mallNameByKey.set(policy.mallKey, policy.mallName);
}

function queueInput(
  proposalFingerprint: string,
  row: InternalChinaDirectTargetExecutionRow,
  notBefore: string,
) {
  return {
    proposalFingerprint,
    goodsKey: row.goodsKey,
    productGroup: row.productGroup,
    targetSellPrice: row.targetSellPrice,
    mallTargets: row.mallTargets.map((mall) => ({
      mallKey: mall.mallKey,
      mallName: mallNameByKey.get(mall.mallKey) || mall.mallKey,
      targetSellPrice: mall.targetSellPrice,
      expectedPurchasePrice: expectedPurchasePrice(mall.targetSellPrice),
      expectedConsumerPrice: expectedConsumerPrice(mall.targetSellPrice),
    })),
    notBefore,
    readOnly: true,
    shoplingWritesEnabled: false,
  };
}

async function adminClient() {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_UNAVAILABLE");
  return admin;
}

function sanitizeObservedRows(value: unknown): BrowserObservedMallPrice[] {
  if (!Array.isArray(value)) return [];
  const rows: BrowserObservedMallPrice[] = [];
  for (const item of value.slice(0, MAX_OBSERVED_ROWS)) {
    const row = object(item);
    const mallKey = text(row.mallKey);
    if (!/^SMALL_\d{5}$/.test(mallKey)) continue;
    rows.push({
      mallKey,
      mallName: text(row.mallName).slice(0, 80) || undefined,
      sellPrice: integer(row.sellPrice),
      purchasePrice: integer(row.purchasePrice),
      consumerPrice: integer(row.consumerPrice),
      accountLabel: text(row.accountLabel).slice(0, 120) || undefined,
      rowIndex: integer(row.rowIndex) || undefined,
      source: text(row.source).slice(0, 60) || undefined,
    });
  }
  return rows;
}

function parseTask(row: OperationRow): BrowserPriceReadbackTask | null {
  const input = object(row.input_snapshot);
  const taskId = text(row.id);
  const proposalFingerprint = text(input.proposalFingerprint);
  const goodsKey = text(input.goodsKey);
  const productGroup = text(input.productGroup);
  const targetSellPrice = integer(input.targetSellPrice);
  const mallTargets = Array.isArray(input.mallTargets)
    ? input.mallTargets
        .map((value) => object(value))
        .map((target) => ({
          mallKey: text(target.mallKey),
          mallName: text(target.mallName),
          targetSellPrice: integer(target.targetSellPrice),
          expectedPurchasePrice: integer(target.expectedPurchasePrice),
          expectedConsumerPrice: integer(target.expectedConsumerPrice),
        }))
        .filter(
          (target) =>
            /^SMALL_\d{5}$/.test(target.mallKey) &&
            target.targetSellPrice > 0 &&
            target.expectedPurchasePrice > 0 &&
            target.expectedConsumerPrice > 0,
        )
    : [];
  if (
    !taskId ||
    !proposalFingerprint ||
    !/^\d{5,9}$/.test(goodsKey) ||
    !productGroup ||
    targetSellPrice <= 0 ||
    mallTargets.length === 0
  ) {
    return null;
  }
  return {
    taskId,
    proposalFingerprint,
    goodsKey,
    productGroup,
    targetSellPrice,
    mallTargets,
  };
}

function summarizeRows(
  proposalFingerprint: string,
  rows: OperationRow[],
): BrowserPriceReadbackSummary {
  const pendingCount = rows.filter((row) => text(row.status) === "PENDING").length;
  const runningCount = rows.filter((row) => text(row.status) === "RUNNING").length;
  const verifiedGoodsKeyCount = rows.filter((row) => text(row.status) === "SUCCEEDED").length;
  const failedGoodsKeyCount = rows.filter((row) => text(row.status) === "FAILED").length;
  let mallCheckCount = 0;
  let mallMatchCount = 0;
  let mallMismatchCount = 0;
  let mallMissingCount = 0;
  for (const row of rows) {
    const input = object(row.input_snapshot);
    const result = object(row.result_snapshot);
    mallCheckCount += Array.isArray(input.mallTargets) ? input.mallTargets.length : 0;
    mallMatchCount += integer(result.mallMatchCount);
    mallMismatchCount += integer(result.mallMismatchCount);
    mallMissingCount += integer(result.mallMissingCount);
  }
  let state: BrowserPriceReadbackSummary["state"] = "NOT_STARTED";
  if (rows.length) {
    if (pendingCount || runningCount) state = runningCount ? "RUNNING" : "QUEUED";
    else if (failedGoodsKeyCount) state = "PARTIAL_FAILURE";
    else state = "VERIFIED";
  }
  return {
    state,
    proposalFingerprint,
    goodsKeyCount: rows.length,
    pendingCount,
    runningCount,
    verifiedGoodsKeyCount,
    failedGoodsKeyCount,
    mallCheckCount,
    mallMatchCount,
    mallMismatchCount,
    mallMissingCount,
    readOnly: true,
    shoplingWritesEnabled: false,
  };
}

async function loadItemRows(proposalFingerprint: string) {
  const admin = await adminClient();
  const result = await admin
    .from("commerce_operation_runs")
    .select(
      "id,operation_type,status,source_event_id,correlation_id,input_snapshot,result_snapshot,error_message,started_at,updated_at",
    )
    .eq("operation_type", INTERNAL_CHINA_BROWSER_PRICE_READBACK_ITEM_OPERATION_TYPE)
    .eq("correlation_id", correlationId(proposalFingerprint))
    .order("started_at", { ascending: true })
    .limit(1000);
  if (result.error) {
    throw new Error(`INTERNAL_CHINA_BROWSER_PRICE_READBACK_LOAD_FAILED:${result.error.message}`);
  }
  return (Array.isArray(result.data) ? result.data : []) as OperationRow[];
}

async function refreshRunStatus(proposalFingerprint: string) {
  const admin = await adminClient();
  const rows = await loadItemRows(proposalFingerprint);
  const summary = summarizeRows(proposalFingerprint, rows);
  const status =
    summary.state === "VERIFIED"
      ? "SUCCEEDED"
      : summary.state === "PARTIAL_FAILURE"
        ? "FAILED"
        : summary.state === "NOT_STARTED"
          ? "PENDING"
          : "RUNNING";
  const now = new Date().toISOString();
  const update = await admin
    .from("commerce_operation_runs")
    .update({
      status,
      result_snapshot: summary,
      error_message:
        status === "FAILED"
          ? `Browser mall-price verification failed for ${summary.failedGoodsKeyCount} goods keys.`
          : null,
      ...(status === "SUCCEEDED" || status === "FAILED" ? { finished_at: now } : {}),
      updated_at: now,
    })
    .eq("operation_type", INTERNAL_CHINA_BROWSER_PRICE_READBACK_OPERATION_TYPE)
    .eq("source_event_id", runSourceEventId(proposalFingerprint));
  if (update.error) {
    throw new Error(`INTERNAL_CHINA_BROWSER_PRICE_READBACK_RUN_UPDATE_FAILED:${update.error.message}`);
  }
  return summary;
}

export async function ensureInternalChinaBrowserMallPriceReadback(input?: {
  proposalFingerprint?: unknown;
  delayMs?: number;
  retryFailed?: boolean;
}) {
  const requestedFingerprint = text(input?.proposalFingerprint);
  const latest = await loadLatestInternalChinaGroupCostPriceProposal();
  const proposal = latest.proposal;
  if (!proposal) throw new Error("INTERNAL_CHINA_BROWSER_PRICE_READBACK_PROPOSAL_NOT_FOUND");
  if (requestedFingerprint && proposal.fingerprint !== requestedFingerprint) {
    throw new Error("INTERNAL_CHINA_BROWSER_PRICE_READBACK_PROPOSAL_STALE");
  }
  const execution = await loadInternalChinaDirectTargetExecution(proposal.fingerprint);
  if (!execution?.shoplingWritesDispatched) {
    throw new Error("INTERNAL_CHINA_BROWSER_PRICE_READBACK_APPLY_REQUIRED");
  }
  const plan = buildInternalChinaDirectTargetExecutionPlan(proposal);
  const admin = await adminClient();
  const now = new Date().toISOString();
  const requestedDelay = Number(input?.delayMs);
  const delayMs = Number.isFinite(requestedDelay)
    ? Math.max(0, Math.min(Math.floor(requestedDelay), 10 * 60_000))
    : DEFAULT_NOT_BEFORE_MS;
  const notBefore = new Date(Date.now() + delayMs).toISOString();

  const runUpsert = await admin.from("commerce_operation_runs").upsert(
    [
      {
        operation_type: INTERNAL_CHINA_BROWSER_PRICE_READBACK_OPERATION_TYPE,
        status: "PENDING",
        source: SOURCE,
        source_event_id: runSourceEventId(proposal.fingerprint),
        correlation_id: correlationId(proposal.fingerprint),
        actor_type: "SYSTEM",
        actor_id: "ops-price-readback-browser",
        input_snapshot: {
          proposalFingerprint: proposal.fingerprint,
          goodsKeyCount: plan.goodsKeyCount,
          mallCheckCount: plan.rows.reduce((sum, row) => sum + row.mallTargets.length, 0),
          readOnly: true,
          shoplingWritesEnabled: false,
        },
        result_snapshot: {},
        error_message: null,
        started_at: now,
        finished_at: null,
        updated_at: now,
      },
    ],
    { onConflict: "source_event_id", ignoreDuplicates: true },
  );
  if (runUpsert.error) {
    throw new Error(`INTERNAL_CHINA_BROWSER_PRICE_READBACK_RUN_CREATE_FAILED:${runUpsert.error.message}`);
  }

  const itemRows = plan.rows.map((row) => ({
    operation_type: INTERNAL_CHINA_BROWSER_PRICE_READBACK_ITEM_OPERATION_TYPE,
    status: "PENDING",
    source: SOURCE,
    source_event_id: itemSourceEventId(proposal.fingerprint, row.goodsKey),
    correlation_id: correlationId(proposal.fingerprint),
    actor_type: "SYSTEM",
    actor_id: "ops-price-readback-browser",
    input_snapshot: queueInput(proposal.fingerprint, row, notBefore),
    result_snapshot: {},
    error_message: null,
    started_at: now,
    finished_at: null,
    updated_at: now,
  }));
  const itemUpsert = await admin
    .from("commerce_operation_runs")
    .upsert(itemRows, { onConflict: "source_event_id", ignoreDuplicates: true });
  if (itemUpsert.error) {
    throw new Error(`INTERNAL_CHINA_BROWSER_PRICE_READBACK_ITEM_CREATE_FAILED:${itemUpsert.error.message}`);
  }

  if (input?.retryFailed === true) {
    const retry = await admin
      .from("commerce_operation_runs")
      .update({
        status: "PENDING",
        result_snapshot: {},
        error_message: null,
        finished_at: null,
        updated_at: now,
      })
      .eq("operation_type", INTERNAL_CHINA_BROWSER_PRICE_READBACK_ITEM_OPERATION_TYPE)
      .eq("correlation_id", correlationId(proposal.fingerprint))
      .eq("status", "FAILED");
    if (retry.error) {
      throw new Error(`INTERNAL_CHINA_BROWSER_PRICE_READBACK_RETRY_FAILED:${retry.error.message}`);
    }
  }

  const summary = await refreshRunStatus(proposal.fingerprint);
  return { proposalFingerprint: proposal.fingerprint, notBefore, summary };
}

export async function loadInternalChinaBrowserMallPriceReadbackSummary(
  proposalFingerprint: string,
): Promise<BrowserPriceReadbackSummary> {
  if (!proposalFingerprint) {
    return summarizeRows("", []);
  }
  const rows = await loadItemRows(proposalFingerprint);
  return summarizeRows(proposalFingerprint, rows);
}

async function recoverStaleClaims() {
  const admin = await adminClient();
  const cutoff = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const stale = await admin
    .from("commerce_operation_runs")
    .select("id")
    .eq("operation_type", INTERNAL_CHINA_BROWSER_PRICE_READBACK_ITEM_OPERATION_TYPE)
    .eq("status", "RUNNING")
    .lt("updated_at", cutoff)
    .limit(50);
  if (stale.error) {
    throw new Error(`INTERNAL_CHINA_BROWSER_PRICE_READBACK_STALE_LOAD_FAILED:${stale.error.message}`);
  }
  for (const row of Array.isArray(stale.data) ? stale.data : []) {
    const id = text(row.id);
    if (!id) continue;
    const recovered = await admin
      .from("commerce_operation_runs")
      .update({
        status: "PENDING",
        result_snapshot: {},
        error_message: "Stale browser readback claim automatically recovered.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "RUNNING");
    if (recovered.error) {
      throw new Error(`INTERNAL_CHINA_BROWSER_PRICE_READBACK_STALE_RECOVERY_FAILED:${recovered.error.message}`);
    }
  }
}

export async function claimInternalChinaBrowserMallPriceReadback(runIdValue: unknown) {
  const runId = text(runIdValue);
  if (!/^[A-Za-z0-9._:-]{12,180}$/.test(runId)) {
    throw new Error("INTERNAL_CHINA_BROWSER_PRICE_READBACK_RUN_ID_INVALID");
  }
  await recoverStaleClaims();
  const admin = await adminClient();
  const candidates = await admin
    .from("commerce_operation_runs")
    .select(
      "id,operation_type,status,source_event_id,correlation_id,input_snapshot,result_snapshot,error_message,started_at,updated_at",
    )
    .eq("operation_type", INTERNAL_CHINA_BROWSER_PRICE_READBACK_ITEM_OPERATION_TYPE)
    .eq("status", "PENDING")
    .order("started_at", { ascending: false })
    .limit(40);
  if (candidates.error) {
    throw new Error(`INTERNAL_CHINA_BROWSER_PRICE_READBACK_CLAIM_LOAD_FAILED:${candidates.error.message}`);
  }
  const nowMs = Date.now();
  for (const candidate of (Array.isArray(candidates.data) ? candidates.data : []) as OperationRow[]) {
    const input = object(candidate.input_snapshot);
    const notBeforeMs = Date.parse(text(input.notBefore));
    if (Number.isFinite(notBeforeMs) && notBeforeMs > nowMs) continue;
    const id = text(candidate.id);
    if (!id) continue;
    const claimedAt = new Date().toISOString();
    const claimed = await admin
      .from("commerce_operation_runs")
      .update({
        status: "RUNNING",
        result_snapshot: { claimRunId: runId, claimedAt, readOnly: true },
        error_message: null,
        updated_at: claimedAt,
      })
      .eq("id", id)
      .eq("status", "PENDING")
      .select(
        "id,operation_type,status,source_event_id,correlation_id,input_snapshot,result_snapshot,error_message,started_at,updated_at",
      )
      .maybeSingle();
    if (claimed.error) {
      throw new Error(`INTERNAL_CHINA_BROWSER_PRICE_READBACK_CLAIM_FAILED:${claimed.error.message}`);
    }
    if (!claimed.data) continue;
    const task = parseTask(claimed.data as OperationRow);
    if (!task) {
      await admin
        .from("commerce_operation_runs")
        .update({
          status: "FAILED",
          error_message: "Browser price readback task payload validation failed.",
          finished_at: claimedAt,
          updated_at: claimedAt,
        })
        .eq("id", id);
      continue;
    }
    await refreshRunStatus(task.proposalFingerprint);
    return { task, runId };
  }
  return { task: null, runId };
}

export async function reportInternalChinaBrowserMallPriceReadback(inputValue: unknown) {
  const payload = object(inputValue);
  const runId = text(payload.runId);
  const taskId = text(payload.taskId);
  if (!/^[A-Za-z0-9._:-]{12,180}$/.test(runId) || !taskId) {
    throw new Error("INTERNAL_CHINA_BROWSER_PRICE_READBACK_REPORT_IDENTITY_INVALID");
  }
  const admin = await adminClient();
  const current = await admin
    .from("commerce_operation_runs")
    .select(
      "id,operation_type,status,source_event_id,correlation_id,input_snapshot,result_snapshot,error_message,started_at,updated_at",
    )
    .eq("id", taskId)
    .eq("operation_type", INTERNAL_CHINA_BROWSER_PRICE_READBACK_ITEM_OPERATION_TYPE)
    .maybeSingle();
  if (current.error) {
    throw new Error(`INTERNAL_CHINA_BROWSER_PRICE_READBACK_REPORT_LOAD_FAILED:${current.error.message}`);
  }
  const row = current.data as OperationRow | null;
  if (!row || text(row.status) !== "RUNNING") {
    throw new Error("INTERNAL_CHINA_BROWSER_PRICE_READBACK_REPORT_REJECTED");
  }
  const claim = object(row.result_snapshot);
  if (text(claim.claimRunId) !== runId) {
    throw new Error("INTERNAL_CHINA_BROWSER_PRICE_READBACK_REPORT_RUN_MISMATCH");
  }
  const task = parseTask(row);
  if (!task) throw new Error("INTERNAL_CHINA_BROWSER_PRICE_READBACK_TASK_INVALID");

  const observedRows = sanitizeObservedRows(payload.observedRows);
  const byMall = new Map<string, BrowserObservedMallPrice[]>();
  for (const observed of observedRows) {
    const currentRows = byMall.get(observed.mallKey) || [];
    currentRows.push(observed);
    byMall.set(observed.mallKey, currentRows);
  }

  const mallResults = task.mallTargets.map((target) => {
    const candidates = byMall.get(target.mallKey) || [];
    const matching = candidates.filter(
      (candidate) =>
        candidate.sellPrice === target.targetSellPrice &&
        candidate.purchasePrice === target.expectedPurchasePrice &&
        candidate.consumerPrice === target.expectedConsumerPrice,
    );
    const conflicting = candidates.filter(
      (candidate) =>
        candidate.sellPrice !== target.targetSellPrice ||
        candidate.purchasePrice !== target.expectedPurchasePrice ||
        candidate.consumerPrice !== target.expectedConsumerPrice,
    );
    const status =
      candidates.length === 0 ? "missing" : matching.length > 0 && conflicting.length === 0 ? "matched" : "mismatch";
    return {
      mallKey: target.mallKey,
      mallName: target.mallName,
      status,
      expected: {
        sellPrice: target.targetSellPrice,
        purchasePrice: target.expectedPurchasePrice,
        consumerPrice: target.expectedConsumerPrice,
      },
      observed: candidates,
    };
  });
  const mallMatchCount = mallResults.filter((result) => result.status === "matched").length;
  const mallMismatchCount = mallResults.filter((result) => result.status === "mismatch").length;
  const mallMissingCount = mallResults.filter((result) => result.status === "missing").length;
  const succeeded = mallMatchCount === task.mallTargets.length;
  const now = new Date().toISOString();
  const parserError = text(payload.error).slice(0, 600);
  const resultSnapshot = {
    proposalFingerprint: task.proposalFingerprint,
    goodsKey: task.goodsKey,
    productGroup: task.productGroup,
    targetSellPrice: task.targetSellPrice,
    readOnly: true,
    shoplingWritesEnabled: false,
    browserBridgeVersion: text(payload.bridgeVersion).slice(0, 40),
    pageUrl: text(payload.pageUrl).slice(0, 300),
    pageTitle: text(payload.pageTitle).slice(0, 180),
    observedRowCount: observedRows.length,
    mallCheckCount: task.mallTargets.length,
    mallMatchCount,
    mallMismatchCount,
    mallMissingCount,
    parserError: parserError || null,
    mallResults,
    finishedAt: now,
  };
  const update = await admin
    .from("commerce_operation_runs")
    .update({
      status: succeeded ? "SUCCEEDED" : "FAILED",
      result_snapshot: resultSnapshot,
      error_message: succeeded
        ? null
        : (parserError || `Browser mall-price verification mismatch=${mallMismatchCount}, missing=${mallMissingCount}`).slice(0, 1000),
      finished_at: now,
      updated_at: now,
    })
    .eq("id", taskId)
    .eq("status", "RUNNING");
  if (update.error) {
    throw new Error(`INTERNAL_CHINA_BROWSER_PRICE_READBACK_REPORT_UPDATE_FAILED:${update.error.message}`);
  }
  const summary = await refreshRunStatus(task.proposalFingerprint);
  return {
    recorded: true,
    outcome: succeeded ? "verified" : "failed",
    goodsKey: task.goodsKey,
    mallMatchCount,
    mallMismatchCount,
    mallMissingCount,
    summary,
  };
}
