export type LegacyModelIdentityEvidence = {
  barcode: string;
  recoveredModelNo: string;
  sourceArtifact: string;
  sourceSheet: string;
  sourceProductName: string;
  sourceOptionName: string | null;
  evidenceKind: "DIRECT_LOCATION_MODEL_MAPPING";
  confidence: "EXACT";
  orderHistoryConfirmedInbound: false;
  inventoryUseAllowed: false;
  businessWritesEnabled: false;
};

const SOURCE_ARTIFACT = "상품_옵션_위치코드_정리.xlsx";
const SOURCE_SHEET = "정리본";

const EVIDENCE: LegacyModelIdentityEvidence[] = [
  {
    barcode: "BGB1-1",
    recoveredModelNo: "aaa266",
    sourceArtifact: SOURCE_ARTIFACT,
    sourceSheet: SOURCE_SHEET,
    sourceProductName: "대쉬보드 거치대 A형 / 차량용 백미러 거치대 A형",
    sourceOptionName: null,
    evidenceKind: "DIRECT_LOCATION_MODEL_MAPPING",
    confidence: "EXACT",
    orderHistoryConfirmedInbound: false,
    inventoryUseAllowed: false,
    businessWritesEnabled: false,
  },
  {
    barcode: "BGE1-1",
    recoveredModelNo: "aaa045",
    sourceArtifact: SOURCE_ARTIFACT,
    sourceSheet: SOURCE_SHEET,
    sourceProductName: "그늘막 썬캡",
    sourceOptionName: "블랙",
    evidenceKind: "DIRECT_LOCATION_MODEL_MAPPING",
    confidence: "EXACT",
    orderHistoryConfirmedInbound: false,
    inventoryUseAllowed: false,
    businessWritesEnabled: false,
  },
  {
    barcode: "BGE2-1",
    recoveredModelNo: "aaa045",
    sourceArtifact: SOURCE_ARTIFACT,
    sourceSheet: SOURCE_SHEET,
    sourceProductName: "그늘막 썬캡",
    sourceOptionName: "그레이",
    evidenceKind: "DIRECT_LOCATION_MODEL_MAPPING",
    confidence: "EXACT",
    orderHistoryConfirmedInbound: false,
    inventoryUseAllowed: false,
    businessWritesEnabled: false,
  },
  {
    barcode: "BGD2-1",
    recoveredModelNo: "aaa409",
    sourceArtifact: SOURCE_ARTIFACT,
    sourceSheet: SOURCE_SHEET,
    sourceProductName: "12자리주차번호판",
    sourceOptionName: null,
    evidenceKind: "DIRECT_LOCATION_MODEL_MAPPING",
    confidence: "EXACT",
    orderHistoryConfirmedInbound: false,
    inventoryUseAllowed: false,
    businessWritesEnabled: false,
  },
  {
    barcode: "BGG1-1",
    recoveredModelNo: "aaa316",
    sourceArtifact: SOURCE_ARTIFACT,
    sourceSheet: SOURCE_SHEET,
    sourceProductName: "계란펀칭기",
    sourceOptionName: null,
    evidenceKind: "DIRECT_LOCATION_MODEL_MAPPING",
    confidence: "EXACT",
    orderHistoryConfirmedInbound: false,
    inventoryUseAllowed: false,
    businessWritesEnabled: false,
  },
];

export function legacyModelIdentityEvidence() {
  return EVIDENCE.map((row) => ({ ...row }));
}

export function legacyModelIdentityEvidenceByBarcode() {
  return new Map(EVIDENCE.map((row) => [row.barcode, { ...row }] as const));
}
