import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import { reconcileProductLaunchNormalizedAfterLegacyItems } from "@/lib/productLaunchTrackerNormalizedLegacyReconcile";
import {
  getProductLaunchAdminConfig,
  readProductLaunchState,
  readProductLaunchStorageJson,
  writeProductLaunchState,
  type ProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

export async function rearmFailedDurableSeoRegistrationRuns(options: {
  maxRuns?: number;
} = {}) {
  const configResult = getProductLaunchAdminConfig();
  if (!configResult.ok) {
    throw new Error("Shopling 재시도 준비 저장소가 설정되지 않았습니다.");
  }
  const config = configResult.value;
  const maxRuns = Math.max(1, Math.min(20, Math.floor(options.maxRuns ?? 6)));
  const params = new URLSearchParams({
    select: "run_id,owner_id,owner_email,launch_item_id,registration_status",
    status: "eq.ready",
    registration_status: "eq.failed",
    archived_at: "is.null",
    order: "updated_at.desc",
    limit: String(maxRuns),
  });
  const { body } = await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/seo_run_jobs?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );

  let rearmedCount = 0;
  const rearmedRuns: string[] = [];
  for (const value of Array.isArray(body) ? body : []) {
    const run = record(value);
    const runId = text(run.run_id);
    const ownerId = text(run.owner_id);
    const ownerEmail = text(run.owner_email);
    const itemId = text(run.launch_item_id);
    if (!runId || !ownerId || !itemId) continue;

    const stateRow = await readProductLaunchState(config, ownerId);
    const state = record(stateRow?.state_payload);
    const items = Array.isArray(state.items) ? state.items.map(record) : [];
    const itemIndex = items.findIndex((item) => text(item.id) === itemId);
    if (itemIndex < 0) continue;

    const item = { ...items[itemIndex] };
    const dispatch = record(item.seoRunDispatch);
    if (text(dispatch.seoRunId) !== runId || text(dispatch.status) !== "failed") {
      continue;
    }

    const now = new Date().toISOString();
    item.seoRunDispatch = {
      ...dispatch,
      status: "prepared",
      error: "",
      rearmedAt: now,
      rearmedFrom: "failed_registration_retry",
    };
    item.updatedAt = now;
    item.updatedBy = "SEO RUN Shopling 재시도 준비";
    items[itemIndex] = item;
    state.items = items;
    state.savedAt = now;

    const identity: ProductLaunchIdentity = {
      userId: ownerId,
      email: ownerEmail,
    };
    await writeProductLaunchState(config, identity, state);
    await reconcileProductLaunchNormalizedAfterLegacyItems(
      config,
      identity,
      [itemId],
    );
    rearmedCount += 1;
    rearmedRuns.push(runId);
  }

  return { rearmedCount, rearmedRuns };
}
