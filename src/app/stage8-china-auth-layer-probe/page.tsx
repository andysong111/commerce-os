import { PageHeader } from "@/components/PageHeader";
import { loadChinaAuthLayerProbe } from "@/lib/stage8ChinaAuthLayerProbe";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export default async function ChinaAuthLayerProbePage() {
  const report = await loadChinaAuthLayerProbe();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · CHINA AUTH LAYER PROBE"
        title="중국 서버간 인증계층 판별"
        description="실제 secret 대신 의도적으로 잘못된 Bearer 토큰 1개만 사용해, 요청이 ChatGPT Sites 로그인 계층에서 막히는지 앱의 integration-secret 검증까지 도달하는지 판별합니다. 응답 본문과 실제 secret은 화면에 표시하지 않습니다."
      />
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="상태" value={report.state} />
        <Metric label="Base hostname" value={report.baseHostname} />
        <Metric label="Base override" value={report.baseOverrideConfigured ? "SET" : "NOT SET"} />
        <Metric label="HTTP" value={report.httpStatus === null ? "-" : String(report.httpStatus)} />
        <Metric label="응답 종류" value={report.responseClass} />
        <Metric label="최종 hostname" value={report.finalHostname ?? "-"} />
      </section>
      <section className={`rounded-2xl border p-5 shadow-sm ${report.state === "APP_INTEGRATION_AUTH_REACHED" ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
        <span className="text-xs font-black tracking-[0.12em] text-slate-500">INVALID CREDENTIAL ONLY · GET ONLY · RESPONSE BODY HIDDEN</span>
        <h2 className="mt-1 text-2xl font-black text-slate-950">{report.state}</h2>
        <p className="mt-3 text-sm leading-6 text-slate-700">{report.message}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Info label="Platform sign-in detected" value={report.platformSignInDetected ? "YES" : "NO"} />
          <Info label="App integration auth reached" value={report.appIntegrationAuthDetected ? "YES" : "NO"} />
          <Info label="Real secret used" value="NO" />
          <Info label="Business writes" value="0" />
        </div>
      </section>
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
        <strong>판정 의미</strong><br />
        `CHATGPT_SITES_PLATFORM_GATE`이면 integration secret을 바꾸는 것으로는 해결되지 않습니다. 앱 코드보다 앞의 Sites 로그인 계층이 서버간 Bearer 요청을 막고 있으므로 별도의 서버간 endpoint/Access 경로가 필요합니다. `APP_INTEGRATION_AUTH_REACHED`이면 endpoint 자체는 서버간 접근 가능하므로 그때만 양쪽 secret 정합성을 점검합니다.
      </section>
      <p className="break-all text-xs text-slate-400">Fingerprint · {report.fingerprint}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <article className="rounded-xl border border-slate-200 bg-white p-4"><span className="text-xs font-semibold text-slate-500">{label}</span><strong className="mt-1 block break-all text-sm text-slate-950">{value}</strong></article>;
}
function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-white/70 p-3"><p className="text-[11px] font-semibold text-slate-500">{label}</p><p className="mt-1 font-mono text-xs font-black text-slate-950">{value}</p></div>;
}
