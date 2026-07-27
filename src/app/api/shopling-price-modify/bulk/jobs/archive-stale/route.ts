import { NextResponse } from "next/server";
import { normalError, normalSession, rpcData } from "@/lib/shoplingPriceModifyBulkApi";

export const runtime = "nodejs";
const ALLOWED_DAYS = new Set([7, 14, 30, 60, 90]);

export async function POST(request: Request) {
  const auth = await normalSession();
  if (auth.response) return auth.response;
  let body: unknown;
  try { body = await request.json(); } catch { return normalError("확인 문구가 필요합니다.", 400, "STALE_ARCHIVE_BODY_INVALID", "archive_stale.body"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return normalError("오래된 작업 보관 요청 형식이 올바르지 않습니다.", 400, "STALE_ARCHIVE_BODY_INVALID", "archive_stale.body");
  }
  const input = body as { confirmation?: unknown; older_than_days?: unknown };
  const days = Number(input.older_than_days);
  if (input.confirmation !== "CONFIRM_ARCHIVE_STALE_PREPARED") return normalError("오래된 작업 보관 확인 문구가 일치하지 않습니다.", 400, "STALE_ARCHIVE_CONFIRMATION_REQUIRED", "archive_stale.confirmation");
  if (!ALLOWED_DAYS.has(days)) return normalError("보관 기준일은 7, 14, 30, 60, 90일 중 하나여야 합니다.", 400, "STALE_ARCHIVE_DAYS_INVALID", "archive_stale.days");
  const result = await auth.admin!.rpc("archive_stale_shopling_price_bulk_jobs", { p_owner_id: auth.ownerId, p_older_than_days: days });
  if (result.error) return normalError("오래된 준비·검증 작업 보관에 실패했습니다.", 500, "STALE_ARCHIVE_RPC_FAILED", "archive_stale.rpc", result.error);
  if (!result.data) return normalError("오래된 작업 보관 응답이 비어 있습니다.", 500, "STALE_ARCHIVE_RPC_EMPTY", "archive_stale.rpc");
  const state = rpcData(result.data);
  return NextResponse.json({ ...state, message: `오래된 준비·검증 작업 ${Number(state.archived_count ?? 0)}개를 보관했습니다.` });
}
