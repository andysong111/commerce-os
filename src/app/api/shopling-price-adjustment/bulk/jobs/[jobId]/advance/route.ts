import { NextResponse } from "next/server";
import { normalError, normalSession } from "@/lib/shoplingPriceModifyBulkApi";
import { advanceShoplingPriceAdjustmentBulkJob } from "@/lib/shoplingPriceAdjustmentBulkOrchestrator";

export async function POST(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const auth = await normalSession();
  if (auth.response) return auth.response;
  const { jobId } = await params;
  try {
    const result = await advanceShoplingPriceAdjustmentBulkJob(auth.admin, jobId, auth.ownerId);
    return NextResponse.json(result);
  } catch (error) {
    return normalError("가격 인상·인하 Bulk 자동 진행 중 오류가 발생했습니다.", 500, "ADJUSTMENT_BULK_ADVANCE_FAILED", "adjustment_bulk.advance", error);
  }
}
