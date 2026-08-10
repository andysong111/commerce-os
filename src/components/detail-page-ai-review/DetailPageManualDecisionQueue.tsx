"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DetailPageReviewJob } from "@/lib/detailPageAiReview";
import {
  canApproveV260807Identity,
  canResumeV260807Checkpoint,
  v260807IdentitySnapshot,
  v260807ManualDecisionKind,
  type V260807ManualDecisionKind,
} from "@/lib/detailPageManualDecision";

const JOBS_API = "/api/product-launch-tracker/detail-page-jobs";
const POLL_MS = 2_500;

type Notice =
  | { tone: "progress" | "success" | "error"; message: string }
  | null;

type ManualAction =
  | "resume_checkpoint"
  | "approve_identity"
  | "regenerate_identity_asset"
  | "change_identity_anchor";

export function DetailPageManualDecisionQueue() {
  const [jobs, setJobs] = useState<DetailPageReviewJob[]>([]);
  const [busyJobId, setBusyJobId] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [anchorSelections, setAnchorSelections] = useState<Record<string, number>>({});

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(JOBS_API, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        jobs?: DetailPageReviewJob[];
      };
      if (response.ok && body.ok === true && Array.isArray(body.jobs)) {
        setJobs(body.jobs);
      }
    } catch {
      // The main review workspace below remains the durable error surface.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const pending = useMemo(
    () =>
      jobs
        .map((job) => ({ job, kind: manualKind(job) }))
        .filter(
          (item): item is {
            job: DetailPageReviewJob;
            kind: Exclude<V260807ManualDecisionKind, null>;
          } => Boolean(item.kind),
        ),
    [jobs],
  );

  async function decide(
    job: DetailPageReviewJob,
    action: ManualAction,
    extra: Record<string, unknown> = {},
  ) {
    if (busyJobId) return;
    const confirmation = confirmationText(job, action, extra);
    if (confirmation && !window.confirm(confirmation)) return;

    setBusyJobId(job.jobId);
    setNotice({
      tone: "progress",
      message: progressMessage(action),
    });
    try {
      const response = await fetch(
        `${JOBS_API}/${encodeURIComponent(job.jobId)}/manual-review`,
        {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action, ...extra }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        job?: DetailPageReviewJob;
        message?: string;
      };
      if (!response.ok || body.ok !== true || !body.job) {
        throw new Error(body.message || "사용자 판단을 저장하지 못했습니다.");
      }

      const startResponse = await fetch(
        `${JOBS_API}/${encodeURIComponent(job.jobId)}/start`,
        {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        },
      );
      const startBody = (await startResponse.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!startResponse.ok || startBody.ok !== true) {
        throw new Error(
          startBody.message ||
            "판단은 저장됐지만 v260807 서버 작업을 시작하지 못했습니다.",
        );
      }
      setNotice({ tone: "success", message: successMessage(action) });
      await refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "사용자 판단을 실행하지 못했습니다.",
      });
      await refresh();
    } finally {
      setBusyJobId("");
    }
  }

  if (!pending.length) return null;

  return (
    <section className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-black tracking-[0.14em] text-amber-700">
            Commerce OS Detail Page Studio · v260807
          </p>
          <h2 className="mt-1 text-lg font-black text-amber-950">
            사용자 판단 대기 {pending.length}건
          </h2>
          <p className="mt-1 text-xs font-bold leading-5 text-amber-800">
            자동화가 확정하지 못한 예외만 보여줍니다. 정상 생성 자산은 보존하고, 선택한 작업에만 판단 기록을 남깁니다.
          </p>
        </div>
        <span className="rounded-full border border-amber-300 bg-white px-3 py-1.5 text-xs font-black text-amber-800">
          전체 재생성은 마지막 수단
        </span>
      </div>

      {notice ? (
        <p
          role="status"
          className={`mt-3 rounded-lg px-3 py-2 text-sm font-bold ${
            notice.tone === "error"
              ? "bg-rose-100 text-rose-800"
              : notice.tone === "success"
                ? "bg-emerald-100 text-emerald-800"
                : "bg-blue-100 text-blue-800"
          }`}
        >
          {notice.message}
        </p>
      ) : null}

      <div className="mt-4 grid gap-4">
        {pending.map(({ job, kind }) =>
          kind === "resume_checkpoint" ? (
            <ResumeCheckpointCard
              key={job.jobId}
              job={job}
              busy={busyJobId === job.jobId}
              onResume={() => void decide(job, "resume_checkpoint")}
            />
          ) : (
            <IdentityConflictCard
              key={job.jobId}
              job={job}
              busy={busyJobId === job.jobId}
              selectedAnchor={
                anchorSelections[job.jobId] ??
                v260807IdentitySnapshot(job)?.anchorIndex ??
                0
              }
              onAnchorChange={(value) =>
                setAnchorSelections((current) => ({
                  ...current,
                  [job.jobId]: value,
                }))
              }
              onApprove={() => void decide(job, "approve_identity")}
              onRegenerate={() => void decide(job, "regenerate_identity_asset")}
              onChangeAnchor={(anchorIndex) =>
                void decide(job, "change_identity_anchor", { anchorIndex })
              }
            />
          ),
        )}
      </div>
    </section>
  );
}

function ResumeCheckpointCard({
  job,
  busy,
  onResume,
}: {
  job: DetailPageReviewJob;
  busy: boolean;
  onResume: () => void;
}) {
  return (
    <article className="rounded-xl border border-blue-200 bg-white p-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-black text-blue-800">
              자동 복구 한도 소진
            </span>
            <span className="text-xs font-bold text-slate-400">{job.itemId}</span>
          </div>
          <h3 className="mt-2 text-base font-black text-slate-950">
            {productName(job)}
          </h3>
          <p className="mt-1 text-sm font-semibold leading-6 text-slate-700">
            생성 자산을 버릴 문제가 아니라 자동 재개 횟수만 소진된 상태입니다. 저장된 마지막 체크포인트와 성공 자산을 그대로 사용합니다.
          </p>
        </div>
        <button
          type="button"
          disabled={busy || !canResumeV260807Checkpoint(job)}
          onClick={onResume}
          className="shrink-0 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-black text-white hover:bg-blue-800 disabled:cursor-wait disabled:opacity-40"
        >
          {busy ? "계속 실행 요청 중…" : "저장 지점에서 계속"}
        </button>
      </div>
    </article>
  );
}

function IdentityConflictCard({
  job,
  busy,
  selectedAnchor,
  onAnchorChange,
  onApprove,
  onRegenerate,
  onChangeAnchor,
}: {
  job: DetailPageReviewJob;
  busy: boolean;
  selectedAnchor: number;
  onAnchorChange: (value: number) => void;
  onApprove: () => void;
  onRegenerate: () => void;
  onChangeAnchor: (anchorIndex: number) => void;
}) {
  const snapshot = v260807IdentitySnapshot(job);
  if (!snapshot) return null;
  const canApprove = canApproveV260807Identity(job);

  return (
    <article className="rounded-xl border border-rose-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-black text-rose-800">
          상품 정체성 충돌
        </span>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-600">
          {roleLabel(snapshot.failedRoleId)}
        </span>
        <span className="text-xs font-bold text-slate-400">{job.itemId}</span>
      </div>
      <h3 className="mt-2 text-base font-black text-slate-950">
        {productName(job)}
      </h3>
      <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">
        {snapshot.reason || job.error || "AI가 기준 원본과 생성 이미지의 상품 정체성을 확정하지 못했습니다."}
      </p>
      <p className="mt-1 text-xs font-bold text-slate-500">
        아래 승인은 이 작업 1건에만 적용되며 전역 Identity Gate를 약화시키지 않습니다.
      </p>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <CompareImage
          label={`현재 기준 원본 · ${snapshot.anchorIndex + 1}번`}
          url={snapshot.anchorUrl}
        />
        <CompareImage
          label={`문제 생성 이미지 · ${roleLabel(snapshot.failedRoleId)}`}
          url={snapshot.failedAssetUrl}
        />
      </div>

      <div className="mt-4 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0 flex-1">
          <label className="text-xs font-black text-slate-600" htmlFor={`anchor-${job.jobId}`}>
            기준 원본 변경
          </label>
          <div className="mt-1 flex gap-2">
            <select
              id={`anchor-${job.jobId}`}
              value={selectedAnchor}
              disabled={busy}
              onChange={(event) => onAnchorChange(Number(event.target.value))}
              className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700"
            >
              {snapshot.evidenceUrls.map((_, index) => (
                <option key={index} value={index}>
                  원본 {index + 1} · {snapshot.evidenceNames[index] || `evidence-${index + 1}`}
                  {index === snapshot.anchorIndex ? " · 현재 기준" : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || selectedAnchor === snapshot.anchorIndex}
              onClick={() => onChangeAnchor(selectedAnchor)}
              className="shrink-0 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              기준 원본 변경
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onRegenerate}
            className="rounded-lg border border-rose-300 bg-white px-4 py-2.5 text-sm font-black text-rose-700 hover:bg-rose-50 disabled:opacity-40"
          >
            문제 이미지만 재생성
          </button>
          <button
            type="button"
            disabled={busy || !canApprove}
            onClick={onApprove}
            className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-800 disabled:opacity-40"
          >
            현재 이미지 승인하고 계속
          </button>
        </div>
      </div>
    </article>
  );
}

function CompareImage({ label, url }: { label: string; url: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
      <div className="border-b border-slate-200 px-3 py-2 text-xs font-black text-slate-600">
        {label}
      </div>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="block">
          <div
            role="img"
            aria-label={label}
            className="h-64 bg-white bg-contain bg-center bg-no-repeat"
            style={{ backgroundImage: `url(${JSON.stringify(url).slice(1, -1)})` }}
          />
        </a>
      ) : (
        <div className="flex h-64 items-center justify-center p-4 text-center text-sm font-bold text-slate-400">
          저장 이미지 미확인
        </div>
      )}
    </div>
  );
}

function manualKind(job: DetailPageReviewJob) {
  return v260807ManualDecisionKind(job);
}

function productName(job: DetailPageReviewJob) {
  const payload = record(job.payload);
  return String(
    payload.product_name_hint || payload.product_name || job.itemId || "상품",
  ).trim();
}

function roleLabel(roleId: string) {
  const labels: Record<string, string> = {
    main_catalog: "대표 이미지",
    alternate_whole: "부가 이미지 1",
    evidence_detail: "부가 이미지 2",
    lifestyle_usage: "부가 이미지 3",
    adaptive_support: "부가 이미지 4",
  };
  return labels[roleId] || roleId;
}

function confirmationText(
  job: DetailPageReviewJob,
  action: ManualAction,
  extra: Record<string, unknown>,
) {
  const name = productName(job);
  if (action === "approve_identity") {
    return `"${name}"의 현재 대표·부가 이미지를 판매상품으로 승인하고 남은 상세 생성·최종 조립을 계속합니다.\n이 승인 기록은 현재 작업 1건에만 적용되며 전역 검수 기준은 바뀌지 않습니다. 계속할까요?`;
  }
  if (action === "regenerate_identity_asset") {
    return `"${name}"에서 AI가 정체성 충돌로 지목한 이미지 1장만 다시 생성합니다.\n다른 정상 자산과 1688 원본은 유지되며 AI 이미지 비용이 1장분 발생할 수 있습니다. 계속할까요?`;
  }
  if (action === "change_identity_anchor") {
    return `"${name}"의 상품 정체성 기준 원본을 ${Number(extra.anchorIndex) + 1}번으로 변경하고 기존 생성 자산부터 다시 검수합니다.\n필요할 때만 문제 이미지 1장이 자동 보정될 수 있습니다. 계속할까요?`;
  }
  return `"${name}"의 이미 생성된 정상 자산을 유지하고 저장된 마지막 체크포인트에서 계속 실행합니다.\n1688 재수집이나 전체 재생성은 하지 않습니다. 계속할까요?`;
}

function progressMessage(action: ManualAction) {
  if (action === "approve_identity") return "현재 이미지 승인 기록을 저장하고 v260807 작업을 이어서 시작합니다.";
  if (action === "regenerate_identity_asset") return "문제 이미지 1장만 재생성하도록 체크포인트를 준비합니다.";
  if (action === "change_identity_anchor") return "새 기준 원본을 저장하고 기존 자산 재검수를 준비합니다.";
  return "저장된 마지막 체크포인트를 복구하고 있습니다.";
}

function successMessage(action: ManualAction) {
  if (action === "approve_identity") return "현재 이미지 승인을 기록하고 남은 상세 생성·최종 조립을 시작했습니다.";
  if (action === "regenerate_identity_asset") return "다른 정상 자산은 유지하고 문제 이미지 1장만 다시 생성하기 시작했습니다.";
  if (action === "change_identity_anchor") return "기준 원본을 변경하고 기존 생성 자산부터 다시 검수하기 시작했습니다.";
  return "1688 재수집 없이 저장된 마지막 단계에서 작업을 계속 시작했습니다.";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
