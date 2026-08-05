import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { runShoplingOrderNetworkDiagnostic } from "@/lib/shopling/shoplingNetworkDiagnostic";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

function value(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

export default async function ShoplingNetworkDiagnosticPage() {
  const result = await runShoplingOrderNetworkDiagnostic().catch((error) => ({
    checkedAt: new Date().toISOString(),
    resource: "orders" as const,
    host: "configuration",
    ok: false,
    elapsedMs: 0,
    httpStatus: null,
    responseType: null,
    error: {
      name: error instanceof Error ? error.name : "Error",
      code: "DIAGNOSTIC_SETUP_FAILED",
      message:
        error instanceof Error
          ? error.message
          : "Shopling 진단 설정을 읽지 못했습니다.",
      errno: null,
      syscall: null,
      hostname: null,
      address: null,
      port: null,
    },
    notice:
      "진단 준비 단계에서 중단됐습니다. 인증값과 요청·응답 원문은 표시하지 않았습니다.",
  }));

  const rows = [
    ["상태", result.ok ? "연결 성공" : "연결 실패"],
    ["확인 시각", new Date(result.checkedAt).toLocaleString("ko-KR")],
    ["대상 호스트", result.host],
    ["소요 시간", `${result.elapsedMs.toLocaleString("ko-KR")}ms`],
    ["HTTP 상태", value(result.httpStatus)],
    ["응답 형식", value(result.responseType)],
    ["오류 이름", value(result.error?.name)],
    ["오류 코드", value(result.error?.code)],
    ["오류 내용", value(result.error?.message)],
    ["시스템 오류", value(result.error?.errno)],
    ["시스템 호출", value(result.error?.syscall)],
    ["오류 호스트", value(result.error?.hostname)],
    ["주소", value(result.error?.address)],
    ["포트", value(result.error?.port)],
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · 읽기 전용 연결 진단"
        title="Shopling 주문 조회 네트워크 진단"
        description="Vercel에서 Shopling 주문 조회 API로 1일 범위 읽기 요청을 한 번 보내 DNS·TLS·연결·시간초과 상태만 확인합니다."
        actions={
          <Link
            href="/product-decision-agent/live-refresh"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            실시간 발주 계산으로 돌아가기
          </Link>
        }
      />

      <section
        className={`rounded-2xl border p-5 text-sm ${
          result.ok
            ? "border-emerald-200 bg-emerald-50 text-emerald-950"
            : "border-rose-200 bg-rose-50 text-rose-950"
        }`}
      >
        <strong className="block text-base">
          {result.ok ? "Shopling 호스트 연결 성공" : "Shopling 호스트 연결 실패"}
        </strong>
        <p className="mt-2 leading-6">{result.notice}</p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map(([label, rowValue]) => (
            <article key={label} className="rounded-xl bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                {label}
              </p>
              <p className="mt-2 break-all text-sm font-semibold text-slate-950">
                {rowValue}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-xs leading-5 text-amber-900">
        이 진단은 Shopling 상품·가격·주문상태를 변경하지 않습니다. 인증값,
        요청 XML, 주문 응답 원문은 화면·로그·데이터베이스에 남기지 않습니다.
      </section>
    </div>
  );
}
