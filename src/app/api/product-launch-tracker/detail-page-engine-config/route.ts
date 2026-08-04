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
    const [studioProbe, callbackProbe] = await Promise.all([
      probeDetailPageStudio(connection),
      probeProtectedOpsCallback(request.url),
    ]);
    if (!studioProbe.ok) return Response.json(studioProbe, { status: 503 });
    if (!callbackProbe.ok) return Response.json(callbackProbe, { status: 503 });
    return Response.json({
      ok: true,
      engineUrl: connection.browserUrl.toString(),
      engineOrigin: connection.engineOrigin,
      workerUrl: connection.workerUrl.toString(),
      connectionMode: connection.isPreview ? "preview" : "production",
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
