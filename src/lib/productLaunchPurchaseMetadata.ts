import { temporaryOpsIdentity } from "@/lib/opsLoginBypass";
import { buildProductLaunchTrackerIndex } from "@/lib/productLaunchTrackerOptimized";
import {
  getProductLaunchAdminConfig,
  readProductLaunchState,
} from "@/lib/productLaunchTrackerServer";

const BARCODE_PATTERN = /^[A-Z]{3}\d+-\d+$/;

export type ProductLaunchPurchaseMetadata = {
  barcode: string;
  supplierLink: string;
  saleOption: string;
  chinaOption: string;
  conflict: boolean;
};

type Candidate = Omit<ProductLaunchPurchaseMetadata, "conflict">;

export async function loadProductLaunchPurchaseMetadataByBarcode() {
  try {
    const configResult = getProductLaunchAdminConfig();
    if (!configResult.ok) {
      return {
        byBarcode: new Map<string, ProductLaunchPurchaseMetadata>(),
        error: configResult.body.code,
      };
    }
    const identity = temporaryOpsIdentity();
    const stored = await readProductLaunchState(configResult.value, identity.userId);
    const index = buildProductLaunchTrackerIndex(
      stored?.state_payload && typeof stored.state_payload === "object"
        ? stored.state_payload
        : {},
    );
    return {
      byBarcode: buildMetadataMap(index.summaries),
      error: null as string | null,
    };
  } catch (error) {
    return {
      byBarcode: new Map<string, ProductLaunchPurchaseMetadata>(),
      error: error instanceof Error ? error.message : "PRODUCT_LAUNCH_PURCHASE_METADATA_UNAVAILABLE",
    };
  }
}

export function buildMetadataMap(
  summaries: Array<{
    barcode?: unknown;
    chinaProductLinks?: unknown;
    orderOptions?: unknown;
  }>,
) {
  const candidates = new Map<string, Candidate[]>();
  for (const summary of summaries) {
    const supplierLink = normalizeSupplierLink(
      Array.isArray(summary.chinaProductLinks) ? summary.chinaProductLinks[0] : "",
    );
    const options = Array.isArray(summary.orderOptions)
      ? summary.orderOptions.filter(isRecord)
      : [];
    const optionBarcodes = new Set<string>();

    for (const option of options) {
      const barcode = normalizeBarcode(option.barcode);
      if (!BARCODE_PATTERN.test(barcode)) continue;
      optionBarcodes.add(barcode);
      addCandidate(candidates, {
        barcode,
        supplierLink,
        saleOption: text(option.saleOption),
        chinaOption: text(option.chinaOption),
      });
    }

    const mainBarcode = normalizeBarcode(summary.barcode);
    if (BARCODE_PATTERN.test(mainBarcode) && !optionBarcodes.has(mainBarcode)) {
      const only = options.length === 1 ? options[0] : null;
      addCandidate(candidates, {
        barcode: mainBarcode,
        supplierLink,
        saleOption: text(only?.saleOption),
        chinaOption: text(only?.chinaOption),
      });
    }
  }

  return new Map(
    [...candidates.entries()].map(([barcode, rows]) => {
      const supplierLinks = uniqueNonEmpty(rows.map((row) => row.supplierLink));
      const saleOptions = uniqueNonEmpty(rows.map((row) => row.saleOption));
      const chinaOptions = uniqueNonEmpty(rows.map((row) => row.chinaOption));
      const conflict =
        supplierLinks.length > 1 || saleOptions.length > 1 || chinaOptions.length > 1;
      return [
        barcode,
        {
          barcode,
          supplierLink: supplierLinks.length === 1 ? supplierLinks[0] : "",
          saleOption: saleOptions.length === 1 ? saleOptions[0] : "",
          chinaOption: chinaOptions.length === 1 ? chinaOptions[0] : "",
          conflict,
        },
      ] as const;
    }),
  );
}

function addCandidate(map: Map<string, Candidate[]>, candidate: Candidate) {
  map.set(candidate.barcode, [...(map.get(candidate.barcode) ?? []), candidate]);
}

function normalizeSupplierLink(value: unknown) {
  const candidate = text(value);
  if (!candidate || candidate.length > 4000) return "";
  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function normalizeBarcode(value: unknown) {
  return text(value).normalize("NFKC").toUpperCase().replace(/\s+/g, "");
}

function uniqueNonEmpty(values: string[]) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value: unknown) {
  return String(value ?? "").trim();
}
