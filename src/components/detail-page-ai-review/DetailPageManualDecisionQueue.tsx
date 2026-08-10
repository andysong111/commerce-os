"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DetailPageReviewJob } from "@/lib/detailPageAiReview";
import {
  canApproveV260807Identity,
  canResumeV260807Checkpoint,
  canRetryV260807GenerationSafety,
  v260807IdentitySnapshot,
  v260807ManualDecisionKind,
  v260807SourceAnchorSnapshot,
  type V260807ManualDecisionKind,
  type V260807SourceAnchorSnapshot,
} from "@/lib/detailPageManualDecision";

const JOBS_API = "/api/product-launch-tracker/detail-page-jobs";
const POLL_MS = 2_500;

type Notice =
  | { tone: "progress" | "success" | "error"; message: string }
  | null;

type ManualAction =
  | "resume_checkpoint"
  | "resume_checkpoint_with_anchor"
  | "retry_generation_with_anchor"
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
        {pending.map(({ job, kind }) => {
          const source = v260807SourceAnchorSnapshot(job);
          const selectedAnchor =
            anchorSelections[job.jobId] ?? source?.anchorIndex ?? 0;
          const onAnchorChange = (value: number) =>
            setAnchorSelections((current) => ({
              ...current,
              [job.jobId]: value,
            }));

          if (kind === "resume_checkpoint") {
            return (
              <ResumeCheckpointCard
                key={job.jobId}
                job={job}
                busy={busyJobId === job.jobId}
                source={source}
                selectedAnchor={selectedAnchor}
                onAnchorChange={onAnchorChange}
                onResume={() => void decide(job, "resume_checkpoint")}
                onResumeWithAnchor={(anchorIndex) =>
                  void decide(job, "resume_checkpoint_with_anchor", { anchorIndex })
                }
              />
            );
          }

          if (kind === "generation_safety_block") {
            return (
              <GenerationSafetyBlockCard
                key={job.jobId}
                job={job}
                busy={busyJobId === job.jobId}
                source={source}
                selectedAnchor={selectedAnchor}
                onAnchorChange={onAnchorChange}
                onRetry={(anchorIndex) =>
                  void decide(job, "retry_generation_with_anchor", { anchorIndex })
                }
              />
            );
          }

          return (
            <IdentityConflictCard
              key={job.jobId}
              job={job}
              busy={busyJobId === job.jobId}
              selectedAnchor={selectedAnchor}
              onAnchorChange={onAnchorChange}
              onApprove={() => void decide(job, "approve_identity")}
              onRegenerate={() => void decide(job, "regenerate_identity_asset")}
              onChangeAnchor={(anchorIndex) =>
                void decide(job, "change_identity_anchor", { anchorIndex })
              }
            />
          );
        })}
      </div>
    </section>
  );
}

function ResumeCheckpointCard({
  job,
  busy,
  source,
  selectedAnchor,
  onAnchorChange,
  onResume,
  onResumeWithAnchor,
}: {
  job: DetailPageReviewJob;
  busy: boolean;
  source: V260807SourceAnchorSnapshot | null;
  selectedAnchor: number;
  onAnchorChange: (value: number) => void;
  onResume: () => void;
  onResumeWithAnchor: (anchorIndex: number) => void;
}) {
  return (
    <article className="rounded-xl border border-blue-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-black text-blue-800">
          저장 지점 안전 재개
        </span>
        <span className="text-xs font-bold text-slate-400">{job.itemId}</span>
      </div>
      <h3 className="mt-2 text-base font-black text-slate-950">
        {productName(job)}
      </h3>
      <p className="mt-1 text-sm font-semibold leading-6 text-slate-700">
        저장된 정상 자산은 그대로 보존합니다. 바로 계속할 수도 있고, 현재 기준 원본이 부적절해 보이면 아래에서 1688 원본을 다시 선택한 뒤 같은 체크포인트에서 이어갈 수 있습니다.
      </p>

      {source ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-[360px_1fr]">
          <CompareImage
            label={`선택 기준 원본 · ${selectedAnchor + 1}번`}
            url={source.evidenceUrls[selectedAnchor] || source.anchorUrl}
          />
          <div className="flex flex-col justify-end gap-3">
            <SourceAnchorSelect
              jobId={job.jobId}
              source={source}
              selectedAnchor={selectedAnchor}
              busy={busy}
              onAnchorChange={onAnchorChange}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || !canResumeV260807Checkpoint(job)}
                onClick={onResume}
                className="rounded-lg border border-blue-300 bg-white px-4 py-2.5 text-sm font-black text-blue-800 hover:bg-blue-50 disabled:opacity-40"
              >
                저장 지점에서 바로 계속
              </button>
              <button
                type="button"
                disabled={busy || !canResumeV260807Checkpoint(job)}
                onClick={() => onResumeWithAnchor(selectedAnchor)}
                className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-black text-white hover:bg-blue-800 disabled:opacity-40"
              >
                {busy ? "계속 실행 요청 중…" : "선택 기준 원본으로 계속"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy || !canResumeV260807Checkpoint(job)}
          onClick={onResume}
          className="mt-4 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-black text-white hover:bg-blue-800 disabled:cursor-wait disabled:opacity-40"
        >
          {busy ? "계속 실행 요청 중…" : "저장 지점에서 계속"}
        </button>
      )}
    </article>
  );
}

function GenerationSafetyBlockCard({
  job,
  busy,
  source,
  selectedAnchor,
  onAnchorChange,
  onRetry,
}: {
  job: DetailPageReviewJob;
  busy: boolean;
  source: V260807SourceAnchorSnapshot | null;
  selectedAnchor: number;
  onAnchorChange: (value: number) => void;
  onRetry: (anchorIndex: number) => void;
}) {
  return (
    <article className="rounded-xl border border-orange-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-black text-orange-800">
          생성 안전검사 차단
        </span>
        <span className="text-xs font-bold text-slate-400">{job.itemId}</span>
      </div>
      <h3 className="mt-2 text-base font-black text-slate-950">
        {productName(job)}
      </h3>
      <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">
        {job.error || "AI 이미지가 생성 안전검사에서 차단되었습니다."}
      </p>
      <p className="mt-1 text-xs font-bold leading-5 text-slate-500">
        차단된 이미지는 저장되기 전 단계라 문제 이미지 미리보기는 없습니다. 이미 성공해 저장된 자산은 유지하고, 아래에서 상품 본체가 가장 명확한 1688 기준 원본을 선택해 미저장 실패 이미지만 다시 생성합니다.
      </p>

      {source ? (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <CompareImage
              label={`재생성 기준 원본 · ${selectedAnchor + 1}번`}
              url={source.evidenceUrls[selectedAnchor] || source.anchorUrl}
            />
            <MissingGeneratedImageCard />
          </div>
          <div className="mt-4 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <SourceAnchorSelect
              jobId={job.jobId}
              source={source}
              selectedAnchor={selectedAnchor}
              busy={busy}
              onAnchorChange={onAnchorChange}
            />
            <button
              type="button"
              disabled={busy || !canRetryV260807GenerationSafety(job)}
              onClick={() => onRetry(selectedAnchor)}
              className="shrink-0 rounded-lg bg-orange-700 px-4 py-2.5 text-sm font-black text-white hover:bg-orange-800 disabled:opacity-40"
            >
              {busy ? "재생성 요청 중…" : "선택 기준으로 실패 이미지만 재생성"}
            </button>
          </div>
        </>
      ) : (
        <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">
          저장된 1688 기준 원본 목록을 확인하지 못해 부분 재생성을 시작할 수 없습니다.
        </p>
      )}
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
          <SourceAnchorSelect
            jobId={job.jobId}
            source={snapshot}
            selectedAnchor={selectedAnchor}
            busy={busy}
            onAnchorChange={onAnchorChange}
          />
          <button
            type="button"
            disabled={busy || selectedAnchor === snapshot.anchorIndex}
            onClick={() => onChangeAnchor(selectedAnchor)}
            className="mt-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            기준 원본 변경
          </button>
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

function SourceAnchorSelect({
  jobId,
  source,
  selectedAnchor,
  busy,
  onAnchorChange,
}: {
  jobId: string;
  source: V260807SourceAnchorSnapshot;
  selectedAnchor: number;
  busy: boolean;
  onAnchorChange: (value: number) => void;
}) {
  return (
    <div className="min-w-0 flex-1">
      <label className="text-xs font-black text-slate-600" htmlFor={`anchor-${jobId}`}>
        1688 상품 본체 기준 원본
      </label>
      <select
        id={`anchor-${jobId}`}
        value={selectedAnchor}
        disabled={busy}
        onChange={(event) => onAnchorChange(Number(event.target.value))}
        className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700"
      >
        {source.evidenceUrls.map((_, index) => (
          <option key={index} value={index}>
            원본 {index + 1} · {source.evidenceNames[index] || `evidence-${index + 1}`}
            {index === source.anchorIndex ? " · 현재 기준" : ""}
          </option>
        ))}
      </select>
    </div>
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

function MissingGeneratedImageCard() {
  return (
    <div className="overflow-hidden rounded-xl border border-orange-200 bg-orange-50">
      <div className="border-b border-orange-200 bg-white px-3 py-2 text-xs font-black text-slate-600">
        문제 생성 이미지
      </div>
      <div className="flex h-64 flex-col items-center justify-center px-6 text-center">
        <p className="text-base font-black text-orange-900">생성 이미지 없음</p>
        <p className="mt-2 text-sm font-bold leading-6 text-orange-800">
          안전검사 단계에서 차단되어 이미지가 서버에 반환·저장되지 않았습니다.
        </p>
        <p className="mt-2 text-xs font-bold leading-5 text-slate-500">
          왼쪽에서 정확한 1688 원본을 선택하면 이미 저장된 정상 자산은 유지하고 실패한 이미지만 다시 생성합니다.
        </p>
      </div>
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
  if (action === "retry_generation_with_anchor") {
    return `"${name}"의 기준 원본을 ${Number(extra.anchorIndex) + 1}번으로 사용해 안전검사에서 차단된 미저장 이미지만 다시 생성합니다.\n이미 저장된 정상 자산은 유지되며 실패 이미지 생성 비용만 다시 발생할 수 있습니다. 계속할까요?`;
  }
  if (action === "resume_checkpoint_with_anchor") {
    return `"${name}"의 기준 원본을 ${Number(extra.anchorIndex) + 1}번으로 선택하고 저장된 정상 자산을 유지한 채 마지막 체크포인트에서 계속합니다.\n1688 재수집이나 전체 재생성은 하지 않습니다. 계속할까요?`;
  }
  return `"${name}"의 이미 생성된 정상 자산을 유지하고 저장된 마지막 체크포인트에서 계속 실행합니다.\n1688 재수집이나 전체 재생성은 하지 않습니다. 계속할까요?`;
}

function progressMessage(action: ManualAction) {
  if (action === "approve_identity") return "현재 이미지 승인 기록을 저장하고 v260807 작업을 이어서 시작합니다.";
  if (action === "regenerate_identity_asset") return "문제 이미지 1장만 재생성하도록 체크포인트를 준비합니다.";
  if (action === "change_identity_anchor") return "새 기준 원본을 저장하고 기존 자산 재검수를 준비합니다.";
  if (action === "retry_generation_with_anchor") return "선택한 기준 원본을 저장하고 안전검사에서 차단된 미저장 이미지만 재생성하도록 준비합니다.";
  if (action === "resume_checkpoint_with_anchor") return "선택한 기준 원본을 저장하고 마지막 체크포인트 복구를 준비합니다.";
  return "저장된 마지막 체크포인트를 복구하고 있습니다.";
}

function successMessage(action: ManualAction) {
  if (action === "approve_identity") return "현재 이미지 승인을 기록하고 남은 상세 생성·최종 조립을 시작했습니다.";
  if (action === "regenerate_identity_asset") return "다른 정상 자산은 유지하고 문제 이미지 1장만 다시 생성하기 시작했습니다.";
  if (action === "change_identity_anchor") return "기준 원본을 변경하고 기존 생성 자산부터 다시 검수하기 시작했습니다.";
  if (action === "retry_generation_with_anchor") return "선택한 기준 원본으로 미저장 실패 이미지만 다시 생성하기 시작했습니다.";
  if (action === "resume_checkpoint_with_anchor") return "선택한 기준 원본을 적용하고 저장된 마지막 단계에서 작업을 계속 시작했습니다.";
  return "1688 재수집 없이 저장된 마지막 단계에서 작업을 계속 시작했습니다.";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
