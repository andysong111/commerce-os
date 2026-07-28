import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type OperatorAuthResult =
  | { response: NextResponse; userId?: never; email?: never }
  | { response?: undefined; userId: string; email: string };

function allowedOperatorEmails() {
  const raw =
    process.env.SHOPLING_BARCODE_SYNC_ALLOWED_EMAILS?.trim() ||
    process.env.OPS_OWNER_EMAILS?.trim() ||
    "";
  return new Set(
    raw
      .split(/[\s,;]+/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function requireShoplingBarcodeSyncOperator(): Promise<OperatorAuthResult> {
  if (process.env.SHOPLING_BARCODE_SYNC_ENABLED !== "1") {
    return {
      response: NextResponse.json(
        { status: "error", message: "샵플링 옵션 바코드 동기화 기능이 비활성화되어 있습니다." },
        { status: 503 },
      ),
    };
  }

  const allowedEmails = allowedOperatorEmails();
  if (allowedEmails.size === 0) {
    return {
      response: NextResponse.json(
        {
          status: "error",
          message:
            "SHOPLING_BARCODE_SYNC_ALLOWED_EMAILS 또는 OPS_OWNER_EMAILS 설정이 필요합니다.",
        },
        { status: 503 },
      ),
    };
  }

  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return {
        response: NextResponse.json(
          { status: "error", message: "Supabase 서버 인증 설정이 필요합니다." },
          { status: 503 },
        ),
      };
    }

    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      return {
        response: NextResponse.json(
          { status: "error", message: "로그인이 필요합니다." },
          { status: 401 },
        ),
      };
    }

    const email = data.user.email?.trim().toLowerCase() || "";
    if (!email || !allowedEmails.has(email)) {
      return {
        response: NextResponse.json(
          { status: "error", message: "이 기능을 실행할 권한이 없습니다." },
          { status: 403 },
        ),
      };
    }

    return { userId: data.user.id, email };
  } catch {
    return {
      response: NextResponse.json(
        { status: "error", message: "로그인 세션을 확인할 수 없습니다." },
        { status: 500 },
      ),
    };
  }
}
