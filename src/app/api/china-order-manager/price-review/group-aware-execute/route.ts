import { dispatchInternalChinaDirectTargetExecution } from "@/lib/internalChinaGroupCostPriceExecution";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) {
    return Response.json(
      {
        ok: false,
        code: "INTERNAL_CHINA_DIRECT_TARGET_EXECUTION_UNAUTHORIZED",
        message: "Ops Center 동일 출처 화면에서만 확정원가 목표가 적용을 실행할 수 있습니다.",
      },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    const result = await dispatchInternalChinaDirectTargetExecution(
      await request.json().catch(() => ({})),
    );
    return Response.json(
      {
        ok: true,
        ...result,
        message: result.duplicate
          ? "동일 가격조정안은 이미 Shopling 적용 작업으로 전송되어 중복 실행하지 않았습니다."
          : `확정원가 기준 목표가를 퍼센트 상한 없이 한 번에 적용하는 작업 ${result.receipt.batchCount.toLocaleString("ko-KR")}개 배치를 Shopling 실행기로 전송했습니다.`,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const raw =
      error instanceof Error
        ? error.message
        : "INTERNAL_CHINA_DIRECT_TARGET_EXECUTION_FAILED";
    const code = raw.split(":", 1)[0] || "INTERNAL_CHINA_DIRECT_TARGET_EXECUTION_FAILED";
    const message =
      code === "INTERNAL_CHINA_DIRECT_TARGET_APPROVAL_REQUIRED"
        ? "먼저 현재 상품그룹 가격조정안을 승인해야 합니다."
        : code === "INTERNAL_CHINA_DIRECT_TARGET_PROPOSAL_STALE"
          ? "승인한 가격조정안이 최신안과 다릅니다. 새로고침 후 다시 확인하세요."
          : code === "INTERNAL_CHINA_DIRECT_TARGET_BATCH_STATE_UNCERTAIN"
            ? "이전 Shopling 전송 결과가 불확실한 배치가 있어 중복 가격변경을 막기 위해 실행을 중단했습니다. 운영 이력을 확인하세요."
            : raw;
    return Response.json(
      { ok: false, code, message },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}
