import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import {
  loadReliabilityDashboard,
  type ReliabilityImprovementRow,
} from "@/lib/reliability/reliabilityDashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const labels: Record<string, string> = {
  open: "확인 중",
  monitoring: "지켜보는 중",
  resolved: "해결됨",
  ignored: "제외",
  candidate: "배우는 중",
  approved: "확인 완료",
  applied: "서비스 반영",
  rejected: "제외",
  proposed: "재발 방지 준비",
  implemented: "준비 완료",
  passing: "정상",
  failing: "문제 있음",
  pending: "기다리는 중",
  queued: "자동 처리 대기",
  approval_required: "사람 확인 필요",
  running: "처리 중",
  succeeded: "완료",
  failed: "실패",
  dead_letter: "반복 실패",
  started: "시작",
  progress: "진행 중",
  blocked: "멈춤",
  retrying: "다시 시도 중",
  quality_rejected: "품질 확인 필요",
  recovered: "자동 해결",
  canceled: "취소",
  info: "정보",
  warning: "주의",
  error: "오류",
  critical: "긴급",
  low: "낮은 위험",
  medium: "주의 필요",
  high: "높은 위험",
  analysis_pending: "원인 찾는 중",
  implementation_needed: "아직 적용 전",
  policy_active: "자동 대응 준비",
  measuring: "효과 확인 중",
  verified: "좋아짐 확인",
  neutral: "큰 변화 없음",
  regressed: "오히려 나빠짐",
  rolled_back: "되돌림",
  retry_policy: "다시 시도하는 방법",
  validation_rule: "입력 확인 방법",
  quality_gate: "품질 확인 방법",
  quarantine_rule: "문제 항목 분리",
  configuration: "설정 수정",
  code_change: "프로그램 수정",
  regression_test: "재발 방지 확인",
  manual_review: "사람 확인",
  existing_policy: "기존 자동 대응",
  automatic_policy: "자동 대응",
  github_change: "서비스 코드 반영",
  manual_change: "직접 수정",
  not_started: "아직 확인 전",
  insufficient_data: "데이터 모으는 중",
  improved: "좋아짐 확인",
  unchanged: "큰 변화 없음",
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

function plainEngine(engine: string) {
  if (engine === "detail-page-generation") return "AI-Saurus 상세페이지";
  if (engine === "product-launch-upload") return "상품 등록";
  if (engine.startsWith("PRODUCT_MASTER_SHOPLING")) return "샵플링 상품·판매 데이터";
  if (engine.startsWith("PRODUCT_DECISION")) return "발주 판단";
  if (engine.startsWith("STAGE8")) return "발주 검증";
  return "Commerce OS 작업";
}

function plainProblem(errorCode: string | null) {
  const map: Record<string, string> = {
    commerce_image_generation_error: "이미지 생성이 실패하는 문제",
    missing_identity_anchor: "상품 모습의 기준 이미지가 부족한 문제",
    mismatched_project: "서비스 연결 설정이 맞지 않는 문제",
    QUALITY_REVIEW_REQUIRED: "이미지 품질을 다시 확인해야 하는 문제",
    SERVER_FINALIZATION_FAILED: "마지막 저장 과정이 실패하는 문제",
    operation_failed: "외부 연결 작업이 실패하는 문제",
    product_launch_upload_failed: "상품 등록이 실패하는 문제",
    validation_error: "입력값을 다시 확인해야 하는 문제",
    source_sales_option_value_mismatch: "선택한 옵션과 원본 옵션이 맞지 않는 문제",
  };
  return errorCode ? map[errorCode] || "반복해서 발생한 문제" : "반복해서 발생한 문제";
}

function plainTitle(item: ReliabilityImprovementRow) {
  return `${plainEngine(item.engine)} · ${plainProblem(item.error_code)}`;
}

function applicationCopy(item: ReliabilityImprovementRow) {
  if (item.application_mode === "existing_policy") {
    return "같은 문제가 다시 생기면 시스템이 자동으로 대응하도록 준비되어 있습니다.";
  }
  if (item.application_mode === "github_change") {
    return "문제를 막기 위한 수정이 실제 서비스에 반영되었습니다.";
  }
  if (item.status === "approval_required") {
    return "중요한 변경이라 자동으로 바꾸지 않고 사람의 확인을 기다립니다.";
  }
  if (item.status === "analysis_pending") {
    return "아직 왜 문제가 생겼는지 찾는 중이라 실제 변경은 시작하지 않았습니다.";
  }
  return "어떻게 고칠지는 정리됐지만 아직 실제 서비스에는 적용하지 않았습니다.";
}

function measurementCopy(item: ReliabilityImprovementRow) {
  if (item.status === "policy_active" && !item.applied_at) {
    return "자동 대응은 준비되어 있습니다. 다만 이 방법은 이번 학습 전부터 있던 것이어서 이번 개선 효과로 계산하지 않습니다.";
  }
  if (!item.applied_at) {
    return "실제 서비스에 반영된 뒤부터 좋아졌는지 자동으로 비교합니다.";
  }
  if (item.measurement_result === "insufficient_data") {
    return `아직 판단하기 이릅니다. 적용 전 ${item.baseline_events.toLocaleString("ko-KR")}건, 적용 후 ${item.current_events.toLocaleString("ko-KR")}건의 사용 기록을 모았습니다.`;
  }
  if (item.measurement_result === "improved") {
    return `문제 발생 비율이 ${rate(item.baseline_failure_rate)}에서 ${rate(item.current_failure_rate)}로 낮아졌습니다.`;
  }
  if (item.measurement_result === "regressed") {
    return `문제 발생 비율이 ${rate(item.baseline_failure_rate)}에서 ${rate(item.current_failure_rate)}로 높아져 다시 확인해야 합니다.`;
  }
  if (item.measurement_result === "unchanged") {
    return `적용 전 ${rate(item.baseline_failure_rate)}, 적용 후 ${rate(item.current_failure_rate)}로 아직 큰 차이가 없습니다.`;
  }
  return "아직 결과 확인을 시작하지 않았습니다.";
}

function statusCopy(item: ReliabilityImprovementRow) {
  if (item.status === "verified") return "실제로 문제가 줄어든 것이 확인됐습니다.";
  if (item.status === "regressed") return "오히려 문제가 늘어 다시 확인해야 합니다.";
  if (item.status === "measuring") return "적용 후 사용 기록을 모으며 결과를 확인하고 있습니다.";
  if (item.status === "policy_active") return "같은 문제가 생기면 자동으로 대응할 준비가 되어 있습니다.";
  if (item.status === "approval_required") return "중요한 변경이라 사람의 확인 없이는 적용하지 않습니다.";
  if (item.status === "implementation_needed") return "고칠 방법은 정리됐지만 아직 서비스에는 적용하지 않았습니다.";
  if (item.status === "analysis_pending") return "왜 문제가 생겼는지 찾는 중입니다.";
  if (item.status === "applied") return "서비스에 반영됐고 이제 결과를 확인할 차례입니다.";
  return "현재 변화를 계속 지켜보고 있습니다.";
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
      title: "사용 기록 모으기",
      value: data.summary.totalEvents,
      note: "OPS Center와 AI-Saurus 사용 결과",
      status: data.summary.totalEvents > 0 ? "succeeded" : "pending",
    },
    {
      step: "2",
      title: "문제 이유 찾기",
      value: data.summary.analyzedLearningCases,
      note: "반복되는 문제를 AI가 정리",
      status: data.summary.analyzedLearningCases > 0 ? "succeeded" : "pending",
    },
    {
      step: "3",
      title: "고칠 방법 정리",
      value: data.summary.improvementsTotal,
      note: "같은 문제를 막을 방법 준비",
      status: data.summary.improvementsTotal > 0 ? "succeeded" : "pending",
    },
    {
      step: "4",
      title: "실제 서비스에 적용",
      value: data.summary.improvementsApplied,
      note: "확인된 변경만 실제 적용으로 계산",
      status: data.summary.improvementsApplied > 0 ? "policy_active" : "pending",
    },
    {
      step: "5",
      title: "좋아졌는지 확인",
      value: judged,
      note: "적용 전과 후의 문제 발생률 비교",
      status: judged > 0 ? "verified" : "measuring",
    },
  ];

  const summaryCards = [
    { label: "자동 대응 준비", value: data.summary.policyActive, note: "같은 문제가 생기면 자동 처리", status: "policy_active" },
    { label: "결과 확인 중", value: data.summary.improvementsMeasuring, note: "적용 뒤 사용 기록을 더 모으는 중", status: "measuring" },
    { label: "좋아짐 확인", value: data.summary.improvementsVerified, note: "문제 발생이 실제로 줄어듦", status: "verified" },
    { label: "아직 적용 전", value: data.summary.implementationNeeded, note: "고칠 방법은 있지만 서비스 반영 전", status: "implementation_needed" },
    { label: "사람 확인 필요", value: data.summary.improvementApprovalRequired, note: "중요한 변경은 자동 적용하지 않음", status: "approval_required" },
    { label: "오히려 나빠짐", value: data.summary.improvementsRegressed, note: "되돌리거나 다시 고쳐야 할 항목", status: "regressed" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="COMMERCE OS · 자기개선 현황"
        title="통합 신뢰성·자기개선 코어"
        description="Commerce OS와 AI-Saurus를 쓰면서 생긴 문제를 자동으로 모으고, 왜 생겼는지 배우고, 실제로 고쳐졌는지까지 확인합니다."
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
              <strong className="text-base text-slate-950">자동 학습 연결 상태</strong>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              {aiSaurusConnected
                ? `AI-Saurus ${data.summary.aiSaurusEvents.toLocaleString("ko-KR")}건을 포함해 총 ${data.summary.totalEvents.toLocaleString("ko-KR")}건의 사용 기록을 자동으로 모았습니다.`
                : "AI-Saurus의 첫 사용 기록을 기다리고 있습니다."}
            </p>
          </div>
          <Link
            href="/operations"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50"
          >
            운영 안전센터 보기
          </Link>
        </div>
      </section>

      {data.error ? (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900">
          <strong className="block text-base">자기개선 현황을 불러오지 못했습니다.</strong>
          <p className="mt-2 break-words">{data.error}</p>
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold tracking-[0.12em] text-blue-600">한눈에 보는 진행 순서</p>
            <h2 className="mt-1 text-xl font-black text-slate-950">배운 것이 실제 개선으로 이어지는 과정</h2>
          </div>
          <p className="max-w-xl text-xs leading-5 text-slate-500">
            단순히 데이터를 모았다고 좋아졌다고 표시하지 않습니다. 실제 서비스에 적용된 뒤 결과까지 확인된 경우만 “좋아짐”으로 표시합니다.
          </p>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-5">
          {stages.map((stage) => (
            <article key={stage.step} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="grid size-7 place-items-center rounded-full bg-slate-950 text-xs font-black text-white">
                  {stage.step}
                </span>
                {badge(stage.status)}
              </div>
              <strong className="mt-4 block text-sm text-slate-950">{stage.title}</strong>
              <p className="mt-1 text-2xl font-black text-slate-950">{stage.value.toLocaleString("ko-KR")}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{stage.note}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {summaryCards.map((card) => (
          <article key={card.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-700">{card.label}</p>
              {badge(card.status)}
            </div>
            <strong className="mt-2 block text-3xl font-black text-slate-950">
              {card.value.toLocaleString("ko-KR")}
            </strong>
            <p className="mt-1 text-xs leading-5 text-slate-500">{card.note}</p>
          </article>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-slate-950">지금 무엇이 바뀌고 있나</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              평소에는 한 줄 요약만 보이고, 궁금한 항목만 펼치면 배운 내용과 결과를 볼 수 있습니다.
            </p>
          </div>
          <span className="text-xs font-semibold text-slate-500">
            총 {data.summary.improvementsTotal.toLocaleString("ko-KR")}개
          </span>
        </div>

        <div className="mt-4 space-y-2">
          {improvements.length ? (
            improvements.slice(0, 24).map((item) => (
              <details key={item.id} className="group rounded-xl border border-slate-200 bg-white">
                <summary className="cursor-pointer list-none px-4 py-4 marker:hidden">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {badge(item.status)}
                        {item.risk_level === "high" || item.risk_level === "critical" ? badge(item.risk_level) : null}
                      </div>
                      <strong className="mt-2 block text-sm leading-6 text-slate-950">{plainTitle(item)}</strong>
                      <p className="mt-1 text-xs leading-5 text-slate-600">{statusCopy(item)}</p>
                    </div>
                    <span className="shrink-0 rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600 group-open:bg-slate-900 group-open:text-white">
                      펼쳐보기
                    </span>
                  </div>
                </summary>

                <div className="border-t border-slate-100 p-4">
                  <div className="grid gap-3 lg:grid-cols-3">
                    <article className="rounded-xl bg-slate-50 p-4">
                      <p className="text-xs font-black text-slate-400">무엇을 배웠나</p>
                      <p className="mt-2 text-sm font-bold leading-6 text-slate-900">{short(item.fact_summary, 340)}</p>
                      <p className="mt-2 text-xs leading-5 text-slate-600">
                        <strong>원인:</strong> {short(item.root_cause, 360)}
                      </p>
                    </article>

                    <article className="rounded-xl bg-blue-50 p-4">
                      <p className="text-xs font-black text-blue-500">지금 어떻게 처리하고 있나</p>
                      <p className="mt-2 text-sm leading-6 text-blue-950">{applicationCopy(item)}</p>
                      <p className="mt-2 text-xs leading-5 text-blue-800">
                        <strong>고칠 방법:</strong> {short(item.change_summary, 360)}
                      </p>
                    </article>

                    <article className="rounded-xl bg-emerald-50 p-4">
                      <p className="text-xs font-black text-emerald-600">실제로 좋아졌나</p>
                      <p className="mt-2 text-sm leading-6 text-emerald-950">{measurementCopy(item)}</p>
                      {item.applied_at ? (
                        <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                          <div className="rounded-lg bg-white/70 p-2">
                            <p className="text-[10px] font-bold text-slate-400">적용 전 문제 발생</p>
                            <p className="mt-1 text-sm font-black text-slate-900">{rate(item.baseline_failure_rate)}</p>
                          </div>
                          <div className="rounded-lg bg-white/70 p-2">
                            <p className="text-[10px] font-bold text-slate-400">적용 후 문제 발생</p>
                            <p className="mt-1 text-sm font-black text-slate-900">{rate(item.current_failure_rate)}</p>
                          </div>
                        </div>
                      ) : null}
                    </article>
                  </div>

                  <p className="mt-3 text-xs leading-5 text-slate-500">
                    <strong className="text-slate-700">기대하는 변화:</strong> {short(item.expected_effect, 300)}
                  </p>

                  <details className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50">
                    <summary className="cursor-pointer px-3 py-2 text-xs font-bold text-slate-600">
                      전문가용 정보 펼쳐보기
                    </summary>
                    <div className="grid gap-2 border-t border-slate-200 px-3 py-3 text-xs text-slate-600 md:grid-cols-2">
                      <p><strong>원본 작업명:</strong> {item.engine}</p>
                      <p><strong>오류 코드:</strong> {item.error_code || "없음"}</p>
                      <p><strong>내부 상태:</strong> {item.status}</p>
                      <p><strong>변경 종류:</strong> {item.improvement_kind}</p>
                      <p><strong>적용 방식:</strong> {item.application_mode}</p>
                      <p><strong>분석 신뢰도:</strong> {confidence(item.confidence)}</p>
                      <p><strong>대상 저장소:</strong> {item.target_repo || "없음"}</p>
                      <p><strong>적용 근거:</strong> {item.applied_reference || "없음"}</p>
                      <p className="md:col-span-2"><strong>재발 방지 확인 항목:</strong> {item.target_test_name || "아직 없음"}</p>
                    </div>
                  </details>
                </div>
              </details>
            ))
          ) : (
            <p className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
              문제가 분석되면 여기에 자동으로 정리됩니다.
            </p>
          )}
        </div>
      </section>

      <details className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <summary className="cursor-pointer px-5 py-4 font-black text-slate-950">
          최근에 무엇이 바뀌었는지 펼쳐보기
        </summary>
        <div className="space-y-2 border-t border-slate-100 p-4">
          {data.improvementActivity.length ? (
            data.improvementActivity.slice(0, 16).map((activity) => {
              const improvement = improvementById.get(activity.improvement_id);
              return (
                <div key={activity.id} className="flex gap-3 rounded-xl border border-slate-200 p-3">
                  <span className="mt-1 size-2 shrink-0 rounded-full bg-blue-600" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {activity.to_status ? badge(activity.to_status) : null}
                      <strong className="text-sm text-slate-950">
                        {improvement ? plainTitle(improvement) : "자기개선 항목"}
                      </strong>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-600">{activity.summary}</p>
                    <p className="mt-1 text-[11px] text-slate-400">{ago(activity.occurred_at)}</p>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="px-4 py-6 text-center text-sm text-slate-500">아직 변화 기록이 없습니다.</p>
          )}
        </div>
      </details>

      <details className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <summary className="cursor-pointer px-5 py-4 font-black text-slate-950">
          전문가용 기술 정보 펼쳐보기
        </summary>
        <div className="space-y-6 border-t border-slate-100 p-5">
          <p className="rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
            아래 내용은 개발자가 문제를 추적할 때 쓰는 내부 정보입니다. 평소 운영에는 보지 않아도 됩니다.
          </p>

          <section>
            <h2 className="text-base font-black text-slate-950">반복 문제 묶음</h2>
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
                    {incident.occurrence_count.toLocaleString("ko-KR")}회 · 자동 해결 {incident.automatic_recovery_successes.toLocaleString("ko-KR")}회
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section className="grid gap-5 xl:grid-cols-2">
            <article>
              <h2 className="text-base font-black text-slate-950">AI가 정리한 학습 내용</h2>
              <div className="mt-3 space-y-3">
                {data.learningCases.slice(0, 10).map((item) => (
                  <div key={item.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {badge(item.state)}
                      <strong className="text-sm text-slate-950">{item.title}</strong>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-600">{short(item.prevention_rule || item.symptom, 260)}</p>
                  </div>
                ))}
              </div>
            </article>

            <article>
              <h2 className="text-base font-black text-slate-950">재발 방지 확인 항목</h2>
              <div className="mt-3 space-y-3">
                {data.regressionCases.slice(0, 10).map((item) => (
                  <div key={item.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {badge(item.status)}
                      <strong className="break-all text-xs text-slate-700">{item.source_repo}</strong>
                    </div>
                    <p className="mt-2 text-xs font-bold leading-5 text-slate-700">{item.test_name}</p>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="grid gap-5 xl:grid-cols-2">
            <article>
              <h2 className="text-base font-black text-slate-950">AI 분석 작업 상태</h2>
              <div className="mt-3 space-y-3">
                {data.analysisQueue.slice(0, 8).map((item) => (
                  <div key={item.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between gap-3">
                      {badge(item.status)}
                      <span className="text-xs text-slate-500">{item.attempts}/{item.max_attempts}</span>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">모델 {item.model || "배정 전"} · {ago(item.updated_at)}</p>
                  </div>
                ))}
              </div>
            </article>

            <article>
              <h2 className="text-base font-black text-slate-950">자동 처리 대기 상태</h2>
              <div className="mt-3 space-y-3">
                {data.recoveryQueue.slice(0, 8).map((item) => (
                  <div key={item.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {badge(item.status)}
                      <strong className="text-sm text-slate-950">{item.engine}</strong>
                    </div>
                    <p className="mt-2 break-all font-mono text-xs text-slate-700">{item.action}</p>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section>
            <h2 className="text-base font-black text-slate-950">최근 원본 사용 기록</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {data.recentEvents.slice(0, 12).map((event) => (
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
