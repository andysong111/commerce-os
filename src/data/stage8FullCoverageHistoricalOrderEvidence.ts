export type FullCoverageHistoricalOrderOptionRow = {
  optionName: string;
  orderQuantity: number;
  unitCostKrw: number;
};

export type FullCoverageHistoricalOrderEvidence = {
  barcode: string;
  originalModelNo: string;
  sourceArtifact: string;
  sourceSheets: string[];
  cumulativeOrderQuantity: number;
  recentThreeOrderQuantity: number;
  latestOrderDate: string;
  latestOrderRows: FullCoverageHistoricalOrderOptionRow[];
  confirmedInbound: false;
  currentInventoryUseAllowed: false;
  validationOnly: true;
  note: string;
};

const SOURCE_ARTIFACT = "1차_중국발주이력_안전원가_안전판매가_신규산출.xlsx";

const EVIDENCE: FullCoverageHistoricalOrderEvidence[] = [
  {
    barcode: "BBA2-3",
    originalModelNo: "aaa092",
    sourceArtifact: SOURCE_ARTIFACT,
    sourceSheets: ["모델번호별 요약", "상품별 안전원가"],
    cumulativeOrderQuantity: 4980,
    recentThreeOrderQuantity: 4370,
    latestOrderDate: "2026-04-01",
    latestOrderRows: [
      { optionName: "그레이", orderQuantity: 150, unitCostKrw: 227.55066001569242 },
      { optionName: "라이트브라운", orderQuantity: 200, unitCostKrw: 204.65066001569238 },
      { optionName: "브라운", orderQuantity: 150, unitCostKrw: 204.65066001569238 },
      { optionName: "옐로우", orderQuantity: 150, unitCostKrw: 204.65066001569238 },
      { optionName: "핑크", orderQuantity: 200, unitCostKrw: 204.65066001569238 },
      { optionName: "화이트", orderQuantity: 200, unitCostKrw: 204.65066001569238 },
    ],
    confirmedInbound: false,
    currentInventoryUseAllowed: false,
    validationOnly: true,
    note: "원본 발주이력의 모델번호·수량·원가 증거입니다. 발주 기록은 확정입고 또는 현재 잔여재고를 뜻하지 않습니다.",
  },
];

export function fullCoverageHistoricalOrderEvidence() {
  return EVIDENCE;
}
