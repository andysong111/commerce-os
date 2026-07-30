import { NextRequest } from "next/server";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  isOpsLoginTemporarilyDisabled,
  isSameOriginOpsRequest,
  temporaryOpsIdentity,
} from "@/lib/opsLoginBypass";

export type ProductLaunchIdentity = {
  userId: string;
  email: string;
};

export type ProductLaunchAdminConfig = {
  supabaseUrl: string;
  secretKey: string;
};

export async function resolveProductLaunchIdentity(
  request: NextRequest,
  options: { requireSameOrigin?: boolean } = {},
): Promise<
  | { ok: true; value: ProductLaunchIdentity }
  | {
      ok: false;
      status: number;
      body: { ok: false; code: string; message: string };
    }
> {
  const requireSameOrigin = options.requireSameOrigin !== false;
  if (requireSameOrigin && !isSameOriginOpsRequest(request)) {
    return {
      ok: false,
      status: 403,
      body: {
        ok: false,
        code: "SAME_ORIGIN_REQUIRED",
        message: "OPS Center 화면에서만 이 작업을 실행할 수 있습니다.",
      },
    };
  }

  if (isOpsLoginTemporarilyDisabled()) {
    return { ok: true, value: temporaryOpsIdentity() };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      ok: false,
      status: 503,
      body: {
        ok: false,
        code: "SUPABASE_NOT_CONFIGURED",
        message: "Supabase 서버 연결이 설정되지 않았습니다.",
      },
    };
  }
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return {
      ok: false,
      status: 401,
      body: {
        ok: false,
        code: "AUTH_REQUIRED",
        message: "이 작업을 실행하려면 로그인해야 합니다.",
      },
    };
  }
  return {
    ok: true,
    value: {
      userId: data.user.id,
      email: data.user.email?.toLowerCase() ?? "",
    },
  };
}

export function getProductLaunchAdminConfig():
  | { ok: true; value: ProductLaunchAdminConfig }
  | {
      ok: false;
      status: number;
      body: { ok: false; code: string; message: string };
    } {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secretKey = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!supabaseUrl || !secretKey) {
    return {
      ok: false,
      status: 503,
      body: {
        ok: false,
        code: "SUPABASE_NOT_CONFIGURED",
        message: "진행관리 서버 저장소에 필요한 Supabase 환경변수가 없습니다.",
      },
    };
  }
  return { ok: true, value: { supabaseUrl, secretKey } };
}

export async function readProductLaunchState(
  config: ProductLaunchAdminConfig,
  ownerId: string,
) {
  const params = new URLSearchParams({
    select: "state_payload,updated_at,schema_version,owner_email",
    owner_id: `eq.${ownerId}`,
    limit: "1",
  });
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/product_launch_tracker_states?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );
  const body = await readResponseJson(response);
  if (!response.ok) {
    throw new Error(readProductLaunchError(body, response.status));
  }
  return Array.isArray(body) ? body[0] ?? null : null;
}

export async function writeProductLaunchState(
  config: ProductLaunchAdminConfig,
  identity: ProductLaunchIdentity,
  state: Record<string, unknown>,
) {
  const schemaVersion = Math.max(1, Math.floor(Number(state.schemaVersion) || 3));
  const row = {
    owner_id: identity.userId,
    owner_email: identity.email,
    schema_version: schemaVersion,
    state_payload: state,
    updated_at: new Date().toISOString(),
  };
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/product_launch_tracker_states?on_conflict=owner_id`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(config.secretKey),
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(row),
      cache: "no-store",
    },
  );
  const body = await readResponseJson(response);
  if (!response.ok) {
    throw new Error(readProductLaunchError(body, response.status));
  }
  return Array.isArray(body) ? body[0] ?? row : row;
}

export async function readResponseJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function readProductLaunchError(body: unknown, status: number) {
  if (body && typeof body === "object") {
    const candidate = body as { message?: unknown; error?: unknown; details?: unknown };
    for (const value of [candidate.message, candidate.error, candidate.details]) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  if (typeof body === "string" && body.trim()) return body.trim();
  return `진행관리 저장소 요청에 실패했습니다. status=${status}`;
}
