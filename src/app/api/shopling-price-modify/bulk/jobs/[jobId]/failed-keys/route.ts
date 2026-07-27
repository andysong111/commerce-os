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
  let lastOrdinal = 0;

  while (goodsKeys.length < MAX_FAILED_KEYS) {
    const pageLimit = Math.min(PAGE_SIZE, MAX_FAILED_KEYS - goodsKeys.length);
    let query = auth.admin!.from("shopling_price_bulk_items")
      .select("goods_key,ordinal")
      .eq("job_id", jobId)
      .eq("status", "failed");

    if (lastOrdinal > 0) query = query.gt("ordinal", lastOrdinal);

    const failedResult = await query
      .order("ordinal", { ascending: true })
      .limit(pageLimit);

    if (failedResult.error) {
      return normalError("실패 상품 목록 조회에 실패했습니다.", 500, "FAILED_KEYS_QUERY_FAILED", "failed_keys.items_query", failedResult.error);
    }

    const rows = Array.isArray(failedResult.data) ? failedResult.data : [];
    if (rows.length === 0) break;

    for (const row of rows) {
      const goodsKey = typeof row.goods_key === "string" ? row.goods_key : "";
      const ordinal = typeof row.ordinal === "number" ? row.ordinal : Number(row.ordinal);
      if (!goodsKey || !Number.isInteger(ordinal) || ordinal <= lastOrdinal) {
        return normalError(
          "실패 상품 목록의 정렬 정보가 올바르지 않습니다.",
          500,
          "FAILED_KEYS_CURSOR_INVALID",
          "failed_keys.items_query",
          { goods_key: goodsKey || null, ordinal: row.ordinal ?? null, last_ordinal: lastOrdinal },
        );
      }
      goodsKeys.push(goodsKey);
      lastOrdinal = ordinal;
    }

    if (rows.length < pageLimit) break;
  }

  return NextResponse.json({
    goods_keys: goodsKeys,
    count: goodsKeys.length,
    truncated: false,
  });
}
