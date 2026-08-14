import { loadInternalChinaPurchaseDraft } from "@/lib/internalChinaPurchaseDraft";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import { syncDraftPurchaseMetadataToProductLaunch } from "@/lib/productLaunchDraftPurchaseMetadataBatchWrite";
import { resolveProductLaunchIdentity } from "@/lib/productLaunchTrackerServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

type RouteContext = {
  params: Promise<{ draftId: string }>;
};

type R = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function normalizeBarcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function normalizeModelNumber(value: unknown) {
  const compact = text(value).toUpperCase().replace(/\s+/g, "");
  const match = compact.match(/^AAA0*(\d+)$/);
  return match ? `AAA${match[1].padStart(3, "0")}` : compact;
}

function unauthorized() {
  return Response.json(
    {
      ok: false,
      code: "INTERNAL_CHINA_PURCHASE_METADATA_UNAUTHORIZED",
      message: "Ops Center 동일 출처 화면에서만 구매정보를 저장할 수 있습니다.",
      externalOrderExecuted: false,
    },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

function errorResponse(error: unknown) {
  const raw = error instanceof Error ? error.message : "PURCHASE_METADATA_SYNC_FAILED";
  const code = raw.split(":", 1)[0] || "PURCHASE_METADATA_SYNC_FAILED";
  let message = raw;
  if (code === "PRODUCT_LAUNCH_SUPPLIER_LINK_INVALID") {
    message = "올바른 http/https 1688 링크를 입력하세요.";
  } else if (code === "PRODUCT_LAUNCH_SUPPLIER_LINK_TOO_LONG") {
    message = "중국 주문링크는 4,000자 이하로 입력하세요.";
  } else if (code === "PRODUCT_LAUNCH_MODEL_LINK_CONFLICT") {
    message = `같은 모델에 서로 다른 1688 링크가 입력됐습니다: ${raw.split(":").slice(1).join(":")}`;
  } else if (code === "PRODUCT_LAUNCH_MODEL_CONFLICT") {
    message = `상품출시진행관리에 같은 모델번호가 여러 건 있어 자동 역저장을 중단했습니다: ${raw.split(":").slice(1).join(":")}`;
  } else if (code === "PRODUCT_LAUNCH_CONCURRENT_UPDATE") {
    message = "상품출시진행관리 데이터가 동시에 변경됐습니다. 새로고침한 뒤 다시 저장하세요.";
  } else if (code === "INTERNAL_CHINA_DRAFT_ALREADY_ORDERED") {
    message = "이미 실주문 기록이 끝난 Draft는 구매정보를 변경할 수 없습니다.";
  }
  const conflict = [
    "PRODUCT_LAUNCH_MODEL_LINK_CONFLICT",
    "PRODUCT_LAUNCH_MODEL_CONFLICT",
    "PRODUCT_LAUNCH_CONCURRENT_UPDATE",
  ].includes(code);
  return Response.json(
    { ok: false, code, message, externalOrderExecuted: false },
    {
      status: conflict ? 409 : 400,
      headers: { "cache-control": "no-store" },
    },
  );
}

export async function POST(request: Request, context: RouteContext) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) {
    return Response.json(identity.body, {
      status: identity.status,
      headers: { "cache-control": "no-store" },
    });
  }

  const { draftId: rawDraftId } = await context.params;
  const draftId = decodeURIComponent(rawDraftId);
  try {
    const current = await loadInternalChinaPurchaseDraft(draftId);
    if (current.status !== "DRAFT") {
      throw new Error("INTERNAL_CHINA_DRAFT_ALREADY_ORDERED");
    }
    const body = (await request.json().catch(() => ({}))) as {
      lines?: unknown;
    };
    const incoming = Array.isArray(body.lines)
      ? body.lines.filter(
          (row): row is R => Boolean(row && typeof row === "object" && !Array.isArray(row)),
        )
      : [];
    const currentByBarcode = new Map(
      current.lines.map((line) => [normalizeBarcode(line.barcode), line] as const),
    );
    const safeLines = incoming.map((row) => {
      const barcode = normalizeBarcode(row.barcode);
      const source = currentByBarcode.get(barcode);
      if (!source) {
        throw new Error(`INTERNAL_CHINA_DRAFT_LINE_INVALID:${barcode || "UNKNOWN"}`);
      }
      const incomingModel = normalizeModelNumber(row.modelNo);
      const sourceModel = normalizeModelNumber(source.modelNo);
      if (incomingModel && incomingModel !== sourceModel) {
        throw new Error(`INTERNAL_CHINA_DRAFT_MODEL_LOCKED:${barcode}`);
      }
      return {
        barcode,
        modelNo: sourceModel,
        supplierLink: row.supplierLink,
        chinaOption: row.chinaOption,
      };
    });

    const result = await syncDraftPurchaseMetadataToProductLaunch({
      identity: identity.value,
      draftId,
      lines: safeLines,
    });
    const draft = await loadInternalChinaPurchaseDraft(draftId);
    return Response.json(
      {
        ok: true,
        draft,
        syncedModels: result.syncedModels,
        syncedBcodes: result.syncedBcodes,
        syncedLinks: result.syncedLinks,
        syncedChinaOptions: result.syncedChinaOptions,
        warnings: result.warnings,
        productMasterSynced: result.productMaster.ok,
        productMasterError: result.productMaster.error ?? null,
        message: result.productMaster.ok
          ? "Draft 구매정보를 상품출시진행관리와 상품마스터 최신 원장에 양방향 반영했습니다."
          : `상품출시진행관리에는 반영했지만 상품마스터 최신 원장 동기화를 확인해야 합니다: ${result.productMaster.error}`,
        externalOrderExecuted: false,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
