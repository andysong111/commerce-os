import { loadProductMasterShoplingSalesStatus } from "@/lib/productMasterShoplingSalesBackfill";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function unauthorized() {
  return Response.json(
    {
      ok: false,
      code: "PRODUCT_MASTER_SHOPLING_SALES_UNMAPPED_CONTEXT_UNAUTHORIZED",
      message: "상품마스터 판매원장 진단 권한이 필요합니다.",
    },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();

  try {
    const [status, planning] = await Promise.all([
      loadProductMasterShoplingSalesStatus(),
      loadProductPlanningSnapshot(),
    ]);
    const samples = (status.report?.unmappedSamples ?? []).slice(0, 50);
    const rows = samples.map((raw) => {
      const sample = raw as Record<string, unknown>;
      const managedCode = text(sample.managedCode).toUpperCase();
      const optionId = text(sample.optionId);
      const productId = text(sample.productId);
      const mallProductKey = text(sample.mallProductKey);
      const goodsKeys = new Set([productId, mallProductKey].filter(Boolean));

      const matches = (planning.products ?? [])
        .filter((product) => {
          if (managedCode && text(product.barcode).toUpperCase() === managedCode) {
            return true;
          }
          return (product.listings ?? []).some((listing) => {
            const listingOptionId = text(listing.optionId);
            const goodsKey = text(listing.goodsKey);
            return (
              (optionId && listingOptionId === optionId) ||
              (goodsKey && goodsKeys.has(goodsKey))
            );
          });
        })
        .slice(0, 20)
        .map((product) => ({
          skuId: text(product.skuId),
          barcode: text(product.barcode).toUpperCase(),
          productName: text(product.productName),
          optionName: text(product.optionName),
          skuActive: product.skuActive !== false,
          barcodeExact: Boolean(
            managedCode && text(product.barcode).toUpperCase() === managedCode,
          ),
          relevantListings: (product.listings ?? [])
            .filter((listing) => {
              const listingOptionId = text(listing.optionId);
              const goodsKey = text(listing.goodsKey);
              return (
                (optionId && listingOptionId === optionId) ||
                (goodsKey && goodsKeys.has(goodsKey)) ||
                Boolean(
                  managedCode &&
                    text(product.barcode).toUpperCase() === managedCode,
                )
              );
            })
            .slice(0, 30)
            .map((listing) => ({
              goodsKey: text(listing.goodsKey),
              optionId: text(listing.optionId),
              unitsPerOrder: Math.max(
                1,
                Math.round(Number(listing.unitsPerOrder) || 1),
              ),
              active: listing.active !== false,
            })),
        }));

      return {
        orderLineId: text(sample.orderLineId),
        orderNo: text(sample.orderNo),
        orderedAt: text(sample.orderedAt),
        optionId: optionId || null,
        productId: productId || null,
        mallProductKey: mallProductKey || null,
        managedCode: managedCode || null,
        status: text(sample.status),
        currentProductMatches: matches,
      };
    });

    return Response.json(
      {
        ok: true,
        salesRequestId: status.requestId,
        salesState: status.state,
        unmappedRows: status.unmappedRows,
        sampleCount: rows.length,
        rows,
        sourceReadsPerformed: true,
        businessWritesPerformed: false,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_MASTER_SHOPLING_SALES_UNMAPPED_CONTEXT_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "미연결 주문 현재 상품마스터 대조에 실패했습니다.",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
