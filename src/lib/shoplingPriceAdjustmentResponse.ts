export function shoplingPriceAdjustmentPrivateHeaders(
  init?: HeadersInit,
) {
  const headers = new Headers(init);
  headers.set("Cache-Control", "private, no-store");
  return headers;
}
