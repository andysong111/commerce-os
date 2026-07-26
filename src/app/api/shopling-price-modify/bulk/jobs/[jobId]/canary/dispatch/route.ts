import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dispatchShoplingPriceBulkCanary } from "@/lib/shoplingPriceModifyBulkCanary";
import { generateShoplingPriceModifyRequestId } from "@/lib/shoplingPriceModifyRunner";

export const runtime = "nodejs";

type Result = { data: unknown; error: unknown };
type Admin = { rpc(name: string, parameters: Record<string, unknown>): Promise<Result> };

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
  const requestId = generateShoplingPriceModifyRequestId();

  const reserved = await auth.admin.rpc("reserve_shopling_price_bulk_canary", {
    p_job_id: jobId,
    p_owner_id: auth.ownerId,
    p_request_id: requestId,
  });
  if (reserved.error || !reserved.data) {
    return NextResponse.json({ error: "카나리 실행을 시작할 수 없습니다. 작업 상태와 migration 적용 여부를 확인하세요." }, { status: 409 });
  }

  const context = (Array.isArray(reserved.data) ? reserved.data[0] : reserved.data) as Record<string, unknown>;
  const goodsKeys = Array.isArray(context.goods_keys)
    ? context.goods_keys.filter((value): value is string => typeof value === "string")
    : [];
  const dispatch = await dispatchShoplingPriceBulkCanary(goodsKeys, context.policy_overrides, requestId);

  if (dispatch.status === "queued") {
    const marked = await auth.admin.rpc("mark_shopling_price_bulk_canary_running", {
      p_job_id: jobId,
      p_owner_id: auth.ownerId,
      p_request_id: requestId,
      p_actions_url: dispatch.githubActionsUrl,
    });
    if (marked.error) {
      await auth.admin.rpc("block_shopling_price_bulk_canary_uncertain", {
        p_job_id: jobId,
        p_owner_id: auth.ownerId,
        p_request_id: requestId,
        p_error: "GitHub Actions 요청은 수락됐지만 DB 상태 확정에 실패했습니다.",
      });
      return NextResponse.json({
        status: "dispatch_uncertain",
        request_id: requestId,
        error: "카나리 요청 수락 후 상태 저장이 불확실합니다. 다시 실행하지 말고 결과 확인을 사용하세요.",
      }, { status: 202 });
    }
    return NextResponse.json({
      status: "canary_running",
      request_id: requestId,
      goods_key_count: goodsKeys.length,
      actions_url: dispatch.githubActionsUrl,
      message: "카나리 가격설정 실행 요청이 전송되었습니다. 일반 청크는 실행되지 않습니다.",
    });
  }

  if (dispatch.status === "rejected") {
    await auth.admin.rpc("reset_shopling_price_bulk_canary_rejected", {
      p_job_id: jobId,
      p_owner_id: auth.ownerId,
      p_request_id: requestId,
      p_error: dispatch.message,
    });
    return NextResponse.json({ status: "rejected", error: dispatch.message }, { status: 502 });
  }

  await auth.admin.rpc("block_shopling_price_bulk_canary_uncertain", {
    p_job_id: jobId,
    p_owner_id: auth.ownerId,
    p_request_id: requestId,
    p_error: dispatch.message,
  });
  return NextResponse.json({
    status: "dispatch_uncertain",
    request_id: requestId,
    error: "GitHub Actions 수락 여부를 확정할 수 없습니다. 중복 방지를 위해 다시 실행하지 말고 결과 확인을 사용하세요.",
  }, { status: 202 });
}
