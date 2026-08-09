export type LegacyOrderSurrogateValidationEvidence = {
  barcode: string;
  modelNumber: string;
  productName: string;
  cumulativeOrderedQuantity: number;
  latestOrderDate: string;
  validOrderRecordCount: number;
  sourceArtifact: string;
  sourceKind: "LEGACY_ORDER_HISTORY_WORKBOOK";
  confirmedInbound: false;
  inventoryUseAllowed: false;
  validationOnly: true;
};

const EVIDENCE: LegacyOrderSurrogateValidationEvidence[] = [
  {
    barcode: "BGG1-1",
    modelNumber: "aaa316",
    productName: "계란펀칭기",
    cumulativeOrderedQuantity: 11533,
    latestOrderDate: "2025-09-29",
    validOrderRecordCount: 5,
    sourceArtifact: "1차_중국발주이력_안전원가_안전판매가_신규산출.xlsx",
    sourceKind: "LEGACY_ORDER_HISTORY_WORKBOOK",
    confirmedInbound: false,
    inventoryUseAllowed: false,
    validationOnly: true,
  },
];

export function legacyOrderSurrogateValidationEvidence() {
  return EVIDENCE;
}
