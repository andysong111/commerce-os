import { runProductLifecycleRefresh } from "@/lib/productLifecycleEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.trim();
  return Boolean(expected && supplied === `Bearer ${expected}`);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json(
      { ok: false, code: "UNAUTHORIZED" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const summary = await runProductLifecycleRefresh();
    return Response.json(
      {
        ok: true,
        ...summary,
        gradeSystemUsed: false,
        shoplingDirectWrites: false,
        message:
          summary.mode === "shadow"
            ? "상품 생애주기·슬롯 판단과 Shopling 작업 큐를 그림자 생성했습니다. 실제 판매중/품절/삭제와 발주 차단은 아직 실행하지 않습니다."
            : "상품 생애주기 정책을 운영 모드로 계산했습니다. Shopling 작업은 브라우저 실행 큐가 처리합니다.",
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_LIFECYCLE_REFRESH_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "상품 생애주기·슬롯 최적화 계산을 완료하지 못했습니다.",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
