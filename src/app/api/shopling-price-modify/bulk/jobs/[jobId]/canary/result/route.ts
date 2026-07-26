import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { analyzeShoplingPriceBulkCanaryResult } from "@/lib/shoplingPriceModifyBulkCanary";
import { fetchShoplingPriceModifyActionsResult } from "@/lib/shoplingPriceModifyRunner";

export const runtime = "nodejs";

type Result = { data: unknown; error: unknown };
type Query = PromiseLike<Result> & {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  maybeSingle(): Promise<Result>;
};
type Admin = {
  from(table: string): Query;
  rpc(name: string, parameters: Record<string, unknown>): Promise<Result>;
};

async function session() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { response: NextResponse.json({ error: "Supabase 서버 설정이 필요합니다." }, { status: 503 }) };
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { response: NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 }) };
  const admin = await createSupabaseAdminClient();
  if (!admin) return { response: NextResponse.json({ error: "Supabase 서버 설정이 필요합니다." }, { status: 503 }) };
  return { ownerId: data.user.id, admin: admin as Admin };
}

export async function POST(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const auth = await session();
  if (auth.response) return auth.response;
  const { jobId } = await params;

  const jobResult = await auth.admin.from("shopling_price_bulk_jobs")
    .select("id,status")
    .eq("id", jobId)
    .eq("owner_id", auth.ownerId)
    .maybeSingle();
  if (jobResult.error) return NextResponse.json({ error: "Bulk 작업 조회에 실패했습니다." }, { status: 500 });
  if (!jobResult.data) return NextResponse.json({ error: "작업을 찾을 수 없거나 접근 권한이 없습니다." }, { status: 404 });

  const job = jobResult.data as Record<string, unknown>;
  if (!new Set(["canary_running", "dispatch_uncertain"]).has(String(job.status))) {
    return NextResponse.json({ error: "현재 상태에서는 카나리 결과를 확인할 수 없습니다." }, { status: 409 });
  }

  const chunkResult = await auth.admin.from("shopling_price_bulk_chunks")
    .select("request_id,goods_keys,status")
    .eq("job_id", jobId)
    .eq("chunk_index", 0)
    .maybeSingle();
  if (chunkResult.error) return NextResponse.json({ error: "카나리 청크 조회에 실패했습니다." }, { status: 500 });
  if (!chunkResult.data) return NextResponse.json({ error: "카나리 청크를 찾을 수 없습니다." }, { status: 404 });

  const chunk = chunkResult.data as Record<string, unknown>;
  const requestId = typeof chunk.request_id === "string" ? chunk.request_id : "";
  const goodsKeys = Array.isArray(chunk.goods_keys)
    ? chunk.goods_keys.filter((value): value is string => typeof value === "string")
    : [];
  if (!requestId || goodsKeys.length === 0) {
    return NextResponse.json({ error: "카나리 요청 정보가 불완전합니다." }, { status: 409 });
  }

  const actionsResult = await fetchShoplingPriceModifyActionsResult(requestId);
  if (actionsResult.status === "pending") {
    return NextResponse.json({
      status: "pending",
      request_id: requestId,
      message: "카나리 결과가 아직 준비되지 않았습니다. 잠시 후 다시 확인하세요.",
    });
  }
  if (actionsResult.status === "error" || !actionsResult.summary) {
    return NextResponse.json({ error: actionsResult.message ?? "카나리 결과를 가져오지 못했습니다." }, { status: 502 });
  }

  const analysis = analyzeShoplingPriceBulkCanaryResult(
    actionsResult.summary,
    requestId,
    goodsKeys,
    actionsResult.runConclusion,
  );
  const finished = await auth.admin.rpc("finish_shopling_price_bulk_canary", {
    p_job_id: jobId,
    p_owner_id: auth.ownerId,
    p_request_id: requestId,
    p_success: analysis.success,
    p_failure_scope_known: analysis.failureScopeKnown,
    p_failed_keys: analysis.failedKeys,
    p_summary: actionsResult.summary,
    p_run_url: actionsResult.runUrl ?? null,
    p_error: analysis.success ? null : analysis.message,
  });
  if (finished.error) return NextResponse.json({ error: "카나리 결과 저장에 실패했습니다." }, { status: 500 });

  return NextResponse.json({
    status: analysis.success ? "canary_succeeded" : "canary_failed",
    request_id: requestId,
    run_url: actionsResult.runUrl,
    failed_keys: analysis.failedKeys,
    failure_scope_known: analysis.failureScopeKnown,
    message: analysis.message,
  });
}
