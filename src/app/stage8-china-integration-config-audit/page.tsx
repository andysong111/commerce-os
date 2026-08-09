import { PageHeader } from "@/components/PageHeader";
import { loadChinaIntegrationConfigAudit } from "@/lib/stage8ChinaIntegrationConfigAudit";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

export default async function ChinaIntegrationConfigAuditPage() {
  const report = await loadChinaIntegrationConfigAudit();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · CHINA INTEGRATION CONFIG AUDIT"
        title="중국 발주·입고 서버간 연동 설정 점검"
        description="Ops Center가 중국 발주·입고 관리에 어떤 base 유형과 integration-secret 이름을 사용하도록 구성되어 있는지 값 노출 없이 점검합니다. hostname과 설정 존재 여부만 표시하며 secret 값은 읽어 화면에 출력하지 않습니다."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="상태" value={report.state} />
        <Metric label="Base source" value={report.baseSource} />
        <Metric label="Base hostname" value={report.baseHostname} />
        <Metric label="Base override" value={report.baseOverrideConfigured ? "SET" : "NOT SET"} />
        <Metric label="Secret names set" value={String(report.configuredSecretCount)} />
        <Metric label="Source access" value={report.sourceAvailable ? "READY" : "BLOCKED"} />
      </section>

      <section className={`rounded-2xl border p-5 shadow-sm ${report.state === "CONFIG_READY_SOURCE_READY" ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-black tracking-[0.12em] text-slate-500">SERVER-TO-SERVER CONFIG · SECRET VALUES NEVER RENDERED</span>
            <h2 className="mt-1 text-2xl font-black text-slate-950">{report.state}</h2>
          </div>
          <strong className="rounded-full bg-slate-950 px-4 py-2 text-sm text-white">BUSINESS WRITE 0</strong>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-700">{report.message}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Info label="Protocol" value={report.baseProtocol} />
          <Info label="ChatGPT Site host" value={report.baseIsChatgptSite ? "YES" : "NO"} />
          <Info label="Receipt source state" value={report.sourceAuditState} />
          <Info label="Sanitized source error" value={report.sourceErrorCode ?? "-"} />
          <Info label="Filter contract" value={report.filterContractVerified ? "VERIFIED" : "NOT VERIFIED"} />
          <Info label="Next server action" value={report.serverToServerAction} />
          <Info label="Secret values exposed" value="NO" />
          <Info label="Business writes" value="0" />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">Integration secret 이름 존재 여부</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          값이나 길이·prefix는 표시하지 않습니다. 서버 환경에 해당 이름이 비어 있지 않은지만 확인합니다.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {report.secretPresence.map((row) => (
            <div key={row.name} className="rounded-xl border border-slate-200 p-4">
              <p className="break-all font-mono text-xs font-black text-slate-950">{row.name}</p>
              <p className={`mt-2 text-sm font-black ${row.configured ? "text-emerald-700" : "text-rose-700"}`}>
                {row.configured ? "CONFIGURED" : "NOT CONFIGURED"}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
        <strong>판정 기준</strong><br />
        `DEFAULT_CHATGPT_SITE_AUTH_BLOCKED`이면 Ops Center가 별도 base override 없이 ChatGPT Site 계열을 사용하고 있으며 서버간 receipt 조회가 인증 단계에서 막힌 상태입니다. 이 경우 secret을 계속 바꾸기 전에 Site 로그인 계층을 거치지 않는 서버간 endpoint 또는 별도 Access 경로를 정해야 합니다. `CONFIG_READY_SOURCE_BLOCKED`이면 base override는 존재할 수 있으므로 그때는 양쪽 integration secret 정합성을 먼저 확인합니다. 어느 경우에도 이 점검은 환경변수나 사업데이터를 수정하지 않습니다.
      </section>

      <p className="break-all text-xs text-slate-400">Fingerprint · {report.fingerprint}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong className="mt-1 block break-all text-sm text-slate-950">{value}</strong>
    </article>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/70 p-3">
      <p className="text-[11px] font-semibold text-slate-500">{label}</p>
      <p className="mt-1 break-all font-mono text-xs font-black text-slate-950">{value}</p>
    </div>
  );
}
