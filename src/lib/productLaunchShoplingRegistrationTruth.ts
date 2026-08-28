import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import { reconcileProductLaunchNormalizedAfterLegacyItems } from "@/lib/productLaunchTrackerNormalizedLegacyReconcile";
import {
  getProductLaunchAdminConfig,
  readProductLaunchState,
  readProductLaunchStorageJson,
  writeProductLaunchState,
  type ProductLaunchAdminConfig,
  type ProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";

const SEO_RUN_TABLE = "seo_run_jobs";
const UPLOAD_JOB_TABLE = "product_launch_upload_jobs";

const CHANNEL_SUFFIX: Record<string, string> = {
  wholesale1: "a",
  wholesale2: "b",
  wholesale3: "c",
  wholesale4: "d",
  retail1: "e",
  retail2: "f",
};

const CHANNEL_LABEL_TO_KEY: Record<string, string> = {
  도매1: "wholesale1",
  도매2: "wholesale2",
  도매3: "wholesale3",
  도매4: "wholesale4",
  소매1: "retail1",
  소매2: "retail2",
};

const EXPECTED_CHANNEL_COUNT = 6;

type UnknownRecord = Record<string, unknown>;

type SeoRunRow = {
  run_id: string;
  owner_id: string;
  owner_email: string;
  launch_item_id: string;
  model_number: string;
  registration_status: string;
  registration_payload: UnknownRecord;
};

export type VerifiedShoplingRegistrationTruth = {
  jobId: string;
  requestId: string;
  completedAt: string;
  selfCodeBase: string;
  goodsKeys: string[];
  rows: Array<{
    channelKey: string;
    goodsKey: string;
  }>;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function normalizedCode(value: unknown) {
  return text(value).normalize("NFKC").toUpperCase().replace(/\s+/g, "");
}

function rowSucceeded(row: UnknownRecord) {
  return (
    row.success === true ||
    String(row.status ?? "").toLowerCase() === "success" ||
    String(row.code ?? "") === "000"
  );
}

function channelKeyOf(row: UnknownRecord) {
  const direct = text(row.channel_key ?? row.channelKey);
  if (direct in CHANNEL_SUFFIX) return direct;
  return CHANNEL_LABEL_TO_KEY[text(row.channel ?? row.channel_label)] ?? "";
}

function selfCodeBaseFromPayload(payloadInput: unknown) {
  const payload = record(payloadInput);
  const channels = array(payload.channels).map(record);
  if (channels.length !== EXPECTED_CHANNEL_COUNT) return "";
  const seen = new Set<string>();
  const bases = new Set<string>();

  for (const channel of channels) {
    const key = text(channel.key);
    const suffix = CHANNEL_SUFFIX[key];
    const code = normalizedCode(channel.ptnGoodsCd ?? channel.ptn_goods_cd);
    if (!suffix || !code || seen.has(key)) return "";
    seen.add(key);
    if (!code.toLowerCase().endsWith(suffix)) return "";
    const base = code.slice(0, -1);
    if (!base) return "";
    bases.add(base);
  }

  if (seen.size !== EXPECTED_CHANNEL_COUNT || bases.size !== 1) return "";
  return [...bases][0];
}

export function matchVerifiedShoplingUploadToSeoRun(
  runInput: unknown,
  jobInput: unknown,
): VerifiedShoplingRegistrationTruth | null {
  const run = record(runInput);
  const job = record(jobInput);
  const registrationPayload = record(run.registration_payload);
  const expectedBase = normalizedCode(registrationPayload.newSelfCodeBase);
  if (!expectedBase) return null;
  if (text(job.launch_item_id) !== text(run.launch_item_id)) return null;
  if (text(job.status) !== "success") return null;
  if (selfCodeBaseFromPayload(job.payload) !== expectedBase) return null;

  const result = record(job.result);
  const verification = record(result.readback_verification);
  if (verification.verified !== true) return null;
  if (Number(result.success_count ?? 0) < EXPECTED_CHANNEL_COUNT) return null;
  if (Number(result.failed_count ?? 0) > 0) return null;

  const successfulRows = array(result.rows)
    .map(record)
    .filter(rowSucceeded)
    .map((row) => ({
      channelKey: channelKeyOf(row),
      goodsKey: text(row.goods_key ?? row.goodsKey),
    }))
    .filter((row) => row.channelKey && /^\d+$/.test(row.goodsKey));

  if (successfulRows.length !== EXPECTED_CHANNEL_COUNT) return null;
  if (new Set(successfulRows.map((row) => row.channelKey)).size !== EXPECTED_CHANNEL_COUNT) {
    return null;
  }
  if (new Set(successfulRows.map((row) => row.goodsKey)).size !== EXPECTED_CHANNEL_COUNT) {
    return null;
  }

  return {
    jobId: text(job.id),
    requestId: text(job.request_id),
    completedAt: text(job.completed_at) || text(job.updated_at) || new Date().toISOString(),
    selfCodeBase: expectedBase,
    goodsKeys: successfulRows.map((row) => row.goodsKey),
    rows: successfulRows,
  };
}

async function readReconciliationCandidates(config: ProductLaunchAdminConfig) {
  const params = new URLSearchParams({
    select:
      "run_id,owner_id,owner_email,launch_item_id,model_number,registration_status,registration_payload",
    status: "eq.ready",
    archived_at: "is.null",
    order: "updated_at.desc",
    limit: "40",
  });
  const { body } = await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/${SEO_RUN_TABLE}?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );
  return (Array.isArray(body) ? body : [])
    .map(record)
    .filter((row) => text(row.registration_status) !== "success")
    .filter((row) => text(record(row.registration_payload).newSelfCodeBase))
    .map((row) => ({
      run_id: text(row.run_id),
      owner_id: text(row.owner_id),
      owner_email: text(row.owner_email),
      launch_item_id: text(row.launch_item_id),
      model_number: text(row.model_number),
      registration_status: text(row.registration_status),
      registration_payload: record(row.registration_payload),
    })) as SeoRunRow[];
}

async function readSuccessfulUploadJobs(
  config: ProductLaunchAdminConfig,
  launchItemId: string,
) {
  const params = new URLSearchParams({
    select:
      "id,launch_item_id,request_id,status,payload,result,error_message,created_at,updated_at,completed_at",
    launch_item_id: `eq.${launchItemId}`,
    status: "eq.success",
    order: "completed_at.desc,created_at.desc",
    limit: "20",
  });
  const { body } = await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/${UPLOAD_JOB_TABLE}?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );
  return (Array.isArray(body) ? body : []).map(record);
}

async function patchTrackerStateFromTruth(
  config: ProductLaunchAdminConfig,
  run: SeoRunRow,
  truth: VerifiedShoplingRegistrationTruth,
) {
  const stateRow = await readProductLaunchState(config, run.owner_id);
  const state = record(stateRow?.state_payload);
  const items = Array.isArray(state.items) ? state.items.map(record) : [];
  const itemIndex = items.findIndex((item) => text(item.id) === run.launch_item_id);
  if (itemIndex < 0) return false;

  const item = { ...items[itemIndex] };
  const dispatch = record(item.seoRunDispatch);
  if (text(dispatch.seoRunId) !== run.run_id) return false;

  const products = { ...record(item.shoplingProducts) };
  for (const row of truth.rows) {
    products[row.channelKey] = {
      ...record(products[row.channelKey]),
      status: "success",
      goodsKey: row.goodsKey,
      error: "",
      registeredAt: truth.completedAt,
    };
  }
  item.shoplingProducts = products;
  item.selfCodeBase = truth.selfCodeBase;
  item.seoRunDispatch = {
    ...dispatch,
    status: "success",
    jobId: truth.jobId,
    requestId: truth.requestId,
    goodsKeys: truth.goodsKeys,
    completedAt: truth.completedAt,
    reconciledAt: new Date().toISOString(),
    reconciledFrom: "verified_product_launch_upload_job",
    error: "",
  };

  const stages = { ...record(item.stages) };
  stages.shoplingUpload = {
    ...record(stages.shoplingUpload),
    status: "완료",
    completedAt: truth.completedAt,
    note: "",
  };
  item.stages = stages;
  item.updatedAt = new Date().toISOString();
  item.updatedBy = "SEO RUN Shopling 실등록 자동복구";
  items[itemIndex] = item;
  state.items = items;
  state.savedAt = item.updatedAt;

  const identity: ProductLaunchIdentity = {
    userId: run.owner_id,
    email: run.owner_email,
  };
  await writeProductLaunchState(config, identity, state);
  await reconcileProductLaunchNormalizedAfterLegacyItems(
    config,
    identity,
    [run.launch_item_id],
  );
  return true;
}

async function patchSeoRunFromTruth(
  config: ProductLaunchAdminConfig,
  run: SeoRunRow,
  truth: VerifiedShoplingRegistrationTruth,
) {
  const nextPayload = {
    ...run.registration_payload,
    error: "",
    status: "success",
    goodsKeys: truth.goodsKeys,
    reconciledFrom: "verified_product_launch_upload_job",
    reconciledAt: new Date().toISOString(),
  };
  const params = new URLSearchParams({ run_id: `eq.${run.run_id}` });
  await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/${SEO_RUN_TABLE}?${params.toString()}`,
    {
      method: "PATCH",
      headers: {
        ...createSupabaseAdminHeaders(config.secretKey),
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        registration_status: "success",
        registration_job_id: truth.jobId,
        registration_request_id: truth.requestId,
        registration_payload: nextPayload,
        updated_at: new Date().toISOString(),
      }),
      cache: "no-store",
    },
  );
}

export async function reconcileVerifiedShoplingRegistrations(options: {
  maxRuns?: number;
} = {}) {
  const configResult = getProductLaunchAdminConfig();
  if (!configResult.ok) {
    throw new Error("Shopling 등록 진실값 복구 저장소가 설정되지 않았습니다.");
  }
  const config = configResult.value;
  const maxRuns = Math.max(1, Math.min(20, Math.floor(options.maxRuns ?? 6)));
  const candidates = (await readReconciliationCandidates(config)).slice(0, maxRuns);
  let reconciledCount = 0;
  const reconciledRuns: string[] = [];

  for (const run of candidates) {
    const jobs = await readSuccessfulUploadJobs(config, run.launch_item_id);
    const match = jobs
      .map((job) => matchVerifiedShoplingUploadToSeoRun(run, job))
      .find((value): value is VerifiedShoplingRegistrationTruth => Boolean(value));
    if (!match) continue;

    await patchTrackerStateFromTruth(config, run, match);
    await patchSeoRunFromTruth(config, run, match);
    reconciledCount += 1;
    reconciledRuns.push(run.run_id);
  }

  return {
    candidateCount: candidates.length,
    reconciledCount,
    reconciledRuns,
  };
}
