import {
  createFastPurchaseInternalDraft,
  loadFastPurchaseInternalDrafts,
  type FastPurchaseInternalDraftInput,
} from "@/lib/fastPurchaseInternalDraft";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function unauthorized() {
  return Response.json(
    {
      ok: false,
      code: "FAST_PURCHASE_DRAFT_UNAUTHORIZED",
      message: "Ops Center 동일 출처 화면에서만 내부 발주 Draft를 사용할 수 있습니다.",
    },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  const result = await loadFastPurchaseInternalDrafts();
  return Response.json(
    {
      ok: !result.error,
      ...result,
      externalOrderExecuted: false,
    },
    {
      status: result.error ? 503 : 200,
      headers: { "cache-control": "no-store" },
    },
  );
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  try {
    const input = (await request.json()) as FastPurchaseInternalDraftInput;
    const draft = await createFastPurchaseInternalDraft(input);
    return Response.json(
      {
        ok: true,
        draft,
        message: draft.duplicate
          ? "동일한 내부 발주 Draft가 이미 저장되어 있어 중복 생성하지 않았습니다."
          : "내부 발주 Draft를 저장했습니다. 실제 중국 주문·결제는 실행하지 않았습니다.",
      },
      {
        status: draft.duplicate ? 200 : 201,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "FAST_PURCHASE_DRAFT_FAILED";
    const code = message.split(":", 1)[0] || "FAST_PURCHASE_DRAFT_FAILED";
    const conflict = [
      "FAST_PURCHASE_DRAFT_SOURCE_CHANGED",
      "FAST_PURCHASE_DRAFT_MODE_CHANGED",
      "FAST_PURCHASE_DRAFT_REFERENCE_CHANGED",
    ].includes(code);
    return Response.json(
      {
        ok: false,
        code,
        message:
          code === "FAST_PURCHASE_DRAFT_SOURCE_CHANGED" || code === "FAST_PURCHASE_DRAFT_MODE_CHANGED"
            ? "발주 기준 데이터가 변경되었습니다. 화면을 새로고침한 뒤 현재 기준으로 다시 확인하세요."
            : code === "FAST_PURCHASE_DRAFT_REFERENCE_CHANGED"
              ? "재고0 수요참고 값이 변경되었습니다. 화면을 새로고침한 뒤 다시 확인하세요."
              : code === "FAST_PURCHASE_DRAFT_QUANTITY_EXCEEDED"
                ? "주문 예정수량은 SKU당 최대 9,999개까지 입력할 수 있습니다."
                : "내부 발주 Draft 저장 조건을 확인하지 못했습니다.",
      },
      {
        status: conflict ? 409 : 400,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
