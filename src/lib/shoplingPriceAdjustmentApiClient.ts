"use client";

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
  verifiedAccessToken: string | null = null,
) {
  if (typeof window === "undefined") {
    throw new Error("샵플링 가격 API는 브라우저에서만 호출할 수 있습니다.");
  }

  const target = resolveShoplingPriceAdjustmentApiUrl(
    input,
    window.location.origin,
  );
  const headers = new Headers(init.headers);
  if (verifiedAccessToken) {
    headers.set("authorization", `Bearer ${verifiedAccessToken}`);
  } else {
    headers.delete("authorization");
  }

  // The token is verified by the server before it is rendered into this
  // protected, non-cached page and is kept only in React memory. The API still
  // falls back to the canonical cookie, so an expired token cannot override a
  // valid refreshed session.
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
