import { NextRequest } from "next/server";
import {
  createDetailPageJobToken,
  getDetailPageJobConfig,
  isValidDetailPageJobId,
  readDetailPageJob,
  resolveDetailPageJobIdentity,
} from "@/lib/detailPageJobServer";
import {
  buildProtectedOpsCallbackUrl,
  resolveDetailPageStudioConnection,
} from "@/lib/detailPageStudioConnection";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  const identity = await resolveDetailPageJobIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });
  const config = getDetailPageJobConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });
  const { jobId } = await context.params;
  if (!isValidDetailPageJobId(jobId)) {
    return Response.json(
      { ok: false, code: "INVALID_DETAIL_PAGE_JOB", message: "작업 ID가 올바르지 않습니다." },
      { status: 400 },
    );
  }
  try {
    const job = await readDetailPageJob(config.value, jobId);
    if (!job || job.owner_id !== identity.value.userId) {
      return Response.json(
        { ok: false, code: "DETAIL_PAGE_JOB_NOT_FOUND", message: "상세페이지 작업을 찾지 못했습니다." },
        { status: 404 },
      );
    }
    if (["success", "failed", "cancelled"].includes(job.status)) {
      return Response.json({ ok: true, accepted: false, terminal: true, status: job.status });
    }
    if (
      job.status !== "render_pending" &&
      (!Array.isArray(job.payload.evidence_urls) || job.payload.evidence_urls.length < 1)
    ) {
      return Response.json(
        { ok: false, code: "DETAIL_PAGE_EVIDENCE_NOT_READY", message: "1688 근거 이미지 저장이 완료되지 않았습니다." },
        { status: 409 },
      );
    }
    const connection = resolveDetailPageStudioConnection();
    const callbackUrl = buildProtectedOpsCallbackUrl(
      request.url,
      `/api/product-launch-tracker/detail-page-jobs/${job.id}`,
    );
    const response = await fetch(connection.workerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...connection.requestHeaders,
      },
      body: JSON.stringify({
        callbackUrl: callbackUrl.toString(),
        workerUrl: connection.workerUrl.toString(),
        token: createDetailPageJobToken(config.value, job.owner_id, job.id),
      }),
      redirect: "manual",
      cache: "no-store",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true) {
      return Response.json(
        {
          ok: false,
          code: "DETAIL_PAGE_WORKER_START_FAILED",
          message:
            body?.message ||
            (response.status >= 300 && response.status < 400
              ? "Studio Preview 보호 인증이 서버 작업을 차단했습니다."
              : `Studio 서버 작업 시작에 실패했습니다. status=${response.status}`),
        },
        { status: 502 },
      );
    }
    return Response.json({ ok: true, accepted: true, workerId: body.workerId });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "DETAIL_PAGE_WORKER_START_FAILED",
        message: error instanceof Error ? error.message : "Studio 서버 작업을 시작하지 못했습니다.",
      },
      { status: 500 },
    );
  }
}

