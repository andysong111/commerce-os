import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadChinaOrderLedger } from "@/lib/chinaOrderLedger";
import { loadFastPurchaseInternalDrafts } from "@/lib/fastPurchaseInternalDraft";
import { loadChinaOrderInternalStatus } from "@/lib/integrations/chinaOrderManager";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

function statusLabel(value: string) {
  if (value === "RESERVED") return "주문초안";
  if (value === "EXPORTED") return "중국주문 전송";
  if (value === "ORDERED") return "실주문";
  if (value === "PARTIALLY_RECEIVED") return "부분입고";
  if (value === "RECEIVED") return "정상입고 완료";
  if (value === "CANCELLED") return "취소·누락 해제";
  if (value === "FAILED") return "처리 실패";
  return value;
}

function statusTone(value: string) {
  if (["RECEIVED"].includes(value)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (["PARTIALLY_RECEIVED", "ORDERED", "EXPORTED", "RESERVED"].includes(value)) {
    return "border-blue-200 bg-blue-50 text-blue-800";
  }
  if (value === "FAILED") return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

export default async function ChinaOrderManagerPage() {
  const [status, ledger, internalDraftState] = await Promise.all([
    loadChinaOrderInternalStatus(),
    loadChinaOrderLedger(),
    loadFastPurchaseInternalDrafts(),
  ]);
  const commitments = ledger.commitments.slice(0, 100);
  const activeDrafts = internalDraftState.drafts.filter(
    (draft) => draft.openQuantity > 0,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · 중국 발주·입고 내부 이전"
        title="중국 발주·입고 관리"
        description="빠른 발주안의 내부 Draft부터 실제 1688 주문 준비·실주문 기록·부분입고·정상입고까지 Ops Center 안으로 통합합니다. GPT Site는 운영 경로에서 사용하지 않습니다."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/fast-purchase-mvp"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-50"
            >
              빠른 발주안
            </Link>
            <Link
              href="/china-orders"
              className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700"
            >
              원가계산 참고화면
            </Link>
          </div>
        }
      />

      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-950">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <strong className="block text-base">Ops Center Native 중국 주문 흐름</strong>
            <p className="mt-1 leading-6">
              내부 발주 Draft의 RESERVED 수량을 직접 열어 B-code·옵션·1688 링크를 재사용하고 위안단가·중국내 운임을 입력합니다. 실제 1688 주문 후에만 ORDERED로 기록하며 이 화면 자체가 외부 주문·결제를 실행하지 않습니다.
            </p>
          </div>
          <span className="rounded-full border border-emerald-300 bg-white px-3 py-1 text-xs font-black text-emerald-800">
            GPT Site 운영경로 제거 · 실제 재고·가격 쓰기 차단
          </span>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatusCard label="발주 줄" value={number.format(ledger.totalCommitments)} note="고유 source line" />
        <StatusCard label="진행 중" value={number.format(ledger.activeCommitments)} note="미입고 잔량 보유" />
        <StatusCard label="총 주문수량" value={number.format(ledger.totalOrderedQuantity || ledger.totalRequestedQuantity)} note="실주문 우선" />
        <StatusCard label="정상입고" value={number.format(ledger.totalReceivedQuantity)} note="누적 입고수량" />
        <StatusCard label="남은 미입고" value={number.format(ledger.totalOpenQuantity)} note="다음 발주안 차감" emphasized />
      </section>

      <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <span className="text-xs font-black tracking-[0.12em] text-blue-700">FAST PURCHASE → INTERNAL CHINA ORDER</span>
            <h2 className="mt-1 text-lg font-black text-slate-950">활성 내부 발주 Draft</h2>
            <p className="mt-1 text-sm text-slate-600">
              여기서 바로 중국 주문초안을 열면 외부 Site 중계 없이 Ops Center 내부 주문 준비 화면으로 이동합니다.
            </p>
          </div>
          <strong className="text-sm text-blue-800">
            {activeDrafts.length}건 · 미입고 {number.format(
              activeDrafts.reduce((sum, draft) => sum + draft.openQuantity, 0),
            )}개
          </strong>
        </div>
        <div className="mt-4 space-y-2">
          {activeDrafts.length ? (
            activeDrafts.slice(0, 10).map((draft) => (
              <div
                key={draft.draftId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-white px-4 py-3"
              >
                <div>
                  <strong className="font-mono text-xs text-slate-950">{draft.draftId}</strong>
                  <p className="mt-1 text-xs text-slate-500">
                    {draft.lineCount} SKU · 미입고 {number.format(draft.openQuantity)}개 · 실주문 기록 {number.format(draft.orderedQuantity)}개 · {new Date(draft.updatedAt).toLocaleString("ko-KR")}
                  </p>
                </div>
                <Link
                  href={`/china-order-manager/drafts/${encodeURIComponent(draft.draftId)}`}
                  className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-black text-white hover:bg-blue-800"
                >
                  Ops Center 중국 주문초안 열기
                </Link>
              </div>
            ))
          ) : (
            <p className="rounded-xl border border-blue-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
              현재 열려 있는 내부 발주 Draft가 없습니다. 빠른 발주안에서 부족·품절 수량을 저장하면 여기에 나타납니다.
            </p>
          )}
        </div>
      </section>

      {ledger.error || status.error || internalDraftState.error ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          <strong>운영원장 조회 안내</strong>
          <p className="mt-2 break-words">{ledger.error || status.error || internalDraftState.error}</p>
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-950">발주·입고 약정 원장</h2>
            <p className="mt-1 text-sm text-slate-500">
              이벤트 중복 {number.format(ledger.duplicateEventCount)}건 · 형식 제외 {number.format(ledger.invalidEventCount)}건
            </p>
          </div>
          <p className="text-xs text-slate-500">
            최근 관련 운영작업 {number.format(status.operationCount)}건
          </p>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[1100px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-3">바코드 / 원본 줄</th>
                <th className="px-3 py-3">상태</th>
                <th className="px-3 py-3 text-right">요청</th>
                <th className="px-3 py-3 text-right">실주문</th>
                <th className="px-3 py-3 text-right">정상입고</th>
                <th className="px-3 py-3 text-right">취소·해제</th>
                <th className="px-3 py-3 text-right">남은 미입고</th>
                <th className="px-3 py-3">최근 갱신</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {commitments.length ? (
                commitments.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-4">
                      <strong className="font-mono text-slate-950">{row.barcode}</strong>
                      <span className="mt-1 block max-w-xs truncate text-xs text-slate-500">
                        {row.sourceSystem} · {row.sourceLineId}
                      </span>
                    </td>
                    <td className="px-3 py-4">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${statusTone(row.status)}`}>
                        {statusLabel(row.status)}
                      </span>
                    </td>
                    <td className="px-3 py-4 text-right font-semibold">{number.format(row.requestedQuantity)}</td>
                    <td className="px-3 py-4 text-right font-semibold">{number.format(row.orderedQuantity)}</td>
                    <td className="px-3 py-4 text-right font-semibold">{number.format(row.receivedQuantity)}</td>
                    <td className="px-3 py-4 text-right font-semibold">{number.format(row.cancelledQuantity)}</td>
                    <td className="px-3 py-4 text-right font-black text-blue-700">{number.format(row.openQuantity)}</td>
                    <td className="px-3 py-4 text-xs text-slate-500">{new Date(row.updatedAt).toLocaleString("ko-KR")}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-slate-500">
                    아직 Ops Center 원장으로 들어온 중국 주문·입고 이벤트가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <ActionCard title="빠른 발주안" description="판매·추정재고·미입고 약정을 반영해 이번 주문 필요량을 만들고 내부 RESERVED Draft로 고정합니다." href="/fast-purchase-mvp" action="빠른 발주안 열기" state="사용 가능" />
        <ActionCard title="운영 안전센터" description="입고확정 이벤트, 실패·재시도, 가격분석 후속 연동과 불확실 상태를 확인합니다." href="/operations" action="운영 이력 보기" state="읽기 전용" />
        <ActionCard title="원가계산 참고화면" description="기존 Ops Center 초기 원가계산 화면입니다. 실제 운영 발주는 위 활성 내부 Draft에서 직접 여세요." href="/china-orders" action="원가계산 참고" state="보조 화면" />
      </section>
    </div>
  );
}

function StatusCard({ label, value, note, emphasized = false }: { label: string; value: string; note: string; emphasized?: boolean }) {
  return (
    <article className={`rounded-2xl border bg-white p-5 shadow-sm ${emphasized ? "border-blue-200" : "border-slate-200"}`}>
      <p className="text-sm font-semibold text-slate-500">{label}</p>
      <strong className={`mt-2 block text-2xl font-black ${emphasized ? "text-blue-700" : "text-slate-950"}`}>{value}</strong>
      <p className="mt-2 text-xs text-slate-500">{note}</p>
    </article>
  );
}

function ActionCard({ title, description, href, action, state }: { title: string; description: string; href: string; action: string; state: string }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{state}</span>
      <h2 className="mt-4 text-lg font-black text-slate-950">{title}</h2>
      <p className="mt-2 min-h-16 text-sm leading-6 text-slate-600">{description}</p>
      <Link href={href} className="mt-5 inline-flex rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50">{action}</Link>
    </article>
  );
}
