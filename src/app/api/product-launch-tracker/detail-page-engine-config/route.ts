import { NextRequest } from "next/server";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import {
  probeDetailPageStudio,
  probeProtectedOpsCallback,
  resolveDetailPageStudioConnection,
} from "@/lib/detailPageStudioConnection";

export async function GET(request: NextRequest) {
  if (!isSameOriginOpsRequest(request)) {
    return Response.json(
      {
        ok: false,
        code: "SAME_ORIGIN_REQUIRED",
        message: "OPS Center 화면에서만 상세페이지 엔진 설정을 읽을 수 있습니다.",
      },
      { status: 403 },
    );
  }

  try {
    const connection = resolveDetailPageStudioConnection();

    // The product-launch button only needs the stable Studio URLs in order to
    // register a job and open the hidden Studio frame. Running two network
    // health probes synchronously here can leave the browser showing
    // "연결 확인 중" until an upstream request times out even though no job has
    // been created. The real collection frame already has a 20-second
    // handshake timeout, and the server worker reports its own start failure,
    // so normal launches must not be blocked by this diagnostic probe.
    //
    // Keep the probes available for explicit diagnostics without putting them
    // on the paid/normal launch path.
    const diagnosticProbe = request.nextUrl.searchParams.get("probe") === "1";
    if (diagnosticProbe) {
      const [studioProbe, callbackProbe] = await Promise.all([
        probeDetailPageStudio(connection),
        probeProtectedOpsCallback(request.url),
      ]);
      if (!studioProbe.ok) return Response.json(studioProbe, { status: 503 });
      if (!callbackProbe.ok) return Response.json(callbackProbe, { status: 503 });
    }

    return Response.json({
      ok: true,
      engineUrl: connection.browserUrl.toString(),
      engineOrigin: connection.engineOrigin,
      workerUrl: connection.workerUrl.toString(),
      connectionMode: connection.isPreview ? "preview" : "production",
      diagnosticProbe,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "INVALID_DETAIL_PAGE_STUDIO_URL",
        message:
          error instanceof Error
            ? error.message
            : "상세페이지 Studio 연결 주소가 올바르지 않습니다.",
      },
      { status: 503 },
    );
  }
}
