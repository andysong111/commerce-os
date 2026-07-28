import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ProductLaunchAiTitleTermsOperator = {
  userId: string;
  email: string;
};

type OperatorAuthResult =
  | { response: NextResponse; operator?: never }
  | { response?: undefined; operator: ProductLaunchAiTitleTermsOperator };

type RateLimitEntry = {
  windowStartedAt: number;
  count: number;
};

const rateLimits = new Map<string, RateLimitEntry>();
const DEFAULT_WINDOW_MS = 10 * 60 * 1_000;
const DEFAULT_MAX_REQUESTS = 20;

function allowedOperatorEmails() {
  const raw =
    process.env.PRODUCT_LAUNCH_AI_TITLE_TERMS_ALLOWED_EMAILS?.trim() ||
    process.env.OPS_OWNER_EMAILS?.trim() ||
    "";
  return new Set(
    raw
      .split(/[\s,;]+/)
      .map((value) => value.trim().toLocaleLowerCase())
      .filter(Boolean),
  );
}

function configuredLimit(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1
    ? Math.trunc(parsed)
    : fallback;
}

export async function requireProductLaunchAiTitleTermsOperator(): Promise<OperatorAuthResult> {
  const featureFlag =
    process.env.PRODUCT_LAUNCH_AI_TITLE_TERMS_ENABLED?.trim();
  if (featureFlag && featureFlag !== "1") {
    return {
      response: NextResponse.json(
        {
          status: "error",
          message: "상품명 AI 생성어 기능이 비활성화되어 있습니다.",
        },
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
            "PRODUCT_LAUNCH_AI_TITLE_TERMS_ALLOWED_EMAILS 또는 OPS_OWNER_EMAILS 설정이 필요합니다.",
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
    const email = data.user.email?.trim().toLocaleLowerCase() || "";
    if (!email || !allowedEmails.has(email)) {
      return {
        response: NextResponse.json(
          { status: "error", message: "AI 생성어를 실행할 권한이 없습니다." },
          { status: 403 },
        ),
      };
    }
    return { operator: { userId: data.user.id, email } };
  } catch {
    return {
      response: NextResponse.json(
        { status: "error", message: "로그인 세션을 확인할 수 없습니다." },
        { status: 500 },
      ),
    };
  }
}

export function consumeProductLaunchAiTitleTermsRateLimit(
  userId: string,
  now = Date.now(),
  options: { windowMs?: number; maxRequests?: number } = {},
) {
  const windowMs =
    options.windowMs ??
    configuredLimit(
      process.env.PRODUCT_LAUNCH_AI_TITLE_TERMS_RATE_WINDOW_MS,
      DEFAULT_WINDOW_MS,
    );
  const maxRequests =
    options.maxRequests ??
    configuredLimit(
      process.env.PRODUCT_LAUNCH_AI_TITLE_TERMS_RATE_MAX,
      DEFAULT_MAX_REQUESTS,
    );
  const current = rateLimits.get(userId);
  if (!current || now - current.windowStartedAt >= windowMs) {
    rateLimits.set(userId, { windowStartedAt: now, count: 1 });
    return { ok: true as const, remaining: Math.max(0, maxRequests - 1) };
  }
  if (current.count >= maxRequests) {
    return {
      ok: false as const,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((windowMs - (now - current.windowStartedAt)) / 1_000),
      ),
    };
  }
  current.count += 1;
  rateLimits.set(userId, current);
  return {
    ok: true as const,
    remaining: Math.max(0, maxRequests - current.count),
  };
}

export function resetProductLaunchAiTitleTermsRateLimitsForTests() {
  rateLimits.clear();
}
