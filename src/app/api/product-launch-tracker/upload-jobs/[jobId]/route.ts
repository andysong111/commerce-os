import { NextRequest } from "next/server";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  extractCanonicalPriceTargetsFromUploadResult,
  SHOPLING_CANONICAL_PRICE_POLICY_VERSION,
} from "@/lib/shoplingCanonicalPricePolicy";
import { dispatchShoplingPriceModifyActions } from "@/lib/shoplingPriceModifyRunner";
import {
  getProductLaunchAdminConfig,
  readProductLaunchError,
  readProductLaunchState,
  readResponseJson,
  writeProductLaunchState,
} from "@/lib/productLaunchTrackerServer";

const JOB_TABLE = "product_launch_upload_jobs";
const CHANNEL_KEY_BY_LABEL: Record<string, string> = {
  도매1: "wholesale1",
  도매2: "wholesale2",
  도매3: "wholesale3",
  도매4: "wholesale4",
  소매1: "retail1",
  소매2: "retail2",
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  const authorized = authorizeWorker(request);
  if (!authorized.ok) {
    return Response.json(authorized.body, { status: authorized.status });
  }
  const { jobId } = await context.params;
  if (!isValidJobId(jobId)) {
    return Response.json(
      { ok: false, code: "INVALID_JOB_ID", message: "작업 ID가 올바르지 않습니다." },
      { status: 400 },
    );
  }
  const config = getProductLaunchAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  try {
    const job = await readJob(config.value, jobId);
    if (!job) {
      return Response.json(
        { ok: false, code: "SHOPLING_JOB_NOT_FOUND", message: "등록 작업을 찾지 못했습니다." },
        { status: 404 },
      );
    }
    if (job.status === "queued") {
      await patchJob(config.value, jobId, {
        status: "running",
        updated_at: new Date().toISOString(),
      });
    }
    return Response.json({
      ok: true,
      jobId: job.id,
      requestId: job.request_id,
      launchItemId: job.launch_item_id,
      payload: job.payload,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "SHOPLING_JOB_FETCH_FAILED",
        message: error instanceof Error ? error.message : "등록 작업을 불러오지 못했습니다.",
      },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  const authorized = authorizeWorker(request);
  if (!authorized.ok) {
    return Response.json(authorized.body, { status: authorized.status });
  }
  const { jobId } = await context.params;
  if (!isValidJobId(jobId)) {
    return Response.json(
      { ok: false, code: "INVALID_JOB_ID", message: "작업 ID가 올바르지 않습니다." },
      { status: 400 },
    );
  }
  const config = getProductLaunchAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  let input: {
    status: "success" | "partial_failure" | "failed";
    rows: Array<Record<string, unknown>>;
    errorMessage: string;
    result: Record<string, unknown>;
  };
  try {
    const body = await request.json();
    const status = String(body?.status ?? "");
    if (!["success", "partial_failure", "failed"].includes(status)) {
      throw new Error("완료 상태가 올바르지 않습니다.");
    }
    const rows = Array.isArray(body?.rows) ? body.rows.map(asRecord) : [];
    input = {
      status: status as "success" | "partial_failure" | "failed",
      rows,
      errorMessage: String(body?.error_message ?? body?.errorMessage ?? "").slice(0, 2000),
      result: asRecord(body),
    };
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "INVALID_SHOPLING_JOB_RESULT",
        message: error instanceof Error ? error.message : "등록 결과가 올바르지 않습니다.",
      },
      { status: 400 },
    );
  }

  try {
    const job = await readJob(config.value, jobId);
    if (!job) {
      return Response.json(
        { ok: false, code: "SHOPLING_JOB_NOT_FOUND", message: "등록 작업을 찾지 못했습니다." },
        { status: 404 },
      );
    }
    const completedAt = new Date().toISOString();
    await patchJob(config.value, jobId, {
      status: input.status,
      result: input.result,
      error_message: input.errorMessage,
      updated_at: completedAt,
      completed_at: completedAt,
    });
    await applyResultToTrackerState(config.value, job, input, completedAt);
    return Response.json({ ok: true, jobId, status: input.status, completedAt });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "SHOPLING_JOB_RESULT_WRITE_FAILED",
        message: error instanceof Error ? error.message : "등록 결과를 저장하지 못했습니다.",
      },
      { status: 500 },
    );
  }
}

function authorizeWorker(
  request: NextRequest,
):
  | { ok: true }
  | {
      ok: false;
      status: number;
      body: { ok: false; code: string; message: string };
    } {
  const expected = process.env.PRODUCT_LAUNCH_UPLOAD_SECRET?.trim();
  if (!expected) {
    return {
      ok: false,
      status: 503,
      body: {
        ok: false,
        code: "UPLOAD_SECRET_NOT_CONFIGURED",
        message: "상품출시 업로드 연동 비밀값이 설정되지 않았습니다.",
      },
    };
  }
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const provided = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  if (!provided || provided !== expected) {
    return {
      ok: false,
      status: 401,
      body: {
        ok: false,
        code: "INVALID_UPLOAD_SECRET",
        message: "상품출시 업로드 연동 인증에 실패했습니다.",
      },
    };
  }
  return { ok: true };
}

async function readJob(
  config: { supabaseUrl: string; secretKey: string },
  jobId: string,
) {
  const params = new URLSearchParams({
    select: "*",
    id: `eq.${jobId}`,
    limit: "1",
  });
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/${JOB_TABLE}?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );
  const body = await readResponseJson(response);
  if (!response.ok) throw new Error(readProductLaunchError(body, response.status));
  return Array.isArray(body) ? body[0] ?? null : null;
}

async function patchJob(
  config: { supabaseUrl: string; secretKey: string },
  jobId: string,
  patch: Record<string, unknown>,
) {
  const params = new URLSearchParams({ id: `eq.${jobId}` });
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/${JOB_TABLE}?${params.toString()}`,
    {
      method: "PATCH",
      headers: {
        ...createSupabaseAdminHeaders(config.secretKey),
        Prefer: "return=minimal",
      },
      body: JSON.stringify(patch),
      cache: "no-store",
    },
  );
  const body = await readResponseJson(response);
  if (!response.ok) throw new Error(readProductLaunchError(body, response.status));
}

async function applyResultToTrackerState(
  config: { supabaseUrl: string; secretKey: string },
  job: Record<string, unknown>,
  input: {
    status: "success" | "partial_failure" | "failed";
    rows: Array<Record<string, unknown>>;
    errorMessage: string;
  },
  completedAt: string,
) {
  const ownerId = String(job.owner_id ?? "");
  const ownerEmail = String(job.owner_email ?? "");
  const itemId = String(job.launch_item_id ?? "");
  const stateRow = await readProductLaunchState(config, ownerId);
  const state = asRecord(stateRow?.state_payload);
  const items = Array.isArray(state.items) ? state.items.map(asRecord) : [];
  const itemIndex = items.findIndex((item) => String(item.id ?? "") === itemId);
  if (itemIndex < 0) throw new Error("등록 결과를 반영할 출시 상품을 찾지 못했습니다.");

  const item = { ...items[itemIndex] };
  const products = { ...asRecord(item.shoplingProducts) };
  for (const row of input.rows) {
    const channelKey =
      String(row.channel_key ?? row.channelKey ?? "") ||
      CHANNEL_KEY_BY_LABEL[String(row.channel ?? row.channel_label ?? "")] ||
      "";
    if (!channelKey) continue;
    const succeeded =
      String(row.status ?? "") === "success" || String(row.code ?? "") === "000";
    products[channelKey] = {
      ...asRecord(products[channelKey]),
      goodsKey: String(row.goods_key ?? row.goodsKey ?? ""),
      status: succeeded ? "success" : "failed",
      error: succeeded ? "" : String(row.message ?? row.msg ?? ""),
      registeredAt: succeeded ? completedAt : null,
    };
  }
  item.shoplingProducts = products;
  await startCanonicalPricePolicy(item, input, completedAt);

  const stages = { ...asRecord(item.stages) };
  const currentStage = { ...asRecord(stages.shoplingUpload) };
  const stageStatus = input.status === "success" ? "완료" : "보류";
  stages.shoplingUpload = {
    ...currentStage,
    status: stageStatus,
    completedAt: input.status === "success" ? completedAt : null,
    note: input.status === "success" ? "" : input.errorMessage || "일부 채널 등록 실패",
  };
  item.stages = stages;
  item.updatedAt = completedAt;
  item.updatedBy = "샵플링 자동등록";
  if (input.status !== "success") {
    const note = input.errorMessage || "샵플링 등록 결과를 확인하세요.";
    const previous = String(item.notes ?? "");
    item.notes = previous.includes(note)
      ? previous
      : [previous, note].filter(Boolean).join(" · ");
  }
  items[itemIndex] = item;
  const nextState = {
    ...state,
    items,
    savedAt: completedAt,
  };
  await writeProductLaunchState(
    config,
    { userId: ownerId, email: ownerEmail },
    nextState,
  );
}

async function startCanonicalPricePolicy(
  item: Record<string, unknown>,
  input: {
    status: "success" | "partial_failure" | "failed";
    rows: Array<Record<string, unknown>>;
  },
  completedAt: string,
) {
  if (input.status !== "success") return;

  const existingPolicy = asRecord(item.pricePolicy);
  const existingRequestId = String(existingPolicy.requestId ?? "").trim();
  const existingStatus = String(existingPolicy.status ?? "").trim();
  if (
    existingRequestId &&
    ["pending", "running", "success"].includes(existingStatus)
  ) {
    return;
  }

  const targets = extractCanonicalPriceTargetsFromUploadResult({
    summary: { rows: input.rows },
  });
  if (targets.goodsKeys.length !== 6 || targets.failedRowCount > 0) {
    item.pricePolicy = {
      ...existingPolicy,
      required: true,
      status: "failed",
      requestId: "",
      policyVersion: SHOPLING_CANONICAL_PRICE_POLICY_VERSION,
      goodsKeyCount: targets.goodsKeys.length,
      message:
        "6채널 goods_key와 상품그룹을 모두 확인하지 못해 중앙 가격정책 실행을 차단했습니다.",
      updatedAt: completedAt,
    };
    return;
  }

  try {
    const dispatch = await dispatchShoplingPriceModifyActions(
      targets.goodsKeys.join(","),
      [],
      targets.goodsKeyGroupJson,
    );
    if (dispatch.status === "queued" && dispatch.requestId) {
      item.pricePolicy = {
        ...existingPolicy,
        required: true,
        status: "pending",
        requestId: dispatch.requestId,
        policyVersion: SHOPLING_CANONICAL_PRICE_POLICY_VERSION,
        goodsKeyCount: targets.goodsKeys.length,
        message: "상품등록 완료 후 중앙 가격정책 실행을 시작했습니다.",
        updatedAt: completedAt,
      };
      return;
    }
    item.pricePolicy = {
      ...existingPolicy,
      required: true,
      status: "failed",
      requestId: dispatch.requestId ?? "",
      policyVersion: SHOPLING_CANONICAL_PRICE_POLICY_VERSION,
      goodsKeyCount: targets.goodsKeys.length,
      message: dispatch.message || "중앙 가격정책 실행을 시작하지 못했습니다.",
      updatedAt: completedAt,
    };
  } catch (error) {
    item.pricePolicy = {
      ...existingPolicy,
      required: true,
      status: "failed",
      requestId: "",
      policyVersion: SHOPLING_CANONICAL_PRICE_POLICY_VERSION,
      goodsKeyCount: targets.goodsKeys.length,
      message:
        error instanceof Error
          ? error.message
          : "중앙 가격정책 실행을 시작하지 못했습니다.",
      updatedAt: completedAt,
    };
  }
}

function isValidJobId(value: string) {
  return /^[0-9a-f-]{36}$/i.test(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
