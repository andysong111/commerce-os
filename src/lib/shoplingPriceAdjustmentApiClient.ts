"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export const SHOPLING_PRICE_ADJUSTMENT_API_PREFIX =
  "/api/shopling-price-adjustment/";
export const SHOPLING_PRICE_ADJUSTMENT_AUTH_REQUIRED_EVENT =
  "shopling-price-adjustment-auth-required";

function browserAuthFailure(
  error: string,
  code: string,
  status: number,
) {
  if (status === 401) {
    window.dispatchEvent(
      new CustomEvent(SHOPLING_PRICE_ADJUSTMENT_AUTH_REQUIRED_EVENT),
    );
  }
  return new Response(
    JSON.stringify({
      error,
      message: error,
      code,
      stage: "price_adjustment.browser_auth",
    }),
    {
      status,
      headers: { "content-type": "application/json" },
    },
  );
}

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
  let supabase;
  try {
    supabase = await createSupabaseBrowserClient();
  } catch {
    return browserAuthFailure(
      "브라우저 로그인 설정을 초기화하지 못했습니다.",
      "PRICE_ADJUSTMENT_BROWSER_AUTH_CONFIGURATION_ERROR",
      503,
    );
  }
  if (!supabase) {
    return browserAuthFailure(
      "브라우저 로그인 설정을 불러오지 못했습니다.",
      "PRICE_ADJUSTMENT_BROWSER_AUTH_CONFIGURATION_ERROR",
      503,
    );
  }
  let sessionResult;
  try {
    sessionResult = await supabase.auth.getSession();
  } catch {
    return browserAuthFailure(
      "브라우저 로그인 세션을 확인하지 못했습니다.",
      "PRICE_ADJUSTMENT_BROWSER_SESSION_CHECK_FAILED",
      401,
    );
  }
  const { data, error } = sessionResult;
  if (error || !data.session?.access_token) {
    return browserAuthFailure(
      "로그인이 필요합니다.",
      "PRICE_ADJUSTMENT_AUTH_REQUIRED",
      401,
    );
  }
  headers.set(
    "authorization",
    `Bearer ${data.session.access_token}`,
  );

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
