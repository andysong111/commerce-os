import { NextResponse } from "next/server";
import { normalError, normalSession, rpcData } from "@/lib/shoplingPriceModifyBulkApi";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await normalSession();
  if (auth.response) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return normalError("확인 문구가 필요합니다.", 400, "VALIDATION_BODY_INVALID", "validation.create.body");
  }

  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "confirmation")) {
    return normalError("검증 전용 작업에는 확인 문구 외의 입력을 사용할 수 없습니다.", 400, "VALIDATION_BODY_FIELDS_INVALID", "validation.create.body");
  }
  if ((body as { confirmation?: unknown }).confirmation !== "CONFIRM_20000_VALIDATION_ONLY") {
    return normalError("20,000개 가격 무쓰기 검증 확인 문구가 일치하지 않습니다.", 400, "VALIDATION_CONFIRMATION_REQUIRED", "validation.create.confirmation");
  }

  const result = await auth.admin!.rpc("create_shopling_price_bulk_validation_job", {
    p_owner_id: auth.ownerId,
    p_count: 20_000,
  });
  if (result.error) {
    return normalError("20,000개 검증 전용 작업 저장에 실패했습니다.", 500, "VALIDATION_JOB_RPC_FAILED", "validation.create.rpc", result.error);
  }
  if (!result.data) {
    return normalError("검증 전용 작업 저장 응답이 비어 있습니다.", 500, "VALIDATION_JOB_EMPTY", "validation.create.rpc", "create_shopling_price_bulk_validation_job RPC가 데이터를 반환하지 않았습니다.");
  }

  const row = rpcData(result.data);
  return NextResponse.json({
    id: row.id,
    status: row.status,
    execution_mode: row.execution_mode,
    valid_count: row.valid_count,
    total_chunk_count: row.total_chunk_count,
    canary_size: row.canary_size,
    normal_chunk_count: Number(row.total_chunk_count ?? 0) - 1,
    created_at: row.created_at,
    message: "20,000개 검증 전용 작업을 저장했습니다. 이 작업에서는 가격 실행이 구조적으로 잠겨 있습니다.",
  }, { status: 201 });
}
