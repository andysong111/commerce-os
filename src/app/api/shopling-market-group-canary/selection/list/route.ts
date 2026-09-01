import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRIDGE = "shopling-market-selection-v0.1";
const JOB_TABLE = "product_launch_upload_jobs";
const LEDGER_TABLE = "shopling_market_pipeline_ledger";
const SUCCESS_MARKET = new Set(["sent", "already_registered"]);
const BUSY_STATUS = new Set(["claimed"]);
const BUSY_MARKET = new Set(["submit_armed"]);
const CONFIRM_MARKET = new Set(["confirm_needed"]);

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.map(record) : [];
}

function resultRows(job: Record<string, unknown>) {
  return rows(record(job.result).rows)
    .map((row) => ({
      channelKey: text(row.channel_key),
      channel: text(row.channel),
      status: text(row.status),
      goodsKey: text(row.goods_key || row.goodsKey),
      ptnGoodsCd: text(row.ptn_goods_cd),
    }))
    .filter((row) => /^\d{5,9}$/.test(row.goodsKey) && row.channelKey);
}

function isSeoBulkJob(job: Record<string, unknown>) {
  const payload = record(job.payload);
  const seoFinal = record(payload.seoFinal);
  return text(seoFinal.source).startsWith("seo-bulk-cloud");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (text(url.searchParams.get("bridge")) !== BRIDGE) {
    return Response.json({ ok: false, error: "unsupported_shopling_market_selection_bridge" }, { status: 400 });
  }

  const supabase = await createSupabaseAdminClient();
  if (!supabase) {
    return Response.json({ ok: false, error: "supabase_admin_unavailable" }, { status: 503 });
  }

  const jobsResult = await supabase
    .from(JOB_TABLE)
    .select("id,owner_id,launch_item_id,status,payload,result,created_at,completed_at")
    .in("status", ["success", "partial_failure"])
    .order("completed_at", { ascending: false })
    .limit(50);
  if (jobsResult.error) {
    return Response.json(
      { ok: false, error: "shopling_market_selection_jobs_failed", message: jobsResult.error.message },
      { status: 503 },
    );
  }

  const latestByLaunch = new Map<string, Record<string, unknown>>();
  for (const raw of Array.isArray(jobsResult.data) ? jobsResult.data : []) {
    const job = record(raw);
    if (!isSeoBulkJob(job)) continue;
    const launchItemId = text(job.launch_item_id);
    if (!launchItemId || latestByLaunch.has(launchItemId)) continue;
    latestByLaunch.set(launchItemId, job);
    if (latestByLaunch.size >= 20) break;
  }

  const jobs = [...latestByLaunch.values()];
  const allGoodsKeys = [...new Set(jobs.flatMap((job) => resultRows(job).map((row) => row.goodsKey)))];
  const ledgerByGoodsKey = new Map<string, Record<string, unknown>>();
  if (allGoodsKeys.length > 0) {
    const ledgerResult = await supabase
      .from(LEDGER_TABLE)
      .select("goods_key,status,market_status,reason_code,message,submit_armed_at")
      .in("goods_key", allGoodsKeys)
      .limit(150);
    if (ledgerResult.error) {
      return Response.json(
        { ok: false, error: "shopling_market_selection_ledger_failed", message: ledgerResult.error.message },
        { status: 503 },
      );
    }
    for (const raw of Array.isArray(ledgerResult.data) ? ledgerResult.data : []) {
      const row = record(raw);
      const goodsKey = text(row.goods_key);
      if (goodsKey) ledgerByGoodsKey.set(goodsKey, row);
    }
  }

  const items = jobs.map((job) => {
    const payload = record(job.payload);
    const seoFinal = record(payload.seoFinal);
    const uploadRows = resultRows(job);
    const successfulRows = uploadRows.filter((row) => row.status === "success");
    let marketDoneCount = 0;
    let confirmNeededCount = 0;
    let busyCount = 0;
    let pendingCount = 0;

    for (const row of successfulRows) {
      const ledger = ledgerByGoodsKey.get(row.goodsKey);
      const status = text(ledger?.status);
      const marketStatus = text(ledger?.market_status);
      if (SUCCESS_MARKET.has(status) || SUCCESS_MARKET.has(marketStatus)) {
        marketDoneCount += 1;
      } else if (CONFIRM_MARKET.has(status) || CONFIRM_MARKET.has(marketStatus)) {
        confirmNeededCount += 1;
      } else if (BUSY_STATUS.has(status) || BUSY_MARKET.has(marketStatus)) {
        busyCount += 1;
      } else {
        pendingCount += 1;
      }
    }

    const uploadSuccessCount = successfulRows.length;
    const uploadReady = text(job.status) === "success" && uploadSuccessCount === 6;
    const selectable = uploadReady && busyCount === 0 && confirmNeededCount === 0 && marketDoneCount < 6;
    const modelNumber = text(payload.modelNumber) || text(seoFinal.modelNumber);
    const modelName = text(payload.modelName) || text(seoFinal.productName) || modelNumber;

    return {
      jobId: text(job.id),
      launchItemId: text(job.launch_item_id),
      modelNumber,
      modelName,
      completedAt: text(job.completed_at || job.created_at),
      uploadStatus: text(job.status),
      uploadSuccessCount,
      uploadTotalCount: uploadRows.length,
      marketDoneCount,
      marketPendingCount: pendingCount,
      confirmNeededCount,
      busyCount,
      selectable,
      channels: successfulRows,
    };
  });

  return Response.json(
    {
      ok: true,
      bridge: BRIDGE,
      items,
      count: items.length,
      selectableCount: items.filter((item) => item.selectable).length,
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
