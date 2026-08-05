import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import { runPriceGradeShadowComparisonWithReceiptCache } from "@/lib/priceGradeReceiptCacheShadow";
import { loadLatestPriceGradeShadowComparison } from "@/lib/priceGradeShadowComparison";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(request: Request) {
  return isSameOriginOpsRequest(request);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json(
      {
        ok: false,
        code: "PRICE_GRADE_SHADOW_UNAUTHORIZED",
        message: "상품등급 그림자 비교 상태를 조회할 권한이 필요합니다.",
      },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    return Response.json(
      {
        ok: true,
        result: await loadLatestPriceGradeShadowComparison(),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "PRICE_GRADE_SHADOW_STATUS_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "상품등급 그림자 비교 상태를 읽지 못했습니다.",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json(
      {
        ok: false,
        code: "PRICE_GRADE_SHADOW_UNAUTHORIZED",
        message: "상품등급 그림자 비교를 실행할 권한이 필요합니다.",
      },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    const result = await runPriceGradeShadowComparisonWithReceiptCache();
    return Response.json(
      {
        ok: true,
        accepted: true,
        result,
        message:
          "Product Master 원장과 Ops Center 최근 입고 3회 캐시를 자체 가격등급 엔진으로 재계산하고 비교 결과를 불변 원장에 저장했습니다.",
      },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "상품등급 그림자 비교에 실패했습니다.";
    const configurationError =
      /PRODUCT_MASTER|SUPABASE_ADMIN|PRICE_GRADE_INPUT/.test(message);
    return Response.json(
      {
        ok: false,
        code: configurationError
          ? "PRICE_GRADE_SHADOW_NOT_CONFIGURED"
          : "PRICE_GRADE_SHADOW_FAILED",
        message,
      },
      {
        status: configurationError ? 503 : 500,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
