import {
  normalizeChinaProductLinks,
  normalizeChinaProductUrl,
  readChinaProductLinks,
} from "./china-product-links.mjs";

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function text(value) {
  return String(value ?? "").trim();
}

function barcode(value) {
  return text(value).normalize("NFKC").toUpperCase().replace(/\s+/g, "");
}

function linkOrBlank(value) {
  const candidate = text(value);
  return candidate ? normalizeChinaProductUrl(candidate) : "";
}

export function readChinaOrderOptionMappings(item) {
  const source = record(item);
  const links = readChinaProductLinks(source);
  const fallbackLink = links[0] ?? "";
  const options = Array.isArray(source.orderOptions) ? source.orderOptions : [];
  const singleOptionBarcode = options.length === 1 ? barcode(source.barcode) : "";
  return options.map((entry, index) => {
    const option = record(entry);
    return {
      id: text(option.id) || `option-${index + 1}`,
      barcode: barcode(option.barcode) || singleOptionBarcode,
      saleOption: text(option.saleOption ?? option.value),
      chinaOption: text(option.chinaOption),
      supplierLink: linkOrBlank(option.supplierLink) || fallbackLink,
    };
  });
}

export function normalizeChinaOrderOptionMappings(values, availableLinks = []) {
  const links = normalizeChinaProductLinks(availableLinks);
  const allowed = new Set(links);
  const source = Array.isArray(values) ? values : [];
  return source.map((entry, index) => {
    const row = record(entry);
    const supplierLink = linkOrBlank(row.supplierLink);
    if (supplierLink && !allowed.has(supplierLink)) {
      throw new Error(
        `${barcode(row.barcode) || `${index + 1}번째 옵션`}의 1688 링크가 상품상세 중국 상품링크 목록에 없습니다.`,
      );
    }
    return {
      id: text(row.id) || `option-${index + 1}`,
      barcode: barcode(row.barcode),
      saleOption: text(row.saleOption),
      chinaOption: text(row.chinaOption).slice(0, 240),
      supplierLink,
    };
  });
}

export function applyChinaOrderOptionMappings(
  item,
  values,
  availableLinks,
  { now = new Date(), updatedBy = "승준" } = {},
) {
  const source = record(item);
  const mappings = normalizeChinaOrderOptionMappings(values, availableLinks);
  const byId = new Map(mappings.map((row) => [row.id, row]));
  const byBarcode = new Map(
    mappings.filter((row) => row.barcode).map((row) => [row.barcode, row]),
  );
  const current = Array.isArray(source.orderOptions) ? source.orderOptions : [];
  const singleOptionBarcode = current.length === 1 ? barcode(source.barcode) : "";
  const orderOptions = current.map((entry, index) => {
    const option = record(entry);
    const id = text(option.id) || `option-${index + 1}`;
    const code = barcode(option.barcode) || singleOptionBarcode;
    const mapped = byId.get(id) || (code ? byBarcode.get(code) : undefined);
    if (!mapped) return option;
    return {
      ...option,
      id,
      barcode: code || mapped.barcode,
      saleOption: text(option.saleOption ?? option.value),
      chinaOption: mapped.chinaOption,
      supplierLink: mapped.supplierLink,
    };
  });
  const updatedAt = now.toISOString();
  return {
    ...source,
    orderOptions,
    updatedAt,
    updatedBy,
  };
}

export function sameChinaOrderOptionMappings(item, values, availableLinks) {
  const current = readChinaOrderOptionMappings(item).map(
    ({ id, barcode, saleOption, chinaOption, supplierLink }) => ({
      id,
      barcode,
      saleOption,
      chinaOption,
      supplierLink,
    }),
  );
  const next = normalizeChinaOrderOptionMappings(values, availableLinks);
  return JSON.stringify(current) === JSON.stringify(next);
}
