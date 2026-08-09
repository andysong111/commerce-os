export type ProvisionalInventoryValidationEvidence = {
  barcode: string;
  physicalQuantity: number;
  observedOn: string;
  source: "OPERATOR_PHYSICAL_OBSERVATION";
  validationOnly: true;
  inventoryUseAllowed: false;
};

const EVIDENCE: ProvisionalInventoryValidationEvidence[] = [
  {
    barcode: "BGG1-1",
    physicalQuantity: 3000,
    observedOn: "2026-08-09",
    source: "OPERATOR_PHYSICAL_OBSERVATION",
    validationOnly: true,
    inventoryUseAllowed: false,
  },
];

export function provisionalInventoryValidationEvidenceByBarcode() {
  return new Map(EVIDENCE.map((row) => [row.barcode, row] as const));
}
