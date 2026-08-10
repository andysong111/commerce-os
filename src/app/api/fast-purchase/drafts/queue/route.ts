import { queueFastPurchaseDraftForChina } from "@/lib/fastPurchaseDraftHandoff";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) {
    return Response.json(
      {
        ok: false,
        code: "FAST_PURCHASE_HANDOFF_UNAUTHORIZED",
        message: "Ops Center 동일 출처 화면에서만 중국 주문초안 전달을 시작할 수 있습니다.",
      },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    const body = (await request.json().catch(() => ({}))) as { draftId?: unknown };
    const handoff = await queueFastPurchaseDraftForChina(body.draftId);
    return Response.json(
      {
        ok: true,
        handoff,
        message: handoff.alreadyImported
          ? "이미 중국 주문초안으로 반영된 내부 Draft입니다."
          : handoff.alreadyQueued
            ? "이미 중국 주문초안 전달 대기열에 있습니다."
            : "중국 주문초안 전달 대기열에 저장했습니다. 실제 1688 주문·결제는 실행하지 않았습니다.",
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const code = error instanceof Error ? error.message.split(":", 1)[0] : "FAST_PURCHASE_HANDOFF_FAILED";
    return Response.json(
      {
        ok: false,
        code,
        message:
          code === "FAST_PURCHASE_HANDOFF_NO_OPEN_QUANTITY"
            ? "현재 미입고 수량이 없어 중국 주문초안으로 전달할 항목이 없습니다."
            : code === "FAST_PURCHASE_HANDOFF_ALREADY_PROGRESSING"
              ? "이미 주문 또는 입고가 진행 중인 내부 Draft라 새 주문초안으로 전달하지 않습니다."
              : "중국 주문초안 전달 조건을 확인하지 못했습니다.",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}
