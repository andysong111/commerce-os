import { unstable_cache } from "next/cache";
import { NextRequest } from "next/server";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  DETAIL_PAGE_JOB_TABLE,
  getDetailPageJobConfig,
  resolveDetailPageJobIdentity,
} from "@/lib/detailPageJobServer";

const ACTIVE_PROBE_REVALIDATE_SECONDS = 20;
const RESTRICTED_PROBE_RETRY_SECONDS = 120;
const ACTIVE_PROBE_TIMEOUT_MS = 2_500;

type ActiveProbeResult = {
  active: boolean | null;
  latestUpdatedAt: string | null;
  unavailable: boolean;
  upstreamStatus: number | null;
  restriction: "egress_quota" | "upstream" | null;
  message: string;
};

const readActiveDetailJob = unstable_cache(
  async (ownerId: string): Promise<ActiveProbeResult> => {
    const config = getDetailPageJobConfig();
    if (!config.ok) {
      return {
        active: null,
        latestUpdatedAt: null,
        unavailable: true,
        upstreamStatus: null,
        restriction: "upstream",
        message: "DETAIL_PAGE_JOB_STORE_NOT_CONFIGURED",
      };
    }

    const params = new URLSearchParams({
      select: "id,updated_at",
      owner_id: `eq.${ownerId}`,
      status: "in.(queued,running)",
      "payload->>kind": "eq.detail_page",
      order: "updated_at.desc",
      limit: "1",
    });

    try {
      const response = await fetch(
        `${config.value.supabaseUrl}/rest/v1/${DETAIL_PAGE_JOB_TABLE}?${params.toString()}`,
        {
          headers: createSupabaseAdminHeaders(config.value.secretKey),
          cache: "no-store",
          signal: AbortSignal.timeout(ACTIVE_PROBE_TIMEOUT_MS),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const rawMessage = readMessage(body);
        const egressRestricted =
          response.status === 402 && /exceed_egress_quota|egress/i.test(rawMessage);
        return {
          active: null,
          latestUpdatedAt: null,
          unavailable: true,
          upstreamStatus: response.status,
          restriction: egressRestricted ? "egress_quota" : "upstream",
          message: rawMessage || `DETAIL_PAGE_ACTIVE_PROBE_FAILED:${response.status}`,
        };
      }
      const row = Array.isArray(body) ? body[0] : null;
      return {
        active: Boolean(row?.id),
        latestUpdatedAt:
          typeof row?.updated_at === "string" ? row.updated_at : null,
        unavailable: false,
        upstreamStatus: response.status,
        restriction: null,
        message: "",
      };
    } catch (error) {
      return {
        active: null,
        latestUpdatedAt: null,
        unavailable: true,
        upstreamStatus: null,
        restriction: "upstream",
        message:
          error instanceof Error
            ? error.message
            : "DETAIL_PAGE_ACTIVE_PROBE_UNAVAILABLE",
      };
    }
  },
  ["detail-page-active-job-probe-v2-backpressure"],
  { revalidate: ACTIVE_PROBE_REVALIDATE_SECONDS },
);

export async function GET(request: NextRequest) {
  const identity = await resolveDetailPageJobIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });

  const result = await readActiveDetailJob(identity.value.userId);
  if (result.unavailable) {
    const restricted = result.restriction === "egress_quota";
    return Response.json(
      {
        ok: false,
        active: null,
        retryable: true,
        code: restricted
          ? "SUPABASE_EGRESS_QUOTA_RESTRICTED"
          : "DETAIL_PAGE_ACTIVE_PROBE_UNAVAILABLE",
        message: restricted
          ? "Supabase egress 한도 제한으로 활성 작업 확인을 잠시 중단했습니다. 반복 재조회는 서버 캐시로 억제합니다."
          : result.message || "상세페이지 활성 작업 확인이 지연되고 있습니다.",
        upstreamStatus: result.upstreamStatus,
      },
      {
        status: 503,
        headers: {
          "Retry-After": String(
            restricted
              ? RESTRICTED_PROBE_RETRY_SECONDS
              : ACTIVE_PROBE_REVALIDATE_SECONDS,
          ),
          "Cache-Control": restricted
            ? "private, max-age=0, stale-while-revalidate=120"
            : "private, max-age=0, stale-while-revalidate=30",
          "X-Commerce-Detail-Probe": restricted
            ? "egress-backpressure"
            : "active-unavailable",
        },
      },
    );
  }

  return Response.json(
    {
      ok: true,
      active: result.active,
      latestUpdatedAt: result.latestUpdatedAt,
      probe: "active-only",
    },
    {
      headers: {
        "Cache-Control": "private, max-age=0, stale-while-revalidate=30",
        "X-Commerce-Detail-Probe": "active-only",
      },
    },
  );
}

function readMessage(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const row = value as Record<string, unknown>;
  return String(row.message ?? row.error ?? row.msg ?? "").trim();
}
