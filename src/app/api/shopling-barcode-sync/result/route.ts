import { NextResponse } from "next/server";
import { requireShoplingBarcodeSyncOperator } from "@/lib/shoplingBarcodeSyncAuth";
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
  return NextResponse.json(result, { status: result.status === "error" ? 400 : 200 });
}
