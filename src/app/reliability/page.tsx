import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadReliabilityDashboard } from "@/lib/reliability/reliabilityDashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const labels: Record<string, string> = {
  open: "열림",
  monitoring: "관찰 중",
  resolved: "해결",
  ignored: "제외",
  candidate: "학습 후보",
  approved: "승인",
  applied: "적용",
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
};

function tone(value: string) {
  if (["critical", "error", "failed", "failing", "dead_letter"].includes(value)) {
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
    ].includes(value)
  ) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (["resolved", "applied", "passing", "succeeded", "recovered"].includes(value)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
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

function ago(value: string, now = Date.now()) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "시각 오류";
  const minutes = Math.max(0, Math.floor((now - parsed) / 60_000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

function short(value: string | null, max = 72) {
  if (!value) return "-";
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export default async function ReliabilityPage() {
  const data = await loadReliabilityDashboard();
  const aiSaurusConnected = data.summary.aiSaurusEvents > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · RELIABILITY & LEARNING"
        title="통합 신뢰성·자기개선 코어"
        description="Commerce OS와 AI-Saurus 실행을 자동 수집하고, 반복 오류를 사건·AI 분석·학습 자산·회귀 테스트·안전한 복구 작업으로 전환합니다."
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
              <strong className="text-base text-slate-950">AI-Saurus 데이터 연결</strong>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              {aiSaurusConnected
                ? `AI-Saurus 이벤트 ${data.summary.aiSaurusEvents.toLocaleString("ko-KR")}건이 자동 학습 코어에 들어왔습니다.`
                : "AI-Saurus 전송 코드 또는 Vercel 환경변수가 아직 운영 배포되지 않아 첫 이벤트를 기다리고 있습니다."}
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

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ["수집 이벤트", data.summary.totalEvents, "개인정보 최소화 실행 신호"],
          ["열린 사건", data.summary.openIncidents, "중복 오류를 하나로 집계"],
          ["고위험 사건", data.summary.criticalOrHighIncidents, "자동 반영 금지"],
          ["학습 후보", data.summary.learningCandidates, "반복 오류에서 자동 생성"],
          ["AI 분석 대기", data.summary.analysisBacklog, "증거 기반 원인·예방 분석"],
          ["AI 분석 실패", data.summary.analysisFailures, "재시도 또는 격리 필요"],
          ["회귀 테스트 제안", data.summary.regressionProposals, "CI 자산화 대기"],
          ["자동복구 대기", data.summary.queuedRecoveries, "저위험 정책만 실행"],
          ["승인 필요", data.summary.approvalRequired, "고위험·판단 필요 작업"],
          ["AI-Saurus 이벤트", data.summary.aiSaurusEvents, "외부 SaaS 자동 흡수"],
        ].map(([label, value, note]) => (
          <article
            key={String(label)}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <p className="text-sm font-semibold text-slate-500">{label}</p>
            <strong className="mt-2 block text-3xl font-black text-slate-950">
              {Number(value).toLocaleString("ko-KR")}
            </strong>
            <p className="mt-2 text-xs leading-5 text-slate-500">{note}</p>
          </article>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-950">반복 사건</h2>
            <p className="mt-1 text-sm text-slate-500">
              같은 원인의 여러 실행을 하나로 묶어 발생 횟수와 복구 성과를 봅니다.
            </p>
          </div>
          <span className="text-xs font-semibold text-slate-500">
            원문 입력·고객 이메일·이미지는 저장하지 않음
          </span>
        </div>
        <div className="mt-4 space-y-3">
          {data.incidents.length ? (
            data.incidents.slice(0, 30).map((incident) => (
              <article key={incident.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {badge(incident.status)}
                      {badge(incident.severity)}
                      {badge(incident.risk_level)}
                      <strong className="break-all text-sm text-slate-950">
                        {incident.engine}
                      </strong>
                    </div>
                    <p className="mt-2 break-all text-sm font-bold text-slate-800">
                      {incident.error_code || incident.title || incident.signature}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      {incident.source_system} · {incident.occurrence_count.toLocaleString("ko-KR")}회 · 마지막 {ago(incident.last_seen_at)}
                    </p>
                  </div>
                  <div className="text-right text-xs leading-5 text-slate-500">
                    <p>복구 시도 {incident.automatic_recovery_attempts.toLocaleString("ko-KR")}회</p>
                    <p>복구 성공 {incident.automatic_recovery_successes.toLocaleString("ko-KR")}회</p>
                  </div>
                </div>
                {incident.latest_message ? (
                  <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-700">
                    {short(incident.latest_message, 240)}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {badge(incident.learning_state)}
                  {badge(incident.regression_state)}
                </div>
              </article>
            ))
          ) : (
            <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
              아직 집계된 반복 사건이 없습니다.
            </p>
          )}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-950">학습 자산 후보</h2>
          <p className="mt-1 text-sm text-slate-500">
            로그 전체가 아니라 반복성과 증거가 있는 사례만 지식으로 승격합니다.
          </p>
          <div className="mt-4 space-y-3">
            {data.learningCases.length ? (
              data.learningCases.slice(0, 12).map((item) => (
                <div key={item.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {badge(item.state)}
                    <strong className="text-sm text-slate-950">{item.title}</strong>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-600">
                    {short(item.symptom, 220)}
                  </p>
                  {item.root_cause ? (
                    <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-700">
                      <p><strong>AI 원인:</strong> {short(item.root_cause, 260)}</p>
                      <p className="mt-1"><strong>예방 규칙:</strong> {short(item.prevention_rule, 260)}</p>
                    </div>
                  ) : null}
                  <p className="mt-2 text-xs font-semibold text-slate-500">
                    신뢰도 {(Number(item.confidence) * 100).toFixed(0)}% · {ago(item.updated_at)}
                  </p>
                </div>
              ))
            ) : (
              <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                아직 학습 후보가 없습니다.
              </p>
            )}
          </div>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-950">AI 분석 큐</h2>
          <p className="mt-1 text-sm text-slate-500">
            비식별 운영 증거만 OpenAI가 읽고 원인·해결·예방 규칙을 구조화합니다.
          </p>
          <div className="mt-4 space-y-3">
            {data.analysisQueue.length ? (
              data.analysisQueue.slice(0, 15).map((item) => (
                <div key={item.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {badge(item.status)}
                      <strong className="font-mono text-xs text-slate-700">
                        {item.incident_id.slice(0, 8)}
                      </strong>
                    </div>
                    <span className="text-xs text-slate-500">
                      시도 {item.attempts}/{item.max_attempts}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    모델 {item.model || "배정 전"} · {ago(item.updated_at)}
                  </p>
                  {item.last_error ? (
                    <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-800">
                      {short(item.last_error, 220)}
                    </p>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                현재 AI 분석 대기 작업이 없습니다.
              </p>
            )}
          </div>
        </article>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-950">회귀 테스트 자산</h2>
          <p className="mt-1 text-sm text-slate-500">
            과거 오류를 결정적인 테스트로 만든 뒤 GitHub CI 통과 여부를 기록합니다.
          </p>
          <div className="mt-4 space-y-3">
            {data.regressionCases.length ? (
              data.regressionCases.slice(0, 12).map((item) => (
                <div key={item.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {badge(item.status)}
                    <strong className="break-all text-sm text-slate-950">
                      {item.source_repo}
                    </strong>
                  </div>
                  <p className="mt-2 text-xs font-bold leading-5 text-slate-700">
                    {item.test_name}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {short(item.protected_invariant, 240)}
                  </p>
                </div>
              ))
            ) : (
              <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                아직 회귀 테스트 제안이 없습니다.
              </p>
            )}
          </div>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-950">복구 작업 큐</h2>
          <p className="mt-1 text-sm text-slate-500">
            저위험·멱등 작업만 자동 대기열에 들어가며 가격·재고·주문·권한 변경은 승인 없이 실행하지 않습니다.
          </p>
          <div className="mt-4 space-y-3">
            {data.recoveryQueue.length ? (
              data.recoveryQueue.slice(0, 15).map((item) => (
                <div key={item.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {badge(item.status)}
                      <strong className="text-sm text-slate-950">{item.engine}</strong>
                    </div>
                    <span className="text-xs text-slate-500">
                      {item.attempt_count}/{item.max_attempts}
                    </span>
                  </div>
                  <p className="mt-2 break-all font-mono text-xs text-slate-700">
                    {item.action}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.source_system} · {ago(item.created_at)}
                  </p>
                </div>
              ))
            ) : (
              <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                현재 복구 대기 작업이 없습니다.
              </p>
            )}
          </div>
        </article>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">최근 자동 수집 이벤트</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {data.recentEvents.slice(0, 20).map((event) => (
            <article key={event.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center gap-2">
                {badge(event.status)}
                {badge(event.risk_level)}
                <strong className="text-sm text-slate-950">{event.engine}</strong>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {event.source_system} · {event.stage || event.event_type} · {ago(event.occurred_at)}
              </p>
              {event.error_code ? (
                <p className="mt-2 break-all font-mono text-xs text-rose-700">
                  {event.error_code}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
