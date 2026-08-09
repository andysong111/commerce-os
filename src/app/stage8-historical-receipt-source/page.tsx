import {
  historicalReceiptSourceConfigured,
  loadHistoricalReceiptSourceReadiness,
} from "@/lib/historicalReceiptSourceReadiness";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HistoricalReceiptSourcePage() {
  const configured = historicalReceiptSourceConfigured();
  const report = configured
    ? await loadHistoricalReceiptSourceReadiness().catch((error) => ({
        configured: true,
        reachable: false,
        sourceMode: null,
        receiptRows: 0,
        hasMore: false,
        hasNextSince: false,
        sourceWritesEnabled: false as const,
        statusCode: 0,
        message: error instanceof Error ? error.message : "UNKNOWN_ERROR",
      }))
    : null;

  return (
    <main className="mx-auto max-w-4xl space-y-5 p-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-black tracking-[0.16em] text-emerald-700">
          COMMERCE OS · STAGE 8 · RECEIPT COST SOURCE
        </p>
        <h1 className="mt-2 text-2xl font-black text-slate-950">
          과거 확정입고 원가 소스 연결
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          기존 중국 발주 시스템의 인증된 확정입고 원가 endpoint를 서버에서 읽기 전용으로 확인합니다. 비밀값과 입고 상세 payload는 화면에 노출하지 않으며 어떤 원장도 수정하지 않습니다.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="설정" value={configured ? "READY" : "MISSING"} />
        <Metric label="연결" value={report?.reachable ? "READY" : "BLOCKED"} />
        <Metric label="소스" value={report?.sourceMode ?? "-"} />
        <Metric label="실제 쓰기" value="0 · READ ONLY" />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <Row label="HTTP" value={String(report?.statusCode ?? 0)} />
          <Row label="샘플 입고행" value={String(report?.receiptRows ?? 0)} />
          <Row label="다음 페이지" value={report?.hasMore ? "있음" : "없음"} />
          <Row label="cursor" value={report?.hasNextSince ? "있음" : "없음"} />
        </dl>
        <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
          {report?.message ?? "연동 환경변수가 설정되지 않았습니다."}
        </p>
      </section>
    </main>
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-100 px-3 py-2">
      <dt className="font-semibold text-slate-500">{label}</dt>
      <dd className="font-bold text-slate-900">{value}</dd>
    </div>
  );
}
