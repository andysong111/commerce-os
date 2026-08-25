"use client";

import { useEffect, useState, type ReactNode } from "react";

const LEGACY_EDITOR_API = "/api/product-launch-tracker/normalized-optimized";
const DIRECT_ITEM_API = "/api/product-launch-tracker/item-editor";

export default function ProductLaunchEditorTransport({
  children,
}: {
  children: ReactNode;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    const routedFetch: typeof window.fetch = (input, init) => {
      if (typeof input === "string" && input.startsWith(LEGACY_EDITOR_API)) {
        return originalFetch(
          `${DIRECT_ITEM_API}${input.slice(LEGACY_EDITOR_API.length)}`,
          init,
        );
      }
      if (input instanceof URL && input.origin === window.location.origin && input.pathname === LEGACY_EDITOR_API) {
        const routed = new URL(input.toString());
        routed.pathname = DIRECT_ITEM_API;
        return originalFetch(routed, init);
      }
      return originalFetch(input, init);
    };

    window.fetch = routedFetch;
    setReady(true);

    return () => {
      if (window.fetch === routedFetch) window.fetch = originalFetch;
    };
  }, []);

  if (!ready) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-12 text-sm font-semibold text-slate-500">
        상품 단건 편집기를 준비하고 있습니다.
      </main>
    );
  }

  return children;
}
