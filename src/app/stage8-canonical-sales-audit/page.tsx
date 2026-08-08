import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadProductMasterCanonicalSalesAudit } from "@/lib/productMasterCanonicalSalesAudit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function Stage8CanonicalSalesAuditPage() {
  const audit = await loadProductMasterCanonicalSalesAudit();
  const snapshot = audit.snapshot;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · CANONICAL SALES AUDIT"
        title="12×30일 판매원장 재검증"
        description="전수 적재된 Product Master 판매 이벤트를 같은 analysisAsOf로 다시 읽어 활성 SKU 판매, 취소·반품 tombstone, 비활성 관리 SKU의 역사 판매, 실제 orphan을 분리합니다. 이 화면은 읽기 전용입니다."
        actions={
          <Link href="/stage8-readiness" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">
            Stage8 준비도
          </Link>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="상태" value={audit.state} />
        <Metric label="활성 관리 SKU" value={snapshot ? number.format(snapshot.managedActiveSkuCount) : "-"} />
        <Metric label="전체 이벤트" value={snapshot ? number.format(snapshot.sourceEventCount) : "-"} />
        <Metric label="활성 정상판매" value={snapshot ? number.format(snapshot.validEventCount) : "-"} />
        <Metric label="활성 tombstone" value={snapshot ? number.format(snapshot.tombstoneCount) : "-"} />
        <Metric label="실제 orphan" value={snapshot ? number.format(snapshot.orphanEventCount) : "-"} />
      </section>

      <section className={`rounded-2xl border p-5 shadow-sm ${audit.ready ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
        <h2 className="text-lg font-black text-slate-950">{audit.ready ? "Canonical 판매원장 구조 정상" : "검토 필요"}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-700">{audit.message}</p>
        {audit.analysisAsOf ? <p className="mt-2 text-xs text-slate-500">analysisAsOf · {audit.analysisAsOf}</p> : null}
      </section>

      {snapshot ? (
        <>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">이벤트 분류 회계</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="활성 정상판매" value={number.format(snapshot.validEventCount)} />
              <Metric label="활성 tombstone" value={number.format(snapshot.tombstoneCount)} />
              <Metric label="비활성 관리 역사" value={number.format(snapshot.inactiveManagedHistoricalEventCount)} />
              <Metric label="실제 orphan" value={number.format(snapshot.orphanEventCount)} />
              <Metric label="비활성 역사 정상판매" value={number.format(snapshot.inactiveManagedValidEventCount)} />
              <Metric label="비활성 역사 tombstone" value={number.format(snapshot.inactiveManagedTombstoneCount)} />
              <Metric label="분류합계" value={number.format(snapshot.classifiedEventCount)} />
              <Metric label="전체분류" value={snapshot.classificationComplete ? "COMPLETE" : "MISMATCH"} />
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-600">
              비활성 관리 SKU의 과거 판매는 삭제하지 않고 역사 원장으로 보존하되, 현재 활성 SKU의 발주 수요에는 합산하지 않습니다. 실제 orphan은 현재/과거 SKU identity 어느 쪽에도 안전하게 귀속되지 않는 이벤트만 의미합니다.
            </p>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">비활성 관리 SKU 역사 표본</h2>
            {snapshot.inactiveManagedHistoricalSamples.length ? (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs text-slate-500">
                    <tr>
                      <th className="px-3 py-2">바코드</th>
                      <th className="px-3 py-2">SKU ID</th>
                      <th className="px-3 py-2">외부 이벤트 ID</th>
                      <th className="px-3 py-2">발생시각</th>
                      <th className="px-3 py-2">정상판매</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.inactiveManagedHistoricalSamples.map((row) => (
                      <tr key={`${row.skuId}:${row.externalId}`} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-bold text-slate-900">{row.barcode}</td>
                        <td className="px-3 py-2 text-slate-600">{row.skuId}</td>
                        <td className="px-3 py-2 text-slate-600">{row.externalId}</td>
                        <td className="px-3 py-2 text-slate-600">{row.occurredAt}</td>
                        <td className="px-3 py-2">{row.validSale ? "예" : "아니오"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-500">비활성 관리 SKU 역사 이벤트가 없습니다.</p>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-700">
            <strong>12×30일 계약</strong> · {snapshot.bucketCount}개 구간 × {snapshot.bucketDays}일 · 활성 SKU {snapshot.rows.length}행 · 지문 <span className="break-all text-xs">{snapshot.contentFingerprint}</span>
          </section>
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong className="mt-1 block text-lg text-slate-950">{value}</strong>
    </article>
  );
}
