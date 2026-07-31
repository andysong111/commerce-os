import { NextRequest } from "next/server";
import {
  isOpsLoginTemporarilyDisabled,
  isSameOriginOpsRequest,
} from "@/lib/opsLoginBypass";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const MODEL_PATTERN = /^[A-Z0-9_-]{1,80}$/;
const BARCODE_PATTERN = /^[A-Z0-9_-]{1,120}$/;
const INTEGRATION_HEADER = "x-commerce-os-integration-secret";

export async function GET(request: NextRequest) {
  const access = await canUseIntegration(request);
  if (!access.ok) return Response.json(access.body, { status: access.status });

  const baseUrl = process.env.CHINA_ORDER_MANAGER_BASE_URL?.trim().replace(/\/$/, "");
  const secret = process.env.CHINA_ORDER_MANAGER_INTEGRATION_SECRET?.trim();
  if (!baseUrl || !secret) {
    return Response.json(
      {
        ok: false,
        code: "CHINA_ORDER_INTEGRATION_NOT_CONFIGURED",
        message:
          "발주·입고관리 연동 환경변수(CHINA_ORDER_MANAGER_BASE_URL, CHINA_ORDER_MANAGER_INTEGRATION_SECRET)가 필요합니다.",
      },
      { status: 503 },
    );
  }

  const barcode = normalizeIdentifier(
    request.nextUrl.searchParams.get("barcode"),
    BARCODE_PATTERN,
  );
  const modelNumber = normalizeIdentifier(
    request.nextUrl.searchParams.get("modelNumber"),
    MODEL_PATTERN,
  );
  if (!barcode && !modelNumber) {
    return Response.json(
      {
        ok: false,
        code: "BARCODE_OR_MODEL_REQUIRED",
        message: "기준 바코드 또는 모델번호가 필요합니다.",
      },
      { status: 400 },
    );
  }

  const query = new URLSearchParams();
  if (barcode) query.set("barcode", barcode);
  if (modelNumber) query.set("modelNumber", modelNumber);

  let response: Response;
  try {
    response = await fetch(
      `${baseUrl}/api/integrations/product-launch-options?${query.toString()}`,
      {
        headers: {
          Accept: "application/json",
          [INTEGRATION_HEADER]: secret,
          Authorization: `Bearer ${secret}`,
        },
        cache: "no-store",
      },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "CHINA_ORDER_NETWORK_FAILED",
        message:
          error instanceof Error
            ? `발주·입고관리 서버에 연결하지 못했습니다: ${error.message}`
            : "발주·입고관리 서버에 연결하지 못했습니다.",
      },
      { status: 502 },
    );
  }

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    return Response.json(
      {
        ok: false,
        code: readCode(body) || "CHINA_ORDER_INTEGRATION_FAILED",
        message:
          readMessage(body) ||
          `발주·입고관리 조회에 실패했습니다. status=${response.status}`,
        upstreamStatus: response.status,
      },
      {
        status:
          response.status >= 400 && response.status < 500
            ? response.status
            : 502,
      },
    );
  }

  return Response.json(body, { status: 200 });
}

async function canUseIntegration(
  request: NextRequest,
): Promise<
  | { ok: true }
  | {
      ok: false;
      status: number;
      body: { ok: false; code: string; message: string };
    }
> {
  if (!isSameOriginOpsRequest(request)) {
    return {
      ok: false,
      status: 403,
      body: {
        ok: false,
        code: "SAME_ORIGIN_REQUIRED",
        message: "OPS Center 화면에서만 발주·입고 데이터를 불러올 수 있습니다.",
      },
    };
  }
  if (isOpsLoginTemporarilyDisabled()) return { ok: true };

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
        message: "발주·입고 데이터를 불러오려면 로그인해야 합니다.",
      },
    };
  }
  return { ok: true };
}

function normalizeIdentifier(value: string | null, pattern: RegExp) {
  const normalized = String(value ?? "").trim().toUpperCase();
  return pattern.test(normalized) ? normalized : "";
}

function readMessage(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const message = (value as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

function readCode(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}
