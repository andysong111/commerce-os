export const DETAIL_PAGE_WORKER_DISPATCH_MS = 60_000;

type DetailPageConcurrencyJob = {
  status: string;
  lease_owner?: string;
  lease_until?: string | null;
  payload?: Record<string, unknown>;
};

export type DetailPageDispatchDecision =
  | { action: "reserve" }
  | {
      action: "skip";
      reason: "terminal" | "lease_active" | "dispatch_active";
    };

export type DetailPageClaimDecision =
  | { action: "claim" }
  | { action: "skip"; reason: "terminal" | "lease_active" };

export function detailPageDispatchDecision(
  job: DetailPageConcurrencyJob,
  now = Date.now(),
): DetailPageDispatchDecision {
  if (terminal(job.status)) return { action: "skip", reason: "terminal" };
  if (activeLease(job, now)) {
    return { action: "skip", reason: "lease_active" };
  }
  if (activeDispatch(job, now)) {
    return { action: "skip", reason: "dispatch_active" };
  }
  return { action: "reserve" };
}

export function detailPageClaimDecision(
  job: DetailPageConcurrencyJob,
  workerId: string,
  now = Date.now(),
): DetailPageClaimDecision {
  if (terminal(job.status)) return { action: "skip", reason: "terminal" };
  const leaseOwner = text(job.lease_owner);
  if (activeLease(job, now) && leaseOwner !== text(workerId)) {
    return { action: "skip", reason: "lease_active" };
  }
  return { action: "claim" };
}

export function nextDetailPageMutationTimestamp(
  previousValue: unknown,
  now = Date.now(),
) {
  const previous = Date.parse(text(previousValue));
  return new Date(
    Math.max(now, Number.isFinite(previous) ? previous + 1 : now),
  ).toISOString();
}

function activeLease(job: DetailPageConcurrencyJob, now: number) {
  return Boolean(text(job.lease_owner)) && future(job.lease_until, now);
}

function activeDispatch(job: DetailPageConcurrencyJob, now: number) {
  const payload = record(job.payload);
  if (!text(payload.worker_dispatch_id)) return false;
  if (!future(payload.worker_dispatch_until, now)) return false;

  const executionId = text(payload.execution_id);
  const dispatchExecutionId = text(payload.worker_dispatch_execution_id);
  return (
    !executionId ||
    !dispatchExecutionId ||
    executionId === dispatchExecutionId
  );
}

function terminal(status: unknown) {
  return ["success", "failed", "cancelled"].includes(text(status));
}

function future(value: unknown, now: number) {
  const timestamp = Date.parse(text(value));
  return Number.isFinite(timestamp) && timestamp > now;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}
