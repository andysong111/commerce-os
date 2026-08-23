import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import {
  loadReliabilityDashboard,
  type ReliabilityImprovementRow,
} from "@/lib/reliability/reliabilityDashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const labels: Record<string, string> = {
  open: "열림",
  monitoring: "관찰 중",
  resolved: "해결",
  ignored: "제외",
  candidate: "학습 후보",
  approved: "승인",
  applied: "실제 반영",
  rejected: "제외",
  proposed: "테스트 제안",
  implemented: "구현",
  passing: "통과",
  failing: "실패",
  pending: "분석 대기",
  queued: "자동복구 대기",
  approval_required: "승인 필요",
  running: "실행 중",
  succeeded: "완료",
  failed: "실패",
  dead_letter: "반복 실패 격리",
  started: "시작",
  progress: "진행",
  blocked: "차단",
  retrying: "재시도",
  quality_rejected: "품질 탈락",
  recovered: "자동복구",
  canceled: "취소",
  info: "정보",
  warning: "주의",
  error: "오류",
  critical: "긴급",
  low: "낮음",
  medium: "중간",
  high: "높음",
  analysis_pending: "원인 분석 중",
  implementation_needed: "구현 필요",
  policy_active: "복구 규칙 반영",
  measuring: "효과 측정 중",
  verified: "개선 확인",
  neutral: "변화 미확인",
  regressed: "악화 감지",
  rolled_back: "롤백",
  retry_policy: "재시도·복구",
  validation_rule: "입력 검증",
  quality_gate: "품질 차단",
  quarantine_rule: "격리 규칙",
  configuration: "설정 개선",
  code_change: "코드 수정",
  regression_test: "회귀 테스트",
  manual_review: "사람 검토",
  existing_policy: "기존 복구정책",
  automatic_policy: "자동 정책",
  github_change: "GitHub 변경",
  manual_change: "수동 변경",
  not_started: "측정 전",
  insufficient_data: "표본 수집 중",
  improved: "개선 확인",
  unchanged: "유의미한 변화 없음",
};

function tone(value: string) {
  if (["critical", "error", "failed", "failing", "dead_letter", "regressed"].includes(value)) {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }
  if (
    [
      "warning",
      "high",
      "medium",
      "open",
      "candidate",
      "proposed",
      "pending",
      "approval_required",
      "blocked",
      "retrying",
      "quality_rejected",
      "implementation_needed",
      "analysis_pending",
      "insufficient_data",
    ].includes(value)
  ) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (
    [
      "resolved",
      "applied",
      "passing",
      "succeeded",
      "recovered",
      "verified",
      "improved",
      "policy_active",
    ].includes(value)
  ) {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (["measuring", "github_change", "existing_policy"].includes(value)) {
    return "border-blue-200 bg-blue-50 text-blue-800";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function badge(value: string) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${tone(value)}`}
    >
      {labels[value] || value}
    </span>
  );
}

function ago(value: string | null, now = Date.now()) {
  if (!value) return "시각 없음";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "시각 오류";
  const minutes = Math.max(0, Math.floor((now - parsed) / 60_000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

function short(value: string | null | undefined, max = 72) {
  if (!value) return "-";
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function asNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rate(value: unknown) {
  if (value == null) return "-";
  return `${(asNumber(value) * 100).toFixed(1)}%`;
}

function confidence(value: unknown) {
  return `${Math.round(asNumber(value) * 100)}%`;
}

function applicationCopy(item: ReliabilityImprovementRow) {
  if (item.application_mode === "existing_policy") {
    return `기존 저위험 복구 규칙 “${item.policy_action || item.safe_action}”이 향후 동일 오류 처리에 연결되어 있습니다.`;
  }
  if (item.application_mode === "github_change") {
    return `GitHub 검증 변경이 반영되었습니다${item.applied_reference ? ` · ${item.applied_reference}` : ""}.`;
  }
  if (item.status === "approval_required") {
    return "고위험 또는 판단이 필요한 변경이라 승인 전에는 실제 시스템에 반영되지 않습니다.";
  }
  if (item.status === "analysis_pending") {
    return "아직 원인·해결·예방 규칙을 분석 중이므로 실제 변경은 시작하지 않았습니다.";
  }
  return "개선안은 만들어졌지만 실제 엔진 코드·검증 규칙에는 아직 반영되지 않았습니다.";
}

function measurementCopy(item: ReliabilityImprovementRow) {
  if (!item.applied_at) {
    return "실제 반영 시점이 확인된 뒤에만 전후 효과 측정을 시작합니다.";
  }
  if (item.measurement_result === "insufficient_data") {
    return `공정한 비교를 위해 실행 표본을 모으는 중입니다. 적용 전 ${item.baseline_events.toLocaleString("ko-KR")}건, 적용 후 ${item.current_events.toLocaleString("ko-KR")}건이 집계됐습니다.`;
  }
  if (item.measurement_result === "improved") {
    return `동일 오류 실행 비율이 ${rate(item.baseline_failure_rate)}에서 ${rate(item.current_failure_rate)}로 낮아졌습니다.`;
  }
  if (item.measurement_result === "regressed") {
    return `동일 오류 실행 비율이 ${rate(item.baseline_failure_rate)}에서 ${rate(item.current_failure_rate)}로 높아져 재검토가 필요합니다.`;
  }
  if (item.measurement_result === "unchanged") {
    return `적용 전 ${rate(item.baseline_failure_rate)}, 적용 후 ${rate(item.current_failure_rate)}로 아직 유의미한 차이가 확인되지 않았습니다.`;
  }
  return "효과 측정이 아직 시작되지 않았습니다.";
}

function improvementPriority(item: ReliabilityImprovementRow) {
  const order: Record<string, number> = {
    regressed: 0,
    verified: 1,
    measuring: 2,
    applied: 3,
    policy_active: 4,
    approval_required: 5,
    implementation_needed: 6,
    analysis_pending: 7,
    neutral: 8,
  };
  return order[item.status] ?? 20;
}

export default async function ReliabilityPage() {
  const data = await loadReliabilityDashboard();
  const aiSaurusConnected = data.summary.aiSaurusEvents > 0;
  const improvements = [...data.improvements].sort(
    (left, right) =>
      improvementPriority(left) - improvementPriority(right) ||
      Date.parse(right.updated_at) - Date.parse(left.updated_at),
  );
  const improvementById = new Map(improvements.map((item) => [item.id, item]));
  const judged =
    data.summary.improvementsVerified + data.summary.improvementsRegressed;

  const stages = [
    {
      step: "1",
      title: "자동 수집",
      value: data.summary.totalEvents,
      note: "OPS·AI-Saurus 실행 결과",
      status: data.summary.totalEvents > 0 ? "succeeded" : "pending",
    },
    {
      step: "2",
      title: "원인 분석",
      value: data.summary.analyzedLearningCases,
      note: "반복 사건을 AI가 구조화",
      status: data.summary.analyzedLearningCases > 0 ? "succeeded" : "pending",
    },
    {
      step: "3",
      title: "개선안 생성",
      value: data.summary.improvementsTotal,
      note: "무엇을 바꿀지 명확화",
      status: data.summary.improvementsTotal > 0 ? "succeeded" : "pending",
    },
    {
      step: "4",
      title: "실제 반영",
      value: data.summary.improvementsApplied,
      note: "정책 또는 검증된 코드만 집계",
      status: data.summary.improvementsApplied > 0 ? "policy_active" : "pending",
    },
    {
      step: "5",
      title: "효과 검증",
      value: judged,
      note: "적용 전후 오류율 비교",
      status: judged > 0 ? "verified" : "measuring",
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · RELIABILITY & LEARNING"
        title="통합 신뢰성·자기개선 코어"
        description="무엇을 수집했고, 무엇을 배웠고, 실제로 무엇을 바꿨으며, 결과가 좋아졌는지를 한 흐름으로 확인합니다."
      />

      <section
        className={`rounded-2xl border p-5 ${
          aiSaurusConnected
            ? "border-emerald-200 bg-emerald-50"
            : "border-amber-200 bg-amber-50"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              {badge(aiSaurusConnected ? "succeeded" : "approval_required")}
              <strong className="text-base text-slate-950">자동 학습 데이터 연결</strong>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              {aiSaurusConnected
                ? `AI-Saurus ${data.summary.aiSaurusEvents.toLocaleString("ko-KR")}건을 포함해 총 ${data.summary.totalEvents.toLocaleString("ko-KR")}건의 실행 신호를 자동 수집했습니다.`
                : "AI-Saurus 첫 운영 이벤트를 기다리고 있습니다."}
            </p>
          </div>
          <Link
            href="/operations"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50"
          >
            기존 운영 안전센터
          </Link>
        </div>
      </section>

      {data.error ? (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900">
          <strong className="block text-base">자기개선 데이터를 불러오지 못했습니다.</strong>
          <p className="mt-2 break-words">{data.error}</p>
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
              자기개선 진행 흐름
            </p>
            <h2 className="mt-1 text-xl font-black text-slate-950">
              데이터가 실제 개선으로 이어지는 단계
            </h2>
          </div>
          <p className="max-w-xl text-xs leading-5 text-slate-500">
            학습 완료와 실제 반영은 다릅니다. 정책 또는 커밋이 확인된 변경만 “실제 반영”으로 계산합니다.
          </p>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-5">
          {stages.map((stage) => (
            <article
              key={stage.step}
              className="rounded-xl border border-slate-200 bg-slate-50 p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="grid size-7 place-items-center rounded-full bg-slate-950 text-xs font-black text-white">
                  {stage.step}
                </span>
                {badge(stage.status)}
              </div>
              <strong className="mt-4 block text-base text-slate-950">
                {stage.title}
              </strong>
              <p className="mt-1 text-2xl font-black text-slate-950">
                {stage.value.toLocaleString("ko-KR")}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{stage.note}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        {[
          ["복구 규칙 반영", data.summary.policyActive, "향후 동일 오류 처리에 연결", "policy_active"],
          ["효과 측정 중", data.summary.improvementsMeasuring, "전후 표본 수집", "measuring"],
          ["개선 확인", data.summary.improvementsVerified, "오류 비율 20% 이상 감소", "verified"],
          ["구현 필요", data.summary.implementationNeeded, "코드·검증·프롬프트 변경", "implementation_needed"],
          ["승인 필요", data.summary.improvementApprovalRequired, "고위험 자동반영 금지", "approval_required"],
          ["악화 감지", data.summary.improvementsRegressed, "롤백·재검토 대상", "regressed"],
        ].map(([label, value, note, status]) => (
          <article
            key={String(label)}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-600">{label}</p>
              {badge(String(status))}
            </div>
            <strong className="mt-3 block text-3xl font-black text-slate-950">
              {Number(value).toLocaleString("ko-KR")}
            </strong>
            <p className="mt-2 text-xs leading-5 text-slate-500">{note}</p>
          </article>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-slate-950">실제로 무엇이 바뀌고 있나</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              문제 → 학습 내용 → 반영 방식 → 효과 측정 순서로 보여줍니다.
            </p>
          </div>
          <span className="text-xs font-semibold text-slate-500">
            총 {data.summary.improvementsTotal.toLocaleString("ko-KR")}개 개선 항목
          </span>
        </div>

        <div className="mt-5 space-y-4">
          {improvements.length ? (
            improvements.slice(0, 24).map((item) => (
              <article
                key={item.id}
                className="overflow-hidden rounded-2xl border border-slate-200"
              >
                <div className="border-b border-slate-100 bg-slate-50 px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {badge(item.status)}
                        {badge(item.improvement_kind)}
                        {badge(item.risk_level)}
                      </div>
                      <h3 className="mt-2 break-words text-base font-black text-slate-950">
                        {item.title}
                      </h3>
                      <p className="mt-1 text-xs text-slate-500">
                        {item.source_system} · 신뢰도 {confidence(item.confidence)} · {ago(item.updated_at)}
                      </p>
                    </div>
                    {item.applied_at ? (
                      <div className="text-right text-xs leading-5 text-slate-500">
                        <p className="font-bold text-slate-700">반영 시점</p>
                        <p>{ago(item.applied_at)}</p>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="grid gap-4 p-5 lg:grid-cols-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wide text-slate-400">
                      1. 무엇을 배웠나
                    </p>
                    <p className="mt-2 text-sm font-bold leading-6 text-slate-900">
                      {short(item.fact_summary, 320)}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-slate-600">
                      <strong>원인:</strong> {short(item.root_cause, 360)}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs font-black uppercase tracking-wide text-slate-400">
                      2. 어떻게 반영하나
                    </p>
                    <p className="mt-2 text-sm leading-6 text-slate-800">
                      {applicationCopy(item)}
                    </p>
                    <p className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-900">
                      <strong>변경안:</strong> {short(item.change_summary, 360)}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs font-black uppercase tracking-wide text-slate-400">
                      3. 정말 좋아졌나
                    </p>
                    <p className="mt-2 text-sm leading-6 text-slate-800">
                      {measurementCopy(item)}
                    </p>
                    {item.applied_at ? (
                      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-lg bg-slate-50 p-2">
                          <p className="text-[10px] font-bold text-slate-400">적용 전 오류율</p>
                          <p className="mt-1 text-sm font-black text-slate-900">
                            {rate(item.baseline_failure_rate)}
                          </p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-2">
                          <p className="text-[10px] font-bold text-slate-400">적용 후 오류율</p>
                          <p className="mt-1 text-sm font-black text-slate-900">
                            {rate(item.current_failure_rate)}
                          </p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-2">
                          <p className="text-[10px] font-bold text-slate-400">자동복구율</p>
                          <p className="mt-1 text-sm font-black text-slate-900">
                            {rate(item.current_recovery_rate)}
                          </p>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
                  <p>
                    <strong className="text-slate-700">기대 효과:</strong>{" "}
                    {short(item.expected_effect, 260)}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {item.application_mode !== "none" ? badge(item.application_mode) : null}
                    {badge(item.measurement_result)}
                  </div>
                </div>
              </article>
            ))
          ) : (
            <p className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
              분석이 완료되면 개선 항목이 자동으로 생성됩니다.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">최근 개선 진행 기록</h2>
        <p className="mt-1 text-sm text-slate-500">
          “분석만 됨”과 “실제로 반영됨”을 섞지 않고 상태 변화를 그대로 기록합니다.
        </p>
        <div className="mt-4 space-y-3">
          {data.improvementActivity.length ? (
            data.improvementActivity.slice(0, 20).map((activity) => {
              const improvement = improvementById.get(activity.improvement_id);
              return (
                <div
                  key={activity.id}
                  className="flex gap-3 rounded-xl border border-slate-200 p-4"
                >
                  <span className="mt-1 size-2 shrink-0 rounded-full bg-blue-600" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {activity.to_status ? badge(activity.to_status) : null}
                      <strong className="text-sm text-slate-950">
                        {improvement?.title || "자기개선 항목"}
                      </strong>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      {activity.summary}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {ago(activity.occurred_at)}
                    </p>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
              아직 개선 상태 변경 기록이 없습니다.
            </p>
          )}
        </div>
      </section>

      <details className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <summary className="cursor-pointer px-5 py-4 font-black text-slate-950">
          기술 상세 보기 · 사건·학습·테스트·복구 큐
        </summary>
        <div className="space-y-6 border-t border-slate-100 p-5">
          <section>
            <h2 className="text-lg font-black text-slate-950">반복 사건</h2>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {data.incidents.slice(0, 20).map((incident) => (
                <article key={incident.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {badge(incident.status)}
                    {badge(incident.severity)}
                    {badge(incident.risk_level)}
                  </div>
                  <p className="mt-2 break-all text-sm font-bold text-slate-900">
                    {incident.engine} · {incident.error_code || incident.title}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {incident.occurrence_count.toLocaleString("ko-KR")}회 · 복구 성공 {incident.automatic_recovery_successes.toLocaleString("ko-KR")}회
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section className="grid gap-5 xl:grid-cols-2">
            <article>
              <h2 className="text-lg font-black text-slate-950">학습 자산</h2>
              <div className="mt-3 space-y-3">
                {data.learningCases.slice(0, 12).map((item) => (
                  <div key={item.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {badge(item.state)}
                      <strong className="text-sm text-slate-950">{item.title}</strong>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-600">
                      {short(item.prevention_rule || item.symptom, 260)}
                    </p>
                  </div>
                ))}
              </div>
            </article>

            <article>
              <h2 className="text-lg font-black text-slate-950">회귀 테스트 제안</h2>
              <div className="mt-3 space-y-3">
                {data.regressionCases.slice(0, 12).map((item) => (
                  <div key={item.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {badge(item.status)}
                      <strong className="break-all text-xs text-slate-700">
                        {item.source_repo}
                      </strong>
                    </div>
                    <p className="mt-2 text-xs font-bold leading-5 text-slate-700">
                      {item.test_name}
                    </p>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="grid gap-5 xl:grid-cols-2">
            <article>
              <h2 className="text-lg font-black text-slate-950">AI 분석 큐</h2>
              <div className="mt-3 space-y-3">
                {data.analysisQueue.slice(0, 10).map((item) => (
                  <div key={item.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between gap-3">
                      {badge(item.status)}
                      <span className="text-xs text-slate-500">
                        {item.attempts}/{item.max_attempts}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      모델 {item.model || "배정 전"} · {ago(item.updated_at)}
                    </p>
                  </div>
                ))}
              </div>
            </article>

            <article>
              <h2 className="text-lg font-black text-slate-950">복구 작업 큐</h2>
              <div className="mt-3 space-y-3">
                {data.recoveryQueue.slice(0, 10).map((item) => (
                  <div key={item.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {badge(item.status)}
                      <strong className="text-sm text-slate-950">{item.engine}</strong>
                    </div>
                    <p className="mt-2 break-all font-mono text-xs text-slate-700">
                      {item.action}
                    </p>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section>
            <h2 className="text-lg font-black text-slate-950">최근 자동 수집 이벤트</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {data.recentEvents.slice(0, 16).map((event) => (
                <article key={event.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {badge(event.status)}
                    {badge(event.risk_level)}
                    <strong className="text-sm text-slate-950">{event.engine}</strong>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    {event.source_system} · {event.stage || event.event_type} · {ago(event.occurred_at)}
                  </p>
                </article>
              ))}
            </div>
          </section>
        </div>
      </details>
    </div>
  );
}
