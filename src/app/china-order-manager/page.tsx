import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadChinaOrderLedger } from "@/lib/chinaOrderLedger";
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
  const [status, ledger] = await Promise.all([
    loadChinaOrderInternalStatus(),
    loadChinaOrderLedger(),
  ]);
  const commitments = ledger.commitments.slice(0, 100);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · 중국 발주·입고 내부 이전"
        title="중국 발주·입고 관리"
        description="주문초안·실주문·부분입고·정상입고·파손·누락을 불변 이벤트로 기록하고, 발주 추천이 차감할 미입고 수량을 자동 계산합니다. 실제 재고 증가와 가격변경은 별도 승인 전까지 차단합니다."
        actions={
          <Link
            href="/china-orders"
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700"
          >
            내부 원가계산 열기
          </Link>
        }
      />

      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-950">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <strong className="block text-base">중국 주문·입고 이벤트 원장 연결</strong>
            <p className="mt-1 leading-6">
              같은 sourceEventId는 한 번만 저장합니다. 입고수량과 취소·파손·누락 해제수량을 누적해 남은 미입고 수량만 발주 추천에 제공합니다.
            </p>
          </div>
          <span className="rounded-full border border-emerald-300 bg-white px-3 py-1 text-xs font-black text-emerald-800">
            실제 재고·가격 쓰기 차단
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

      {ledger.error || status.error ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          <strong>운영원장 조회 안내</strong>
          <p className="mt-2 break-words">{ledger.error || status.error}</p>
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
                    아직 Ops Center 원장으로 들어온 중국 주문·입고 이벤트가 없습니다. 기존 Site 연동 이벤트부터 순차 이전합니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <ActionCard title="중국주문 원가계산" description="상품마스터의 모델·옵션을 연결하고 중국내 운임과 환율을 배분해 옵션별 최종 원가를 계산합니다." href="/china-orders" action="원가계산 열기" state="사용 가능" />
        <ActionCard title="운영 안전센터" description="입고확정 이벤트, 실패·재시도, 가격분석 후속 연동과 불확실 상태를 확인합니다." href="/operations" action="운영 이력 보기" state="읽기 전용" />
        <ActionCard title="발주 추천" description="현재 원장의 남은 미입고 수량이 다음 발주안에서 중복 차감되는지 확인합니다." href="/product-decision-agent" action="발주 추천 보기" state="자체 엔진 연결 중" />
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
