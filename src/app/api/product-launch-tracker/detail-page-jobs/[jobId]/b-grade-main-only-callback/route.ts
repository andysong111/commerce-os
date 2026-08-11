import { NextRequest } from "next/server";
import {
  bearerToken,
  getDetailPageJobConfig,
  isValidDetailPageJobId,
  patchDetailPageJob,
  publicDetailPageJob,
  readDetailPageJob,
  verifyDetailPageJobToken,
} from "@/lib/detailPageJobServer";
import { matchesDetailPageExecution } from "@/lib/detailPageJobRecovery";

const CALLBACK_SUFFIX = "/b-grade-main-only-callback";
const TERMINAL = new Set(["success", "failed", "cancelled"]);

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  const body = asRecord(await request.json().catch(() => ({})));
  if (String(body.action ?? "") !== "final_complete") {
    return forwardToParentCallback(request, body);
  }

  const config = getDetailPageJobConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });
  const { jobId } = await context.params;
  if (!isValidDetailPageJobId(jobId)) {
    return Response.json(
      {
        ok: false,
        code: "INVALID_DETAIL_PAGE_JOB",
        message: "작업 ID가 올바르지 않습니다.",
      },
      { status: 400 },
    );
  }

  try {
    const job = await readDetailPageJob(config.value, jobId);
    if (!job) {
      return Response.json(
        {
          ok: false,
          code: "DETAIL_PAGE_JOB_NOT_FOUND",
          message: "상세페이지 작업을 찾지 못했습니다.",
        },
        { status: 404 },
      );
    }

    const token = bearerToken(request);
    if (
      !token ||
      !verifyDetailPageJobToken(config.value, job.owner_id, job.id, token)
    ) {
      return Response.json(
        {
          ok: false,
          code: "DETAIL_PAGE_JOB_AUTH_FAILED",
          message: "B급 대표이미지 도킹 인증에 실패했습니다.",
        },
        { status: 401 },
      );
    }

    if (!matchesDetailPageExecution(job, body.executionId)) {
      return Response.json(
        {
          ok: false,
          code: "DETAIL_PAGE_EXECUTION_STALE",
          message: "이전 B급 실행의 최종 도킹을 차단했습니다.",
        },
        { status: 409 },
      );
    }

    if (job.status === "success" && job.result?.bGradeMainOnly === true) {
      return Response.json({ ok: true, job: publicDetailPageJob(job) });
    }
    if (TERMINAL.has(job.status)) {
      return Response.json(
        {
          ok: false,
          code: "DETAIL_PAGE_JOB_TERMINAL",
          message: "종료된 상세페이지 작업의 늦은 B급 콜백을 차단했습니다.",
        },
        { status: 409 },
      );
    }

    const detailImageUrl = text(body.detailImageUrl);
    const mainImageUrl = text(body.mainImageUrl);
    const ownedPrefix = ownedAssetPrefix(config.value.supabaseUrl, job);
    if (
      !detailImageUrl ||
      !mainImageUrl ||
      !isOwnedAssetUrl(detailImageUrl, ownedPrefix) ||
      !isOwnedAssetUrl(mainImageUrl, ownedPrefix)
    ) {
      return Response.json(
        {
          ok: false,
          code: "DETAIL_PAGE_B_GRADE_MAIN_ONLY_ASSET_INVALID",
          message: "B급 최종 상세페이지 또는 대표이미지 저장 주소가 올바르지 않습니다.",
        },
        { status: 400 },
      );
    }

    const completedAt = new Date().toISOString();
    const callbackResult = asRecord(body.result);
    const previousMarket = asRecord(callbackResult.bGradeMarketplaceRepresentatives);
    const changed = await patchDetailPageJob(config.value, job.id, {
      status: "success",
      stage: "docked",
      message: "검수 통과 · B급 대표이미지 1장과 상세페이지 도킹 완료",
      progress: 100,
      qa_status: "passed",
      result: {
        ...callbackResult,
        assetWork: null,
        manualRegenerationBackup: null,
        representatives: [],
        detailImageUrl,
        mainImageUrl,
        additionalImageUrls: [],
        bGradeMainOnly: true,
        bGradeAdditionalImagesSuppressed: true,
        bGradeMarketplaceRepresentatives: {
          ...previousMarket,
          mode: "main-only-v1",
          publishedCount: 1,
          additionalCount: 0,
        },
        finalizerPhase: "complete",
        standardFailure: null,
        standard_failure: null,
        panelRetrySlots: [],
        panelRetryInstructions: {},
      },
      step_version: Math.max(
        job.step_version,
        Number(body.stepVersion) || job.step_version,
      ),
      lease_owner: "",
      lease_until: null,
      error_message: "",
      completed_at: completedAt,
    });

    return Response.json({ ok: true, job: publicDetailPageJob(changed ?? job) });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "DETAIL_PAGE_B_GRADE_MAIN_ONLY_COMPLETE_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "B급 대표이미지 1장 도킹을 완료하지 못했습니다.",
      },
      { status: 500 },
    );
  }
}

async function forwardToParentCallback(
  request: NextRequest,
  body: Record<string, unknown>,
) {
  const target = new URL(request.url);
  target.pathname = target.pathname.replace(new RegExp(`${CALLBACK_SUFFIX}/?$`), "");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const authorization = request.headers.get("authorization");
  if (authorization) headers.Authorization = authorization;
  const protectionBypass = request.headers.get("x-vercel-protection-bypass");
  if (protectionBypass) {
    headers["x-vercel-protection-bypass"] = protectionBypass;
  }

  const response = await fetch(target, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
    redirect: "manual",
  });
  const responseBody = await response.text();
  return new Response(responseBody, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("content-type") || "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function ownedAssetPrefix(
  supabaseUrl: string,
  job: { owner_id: string; launch_item_id: string; id: string },
) {
  const base = new URL(supabaseUrl);
  return {
    origin: base.origin,
    pathname: `/storage/v1/object/public/product-launch-assets/${safePathSegment(job.owner_id)}/${safePathSegment(job.launch_item_id)}/${safePathSegment(job.id)}/`,
  };
}

function isOwnedAssetUrl(
  value: string,
  ownedPrefix: { origin: string; pathname: string },
) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.origin === ownedPrefix.origin &&
      url.pathname.startsWith(ownedPrefix.pathname)
    );
  } catch {
    return false;
  }
}

function safePathSegment(value: string) {
  return String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
