import {
  recordInternalChinaMonthlyPurchaseClose,
  type InternalChinaMonthlyPurchaseCloseInput,
} from "@/lib/internalChinaMonthlyPurchaseClose";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function unauthorized() {
  return Response.json(
    {
      ok: false,
      code: "INTERNAL_CHINA_MONTHLY_CLOSE_UNAUTHORIZED",
      message: "Ops Center 동일 출처 화면에서만 월 발주 사이클을 마감할 수 있습니다.",
    },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  try {
    const input = (await request.json()) as InternalChinaMonthlyPurchaseCloseInput;
    const result = await recordInternalChinaMonthlyPurchaseClose(input);
    return Response.json(
      {
        ok: true,
        result: result.summary,
        message: result.duplicate
          ? `${result.summary.cycleMonth} 발주 사이클은 이미 마감되어 있습니다.`
          : `${result.summary.cycleMonth} 발주 사이클을 마감했습니다. 미사용 예산은 추가 발주에 쓰지 않으며, 이미 주문한 품목의 입고·실제 원가·자금 마감은 계속 진행됩니다.${
              result.summary.releasedUnorderedLineCount
                ? ` 미주문 Draft ${result.summary.releasedUnorderedLineCount}개 줄 · ${result.summary.releasedUnorderedQuantity.toLocaleString("ko-KR")}개 약정도 해제했습니다.`
                : ""
            }`,
      },
      {
        status: result.duplicate ? 200 : 201,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    const raw =
      error instanceof Error
        ? error.message
        : "INTERNAL_CHINA_MONTHLY_CLOSE_FAILED";
    const code = raw.split(":", 1)[0] || "INTERNAL_CHINA_MONTHLY_CLOSE_FAILED";
    const conflict = [
      "INTERNAL_CHINA_MONTHLY_CLOSE_CURRENT_ONLY",
      "INTERNAL_CHINA_MONTHLY_CLOSE_VERIFY_FAILED",
    ].includes(code);
    return Response.json(
      {
        ok: false,
        code,
        message:
          code === "INTERNAL_CHINA_MONTHLY_CLOSE_CURRENT_ONLY"
            ? "현재 달의 발주 사이클만 수동 마감할 수 있습니다."
            : code === "INTERNAL_CHINA_MONTHLY_CLOSE_REASON_REQUIRED"
              ? "마감 사유를 선택하세요."
              : code === "INTERNAL_CHINA_MONTHLY_CLOSE_BUDGET_UNAVAILABLE"
                ? "직전월 정상매출 기준 예산을 확인하지 못해 마감을 중단했습니다."
                : code === "INTERNAL_CHINA_MONTHLY_CLOSE_LEDGER_UNAVAILABLE"
                  ? "발주·입고 원장을 확인하지 못해 마감을 안전하게 중단했습니다."
                  : code === "INTERNAL_CHINA_MONTHLY_CLOSE_VERIFY_FAILED"
                    ? "마감 저장 후 검증에 실패했습니다. 원장을 새로고침한 뒤 상태를 확인하세요."
                    : "월 발주 사이클 마감 조건을 확인하지 못했습니다.",
      },
      {
        status: conflict ? 409 : 400,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
