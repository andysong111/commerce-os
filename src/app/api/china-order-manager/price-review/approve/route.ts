import { approveInternalChinaCostPriceProposal } from "@/lib/internalChinaCostPriceReview";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) {
    return Response.json(
      {
        ok: false,
        code: "INTERNAL_CHINA_COST_PRICE_APPROVAL_UNAUTHORIZED",
        message: "Ops Center 동일 출처 화면에서만 가격조정안을 승인할 수 있습니다.",
      },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const approval = await approveInternalChinaCostPriceProposal(
      await request.json().catch(() => ({})),
    );
    return Response.json(
      {
        ok: true,
        approval,
        message:
          "가격조정안 승인을 기록했습니다. 이 단계에서는 Shopling 판매가격을 변경하지 않습니다.",
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const raw =
      error instanceof Error
        ? error.message
        : "INTERNAL_CHINA_COST_PRICE_APPROVAL_FAILED";
    const code = raw.split(":", 1)[0] || "INTERNAL_CHINA_COST_PRICE_APPROVAL_FAILED";
    const message =
      code === "INTERNAL_CHINA_COST_PRICE_PROPOSAL_STALE"
        ? "화면의 가격조정안이 최신안과 다릅니다. 새로고침 후 다시 확인하세요."
        : code === "INTERNAL_CHINA_COST_PRICE_PROPOSAL_NOT_FOUND"
          ? "승인할 가격조정안을 찾지 못했습니다."
          : code === "INTERNAL_CHINA_COST_PRICE_PROPOSAL_NOT_APPROVABLE"
            ? "현재 가격조정안은 승인대기 상태가 아닙니다."
            : raw;
    return Response.json(
      { ok: false, code, message },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}
