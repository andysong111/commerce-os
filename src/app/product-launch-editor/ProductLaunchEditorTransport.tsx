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
    let directReadback = false;

    const routedFetch: typeof window.fetch = async (input, init) => {
      const isEditorApiString =
        typeof input === "string" && input.startsWith(LEGACY_EDITOR_API);
      const isEditorApiUrl =
        input instanceof URL &&
        input.origin === window.location.origin &&
        input.pathname === LEGACY_EDITOR_API;
      if (!isEditorApiString && !isEditorApiUrl) return originalFetch(input, init);

      const method = String(init?.method || "GET").toUpperCase();
      if (method !== "PATCH" && !directReadback) {
        return originalFetch(input, init);
      }

      const routed =
        typeof input === "string"
          ? `${DIRECT_ITEM_API}${input.slice(LEGACY_EDITOR_API.length)}`
          : (() => {
              const next = new URL(input.toString());
              next.pathname = DIRECT_ITEM_API;
              return next;
            })();
      const response = await originalFetch(routed, init);
      if (method === "PATCH" && response.ok) directReadback = true;
      return response;
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
