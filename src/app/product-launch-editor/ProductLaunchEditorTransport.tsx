"use client";

import { useEffect, useState, type ReactNode } from "react";

const EDITOR_API = "/api/product-launch-tracker/normalized-optimized";
const AUTHORITATIVE_LEGACY_API = "/api/product-launch-tracker/optimized";
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
      const url = requestUrl(input);
      if (!url || url.pathname !== EDITOR_API) return originalFetch(input, init);

      const method = String(
        init?.method || (input instanceof Request ? input.method : "GET"),
      ).toUpperCase();
      const targetApi = method === "PATCH" || directReadback
        ? DIRECT_ITEM_API
        : AUTHORITATIVE_LEGACY_API;
      const routed = routeEditorRequest(input, url, targetApi);
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

function requestUrl(input: RequestInfo | URL) {
  try {
    if (typeof input === "string") return new URL(input, window.location.origin);
    if (input instanceof URL) return new URL(input.toString());
    if (input instanceof Request) return new URL(input.url);
  } catch {
    return null;
  }
  return null;
}

function routeEditorRequest(
  input: RequestInfo | URL,
  url: URL,
  targetPath: string,
): RequestInfo | URL {
  const nextUrl = new URL(url.toString());
  nextUrl.pathname = targetPath;
  if (input instanceof Request) return new Request(nextUrl, input);
  if (input instanceof URL) return nextUrl;
  return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
}
