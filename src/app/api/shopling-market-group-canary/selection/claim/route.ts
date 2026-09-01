import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRIDGE = "shopling-market-selection-v0.1";
const JOB_TABLE = "product_launch_upload_jobs";
const LEDGER_TABLE = "shopling_market_pipeline_ledger";
const ORDER: Record<string, number> = {
  wholesale1: 1,
  wholesale2: 2,
  wholesale3: 3,
  wholesale4: 4,
  retail1: 5,
  retail2: 6,
};
const CHANNELS: Record<string, { searchCode: string; profile: string }> = {
  wholesale1: { searchCode: "DM1", profile: "도매1" },
  wholesale2: { searchCode: "DM2", profile: "도매2" },
  wholesale3: { searchCode: "DM3", profile: "도매3" },
  wholesale4: { searchCode: "DM4", profile: "도매4" },
  retail1: { searchCode: "SM1", profile: "소매1" },
  retail2: { searchCode: "SM2", profile: "소매2" },
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function validRunId(runId: string) {
  return /^canary-group-v030-[A-Za-z0-9._:-]{12,150}$/.test(runId);
}

function isSeoBulkJob(job: Record<string, unknown>) {
  return text(record(record(job.payload).seoFinal).source).startsWith("seo-bulk-cloud");
}

function taskRows(job: Record<string, unknown>) {
  const payload = record(job.payload);
  const modelNumber = text(payload.modelNumber);
  const launchItemId = text(job.launch_item_id);
  const completedAt = text(job.completed_at || job.created_at);
  const rows = Array.isArray(record(job.result).rows) ? (record(job.result).rows as unknown[]) : [];
  return rows
    .map(record)
    .filter((row) => text(row.status) === "success")
    .map((row) => {
      const productGroupKey = text(row.channel_key);
      const mapping = CHANNELS[productGroupKey];
      const goodsKey = text(row.goods_key || row.goodsKey);
      const ptnGoodsCd = text(row.ptn_goods_cd);
      if (!mapping || !/^\d{5,9}$/.test(goodsKey) || !ptnGoodsCd || !launchItemId) return null;
      if (!ptnGoodsCd.toUpperCase().startsWith(`${mapping.searchCode}_`)) return null;
      return {
        ownerId: text(job.owner_id),
        goodsKey,
        launchItemId,
        modelNumber,
        productGroupKey,
        searchCode: mapping.searchCode,
        profile: mapping.profile,
        ptnGoodsCd,
        registeredAt: completedAt,
      };
    })
    .filter(Boolean) as Array<{
      ownerId: string;
      goodsKey: string;
      launchItemId: string;
      modelNumber: string;
      productGroupKey: string;
      searchCode: string;
      profile: string;
      ptnGoodsCd: string;
      registeredAt: string;
    }>;
}

function sortTasks<T extends { productGroupKey: string; goodsKey: string }>(items: T[]) {
  return [...items].sort((a, b) => {
    const delta = (ORDER[a.productGroupKey] ?? 99) - (ORDER[b.productGroupKey] ?? 99);
    return delta || a.goodsKey.localeCompare(b.goodsKey);
  });
}

function ledgerSeed(task: ReturnType<typeof taskRows>[number], now: string) {
  return {
    owner_id: task.ownerId,
    goods_key: task.goodsKey,
    launch_item_id: task.launchItemId,
    model_number: task.modelNumber,
    product_group_key: task.productGroupKey,
    profile: task.profile,
    ptn_goods_cd: task.ptnGoodsCd,
    search_prefix: task.searchCode,
    registry_registered_at: task.registeredAt || now,
    status: "queued",
    title_status: "pending",
    market_status: "pending",
    created_at: now,
    updated_at: now,
  };
}

function taskFromLedger(raw: unknown) {
  const row = record(raw);
  const productGroupKey = text(row.product_group_key);
  const mapping = CHANNELS[productGroupKey];
  const goodsKey = text(row.goods_key);
  const ptnGoodsCd = text(row.ptn_goods_cd);
  if (!mapping || !/^\d{5,9}$/.test(goodsKey) || !ptnGoodsCd) return null;
  if (!ptnGoodsCd.toUpperCase().startsWith(`${mapping.searchCode}_`)) return null;
  return {
    goodsKey,
    launchItemId: text(row.launch_item_id),
    modelNumber: text(row.model_number),
    productGroupKey,
    searchCode: mapping.searchCode,
    profile: mapping.profile,
    ptnGoodsCd,
    registeredAt: text(row.registry_registered_at),
  };
}

async function latestSeoBulkJobForLaunch(supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseAdminClient>>>, launchItemId: string) {
  const latest = await supabase
    .from(JOB_TABLE)
    .select("id,launch_item_id,status,payload,result,completed_at,created_at")
    .eq("launch_item_id", launchItemId)
    .in("status", ["success", "partial_failure"])
    .order("completed_at", { ascending: false })
    .limit(8);
  if (latest.error) return { error: latest.error.message, jobId: "" };
  const row = (Array.isArray(latest.data) ? latest.data : []).map(record).find(isSeoBulkJob);
  return { error: "", jobId: text(row?.id) };
}

export async function POST(request: Request) {
  const payload = record(await request.json().catch(() => null));
  if (text(payload.bridge) !== BRIDGE) {
    return Response.json({ ok: false, error: "unsupported_shopling_market_selection_bridge" }, { status: 400 });
  }
  const runId = text(payload.runId);
  const jobId = text(payload.jobId);
  const maxTasksRaw = Number(payload.maxTasks ?? 3);
  const maxTasks = Math.max(1, Math.min(Number.isFinite(maxTasksRaw) ? Math.floor(maxTasksRaw) : 3, 3));
  if (!validRunId(runId)) return Response.json({ ok: false, error: "invalid_group_canary_run_id" }, { status: 400 });
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return Response.json({ ok: false, error: "invalid_shopling_upload_job_id" }, { status: 400 });

  const supabase = await createSupabaseAdminClient();
  if (!supabase) return Response.json({ ok: false, error: "supabase_admin_unavailable" }, { status: 503 });

  const jobResult = await supabase
    .from(JOB_TABLE)
    .select("id,owner_id,launch_item_id,status,payload,result,created_at,completed_at")
    .eq("id", jobId)
    .limit(1)
    .maybeSingle();
  if (jobResult.error) {
    return Response.json({ ok: false, error: "shopling_selected_job_read_failed", message: jobResult.error.message }, { status: 503 });
  }
  if (!jobResult.data) return Response.json({ ok: false, error: "shopling_selected_job_not_found" }, { status: 404 });

  const job = record(jobResult.data);
  if (!isSeoBulkJob(job)) return Response.json({ ok: false, error: "shopling_selected_job_not_seo_bulk" }, { status: 409 });
  if (text(job.status) !== "success") {
    return Response.json({ ok: false, error: "shopling_selected_job_not_full_success", message: "샵플링 6채널 업로드가 완전 성공한 건만 마켓 자동등록할 수 있습니다." }, { status: 409 });
  }

  const tasksFromJob = sortTasks(taskRows(job));
  const groups = new Set(tasksFromJob.map((task) => task.productGroupKey));
  if (tasksFromJob.length !== 6 || groups.size !== 6) {
    return Response.json({ ok: false, error: "shopling_selected_job_six_channel_identity_invalid" }, { status: 409 });
  }

  const latest = await latestSeoBulkJobForLaunch(supabase, text(job.launch_item_id));
  if (latest.error) return Response.json({ ok: false, error: "shopling_selected_latest_job_lookup_failed", message: latest.error }, { status: 503 });
  if (latest.jobId !== jobId) {
    return Response.json({ ok: false, error: "shopling_selected_job_superseded", message: "같은 상품의 더 최근 샵플링 업로드가 있어 이전 업로드는 마켓전송하지 않습니다." }, { status: 409 });
  }

  const ownerId = tasksFromJob[0].ownerId;
  const launchItemId = tasksFromJob[0].launchItemId;
  const goodsKeys = tasksFromJob.map((task) => task.goodsKey);
  const now = new Date().toISOString();

  const hydrated = await supabase
    .from(LEDGER_TABLE)
    .upsert(tasksFromJob.map((task) => ledgerSeed(task, now)), { onConflict: "owner_id,goods_key", ignoreDuplicates: true });
  if (hydrated.error) {
    return Response.json({ ok: false, error: "shopling_selected_ledger_hydration_failed", message: hydrated.error.message }, { status: 503 });
  }

  // Explicit selection revives only the latest batch's safe, never-submitted rows.
  await supabase
    .from(LEDGER_TABLE)
    .update({
      status: "queued",
      title_status: "pending",
      market_status: "pending",
      claim_run_id: "",
      claimed_at: null,
      reason_code: "",
      message: "",
      completed_at: null,
      updated_at: now,
    })
    .eq("owner_id", ownerId)
    .in("goods_key", goodsKeys)
    .eq("status", "legacy_ignored")
    .eq("market_status", "legacy_ignored")
    .is("submit_armed_at", null);

  const staleCutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  await supabase
    .from(LEDGER_TABLE)
    .update({
      status: "queued",
      market_status: "pending",
      claim_run_id: "",
      claimed_at: null,
      reason_code: "stale_selected_claim_released",
      message: "이전 선택 실행이 송신 전에 중단되어 자동 원복했습니다.",
      updated_at: now,
    })
    .eq("owner_id", ownerId)
    .in("goods_key", goodsKeys)
    .eq("status", "claimed")
    .eq("market_status", "pending")
    .lt("claimed_at", staleCutoff)
    .is("submit_armed_at", null);

  // Retire only older unsent generations. Historical sent/armed/confirm rows are immutable.
  const stale = await supabase
    .from(LEDGER_TABLE)
    .select("goods_key")
    .eq("owner_id", ownerId)
    .eq("launch_item_id", launchItemId)
    .eq("status", "queued")
    .eq("market_status", "pending")
    .limit(80);
  if (!stale.error) {
    const current = new Set(goodsKeys);
    const staleKeys = (Array.isArray(stale.data) ? stale.data : [])
      .map((row) => text(record(row).goods_key))
      .filter((goodsKey) => /^\d{5,9}$/.test(goodsKey) && !current.has(goodsKey));
    if (staleKeys.length) {
      await supabase
        .from(LEDGER_TABLE)
        .update({
          status: "legacy_ignored",
          title_status: "legacy_ignored",
          market_status: "legacy_ignored",
          reason_code: "superseded_by_selected_upload_batch",
          message: "확장프로그램에서 최신 샵플링 업로드 배치를 선택하여 이전 미전송 배치를 제외했습니다.",
          completed_at: now,
          updated_at: now,
        })
        .eq("owner_id", ownerId)
        .in("goods_key", staleKeys)
        .eq("status", "queued")
        .eq("market_status", "pending");
    }
  }

  const recovered = await supabase
    .from(LEDGER_TABLE)
    .select("owner_id,goods_key,launch_item_id,model_number,product_group_key,profile,ptn_goods_cd,search_prefix,registry_registered_at")
    .eq("owner_id", ownerId)
    .eq("claim_run_id", runId)
    .eq("status", "claimed")
    .eq("market_status", "pending")
    .in("goods_key", goodsKeys)
    .limit(3);
  if (recovered.error) {
    return Response.json({ ok: false, error: "shopling_selected_claim_recovery_failed", message: recovered.error.message }, { status: 503 });
  }
  if (Array.isArray(recovered.data) && recovered.data.length) {
    const recoveredTasks = sortTasks(recovered.data.map(taskFromLedger).filter(Boolean) as NonNullable<ReturnType<typeof taskFromLedger>>[]);
    return Response.json({ ok: true, bridge: BRIDGE, runId, jobId, tasks: recoveredTasks, taskCount: recoveredTasks.length, recovered: true });
  }

  const candidates = await supabase
    .from(LEDGER_TABLE)
    .select("owner_id,goods_key,launch_item_id,model_number,product_group_key,profile,ptn_goods_cd,search_prefix,registry_registered_at")
    .eq("owner_id", ownerId)
    .in("goods_key", goodsKeys)
    .eq("status", "queued")
    .eq("market_status", "pending")
    .limit(6);
  if (candidates.error) {
    return Response.json({ ok: false, error: "shopling_selected_candidate_failed", message: candidates.error.message }, { status: 503 });
  }

  const candidateTasks = sortTasks((Array.isArray(candidates.data) ? candidates.data : []).map(taskFromLedger).filter(Boolean) as NonNullable<ReturnType<typeof taskFromLedger>>[]);
  const wave = candidateTasks.slice(0, maxTasks);
  if (wave.length) {
    const claimAt = new Date().toISOString();
    const claimed = await supabase
      .from(LEDGER_TABLE)
      .update({ status: "claimed", claim_run_id: runId, claimed_at: claimAt, updated_at: claimAt })
      .eq("owner_id", ownerId)
      .in("goods_key", wave.map((task) => task.goodsKey))
      .eq("status", "queued")
      .eq("market_status", "pending")
      .select("owner_id,goods_key,launch_item_id,model_number,product_group_key,profile,ptn_goods_cd,search_prefix,registry_registered_at");
    if (claimed.error) {
      return Response.json({ ok: false, error: "shopling_selected_claim_failed", message: claimed.error.message }, { status: 503 });
    }
    const tasks = sortTasks((Array.isArray(claimed.data) ? claimed.data : []).map(taskFromLedger).filter(Boolean) as NonNullable<ReturnType<typeof taskFromLedger>>[]);
    if (!tasks.length) return Response.json({ ok: false, error: "shopling_selected_claim_race" }, { status: 409 });
    return Response.json({ ok: true, bridge: BRIDGE, runId, jobId, tasks, taskCount: tasks.length, recovered: false });
  }

  const summaryResult = await supabase
    .from(LEDGER_TABLE)
    .select("goods_key,status,market_status,reason_code,message")
    .eq("owner_id", ownerId)
    .in("goods_key", goodsKeys)
    .limit(6);
  if (summaryResult.error) {
    return Response.json({ ok: false, error: "shopling_selected_summary_failed", message: summaryResult.error.message }, { status: 503 });
  }
  const summaryRows = Array.isArray(summaryResult.data) ? summaryResult.data.map(record) : [];
  const successCount = summaryRows.filter((row) => ["sent", "already_registered"].includes(text(row.status)) || ["sent", "already_registered"].includes(text(row.market_status))).length;
  const confirmNeededCount = summaryRows.filter((row) => text(row.status) === "confirm_needed" || text(row.market_status) === "confirm_needed").length;
  const busyCount = summaryRows.filter((row) => text(row.status) === "claimed" || text(row.market_status) === "submit_armed").length;

  return Response.json({
    ok: true,
    bridge: BRIDGE,
    runId,
    jobId,
    tasks: [],
    taskCount: 0,
    empty: true,
    summary: {
      successCount,
      confirmNeededCount,
      busyCount,
      totalCount: 6,
      completed: successCount + confirmNeededCount >= 6 && busyCount === 0,
    },
  });
}
