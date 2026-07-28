import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireShoplingBarcodeSyncOperator } from "@/lib/shoplingBarcodeSyncAuth";
import {
  SHOPLING_BARCODE_SYNC_CANARY_COOKIE,
  evaluateShoplingBarcodeSyncCanary,
} from "@/lib/shoplingBarcodeSyncCanaryGate";
import {
  dispatchShoplingBarcodeSyncActions,
  fetchShoplingBarcodeSyncActionsResult,
  isValidShoplingBarcodeSyncRequestId,
  type ShoplingBarcodeSyncApplyScope,
  type ShoplingBarcodeSyncMode,
} from "@/lib/shoplingBarcodeSyncRunner";
import { applyShoplingBarcodeSyncTokenFallback } from "@/lib/shoplingBarcodeSyncTokenFallback";

export const runtime = "nodejs";

export async function POST(request: Request) {
  applyShoplingBarcodeSyncTokenFallback();

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
    const bodyCanaryRequestId =
      typeof body.canary_request_id === "string" ? body.canary_request_id.trim() : "";
    const cookieStore = await cookies();
    const canaryRequestId =
      bodyCanaryRequestId || cookieStore.get(SHOPLING_BARCODE_SYNC_CANARY_COOKIE)?.value || "";
    if (!isValidShoplingBarcodeSyncRequestId(canaryRequestId)) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "전체 반영 전에 10개 테스트를 실행한 뒤 해당 실행의 결과 확인 버튼을 눌러야 합니다.",
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

  if (result.status === "error" && result.message.includes("status=404")) {
    return NextResponse.json(
      {
        ...result,
        message:
          "GitHub 토큰이 비공개 바코드 저장소 또는 workflow에 접근하지 못했습니다. SHOPLING_BARCODE_SYNC_ACTIONS_TOKEN이나 기존 GITHUB_ENGINE_DISPATCH_TOKEN의 저장소 권한을 확인하세요.",
      },
      { status: 400 },
    );
  }

  if (
    result.status === "error" &&
    /status=5\d\d/.test(result.message) &&
    result.requestId
  ) {
    return NextResponse.json(
      {
        ...result,
        status: "uncertain",
        message:
          "GitHub가 서버 오류를 반환했지만 실행이 생성됐을 수 있습니다. 같은 작업을 다시 누르지 말고 현재 실행 결과 확인으로 조회하세요.",
      },
      { status: 202 },
    );
  }

  return NextResponse.json(result, { status: result.status === "queued" ? 200 : 400 });
}
