"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-950">
      <h2 className="text-lg font-black">빠른 발주안을 불러오지 못했습니다.</h2>
      <p className="mt-2 text-sm leading-6">
        이 상태에서는 0개를 실제 재고 0으로 해석하지 않습니다. 잠시 뒤 다시 불러오거나 기존 발주 추천 화면을 사용하세요.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-lg bg-rose-800 px-3 py-2 text-sm font-bold text-white"
      >
        다시 불러오기
      </button>
    </div>
  );
}
