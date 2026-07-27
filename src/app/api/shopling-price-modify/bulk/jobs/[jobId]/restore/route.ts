import { NextResponse } from "next/server";
import { normalError, normalSession, rpcData } from "@/lib/shoplingPriceModifyBulkApi";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const auth = await normalSession();
  if (auth.response) return auth.response;
  let body: unknown;
  try { body = await request.json(); } catch { return normalError("확인 문구가 필요합니다.", 400, "RESTORE_BODY_INVALID", "restore.body"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return normalError("보관 해제 요청 형식이 올바르지 않습니다.", 400, "RESTORE_BODY_INVALID", "restore.body");
  if ((body as { confirmation?: unknown }).confirmation !== "CONFIRM_BULK_RESTORE") return normalError("보관 해제 확인 문구가 일치하지 않습니다.", 400, "RESTORE_CONFIRMATION_REQUIRED", "restore.confirmation");
  const { jobId } = await params;
  const result = await auth.admin!.rpc("restore_shopling_price_bulk_job", { p_job_id: jobId, p_owner_id: auth.ownerId });
  if (result.error) return normalError("작업 보관을 해제할 수 없습니다.", 409, "RESTORE_REJECTED", "restore.rpc", result.error);
  if (!result.data) return normalError("보관 해제 응답이 비어 있습니다.", 500, "RESTORE_RPC_EMPTY", "restore.rpc");
  return NextResponse.json({ ...rpcData(result.data), message: "Bulk 작업 보관을 해제했습니다." });
}
