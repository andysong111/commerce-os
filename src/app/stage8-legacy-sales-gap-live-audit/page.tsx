import { PageHeader } from "@/components/PageHeader";
import { loadLegacySalesGapLiveAudit } from "@/lib/stage8LegacySalesGapLiveAudit";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

const number = new Intl.NumberFormat("ko-KR");

export default async function Stage8LegacySalesGapLiveAuditPage() {
  const audit = await loadLegacySalesGapLiveAudit();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · LEGACY SALES GAP LIVE AUDIT"
        title="BGG1-1 Canonical 360일 이전 판매 재조회"
        description="과거 발주수량과 실제재고의 차이를 설명하기 위해 Canonical 360일 시작 전 구간만 Shopling 주문 API에서 읽기 전용으로 다시 확인합니다. 현재 B-code identity와 과거 aaa316 모델코드 증거를 분리하며 재고·가격·발주 값은 변경하지 않습니다."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="상태" value={audit.state} />
        <Metric label="조회 구간" value={`${audit.completedRangeCount}/${audit.rangeCount}`} />
        <Metric label="Shopling 조회행" value={number.format(audit.fetchedRows)} />
        <Metric label="Canonical 직접해결" value={`${number.format(audit.canonicalResolvedUnits)}개`} />
        <Metric label="현재 identity" value={`${number.format(audit.currentIdentityUnits)}개`} />
        <Metric label="비즈니스 write" value="0 · READ ONLY" />
      </section>

      <section className={`rounded-2xl border p-5 shadow-sm ${audit.state === "READY" ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
        <span className="text-xs font-black tracking-[0.14em] text-slate-600">LIVE READ · VALIDATION ONLY</span>
        <h2 className="mt-1 text-xl font-black text-slate-950">{audit.targetBarcode} · {audit.productName}</h2>
        <p className="mt-3 text-sm leading-6 text-slate-700">{audit.message}</p>
        <p className="mt-3 text-xs text-slate-500">
          재조회 범위 · {audit.scanStart} → {audit.scanEnd} · Canonical 360일 시작 · {audit.canonicalWindowStart}
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric
          label="현재 identity 환산수량"
          value={`${number.format(audit.currentIdentityUnits)}개`}
        />
        <Metric
          label="aaa316 + 현재 identity"
          value={`${number.format(audit.legacyModelCurrentIdentityUnits)}개`}
        />
        <Metric
          label="모델명만 맞는 주문행"
          value={`${number.format(audit.modelNameOnlyOrderRows)}행`}
        />
        <Metric
          label="외부 B-code 충돌"
          value={`${number.format(audit.foreignBcodeConflictRows)}행`}
        />
        <Metric
          label="세트수량 미결정"
          value={`${number.format(audit.unresolvedPackRows)}행`}
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">구간별 읽기 결과</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[1050px] text-left text-xs">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-2 py-2">기간</th>
                <th className="px-2 py-2 text-right">조회행</th>
                <th className="px-2 py-2 text-right">Canonical BGG</th>
                <th className="px-2 py-2 text-right">현재 identity</th>
                <th className="px-2 py-2 text-right">aaa316+identity</th>
                <th className="px-2 py-2 text-right">현재 identity 주문행</th>
                <th className="px-2 py-2 text-right">모델명만</th>
                <th className="px-2 py-2 text-right">B-code 충돌</th>
                <th className="px-2 py-2 text-right">pack 미결정</th>
                <th className="px-2 py-2">오류</th>
              </tr>
            </thead>
            <tbody>
              {audit.ranges.map((row) => (
                <tr key={`${row.range.start}:${row.range.end}`} className="border-b border-slate-100">
                  <td className="px-2 py-2 font-semibold text-slate-900">{row.range.start} → {row.range.end}</td>
                  <td className="px-2 py-2 text-right">{number.format(row.fetchedRows)}</td>
                  <td className="px-2 py-2 text-right">{number.format(row.canonicalTargetUnits)}</td>
                  <td className="px-2 py-2 text-right">{number.format(row.currentIdentityUnits)}</td>
                  <td className="px-2 py-2 text-right">{number.format(row.legacyModelCurrentIdentityUnits)}</td>
                  <td className="px-2 py-2 text-right">{number.format(row.currentIdentityOrderRows)}</td>
                  <td className="px-2 py-2 text-right">{number.format(row.modelNameOnlyOrderRows)}</td>
                  <td className="px-2 py-2 text-right">{number.format(row.foreignBcodeConflictRows)}</td>
                  <td className="px-2 py-2 text-right">{number.format(row.unresolvedPackRows)}</td>
                  <td className="px-2 py-2 text-rose-700">{row.error ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm leading-6 text-rose-900 shadow-sm">
        <strong>자동 승격 금지.</strong> 이 화면에서 발견한 과거 판매는 추정재고 검증자료일 뿐입니다. 과거 발주수량은 확정입고가 아니며, 현재 identity나 aaa316이 맞더라도 별도 정합성 검증 전에는 실제 재고·발주수량에 사용하지 않습니다.
      </section>

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-xs leading-6 text-slate-600">
        감사 지문 · <span className="break-all">{audit.fingerprint}</span>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong className="mt-1 block break-all text-lg text-slate-950">{value}</strong>
    </article>
  );
}
