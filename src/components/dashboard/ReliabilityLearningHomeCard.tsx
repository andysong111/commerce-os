import Link from "next/link";

export function ReliabilityLearningHomeCard() {
  return (
    <section className="mb-6 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-blue-50 p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-black text-white">
              운영 중
            </span>
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-700">
              Reliability & Learning
            </span>
          </div>
          <h2 className="mt-3 text-xl font-black text-slate-950">
            Commerce OS 통합 신뢰성·자기개선 코어
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Commerce OS와 AI-Saurus 실행 결과를 자동 흡수해 반복 오류를 사건·학습 후보·회귀 테스트·안전한 복구 작업으로 전환합니다.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold">
            <span className="rounded-full bg-white px-2.5 py-1 text-slate-600 ring-1 ring-slate-200">
              AI-Saurus 자동 수집
            </span>
            <span className="rounded-full bg-white px-2.5 py-1 text-slate-600 ring-1 ring-slate-200">
              반복 오류 학습
            </span>
            <span className="rounded-full bg-white px-2.5 py-1 text-slate-600 ring-1 ring-slate-200">
              회귀방지 자산화
            </span>
            <span className="rounded-full bg-white px-2.5 py-1 text-slate-600 ring-1 ring-slate-200">
              고위험 자동수정 차단
            </span>
          </div>
        </div>
        <Link
          href="/reliability"
          className="shrink-0 rounded-xl bg-slate-950 px-4 py-3 text-center text-sm font-black text-white shadow-sm transition hover:bg-emerald-700"
        >
          자기개선 통제실 열기
        </Link>
      </div>
    </section>
  );
}
