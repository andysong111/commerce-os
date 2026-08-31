import Link from "next/link";
import { loadProductLifecycleDashboard } from "@/lib/productLifecycleEngine";

export const dynamic = "force-dynamic";

const STATE_LABELS: Record<string, string> = {
  TEST: "신규 테스트",
  EXPAND: "확대",
  MAINTAIN: "유지",
  REDUCE: "축소",
  DORMANT: "휴면",
  RETEST: "재시험",
  DISCONTINUE: "단종",
};

const SHOPLING_LABELS: Record<string, string> = {
  SELLING: "판매중",
  SOLD_OUT: "품절",
  DELETE: "삭제",
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function reasons(value: unknown) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function date(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed)
    ? new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(parsed))
    : "-";
}

export default async function ProductLifecyclePage() {
  let dashboard: Awaited<ReturnType<typeof loadProductLifecycleDashboard>> = {
    states: [],
    queue: [],
  };
  let error: string | null = null;
  try {
    dashboard = await loadProductLifecycleDashboard();
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "생애주기 데이터를 불러오지 못했습니다.";
  }

  const counts = new Map<string, number>();
  for (const row of dashboard.states) {
    const state = text(row.lifecycle_state);
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  const exceptions = dashboard.states.filter((row) => Boolean(row.requires_review));
  const queueExceptions = dashboard.queue.filter((row) =>
    ["failed", "confirm_needed"].includes(text(row.status)),
  );
  const shadowQueue = dashboard.queue.filter((row) => text(row.status) === "shadow");
  const operationalQueue = dashboard.queue.filter((row) =>
    ["pending", "claimed"].includes(text(row.status)),
  );
  const evaluatedAt = dashboard.states
    .map((row) => Date.parse(text(row.evaluated_at)))
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0];

  return (
    <main className="mx-auto min-h-screen max-w-[1500px] space-y-6 px-5 py-8 text-slate-900">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Commerce OS · Product Lifecycle
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight">
              상품 생애주기 · 슬롯 최적화
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              상품등급을 별도 관리하지 않고 판매실적·마지막 판매일·재고를 이용해
              테스트/확대/유지/축소/휴면/재시험/단종을 결정합니다. 정상 건은 자동 흐름으로 보내고
              이 화면에서는 예외만 우선 확인합니다.
            </p>
          </div>
          <div className="flex gap-2 text-sm">
            <Link
              href="/product-decision-agent"
              className="rounded-xl border border-slate-200 px-4 py-2 font-semibold hover:bg-slate-50"
            >
              발주권장 보기
            </Link>
            <Link
              href="/"
              className="rounded-xl border border-slate-200 px-4 py-2 font-semibold hover:bg-slate-50"
            >
              OPS 홈
            </Link>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {Object.entries(STATE_LABELS).map(([key, label]) => (
            <div key={key} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold text-slate-500">{label}</div>
              <div className="mt-1 text-2xl font-black">{counts.get(key) ?? 0}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-500">
          <span>마지막 평가: {Number.isFinite(evaluatedAt) ? date(evaluatedAt) : "아직 없음"}</span>
          <span>상품 {dashboard.states.length.toLocaleString("ko-KR")}개</span>
          <span>CEO 확인 필요 {exceptions.length + queueExceptions.length}건</span>
          <span>Shopling Shadow 작업 {shadowQueue.length}건</span>
          <span>실행 대기 {operationalQueue.length}건</span>
        </div>
      </section>

      {error ? (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">
          {error}
        </section>
      ) : null}

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-black">예외 처리함</h2>
            <p className="mt-1 text-sm text-slate-500">
              정상 상품은 보지 않습니다. 재고 불확실·데이터 검토·Shopling 실패만 이곳에 남깁니다.
            </p>
          </div>
          <div className="text-sm font-bold">
            {exceptions.length + queueExceptions.length}건
          </div>
        </div>

        {exceptions.length + queueExceptions.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
            현재 사람이 처리해야 할 예외가 없습니다.
          </div>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-3">Barcode / Goods key</th>
                  <th className="px-3 py-3">구분</th>
                  <th className="px-3 py-3">상태</th>
                  <th className="px-3 py-3">사유</th>
                  <th className="px-3 py-3">갱신</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {exceptions.slice(0, 100).map((row) => (
                  <tr key={`state-${text(row.sku_id)}`}>
                    <td className="px-3 py-3 font-mono text-xs">{text(row.barcode)}</td>
                    <td className="px-3 py-3">상품 판단</td>
                    <td className="px-3 py-3 font-semibold">
                      {STATE_LABELS[text(row.lifecycle_state)] ?? text(row.lifecycle_state)}
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {text(row.review_reason) || reasons(row.reason_codes).join(", ") || "확인 필요"}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-500">{date(row.evaluated_at)}</td>
                  </tr>
                ))}
                {queueExceptions.slice(0, 100).map((row) => (
                  <tr key={`queue-${text(row.id)}`}>
                    <td className="px-3 py-3 font-mono text-xs">
                      {text(row.barcode)} / {text(row.goods_key)}
                    </td>
                    <td className="px-3 py-3">Shopling 실행</td>
                    <td className="px-3 py-3 font-semibold">{text(row.status)}</td>
                    <td className="px-3 py-3 text-slate-600">
                      {text(row.last_error) || reasons(row.reason_codes).join(", ") || "확인 필요"}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-500">{date(row.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-black">Shopling 상태 작업 목록</h2>
            <p className="mt-1 text-sm text-slate-500">
              생애주기 산출값이 판매중/품절/삭제 작업으로 변환된 목록입니다. Shadow 상태는 실제 Shopling에 적용되지 않습니다.
            </p>
          </div>
          <div className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">
            Shadow 기본값
          </div>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-3">Goods key</th>
                <th className="px-3 py-3">Barcode</th>
                <th className="px-3 py-3">생애주기</th>
                <th className="px-3 py-3">Shopling 목표</th>
                <th className="px-3 py-3">실행상태</th>
                <th className="px-3 py-3">예정/갱신</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dashboard.queue.slice(0, 200).map((row) => (
                <tr key={text(row.id)}>
                  <td className="px-3 py-3 font-mono text-xs">{text(row.goods_key)}</td>
                  <td className="px-3 py-3 font-mono text-xs">{text(row.barcode)}</td>
                  <td className="px-3 py-3 font-semibold">
                    {STATE_LABELS[text(row.lifecycle_state)] ?? text(row.lifecycle_state)}
                  </td>
                  <td className="px-3 py-3 font-semibold">
                    {SHOPLING_LABELS[text(row.desired_state)] ?? text(row.desired_state)}
                  </td>
                  <td className="px-3 py-3">{text(row.status)}</td>
                  <td className="px-3 py-3 text-xs text-slate-500">{date(row.scheduled_for)}</td>
                </tr>
              ))}
              {dashboard.queue.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                    아직 생성된 Shopling 상태 작업이 없습니다.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-bold text-slate-500">발주 연결</div>
          <div className="mt-2 text-lg font-black">휴면·단종 → 재발주 STOP</div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Shadow에서는 예상 영향만 계산하고, 운영모드 전환 후에만 발주권장 수량을 0으로 덮어씁니다.
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-bold text-slate-500">가격 연결</div>
          <div className="mt-2 text-lg font-black">상품등급 가격조정 미사용</div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            가격은 기존 확정원가 기반 마진방어·원가하락 인하 흐름만 사용합니다.
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-bold text-slate-500">단종 안전선</div>
          <div className="mt-2 text-lg font-black">365일 + 재고검증</div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            365일 무판매라도 재고가 검증되지 않으면 삭제하지 않고 예외 처리함으로 보냅니다.
          </p>
        </div>
      </section>
    </main>
  );
}
