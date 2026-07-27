import { NextResponse } from "next/server";
import { normalError, normalSession } from "@/lib/shoplingPriceModifyBulkApi";

export const runtime = "nodejs";
const MAX_EVENTS = 1000;

export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const auth = await normalSession();
  if (auth.response) return auth.response;
  const { jobId } = await params;
  const beforeRaw = new URL(request.url).searchParams.get("before_id");
  const beforeId = beforeRaw ? Number(beforeRaw) : null;
  if (beforeRaw && (!Number.isSafeInteger(beforeId) || Number(beforeId) <= 0)) {
    return normalError("감사 로그 커서가 올바르지 않습니다.", 400, "AUDIT_CURSOR_INVALID", "audit.cursor");
  }

  const jobResult = await auth.admin!.from("shopling_price_bulk_jobs")
    .select("id")
    .eq("id", jobId)
    .eq("owner_id", auth.ownerId)
    .maybeSingle();
  if (jobResult.error) return normalError("감사 로그 작업 조회에 실패했습니다.", 500, "AUDIT_JOB_QUERY_FAILED", "audit.job_query", jobResult.error);
  if (!jobResult.data) return normalError("작업을 찾을 수 없거나 접근 권한이 없습니다.", 404, "AUDIT_JOB_NOT_FOUND", "audit.job_query");

  let query = auth.admin!.from("shopling_price_bulk_audit_events")
    .select("id,entity_type,entity_id,event_type,old_status,new_status,request_id,metadata,created_at")
    .eq("job_id", jobId)
    .eq("owner_id", auth.ownerId);
  if (beforeId) query = query.lt("id", beforeId);
  const result = await query.order("id", { ascending: false }).limit(MAX_EVENTS);
  if (result.error) return normalError("감사 로그 조회에 실패했습니다.", 500, "AUDIT_QUERY_FAILED", "audit.events_query", result.error);

  const events = (Array.isArray(result.data) ? result.data : []).map((row) => ({
    id: Number(row.id),
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    event_type: row.event_type,
    old_status: row.old_status,
    new_status: row.new_status,
    request_id: row.request_id,
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
    created_at: row.created_at,
  }));

  return NextResponse.json({
    events,
    next_before_id: events.length === MAX_EVENTS ? events.at(-1)?.id ?? null : null,
  }, { headers: { "cache-control": "no-store" } });
}
