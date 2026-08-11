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

export function readChinaOrderOptionMappings(item) {
  const source = record(item);
  const options = Array.isArray(source.orderOptions) ? source.orderOptions : [];
  const singleOptionBarcode = options.length === 1 ? barcode(source.barcode) : "";
  return options.map((entry, index) => {
    const option = record(entry);
    return {
      id: text(option.id) || `option-${index + 1}`,
      barcode: barcode(option.barcode) || singleOptionBarcode,
      saleOption: text(option.saleOption ?? option.value),
      chinaOption: text(option.chinaOption),
    };
  });
}

export function normalizeChinaOrderOptionMappings(values) {
  const source = Array.isArray(values) ? values : [];
  return source.map((entry, index) => {
    const row = record(entry);
    return {
      id: text(row.id) || `option-${index + 1}`,
      barcode: barcode(row.barcode),
      saleOption: text(row.saleOption),
      chinaOption: text(row.chinaOption).slice(0, 240),
    };
  });
}

export function applyChinaOrderOptionMappings(
  item,
  values,
  _availableLinks,
  { now = new Date(), updatedBy = "승준" } = {},
) {
  const source = record(item);
  const mappings = normalizeChinaOrderOptionMappings(values);
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

export function sameChinaOrderOptionMappings(item, values) {
  const current = readChinaOrderOptionMappings(item).map(
    ({ id, barcode, saleOption, chinaOption }) => ({
      id,
      barcode,
      saleOption,
      chinaOption,
    }),
  );
  const next = normalizeChinaOrderOptionMappings(values);
  return JSON.stringify(current) === JSON.stringify(next);
}
