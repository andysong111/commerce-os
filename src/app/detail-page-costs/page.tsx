import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import {
  aggregateRecentDetailPageCostRuns,
  detailPageUsdKrwRate,
  isDetailPageCostAdmin,
  normalizeDetailPageCostSummary,
  type DetailPageCostRow,
} from "@/lib/detailPageCostAdmin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const usd = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value < 1 ? 4 : 2,
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);

const krw = (value: number) =>
  new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);

const dateTime = (value: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export default async function DetailPageCostsPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null } };
  if (!data.user) redirect("/login");
  if (!isDetailPageCostAdmin(data.user.email)) notFound();

  const admin = await createSupabaseAdminClient();
  if (!admin) {
    return <LedgerUnavailable reason="관리자 데이터베이스 연결이 설정되지 않았습니다." />;
  }

  const [summaryResult, eventsResult] = await Promise.all([
    admin.rpc("get_detail_page_cost_summary", {}),
    admin
      .from("detail_page_cost_events")
      .select(
        "id,run_id,event_type,generation_profile,model,slot,product_name,output_language,estimated_cost_usd,pricing_status,pricing_version,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  if (summaryResult.error || eventsResult.error) {
    return <LedgerUnavailable reason="원가 원장 테이블 연결을 완료해야 합니다." />;
  }

  const summary = normalizeDetailPageCostSummary(summaryResult.data);
  const rows = Array.isArray(eventsResult.data)
    ? (eventsResult.data as DetailPageCostRow[])
    : [];
  const runs = aggregateRecentDetailPageCostRuns(rows).slice(0, 30);
  const rate = detailPageUsdKrwRate();
  const average =
    summary.run_count > 0 ? summary.total_cost_usd / summary.run_count : 0;

  return (
    <>
      <PageHeader
        title="상세페이지 생성 원가 관리"
        description="상세페이지 스튜디오의 OpenAI 호출 원가를 운영자 계정에서만 확인합니다. 사용자 과금·크레딧 화면과 분리된 내부 추정 원장입니다."
      />

      <div className="mb-5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="rounded-full bg-slate-100 px-3 py-1.5">
          가격 기준: OpenAI 2026-07-29
        </span>
        <span className="rounded-full bg-slate-100 px-3 py-1.5">
          내부 환율: $1 = {krw(rate)}
        </span>
        <span className="rounded-full bg-emerald-50 px-3 py-1.5 font-semibold text-emerald-700">
          관리자 전용
        </span>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="누적 추정 원가"
          primary={usd(summary.total_cost_usd)}
          secondary={krw(summary.total_cost_usd * rate)}
        />
        <MetricCard
          label="오늘 추정 원가"
          primary={usd(summary.today_cost_usd)}
          secondary={`${krw(summary.today_cost_usd * rate)} · ${summary.today_run_count}건`}
        />
        <MetricCard
          label="실행당 평균"
          primary={usd(average)}
          secondary={`${krw(average * rate)} · 누적 ${summary.run_count}건`}
        />
        <MetricCard
          label="호출 원장"
          primary={`${summary.event_count.toLocaleString("ko-KR")}회`}
          secondary={`미산정 ${summary.unpriced_event_count.toLocaleString("ko-KR")}회`}
          warning={summary.unpriced_event_count > 0}
        />
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold text-slate-950">최근 생성 실행</h2>
          <p className="mt-1 text-xs text-slate-500">
            최근 호출 500개를 실행 ID별로 묶었습니다. 자동보정과 재검수도 실제 호출에 포함됩니다.
          </p>
        </div>
        {runs.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">
            아직 기록된 상세페이지 실행이 없습니다.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
                <tr>
                  <th className="px-5 py-3">생성 시각</th>
                  <th className="px-5 py-3">상품</th>
                  <th className="px-5 py-3">프로필·언어</th>
                  <th className="px-5 py-3">호출</th>
                  <th className="px-5 py-3 text-right">추정 원가</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runs.map((run) => (
                  <tr key={run.run_id} className="align-top">
                    <td className="whitespace-nowrap px-5 py-4 text-slate-500">
                      {dateTime(run.created_at)}
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-semibold text-slate-900">
                        {run.product_name || "상품명 미지정"}
                      </p>
                      <p className="mt-1 max-w-52 truncate font-mono text-[11px] text-slate-400">
                        {run.run_id}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-slate-600">
                      {run.generation_profile} · {run.output_language}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-slate-600">
                      이미지 {run.image_calls} · 검수 {run.verifier_calls}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-right">
                      <p className="font-semibold text-slate-900">
                        {usd(run.cost_usd)}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {krw(run.cost_usd * rate)}
                        {run.has_unpriced_event ? " · 일부 미산정" : ""}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-4 text-xs leading-5 text-slate-500">
        원가는 API 응답의 실제 토큰 사용량과 버전 고정 요율로 산정한 내부 추정치입니다. 세금·환전 수수료·사용자 판매가격은 포함하지 않습니다.
      </p>
    </>
  );
}

function MetricCard({
  label,
  primary,
  secondary,
  warning = false,
}: {
  label: string;
  primary: string;
  secondary: string;
  warning?: boolean;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-3 text-2xl font-bold tracking-tight text-slate-950">
        {primary}
      </p>
      <p
        className={`mt-2 text-xs ${warning ? "font-semibold text-amber-700" : "text-slate-500"}`}
      >
        {secondary}
      </p>
    </article>
  );
}

function LedgerUnavailable({ reason }: { reason: string }) {
  return (
    <>
      <PageHeader
        title="상세페이지 생성 원가 관리"
        description="상세페이지 스튜디오의 실제 API 호출 원가를 확인하는 관리자 전용 화면입니다."
      />
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
        <h2 className="font-semibold text-amber-950">원가 원장 연결 대기</h2>
        <p className="mt-2 text-sm leading-6 text-amber-800">{reason}</p>
      </section>
    </>
  );
}
