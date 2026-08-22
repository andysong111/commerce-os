import {
  parse1688OfferId,
  validate1688Url,
  type KeywordElonSourceDraft,
} from "@/lib/keywordEngineElonLabV2";

export const KEYWORD_ELON_BROWSER_IMPORT_PARAMETER =
  "commerce_os_keyword_lab_collect";
export const KEYWORD_ELON_BROWSER_RETURN_PARAMETER =
  "commerce_os_keyword_lab_return";
export const KEYWORD_ELON_BROWSER_HASH_PARAMETER = "commerce_keyword_import";
export const KEYWORD_ELON_BROWSER_CONTEXT_HASH_PARAMETER =
  "commerce_os_keyword_lab_context";
export const KEYWORD_ELON_BROWSER_LINK_ERROR_HASH_PARAMETER =
  "commerce_china_link_error";
export const KEYWORD_ELON_REQUIRED_COLLECTOR_VERSION = "0.1.2";

type BrowserOptionValue = {
  id?: unknown;
  source_name?: unknown;
};

type BrowserOptionGroup = {
  id?: unknown;
  source_name?: unknown;
  values?: unknown;
};

export type KeywordElonBrowserImportPayload = {
  schemaVersion: number;
  source: string;
  collectorVersion: string;
  sourceUrl: string;
  productId: string;
  productName: string;
  supplierOptionGroups: Array<{
    id: string;
    sourceName: string;
    values: Array<{ id: string; sourceName: string }>;
  }>;
  supplierOptions: string;
  sourceProductInfo: string;
  productAttributes: string;
  collectedAt: string;
};

export type KeywordElonBrowserLinkErrorPayload = {
  schemaVersion: number;
  source: string;
  collectorVersion: string;
  mode: "keyword_collect";
  sourceUrl: string;
  finalUrl: string;
  status: "link_error" | "temporary_error";
  errorCode: string;
  errorMessage: string;
  detectedText: string;
  checkedAt: string;
};

function text(value: unknown, max = 8000) {
  return String(value ?? "").replace(/\r/g, "").trim().slice(0, max);
}

function encodeBase64Utf8(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

function decodeBase64Utf8(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function normalizeGroups(
  value: unknown,
): KeywordElonBrowserImportPayload["supplierOptionGroups"] {
  if (!Array.isArray(value)) return [];
  const groups: KeywordElonBrowserImportPayload["supplierOptionGroups"] = [];
  for (const rawGroup of value.slice(0, 8)) {
    if (!rawGroup || typeof rawGroup !== "object" || Array.isArray(rawGroup)) {
      continue;
    }
    const group = rawGroup as BrowserOptionGroup;
    const sourceName = text(group.source_name, 100).replace(/\s+/g, " ");
    if (!sourceName) continue;
    const values: Array<{ id: string; sourceName: string }> = [];
    const seen = new Set<string>();
    for (const rawValue of (
      Array.isArray(group.values) ? group.values : []
    ).slice(0, 50)) {
      if (
        !rawValue ||
        typeof rawValue !== "object" ||
        Array.isArray(rawValue)
      ) {
        continue;
      }
      const item = rawValue as BrowserOptionValue;
      const itemName = text(item.source_name, 100).replace(/\s+/g, " ");
      const key = itemName.toLocaleLowerCase();
      if (!itemName || seen.has(key)) continue;
      seen.add(key);
      values.push({
        id: text(item.id, 80) || `option_${values.length + 1}`,
        sourceName: itemName,
      });
    }
    if (!values.length) continue;
    groups.push({
      id: text(group.id, 80) || `group_${groups.length + 1}`,
      sourceName,
      values,
    });
  }
  return groups;
}

export function buildKeywordElonBrowserImportUrl(
  raw1688Url: string,
  returnUrl: string,
) {
  if (!validate1688Url(raw1688Url)) {
    throw new Error("1688.com 상품 링크를 입력해 주세요.");
  }
  const target = new URL(raw1688Url);
  target.searchParams.set(KEYWORD_ELON_BROWSER_IMPORT_PARAMETER, "1");
  target.searchParams.set(KEYWORD_ELON_BROWSER_RETURN_PARAMETER, returnUrl);
  target.hash = new URLSearchParams({
    [KEYWORD_ELON_BROWSER_CONTEXT_HASH_PARAMETER]: encodeBase64Utf8({
      mode: "keyword_collect",
      returnUrl,
      sourceUrl: raw1688Url,
      requestedAt: new Date().toISOString(),
    }),
  }).toString();
  return target.toString();
}

function parseHashRecord(hash: string, parameter: string) {
  const rawHash = String(hash || "").replace(/^#/, "");
  if (!rawHash) return null;
  const encoded = new URLSearchParams(rawHash).get(parameter);
  if (!encoded) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(decodeBase64Utf8(encoded));
  } catch {
    throw new Error("1688 수집기가 전달한 자료를 해석하지 못했습니다.");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("1688 수집기가 전달한 자료 형식이 올바르지 않습니다.");
  }
  return raw as Record<string, unknown>;
}

export function parseKeywordElonBrowserImportHash(
  hash: string,
): KeywordElonBrowserImportPayload | null {
  const value = parseHashRecord(hash, KEYWORD_ELON_BROWSER_HASH_PARAMETER);
  if (!value) return null;
  const productName = text(value.productName, 300);
  const sourceUrl = text(value.sourceUrl, 1000);
  if (!productName || !validate1688Url(sourceUrl)) {
    throw new Error(
      "키워드 실험실 수집기가 중국 상품명 또는 1688 원본 주소를 전달하지 못했습니다.",
    );
  }
  return {
    schemaVersion: Number(value.schemaVersion) || 1,
    source: text(value.source, 100),
    collectorVersion: text(value.collectorVersion, 40),
    sourceUrl,
    productId: text(value.productId, 80),
    productName,
    supplierOptionGroups: normalizeGroups(value.supplierOptionGroups),
    supplierOptions: text(value.supplierOptions, 3000),
    sourceProductInfo: text(value.sourceProductInfo, 6000),
    productAttributes: text(value.productAttributes, 3000),
    collectedAt: text(value.collectedAt, 80),
  };
}

export function parseKeywordElonBrowserLinkErrorHash(
  hash: string,
): KeywordElonBrowserLinkErrorPayload | null {
  const value = parseHashRecord(
    hash,
    KEYWORD_ELON_BROWSER_LINK_ERROR_HASH_PARAMETER,
  );
  if (!value) return null;
  const sourceUrl = text(value.sourceUrl, 4000);
  const status = text(value.status, 40);
  if (
    !validate1688Url(sourceUrl) ||
    (status !== "link_error" && status !== "temporary_error")
  ) {
    throw new Error("1688 링크 오류 결과 형식이 올바르지 않습니다.");
  }
  return {
    schemaVersion: Number(value.schemaVersion) || 1,
    source: text(value.source, 100),
    collectorVersion: text(value.collectorVersion, 40),
    mode: "keyword_collect",
    sourceUrl,
    finalUrl: text(value.finalUrl, 4000),
    status,
    errorCode: text(value.errorCode, 120),
    errorMessage: text(value.errorMessage, 500),
    detectedText: text(value.detectedText, 500),
    checkedAt: text(value.checkedAt, 80),
  };
}

export function keywordElonOptionTextFromBrowserPayload(
  payload: KeywordElonBrowserImportPayload,
) {
  if (payload.supplierOptionGroups.length) {
    return payload.supplierOptionGroups
      .map(
        (group) =>
          `${group.sourceName}: ${group.values
            .map((item) => item.sourceName)
            .join(" / ")}`,
      )
      .join("\n")
      .slice(0, 4000);
  }
  return payload.supplierOptions.trim().slice(0, 4000);
}

export function keywordElonSourceFromBrowserPayload(
  payload: KeywordElonBrowserImportPayload,
): KeywordElonSourceDraft {
  const optionText = keywordElonOptionTextFromBrowserPayload(payload);
  const supportingText =
    payload.sourceProductInfo || payload.productAttributes || "";
  const warnings: string[] = [];
  if (!payload.supplierOptionGroups.length && payload.supplierOptions) {
    warnings.push(
      "옵션 문구는 수집됐지만 구조화된 SKU 옵션 그룹은 찾지 못했습니다. 아래 옵션 내용을 확인해 주세요.",
    );
  } else if (!payload.supplierOptionGroups.length && !payload.supplierOptions) {
    warnings.push(
      "선택 옵션이 없는 단품이거나 1688 옵션 영역이 아직 렌더링되지 않았습니다.",
    );
  }
  return {
    url: payload.sourceUrl,
    offerId: payload.productId || parse1688OfferId(payload.sourceUrl),
    autoStatus:
      payload.productName &&
      (payload.supplierOptionGroups.length || payload.supplierOptions)
        ? "success"
        : "partial",
    chineseTitle: payload.productName,
    optionText,
    supportingText: supportingText.slice(0, 8000),
    warnings,
    collectedAt: payload.collectedAt || new Date().toISOString(),
  };
}

export function versionAtLeast(current: string, required: string) {
  const parse = (value: string) =>
    value
      .split(".")
      .slice(0, 3)
      .map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(current);
  const right = parse(required);
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] || 0) > (right[index] || 0)) return true;
    if ((left[index] || 0) < (right[index] || 0)) return false;
  }
  return true;
}
