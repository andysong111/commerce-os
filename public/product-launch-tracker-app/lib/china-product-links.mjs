export const MAX_CHINA_PRODUCT_LINKS = 5;

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function text(value) {
  return String(value ?? "").trim();
}

export function normalizeChinaProductUrl(value) {
  let candidate = text(value);
  if (!candidate) return "";
  if (candidate.length > 4000) {
    throw new Error("중국 상품링크는 4,000자 이하로 입력하세요.");
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) && candidate.includes(".")) {
    candidate = `https://${candidate}`;
  }
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`올바른 인터넷 주소가 아닙니다: ${candidate.slice(0, 80)}`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("중국 상품링크는 http 또는 https 주소만 사용할 수 있습니다.");
  }
  return parsed.toString();
}

export function normalizeChinaProductLinks(values) {
  const source = Array.isArray(values) ? values : [values];
  const seen = new Set();
  const links = [];
  for (const value of source) {
    const normalized = normalizeChinaProductUrl(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    links.push(normalized);
    if (links.length >= MAX_CHINA_PRODUCT_LINKS) break;
  }
  return links;
}

export function promoteChinaProductLink(values, selectedIndex) {
  const source = Array.from({ length: MAX_CHINA_PRODUCT_LINKS }, (_, index) =>
    text(Array.isArray(values) ? values[index] : ""),
  );
  const index = Number(selectedIndex);
  if (!Number.isInteger(index) || index < 0 || index >= source.length) {
    throw new Error("1번으로 고정할 링크 위치를 확인하세요.");
  }
  const selected = normalizeChinaProductUrl(source[index]);
  if (!selected) throw new Error("링크를 입력한 뒤 1번으로 고정하세요.");
  const reordered = [selected, ...source.filter((_, current) => current !== index)];
  const normalized = normalizeChinaProductLinks(reordered);
  return [...normalized, ...Array(MAX_CHINA_PRODUCT_LINKS - normalized.length).fill("")];
}

export function readChinaProductLinks(item) {
  const source = record(item);
  const detailPageSource = record(source.detailPageSource);
  const primary = text(
    source.primaryChinaProductLink ?? detailPageSource.primaryUrl,
  );
  const candidates = [
    primary,
    ...(Array.isArray(source.chinaProductLinks) ? source.chinaProductLinks : []),
    ...(Array.isArray(detailPageSource.urls) ? detailPageSource.urls : []),
  ];
  return normalizeChinaProductLinks(candidates);
}

export function applyChinaProductLinks(
  item,
  values,
  { now = new Date(), updatedBy = "승준" } = {},
) {
  const source = record(item);
  const links = normalizeChinaProductLinks(values);
  const primaryUrl = links[0] ?? "";
  const updatedAt = now.toISOString();
  return {
    ...source,
    chinaProductLinks: links,
    primaryChinaProductLink: primaryUrl,
    detailPageSource: {
      ...record(source.detailPageSource),
      primaryUrl,
      urls: links,
      pinnedIndex: primaryUrl ? 0 : null,
      source: "product_launch_tracker",
      updatedAt,
    },
    updatedAt,
    updatedBy,
  };
}

export function sameChinaProductLinks(item, values) {
  const current = readChinaProductLinks(item);
  const next = normalizeChinaProductLinks(values);
  return JSON.stringify(current) === JSON.stringify(next);
}
