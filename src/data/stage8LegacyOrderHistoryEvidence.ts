export type LegacyOrderHistoryIdentityScope = "MODEL" | "OPTION_NORMALIZED";
export type LegacyOrderHistoryLatestEvidenceState = "EXACT" | "NEEDS_EXACT_ROW";

export type LegacyOrderHistoryEvidence = {
  barcode: string;
  modelNo: string;
  identityScope: LegacyOrderHistoryIdentityScope;
  normalizedOption: string | null;
  safeCumulativeOrderQuantity: number;
  latestSafeOrderDate: string;
  latestSafeOrderQuantity: number | null;
  latestOrderEvidenceState: LegacyOrderHistoryLatestEvidenceState;
  recentThreeOrderQuantity: number | null;
  excludedAmbiguousQuantity: number;
  unmappedOtherOptionQuantity: number;
  excludedReasons: string[];
  modelCumulativeChecksum: number;
  sourceProductKeyCount: number;
  sourceValidRecordCount: number;
  sourceArtifact: string;
  sourceSheet: string;
  evidenceKind: "ORDER_HISTORY_SURROGATE";
  confirmedInbound: false;
  inventoryUseAllowed: false;
  inventoryPromotionAllowed: false;
  businessWritesEnabled: false;
};

const SOURCE_ARTIFACT = "1차_중국발주이력_안전원가_안전판매가_신규산출.xlsx";
const SOURCE_SHEET = "상품별 안전원가 / 모델번호별 요약";

const EVIDENCE: LegacyOrderHistoryEvidence[] = [
  {
    barcode: "BGB1-1",
    modelNo: "aaa266",
    identityScope: "MODEL",
    normalizedOption: null,
    safeCumulativeOrderQuantity: 3010,
    latestSafeOrderDate: "2025-10-01",
    latestSafeOrderQuantity: 2000,
    latestOrderEvidenceState: "EXACT",
    recentThreeOrderQuantity: 3000,
    excludedAmbiguousQuantity: 0,
    unmappedOtherOptionQuantity: 0,
    excludedReasons: [],
    modelCumulativeChecksum: 3010,
    sourceProductKeyCount: 1,
    sourceValidRecordCount: 4,
    sourceArtifact: SOURCE_ARTIFACT,
    sourceSheet: SOURCE_SHEET,
    evidenceKind: "ORDER_HISTORY_SURROGATE",
    confirmedInbound: false,
    inventoryUseAllowed: false,
    inventoryPromotionAllowed: false,
    businessWritesEnabled: false,
  },
  {
    barcode: "BGE1-1",
    modelNo: "aaa045",
    identityScope: "OPTION_NORMALIZED",
    normalizedOption: "BLACK",
    safeCumulativeOrderQuantity: 825,
    latestSafeOrderDate: "2026-05-06",
    latestSafeOrderQuantity: 150,
    latestOrderEvidenceState: "EXACT",
    recentThreeOrderQuantity: null,
    excludedAmbiguousQuantity: 30,
    unmappedOtherOptionQuantity: 60,
    excludedReasons: [
      "aaa045 상품명에 블랙이 포함되지만 옵션이 그레이인 30개 행은 BGE1-1/BGE2-1 모두에서 제외",
      "화이트 옵션 60개는 현재 BGE1-1/BGE2-1 어느 B-code에도 배정하지 않음",
    ],
    modelCumulativeChecksum: 1785,
    sourceProductKeyCount: 3,
    sourceValidRecordCount: 9,
    sourceArtifact: SOURCE_ARTIFACT,
    sourceSheet: SOURCE_SHEET,
    evidenceKind: "ORDER_HISTORY_SURROGATE",
    confirmedInbound: false,
    inventoryUseAllowed: false,
    inventoryPromotionAllowed: false,
    businessWritesEnabled: false,
  },
  {
    barcode: "BGE2-1",
    modelNo: "aaa045",
    identityScope: "OPTION_NORMALIZED",
    normalizedOption: "GRAY",
    safeCumulativeOrderQuantity: 870,
    latestSafeOrderDate: "2025-07-26",
    latestSafeOrderQuantity: 350,
    latestOrderEvidenceState: "EXACT",
    recentThreeOrderQuantity: null,
    excludedAmbiguousQuantity: 30,
    unmappedOtherOptionQuantity: 60,
    excludedReasons: [
      "aaa045 상품명에 블랙이 포함되지만 옵션이 그레이인 30개 행은 BGE1-1/BGE2-1 모두에서 제외",
      "화이트 옵션 60개는 현재 BGE1-1/BGE2-1 어느 B-code에도 배정하지 않음",
    ],
    modelCumulativeChecksum: 1785,
    sourceProductKeyCount: 3,
    sourceValidRecordCount: 5,
    sourceArtifact: SOURCE_ARTIFACT,
    sourceSheet: SOURCE_SHEET,
    evidenceKind: "ORDER_HISTORY_SURROGATE",
    confirmedInbound: false,
    inventoryUseAllowed: false,
    inventoryPromotionAllowed: false,
    businessWritesEnabled: false,
  },
  {
    barcode: "BGD2-1",
    modelNo: "aaa409",
    identityScope: "MODEL",
    normalizedOption: null,
    safeCumulativeOrderQuantity: 4910,
    latestSafeOrderDate: "2026-04-01",
    latestSafeOrderQuantity: null,
    latestOrderEvidenceState: "NEEDS_EXACT_ROW",
    recentThreeOrderQuantity: 4900,
    excludedAmbiguousQuantity: 0,
    unmappedOtherOptionQuantity: 0,
    excludedReasons: [
      "모델 누적 4,910개와 최근 3회 4,900개는 확인되지만 최신 1회 주문수량은 요약자료만으로 확정하지 않음",
    ],
    modelCumulativeChecksum: 4910,
    sourceProductKeyCount: 1,
    sourceValidRecordCount: 4,
    sourceArtifact: SOURCE_ARTIFACT,
    sourceSheet: SOURCE_SHEET,
    evidenceKind: "ORDER_HISTORY_SURROGATE",
    confirmedInbound: false,
    inventoryUseAllowed: false,
    inventoryPromotionAllowed: false,
    businessWritesEnabled: false,
  },
  {
    barcode: "BGG1-1",
    modelNo: "aaa316",
    identityScope: "MODEL",
    normalizedOption: null,
    safeCumulativeOrderQuantity: 11533,
    latestSafeOrderDate: "2025-09-29",
    latestSafeOrderQuantity: 6000,
    latestOrderEvidenceState: "EXACT",
    recentThreeOrderQuantity: 11500,
    excludedAmbiguousQuantity: 0,
    unmappedOtherOptionQuantity: 0,
    excludedReasons: [],
    modelCumulativeChecksum: 11533,
    sourceProductKeyCount: 1,
    sourceValidRecordCount: 5,
    sourceArtifact: SOURCE_ARTIFACT,
    sourceSheet: SOURCE_SHEET,
    evidenceKind: "ORDER_HISTORY_SURROGATE",
    confirmedInbound: false,
    inventoryUseAllowed: false,
    inventoryPromotionAllowed: false,
    businessWritesEnabled: false,
  },
];

export function legacyOrderHistoryEvidence() {
  return EVIDENCE.map((row) => ({
    ...row,
    excludedReasons: [...row.excludedReasons],
  }));
}

export function legacyOrderHistoryEvidenceByBarcode() {
  return new Map(legacyOrderHistoryEvidence().map((row) => [row.barcode, row] as const));
}
