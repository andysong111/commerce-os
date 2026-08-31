export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST() {
  return Response.json(
    {
      ok: false,
      code: "INTERNAL_CHINA_COST_PRICE_V1_RETIRED",
      message:
        "기존 실제원가 전용 V1 가격조정안은 상품그룹 정책 V2로 교체되었습니다. /china-order-manager/price-review에서 최신 V2를 확인하세요.",
      shoplingPriceWritesEnabled: false,
    },
    { status: 410, headers: { "cache-control": "no-store" } },
  );
}
