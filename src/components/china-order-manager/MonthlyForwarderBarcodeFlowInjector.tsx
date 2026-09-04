"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Summary = {
  ok: boolean;
  lineCount: number;
  orderCount: number;
  totalQuantity: number;
};

export function MonthlyForwarderBarcodeFlowInjector() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const month = searchParams.get("month") || new Date().toISOString().slice(0, 7);
  const [mountNode, setMountNode] = useState<HTMLElement | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    if (pathname !== "/china-order-manager") {
      setMountNode(null);
      return;
    }

    let disposed = false;
    const attach = () => {
      if (disposed) return true;
      const headings = Array.from(document.querySelectorAll("h2"));
      const heading = headings.find((node) => node.textContent?.trim() === "월 처리 단계");
      const aside = heading?.closest("aside");
      if (!aside) return false;
      const stepContainer = Array.from(aside.querySelectorAll("div")).find((node) =>
        node.className.includes("space-y-3"),
      );
      if (!stepContainer) return false;

      let mount = stepContainer.querySelector<HTMLElement>("[data-monthly-forwarder-barcode-step]");
      if (!mount) {
        mount = document.createElement("div");
        mount.dataset.monthlyForwarderBarcodeStep = "true";
        const nativeSteps = Array.from(stepContainer.children);
        const thirdStep = nativeSteps[2] ?? null;
        stepContainer.insertBefore(mount, thirdStep);
      }
      setMountNode(mount);
      return true;
    };

    if (!attach()) {
      const observer = new MutationObserver(() => {
        if (attach()) observer.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      const timer = window.setTimeout(() => observer.disconnect(), 5000);
      return () => {
        disposed = true;
        window.clearTimeout(timer);
        observer.disconnect();
      };
    }

    return () => {
      disposed = true;
    };
  }, [pathname]);

  useEffect(() => {
    if (pathname !== "/china-order-manager") return;
    let cancelled = false;
    fetch(`/api/freight-barcode-request/monthly-orders?month=${encodeURIComponent(month)}`, {
      cache: "no-store",
    })
      .then((response) => response.json())
      .then((value: Summary) => {
        if (!cancelled) setSummary(value);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [month, pathname]);

  if (!mountNode || pathname !== "/china-order-manager") return null;

  const ready = Boolean(summary?.ok && summary.lineCount > 0);
  const card = (
    <div
      className={`rounded-xl border p-3 ${
        ready
          ? "border-cyan-400/40 bg-cyan-400/10"
          : "border-slate-700 bg-slate-900"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-xs font-black ${
            ready ? "bg-cyan-400 text-slate-950" : "bg-slate-700 text-slate-200"
          }`}
        >
          BARCODE
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-black text-white">배송대행지 바코드 출력</div>
          <div className="mt-1 text-xs leading-5 text-slate-300">
            {ready
              ? `${summary?.lineCount ?? 0}개 주문품목 · ${summary?.orderCount ?? 0}건 주문번호 자동연동 준비`
              : "1688 실주문 완료 후 해당 월 주문정보를 연결합니다."}
          </div>
          <Link
            href={`/freight-barcode-request/monthly?month=${encodeURIComponent(month)}`}
            className="mt-3 inline-flex rounded-lg bg-cyan-400 px-3 py-2 text-xs font-black text-slate-950 hover:bg-cyan-300"
          >
            바코드 출력으로 이동
          </Link>
        </div>
      </div>
    </div>
  );

  return createPortal(card, mountNode);
}
