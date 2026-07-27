import { NextResponse } from "next/server";
import { normalError, normalSession, rpcData } from "@/lib/shoplingPriceModifyBulkApi";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const auth = await normalSession();
  if (auth.response) return auth.response;
  let body: unknown;
  try { body = await request.json(); } catch { return normalError("확인 문구가 필요합니다.", 400, "ARCHIVE_BODY_INVALID", "archive.body"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return normalError("작업 보관 요청 형식이 올바르지 않습니다.", 400, "ARCHIVE_BODY_INVALID", "archive.body");
  const input = body as { confirmation?: unknown; note?: unknown };
  if (input.confirmation !== "CONFIRM_BULK_ARCHIVE") return normalError("작업 보관 확인 문구가 일치하지 않습니다.", 400, "ARCHIVE_CONFIRMATION_REQUIRED", "archive.confirmation");
  const { jobId } = await params;
  const result = await auth.admin!.rpc("archive_shopling_price_bulk_job", {
    p_job_id: jobId,
    p_owner_id: auth.ownerId,
    p_note: typeof input.note === "string" ? input.note.slice(0, 500) : null,
  });
  if (result.error) return normalError("작업을 보관할 수 없습니다.", 409, "ARCHIVE_REJECTED", "archive.rpc", result.error);
  if (!result.data) return normalError("작업 보관 응답이 비어 있습니다.", 500, "ARCHIVE_RPC_EMPTY", "archive.rpc");
  return NextResponse.json({ ...rpcData(result.data), message: "Bulk 작업을 안전하게 보관했습니다. 데이터는 삭제되지 않았습니다." });
}
