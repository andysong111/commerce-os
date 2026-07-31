import { timingSafeEqual } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { temporaryOpsIdentity } from "@/lib/opsLoginBypass";
import type { BulkAdmin } from "@/lib/shoplingPriceModifyBulkApi";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PriceAdjustmentIntegrationAuth =
  | {
      ok: true;
      admin: BulkAdmin;
      ownerId: string;
    }
  | {
      ok: false;
      response: Response;
    };

function secureEqual(received: string, expected: string) {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function requirePriceAdjustmentIntegration(
  request: Request,
): Promise<PriceAdjustmentIntegrationAuth> {
  const secret = process.env.PRICE_ADJUSTMENT_ENGINE_INTEGRATION_SECRET?.trim();
  if (!secret) {
    return {
      ok: false,
      response: Response.json(
        {
          ok: false,
          code: "PRICE_ADJUSTMENT_SECRET_NOT_CONFIGURED",
          message: "가격조정 엔진 연동 비밀값이 설정되지 않았습니다.",
        },
        { status: 503 },
      ),
    };
  }

  const authorization = request.headers.get("authorization")?.trim() ?? "";
  if (!secureEqual(authorization, `Bearer ${secret}`)) {
    return {
      ok: false,
      response: Response.json(
        {
          ok: false,
          code: "INVALID_PRICE_ADJUSTMENT_SECRET",
          message: "가격조정 엔진 연동 인증에 실패했습니다.",
        },
        { status: 401 },
      ),
    };
  }

  const configuredOwner =
    process.env.PRICE_ADJUSTMENT_AUTOMATION_OWNER_ID?.trim() ||
    process.env.OPS_LOGIN_BYPASS_USER_ID?.trim() ||
    temporaryOpsIdentity().userId;
  if (!UUID_PATTERN.test(configuredOwner)) {
    return {
      ok: false,
      response: Response.json(
        {
          ok: false,
          code: "PRICE_ADJUSTMENT_OWNER_INVALID",
          message: "가격조정 작업 소유자 ID가 올바르지 않습니다.",
        },
        { status: 503 },
      ),
    };
  }

  try {
    const rawAdmin = await createSupabaseAdminClient();
    if (!rawAdmin) {
      return {
        ok: false,
        response: Response.json(
          {
            ok: false,
            code: "PRICE_ADJUSTMENT_ADMIN_NOT_CONFIGURED",
            message: "Supabase 관리자 설정이 필요합니다.",
          },
          { status: 503 },
        ),
      };
    }
    return {
      ok: true,
      admin: rawAdmin as BulkAdmin,
      ownerId: configuredOwner,
    };
  } catch {
    return {
      ok: false,
      response: Response.json(
        {
          ok: false,
          code: "PRICE_ADJUSTMENT_ADMIN_FAILED",
          message: "가격조정용 관리자 클라이언트를 만들지 못했습니다.",
        },
        { status: 500 },
      ),
    };
  }
}
