import { loadFastPurchaseCashEnvelope } from "@/lib/fastPurchaseCashEnvelope";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

function unauthorized() {
  return Response.json(
    {
      ok: false,
      code: "FAST_PURCHASE_CASH_ENVELOPE_UNAUTHORIZED",
      message: "Ops Center 동일 출처 화면에서만 현금 제약 발주안을 계산할 수 있습니다.",
    },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  try {
    const input = (await request.json().catch(() => ({}))) as {
      cashKrw?: unknown;
    };
    const report = await loadFastPurchaseCashEnvelope(input.cashKrw);
    return Response.json(
      { ok: report.state === "READY", report },
      {
        status: report.state === "READY" ? 200 : 409,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    const raw =
      error instanceof Error
        ? error.message
        : "FAST_PURCHASE_CASH_ENVELOPE_FAILED";
    const code = raw.split(":", 1)[0] || "FAST_PURCHASE_CASH_ENVELOPE_FAILED";
    return Response.json(
      {
        ok: false,
        code,
        message:
          code === "FAST_PURCHASE_CASH_ENVELOPE_AMOUNT_INVALID"
            ? "실제 투입 가능한 현금을 1원 이상 1억원 이하로 입력하세요."
            : "현금 제약 발주안을 계산하지 못했습니다. 원본 발주 데이터가 정상인지 확인한 뒤 다시 시도하세요.",
      },
      {
        status: code === "FAST_PURCHASE_CASH_ENVELOPE_AMOUNT_INVALID" ? 400 : 503,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
