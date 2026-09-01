import {
  loadLatestInternalChinaGroupCostPriceProposal,
} from "@/lib/internalChinaGroupCostPriceReview";
import {
  buildInternalChinaDirectTargetExecutionPlan,
  INTERNAL_CHINA_DIRECT_TARGET_BATCH_SIZE,
  loadInternalChinaDirectTargetExecution,
  type InternalChinaDirectTargetExecutionPlan,
  type InternalChinaDirectTargetExecutionRow,
} from "@/lib/internalChinaGroupCostPriceExecution";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";

export const INTERNAL_CHINA_PRICE_READBACK_DISPATCH_OPERATION_TYPE =
  "INTERNAL_CHINA_GROUP_COST_PRICE_READBACK_DISPATCH";
export const INTERNAL_CHINA_PRICE_READBACK_BATCH_OPERATION_TYPE =
  "INTERNAL_CHINA_GROUP_COST_PRICE_READBACK_BATCH";
export const SHOPLING_EXPLICIT_PRICE_VERIFY_WORKFLOW =
  "shopling-explicit-price-verify.yml";

const SOURCE = "ops-center-internal-china-price-readback";
const EXECUTION_PREFIX = "internal-china-group-cost-price-readback:v1:";
const BATCH_PREFIX = "internal-china-group-cost-price-readback-batch:v1:";

type OperationRow = {
  status?: unknown;
  source_event_id?: unknown;
  result_snapshot?: unknown;
};

type ReadbackBatchReceipt = {
  batchIndex: number;
  requestId: string;
  goodsKeyCount: number;
  mallCheckCount: number;
  status: "DISPATCHED";
};

export type InternalChinaPriceReadbackReceipt = {
  proposalFingerprint: string;
  dispatchedAt: string;
  goodsKeyCount: number;
  mallCheckCount: number;
  batchCount: number;
  batches: ReadbackBatchReceipt[];
  readOnly: true;
  shoplingWritesEnabled: false;
  finalReadbackResultPending: true;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function fingerprintHex(value: string) {
  const normalized = text(value).replace(/^sha256:/, "");
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("INTERNAL_CHINA_PRICE_READBACK_FINGERPRINT_INVALID");
  }
  return normalized;
}

function connection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return { baseUrl, secret };
}

async function operationRest<T>(input: {
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
      body:
        input.method && input.method !== "GET"
          ? JSON.stringify(input.body)
          : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    },
  );
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(
      `INTERNAL_CHINA_PRICE_READBACK_STORE_FAILED:${response.status}:${raw.slice(0, 300)}`,
    );
  }
  return (raw ? JSON.parse(raw) : null) as T;
}

function executionSourceEventId(fingerprint: string) {
  return `${EXECUTION_PREFIX}${fingerprintHex(fingerprint)}`;
}

function batchSourceEventId(fingerprint: string, batchIndex: number) {
  return `${BATCH_PREFIX}${fingerprintHex(fingerprint)}:${batchIndex}`;
}

function chunkRows(rows: InternalChinaDirectTargetExecutionRow[]) {
  const chunks: InternalChinaDirectTargetExecutionRow[][] = [];
  for (let index = 0; index < rows.length; index += INTERNAL_CHINA_DIRECT_TARGET_BATCH_SIZE) {
    chunks.push(rows.slice(index, index + INTERNAL_CHINA_DIRECT_TARGET_BATCH_SIZE));
  }
  return chunks;
}

function workflowPlanJson(
  plan: InternalChinaDirectTargetExecutionPlan,
  rows: InternalChinaDirectTargetExecutionRow[],
) {
  return JSON.stringify({
    proposal_fingerprint: plan.proposalFingerprintHex,
    execution_policy: plan.executionPolicy,
    rows: rows.map((row) => ({
      goods_key: row.goodsKey,
      product_group: row.productGroup,
      target_sell_price: row.targetSellPrice,
      mall_targets: row.mallTargets.map((mall) => ({
        mall_key: mall.mallKey,
        target_sell_price: mall.targetSellPrice,
      })),
    })),
  });
}

function githubDispatchConfig() {
  const repo = process.env.SHOPLING_PRICE_MODIFY_REPO?.trim();
  const ref = process.env.SHOPLING_PRICE_MODIFY_REF?.trim();
  const token = (
    process.env.SHOPLING_PRICE_MODIFY_ACTIONS_TOKEN ||
    process.env.GITHUB_ACTIONS_TOKEN
  )?.trim();
  if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new Error("INTERNAL_CHINA_PRICE_READBACK_GITHUB_REPO_REQUIRED");
  }
  if (!ref) throw new Error("INTERNAL_CHINA_PRICE_READBACK_GITHUB_REF_REQUIRED");
  if (!token) throw new Error("INTERNAL_CHINA_PRICE_READBACK_GITHUB_TOKEN_REQUIRED");
  return { repo, ref, token };
}

async function dispatchWorkflow(input: {
  requestId: string;
  planJson: string;
}) {
  const config = githubDispatchConfig();
  const [owner, repo] = config.repo.split("/");
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(
      SHOPLING_EXPLICIT_PRICE_VERIFY_WORKFLOW,
    )}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        ref: config.ref,
        inputs: { request_id: input.requestId, plan_json: input.planJson },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (response.status !== 204) {
    const raw = await response.text();
    throw new Error(
      `INTERNAL_CHINA_PRICE_READBACK_GITHUB_DISPATCH_FAILED:${response.status}:${raw.slice(0, 240)}`,
    );
  }
}

async function loadOperationBySourceEvent(
  operationType: string,
  sourceEventId: string,
) {
  const rows = await operationRest<OperationRow[]>({
    query: new URLSearchParams({
      operation_type: `eq.${operationType}`,
      source_event_id: `eq.${sourceEventId}`,
      select: "status,source_event_id,result_snapshot",
      limit: "1",
    }),
  });
  return rows?.[0] ?? null;
}

async function reserveBatch(input: {
  proposalFingerprint: string;
  batchIndex: number;
  requestId: string;
  goodsKeyCount: number;
  mallCheckCount: number;
}) {
  const sourceEventId = batchSourceEventId(input.proposalFingerprint, input.batchIndex);
  const existing = await loadOperationBySourceEvent(
    INTERNAL_CHINA_PRICE_READBACK_BATCH_OPERATION_TYPE,
    sourceEventId,
  );
  const status = text(existing?.status);
  if (status === "SUCCEEDED") return { sourceEventId, alreadyDispatched: true };
  if (status === "RUNNING") {
    throw new Error(`INTERNAL_CHINA_PRICE_READBACK_BATCH_STATE_UNCERTAIN:${input.batchIndex}`);
  }
  const now = new Date().toISOString();
  await operationRest<OperationRow[]>({
    method: "POST",
    query: new URLSearchParams({ on_conflict: "source_event_id" }),
    prefer: "resolution=merge-duplicates,return=representation",
    body: [
      {
        operation_type: INTERNAL_CHINA_PRICE_READBACK_BATCH_OPERATION_TYPE,
        status: "RUNNING",
        source: SOURCE,
        source_event_id: sourceEventId,
        correlation_id: executionSourceEventId(input.proposalFingerprint),
        actor_type: "SYSTEM",
        actor_id: "ops-price-readback",
        input_snapshot: {
          proposalFingerprint: input.proposalFingerprint,
          batchIndex: input.batchIndex,
          requestId: input.requestId,
          goodsKeyCount: input.goodsKeyCount,
          mallCheckCount: input.mallCheckCount,
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
  });
  return { sourceEventId, alreadyDispatched: false };
}

async function finishBatch(
  sourceEventId: string,
  result: ReadbackBatchReceipt,
) {
  const now = new Date().toISOString();
  await operationRest<OperationRow[]>({
    method: "PATCH",
    query: new URLSearchParams({ source_event_id: `eq.${sourceEventId}` }),
    prefer: "return=representation",
    body: {
      status: "SUCCEEDED",
      result_snapshot: result,
      error_message: null,
      finished_at: now,
      updated_at: now,
    },
  });
}

export async function loadInternalChinaPriceReadbackDispatch(
  proposalFingerprint: string,
): Promise<InternalChinaPriceReadbackReceipt | null> {
  if (!proposalFingerprint) return null;
  const row = await loadOperationBySourceEvent(
    INTERNAL_CHINA_PRICE_READBACK_DISPATCH_OPERATION_TYPE,
    executionSourceEventId(proposalFingerprint),
  );
  const value = object(row?.result_snapshot);
  return value.proposalFingerprint
    ? (value as unknown as InternalChinaPriceReadbackReceipt)
    : null;
}

export async function dispatchInternalChinaPriceReadback(input: {
  proposalFingerprint?: unknown;
}) {
  const requestedFingerprint = text(input.proposalFingerprint);
  const latest = await loadLatestInternalChinaGroupCostPriceProposal();
  const proposal = latest.proposal;
  if (!proposal) throw new Error("INTERNAL_CHINA_PRICE_READBACK_PROPOSAL_NOT_FOUND");
  if (proposal.fingerprint !== requestedFingerprint) {
    throw new Error("INTERNAL_CHINA_PRICE_READBACK_PROPOSAL_STALE");
  }
  const applied = await loadInternalChinaDirectTargetExecution(proposal.fingerprint);
  if (!applied || !applied.shoplingWritesDispatched) {
    throw new Error("INTERNAL_CHINA_PRICE_READBACK_APPLY_REQUIRED");
  }
  const existing = await loadInternalChinaPriceReadbackDispatch(proposal.fingerprint);
  if (existing) return { receipt: existing, duplicate: true };

  const plan = buildInternalChinaDirectTargetExecutionPlan(proposal);
  if (plan.goodsKeyCount !== applied.goodsKeyCount) {
    throw new Error("INTERNAL_CHINA_PRICE_READBACK_SCOPE_MISMATCH");
  }
  const batches = chunkRows(plan.rows);
  const batchReceipts: ReadbackBatchReceipt[] = [];
  for (let index = 0; index < batches.length; index += 1) {
    const rows = batches[index];
    const requestId = `group-cost-readback-${plan.proposalFingerprintHex.slice(0, 16)}-${index + 1}`;
    const mallCheckCount = rows.reduce(
      (sum, row) => sum + row.mallTargets.length,
      0,
    );
    const receipt: ReadbackBatchReceipt = {
      batchIndex: index + 1,
      requestId,
      goodsKeyCount: rows.length,
      mallCheckCount,
      status: "DISPATCHED",
    };
    const reservation = await reserveBatch({
      proposalFingerprint: proposal.fingerprint,
      batchIndex: index + 1,
      requestId,
      goodsKeyCount: rows.length,
      mallCheckCount,
    });
    if (!reservation.alreadyDispatched) {
      await dispatchWorkflow({ requestId, planJson: workflowPlanJson(plan, rows) });
      await finishBatch(reservation.sourceEventId, receipt);
    }
    batchReceipts.push(receipt);
  }

  const now = new Date().toISOString();
  const receipt: InternalChinaPriceReadbackReceipt = {
    proposalFingerprint: proposal.fingerprint,
    dispatchedAt: now,
    goodsKeyCount: plan.goodsKeyCount,
    mallCheckCount: plan.rows.reduce((sum, row) => sum + row.mallTargets.length, 0),
    batchCount: batchReceipts.length,
    batches: batchReceipts,
    readOnly: true,
    shoplingWritesEnabled: false,
    finalReadbackResultPending: true,
  };
  await operationRest<OperationRow[]>({
    method: "POST",
    query: new URLSearchParams({ on_conflict: "source_event_id" }),
    prefer: "resolution=merge-duplicates,return=representation",
    body: [
      {
        operation_type: INTERNAL_CHINA_PRICE_READBACK_DISPATCH_OPERATION_TYPE,
        status: "SUCCEEDED",
        source: SOURCE,
        source_event_id: executionSourceEventId(proposal.fingerprint),
        correlation_id: latest.sourceEventId,
        actor_type: "SYSTEM",
        actor_id: "ops-price-readback",
        input_snapshot: {
          proposalFingerprint: proposal.fingerprint,
          goodsKeyCount: plan.goodsKeyCount,
          mallCheckCount: receipt.mallCheckCount,
          readOnly: true,
          shoplingWritesEnabled: false,
        },
        result_snapshot: receipt,
        error_message: null,
        started_at: now,
        finished_at: now,
        updated_at: now,
      },
    ],
  });
  return { receipt, duplicate: false };
}
