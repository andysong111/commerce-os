import { NextResponse } from "next/server";
import { normalError, normalSession, rpcData } from "@/lib/shoplingPriceModifyBulkApi";

export async function POST(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const auth = await normalSession();
  if (auth.response) return auth.response;
  const { jobId } = await params;
  const result = await auth.admin.rpc("start_shopling_price_adjustment_bulk_job", {
    p_job_id: jobId,
    p_owner_id: auth.ownerId,
  });
  if (result.error || !result.data) return normalError("Bulk 작업을 시작할 수 없습니다.", 409, "ADJUSTMENT_BULK_START_FAILED", "adjustment_bulk.start", result.error);
  return NextResponse.json({ job: rpcData(result.data) });
}
