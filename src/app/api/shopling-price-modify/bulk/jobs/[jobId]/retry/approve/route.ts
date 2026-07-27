import { NextResponse } from "next/server";
import { normalError, normalSession, rpcData } from "@/lib/shoplingPriceModifyBulkApi";

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const auth = await normalSession();
  if (auth.response) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return normalError("확인 문구가 필요합니다.", 400, "INVALID_BODY", "retry.approve.body");
  }

  if ((body as { confirmation?: unknown })?.confirmation !== "CONFIRM_FAILED_GOODS_RETRY") {
    return normalError("재시도 확인 문구가 일치하지 않습니다.", 400, "CONFIRMATION_REQUIRED", "retry.approve.confirmation");
  }

  const { jobId } = await params;
  const result = await auth.admin!.rpc("approve_shopling_price_bulk_failed_retry", {
    p_job_id: jobId,
    p_owner_id: auth.ownerId,
  });

  if (result.error) {
    return normalError("실패 상품 재실행을 승인할 수 없습니다.", 409, "RETRY_APPROVAL_REJECTED", "retry.approve.rpc", result.error);
  }
  if (!result.data) {
    return normalError(
      "실패 상품 재실행 승인 응답이 비어 있습니다.",
      500,
      "RETRY_APPROVAL_EMPTY",
      "retry.approve.rpc",
      "approve_shopling_price_bulk_failed_retry RPC가 데이터를 반환하지 않았습니다.",
    );
  }

  return NextResponse.json({
    ...rpcData(result.data),
    message: "실패 상품만 재실행하도록 승인했습니다. 성공 상품은 재실행하지 않습니다.",
  });
}
