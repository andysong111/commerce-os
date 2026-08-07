import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import {
  getDetailPageJobConfig,
  isValidDetailPageJobId,
  patchDetailPageJob,
  publicDetailPageJob,
  readDetailPageJob,
  resolveDetailPageJobIdentity,
  type DetailPageJobRow,
} from "@/lib/detailPageJobServer";

const ACTIVE_STATUSES = new Set(["collecting", "queued", "running", "render_pending"]);

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
    if (job.status === "cancelled") {
      return Response.json({ ok: true, job: publicDetailPageJob(job) });
    }
    if (!isCancellable(job)) {
      return Response.json(
        {
          ok: false,
          code: "DETAIL_PAGE_JOB_NOT_ACTIVE",
          message: "현재 진행 중인 상세페이지 작업만 취소할 수 있습니다.",
        },
        { status: 409 },
      );
    }

    const cancelledAt = new Date().toISOString();
    const changed = await patchDetailPageJob(config.value, job.id, {
      status: "cancelled",
      stage: "cancelled",
      message: "사용자가 AI 작업검수 화면에서 진행 중 작업을 취소했습니다.",
      qa_status: "cancelled",
      payload: {
        cancelled_by_user_at: cancelledAt,
        execution_id: randomUUID(),
        execution_started_at: cancelledAt,
        worker_dispatch_id: "",
        worker_dispatch_execution_id: "",
        worker_dispatch_started_at: "",
        worker_dispatch_until: "",
      },
      lease_owner: "",
      lease_until: null,
      error_message: "사용자 취소",
      completed_at: cancelledAt,
    });
    if (!changed) {
      return Response.json(
        { ok: false, code: "DETAIL_PAGE_JOB_NOT_FOUND", message: "상세페이지 작업을 찾지 못했습니다." },
        { status: 404 },
      );
    }
    return Response.json({ ok: true, job: publicDetailPageJob(changed) });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "DETAIL_PAGE_REVIEW_JOB_CANCEL_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "상세페이지 작업을 취소하지 못했습니다.",
      },
      { status: 500 },
    );
  }
}

function isCancellable(job: DetailPageJobRow) {
  if (ACTIVE_STATUSES.has(job.status)) return true;
  return job.status === "failed" && job.stage === "server_final_assembly";
}
