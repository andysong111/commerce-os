import { recordInternalChinaForwarderCost } from "@/lib/internalChinaForwarderCost";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

function errorResponse(error: unknown) {
  const raw =
    error instanceof Error ? error.message : "CHINA_FORWARDER_COST_FAILED";
  const code = raw.split(":", 1)[0] || "CHINA_FORWARDER_COST_FAILED";
  let message = raw;
  if (code === "CHINA_FORWARDER_COST_DRAFT_INVALID") {
    message = "배송대행 비용을 마감할 발주 Draft 번호가 올바르지 않습니다.";
  } else if (code === "CHINA_FORWARDER_COST_CYCLE_MONTH_INVALID") {
    message = "발주·입고 사이클 월을 확인하세요.";
  } else if (code === "CHINA_FORWARDER_COST_AMOUNT_REQUIRED") {
    message = "배송대행지에서 실제로 청구된 총비용을 원 단위로 입력하세요.";
  } else if (code === "CHINA_FORWARDER_COST_AMOUNT_EXCEEDED") {
    message = "배송대행지 실제비용이 허용 범위를 초과했습니다.";
  } else if (code === "CHINA_FORWARDER_COST_DRAFT_NOT_FOUND") {
    message = "해당 발주 Draft의 주문·입고 원장을 찾지 못했습니다.";
  } else if (code === "CHINA_FORWARDER_COST_RECEIPT_OPEN") {
    message = `남은 미입고 ${Number(raw.split(":")[1] ?? 0).toLocaleString("ko-KR")}개를 먼저 입고확정한 뒤 배송대행 비용을 마감하세요.`;
  } else if (code === "CHINA_FORWARDER_COST_CYCLE_MONTH_CONFLICT") {
    message = "화면의 발주월과 실제 발주 Draft의 월이 다릅니다. 새로고침 후 다시 시도하세요.";
  }
  return Response.json(
    { ok: false, code, message },
    {
      status: code === "CHINA_FORWARDER_COST_DRAFT_NOT_FOUND" ? 404 : 400,
      headers: { "cache-control": "no-store" },
    },
  );
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) {
    return Response.json(
      {
        ok: false,
        code: "CHINA_FORWARDER_COST_UNAUTHORIZED",
        message:
          "Ops Center 동일 출처 화면에서만 배송대행 비용을 마감할 수 있습니다.",
      },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const result = await recordInternalChinaForwarderCost(
      await request.json().catch(() => ({})),
    );
    return Response.json(
      {
        ok: true,
        result,
        message: `배송대행지 실제비용 ${result.actualCostKrw?.toLocaleString("ko-KR")}원을 ${result.cycleMonth} 월 발주비용으로 별도 마감했습니다. 상품 매입원가·판매가·상품등급 계산에는 합산하지 않습니다.`,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
