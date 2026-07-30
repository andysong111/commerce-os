import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isOpsAuthCookieName } from "@/lib/supabase/session";
import {
  resolveShoplingPriceAdjustmentIdentity,
  type ShoplingPriceAdjustmentIdentityProbe,
} from "@/lib/shoplingPriceAdjustmentIdentity";
import { shoplingPriceAdjustmentPrivateHeaders } from "@/lib/shoplingPriceAdjustmentResponse";
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

function authFailure(
  error: string,
  status: number,
  code: string,
  detail?: string,
) {
  const diagnosticId = randomUUID();
  console.warn(`[price-adjustment-auth:${diagnosticId}]`, {
    code,
    status,
    detail: detail ?? null,
  });
  return {
    ok: false as const,
    response: NextResponse.json(
      {
        error,
        message: error,
        code,
        stage: "price_adjustment.auth",
        detail: detail ?? null,
        diagnostic_id: diagnosticId,
      },
      {
        status,
        headers: shoplingPriceAdjustmentPrivateHeaders(),
      },
    ),
  };
}

function safeAuthErrorReason(error: unknown) {
  if (!error || typeof error !== "object") return "unknown";
  const value = error as {
    code?: unknown;
    name?: unknown;
    status?: unknown;
  };
  if (
    typeof value.code === "string" &&
    /^[A-Za-z0-9_.-]{1,80}$/.test(value.code)
  ) {
    return `code_${value.code}`;
  }
  if (
    typeof value.name === "string" &&
    /^[A-Za-z0-9_.-]{1,80}$/.test(value.name)
  ) {
    return `name_${value.name}`;
  }
  if (typeof value.status === "number" && Number.isInteger(value.status)) {
    return `status_${value.status}`;
  }
  return "unknown";
}

function readBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return {
      status: "missing" as const,
      token: null,
      reason: "header_missing",
    };
  }
  const match = authorization.match(/^Bearer ([A-Za-z0-9._~-]{20,8192})$/);
  if (!match) {
    return {
      status: "invalid" as const,
      token: null,
      reason: "header_malformed",
    };
  }
  return {
    status: "verified" as const,
    token: match[1],
    reason: "header_present",
  };
}

async function verifyBearerIdentity(
  request: Request,
): Promise<ShoplingPriceAdjustmentIdentityProbe> {
  const bearer = readBearerToken(request);
  if (bearer.status === "missing") {
    return {
      status: "missing",
      reason: bearer.reason,
    };
  }
  if (bearer.status === "invalid" || !bearer.token) {
    return {
      status: "invalid",
      reason: bearer.reason,
    };
  }

  const config = getSupabasePublicConfig();
  if (!config.ok) {
    return {
      status: "unavailable",
      reason: "public_config_missing",
    };
  }

  try {
    const supabase = createClient(config.url, config.publicKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    const { data, error } = await supabase.auth.getClaims(bearer.token);
    const userId =
      typeof data?.claims?.sub === "string" ? data.claims.sub : "";
    const email =
      typeof data?.claims?.email === "string" ? data.claims.email : "";
    if (error || !userId || !email) {
      return {
        status: "invalid",
        reason: error
          ? safeAuthErrorReason(error)
          : "claims_identity_missing",
      };
    }
    return {
      status: "verified",
      identity: {
        userId,
        email,
      },
    };
  } catch (error) {
    return {
      status: "unavailable",
      reason: safeAuthErrorReason(error),
    };
  }
}

async function verifyCookieIdentity(): Promise<ShoplingPriceAdjustmentIdentityProbe> {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return {
        status: "unavailable",
        reason: "public_config_missing",
      };
    }
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      return {
        status: "invalid",
        reason: safeAuthErrorReason(error),
      };
    }
    if (!data.user) {
      return {
        status: "missing",
        reason: "user_missing",
      };
    }
    return {
      status: "verified",
      identity: {
        userId: data.user.id,
        email: data.user.email ?? "",
      },
    };
  } catch (error) {
    return {
      status: "unavailable",
      reason: safeAuthErrorReason(error),
    };
  }
}

function requestAuthCookieCount(request: Request) {
  return (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim().split("=", 1)[0] ?? "")
    .filter(isOpsAuthCookieName)
    .length;
}

async function ambientAuthCookieCount() {
  try {
    const cookieStore = await cookies();
    return cookieStore.getAll().filter(({ name }) =>
      isOpsAuthCookieName(name)
    ).length;
  } catch {
    return -1;
  }
}

export async function requireShoplingPriceAdjustmentOperator(
  request: Request,
): Promise<OperatorAuthResult> {
  const resolved = await resolveShoplingPriceAdjustmentIdentity({
    verifyBearer: () => verifyBearerIdentity(request),
    verifyCookie: verifyCookieIdentity,
    isAllowedEmail: (email) =>
      isShoplingPriceAdjustmentOperatorEmail(email),
  });
  if (!resolved.ok) {
    const detail = [
      `bearer_${resolved.bearerStatus}`,
      resolved.bearerReason,
      `cookie_${resolved.cookieStatus}`,
      resolved.cookieReason,
      `request_auth_cookies_${requestAuthCookieCount(request)}`,
      `ambient_auth_cookies_${await ambientAuthCookieCount()}`,
    ].join(";");
    if (resolved.reason === "forbidden") {
      return authFailure(
        "샵플링 가격 변경을 실행할 권한이 없습니다.",
        403,
        "PRICE_ADJUSTMENT_OPERATOR_REQUIRED",
        detail,
      );
    }
    if (resolved.reason === "unavailable") {
      return authFailure(
        "로그인 인증 서비스에 일시적으로 연결할 수 없습니다.",
        503,
        "PRICE_ADJUSTMENT_AUTH_UNAVAILABLE",
        detail,
      );
    }
    return authFailure(
      "로그인이 필요합니다.",
      401,
      "PRICE_ADJUSTMENT_AUTH_REQUIRED",
      detail,
    );
  }
  return {
    ok: true,
    operator: {
      userId: resolved.identity.userId,
      email: resolved.identity.email,
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
