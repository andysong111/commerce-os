import { unstable_cache } from "next/cache";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { resolveProductLaunchIdentity } from "@/lib/productLaunchTrackerServer";

export const dynamic = "force-dynamic";

const CORE_REVALIDATE_SECONDS = 60;

type CoreOption = {
  skuId: string;
  barcode: string;
  optionName: string;
  moq: number;
  cartonQuantity: number;
};

type CoreProduct = {
  modelNumber: string;
  productName: string;
  barcodes: string[];
  optionLabels: string[];
  options: CoreOption[];
};

const readCoreSnapshot = unstable_cache(
  async () => loadProductPlanningSnapshot(),
  ["product-master-core-fallback-v1"],
  { revalidate: CORE_REVALIDATE_SECONDS },
);

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function modelNumber(value: unknown) {
  const candidate = text(value).toUpperCase().replace(/\s+/g, "");
  const match = candidate.match(/^AAA0*(\d+)$/);
  if (!match) return candidate;
  return `AAA${match[1].padStart(3, "0")}`;
}

function positiveInteger(value: unknown, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.round(parsed)) : fallback;
}

export async function GET(request: Request) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });

  try {
    const snapshot = await readCoreSnapshot();
    const grouped = new Map<string, CoreProduct>();

    for (const row of snapshot.products) {
      if (row.skuActive === false) continue;
      const model = modelNumber(row.modelNo);
      const barcode = text(row.barcode).toUpperCase().replace(/\s+/g, "");
      if (!model || !barcode) continue;
      const optionName = text(row.optionName) || "단품";
      const current = grouped.get(model) ?? {
        modelNumber: model,
        productName: text(row.productName) || model,
        barcodes: [],
        optionLabels: [],
        options: [],
      };
      if (!current.barcodes.includes(barcode)) current.barcodes.push(barcode);
      if (!current.optionLabels.includes(optionName)) current.optionLabels.push(optionName);
      if (!current.options.some((option) => option.barcode === barcode)) {
        current.options.push({
          skuId: text(row.skuId),
          barcode,
          optionName,
          moq: positiveInteger(row.moq),
          cartonQuantity: positiveInteger(row.cartonQuantity),
        });
      }
      grouped.set(model, current);
    }

    const products = [...grouped.values()]
      .map((product) => ({
        ...product,
        barcodes: [...product.barcodes].sort((left, right) => left.localeCompare(right, "ko")),
        optionLabels: [...product.optionLabels],
        options: [...product.options].sort((left, right) => left.barcode.localeCompare(right.barcode, "ko")),
      }))
      .sort((left, right) => left.modelNumber.localeCompare(right.modelNumber, "ko"));

    return Response.json(
      {
        ok: true,
        source: "commerce-os-product-master",
        mode: "core-ledger-fallback",
        generatedAt: snapshot.generatedAt,
        contentFingerprint: snapshot.contentFingerprint,
        productCount: products.length,
        skuCount: products.reduce((sum, product) => sum + product.options.length, 0),
        products,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "private, max-age=0, stale-while-revalidate=60",
          "X-Commerce-Master-Source": "product-master-core",
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_MASTER_CORE_UNAVAILABLE",
        message:
          error instanceof Error
            ? `Product Master 핵심 원장을 불러오지 못했습니다: ${error.message}`
            : "Product Master 핵심 원장을 불러오지 못했습니다.",
      },
      { status: 503, headers: { "Retry-After": "30" } },
    );
  }
}
