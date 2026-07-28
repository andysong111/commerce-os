import { NextResponse } from "next/server";
import { requireShoplingBarcodeSyncOperator } from "@/lib/shoplingBarcodeSyncAuth";
import {
  SHOPLING_BARCODE_SYNC_CANARY_COOKIE,
  evaluateShoplingBarcodeSyncCanary,
} from "@/lib/shoplingBarcodeSyncCanaryGate";
import {
  fetchShoplingBarcodeSyncActionsResult,
  isValidShoplingBarcodeSyncRequestId,
} from "@/lib/shoplingBarcodeSyncRunner";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireShoplingBarcodeSyncOperator();
  if (auth.response) return auth.response;

  const requestId = new URL(request.url).searchParams.get("request_id")?.trim() || "";
  if (!requestId || !isValidShoplingBarcodeSyncRequestId(requestId)) {
    return NextResponse.json(
      { status: "error", message: "요청 추적 ID 형식이 올바르지 않습니다.", requestId },
      { status: 400 },
    );
  }

  const result = await fetchShoplingBarcodeSyncActionsResult(requestId);
  const canaryGate = evaluateShoplingBarcodeSyncCanary(result);
  const response = NextResponse.json(
    {
      ...result,
      message: canaryGate.ok
        ? `${result.message || "10개 테스트가 완료되었습니다."} 전체 반영 잠금이 해제되었습니다.`
        : result.message,
      canaryGatePassed: canaryGate.ok,
      canaryGateMessage: canaryGate.message,
    },
    { status: result.status === "error" ? 400 : 200 },
  );
  if (canaryGate.ok) {
    response.cookies.set(SHOPLING_BARCODE_SYNC_CANARY_COOKIE, requestId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60,
      path: "/api/shopling-barcode-sync",
    });
  }
  return response;
}
