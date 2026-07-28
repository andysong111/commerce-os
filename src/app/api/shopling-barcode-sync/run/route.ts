import { NextResponse } from "next/server";
import { requireShoplingBarcodeSyncOperator } from "@/lib/shoplingBarcodeSyncAuth";
import { evaluateShoplingBarcodeSyncCanary } from "@/lib/shoplingBarcodeSyncCanaryGate";
import {
  dispatchShoplingBarcodeSyncActions,
  fetchShoplingBarcodeSyncActionsResult,
  isValidShoplingBarcodeSyncRequestId,
  type ShoplingBarcodeSyncApplyScope,
  type ShoplingBarcodeSyncMode,
} from "@/lib/shoplingBarcodeSyncRunner";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireShoplingBarcodeSyncOperator();
  if (auth.response) return auth.response;

  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return NextResponse.json(
      { status: "error", message: "요청 JSON을 읽을 수 없습니다." },
      { status: 400 },
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return NextResponse.json(
      { status: "error", message: "요청 본문은 JSON 객체여야 합니다." },
      { status: 400 },
    );
  }
  const body = value as Record<string, unknown>;
  const mode = typeof body.mode === "string" ? body.mode : "";

  if (mode === "apply") {
    const canaryRequestId =
      typeof body.canary_request_id === "string" ? body.canary_request_id.trim() : "";
    if (!isValidShoplingBarcodeSyncRequestId(canaryRequestId)) {
      return NextResponse.json(
        {
          status: "error",
          message: "전체 반영 전에 성공한 10개 테스트의 요청 추적 ID가 필요합니다.",
        },
        { status: 409 },
      );
    }

    const canaryResult = await fetchShoplingBarcodeSyncActionsResult(canaryRequestId);
    const gate = evaluateShoplingBarcodeSyncCanary(canaryResult);
    if (!gate.ok) {
      return NextResponse.json(
        { status: "error", message: gate.message, canaryRequestId },
        { status: 409 },
      );
    }
  }

  const result = await dispatchShoplingBarcodeSyncActions({
    mode: mode as ShoplingBarcodeSyncMode,
    apply_scope:
      typeof body.apply_scope === "string"
        ? (body.apply_scope as ShoplingBarcodeSyncApplyScope)
        : undefined,
    target_goods_keys: typeof body.target_goods_keys === "string" ? body.target_goods_keys : "",
    confirm_text: typeof body.confirm_text === "string" ? body.confirm_text : "",
    canary_count: typeof body.canary_count === "number" ? body.canary_count : 10,
  });

  return NextResponse.json(result, { status: result.status === "queued" ? 200 : 400 });
}
