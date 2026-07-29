import { NextResponse } from "next/server";
import { requireShoplingPriceAdjustmentAdmin } from "@/lib/shoplingPriceAdjustmentAuth";
import { normalError, rpcData } from "@/lib/shoplingPriceModifyBulkApi";

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const auth = await requireShoplingPriceAdjustmentAdmin(request);
  if (!auth.ok) return auth.response;
  const { jobId } = await params;
  const result = await auth.admin.rpc("request_pause_shopling_price_adjustment_bulk_job", {
    p_job_id: jobId,
    p_owner_id: auth.ownerId,
  });
  if (result.error || !result.data) return normalError("일시중지를 요청할 수 없습니다.", 409, "ADJUSTMENT_BULK_PAUSE_FAILED", "adjustment_bulk.pause", result.error);
  return NextResponse.json({ job: rpcData(result.data), message: "현재 진행 단계가 끝난 뒤 일시중지합니다." });
}
