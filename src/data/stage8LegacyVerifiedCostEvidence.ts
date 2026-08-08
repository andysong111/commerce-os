export type LegacyVerifiedPurchaseCostEvidence = {
  barcode: string;
  modelNo: string;
  productName: string;
  optionName: string;
  unitCostKrw: number;
  costDate: string;
  sourceWorkbook: string;
  sourceSheet: string;
  confidence: "A";
  costBasis: string;
  identityEvidence: string;
  evidenceClass: "LEGACY_VERIFIED_COST_EVIDENCE";
  purchaseUseAllowed: true;
  priceUseAllowed: false;
  confirmedReceiptUseAllowed: false;
  inventoryWriteAllowed: false;
};

/**
 * Curated from the user's previously validated historical China inbound-cost
 * workbooks and exact SKU/model mapping evidence. These rows are intentionally
 * NOT receipt confirmations. They may only satisfy the purchase-cost trust gate
 * in Stage 8, and the purchase engine must take max(current shadow estimate,
 * ceil(legacy evidence)) so this evidence can never lower the existing budget
 * cost assumption. Price, inventory and receipt ledgers remain blocked.
 */
export const STAGE8_LEGACY_VERIFIED_PURCHASE_COST_EVIDENCE = [
  {
    barcode: "BGG1-1",
    modelNo: "aaa316",
    productName: "계란펀칭기",
    optionName: "단품",
    unitCostKrw: 245.70952999869235,
    costDate: "2025-09-29",
    sourceWorkbook: "중국입고원가_정상판매가_최종확정_v4_옵션최고가통일_20260809.xlsx",
    sourceSheet: "20250929 주문시작(온돌패스)",
    confidence: "A",
    costBasis: "재계산: 운임미포함 매입가 + 모델단위 중국내운임 배분",
    identityEvidence:
      "aaa316 계란펀칭기 위치코드 보정 검증: 상품 121111의 잔존 BAA0-1을 BGG1-1로 수정하고 전체 옵션 재검증",
    evidenceClass: "LEGACY_VERIFIED_COST_EVIDENCE",
    purchaseUseAllowed: true,
    priceUseAllowed: false,
    confirmedReceiptUseAllowed: false,
    inventoryWriteAllowed: false,
  },
  {
    barcode: "BGE1-1",
    modelNo: "aaa045",
    productName: "그늘막 썬캡",
    optionName: "블랙",
    unitCostKrw: 3120.9248885702023,
    costDate: "2026-05-06",
    sourceWorkbook: "중국입고원가_정상판매가_최종확정_v4_옵션최고가통일_20260809.xlsx",
    sourceSheet: "20260506 주문시작(온돌패스59신청서작성)",
    confidence: "A",
    costBasis: "해당 상품 1개당 매입가 최종(상품별 중국내 운임 포함)",
    identityEvidence:
      "상품_옵션_위치코드_정리 및 원본대조 검수에서 BGE1-1 = aaa045 그늘막 썬캡 블랙 정확 매핑",
    evidenceClass: "LEGACY_VERIFIED_COST_EVIDENCE",
    purchaseUseAllowed: true,
    priceUseAllowed: false,
    confirmedReceiptUseAllowed: false,
    inventoryWriteAllowed: false,
  },
  {
    barcode: "BGE2-1",
    modelNo: "aaa045",
    productName: "그늘막 썬캡",
    optionName: "그레이",
    unitCostKrw: 3038.414888570202,
    costDate: "2026-05-06",
    sourceWorkbook: "중국입고원가_정상판매가_최종확정_v4_옵션최고가통일_20260809.xlsx",
    sourceSheet: "20260506 주문시작(온돌패스59신청서작성)",
    confidence: "A",
    costBasis: "해당 상품 1개당 매입가 최종(상품별 중국내 운임 포함)",
    identityEvidence:
      "상품_옵션_위치코드_정리 및 원본대조 검수에서 BGE2-1 = aaa045 그늘막 썬캡 그레이 정확 매핑",
    evidenceClass: "LEGACY_VERIFIED_COST_EVIDENCE",
    purchaseUseAllowed: true,
    priceUseAllowed: false,
    confirmedReceiptUseAllowed: false,
    inventoryWriteAllowed: false,
  },
  {
    barcode: "BGD2-1",
    modelNo: "aaa409",
    productName: "12자리주차번호판",
    optionName: "단품",
    unitCostKrw: 172.35083656967234,
    costDate: "2026-04-01",
    sourceWorkbook: "중국입고원가_정상판매가_최종확정_v2_20260808.xlsx",
    sourceSheet: "20260401 주문시작(온돌패스)의 사본",
    confidence: "A",
    costBasis: "해당 상품 1개당 매입가 최종(상품별 중국내 운임 포함)",
    identityEvidence:
      "상품_옵션_위치코드_정리 및 원본대조 검수에서 BGD2-1 = aaa409 12자리주차번호판 단품 정확 매핑",
    evidenceClass: "LEGACY_VERIFIED_COST_EVIDENCE",
    purchaseUseAllowed: true,
    priceUseAllowed: false,
    confirmedReceiptUseAllowed: false,
    inventoryWriteAllowed: false,
  },
  {
    barcode: "BAC3-1",
    modelNo: "aaa153",
    productName: "풀페이스 김서림방지 안면보호대",
    optionName: "단품",
    unitCostKrw: 1550.9653452337711,
    costDate: "2026-06-01",
    sourceWorkbook: "중국입고원가_정상판매가_최종확정_v4_옵션최고가통일_20260809.xlsx",
    sourceSheet: "20260601 주문시작(온돌패스)",
    confidence: "A",
    costBasis: "원가 산정 정상판매가 유지",
    identityEvidence:
      "현재 BAC3-1 계열 상품 goods_key 117574를 가격안전검사에서 aaa153으로 모델명 정확매칭",
    evidenceClass: "LEGACY_VERIFIED_COST_EVIDENCE",
    purchaseUseAllowed: true,
    priceUseAllowed: false,
    confirmedReceiptUseAllowed: false,
    inventoryWriteAllowed: false,
  },
  {
    barcode: "BAE1-3",
    modelNo: "aaa166",
    productName: "셀프이발망토",
    optionName: "단품",
    unitCostKrw: 1894.9709543403128,
    costDate: "2026-01-07",
    sourceWorkbook: "중국입고원가_정상판매가_최종확정_v4_옵션최고가통일_20260809.xlsx",
    sourceSheet: "20260107 주문시작(온돌패스)",
    confidence: "A",
    costBasis: "재계산: 운임미포함 매입가 + 모델단위 중국내운임 배분",
    identityEvidence:
      "현재 BAE1-3 계열 상품 goods_key 118045 = aaa166 셀프이발망토 단품으로 반복 확인",
    evidenceClass: "LEGACY_VERIFIED_COST_EVIDENCE",
    purchaseUseAllowed: true,
    priceUseAllowed: false,
    confirmedReceiptUseAllowed: false,
    inventoryWriteAllowed: false,
  },
] as const satisfies readonly LegacyVerifiedPurchaseCostEvidence[];

export function legacyVerifiedPurchaseCostEvidenceByBarcode(): Map<
  string,
  LegacyVerifiedPurchaseCostEvidence
> {
  return new Map<string, LegacyVerifiedPurchaseCostEvidence>(
    STAGE8_LEGACY_VERIFIED_PURCHASE_COST_EVIDENCE.map((row) => [
      row.barcode,
      row,
    ]),
  );
}
