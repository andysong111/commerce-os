import { NextResponse } from "next/server";
import {
  isOpsLoginTemporarilyDisabled,
  isSameOriginOpsRequest,
  temporaryOpsIdentity,
} from "@/lib/opsLoginBypass";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type OpsAiHelpOperator = {
  userId: string;
  email: string;
};

type OpsAiHelpAuthResult =
  | { response: NextResponse; operator?: never }
  | { response?: undefined; operator: OpsAiHelpOperator };

type RateLimitEntry = {
  windowStartedAt: number;
  count: number;
};

const rateLimits = new Map<string, RateLimitEntry>();
const DEFAULT_WINDOW_MS = 10 * 60 * 1_000;
const DEFAULT_MAX_REQUESTS = 30;

function allowedOperatorEmails() {
  const raw =
    process.env.OPS_AI_HELP_ALLOWED_EMAILS?.trim() ||
    process.env.OPS_OWNER_EMAILS?.trim() ||
    "";
  return new Set(
    raw
      .split(/[\s,;]+/)
      .map((value) => value.trim().toLocaleLowerCase())
      .filter(Boolean),
  );
}

function configuredPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1
    ? Math.trunc(parsed)
    : fallback;
}

function requestClientAddress(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

export async function requireOpsAiHelpOperator(
  request: Request,
): Promise<OpsAiHelpAuthResult> {
  if (process.env.OPS_AI_HELP_ENABLED?.trim() === "0") {
    return {
      response: NextResponse.json(
        { status: "error", message: "AI 사용상담 기능이 비활성화되어 있습니다." },
        { status: 503 },
      ),
    };
  }

  if (!isSameOriginOpsRequest(request)) {
    return {
      response: NextResponse.json(
        { status: "error", message: "OPS Center 화면에서만 질문할 수 있습니다." },
        { status: 403 },
      ),
    };
  }

  const allowedEmails = allowedOperatorEmails();
  if (isOpsLoginTemporarilyDisabled()) {
    const identity = temporaryOpsIdentity();
    if (allowedEmails.size > 0 && !allowedEmails.has(identity.email)) {
      return {
        response: NextResponse.json(
          { status: "error", message: "AI 사용상담 권한이 없습니다." },
          { status: 403 },
        ),
      };
    }
    return { operator: identity };
  }

  if (allowedEmails.size === 0) {
    return {
      response: NextResponse.json(
        {
          status: "error",
          message: "OPS_AI_HELP_ALLOWED_EMAILS 또는 OPS_OWNER_EMAILS 설정이 필요합니다.",
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
          { status: "error", message: "AI 사용상담 권한이 없습니다." },
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

export function consumeOpsAiHelpRateLimit(
  request: Request,
  operator: OpsAiHelpOperator,
  now = Date.now(),
  options: { windowMs?: number; maxRequests?: number } = {},
) {
  const windowMs =
    options.windowMs ??
    configuredPositiveInteger(
      process.env.OPS_AI_HELP_RATE_WINDOW_MS,
      DEFAULT_WINDOW_MS,
    );
  const maxRequests =
    options.maxRequests ??
    configuredPositiveInteger(
      process.env.OPS_AI_HELP_RATE_MAX,
      DEFAULT_MAX_REQUESTS,
    );
  const key = `${operator.userId}:${requestClientAddress(request)}`;
  const current = rateLimits.get(key);
  if (!current || now - current.windowStartedAt >= windowMs) {
    rateLimits.set(key, { windowStartedAt: now, count: 1 });
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
  rateLimits.set(key, current);
  return {
    ok: true as const,
    remaining: Math.max(0, maxRequests - current.count),
  };
}

export function resetOpsAiHelpRateLimitsForTests() {
  rateLimits.clear();
}
