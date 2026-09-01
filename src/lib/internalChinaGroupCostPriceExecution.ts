import {
  loadInternalChinaGroupCostPriceApproval,
  loadLatestInternalChinaGroupCostPriceProposal,
  type InternalChinaGroupCostPriceProposal,
  type InternalChinaGroupCostPriceReviewRow,
} from "@/lib/internalChinaGroupCostPriceReview";
import {
  buildInternalMallPriceTargets,
  normalizeInternalPriceGroup,
  type InternalPriceGroup,
} from "@/lib/internalChinaPriceGroupPolicy";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";

export const INTERNAL_CHINA_DIRECT_TARGET_EXECUTION_POLICY =
  "CONFIRMED_COST_DIRECT_TARGET_NO_CAP_V1" as const;
export const INTERNAL_CHINA_DIRECT_TARGET_EXECUTION_OPERATION_TYPE =
  "INTERNAL_CHINA_GROUP_COST_PRICE_EXECUTION_DISPATCH";
export const INTERNAL_CHINA_DIRECT_TARGET_BATCH_OPERATION_TYPE =
  "INTERNAL_CHINA_GROUP_COST_PRICE_EXECUTION_BATCH";
export const INTERNAL_CHINA_DIRECT_TARGET_BATCH_SIZE = 20;
export const SHOPLING_EXPLICIT_PRICE_PLAN_WORKFLOW =
  "shopling-explicit-price-plan.yml";

const SOURCE = "ops-center-internal-china-direct-target-price-execution";
const EXECUTION_PREFIX = "internal-china-direct-target-price-execution:v1:";
const BATCH_PREFIX = "internal-china-direct-target-price-batch:v1:";

type OperationRow = {
  status?: unknown;
  source_event_id?: unknown;
  result_snapshot?: unknown;
  started_at?: unknown;
  updated_at?: unknown;
};

export type InternalChinaDirectTargetMall = {
  mallKey: string;
  targetSellPrice: number;
};

export type InternalChinaDirectTargetExecutionRow = {
  goodsKey: string;
  productGroup: InternalPriceGroup;
  currentPrice: number;
  targetSellPrice: number;
  increaseRate: number;
  mallTargets: InternalChinaDirectTargetMall[];
};

export type InternalChinaDirectTargetExecutionPlan = {
  proposalFingerprint: string;
  proposalFingerprintHex: string;
  executionPolicy: typeof INTERNAL_CHINA_DIRECT_TARGET_EXECUTION_POLICY;
  changedOptionRowCount: number;
  goodsKeyCount: number;
  maxIncreaseRate: number;
  rows: InternalChinaDirectTargetExecutionRow[];
};

export type InternalChinaDirectTargetBatchDispatch = {
  batchIndex: number;
  requestId: string;
  goodsKeyCount: number;
  mallTargetCount: number;
  status: "DISPATCHED";
};

export type InternalChinaDirectTargetExecutionReceipt = {
  proposalFingerprint: string;
  executionPolicy: typeof INTERNAL_CHINA_DIRECT_TARGET_EXECUTION_POLICY;
  dispatchedAt: string;
  changedOptionRowCount: number;
  goodsKeyCount: number;
  batchCount: number;
  maxIncreaseRate: number;
  batches: InternalChinaDirectTargetBatchDispatch[];
  shoplingWritesDispatched: true;
  finalShoplingWriteResultPending: true;
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
      `INTERNAL_CHINA_DIRECT_TARGET_STORE_FAILED:${response.status}:${raw.slice(0, 300)}`,
    );
  }
  return (raw ? JSON.parse(raw) : null) as T;
}

function fingerprintHex(value: string) {
  const normalized = text(value).replace(/^sha256:/, "");
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("INTERNAL_CHINA_DIRECT_TARGET_FINGERPRINT_INVALID");
  }
  return normalized;
}

function executionSourceEventId(fingerprint: string) {
  return `${EXECUTION_PREFIX}${fingerprintHex(fingerprint)}`;
}

function batchSourceEventId(fingerprint: string, batchIndex: number) {
  return `${BATCH_PREFIX}${fingerprintHex(fingerprint)}:${batchIndex}`;
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

function normalizedMallTargets(row: InternalChinaGroupCostPriceReviewRow) {
  return row.mallTargets
    .map((mall) => ({ mallKey: mall.mallKey, targetSellPrice: integer(mall.targetPrice) }))
    .sort((left, right) => left.mallKey.localeCompare(right.mallKey));
}

function assertRowMatchesCurrentPolicy(row: InternalChinaGroupCostPriceReviewRow) {
  const productGroup = normalizeInternalPriceGroup(row.productGroup);
  if (!productGroup) {
    throw new Error(`INTERNAL_CHINA_DIRECT_TARGET_GROUP_INVALID:${row.goodsKey}`);
  }
  const targetSellPrice = integer(row.targetPrice);
  const currentPrice = integer(row.currentPrice);
  if (row.direction !== "INCREASE" || currentPrice <= 0 || targetSellPrice <= currentPrice) {
    throw new Error(`INTERNAL_CHINA_DIRECT_TARGET_DIRECTION_INVALID:${row.goodsKey}`);
  }
  const expectedMalls = buildInternalMallPriceTargets({
    productGroup,
    groupTargetPrice: targetSellPrice,
  })
    .map((mall) => ({ mallKey: mall.mallKey, targetSellPrice: integer(mall.targetPrice) }))
    .sort((left, right) => left.mallKey.localeCompare(right.mallKey));
  const actualMalls = normalizedMallTargets(row);
  if (JSON.stringify(actualMalls) !== JSON.stringify(expectedMalls)) {
    throw new Error(`INTERNAL_CHINA_DIRECT_TARGET_MALL_SCOPE_MISMATCH:${row.goodsKey}`);
  }
  return { productGroup, targetSellPrice, currentPrice, mallTargets: actualMalls };
}

export function buildInternalChinaDirectTargetExecutionPlan(
  proposal: InternalChinaGroupCostPriceProposal,
): InternalChinaDirectTargetExecutionPlan {
  if (proposal.state !== "AWAITING_APPROVAL" || proposal.changedRowCount <= 0) {
    throw new Error("INTERNAL_CHINA_DIRECT_TARGET_PROPOSAL_NOT_EXECUTABLE");
  }
  const changed = approvableChangedRows(proposal);
  if (changed.length !== proposal.changedRowCount) {
    throw new Error("INTERNAL_CHINA_DIRECT_TARGET_SCOPE_MISMATCH");
  }

  const byGoodsKey = new Map<string, InternalChinaDirectTargetExecutionRow>();
  for (const row of changed) {
    const validated = assertRowMatchesCurrentPolicy(row);
    const increaseRate =
      validated.currentPrice > 0
        ? Math.round((validated.targetSellPrice / validated.currentPrice - 1) * 10000) /
          10000
        : 0;
    const next: InternalChinaDirectTargetExecutionRow = {
      goodsKey: row.goodsKey,
      productGroup: validated.productGroup,
      currentPrice: validated.currentPrice,
      targetSellPrice: validated.targetSellPrice,
      increaseRate,
      mallTargets: validated.mallTargets,
    };
    const existing = byGoodsKey.get(row.goodsKey);
    if (!existing) {
      byGoodsKey.set(row.goodsKey, next);
      continue;
    }
    if (
      existing.productGroup !== next.productGroup ||
      existing.currentPrice !== next.currentPrice ||
      existing.targetSellPrice !== next.targetSellPrice ||
      JSON.stringify(existing.mallTargets) !== JSON.stringify(next.mallTargets)
    ) {
      throw new Error(`INTERNAL_CHINA_DIRECT_TARGET_GOODSKEY_CONFLICT:${row.goodsKey}`);
    }
  }

  const rows = [...byGoodsKey.values()].sort((left, right) =>
    left.goodsKey.localeCompare(right.goodsKey, "en", { numeric: true }),
  );
  if (!rows.length) throw new Error("INTERNAL_CHINA_DIRECT_TARGET_EMPTY");
  return {
    proposalFingerprint: proposal.fingerprint,
    proposalFingerprintHex: fingerprintHex(proposal.fingerprint),
    executionPolicy: INTERNAL_CHINA_DIRECT_TARGET_EXECUTION_POLICY,
    changedOptionRowCount: changed.length,
    goodsKeyCount: rows.length,
    maxIncreaseRate: Math.max(...rows.map((row) => row.increaseRate)),
    rows,
  };
}

function githubDispatchConfig() {
  const repo = process.env.SHOPLING_PRICE_MODIFY_REPO?.trim();
  const ref = process.env.SHOPLING_PRICE_MODIFY_REF?.trim();
  const token = (
    process.env.SHOPLING_PRICE_MODIFY_ACTIONS_TOKEN ||
    process.env.GITHUB_ACTIONS_TOKEN
  )?.trim();
  if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new Error("INTERNAL_CHINA_DIRECT_TARGET_GITHUB_REPO_REQUIRED");
  }
  if (!ref) throw new Error("INTERNAL_CHINA_DIRECT_TARGET_GITHUB_REF_REQUIRED");
  if (!token) throw new Error("INTERNAL_CHINA_DIRECT_TARGET_GITHUB_TOKEN_REQUIRED");
  return { repo, ref, token };
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

async function loadOperationBySourceEvent(
  operationType: string,
  sourceEventId: string,
) {
  const rows = await operationRest<OperationRow[]>({
    query: new URLSearchParams({
      operation_type: `eq.${operationType}`,
      source_event_id: `eq.${sourceEventId}`,
      select: "status,source_event_id,result_snapshot,started_at,updated_at",
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
  mallTargetCount: number;
}) {
  const sourceEventId = batchSourceEventId(input.proposalFingerprint, input.batchIndex);
  const existing = await loadOperationBySourceEvent(
    INTERNAL_CHINA_DIRECT_TARGET_BATCH_OPERATION_TYPE,
    sourceEventId,
  );
  const status = text(existing?.status);
  if (status === "SUCCEEDED") return { sourceEventId, alreadyDispatched: true };
  if (status === "RUNNING") {
    throw new Error(`INTERNAL_CHINA_DIRECT_TARGET_BATCH_STATE_UNCERTAIN:${input.batchIndex}`);
  }
  const now = new Date().toISOString();
  await operationRest<OperationRow[]>({
    method: "POST",
    query: new URLSearchParams({ on_conflict: "source_event_id" }),
    prefer: "resolution=merge-duplicates,return=representation",
    body: [
      {
        operation_type: INTERNAL_CHINA_DIRECT_TARGET_BATCH_OPERATION_TYPE,
        status: "RUNNING",
        source: SOURCE,
        source_event_id: sourceEventId,
        correlation_id: executionSourceEventId(input.proposalFingerprint),
        actor_type: "USER",
        actor_id: "ops-center",
        input_snapshot: {
          proposalFingerprint: input.proposalFingerprint,
          executionPolicy: INTERNAL_CHINA_DIRECT_TARGET_EXECUTION_POLICY,
          batchIndex: input.batchIndex,
          requestId: input.requestId,
          goodsKeyCount: input.goodsKeyCount,
          mallTargetCount: input.mallTargetCount,
        },
        result_snapshot: null,
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
  result: InternalChinaDirectTargetBatchDispatch,
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

async function dispatchWorkflow(input: {
  requestId: string;
  planJson: string;
}) {
  const config = githubDispatchConfig();
  const [owner, repo] = config.repo.split("/");
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(
      SHOPLING_EXPLICIT_PRICE_PLAN_WORKFLOW,
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
      `INTERNAL_CHINA_DIRECT_TARGET_GITHUB_DISPATCH_FAILED:${response.status}:${raw.slice(0, 240)}`,
    );
  }
}

export async function loadInternalChinaDirectTargetExecution(
  proposalFingerprint: string,
): Promise<InternalChinaDirectTargetExecutionReceipt | null> {
  if (!proposalFingerprint) return null;
  const row = await loadOperationBySourceEvent(
    INTERNAL_CHINA_DIRECT_TARGET_EXECUTION_OPERATION_TYPE,
    executionSourceEventId(proposalFingerprint),
  );
  const value = object(row?.result_snapshot);
  return value.proposalFingerprint
    ? (value as unknown as InternalChinaDirectTargetExecutionReceipt)
    : null;
}

export async function dispatchInternalChinaDirectTargetExecution(input: {
  proposalFingerprint?: unknown;
}) {
  const requestedFingerprint = text(input.proposalFingerprint);
  const latest = await loadLatestInternalChinaGroupCostPriceProposal();
  const proposal = latest.proposal;
  if (!proposal) throw new Error("INTERNAL_CHINA_DIRECT_TARGET_PROPOSAL_NOT_FOUND");
  if (proposal.fingerprint !== requestedFingerprint) {
    throw new Error("INTERNAL_CHINA_DIRECT_TARGET_PROPOSAL_STALE");
  }
  const approval = await loadInternalChinaGroupCostPriceApproval(proposal.fingerprint);
  if (
    !approval ||
    approval.proposalFingerprint !== proposal.fingerprint ||
    approval.approvedChangedRowCount !== proposal.changedRowCount
  ) {
    throw new Error("INTERNAL_CHINA_DIRECT_TARGET_APPROVAL_REQUIRED");
  }
  const existing = await loadInternalChinaDirectTargetExecution(proposal.fingerprint);
  if (existing) return { receipt: existing, duplicate: true };

  const plan = buildInternalChinaDirectTargetExecutionPlan(proposal);
  const batches = chunkRows(plan.rows);
  const batchReceipts: InternalChinaDirectTargetBatchDispatch[] = [];
  for (let index = 0; index < batches.length; index += 1) {
    const rows = batches[index];
    const requestId = `group-cost-direct-${plan.proposalFingerprintHex.slice(0, 16)}-${index + 1}`;
    const mallTargetCount = rows.reduce(
      (sum, row) => sum + row.mallTargets.length,
      0,
    );
    const receipt: InternalChinaDirectTargetBatchDispatch = {
      batchIndex: index + 1,
      requestId,
      goodsKeyCount: rows.length,
      mallTargetCount,
      status: "DISPATCHED",
    };
    const reservation = await reserveBatch({
      proposalFingerprint: proposal.fingerprint,
      batchIndex: index + 1,
      requestId,
      goodsKeyCount: rows.length,
      mallTargetCount,
    });
    if (!reservation.alreadyDispatched) {
      await dispatchWorkflow({ requestId, planJson: workflowPlanJson(plan, rows) });
      await finishBatch(reservation.sourceEventId, receipt);
    }
    batchReceipts.push(receipt);
  }

  const now = new Date().toISOString();
  const receipt: InternalChinaDirectTargetExecutionReceipt = {
    proposalFingerprint: proposal.fingerprint,
    executionPolicy: plan.executionPolicy,
    dispatchedAt: now,
    changedOptionRowCount: plan.changedOptionRowCount,
    goodsKeyCount: plan.goodsKeyCount,
    batchCount: batchReceipts.length,
    maxIncreaseRate: plan.maxIncreaseRate,
    batches: batchReceipts,
    shoplingWritesDispatched: true,
    finalShoplingWriteResultPending: true,
  };
  await operationRest<OperationRow[]>({
    method: "POST",
    query: new URLSearchParams({ on_conflict: "source_event_id" }),
    prefer: "resolution=merge-duplicates,return=representation",
    body: [
      {
        operation_type: INTERNAL_CHINA_DIRECT_TARGET_EXECUTION_OPERATION_TYPE,
        status: "SUCCEEDED",
        source: SOURCE,
        source_event_id: executionSourceEventId(proposal.fingerprint),
        correlation_id: latest.sourceEventId,
        actor_type: "USER",
        actor_id: "ops-center",
        input_snapshot: {
          proposalFingerprint: proposal.fingerprint,
          executionPolicy: plan.executionPolicy,
          goodsKeyCount: plan.goodsKeyCount,
          changedOptionRowCount: plan.changedOptionRowCount,
          maxIncreaseRate: plan.maxIncreaseRate,
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
