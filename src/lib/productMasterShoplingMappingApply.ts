import {
  loadProductMasterShoplingDiagnosticStatus,
} from "@/lib/productMasterShoplingDiagnostic";
import {
  buildProductMasterShoplingMappingApplyPlan,
  type ProductMasterShoplingMappingApplyPlan,
  type ProductMasterShoplingMappingApplyRow,
} from "@/lib/productMasterShoplingMappingApplyEngine";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import {
  createSupabaseAdminClient,
  createSupabaseAdminHeaders,
} from "@/lib/supabase/admin";

export const PRODUCT_MASTER_SHOPLING_MAPPING_CANARY =
  "PRODUCT_MASTER_SHOPLING_MAPPING_CANARY";
export const PRODUCT_MASTER_SHOPLING_MAPPING_FULL =
  "PRODUCT_MASTER_SHOPLING_MAPPING_FULL";

const DEFAULT_PRODUCT_MASTER_URL =
  "https://commerce-os-product-master.vercel.app";
const APPLY_BATCH_SIZE = 500;

type OperationRow = {
  status?: unknown;
  result_snapshot?: unknown;
  started_at?: unknown;
};

type StoreOperationInput = {
  operationType: string;
  sourceEventId: string;
  correlationId: string;
  status?: "SUCCEEDED" | "FAILED";
  inputSnapshot: unknown;
  resultSnapshot: unknown;
  errorMessage?: string | null;
};

export type ProductMasterShoplingMappingApplyStatus = {
  configured: boolean;
  diagnosticRequestId: string | null;
  state: "WAITING_DIAGNOSTIC" | "BLOCKED" | "READY_CANARY" | "READY_FULL" | "COMPLETED";
  message: string;
  canaryVerified: boolean;
  totalCandidates: number;
  safeCandidateCount: number;
  pendingCount: number;
  alreadyAppliedCount: number;
  blockerCount: number;
  canaryCandidate: ProductMasterShoplingMappingApplyRow | null;
  blockers: ProductMasterShoplingMappingApplyPlan["blockers"];
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mappingCorrelationId(requestId: string) {
  return `product-master-shopling-mapping:${requestId}`;
}

function productMasterConnection() {
  const secret = process.env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim();
  if (!secret) throw new Error("PRODUCT_MASTER_INTEGRATION_SECRET_REQUIRED");
  const baseUrl = (
    process.env.PRODUCT_MASTER_BASE_URL?.trim() || DEFAULT_PRODUCT_MASTER_URL
  ).replace(/\/$/, "");
  if (!/^https:\/\//.test(baseUrl)) {
    throw new Error("PRODUCT_MASTER_BASE_URL_INVALID");
  }
  return { baseUrl, secret };
}

function supabaseConnection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return { baseUrl, secret };
}

async function storeOperation(input: StoreOperationInput) {
  const { baseUrl, secret } = supabaseConnection();
  const occurredAt = new Date().toISOString();
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?on_conflict=source_event_id&select=id,source_event_id,started_at`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(secret),
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify([
        {
          operation_type: input.operationType,
          status: input.status ?? "SUCCEEDED",
          source: "ops-center-product-master-shopling-mapping",
          source_event_id: input.sourceEventId,
          correlation_id: input.correlationId,
          actor_type: "OPS_OPERATOR",
          input_snapshot: input.inputSnapshot,
          result_snapshot: input.resultSnapshot,
          error_message: input.errorMessage ?? null,
          started_at: occurredAt,
          finished_at: occurredAt,
          updated_at: occurredAt,
        },
      ]),
      cache: "no-store",
    },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `PRODUCT_MASTER_SHOPLING_MAPPING_AUDIT_STORE_FAILED:${response.status}:${body.slice(0, 300)}`,
    );
  }
}

async function readCanaryOperation(requestId: string) {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  const result = await admin
    .from("commerce_operation_runs")
    .select("status,result_snapshot,started_at")
    .eq("operation_type", PRODUCT_MASTER_SHOPLING_MAPPING_CANARY)
    .eq("correlation_id", mappingCorrelationId(requestId))
    .order("started_at", { ascending: false })
    .limit(5);
  if (result.error) throw new Error(result.error.message);
  return (Array.isArray(result.data) ? result.data : []).find((row) => {
    const operation = row as OperationRow;
    return (
      text(operation.status) === "SUCCEEDED" &&
      object(operation.result_snapshot).verified === true
    );
  }) as OperationRow | undefined;
}

async function loadApplyContext() {
  productMasterConnection();
  const diagnostic = await loadProductMasterShoplingDiagnosticStatus();
  if (
    diagnostic.state !== "COMPLETED" ||
    !diagnostic.requestId ||
    !diagnostic.report
  ) {
    return { diagnostic, planning: null, plan: null, canaryVerified: false };
  }
  const planning = await loadProductPlanningSnapshot();
  const plan = buildProductMasterShoplingMappingApplyPlan(
    diagnostic.report,
    planning.products,
  );
  const canaryVerified = Boolean(await readCanaryOperation(diagnostic.requestId));
  return { diagnostic, planning, plan, canaryVerified };
}

function statusFromContext(
  context: Awaited<ReturnType<typeof loadApplyContext>>,
): ProductMasterShoplingMappingApplyStatus {
  const configured = Boolean(process.env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim());
  const { diagnostic, plan, canaryVerified } = context;
  if (!plan || !diagnostic.requestId) {
    return {
      configured,
      diagnosticRequestId: diagnostic.requestId,
      state: "WAITING_DIAGNOSTIC",
      message: "Shopling 전수진단이 완료된 뒤 연결값 적용을 시작할 수 있습니다.",
      canaryVerified: false,
      totalCandidates: 0,
      safeCandidateCount: 0,
      pendingCount: 0,
      alreadyAppliedCount: 0,
      blockerCount: 0,
      canaryCandidate: null,
      blockers: [],
    };
  }
  if (plan.blockerCount > 0) {
    return {
      configured,
      diagnosticRequestId: diagnostic.requestId,
      state: "BLOCKED",
      message: `${plan.blockerCount}건의 재검증 차단 문제가 있어 상품마스터 연결값을 변경하지 않았습니다.`,
      canaryVerified,
      totalCandidates: plan.totalCandidates,
      safeCandidateCount: plan.safeCandidateCount,
      pendingCount: plan.pendingCount,
      alreadyAppliedCount: plan.alreadyAppliedCount,
      blockerCount: plan.blockerCount,
      canaryCandidate: plan.pending[0] ?? null,
      blockers: plan.blockers.slice(0, 100),
    };
  }
  if (plan.pendingCount === 0) {
    return {
      configured,
      diagnosticRequestId: diagnostic.requestId,
      state: "COMPLETED",
      message: `안전 적용 후보 ${plan.safeCandidateCount}건이 모두 상품마스터에 연결되어 있습니다.`,
      canaryVerified,
      totalCandidates: plan.totalCandidates,
      safeCandidateCount: plan.safeCandidateCount,
      pendingCount: 0,
      alreadyAppliedCount: plan.alreadyAppliedCount,
      blockerCount: 0,
      canaryCandidate: null,
      blockers: [],
    };
  }
  return {
    configured,
    diagnosticRequestId: diagnostic.requestId,
    state: canaryVerified ? "READY_FULL" : "READY_CANARY",
    message: canaryVerified
      ? `카나리 연결 검증이 끝났습니다. 남은 ${plan.pendingCount}건을 멱등 배치로 적용할 수 있습니다.`
      : `재검증을 통과한 ${plan.pendingCount}건 중 1건을 먼저 카나리로 저장·재조회합니다.`,
    canaryVerified,
    totalCandidates: plan.totalCandidates,
    safeCandidateCount: plan.safeCandidateCount,
    pendingCount: plan.pendingCount,
    alreadyAppliedCount: plan.alreadyAppliedCount,
    blockerCount: 0,
    canaryCandidate: plan.pending[0] ?? null,
    blockers: [],
  };
}

export async function loadProductMasterShoplingMappingApplyStatus() {
  return statusFromContext(await loadApplyContext());
}

function listingPayload(row: ProductMasterShoplingMappingApplyRow, syncedAt: string) {
  return {
    id: row.id,
    barcode: row.barcode,
    goodsKey: row.goodsKey,
    optionId: row.optionId,
    channel: row.channel,
    listingName: row.listingName,
    listingOptionName: row.listingOptionName,
    unitsPerOrder: row.unitsPerOrder,
    active: true,
    syncedAt,
  };
}

async function pushMappingBatch(rows: ProductMasterShoplingMappingApplyRow[]) {
  const { baseUrl, secret } = productMasterConnection();
  const syncedAt = new Date().toISOString();
  const response = await fetch(`${baseUrl}/api/integrations/barcode-ledgers`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-commerce-os-integration-secret": secret,
    },
    body: JSON.stringify({
      listingMappings: rows.map((row) => listingPayload(row, syncedAt)),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    message?: string;
    error?: string;
    counts?: Record<string, number>;
  };
  if (!response.ok || payload.ok !== true) {
    throw new Error(
      payload.message || payload.error || `PRODUCT_MASTER_MAPPING_WRITE_FAILED:${response.status}`,
    );
  }
  return payload;
}

function rowKey(row: ProductMasterShoplingMappingApplyRow) {
  return `${row.skuId}\u0000${row.goodsKey}\u0000${row.optionId}\u0000${row.unitsPerOrder}`;
}

async function verifyRows(
  report: NonNullable<Awaited<ReturnType<typeof loadProductMasterShoplingDiagnosticStatus>>["report"]>,
  rows: ProductMasterShoplingMappingApplyRow[],
) {
  const planning = await loadProductPlanningSnapshot();
  const plan = buildProductMasterShoplingMappingApplyPlan(report, planning.products);
  const verified = new Set(plan.alreadyApplied.map(rowKey));
  const missing = rows.filter((row) => !verified.has(rowKey(row)));
  if (plan.blockerCount > 0 || missing.length > 0) {
    throw new Error(
      `PRODUCT_MASTER_MAPPING_VERIFY_FAILED:blockers=${plan.blockerCount}:missing=${missing.length}`,
    );
  }
  return plan;
}

export async function applyProductMasterShoplingMappings(
  mode: "CANARY" | "FULL",
) {
  const context = await loadApplyContext();
  const { diagnostic, plan, canaryVerified } = context;
  if (
    diagnostic.state !== "COMPLETED" ||
    !diagnostic.requestId ||
    !diagnostic.report ||
    !plan
  ) {
    throw new Error("PRODUCT_MASTER_MAPPING_DIAGNOSTIC_NOT_COMPLETED");
  }
  if (plan.blockerCount > 0) {
    throw new Error(`PRODUCT_MASTER_MAPPING_BLOCKED:${plan.blockerCount}`);
  }
  if (mode === "FULL" && !canaryVerified) {
    throw new Error("PRODUCT_MASTER_MAPPING_CANARY_REQUIRED");
  }

  const selected = mode === "CANARY" ? plan.pending.slice(0, 1) : plan.pending;
  if (!selected.length) {
    return {
      mode,
      applied: 0,
      verified: true,
      status: statusFromContext(context),
      message: "새로 적용할 상품마스터 Shopling 연결 후보가 없습니다.",
    };
  }

  const correlationId = mappingCorrelationId(diagnostic.requestId);
  const operationType =
    mode === "CANARY"
      ? PRODUCT_MASTER_SHOPLING_MAPPING_CANARY
      : PRODUCT_MASTER_SHOPLING_MAPPING_FULL;
  const sourceEventId =
    mode === "CANARY"
      ? `product-master-shopling-mapping-canary:${diagnostic.requestId}:${selected[0].id}`
      : `product-master-shopling-mapping-full:${diagnostic.requestId}`;

  let written = 0;
  try {
    for (let index = 0; index < selected.length; index += APPLY_BATCH_SIZE) {
      const batch = selected.slice(index, index + APPLY_BATCH_SIZE);
      await pushMappingBatch(batch);
      written += batch.length;
    }
    const after = await verifyRows(diagnostic.report, selected);
    await storeOperation({
      operationType,
      sourceEventId,
      correlationId,
      inputSnapshot: {
        diagnosticRequestId: diagnostic.requestId,
        mode,
        selectedCount: selected.length,
        firstMappingId: selected[0]?.id ?? null,
        lastMappingId: selected.at(-1)?.id ?? null,
      },
      resultSnapshot: {
        verified: true,
        written,
        alreadyAppliedCount: after.alreadyAppliedCount,
        pendingCount: after.pendingCount,
        blockerCount: after.blockerCount,
      },
    });
    return {
      mode,
      applied: written,
      verified: true,
      status: await loadProductMasterShoplingMappingApplyStatus(),
      message:
        mode === "CANARY"
          ? "카나리 1건을 상품마스터에 저장한 뒤 planning snapshot에서 동일 goods_key·옵션 ID·환산수량을 재확인했습니다."
          : `남은 안전 후보 ${written}건을 상품마스터에 멱등 저장하고 전수 재조회 검증했습니다.`,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "PRODUCT_MASTER_MAPPING_APPLY_FAILED";
    await storeOperation({
      operationType,
      sourceEventId,
      correlationId,
      status: "FAILED",
      inputSnapshot: {
        diagnosticRequestId: diagnostic.requestId,
        mode,
        selectedCount: selected.length,
      },
      resultSnapshot: {
        verified: false,
        writtenBeforeFailure: written,
        retryIsIdempotent: true,
      },
      errorMessage: message,
    }).catch(() => undefined);
    throw error;
  }
}
