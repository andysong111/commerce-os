"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export const SHOPLING_PRICE_ADJUSTMENT_API_PREFIX =
  "/api/shopling-price-adjustment/";
export const SHOPLING_PRICE_ADJUSTMENT_AUTH_REQUIRED_EVENT =
  "shopling-price-adjustment-auth-required";

export function resolveShoplingPriceAdjustmentApiUrl(
  input: string,
  origin: string,
) {
  const target = new URL(input, origin);
  if (
    target.origin !== origin ||
    !target.pathname.startsWith(SHOPLING_PRICE_ADJUSTMENT_API_PREFIX)
  ) {
    throw new Error("허용되지 않은 샵플링 가격 API 주소입니다.");
  }
  return target.toString();
}

export async function requestShoplingPriceAdjustmentApi(
  input: string,
  init: RequestInit = {},
) {
  if (typeof window === "undefined") {
    throw new Error("샵플링 가격 API는 브라우저에서만 호출할 수 있습니다.");
  }

  const target = resolveShoplingPriceAdjustmentApiUrl(
    input,
    window.location.origin,
  );
  const headers = new Headers(init.headers);
  const supabase = await createSupabaseBrowserClient();
  if (supabase) {
    const { data, error } = await supabase.auth.getSession();
    if (!error && data.session?.access_token) {
      headers.set(
        "authorization",
        `Bearer ${data.session.access_token}`,
      );
    }
  }

  const response = await fetch(target, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: init.cache ?? "no-store",
    redirect: "error",
  });
  if (response.status === 401) {
    window.dispatchEvent(
      new CustomEvent(SHOPLING_PRICE_ADJUSTMENT_AUTH_REQUIRED_EVENT),
    );
  }
  return response;
}
