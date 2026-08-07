import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadLatestProductMasterShoplingOrderProbe } from "@/lib/productMasterShoplingOrderProbe";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

function Metric({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string | number;
  danger?: boolean;
}) {
  return (
    <article
      className={`rounded-xl border bg-white p-4 ${
        danger ? "border-rose-200" : "border-slate-200"
      }`}
    >
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong
        className={`mt-1 block break-words text-lg ${
          danger ? "text-rose-700" : "text-slate-950"
        }`}
      >
        {typeof value === "number" ? number.format(value) : value}
      </strong>
    </article>
  );
}

function localTime(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Seoul",
  }).format(parsed);
}

export default async function ProductMasterShoplingOrderProbePage() {
  const result = await loadLatestProductMasterShoplingOrderProbe();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · SHOPLING READ-ONLY DIAGNOSTIC"
        title="Shopling 주문 응답구조 안전 진단"
        description="판매원장 수집이 실제 주문행을 0건으로 읽는 원인을 찾기 위한 읽기 전용 진단입니다. 원본 주문값·인증키는 저장하지 않고 HTTP 상태, 응답 크기, XML 태그명·개수와 파서가 확인한 필드명만 기록합니다."
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

      {!result ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
          아직 주문 응답구조 진단 증거가 없습니다. 24개월 판매원장이 여러 구간을 처리했는데도 원시 주문행이 0건이면 예약 Worker가 자동으로 안전 진단을 한 번 실행합니다.
        </section>
      ) : (
        <>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
                  NO RAW ORDERS STORED · NO BUSINESS WRITES
                </p>
                <h2 className="mt-2 text-xl font-black text-slate-950">
                  최근 진단 결과
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {result.safeMessage}
                </p>
              </div>
              <span
                className={`rounded-full border px-3 py-1 text-xs font-black ${
                  result.category === "SUCCESS_ROWS"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-amber-200 bg-amber-50 text-amber-900"
                }`}
              >
                {result.category}
              </span>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Metric label="진단 범위" value={`${result.startDate} ~ ${result.endDate}`} />
              <Metric label="HTTP" value={result.httpStatus ?? "없음"} />
              <Metric label="응답 바이트" value={result.responseBytes} />
              <Metric
                label="파서 주문행"
                value={result.parsedRowCount}
                danger={result.ok && result.parsedRowCount === 0}
              />
              <Metric label="실행시각" value={localTime(result.attemptedAt)} />
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric
                label="apiOrdGatherRst 태그"
                value={result.expectedContainerTagCount}
              />
              <Metric label="ordListRst 태그" value={result.expectedRowTagCount} />
              <Metric label="증거 저장" value={result.evidenceStored ? "완료" : "미저장"} />
              <Metric label="실제 쓰기" value="차단" />
            </div>
          </section>

          <section className="grid gap-5 xl:grid-cols-2">
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-black text-slate-950">응답 XML 태그 구조</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                값은 저장하지 않고 태그 이름과 등장 횟수만 표시합니다. 기존 파서가 기대하는 태그와 실제 구조가 다른지 확인하는 근거입니다.
              </p>
              <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
                {result.tagSummary.length ? (
                  result.tagSummary.map((tag) => (
                    <div
                      key={tag.name}
                      className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 text-sm last:border-b-0"
                    >
                      <code className="font-semibold text-slate-800">{tag.name}</code>
                      <strong className="text-slate-950">{number.format(tag.count)}</strong>
                    </div>
                  ))
                ) : (
                  <p className="p-4 text-sm text-slate-500">확인된 XML 태그가 없습니다.</p>
                )}
              </div>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-black text-slate-950">파서가 확인한 필드명</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                주문번호나 구매자정보 같은 실제 값은 표시·저장하지 않습니다. 파싱된 행이 있을 경우 키 이름만 보여줍니다.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {result.parsedFieldNames.length ? (
                  result.parsedFieldNames.map((field) => (
                    <code
                      key={field}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700"
                    >
                      {field}
                    </code>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">파싱된 주문행 필드가 없습니다.</p>
                )}
              </div>
            </article>
          </section>
        </>
      )}

      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm leading-6 text-emerald-950">
        이 진단은 Shopling 주문 API를 읽기만 합니다. Shopling 상품·옵션·가격·재고·주문·발주를 변경하지 않고, Product Master의 판매·재고·원가에도 쓰지 않습니다.
      </section>
    </div>
  );
}
