import { NextResponse } from "next/server";
import { normalError, normalSession, rpcData } from "@/lib/shoplingPriceModifyBulkApi";

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const auth = await normalSession();
  if (auth.response) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return normalError("확인 문구가 필요합니다.", 400, "INVALID_BODY", "control.pause.body");
  }

  if ((body as { confirmation?: unknown })?.confirmation !== "CONFIRM_BULK_PAUSE") {
    return normalError("일시중지 확인 문구가 일치하지 않습니다.", 400, "CONFIRMATION_REQUIRED", "control.pause.confirmation");
  }

  const { jobId } = await params;
  const result = await auth.admin!.rpc("request_shopling_price_bulk_pause", {
    p_job_id: jobId,
    p_owner_id: auth.ownerId,
  });

  if (result.error) {
    return normalError("일시중지를 요청할 수 없습니다.", 409, "PAUSE_REJECTED", "control.pause.rpc", result.error);
  }
  if (!result.data) {
    return normalError(
      "일시중지 응답이 비어 있습니다.",
      500,
      "PAUSE_RPC_EMPTY",
      "control.pause.rpc",
      "request_shopling_price_bulk_pause RPC가 데이터를 반환하지 않았습니다.",
    );
  }

  return NextResponse.json({
    ...rpcData(result.data),
    message: "현재 청크 완료 후 안전하게 일시중지합니다.",
  });
}
