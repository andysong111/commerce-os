import { after, NextRequest } from "next/server";
import {
  getDetailPageJobConfig,
  insertDetailPageJob,
  isValidDetailPageJobId,
  listDetailPageJobs,
  publicDetailPageJob,
  resolveDetailPageJobIdentity,
  searchDetailPageJobs,
} from "@/lib/detailPageJobServer";
import { withDetailPageStoreRetry } from "@/lib/detailPageStoreRetry";

const MAX_RECENT_JOBS = 50;
const COMPILER_WORKER_SLOT_COUNT = 3;
const JOB_LIST_CACHE_TTL_MS = 8_000;
const JOB_LIST_STALE_TTL_MS = 60_000;
const JOB_LIST_CACHE_MAX_KEYS = 40;

type DetailPageJobList = Awaited<ReturnType<typeof listDetailPageJobs>>;
type JobListCacheEntry = {
  expiresAt: number;
  staleUntil: number;
  jobs: DetailPageJobList;
  inFlight?: Promise<DetailPageJobList>;
};

const jobListCache = new Map<string, JobListCacheEntry>();

export async function GET(request: NextRequest) {
  const identity = await resolveDetailPageJobIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });
  const config = getDetailPageJobConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });
  try {
    const query = request.nextUrl.searchParams.get("query")?.trim() ?? "";
    const jobs = await cachedDetailPageJobs(
      config.value,
      identity.value.userId,
      query,
    );
    return Response.json({
      ok: true,
      scope: query ? "search" : "recent",
      jobs: jobs.map(publicDetailPageJob),
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "DETAIL_PAGE_JOB_LIST_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "상세페이지 작업 목록을 읽지 못했습니다.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const identity = await resolveDetailPageJobIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });
  const config = getDetailPageJobConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  let input: {
    jobId: string;
    itemId: string;
    sourceUrl: string;
    salesOptions: string;
    productName: string;
    attempt: number;
    compilerCanary: boolean;
    compilerWorkerSlot: number | null;
  };
  try {
    const body = await request.json();
    const sourceUrl = normalize1688Url(body?.sourceUrl);
    const jobId = String(body?.jobId ?? "").trim();
    const itemId = safeText(body?.itemId, 160);
    if (!isValidDetailPageJobId(jobId) || !itemId) {
      throw new Error("상품 또는 작업 ID가 올바르지 않습니다.");
    }
    const compilerCanary = body?.compilerCanary === true;
    const requestedCompilerSlot = Number(body?.compilerWorkerSlot);
    const compilerWorkerSlot =
      compilerCanary &&
      Number.isInteger(requestedCompilerSlot) &&
      requestedCompilerSlot >= 0 &&
      requestedCompilerSlot < COMPILER_WORKER_SLOT_COUNT
        ? requestedCompilerSlot
        : null;
    input = {
      jobId,
      itemId,
      sourceUrl,
      salesOptions: safeText(body?.salesOptions, 2_000),
      productName: safeText(body?.productName, 250) || "상품",
      attempt: Math.max(1, Math.min(100, Number(body?.attempt) || 1)),
      compilerCanary,
      compilerWorkerSlot,
    };
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "INVALID_DETAIL_PAGE_JOB",
        message:
          error instanceof Error
            ? error.message
            : "상세페이지 작업 값이 올바르지 않습니다.",
      },
      { status: 400 },
    );
  }

  if (!input.salesOptions) {
    return Response.json(
      {
        ok: false,
        code: "DETAIL_PAGE_SALES_OPTIONS_REQUIRED",
        message:
          "옵션란이 비어있습니다. 상품 출시 관리의 옵션란을 입력한 뒤 다시 실행하세요.",
      },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  try {
    const job = await insertDetailPageJob(config.value, {
      id: input.jobId,
      owner_id: identity.value.userId,
      owner_email: identity.value.email,
      launch_item_id: input.itemId,
      request_id: `detail-page:${input.jobId}`,
      status: "running",
      payload: {
        kind: "detail_page",
        schema_version: 1,
        logical_status: "collecting",
        stage: "source_collection",
        message: input.compilerCanary
          ? "Evidence Compiler 신규 카나리 · 1688 상품정보·이미지 수집 준비 중"
          : "1688 상품정보·이미지 수집 준비 중",
        progress: 3,
        qa_status: "pending",
        attempt: input.attempt,
        source_url: input.sourceUrl,
        sales_options: input.salesOptions,
        product_name_hint: input.productName,
        source_run_id: "",
        compiler_canary: input.compilerCanary,
        compiler_worker_slot: input.compilerWorkerSlot,
        compiler_canary_created_at: input.compilerCanary ? now : null,
        step_version: 0,
        lease_owner: "",
        lease_until: null,
        started_at: now,
      },
      result: {},
      error_message: "",
      created_at: now,
      updated_at: now,
      completed_at: null,
    });
    if (!job) throw new Error("생성한 작업을 다시 읽지 못했습니다.");
    invalidateDetailPageJobListCache(identity.value.userId);
    return Response.json(
      {
        ok: true,
        job: publicDetailPageJob(job),
      },
      { status: 201 },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "상세페이지 작업을 만들지 못했습니다.";
    const duplicate = /duplicate|unique|already exists/i.test(message);
    return Response.json(
      {
        ok: false,
        code: duplicate
          ? "DETAIL_PAGE_JOB_ALREADY_EXISTS"
          : "DETAIL_PAGE_JOB_CREATE_FAILED",
        message: duplicate
          ? "같은 상세페이지 작업이 이미 등록되어 있습니다."
          : message,
      },
      { status: duplicate ? 409 : 500 },
    );
  }
}

async function cachedDetailPageJobs(
  config: Parameters<typeof listDetailPageJobs>[0],
  ownerId: string,
  query: string,
) {
  const normalizedQuery = query.trim();
  const key = `${ownerId}:${normalizedQuery.toLocaleLowerCase("ko-KR")}`;
  const now = Date.now();
  const cached = jobListCache.get(key);

  if (cached && cached.expiresAt > now) return cached.jobs;
  if (cached?.inFlight) {
    if (cached.staleUntil > now) return cached.jobs;
    return cached.inFlight;
  }

  const request = loadDetailPageJobs(config, ownerId, normalizedQuery);

  if (cached && cached.staleUntil > now) {
    jobListCache.set(key, { ...cached, inFlight: request });
    after(async () => {
      try {
        const jobs = await request;
        cacheDetailPageJobs(key, jobs);
      } catch (error) {
        console.error("[detail-page-job-list] background refresh failed", error);
        const latest = jobListCache.get(key);
        if (latest) jobListCache.set(key, { ...latest, inFlight: undefined });
      }
    });
    return cached.jobs;
  }

  if (jobListCache.size >= JOB_LIST_CACHE_MAX_KEYS) {
    jobListCache.clear();
  }
  jobListCache.set(key, {
    expiresAt: 0,
    staleUntil: 0,
    jobs: cached?.jobs ?? [],
    inFlight: request,
  });

  try {
    const jobs = await request;
    cacheDetailPageJobs(key, jobs);
    return jobs;
  } catch (error) {
    jobListCache.delete(key);
    throw error;
  }
}

function loadDetailPageJobs(
  config: Parameters<typeof listDetailPageJobs>[0],
  ownerId: string,
  normalizedQuery: string,
) {
  return withDetailPageStoreRetry(() =>
    normalizedQuery
      ? searchDetailPageJobs(
          config,
          ownerId,
          normalizedQuery,
          MAX_RECENT_JOBS,
        )
      : listDetailPageJobs(config, ownerId, MAX_RECENT_JOBS),
  );
}

function cacheDetailPageJobs(key: string, jobs: DetailPageJobList) {
  const now = Date.now();
  jobListCache.set(key, {
    expiresAt: now + JOB_LIST_CACHE_TTL_MS,
    staleUntil: now + JOB_LIST_STALE_TTL_MS,
    jobs,
  });
}

function invalidateDetailPageJobListCache(ownerId: string) {
  for (const key of jobListCache.keys()) {
    if (key.startsWith(`${ownerId}:`)) jobListCache.delete(key);
  }
}

function safeText(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function normalize1688Url(value: unknown) {
  let url: URL;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    throw new Error("올바른 1688 상품 상세주소가 필요합니다.");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "detail.1688.com" ||
    url.username ||
    url.password ||
    !/^\/offer\/\d+\.html$/i.test(url.pathname)
  ) {
    throw new Error(
      "https://detail.1688.com/offer/...html 형식만 사용할 수 있습니다.",
    );
  }
  url.hash = "";
  return url.toString();
}
