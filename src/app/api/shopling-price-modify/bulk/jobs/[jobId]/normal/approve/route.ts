import { NextResponse } from "next/server";
import { normalError, normalSession, requireManualShoplingPriceBulkJob, rpcData } from "@/lib/shoplingPriceModifyBulkApi";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const auth = await normalSession(); if (auth.response) return auth.response;
  let body: unknown; try { body = await request.json(); } catch { return normalError("확인 값이 올바르지 않습니다.",400,"INVALID_CONFIRMATION","normal.approve.validation"); }
  if (!body || typeof body !== "object" || (body as Record<string, unknown>).confirmation !== "CONFIRM_NORMAL_BULK_EXECUTION") return normalError("확인 값이 올바르지 않습니다.",400,"INVALID_CONFIRMATION","normal.approve.validation");
  const { jobId } = await params;
  const manual=await requireManualShoplingPriceBulkJob(auth.admin!,jobId,auth.ownerId,"normal.approve");if(manual.response)return manual.response;
  const result = await auth.admin!.rpc("approve_shopling_price_bulk_normal_execution", { p_job_id: jobId, p_owner_id: auth.ownerId });
  if (result.error || !result.data) return normalError("일반 청크 실행을 승인할 수 없습니다.",409,"NORMAL_APPROVAL_REJECTED","normal.approve.rpc",result.error);
  const data=rpcData(result.data);
  return NextResponse.json({ ...data, message:"일반 청크 직렬 실행이 승인되었습니다.\n한 번에 한 청크만 실행하며 실패 또는 불확실 상태에서는 자동 중단됩니다." });
}
