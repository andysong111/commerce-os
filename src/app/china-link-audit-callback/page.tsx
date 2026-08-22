"use client";

import { useEffect, useState } from "react";

const AUDIT_RESULT_HASH_PARAMETER = "commerce_china_link_audit";
const MESSAGE_SOURCE = "commerce-os-china-link-audit-callback";

export default function ChinaLinkAuditCallbackPage() {
  const [message, setMessage] = useState("1688 검사결과를 전달하고 있습니다…");

  useEffect(() => {
    const encoded = new URLSearchParams(window.location.hash.replace(/^#/, "")).get(
      AUDIT_RESULT_HASH_PARAMETER,
    );
    if (!encoded) {
      setMessage("전달할 1688 검사결과가 없습니다. 검사 창을 다시 시작해 주세요.");
      return;
    }
    if (!window.opener || window.opener.closed) {
      setMessage("원래 상품출시 진행관리 창을 찾지 못했습니다. 이 창을 닫고 다시 시작해 주세요.");
      return;
    }

    window.opener.postMessage(
      {
        source: MESSAGE_SOURCE,
        type: "china-link-audit-result",
        encoded,
      },
      window.location.origin,
    );
    window.history.replaceState({}, document.title, window.location.pathname);
    setMessage("검사결과 전달 완료 · 다음 링크로 이동할 때까지 이 창을 닫지 마세요.");
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 px-6 text-white">
      <section className="w-full max-w-xl rounded-3xl border border-slate-700 bg-slate-900 p-8 text-center shadow-2xl">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-violet-300">
          COMMERCE OS · 1688 LINK AUDIT WORKER
        </p>
        <h1 className="mt-3 text-2xl font-black">고정링크 검사창</h1>
        <p className="mt-4 text-sm font-bold leading-7 text-slate-300">{message}</p>
      </section>
    </main>
  );
}
