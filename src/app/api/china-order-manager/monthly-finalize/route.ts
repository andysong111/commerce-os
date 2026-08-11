import {
  consolidateMonthlyPurchaseDrafts,
  type MonthlyPurchaseConsolidationInput,
} from "@/lib/monthlyPurchaseDraftConsolidation";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function unauthorized() {
  return Response.json(
    {
      ok: false,
      code: "MONTHLY_PURCHASE_FINAL_UNAUTHORIZED",
      message: "Ops Center 동일 출처 화면에서만 월간 최종 Draft를 정리할 수 있습니다.",
    },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  try {
    const input = (await request.json()) as MonthlyPurchaseConsolidationInput;
    const result = await consolidateMonthlyPurchaseDrafts(input);
    return Response.json(
      {
        ok: true,
        result,
        message: result.duplicate
          ? "동일한 월간 최종 Draft가 이미 존재합니다."
          : `${result.cycleMonth} 기존 Draft ${result.supersededDraftIds.length}건을 닫고 ${result.lineCount} SKU · ${result.totalQuantity.toLocaleString("ko-KR")}개의 월간 최종 Draft로 정리했습니다. 실제 1688 주문·결제는 실행하지 않았습니다.`,
      },
      {
        status: result.duplicate ? 200 : 201,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    const raw = error instanceof Error ? error.message : "MONTHLY_PURCHASE_FINAL_FAILED";
    const code = raw.split(":", 1)[0] || "MONTHLY_PURCHASE_FINAL_FAILED";
    const conflict = [
      "MONTHLY_PURCHASE_FINAL_CURRENT_CYCLE_ONLY",
      "MONTHLY_PURCHASE_FINAL_BASE_DRAFT_NOT_ACTIVE",
      "MONTHLY_PURCHASE_FINAL_MULTIPLE_DRAFTS_REQUIRED",
      "MONTHLY_PURCHASE_FINAL_SOURCE_ALREADY_PROGRESSING",
    ].includes(code);
    return Response.json(
      {
        ok: false,
        code,
        message:
          code === "MONTHLY_PURCHASE_FINAL_CURRENT_CYCLE_ONLY"
            ? "현재 달의 미주문 내부 Draft만 최종 정리할 수 있습니다."
            : code === "MONTHLY_PURCHASE_FINAL_BASE_DRAFT_NOT_ACTIVE"
              ? "기준 Draft가 더 이상 활성 상태가 아닙니다. 원장을 새로고침하세요."
              : code === "MONTHLY_PURCHASE_FINAL_MULTIPLE_DRAFTS_REQUIRED"
                ? "활성 Draft가 이미 1건으로 정리되어 추가 통합이 필요하지 않습니다."
                : code === "MONTHLY_PURCHASE_FINAL_SOURCE_ALREADY_PROGRESSING"
                  ? "일부 Draft가 이미 주문 전송·실주문·입고 단계로 진행되어 자동 통합을 차단했습니다."
                  : code === "MONTHLY_PURCHASE_FINAL_LEDGER_UNAVAILABLE"
                    ? "발주·입고 원장을 확인하지 못해 월간 최종화를 안전하게 중단했습니다."
                    : code === "MONTHLY_PURCHASE_FINAL_QUANTITY_INVALID"
                      ? "최종 주문수량은 SKU당 1~9,999개 범위로 입력하세요."
                      : "월간 최종 Draft 정리 조건을 확인하지 못했습니다.",
      },
      {
        status: conflict ? 409 : 400,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
