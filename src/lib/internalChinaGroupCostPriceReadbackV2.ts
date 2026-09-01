import { loadLatestInternalChinaGroupCostPriceProposal } from "@/lib/internalChinaGroupCostPriceReview";
import {
  buildInternalChinaDirectTargetExecutionPlan,
  INTERNAL_CHINA_DIRECT_TARGET_BATCH_SIZE,
  loadInternalChinaDirectTargetExecution,
  type InternalChinaDirectTargetExecutionRow,
} from "@/lib/internalChinaGroupCostPriceExecution";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";

export const INTERNAL_CHINA_PRICE_READBACK_V2_OPERATION_TYPE =
  "INTERNAL_CHINA_GROUP_COST_PRICE_READBACK_V2_DISPATCH";
const SOURCE = "ops-center-internal-china-price-readback-v2";
const SOURCE_PREFIX = "internal-china-group-cost-price-readback:v2:";
const WORKFLOW = "shopling-explicit-price-verify.yml";

type OperationRow = { result_snapshot?: unknown };

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
    throw new Error("INTERNAL_CHINA_PRICE_READBACK_V2_FINGERPRINT_INVALID");
  }
  return normalized;
}
function sourceEventId(fingerprint: string) {
  return `${SOURCE_PREFIX}${fingerprintHex(fingerprint)}`;
}
function connection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!baseUrl || !secret) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return { baseUrl, secret };
}
async function rest<T>(input: { method?: "GET" | "POST"; query: URLSearchParams; body?: unknown; prefer?: string }) {
  const { baseUrl, secret } = connection();
  const response = await fetch(`${baseUrl}/rest/v1/commerce_operation_runs?${input.query.toString()}`, {
    method: input.method ?? "GET",
    headers: {
      ...createSupabaseAdminHeaders(secret),
      ...(input.prefer ? { Prefer: input.prefer } : {}),
    },
    body: input.method === "POST" ? JSON.stringify(input.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`INTERNAL_CHINA_PRICE_READBACK_V2_STORE_FAILED:${response.status}:${raw.slice(0, 240)}`);
  return (raw ? JSON.parse(raw) : null) as T;
}
function githubConfig() {
  const repo = process.env.SHOPLING_PRICE_MODIFY_REPO?.trim();
  const ref = process.env.SHOPLING_PRICE_MODIFY_REF?.trim();
  const token = (process.env.SHOPLING_PRICE_MODIFY_ACTIONS_TOKEN || process.env.GITHUB_ACTIONS_TOKEN)?.trim();
  if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new Error("INTERNAL_CHINA_PRICE_READBACK_V2_GITHUB_REPO_REQUIRED");
  if (!ref) throw new Error("INTERNAL_CHINA_PRICE_READBACK_V2_GITHUB_REF_REQUIRED");
  if (!token) throw new Error("INTERNAL_CHINA_PRICE_READBACK_V2_GITHUB_TOKEN_REQUIRED");
  return { repo, ref, token };
}
function chunks(rows: InternalChinaDirectTargetExecutionRow[]) {
  const out: InternalChinaDirectTargetExecutionRow[][] = [];
  for (let index = 0; index < rows.length; index += INTERNAL_CHINA_DIRECT_TARGET_BATCH_SIZE) {
    out.push(rows.slice(index, index + INTERNAL_CHINA_DIRECT_TARGET_BATCH_SIZE));
  }
  return out;
}
function planJson(fingerprint: string, policy: string, rows: InternalChinaDirectTargetExecutionRow[]) {
  return JSON.stringify({
    proposal_fingerprint: fingerprintHex(fingerprint),
    execution_policy: policy,
    rows: rows.map((row) => ({
      goods_key: row.goodsKey,
      product_group: row.productGroup,
      target_sell_price: row.targetSellPrice,
      mall_targets: row.mallTargets.map((mall) => ({ mall_key: mall.mallKey, target_sell_price: mall.targetSellPrice })),
    })),
  });
}
async function dispatch(requestId: string, payload: string) {
  const config = githubConfig();
  const [owner, repo] = config.repo.split("/");
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ ref: config.ref, inputs: { request_id: requestId, plan_json: payload } }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status !== 204) throw new Error(`INTERNAL_CHINA_PRICE_READBACK_V2_GITHUB_DISPATCH_FAILED:${response.status}:${(await response.text()).slice(0, 180)}`);
}

export async function dispatchInternalChinaPriceReadbackV2(input: { proposalFingerprint?: unknown }) {
  const requested = text(input.proposalFingerprint);
  const latest = await loadLatestInternalChinaGroupCostPriceProposal();
  const proposal = latest.proposal;
  if (!proposal) throw new Error("INTERNAL_CHINA_PRICE_READBACK_V2_PROPOSAL_NOT_FOUND");
  if (proposal.fingerprint !== requested) throw new Error("INTERNAL_CHINA_PRICE_READBACK_V2_PROPOSAL_STALE");
  const applied = await loadInternalChinaDirectTargetExecution(proposal.fingerprint);
  if (!applied?.shoplingWritesDispatched) throw new Error("INTERNAL_CHINA_PRICE_READBACK_V2_APPLY_REQUIRED");

  const eventId = sourceEventId(proposal.fingerprint);
  const existing = await rest<OperationRow[]>({
    query: new URLSearchParams({ operation_type: `eq.${INTERNAL_CHINA_PRICE_READBACK_V2_OPERATION_TYPE}`, source_event_id: `eq.${eventId}`, select: "result_snapshot", limit: "1" }),
  });
  const prior = object(existing?.[0]?.result_snapshot);
  if (prior.proposalFingerprint) return { receipt: prior, duplicate: true };

  const plan = buildInternalChinaDirectTargetExecutionPlan(proposal);
  if (plan.goodsKeyCount !== applied.goodsKeyCount) throw new Error("INTERNAL_CHINA_PRICE_READBACK_V2_SCOPE_MISMATCH");
  const batches = chunks(plan.rows);
  const receipts = [];
  for (let index = 0; index < batches.length; index += 1) {
    const rows = batches[index];
    const requestId = `group-cost-readback-v2-${plan.proposalFingerprintHex.slice(0, 16)}-${index + 1}`;
    await dispatch(requestId, planJson(plan.proposalFingerprint, plan.executionPolicy, rows));
    receipts.push({
      batchIndex: index + 1,
      requestId,
      goodsKeyCount: rows.length,
      mallCheckCount: rows.reduce((sum, row) => sum + row.mallTargets.length, 0),
    });
  }
  const now = new Date().toISOString();
  const receipt = {
    proposalFingerprint: proposal.fingerprint,
    verifierVersion: 2,
    dispatchedAt: now,
    goodsKeyCount: plan.goodsKeyCount,
    mallCheckCount: plan.rows.reduce((sum, row) => sum + row.mallTargets.length, 0),
    batchCount: receipts.length,
    batches: receipts,
    readOnly: true,
    shoplingWritesEnabled: false,
    finalReadbackResultPending: true,
  };
  await rest<OperationRow[]>({
    method: "POST",
    query: new URLSearchParams({ on_conflict: "source_event_id" }),
    prefer: "resolution=merge-duplicates,return=representation",
    body: [{
      operation_type: INTERNAL_CHINA_PRICE_READBACK_V2_OPERATION_TYPE,
      status: "SUCCEEDED",
      source: SOURCE,
      source_event_id: eventId,
      correlation_id: latest.sourceEventId,
      actor_type: "SYSTEM",
      actor_id: "ops-price-readback-v2",
      input_snapshot: { proposalFingerprint: proposal.fingerprint, goodsKeyCount: plan.goodsKeyCount, mallCheckCount: receipt.mallCheckCount, readOnly: true },
      result_snapshot: receipt,
      error_message: null,
      started_at: now,
      finished_at: now,
      updated_at: now,
    }],
  });
  return { receipt, duplicate: false };
}
