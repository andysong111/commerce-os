"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const RETRY_STORAGE_KEY = "opsCenter.dashboard.retry.v1";

type RetryPayload = {
  kind?: "keyword_engine" | "detail_page_engine";
  input?: Record<string, string | undefined>;
};

const FIELD_MAP: Record<string, string> = {
  goodsKey: "goods_key",
  seedKeyword: "seed_keyword",
  sourceLink: "source_link",
  productCode: "product_code",
};

export function OpsRetryPrefill() {
  const pathname = usePathname();
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (
      !["/keyword-engine-runner", "/detail-page-engine-runner"].includes(
        pathname,
      )
    ) {
      return;
    }

    let payload: RetryPayload | null = null;
    try {
      payload = JSON.parse(
        window.sessionStorage.getItem(RETRY_STORAGE_KEY) ?? "null",
      );
    } catch {
      payload = null;
    }

    const expectedKind =
      pathname === "/keyword-engine-runner"
        ? "keyword_engine"
        : "detail_page_engine";
    if (!payload || payload.kind !== expectedKind || !payload.input) return;

    let attempt = 0;
    const timer = window.setInterval(() => {
      attempt += 1;
      let restored = 0;

      for (const [sourceName, value] of Object.entries(payload?.input ?? {})) {
        if (!value) continue;
        const fieldName = FIELD_MAP[sourceName] ?? sourceName;
        const element = document.querySelector<
          HTMLInputElement | HTMLTextAreaElement
        >(`[name="${CSS.escape(fieldName)}"]`);
        if (!element) continue;

        setNativeValue(element, value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        restored += 1;
      }

      if (restored > 0 || attempt >= 20) {
        window.clearInterval(timer);
        window.sessionStorage.removeItem(RETRY_STORAGE_KEY);
        if (restored > 0) {
          setMessage(
            "실패 작업의 입력값을 복원했습니다. 입력값 확인 단계부터 다시 실행하세요.",
          );
          window.setTimeout(() => setMessage(""), 6000);
        }
      }
    }, 100);

    return () => window.clearInterval(timer);
  }, [pathname]);

  if (!message) return null;
  return (
    <div className="fixed right-4 top-4 z-50 max-w-sm rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900 shadow-lg">
      {message}
    </div>
  );
}

function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(element, value);
  else element.value = value;
}
