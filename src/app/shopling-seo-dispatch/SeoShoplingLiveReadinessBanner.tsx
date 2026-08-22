"use client";

import { useEffect, useState } from "react";

type Readiness = {
  ready: boolean;
  configured: string[];
  missing: string[];
};

export default function SeoShoplingLiveReadinessBanner() {
  const [state, setState] = useState<Readiness | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/seo-title-dispatch/live-register", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then((response) => response.json())
      .then((body) => {
        if (cancelled || body?.ok !== true) return;
        setState({
          ready: body.ready === true,
          configured: Array.isArray(body.configured) ? body.configured.map(String) : [],
          missing: Array.isArray(body.missing) ? body.missing.map(String) : [],
        });
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!state) return null;
  return (
    <div
      className={`mx-auto mt-6 max-w-[1600px] rounded-2xl border px-5 py-4 text-sm font-bold ${
        state.ready
          ? "border-emerald-200 bg-emerald-50 text-emerald-950"
          : "border-rose-200 bg-rose-50 text-rose-950"
      }`}
    >
      {state.ready ? (
        <>실제등록 연결 준비 완료 · 신규상품 6개 등록 → SEO 상품명 29개·공통 검색어 10개 반영 → 서버 후처리까지 사용할 수 있습니다.</>
      ) : (
        <>
          실제등록 연결 미완료 · 미설정 항목: <span className="font-mono">{state.missing.join(", ")}</span>. 외부 쓰기는 시작 전에 차단됩니다.
        </>
      )}
    </div>
  );
}
