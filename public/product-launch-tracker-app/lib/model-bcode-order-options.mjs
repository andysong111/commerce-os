function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function text(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function normalizeBarcode(value) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function managedBarcode(value) {
  const barcode = normalizeBarcode(value);
  return /^[A-Z]{3}\d+-\d+$/.test(barcode) ? barcode : "";
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.ceil(parsed)) : 0;
}

function normalizedSaleOption(value) {
  return text(value).toLowerCase().replace(/\s+/g, "");
}

function normalizedSourceOptions(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => record(value))
    .filter((value) => Object.keys(value).length > 0);
}

function normalizedAuthority(values) {
  const seen = new Set();
  const output = [];
  for (const raw of Array.isArray(values) ? values : []) {
    const row = record(raw);
    const barcode = managedBarcode(row.barcode);
    if (!barcode || seen.has(barcode)) continue;
    seen.add(barcode);
    output.push({
      id: text(row.id) || `model-${barcode}`,
      optionName: text(row.optionName) || "옵션",
      saleOption: text(row.saleOption ?? row.optionName) || "단품",
      barcode,
      baseSalePriceKrw: nonNegativeInteger(row.baseSalePriceKrw),
      unitCostKrw: nonNegativeInteger(row.unitCostKrw),
      sourceOrderItemId: row.sourceOrderItemId ?? null,
    });
  }
  return output.sort((left, right) => left.barcode.localeCompare(right.barcode));
}

function uniqueBlankBarcodeSaleOptionIndex(source) {
  const index = new Map();
  const ambiguous = new Set();
  for (const row of source) {
    // A row that already carries another managed B-code belongs to another SKU and
    // must never donate option/cost data merely because its sale-option text matches.
    if (managedBarcode(row.barcode)) continue;
    const key = normalizedSaleOption(row.saleOption ?? row.value);
    if (!key || ambiguous.has(key)) continue;
    if (index.has(key)) {
      index.delete(key);
      ambiguous.add(key);
      continue;
    }
    index.set(key, row);
  }
  return index;
}

export function reconcileModelOrderOptions(currentValues, authoritativeValues) {
  const current = normalizedSourceOptions(currentValues);
  const authority = normalizedAuthority(authoritativeValues);
  if (!authority.length) return currentValues;

  const byBarcode = new Map();
  for (const row of current) {
    const code = managedBarcode(row.barcode);
    if (code && !byBarcode.has(code)) byBarcode.set(code, row);
  }
  const blankBySaleOption = uniqueBlankBarcodeSaleOptionIndex(current);
  const singleBlankFallback =
    authority.length === 1 &&
    current.length === 1 &&
    !managedBarcode(current[0].barcode)
      ? current[0]
      : null;

  return authority.map((authoritative) => {
    const exact = byBarcode.get(authoritative.barcode);
    const blankSaleMatch = blankBySaleOption.get(
      normalizedSaleOption(authoritative.saleOption),
    );
    const saved = exact || blankSaleMatch || singleBlankFallback || {};
    return {
      ...saved,
      id: text(saved.id) || authoritative.id,
      optionName:
        text(saved.optionName) || authoritative.optionName || "옵션",
      saleOption:
        authoritative.saleOption ||
        text(saved.saleOption ?? saved.value) ||
        "단품",
      chinaOption: text(saved.chinaOption),
      barcode: authoritative.barcode,
      baseSalePriceKrw:
        nonNegativeInteger(saved.baseSalePriceKrw) ||
        authoritative.baseSalePriceKrw,
      unitCostKrw:
        nonNegativeInteger(saved.unitCostKrw) || authoritative.unitCostKrw,
      sourceOrderItemId:
        saved.sourceOrderItemId ?? authoritative.sourceOrderItemId ?? null,
    };
  });
}

function comparable(values) {
  return normalizedSourceOptions(values)
    .map((row) => ({
      id: text(row.id),
      optionName: text(row.optionName) || "옵션",
      saleOption: text(row.saleOption ?? row.value),
      chinaOption: text(row.chinaOption),
      barcode: normalizeBarcode(row.barcode),
      baseSalePriceKrw: nonNegativeInteger(row.baseSalePriceKrw),
      unitCostKrw: nonNegativeInteger(row.unitCostKrw),
      sourceOrderItemId: row.sourceOrderItemId ?? null,
    }))
    .sort((left, right) => left.barcode.localeCompare(right.barcode));
}

export function sameModelOrderOptions(left, right) {
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

export function modelOrderOptionBarcodes(values) {
  return normalizedAuthority(values).map((row) => row.barcode);
}
