import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadProductMasterShoplingSalesIncrementalStatus } from "@/lib/productMasterShoplingSalesIncremental";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong className="mt-1 block text-xl text-slate-950">
        {typeof value === "number" ? number.format(value) : value}
      </strong>
    </article>
  );
}

function formatTime(value: string | null) {
  if (!value) return "없음";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(parsed);
}

export default async function ProductMasterShoplingSalesIncrementalPage() {
  const status = await loadProductMasterShoplingSalesIncrementalStatus();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · 상품마스터 판매원장"
        title="Shopling 판매원장 자동 증분 동기화"
        description="최초 24개월 판매원장이 검증된 뒤에는 과거 전체를 다시 읽지 않고 최근 4개 달만 주기적으로 재계산합니다. 사람의 반복 클릭 없이 Worker가 읽기·안전검증·멱등 갱신·재조회 검증까지 수행합니다."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/product-master/shopling-sales-backfill"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              24개월 판매원장
            </Link>
            <Link
              href="/product-master"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              상품마스터 구축현황
            </Link>
          </div>
        }
      />

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
              ROLLING 4 MONTHS · AUTONOMOUS · FAIL CLOSED
            </p>
            <h2 className="mt-2 text-xl font-black text-slate-950">자동 동기화 상태</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              성공 후 6시간 주기이며, 조회 실패는 7일 구간에서 2일 구간으로 한 번 축소합니다. 미연결 주문·다른 원천 중복·연결구조 변경·비정상적인 판매량 급락이 있으면 상품마스터를 변경하지 않습니다.
            </p>
          </div>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-black text-slate-700">
            {status.state}
          </span>
        </div>

        <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-blue-600 transition-all"
            style={{ width: `${Math.max(0, Math.min(100, status.progress))}%` }}
          />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Metric
            label="증분 기간 구간"
            value={`${status.completedRanges} / ${status.totalRanges}`}
          />
          <Metric label="Shopling 조회행" value={status.fetchedRows} />
          <Metric label="연결된 유효 주문" value={status.acceptedRows} />
          <Metric label="월 판매원장 후보" value={status.monthlyRowCount} />
          <Metric label="미연결 주문" value={status.unmappedRows} />
        </div>

        <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-700">
          {status.stage} · {status.message}
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="최초 24개월 기준" value={status.baselineState} />
          <Metric label="조회 단위" value={status.chunkDays ? `${status.chunkDays}일` : "대기"} />
          <Metric label="마지막 성공" value={formatTime(status.lastSuccessAt)} />
          <Metric label="마지막 실패" value={formatTime(status.lastFailureAt)} />
        </div>

        {status.error ? (
          <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-900">
            {status.error}
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
        <h2 className="text-lg font-black text-emerald-950">운영 규칙</h2>
        <p className="mt-2 text-sm leading-6 text-emerald-900">
          이 화면에는 실행 버튼이 없습니다. 최초 24개월 판매원장 검증이 완료되면 예약 Worker가 자동으로 최근 4개 달을 재계산합니다. 정상일 때만 같은 결정적 원장 ID를 upsert하고 다시 읽어 동일값을 확인합니다.
        </p>
      </section>
    </div>
  );
}
