import { unstable_cache } from "next/cache";
import { NextRequest } from "next/server";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  DETAIL_PAGE_JOB_TABLE,
  getDetailPageJobConfig,
  resolveDetailPageJobIdentity,
} from "@/lib/detailPageJobServer";

const ACTIVE_PROBE_REVALIDATE_SECONDS = 20;
const ACTIVE_PROBE_TIMEOUT_MS = 2_500;

const readActiveDetailJob = unstable_cache(
  async (ownerId: string) => {
    const config = getDetailPageJobConfig();
    if (!config.ok) throw new Error("DETAIL_PAGE_JOB_STORE_NOT_CONFIGURED");

    const params = new URLSearchParams({
      select: "id,updated_at",
      owner_id: `eq.${ownerId}`,
      status: "in.(queued,running)",
      "payload->>kind": "eq.detail_page",
      order: "updated_at.desc",
      limit: "1",
    });
    const response = await fetch(
      `${config.value.supabaseUrl}/rest/v1/${DETAIL_PAGE_JOB_TABLE}?${params.toString()}`,
      {
        headers: createSupabaseAdminHeaders(config.value.secretKey),
        cache: "no-store",
        signal: AbortSignal.timeout(ACTIVE_PROBE_TIMEOUT_MS),
      },
    );
    const body = await response.json().catch(() => []);
    if (!response.ok) {
      throw new Error(`DETAIL_PAGE_ACTIVE_PROBE_FAILED:${response.status}`);
    }
    const row = Array.isArray(body) ? body[0] : null;
    return {
      active: Boolean(row?.id),
      latestUpdatedAt:
        typeof row?.updated_at === "string" ? row.updated_at : null,
    };
  },
  ["detail-page-active-job-probe-v1"],
  { revalidate: ACTIVE_PROBE_REVALIDATE_SECONDS },
);

export async function GET(request: NextRequest) {
  const identity = await resolveDetailPageJobIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });

  try {
    const result = await readActiveDetailJob(identity.value.userId);
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
  } catch (error) {
    return Response.json(
      {
        ok: false,
        active: null,
        retryable: true,
        code: "DETAIL_PAGE_ACTIVE_PROBE_UNAVAILABLE",
        message:
          error instanceof Error
            ? error.message
            : "상세페이지 활성 작업 확인이 지연되고 있습니다.",
      },
      {
        status: 503,
        headers: { "Retry-After": "20" },
      },
    );
  }
}
