import { loadStocktakeInterventionPlan } from "@/lib/stage8StocktakeInterventionPlan";

const DEFAULT_PRODUCT_MASTER_URL = "https://commerce-os-product-master.vercel.app";
const SHA256 = /^sha256:[a-f0-9]{64}$/;

export type ProductMasterStocktakePreview = {
  skuId: string;
  barcode: string;
  modelNo: string;
  productName: string;
  optionName: string;
  active: boolean;
  inventoryQuantity: number;
  inventoryVerification: string;
  inventoryVerified: boolean;
  inventoryBaselineKind: string | null;
  inventoryBaselineQuantity: number;
  inventoryLastMovementAt: string | null;
  inventoryRequiresReview: boolean;
  inventoryGuard: string;
  canaryEligible: boolean;
  writeEnabled: boolean;
};

export type StocktakeCanaryOperatorReadiness = {
  generatedAt: string;
  state: "READY_FOR_COUNT" | "WRITE_GATE_OFF" | "BLOCKED";
  message: string;
  barcode: string | null;
  name: string | null;
  modelNo: string | null;
  planFingerprint: string | null;
  sourceFingerprint: string | null;
  inventoryGuard: string | null;
  currentInventoryQuantity: number | null;
  inventoryVerification: string | null;
  inventoryBaselineKind: string | null;
  productMasterWriteEnabled: boolean;
  maxWriteRows: 1;
  purchaseWritesEnabled: false;
  priceWritesEnabled: false;
  receiptWritesEnabled: false;
};

function connection() {
  const secret = process.env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim();
  if (!secret) throw new Error("PRODUCT_MASTER_INTEGRATION_SECRET_REQUIRED");
  const baseUrl = (
    process.env.PRODUCT_MASTER_BASE_URL?.trim() || DEFAULT_PRODUCT_MASTER_URL
  ).replace(/\/$/, "");
  if (!/^https:\/\//.test(baseUrl)) throw new Error("PRODUCT_MASTER_BASE_URL_INVALID");
  return { baseUrl, secret };
}

function integerQuantity(value: unknown) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("STOCKTAKE_CANARY_PHYSICAL_QUANTITY_INVALID");
  }
  return parsed;
}

async function productMasterPreview(barcode: string) {
  const { baseUrl, secret } = connection();
  const response = await fetch(
    `${baseUrl}/api/integrations/stocktake-canary?barcode=${encodeURIComponent(barcode)}`,
    {
      headers: {
        accept: "application/json",
        "x-commerce-os-integration-secret": secret,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    },
  );
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    preview?: ProductMasterStocktakePreview;
    writeEnabled?: boolean;
    message?: string;
    error?: string;
  };
  if (!response.ok || body.ok !== true || !body.preview) {
    throw new Error(body.message || body.error || `STOCKTAKE_CANARY_PREVIEW_FAILED:${response.status}`);
  }
  return body.preview;
}

export async function loadStocktakeCanaryOperatorReadiness(): Promise<StocktakeCanaryOperatorReadiness> {
  const plan = await loadStocktakeInterventionPlan();
  const barcode = plan.firstCanaryBarcode;
  const row = barcode ? plan.rows.find((candidate) => candidate.barcode === barcode) ?? null : null;
  if (
    plan.state !== "READY_FOR_OPERATOR_COUNT" ||
    !barcode ||
    !row ||
    !SHA256.test(plan.planFingerprint)
  ) {
    return {
      generatedAt: new Date().toISOString(),
      state: "BLOCKED",
      message: "현재 Stage 8 계획에는 안전하게 실사할 1건 canary가 없습니다.",
      barcode: null,
      name: null,
      modelNo: null,
      planFingerprint: null,
      sourceFingerprint: plan.sourceFingerprint || null,
      inventoryGuard: null,
      currentInventoryQuantity: null,
      inventoryVerification: null,
      inventoryBaselineKind: null,
      productMasterWriteEnabled: false,
      maxWriteRows: 1,
      purchaseWritesEnabled: false,
      priceWritesEnabled: false,
      receiptWritesEnabled: false,
    };
  }

  const preview = await productMasterPreview(barcode);
  const identityOk =
    preview.barcode === barcode &&
    preview.active === true &&
    preview.canaryEligible === true &&
    preview.inventoryVerified === false &&
    preview.inventoryVerification === "UNVERIFIED" &&
    preview.inventoryBaselineKind === "INITIAL_ZERO" &&
    preview.inventoryRequiresReview === false &&
    SHA256.test(preview.inventoryGuard);
  if (!identityOk) {
    return {
      generatedAt: new Date().toISOString(),
      state: "BLOCKED",
      message: "Product Master 재고 상태가 Stage 8 canary 계획과 달라 실사를 적용하지 않습니다.",
      barcode,
      name: row.name,
      modelNo: row.modelNo,
      planFingerprint: plan.planFingerprint,
      sourceFingerprint: plan.sourceFingerprint,
      inventoryGuard: preview.inventoryGuard || null,
      currentInventoryQuantity: preview.inventoryQuantity,
      inventoryVerification: preview.inventoryVerification,
      inventoryBaselineKind: preview.inventoryBaselineKind,
      productMasterWriteEnabled: false,
      maxWriteRows: 1,
      purchaseWritesEnabled: false,
      priceWritesEnabled: false,
      receiptWritesEnabled: false,
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    state: preview.writeEnabled ? "READY_FOR_COUNT" : "WRITE_GATE_OFF",
    message: preview.writeEnabled
      ? "첫 canary의 실물 수량 1개 값만 입력하면 정확히 1개 STOCKTAKE를 저장하고 persisted readback을 검증합니다."
      : "첫 canary와 inventory guard는 일치하지만 Product Master의 1건 STOCKTAKE write 환경 게이트가 아직 꺼져 있습니다.",
    barcode,
    name: row.name,
    modelNo: row.modelNo,
    planFingerprint: plan.planFingerprint,
    sourceFingerprint: plan.sourceFingerprint,
    inventoryGuard: preview.inventoryGuard,
    currentInventoryQuantity: preview.inventoryQuantity,
    inventoryVerification: preview.inventoryVerification,
    inventoryBaselineKind: preview.inventoryBaselineKind,
    productMasterWriteEnabled: preview.writeEnabled,
    maxWriteRows: 1,
    purchaseWritesEnabled: false,
    priceWritesEnabled: false,
    receiptWritesEnabled: false,
  };
}

export async function applyStocktakeCanaryFromOperator(input: {
  physicalQuantity: unknown;
  expectedPlanFingerprint: unknown;
  expectedInventoryGuard: unknown;
}) {
  const physicalQuantity = integerQuantity(input.physicalQuantity);
  const expectedPlanFingerprint = String(input.expectedPlanFingerprint ?? "").trim();
  const expectedInventoryGuard = String(input.expectedInventoryGuard ?? "").trim();
  if (!SHA256.test(expectedPlanFingerprint) || !SHA256.test(expectedInventoryGuard)) {
    throw new Error("STOCKTAKE_CANARY_EXPECTED_GUARD_INVALID");
  }

  const readiness = await loadStocktakeCanaryOperatorReadiness();
  if (readiness.state !== "READY_FOR_COUNT" || !readiness.barcode) {
    throw new Error(`STOCKTAKE_CANARY_NOT_READY:${readiness.state}`);
  }
  if (
    readiness.planFingerprint !== expectedPlanFingerprint ||
    readiness.inventoryGuard !== expectedInventoryGuard
  ) {
    throw new Error("STOCKTAKE_CANARY_PRECONDITION_CHANGED");
  }

  const { baseUrl, secret } = connection();
  const response = await fetch(`${baseUrl}/api/integrations/stocktake-canary`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-commerce-os-integration-secret": secret,
    },
    body: JSON.stringify({
      barcode: readiness.barcode,
      physicalQuantity,
      expectedInventoryGuard,
      expectedPlanFingerprint,
      note: "Stage 8 operator-confirmed physical stocktake canary via Ops Center",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || body.ok !== true) {
    throw new Error(
      String(body.message || body.error || `STOCKTAKE_CANARY_APPLY_FAILED:${response.status}`),
    );
  }
  return body;
}
