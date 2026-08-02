import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadOperationsDashboard } from "@/lib/commerceOperationsDashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const statusLabels: Record<string, string> = {
  PENDING: "대기",
  RUNNING: "실행 중",
  AWAITING_APPROVAL: "최종 승인 대기",
  SUCCEEDED: "완료",
  FAILED: "실패",
  CANCELLED: "취소",
  FRESH: "최신",
  STALE: "오래됨",
  MISSING: "없음",
  prepared: "승인 전",
  running: "실행 중",
  paused: "일시중지",
  succeeded: "완료",
  failed: "실패",
  dispatch_uncertain: "반영 확인 필요",
  cancelled: "취소",
};

const sourceLabels: Record<string, string> = {
  confirmed_receipts: "확정 입고원가",
  price_recommendations: "가격 변경안",
  sales_orders: "판매·주문 데이터",
  product_mappings: "상품·옵션 연결",
  estimated_inventory: "추정재고",
};

function tone(status: string) {
  if (["FAILED", "failed", "dispatch_uncertain", "MISSING"].includes(status)) {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }
  if (["STALE", "paused", "AWAITING_APPROVAL", "prepared"].includes(status)) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (["FRESH", "SUCCEEDED", "succeeded"].includes(status)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  return "border-blue-200 bg-blue-50 text-blue-800";
}

function badge(status: string) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${tone(
        status,
      )}`}
    >
      {statusLabels[status] || status}
    </span>
  );
}

function ago(value: string | null, now = Date.now()) {
  if (!value) return "기록 없음";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "시각 오류";
  const minutes = Math.max(0, Math.floor((now - parsed) / 60_000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

function shortId(value: string) {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

export default async function OperationsPage() {
  const data = await loadOperationsDashboard();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · 실행 통제"
        title="운영 안전센터"
        description="입고확정 이후 자동화, 데이터 최신도, 가격 변경 승인 대기와 실패 작업을 한곳에서 확인합니다."
      />

      {data.error ? (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900">
          <strong className="block text-base">운영 데이터를 불러오지 못했습니다.</strong>
          <p className="mt-2 break-words">{data.error}</p>
        </section>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ["실행 중", data.summary.running, "진행 중인 자동화"],
          ["최종 승인 대기", data.summary.awaitingApproval, "Shopling 반영 전"],
          ["실패", data.summary.failed, "원인 확인 필요"],
          ["오래된 데이터", data.summary.staleSources, "실행 차단 대상"],
          ["가격 작업", data.summary.pendingPriceJobs, "준비·실행·확인"],
        ].map(([label, value, note]) => (
          <article key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-500">{label}</p>
            <strong className="mt-2 block text-3xl font-black text-slate-950">
              {Number(value).toLocaleString("ko-KR")}
            </strong>
            <p className="mt-2 text-xs text-slate-500">{note}</p>
          </article>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-950">데이터 최신도</h2>
            <p className="mt-1 text-sm text-slate-500">
              기준시간을 넘긴 데이터는 관련 자동화에서 사용하지 않습니다.
            </p>
          </div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-3">데이터</th>
                <th className="px-3 py-3">상태</th>
                <th className="px-3 py-3">생성 시각</th>
                <th className="px-3 py-3">허용 기준</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.sources.length ? (
                data.sources.map((source) => (
                  <tr key={source.source_key}>
                    <td className="px-3 py-4 font-bold text-slate-900">
                      {sourceLabels[source.source_key] || source.source_key}
                    </td>
                    <td className="px-3 py-4">{badge(source.effectiveStatus)}</td>
                    <td className="px-3 py-4 text-slate-600">
                      {ago(source.generated_at)}
                    </td>
                    <td className="px-3 py-4 text-slate-600">
                      {source.max_age_minutes >= 1440
                        ? `${Math.floor(source.max_age_minutes / 1440)}일 이내`
                        : source.max_age_minutes >= 60
                          ? `${Math.floor(source.max_age_minutes / 60)}시간 이내`
                          : `${source.max_age_minutes}분 이내`}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-slate-500">
                    아직 수집된 데이터 최신도 기록이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">자동화 실행 기록</h2>
        <p className="mt-1 text-sm text-slate-500">
          입고확정부터 가격 변경안 생성까지 같은 연관번호로 추적합니다.
        </p>
        <div className="mt-4 space-y-3">
          {data.runs.length ? (
            data.runs.map((run) => (
              <article key={run.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      {badge(run.status)}
                      <strong className="text-sm text-slate-950">{run.operation_type}</strong>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      연관번호 {shortId(run.correlation_id)} · {ago(run.started_at)}
                    </p>
                  </div>
                  {run.status === "AWAITING_APPROVAL" ? (
                    <Link
                      href="/shopling-price-adjustment-runner"
                      className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800"
                    >
                      최종 승인 화면 열기
                    </Link>
                  ) : null}
                </div>
                {run.error_message ? (
                  <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-800">
                    {run.error_message}
                  </p>
                ) : null}
              </article>
            ))
          ) : (
            <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
              아직 자동화 실행 기록이 없습니다.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">샵플링 가격 Bulk 작업</h2>
        <p className="mt-1 text-sm text-slate-500">
          첫 10개 시험 실행, 50개 직렬 처리, 실패·반영 불확실 상태를 확인합니다.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-3">작업</th>
                <th className="px-3 py-3">상태</th>
                <th className="px-3 py-3">상품 수</th>
                <th className="px-3 py-3">생성</th>
                <th className="px-3 py-3">오류</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.priceJobs.length ? (
                data.priceJobs.map((job) => (
                  <tr key={job.id}>
                    <td className="px-3 py-4 font-mono text-xs text-slate-700">
                      {shortId(job.id)}
                    </td>
                    <td className="px-3 py-4">{badge(job.status)}</td>
                    <td className="px-3 py-4 font-bold text-slate-900">
                      {job.valid_count.toLocaleString("ko-KR")}
                    </td>
                    <td className="px-3 py-4 text-slate-600">{ago(job.created_at)}</td>
                    <td className="max-w-xl px-3 py-4 text-xs text-rose-700">
                      {job.last_error || "-"}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                    최근 가격 Bulk 작업이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
