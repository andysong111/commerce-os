"use client";

import { useEffect } from "react";

const KEYWORD_API = "/api/keyword-engine-elon-lab";
const NORMALIZED_API = "/api/product-launch-tracker/normalized-optimized";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function koreanWords(value: string) {
  const decoded = safeDecode(value);
  return [...decoded.matchAll(/[가-힣]{2,12}/g)].map((match) => match[0]);
}

function htmlTextFacts(html: string) {
  const facts: string[] = [];
  for (const match of html.matchAll(/(?:alt|title)\s*=\s*["']([^"']+)["']/gi)) {
    facts.push(...koreanWords(match[1]));
  }
  for (const match of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    facts.push(...koreanWords(match[1]));
  }
  return facts;
}

function unique(values: string[], limit = 40) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values.map(text).filter(Boolean)) {
    const key = value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function isComposeRequest(input: RequestInfo | URL, init?: RequestInit) {
  const url = requestUrl(input);
  return url.includes(KEYWORD_API) && String(init?.method ?? "GET").toUpperCase() === "POST";
}

async function readTrackerItem(
  nativeFetch: typeof window.fetch,
  itemId: string,
) {
  const query = new URLSearchParams({ mode: "item", id: itemId });
  const response = await nativeFetch(`${NORMALIZED_API}?${query.toString()}`, {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as UnknownRecord;
  if (!response.ok || body.ok !== true) return null;
  return record(body.item);
}

function trackerFactContext(item: UnknownRecord) {
  const detailAsset = record(item.detailPageAsset);
  const detailHtml = text(detailAsset.html);
  const mainImageUrl = text(detailAsset.mainImageUrl);
  const additionalImages = stringList(detailAsset.additionalImageUrls).slice(0, 5);
  const category = text(item.shoplingCategory);
  const productName = text(item.productName);
  const options = Array.isArray(item.orderOptions)
    ? item.orderOptions
        .map(record)
        .flatMap((row) => [text(row.optionName), text(row.saleOption)])
        .filter(Boolean)
    : [];

  return unique([
    productName,
    ...category.split(/[>\/]+/).map(text).filter(Boolean),
    ...options,
    ...htmlTextFacts(detailHtml),
    ...koreanWords(mainImageUrl),
    ...additionalImages.flatMap(koreanWords),
  ]);
}

function mallTitleSupportingText(item: UnknownRecord, existing: string) {
  const detailAsset = record(item.detailPageAsset);
  const mainImageUrl = text(detailAsset.mainImageUrl);
  const additionalImages = stringList(detailAsset.additionalImageUrls).slice(0, 5);
  const detailHtml = text(detailAsset.html);
  return [
    existing,
    text(item.shoplingCategory) ? `카테고리 ${text(item.shoplingCategory)}` : "",
    text(item.productName) ? `상품명 ${text(item.productName)}` : "",
    detailHtml,
    mainImageUrl ? `<img src="${mainImageUrl}" />` : "",
    ...additionalImages.map((url) => `<img src="${url}" />`),
  ]
    .filter(Boolean)
    .join("\n");
}

export default function SeoBulkMallTitleFactBridge() {
  useEffect(() => {
    const previousFetch = window.fetch.bind(window);

    const wrappedFetch: typeof window.fetch = async (input, init) => {
      if (!isComposeRequest(input, init) || typeof init?.body !== "string") {
        return previousFetch(input, init);
      }

      try {
        const body = JSON.parse(init.body) as UnknownRecord;
        if (text(body.action) !== "compose_bulk_final") {
          return previousFetch(input, init);
        }
        const item = record(body.item);
        const itemId = text(item.launchItemId ?? item.id);
        if (!itemId) return previousFetch(input, init);

        const trackerItem = await readTrackerItem(previousFetch, itemId);
        if (!trackerItem) return previousFetch(input, init);

        const facts = trackerFactContext(trackerItem);
        const existingOptionText = text(item.optionText);
        const nextBody = {
          ...body,
          item: {
            ...item,
            // Both fields are augmented only for compose_bulk_final. Keyword discovery,
            // scoring and final-keyword generation have already finished at this point.
            optionText: [existingOptionText, ...facts].filter(Boolean).join(" / "),
            supportingText: mallTitleSupportingText(
              trackerItem,
              text(item.supportingText),
            ),
          },
        };
        return previousFetch(input, {
          ...init,
          body: JSON.stringify(nextBody),
        });
      } catch (error) {
        console.warn("[SEO bulk mall title facts] tracker context skipped", error);
        return previousFetch(input, init);
      }
    };

    window.fetch = wrappedFetch;
    return () => {
      if (window.fetch === wrappedFetch) window.fetch = previousFetch;
    };
  }, []);

  return null;
}
