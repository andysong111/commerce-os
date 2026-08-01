import { NextRequest } from "next/server";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

const DEFAULT_DETAIL_PAGE_STUDIO_URL =
  "https://commerce-os-detail-page-studio.vercel.app/";

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

  const configured =
    process.env.DETAIL_PAGE_STUDIO_INTERNAL_URL?.trim() ||
    process.env.NEXT_PUBLIC_DETAIL_PAGE_STUDIO_INTERNAL_URL?.trim() ||
    DEFAULT_DETAIL_PAGE_STUDIO_URL;
  const engineUrl = new URL(configured);
  if (engineUrl.protocol !== "https:" && engineUrl.hostname !== "localhost") {
    return Response.json(
      {
        ok: false,
        code: "INVALID_DETAIL_PAGE_STUDIO_URL",
        message: "상세페이지 엔진 연결 주소는 HTTPS여야 합니다.",
      },
      { status: 503 },
    );
  }

  return Response.json({
    ok: true,
    engineUrl: engineUrl.toString(),
    engineOrigin: engineUrl.origin,
  });
}
