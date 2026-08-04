import { NextRequest } from "next/server";
import {
  getDetailPageJobConfig,
  insertDetailPageJob,
  isValidDetailPageJobId,
  listDetailPageJobs,
  publicDetailPageJob,
  resolveDetailPageJobIdentity,
  searchDetailPageJobs,
} from "@/lib/detailPageJobServer";

const MAX_RECENT_JOBS = 50;

export async function GET(request: NextRequest) {
  const identity = await resolveDetailPageJobIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });
  const config = getDetailPageJobConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });
  try {
    const query = request.nextUrl.searchParams.get("query")?.trim() ?? "";
    const jobs = query
      ? await searchDetailPageJobs(
          config.value,
          identity.value.userId,
          query,
          MAX_RECENT_JOBS,
        )
      : await listDetailPageJobs(
          config.value,
          identity.value.userId,
          MAX_RECENT_JOBS,
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
        message: error instanceof Error ? error.message : "상세페이지 작업 목록을 읽지 못했습니다.",
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
  };
  try {
    const body = await request.json();
    const sourceUrl = normalize1688Url(body?.sourceUrl);
    const jobId = String(body?.jobId ?? "").trim();
    const itemId = safeText(body?.itemId, 160);
    if (!isValidDetailPageJobId(jobId) || !itemId) {
      throw new Error("상품 또는 작업 ID가 올바르지 않습니다.");
    }
    input = {
      jobId,
      itemId,
      sourceUrl,
      salesOptions: safeText(body?.salesOptions, 2_000),
      productName: safeText(body?.productName, 250) || "상품",
      attempt: Math.max(1, Math.min(100, Number(body?.attempt) || 1)),
    };
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "INVALID_DETAIL_PAGE_JOB",
        message: error instanceof Error ? error.message : "상세페이지 작업 값이 올바르지 않습니다.",
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
        message: "1688 상품정보·이미지 수집 준비 중",
        progress: 3,
        qa_status: "pending",
        attempt: input.attempt,
        source_url: input.sourceUrl,
        sales_options: input.salesOptions,
        product_name_hint: input.productName,
        source_run_id: "",
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
    return Response.json(
      {
        ok: true,
        job: publicDetailPageJob(job),
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "상세페이지 작업을 만들지 못했습니다.";
    const duplicate = /duplicate|unique|already exists/i.test(message);
    return Response.json(
      {
        ok: false,
        code: duplicate ? "DETAIL_PAGE_JOB_ALREADY_EXISTS" : "DETAIL_PAGE_JOB_CREATE_FAILED",
        message: duplicate ? "같은 상세페이지 작업이 이미 등록되어 있습니다." : message,
      },
      { status: duplicate ? 409 : 500 },
    );
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
    throw new Error("https://detail.1688.com/offer/...html 형식만 사용할 수 있습니다.");
  }
  url.hash = "";
  return url.toString();
}
