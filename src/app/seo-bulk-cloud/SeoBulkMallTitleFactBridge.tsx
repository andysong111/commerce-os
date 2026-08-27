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

function mallTitleSupportingText(item: UnknownRecord, existing: string) {
  const detailAsset = record(item.detailPageAsset);
  const mainImageUrl = text(detailAsset.mainImageUrl);
  const additionalImages = stringList(detailAsset.additionalImageUrls).slice(0, 5);
  const detailHtml = text(detailAsset.html);
  const options = Array.isArray(item.orderOptions)
    ? item.orderOptions
        .map(record)
        .map((row) => [text(row.optionName), text(row.saleOption)].filter(Boolean).join(" "))
        .filter(Boolean)
        .join(" / ")
    : "";

  return [
    existing,
    text(item.shoplingCategory) ? `카테고리 ${text(item.shoplingCategory)}` : "",
    text(item.productName) ? `상품명 ${text(item.productName)}` : "",
    options ? `옵션 ${options}` : "",
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

        const nextBody = {
          ...body,
          item: {
            ...item,
            // This is attached only for compose_bulk_final. It never enters keyword
            // discovery/scoring/final-keyword generation.
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
