import { NextResponse } from "next/server";
import { normalError, normalSession, rpcData } from "@/lib/shoplingPriceModifyBulkApi";

export const runtime = "nodejs";

const CONFIRMATION = "CONFIRM_AUTO_CONTINUE_AFTER_REVIEW";

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  if (process.env.VERCEL_ENV !== "production") {
    return normalError(
      "자동 가격 변경 재개는 Production에서만 실행할 수 있습니다.",
      403,
      "AUTO_CONTINUE_PRODUCTION_ONLY",
      "auto.continue.environment",
    );
  }
  if (!process.env.CRON_SECRET?.trim()) {
    return normalError(
      "자동 실행 서버 설정이 완료되지 않았습니다.",
      503,
      "AUTO_CRON_CONFIG_MISSING",
      "auto.continue.configuration",
    );
  }

  const auth = await normalSession();
  if (auth.response) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return normalError("확인 문구가 필요합니다.", 400, "INVALID_BODY", "auto.continue.body");
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || (body as { confirmation?: unknown }).confirmation !== CONFIRMATION) {
    return normalError("재개 확인 문구가 일치하지 않습니다.", 400, "CONFIRMATION_REQUIRED", "auto.continue.confirmation");
  }

  const { jobId } = await params;
  const continued = await auth.admin!.rpc("continue_shopling_price_bulk_auto_after_review", {
    p_job_id: jobId,
    p_owner_id: auth.ownerId,
  });

  if (continued.error || !continued.data) {
    return normalError(
      "현재 작업을 계속할 수 없습니다. 실행 중인 묶음이 없는지 확인한 뒤 다시 시도하세요.",
      409,
      "AUTO_CONTINUE_REJECTED",
      "auto.continue.rpc",
      continued.error ?? "continue_shopling_price_bulk_auto_after_review RPC가 빈 응답을 반환했습니다.",
    );
  }

  return NextResponse.json({
    ...rpcData(continued.data),
    message: "확인된 결과 다음부터 자동 가격 변경을 계속합니다. 이미 성공한 상품은 다시 실행하지 않습니다.",
  });
}
