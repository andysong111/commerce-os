import { NextResponse } from "next/server";
import { normalError, normalSession, rpcData } from "@/lib/shoplingPriceModifyBulkApi";

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const auth = await normalSession();
  if (auth.response) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return normalError("확인 문구가 필요합니다.", 400, "INVALID_BODY", "control.resume.body");
  }

  if ((body as { confirmation?: unknown })?.confirmation !== "CONFIRM_BULK_RESUME") {
    return normalError("재개 확인 문구가 일치하지 않습니다.", 400, "CONFIRMATION_REQUIRED", "control.resume.confirmation");
  }

  const { jobId } = await params;
  const result = await auth.admin!.rpc("resume_shopling_price_bulk_execution", {
    p_job_id: jobId,
    p_owner_id: auth.ownerId,
  });

  if (result.error) {
    return normalError("직렬 실행을 재개할 수 없습니다.", 409, "RESUME_REJECTED", "control.resume.rpc", result.error);
  }
  if (!result.data) {
    return normalError(
      "직렬 실행 재개 응답이 비어 있습니다.",
      500,
      "RESUME_RPC_EMPTY",
      "control.resume.rpc",
      "resume_shopling_price_bulk_execution RPC가 데이터를 반환하지 않았습니다.",
    );
  }

  return NextResponse.json({
    ...rpcData(result.data),
    message: "가장 앞의 대기 청크부터 직렬 실행을 재개합니다.",
  });
}
