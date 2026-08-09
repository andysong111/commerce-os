import { createHash } from "node:crypto";
import { loadShoplingCurrentModelSnapshot } from "@/lib/shopling/shoplingCurrentModelIdentity";
import { loadPurchaseCandidateShoplingIdentityAudit } from "@/lib/stage8PurchaseCandidateShoplingIdentityAudit";

export type ShoplingLiveModelIdentityState =
  | "EXACT_SINGLE_MODEL_SET"
  | "EXACT_MULTI_MODEL_SET"
  | "PARTIAL_MODEL_EVIDENCE"
  | "GOODS_KEY_MODEL_CONFLICT"
  | "NO_EXACT_AAA_MODEL";

export type PriorModelComparison =
  | "NO_PRIOR_EXACT"
  | "PRIOR_INCLUDED"
  | "PRIOR_CONFLICT";

export type ShoplingLiveModelIdentityAuditRow = {
  barcode: string;
  productName: string;
  goodsKeys: string[];
  exactModelNos: string[];
  allObservedModelNos: string[];
  modelNames: string[];
  exactGoodsKeyCount: number;
  nonAaaGoodsKeyCount: number;
  blankGoodsKeyCount: number;
  conflictGoodsKeyCount: number;
  missingGoodsKeyCount: number;
  state: ShoplingLiveModelIdentityState;
  priorRecoveredModelNo: string | null;
  priorComparison: PriorModelComparison;
  currentShoplingModelEvidenceReady: boolean;
  modelRecoveryPromotionAllowed: false;
  historicalOrderJoinAllowed: false;
  inventoryUseAllowed: false;
  inventoryPromotionAllowed: false;
  purchaseWritesEnabled: false;
  inventoryWritesEnabled: false;
  shoplingWritesEnabled: false;
};

export type ShoplingLiveModelIdentityAudit = {
  generatedAt: string;
  state: "READY_READ_ONLY" | "BLOCKED";
  message: string;
  purchaseCandidateCount: number;
  queriedGoodsKeyCount: number;
  sourceRowCount: number;
  exactAaaGoodsKeyCount: number;
  exactSingleModelSetCount: number;
  exactMultiModelSetCount: number;
  partialModelEvidenceCount: number;
  goodsKeyModelConflictCount: number;
  noExactAaaModelCount: number;
  priorIncludedCount: number;
  priorConflictCount: number;
  fingerprint: string;
  modelRecoveryPromotionAllowed: false;
  historicalOrderJoinAllowed: false;
  inventoryUseAllowed: false;
  inventoryPromotionAllowed: false;
  purchaseWritesEnabled: false;
  inventoryWritesEnabled: false;
  shoplingWritesEnabled: false;
  rows: ShoplingLiveModelIdentityAuditRow[];
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function normalizeModel(value: unknown) {
  return text(value).toLowerCase();
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export async function loadShoplingLiveModelIdentityAudit(): Promise<ShoplingLiveModelIdentityAudit> {
  const identity = await loadPurchaseCandidateShoplingIdentityAudit();
  const goodsKeys = [...new Set(identity.rows.flatMap((row) => row.goodsKeys))].sort(
    (left, right) => Number(left) - Number(right),
  );
  const live = await loadShoplingCurrentModelSnapshot(goodsKeys);
  const liveByGoodsKey = new Map(live.rows.map((row) => [row.goodsKey, row] as const));

  const rows = identity.rows
    .map((candidate): ShoplingLiveModelIdentityAuditRow => {
      const sourceRows = candidate.goodsKeys
        .map((goodsKey) => liveByGoodsKey.get(goodsKey))
        .filter((row): row is NonNullable<typeof row> => Boolean(row));
      const exactModelNos = [
        ...new Set(
          sourceRows
            .filter((row) => row.state === "EXACT_AAA")
            .flatMap((row) => row.modelNos.map(normalizeModel)),
        ),
      ].sort();
      const allObservedModelNos = [
        ...new Set(sourceRows.flatMap((row) => row.modelNos.map(normalizeModel))),
      ].sort();
      const modelNames = [
        ...new Set(sourceRows.flatMap((row) => row.modelNames.map(text)).filter(Boolean)),
      ].sort();
      const exactGoodsKeyCount = sourceRows.filter(
        (row) => row.state === "EXACT_AAA",
      ).length;
      const nonAaaGoodsKeyCount = sourceRows.filter(
        (row) => row.state === "NON_AAA",
      ).length;
      const blankGoodsKeyCount = sourceRows.filter((row) => row.state === "BLANK").length;
      const conflictGoodsKeyCount = sourceRows.filter(
        (row) => row.state === "CONFLICT",
      ).length;
      const missingGoodsKeyCount = candidate.goodsKeys.filter(
        (goodsKey) => liveByGoodsKey.get(goodsKey)?.state === "MISSING" || !liveByGoodsKey.has(goodsKey),
      ).length;
      const completeExact =
        candidate.goodsKeys.length > 0 &&
        exactGoodsKeyCount === candidate.goodsKeys.length &&
        nonAaaGoodsKeyCount === 0 &&
        blankGoodsKeyCount === 0 &&
        conflictGoodsKeyCount === 0 &&
        missingGoodsKeyCount === 0;
      const state: ShoplingLiveModelIdentityState =
        conflictGoodsKeyCount > 0
          ? "GOODS_KEY_MODEL_CONFLICT"
          : completeExact && exactModelNos.length === 1
            ? "EXACT_SINGLE_MODEL_SET"
            : completeExact && exactModelNos.length > 1
              ? "EXACT_MULTI_MODEL_SET"
              : exactModelNos.length > 0
                ? "PARTIAL_MODEL_EVIDENCE"
                : "NO_EXACT_AAA_MODEL";
      const priorRecoveredModelNo = candidate.recoveredExactModelNo
        ? normalizeModel(candidate.recoveredExactModelNo)
        : null;
      const priorComparison: PriorModelComparison = !priorRecoveredModelNo
        ? "NO_PRIOR_EXACT"
        : exactModelNos.includes(priorRecoveredModelNo)
          ? "PRIOR_INCLUDED"
          : exactModelNos.length > 0
            ? "PRIOR_CONFLICT"
            : "NO_PRIOR_EXACT";

      return {
        barcode: candidate.barcode,
        productName: candidate.productName,
        goodsKeys: candidate.goodsKeys,
        exactModelNos,
        allObservedModelNos,
        modelNames,
        exactGoodsKeyCount,
        nonAaaGoodsKeyCount,
        blankGoodsKeyCount,
        conflictGoodsKeyCount,
        missingGoodsKeyCount,
        state,
        priorRecoveredModelNo,
        priorComparison,
        currentShoplingModelEvidenceReady:
          state === "EXACT_SINGLE_MODEL_SET" || state === "EXACT_MULTI_MODEL_SET",
        modelRecoveryPromotionAllowed: false,
        historicalOrderJoinAllowed: false,
        inventoryUseAllowed: false,
        inventoryPromotionAllowed: false,
        purchaseWritesEnabled: false,
        inventoryWritesEnabled: false,
        shoplingWritesEnabled: false,
      };
    })
    .sort(
      (left, right) =>
        statePriority(left.state) - statePriority(right.state) ||
        left.barcode.localeCompare(right.barcode),
    );

  const ready = identity.state === "READY_READ_ONLY" && live.queriedGoodsKeyCount > 0;
  const stable = rows.map((row) => ({
    barcode: row.barcode,
    goodsKeys: row.goodsKeys,
    exactModelNos: row.exactModelNos,
    allObservedModelNos: row.allObservedModelNos,
    modelNames: row.modelNames,
    exactGoodsKeyCount: row.exactGoodsKeyCount,
    nonAaaGoodsKeyCount: row.nonAaaGoodsKeyCount,
    blankGoodsKeyCount: row.blankGoodsKeyCount,
    conflictGoodsKeyCount: row.conflictGoodsKeyCount,
    missingGoodsKeyCount: row.missingGoodsKeyCount,
    state: row.state,
    priorRecoveredModelNo: row.priorRecoveredModelNo,
    priorComparison: row.priorComparison,
  }));

  return {
    generatedAt: new Date().toISOString(),
    state: ready ? "READY_READ_ONLY" : "BLOCKED",
    message: ready
      ? "샵플링 상품조회 API의 model_no/model_nm을 현재 42개 발주후보의 활성 goods_key에 한정해 실시간 조회했습니다. 모든 goods_key가 exact aaa 모델번호를 반환하는 경우에만 완전증거로 분류하며, 여러 aaa 모델이 실제로 존재하면 그대로 MULTI로 보존합니다. 이 단계는 현재 Shopling 증거를 읽는 것뿐이며 모델번호 복구·과거발주 연결·재고승격은 자동 실행하지 않습니다."
      : "현재 발주후보 Shopling 식별자 또는 live model_no 조회가 준비되지 않아 모델번호 증거를 사용하지 않습니다.",
    purchaseCandidateCount: rows.length,
    queriedGoodsKeyCount: live.queriedGoodsKeyCount,
    sourceRowCount: live.sourceRowCount,
    exactAaaGoodsKeyCount: live.exactAaaCount,
    exactSingleModelSetCount: rows.filter(
      (row) => row.state === "EXACT_SINGLE_MODEL_SET",
    ).length,
    exactMultiModelSetCount: rows.filter(
      (row) => row.state === "EXACT_MULTI_MODEL_SET",
    ).length,
    partialModelEvidenceCount: rows.filter(
      (row) => row.state === "PARTIAL_MODEL_EVIDENCE",
    ).length,
    goodsKeyModelConflictCount: rows.filter(
      (row) => row.state === "GOODS_KEY_MODEL_CONFLICT",
    ).length,
    noExactAaaModelCount: rows.filter(
      (row) => row.state === "NO_EXACT_AAA_MODEL",
    ).length,
    priorIncludedCount: rows.filter((row) => row.priorComparison === "PRIOR_INCLUDED").length,
    priorConflictCount: rows.filter((row) => row.priorComparison === "PRIOR_CONFLICT").length,
    fingerprint: sha256({
      identityFingerprint: identity.fingerprint,
      liveGeneratedAt: live.generatedAt,
      liveState: live.state,
      queriedGoodsKeyCount: live.queriedGoodsKeyCount,
      sourceRowCount: live.sourceRowCount,
      rows: stable,
    }),
    modelRecoveryPromotionAllowed: false,
    historicalOrderJoinAllowed: false,
    inventoryUseAllowed: false,
    inventoryPromotionAllowed: false,
    purchaseWritesEnabled: false,
    inventoryWritesEnabled: false,
    shoplingWritesEnabled: false,
    rows,
  };
}

function statePriority(state: ShoplingLiveModelIdentityState) {
  if (state === "EXACT_SINGLE_MODEL_SET") return 0;
  if (state === "EXACT_MULTI_MODEL_SET") return 1;
  if (state === "PARTIAL_MODEL_EVIDENCE") return 2;
  if (state === "GOODS_KEY_MODEL_CONFLICT") return 3;
  return 4;
}
