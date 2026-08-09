export type ProvisionalInventoryValidationEvidence = {
  barcode: string;
  physicalQuantity: number;
  observedAt: string;
  source: "OPERATOR_PHYSICAL_OBSERVATION";
  validationOnly: true;
  inventoryUseAllowed: false;
};

const EVIDENCE: ProvisionalInventoryValidationEvidence[] = [
  {
    barcode: "BGG1-1",
    physicalQuantity: 3000,
    observedAt: "2026-08-09T04:00:00.000Z",
    source: "OPERATOR_PHYSICAL_OBSERVATION",
    validationOnly: true,
    inventoryUseAllowed: false,
  },
];

export function provisionalInventoryValidationEvidenceByBarcode() {
  return new Map(EVIDENCE.map((row) => [row.barcode, row] as const));
}
