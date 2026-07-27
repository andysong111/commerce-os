import { NextResponse } from "next/server";
import { normalError, normalSession } from "@/lib/shoplingPriceModifyBulkApi";

const MAX_FAILED_KEYS = 20_000;
const PAGE_SIZE = 1_000;

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const auth = await normalSession();
  if (auth.response) return auth.response;

  const { jobId } = await params;
  const jobResult = await auth.admin!.from("shopling_price_bulk_jobs")
    .select("id")
    .eq("id", jobId)
    .eq("owner_id", auth.ownerId)
    .maybeSingle();

  if (jobResult.error) {
    return normalError("Bulk 작업 조회에 실패했습니다.", 500, "FAILED_KEYS_JOB_QUERY_FAILED", "failed_keys.job_query", jobResult.error);
  }
  if (!jobResult.data) {
    return normalError("작업을 찾을 수 없거나 접근 권한이 없습니다.", 404, "JOB_NOT_FOUND", "failed_keys.job_query");
  }

  const goodsKeys: string[] = [];
  for (let offset = 0; offset < MAX_FAILED_KEYS; offset += PAGE_SIZE) {
    const pageEnd = Math.min(offset + PAGE_SIZE - 1, MAX_FAILED_KEYS - 1);
    const failedResult = await auth.admin!.from("shopling_price_bulk_items")
      .select("goods_key,ordinal")
      .eq("job_id", jobId)
      .eq("status", "failed")
      .order("ordinal", { ascending: true })
      .range(offset, pageEnd);

    if (failedResult.error) {
      return normalError("실패 상품 목록 조회에 실패했습니다.", 500, "FAILED_KEYS_QUERY_FAILED", "failed_keys.items_query", failedResult.error);
    }

    const rows = Array.isArray(failedResult.data) ? failedResult.data : [];
    for (const row of rows) {
      if (typeof row.goods_key === "string") goodsKeys.push(row.goods_key);
    }

    if (rows.length < PAGE_SIZE) break;
  }

  return NextResponse.json({
    goods_keys: goodsKeys,
    count: goodsKeys.length,
    truncated: goodsKeys.length >= MAX_FAILED_KEYS,
  });
}
