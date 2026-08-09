import { PageHeader } from "@/components/PageHeader";
import { loadInventoryVerificationPriority } from "@/lib/stage8InventoryVerificationPriority";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Stage8PurchaseCandidateIdentityAuditPage() {
  const priority = await loadInventoryVerificationPriority();
  const rows = priority.rows.filter((row) => row.purchaseStatus === "발주 추천");
  const missingModelNo = rows.filter((row) => !row.modelNo).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · PURCHASE CANDIDATE IDENTITY AUDIT"
        title="발주후보 과거발주 연결용 식별자 점검"
        description="현재 발주후보의 B-code·모델번호·상품명을 읽기 전용으로 펼쳐 과거 중국 발주이력과 안전하게 연결할 준비를 합니다. 이 화면은 재고·발주·가격을 변경하지 않습니다."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="상태" value={priority.state} />
        <Metric label="발주후보" value={`${rows.length}개`} />
        <Metric label="모델번호 있음" value={`${rows.length - missingModelNo}개`} />
        <Metric label="모델번호 없음" value={`${missingModelNo}개`} />
        <Metric label="Business write" value="0 · READ ONLY" />
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950 shadow-sm">
        <strong>ORDER HISTORY IS NOT CONFIRMED INBOUND</strong>
        <br />
        과거 발주수량은 초기 추정재고의 후보 증거일 뿐 확정입고나 현재 잔여재고로 승격하지 않습니다. 모델번호·상품명·옵션 정체성이 안전하게 맞는 행만 다음 검증 단계로 보냅니다.
      </section>

      <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-black text-slate-600">
            <tr>
              <th className="px-4 py-3">B-code</th>
              <th className="px-4 py-3">모델번호</th>
              <th className="px-4 py-3">상품명</th>
              <th className="px-4 py-3">권장수량</th>
              <th className="px-4 py-3">재고모드</th>
              <th className="px-4 py-3">원가상태</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.barcode}>
                <td className="px-4 py-3 font-black text-slate-950">{row.barcode}</td>
                <td className="px-4 py-3">{row.modelNo ?? "MODEL_NO_MISSING"}</td>
                <td className="px-4 py-3">{row.name || "-"}</td>
                <td className="px-4 py-3">{row.recommendedQty}</td>
                <td className="px-4 py-3">{row.inventoryMode}</td>
                <td className="px-4 py-3">{row.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
