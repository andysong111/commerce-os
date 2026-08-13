import type { ProductLaunchTrackerState } from "@/lib/productLaunchTrackerOptimized";

const B_LOCATION_CODE = /^[A-Z]{3}\d+-\d+$/;

type UnknownRecord = Record<string, unknown>;

export type ProductLaunchLocationCodeMapping = {
  itemId: string;
  expectedModelNumber: string;
  expectedProductName: string;
  barcode?: string;
  warehouseLocation?: string;
  method?: string;
  orderOptions: Array<{
    optionId: string;
    expectedSaleOption: string;
    barcode: string;
  }>;
};

export type ProductLaunchLocationCodeBackfillReport = {
  mappingCount: number;
  mappingOptionCount: number;
  matchedItems: number;
  completeMappedItems: number;
  partialMappedItems: number;
  changedItems: number;
  changedOptions: number;
  changedMainBarcodes: number;
  changedWarehouseLocations: number;
  preservedOptions: number;
  preservedMainBarcodes: number;
  preservedWarehouseLocations: number;
  missingItems: Array<{ itemId: string; modelNumber: string; productName: string }>;
  identityConflicts: Array<{
    itemId: string;
    expectedModelNumber: string;
    actualModelNumber: string;
    expectedProductName: string;
    actualProductName: string;
  }>;
  optionConflicts: Array<{
    itemId: string;
    modelNumber: string;
    optionId: string;
    expectedSaleOption: string;
    actualSaleOption: string;
    existingBarcode: string;
    mappedBarcode: string;
    reason: string;
  }>;
  mainCodeConflicts: Array<{
    itemId: string;
    modelNumber: string;
    field: "barcode" | "warehouseLocation";
    existingCode: string;
    mappedCodes: string[];
  }>;
  invalidMappings: Array<{
    itemId: string;
    modelNumber: string;
    optionId: string;
    barcode: string;
  }>;
  duplicateMappingItemIds: string[];
  hardConflictCount: number;
};

export function prepareProductLaunchLocationCodeBackfill(
  stateInput: ProductLaunchTrackerState,
  mappingsInput: ProductLaunchLocationCodeMapping[],
  now = new Date().toISOString(),
) {
  const state = cloneJson(stateInput);
  const items = Array.isArray(state.items) ? state.items.filter(isRecord) : [];
  const mappings = Array.isArray(mappingsInput) ? mappingsInput : [];
  const duplicateMappingItemIds = findDuplicates(mappings.map((entry) => text(entry.itemId)));
  const mappingById = new Map<string, ProductLaunchLocationCodeMapping>();
  for (const mapping of mappings) {
    const itemId = text(mapping.itemId);
    if (itemId && !mappingById.has(itemId)) mappingById.set(itemId, mapping);
  }

  const report: ProductLaunchLocationCodeBackfillReport = {
    mappingCount: mappings.length,
    mappingOptionCount: mappings.reduce(
      (sum, entry) => sum + (Array.isArray(entry.orderOptions) ? entry.orderOptions.length : 0),
      0,
    ),
    matchedItems: 0,
    completeMappedItems: 0,
    partialMappedItems: 0,
    changedItems: 0,
    changedOptions: 0,
    changedMainBarcodes: 0,
    changedWarehouseLocations: 0,
    preservedOptions: 0,
    preservedMainBarcodes: 0,
    preservedWarehouseLocations: 0,
    missingItems: [],
    identityConflicts: [],
    optionConflicts: [],
    mainCodeConflicts: [],
    invalidMappings: [],
    duplicateMappingItemIds,
    hardConflictCount: 0,
  };

  const existingItemIds = new Set(items.map((item) => text(item.id)).filter(Boolean));
  for (const mapping of mappings) {
    if (!existingItemIds.has(text(mapping.itemId))) {
      report.missingItems.push({
        itemId: text(mapping.itemId),
        modelNumber: text(mapping.expectedModelNumber),
        productName: text(mapping.expectedProductName),
      });
    }
  }

  state.items = items.map((item) => {
    const itemId = text(item.id);
    const mapping = mappingById.get(itemId);
    if (!mapping) return item;
    report.matchedItems += 1;

    const actualModelNumber = normalizeModel(item.modelNumber);
    const expectedModelNumber = normalizeModel(mapping.expectedModelNumber);
    const actualProductName = normalizeProduct(item.productName);
    const expectedProductName = normalizeProduct(mapping.expectedProductName);
    if (
      !expectedModelNumber ||
      actualModelNumber !== expectedModelNumber ||
      !expectedProductName ||
      actualProductName !== expectedProductName
    ) {
      report.identityConflicts.push({
        itemId,
        expectedModelNumber: text(mapping.expectedModelNumber),
        actualModelNumber: text(item.modelNumber),
        expectedProductName: text(mapping.expectedProductName),
        actualProductName: text(item.productName),
      });
      return item;
    }

    const currentOptions = Array.isArray(item.orderOptions)
      ? item.orderOptions.map((entry) => (isRecord(entry) ? { ...entry } : {}))
      : [];
    const mappingOptions = Array.isArray(mapping.orderOptions) ? mapping.orderOptions : [];
    const mappedCodes = new Set<string>();
    const mappedByOptionId = new Map<string, ProductLaunchLocationCodeMapping["orderOptions"][number]>();
    let itemInvalid = false;

    for (const optionMapping of mappingOptions) {
      const optionId = text(optionMapping.optionId);
      const code = normalizeLocationCode(optionMapping.barcode);
      if (!optionId || !code) {
        report.invalidMappings.push({
          itemId,
          modelNumber: text(item.modelNumber),
          optionId,
          barcode: text(optionMapping.barcode),
        });
        itemInvalid = true;
        continue;
      }
      if (mappedByOptionId.has(optionId)) {
        report.optionConflicts.push({
          itemId,
          modelNumber: text(item.modelNumber),
          optionId,
          expectedSaleOption: text(optionMapping.expectedSaleOption),
          actualSaleOption: "",
          existingBarcode: "",
          mappedBarcode: code,
          reason: "duplicate_option_mapping",
        });
        itemInvalid = true;
        continue;
      }
      mappedByOptionId.set(optionId, optionMapping);
      mappedCodes.add(code);
    }

    const optionById = new Map(
      currentOptions
        .map((option, index) => [text(option.id) || `option-${index + 1}`, { option, index }] as const)
        .filter(([optionId]) => Boolean(optionId)),
    );

    for (const [optionId, optionMapping] of mappedByOptionId) {
      const found = optionById.get(optionId);
      const code = normalizeLocationCode(optionMapping.barcode);
      if (!found) {
        report.optionConflicts.push({
          itemId,
          modelNumber: text(item.modelNumber),
          optionId,
          expectedSaleOption: text(optionMapping.expectedSaleOption),
          actualSaleOption: "",
          existingBarcode: "",
          mappedBarcode: code,
          reason: "option_not_found",
        });
        itemInvalid = true;
        continue;
      }
      const actualSaleOption = text(found.option.saleOption ?? found.option.value);
      if (normalizeOption(actualSaleOption) !== normalizeOption(optionMapping.expectedSaleOption)) {
        report.optionConflicts.push({
          itemId,
          modelNumber: text(item.modelNumber),
          optionId,
          expectedSaleOption: text(optionMapping.expectedSaleOption),
          actualSaleOption,
          existingBarcode: text(found.option.barcode),
          mappedBarcode: code,
          reason: "option_label_mismatch",
        });
        itemInvalid = true;
        continue;
      }
      const existing = normalizeLocationCode(found.option.barcode);
      if (existing && existing !== code) {
        report.optionConflicts.push({
          itemId,
          modelNumber: text(item.modelNumber),
          optionId,
          expectedSaleOption: text(optionMapping.expectedSaleOption),
          actualSaleOption,
          existingBarcode: existing,
          mappedBarcode: code,
          reason: "existing_b_code_conflict",
        });
        itemInvalid = true;
      }
    }

    const fullyMapped =
      currentOptions.length > 0 &&
      mappingOptions.length === currentOptions.length &&
      currentOptions.every((option, index) =>
        mappedByOptionId.has(text(option.id) || `option-${index + 1}`),
      );
    if (fullyMapped) report.completeMappedItems += 1;
    else report.partialMappedItems += 1;

    const orderedMappedCodes = currentOptions
      .map((option, index) => {
        const optionId = text(option.id) || `option-${index + 1}`;
        return normalizeLocationCode(mappedByOptionId.get(optionId)?.barcode);
      })
      .filter(Boolean);
    const representativeCode = orderedMappedCodes[0] || "";

    if (fullyMapped && representativeCode) {
      for (const field of ["barcode", "warehouseLocation"] as const) {
        const existing = normalizeLocationCode(item[field]);
        if (existing && !mappedCodes.has(existing)) {
          report.mainCodeConflicts.push({
            itemId,
            modelNumber: text(item.modelNumber),
            field,
            existingCode: existing,
            mappedCodes: [...mappedCodes],
          });
          itemInvalid = true;
        }
      }
    }

    if (itemInvalid) return item;

    let itemChanged = false;
    const nextOptions = currentOptions.map((option, index) => {
      const optionId = text(option.id) || `option-${index + 1}`;
      const optionMapping = mappedByOptionId.get(optionId);
      if (!optionMapping) return option;
      const code = normalizeLocationCode(optionMapping.barcode);
      const existing = normalizeLocationCode(option.barcode);
      if (existing === code) {
        report.preservedOptions += 1;
        return option;
      }
      itemChanged = true;
      report.changedOptions += 1;
      return { ...option, barcode: code };
    });

    let nextBarcode = text(item.barcode);
    let nextWarehouseLocation = text(item.warehouseLocation);
    if (fullyMapped && representativeCode) {
      const currentBarcode = normalizeLocationCode(item.barcode);
      if (currentBarcode === representativeCode) {
        report.preservedMainBarcodes += 1;
      } else {
        nextBarcode = representativeCode;
        report.changedMainBarcodes += 1;
        itemChanged = true;
      }

      const currentWarehouseLocation = normalizeLocationCode(item.warehouseLocation);
      if (currentWarehouseLocation === representativeCode) {
        report.preservedWarehouseLocations += 1;
      } else {
        nextWarehouseLocation = representativeCode;
        report.changedWarehouseLocations += 1;
        itemChanged = true;
      }
    }

    if (!itemChanged) return item;
    report.changedItems += 1;
    return {
      ...item,
      barcode: nextBarcode,
      warehouseLocation: nextWarehouseLocation,
      orderOptions: nextOptions,
      options: nextOptions.map((option) => text(option.saleOption ?? option.value)).filter(Boolean),
      updatedAt: now,
      updatedBy: "승준",
    };
  });

  report.hardConflictCount =
    report.missingItems.length +
    report.identityConflicts.length +
    report.optionConflicts.length +
    report.mainCodeConflicts.length +
    report.invalidMappings.length +
    report.duplicateMappingItemIds.length;

  return { state, report };
}

export function isProductLaunchBLocationCode(value: unknown) {
  return B_LOCATION_CODE.test(text(value).toUpperCase().replace(/\s+/g, ""));
}

function normalizeLocationCode(value: unknown) {
  const result = text(value).toUpperCase().replace(/\s+/g, "");
  return B_LOCATION_CODE.test(result) ? result : "";
}

function normalizeModel(value: unknown) {
  return text(value).normalize("NFKC").toUpperCase().replace(/\s+/g, "");
}

function normalizeProduct(value: unknown) {
  return text(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]+/g, "");
}

function normalizeOption(value: unknown) {
  return text(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/(색상)?\s*(랜덤|임의)\s*(색상)?\s*(발송)?/g, "랜덤")
    .replace(/[^0-9a-z가-힣]+/g, "");
}

function findDuplicates(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown) {
  return String(value ?? "").trim();
}
