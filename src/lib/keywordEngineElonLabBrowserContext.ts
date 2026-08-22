import { validate1688Url } from "@/lib/keywordEngineElonLabV2";

export const KEYWORD_ELON_BROWSER_WINDOW_CONTEXT_PREFIX =
  "commerce-os-1688-context:";

function encodeBase64Utf8(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

export function buildKeywordElonBrowserWindowName(
  raw1688Url: string,
  returnUrl: string,
) {
  if (!validate1688Url(raw1688Url)) {
    throw new Error("1688.com 상품 링크를 입력해 주세요.");
  }
  return `${KEYWORD_ELON_BROWSER_WINDOW_CONTEXT_PREFIX}${encodeBase64Utf8({
    mode: "keyword_collect",
    returnUrl,
    sourceUrl: raw1688Url,
    requestedAt: new Date().toISOString(),
  })}`;
}
