import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { BulkAdmin } from "@/lib/shoplingPriceModifyBulkApi";

export const DEFAULT_SHOPLING_PRICE_ADJUSTMENT_OPERATOR_EMAIL =
  "andy0801a@gmail.com";

type Operator = {
  userId: string;
  email: string;
};

type AuthFailure = {
  ok: false;
  response: NextResponse;
};

type OperatorAuthResult =
  | AuthFailure
  | {
      ok: true;
      operator: Operator;
    };

type AdminAuthResult =
  | AuthFailure
  | {
      ok: true;
      operator: Operator;
      ownerId: string;
      admin: BulkAdmin;
    };

export function shoplingPriceAdjustmentOperatorEmails(
  env: NodeJS.ProcessEnv = process.env,
) {
  const raw =
    env.SHOPLING_PRICE_ADJUSTMENT_ALLOWED_EMAILS?.trim() ||
    env.OPS_OWNER_EMAILS?.trim() ||
    DEFAULT_SHOPLING_PRICE_ADJUSTMENT_OPERATOR_EMAIL;
  return new Set(
    raw
      .split(/[\s,;]+/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isShoplingPriceAdjustmentOperatorEmail(
  email: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
) {
  const normalized = email?.trim().toLowerCase() ?? "";
  return (
    normalized.length > 0 &&
    shoplingPriceAdjustmentOperatorEmails(env).has(normalized)
  );
}

export function readShoplingPriceAdjustmentBearerToken(
  headers: Headers,
) {
  const authorization = headers.get("authorization");
  if (authorization === null) {
    return { present: false as const, token: null };
  }
  const match = authorization.match(/^Bearer ([A-Za-z0-9._~-]+)$/);
  return match
    ? { present: true as const, token: match[1] }
    : { present: true as const, token: null };
}

function authFailure(
  error: string,
  status: number,
  code: string,
) {
  return {
    ok: false as const,
    response: NextResponse.json(
      {
        error,
        message: error,
        code,
        stage: "price_adjustment.auth",
      },
      { status },
    ),
  };
}

export async function requireShoplingPriceAdjustmentOperator(
  request: Request,
): Promise<OperatorAuthResult> {
  const config = getSupabasePublicConfig();
  if (!config.ok) {
    return authFailure(
      "Supabase 서버 인증 설정이 필요합니다.",
      503,
      "PRICE_ADJUSTMENT_AUTH_CONFIGURATION_ERROR",
    );
  }

  const bearer = readShoplingPriceAdjustmentBearerToken(request.headers);
  let user: { id: string; email?: string } | null = null;
  let authError: { message: string } | null = null;

  try {
    if (bearer.present) {
      if (!bearer.token) {
        return authFailure(
          "로그인이 필요합니다.",
          401,
          "PRICE_ADJUSTMENT_AUTH_REQUIRED",
        );
      }
      const supabase = createClient(config.url, config.publicKey, {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
      });
      const result = await supabase.auth.getUser(bearer.token);
      user = result.data.user;
      authError = result.error;
    } else {
      const supabase = await createSupabaseServerClient();
      if (!supabase) {
        return authFailure(
          "Supabase 서버 인증 설정이 필요합니다.",
          503,
          "PRICE_ADJUSTMENT_AUTH_CONFIGURATION_ERROR",
        );
      }
      const result = await supabase.auth.getUser();
      user = result.data.user;
      authError = result.error;
    }
  } catch {
    return authFailure(
      "로그인 세션을 확인할 수 없습니다.",
      401,
      "PRICE_ADJUSTMENT_AUTH_REQUIRED",
    );
  }

  if (authError || !user) {
    return authFailure(
      "로그인이 필요합니다.",
      401,
      "PRICE_ADJUSTMENT_AUTH_REQUIRED",
    );
  }
  const email = user.email?.trim().toLowerCase() ?? "";
  if (!isShoplingPriceAdjustmentOperatorEmail(email)) {
    return authFailure(
      "샵플링 가격 변경을 실행할 권한이 없습니다.",
      403,
      "PRICE_ADJUSTMENT_OPERATOR_REQUIRED",
    );
  }
  return {
    ok: true,
    operator: {
      userId: user.id,
      email,
    },
  };
}

export async function requireShoplingPriceAdjustmentAdmin(
  request: Request,
): Promise<AdminAuthResult> {
  const authenticated =
    await requireShoplingPriceAdjustmentOperator(request);
  if (!authenticated.ok) return authenticated;

  try {
    const admin = await createSupabaseAdminClient();
    if (!admin) {
      return authFailure(
        "Supabase 서버 설정이 필요합니다.",
        503,
        "PRICE_ADJUSTMENT_ADMIN_CONFIGURATION_ERROR",
      );
    }
    return {
      ok: true,
      operator: authenticated.operator,
      ownerId: authenticated.operator.userId,
      admin: admin as BulkAdmin,
    };
  } catch {
    return authFailure(
      "관리자 클라이언트를 생성할 수 없습니다.",
      500,
      "PRICE_ADJUSTMENT_ADMIN_CLIENT_FAILED",
    );
  }
}
