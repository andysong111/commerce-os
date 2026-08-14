function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function text(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

export function normalizeRegisteredBcode(value) {
  const candidate = text(value).toUpperCase().replace(/\s+/g, "");
  return /^[A-Z]{3}\d+-\d+$/.test(candidate) ? candidate : "";
}

function saleKey(value) {
  return text(value).toLowerCase().replace(/\s+/g, "");
}

export function registeredOrderOptionRows(values) {
  const seen = new Set();
  const rows = [];
  for (const [index, raw] of (Array.isArray(values) ? values : []).entries()) {
    const row = record(raw);
    const barcode = normalizeRegisteredBcode(row.barcode);
    if (!barcode || seen.has(barcode)) continue;
    seen.add(barcode);
    rows.push({
      id: text(row.id) || `registered-${index + 1}`,
      barcode,
      saleOption: text(row.saleOption ?? row.value) || "단품",
      chinaOption: text(row.chinaOption).slice(0, 240),
    });
  }
  return rows;
}

function uniqueSaleOptionIndex(values) {
  const index = new Map();
  const ambiguous = new Set();
  for (const row of values) {
    const key = saleKey(row.saleOption);
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

export function alignChinaOptionMappingsToRegisteredOptions(
  registeredValues,
  savedValues,
) {
  const registered = registeredOrderOptionRows(registeredValues);
  const saved = (Array.isArray(savedValues) ? savedValues : []).map((raw, index) => {
    const row = record(raw);
    return {
      id: text(row.id) || `saved-${index + 1}`,
      barcode: normalizeRegisteredBcode(row.barcode),
      saleOption: text(row.saleOption ?? row.value),
      chinaOption: text(row.chinaOption).slice(0, 240),
    };
  });
  const byBarcode = new Map(
    saved.filter((row) => row.barcode).map((row) => [row.barcode, row]),
  );
  const bySaleOption = uniqueSaleOptionIndex(saved);

  return registered.map((row) => {
    const matched =
      byBarcode.get(row.barcode) || bySaleOption.get(saleKey(row.saleOption));
    return {
      id: matched?.id || row.id,
      barcode: row.barcode,
      saleOption: row.saleOption,
      chinaOption: matched?.chinaOption || row.chinaOption,
    };
  });
}

export function sameRegisteredChinaOptionMappings(left, right) {
  const comparable = (values) =>
    registeredOrderOptionRows(values).map(({ barcode, saleOption, chinaOption }) => ({
      barcode,
      saleOption,
      chinaOption,
    }));
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}
