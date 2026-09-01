import {
  ensureInternalChinaBrowserMallPriceReadback,
  loadInternalChinaBrowserMallPriceReadbackSummary,
} from "@/lib/internalChinaBrowserMallPriceReadback";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function unauthorized() {
  return Response.json(
    {
      ok: false,
      code: "INTERNAL_CHINA_BROWSER_PRICE_READBACK_UNAUTHORIZED",
      message: "Ops Center 동일 출처 화면에서만 Shopling 브라우저 가격 재검증을 제어할 수 있습니다.",
    },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  const url = new URL(request.url);
  const proposalFingerprint = text(url.searchParams.get("proposalFingerprint"));
  try {
    const summary = await loadInternalChinaBrowserMallPriceReadbackSummary(proposalFingerprint);
    return Response.json(
      { ok: true, summary },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error || "browser price readback status failed");
    return Response.json(
      { ok: false, code: raw.split(":", 1)[0], message: raw },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    const result = await ensureInternalChinaBrowserMallPriceReadback({
      proposalFingerprint: payload?.proposalFingerprint,
      delayMs: Number(payload?.delayMs ?? 0),
      retryFailed: payload?.retryFailed === true,
    });
    return Response.json(
      {
        ok: true,
        ...result,
        message:
          result.summary.state === "VERIFIED"
            ? "Shopling 브라우저 쇼핑몰별 가격 재검증이 이미 완료되어 있습니다."
            : `Shopling 브라우저 읽기 전용 가격 재검증 ${result.summary.goodsKeyCount.toLocaleString("ko-KR")} GOODSKEY · ${result.summary.mallCheckCount.toLocaleString("ko-KR")}개 쇼핑몰 가격을 대기열에 준비했습니다.`,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error || "browser price readback start failed");
    const code = raw.split(":", 1)[0];
    const message =
      code === "INTERNAL_CHINA_BROWSER_PRICE_READBACK_APPLY_REQUIRED"
        ? "먼저 확정원가 목표가 Shopling 적용 작업이 전송되어야 합니다."
        : code === "INTERNAL_CHINA_BROWSER_PRICE_READBACK_PROPOSAL_STALE"
          ? "현재 가격조정안과 재검증 요청안이 다릅니다. 새로고침 후 다시 확인하세요."
          : raw;
    return Response.json(
      { ok: false, code, message },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}
