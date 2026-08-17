import { resolveProductLaunchIdentity } from "@/lib/productLaunchTrackerServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 10;

const DEFAULT_PRODUCT_MASTER_URL = "https://commerce-os-product-master.vercel.app";
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const PRODUCT_MASTER_TIMEOUT_MS = 5_000;
const REVALIDATE_SECONDS = 15;

function positiveInteger(value: string | null, fallback: number, maximum?: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  const normalized = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return maximum ? Math.min(normalized, maximum) : normalized;
}

function productMasterConnection() {
  const secret = process.env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim();
  if (!secret) throw new Error("PRODUCT_MASTER_INTEGRATION_SECRET_REQUIRED");
  const baseUrl = (
    process.env.PRODUCT_MASTER_BASE_URL?.trim() || DEFAULT_PRODUCT_MASTER_URL
  ).replace(/\/$/, "");
  if (!/^https:\/\//.test(baseUrl)) {
    throw new Error("PRODUCT_MASTER_BASE_URL_INVALID");
  }
  return { baseUrl, secret };
}

export async function GET(request: Request) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });

  const incoming = new URL(request.url);
  const page = positiveInteger(incoming.searchParams.get("page"), 1);
  const pageSize = positiveInteger(
    incoming.searchParams.get("pageSize"),
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
  );
  const search = String(incoming.searchParams.get("search") ?? "")
    .normalize("NFKC")
    .trim()
    .slice(0, 160);

  try {
    const { baseUrl, secret } = productMasterConnection();
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      search,
    });
    const response = await fetch(
      `${baseUrl}/api/integrations/core-page?${params.toString()}`,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          "x-commerce-os-integration-secret": secret,
        },
        next: { revalidate: REVALIDATE_SECONDS },
        signal: AbortSignal.timeout(PRODUCT_MASTER_TIMEOUT_MS),
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true || !Array.isArray(payload?.products)) {
      throw new Error(
        payload?.message || `PRODUCT_MASTER_CORE_PAGE_FAILED:${response.status}`,
      );
    }
    return Response.json(
      {
        ...payload,
        source: "commerce-os-product-master",
        mode: "core-ledger-page",
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "private, max-age=0, stale-while-revalidate=30",
          "X-Commerce-Master-Source": "product-master-core-page",
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
      { status: 503, headers: { "Retry-After": "15" } },
    );
  }
}
