import { createHash } from "node:crypto";
import {
  loadFastPurchaseMvp,
  type FastPurchaseMvpReport,
  type FastPurchaseMvpRow,
} from "@/lib/fastPurchaseMvp";

const SNAPSHOT_AT = "2026-08-10T00:02:50.000Z";
const LOAD_ATTEMPTS = 2;

export type FastPurchaseMvpDataMode = "LIVE" | "LAST_KNOWN_MANUAL_FALLBACK";
export type ResilientFastPurchaseMvpReport = FastPurchaseMvpReport & {
  dataMode: FastPurchaseMvpDataMode;
  sourceErrorCode: string | null;
};

type LastKnownCandidate = {
  barcode: string;
  productName: string;
  referenceDemandQuantity: number;
};

const LAST_KNOWN_CANDIDATES: LastKnownCandidate[] = [
  { barcode: "BCA4-1", productName: "실버 폴리싱천 광천 변색제거 8x8cm", referenceDemandQuantity: 1499 },
  { barcode: "BGG1-1", productName: "계란펀칭기 계란구멍 달걀받침 에그피어서 구멍내기", referenceDemandQuantity: 1284 },
  { barcode: "BBD4-1", productName: "싱크대오버플로우마개 세면대오버홀캡 세면대부속", referenceDemandQuantity: 332 },
  { barcode: "BGD2-1", productName: "12자리 듀얼주차번호판 차전화번호판 자동차연락처", referenceDemandQuantity: 278 },
  { barcode: "BBD4-3", productName: "싱크대오버플로우마개 세면대오버홀캡 세면대부속", referenceDemandQuantity: 270 },
  { barcode: "BGB1-1", productName: "차량용핸드폰거치대 대쉬보드거치대 계기판", referenceDemandQuantity: 239 },
  { barcode: "BCA5-1", productName: "게임장갑 터치골무 게임패드 스마트폰 게임용 땀방지", referenceDemandQuantity: 235 },
  { barcode: "BCD2-1", productName: "발가락벌리기 실리콘 골무 발가락링 고정기 끼우개", referenceDemandQuantity: 216 },
  { barcode: "BGC3-1", productName: "세탁기청소솔 드럼세탁기청소솔 세탁기틈새브러쉬", referenceDemandQuantity: 154 },
  { barcode: "BBA7-2", productName: "참빗 각질제거빗 이발소 바버샵 미니빗", referenceDemandQuantity: 142 },
  { barcode: "BCA2-1", productName: "밀칼 복권긁기 헤라 스크랩퍼", referenceDemandQuantity: 137 },
  { barcode: "BAG4-2", productName: "세면대팝업 배수관 트랩 물마개 자동폼업 황동구리", referenceDemandQuantity: 122 },
  { barcode: "BDB2-1", productName: "서바이벌블랭킷 은박담요 보온포 재난용품", referenceDemandQuantity: 118 },
  { barcode: "BBC3-3", productName: "니플급수기 닭용품 닭모이통 닭물통용 닭니플", referenceDemandQuantity: 117 },
  { barcode: "BAA5-3", productName: "주방세제디스펜서 물비누통 주방세제통 샴푸통 500ml", referenceDemandQuantity: 75 },
  { barcode: "BDB1-3", productName: "서바이벌블랭킷 은박담요 은박이불 140cmx210cm", referenceDemandQuantity: 70 },
  { barcode: "BAG2-1", productName: "사우나방석 꽃방석 사무실의자 인테리어 편한", referenceDemandQuantity: 68 },
  { barcode: "BAE4-1", productName: "병아리급수기 자동급수기 닭자동물통 모이통 B형", referenceDemandQuantity: 64 },
  { barcode: "BAB2-1", productName: "카피바라인형 손목 동물 귀여운 봉제 곰인형 스냅", referenceDemandQuantity: 62 },
  { barcode: "BAB5-1", productName: "정수기물통커버 먼지덮개 생수통", referenceDemandQuantity: 62 },
  { barcode: "BBA2-3", productName: "옷핀 핀뱃지 토끼인형 가방뱃지 캐릭터브로치", referenceDemandQuantity: 62 },
  { barcode: "BBE4-2", productName: "쌍커풀테이프 쌍커풀만들기 레이스쌍테 3타입 240매", referenceDemandQuantity: 62 },
  { barcode: "BGE1-1", productName: "창넓은 농사용모자 햇빛가리개 와이드 UV차단 농부", referenceDemandQuantity: 60 },
  { barcode: "BAE1-3", productName: "미용실보자기 가운 바버샵커트보 셀프 수염", referenceDemandQuantity: 47 },
  { barcode: "BCC6-2", productName: "큐빅 오픈형오링 스트랩 버클 부자재 25mm", referenceDemandQuantity: 47 },
  { barcode: "BDC4-1", productName: "실내세차브러쉬 디테일링브러쉬 송풍구브러시", referenceDemandQuantity: 45 },
  { barcode: "BAC3-1", productName: "페이스가드 김서림방지 안면보호구 보안면 투명 고글", referenceDemandQuantity: 44 },
  { barcode: "BAD2-2", productName: "텀블러재떨이 자동차 컵홀더 거치대 승용차", referenceDemandQuantity: 44 },
  { barcode: "BBD3-2", productName: "꿩안경 눈가리개 2사이즈 조류용품 볼트없는", referenceDemandQuantity: 34 },
  { barcode: "BAC4-2", productName: "배추담요 웃긴담요 특이한담요 블랭킷 선물", referenceDemandQuantity: 32 },
  { barcode: "BGF3-1", productName: "빅사이즈 휴양지 농사모자 15cm 왕챙모자 등산 썬캡", referenceDemandQuantity: 28 },
  { barcode: "BGF4-1", productName: "빅사이즈 휴양지 농사모자 15cm 왕챙모자 등산 썬캡", referenceDemandQuantity: 27 },
  { barcode: "BGE2-1", productName: "창넓은 농사용모자 햇빛가리개 와이드 UV차단 농부", referenceDemandQuantity: 26 },
  { barcode: "BBC5-2", productName: "캥거루 얇은장지갑 납작지갑 슬림 손지갑 상품권", referenceDemandQuantity: 25 },
  { barcode: "BAC3-3", productName: "세면대구멍마개 세면대커버 물마개 수동폽업 세면기", referenceDemandQuantity: 24 },
  { barcode: "BGE3-2", productName: "정글모 사하라캡 뒷목가리개 성인플랩캡", referenceDemandQuantity: 23 },
  { barcode: "BAC6-1", productName: "의자팔걸이쿠션 팔목받침대 메모리폼", referenceDemandQuantity: 22 },
  { barcode: "BAD5-2", productName: "목보호대 목견인 넥가드 목밴드 보호대", referenceDemandQuantity: 22 },
  { barcode: "BAG3-1", productName: "생선필통 고등어 필통파우치 지퍼필통 신학기 만능", referenceDemandQuantity: 21 },
  { barcode: "BAC4-1", productName: "배추담요 웃긴담요 특이한담요 블랭킷 선물", referenceDemandQuantity: 17 },
  { barcode: "BAG3-3", productName: "생선필통 고등어 필통파우치 지퍼필통 신학기 만능", referenceDemandQuantity: 17 },
  { barcode: "BGE4-2", productName: "정글모 사하라캡 뒷목가리개 성인플랩캡", referenceDemandQuantity: 14 },
];

function hash(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function errorCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const first = message.split(":", 1)[0]?.trim().toUpperCase() ?? "";
  return /^[A-Z0-9_]+$/.test(first) && first ? first : "FAST_PURCHASE_LIVE_LOAD_FAILED";
}

function manualFallbackRow(candidate: LastKnownCandidate): FastPurchaseMvpRow {
  return {
    barcode: candidate.barcode,
    modelNo: null,
    productName: candidate.productName,
    action: "DEMAND_ONLY_REVIEW",
    actionLabel: "수요만 수동검토",
    basis: "DEMAND_ONLY_ZERO_STOCK_REFERENCE",
    riskBias: "OVER_ORDER_IF_MISUSED",
    recommendedQuantity: 0,
    referenceDemandQuantity: candidate.referenceDemandQuantity,
    planningInventoryQuantity: null,
    inventoryBandLow: null,
    inventoryBandHigh: null,
    lowScenarioRecommendedQuantity: null,
    highScenarioRecommendedQuantity: null,
    reason:
      "실시간 발주 데이터 호출이 일시적으로 실패해 마지막 정상 운영 스냅샷의 재고0 수요참고만 표시합니다. 실제 재고·현재 주문수량으로 해석하지 말고 빠른 재고판단 후 수동 계획에만 사용하세요.",
    usableForTodayDecision: false,
    manualTriageReady: true,
    manualOrderOnly: true,
    automaticPurchaseEnabled: false,
    purchaseWritesEnabled: false,
    inventoryWritesEnabled: false,
  };
}

function fallbackReport(sourceErrorCode: string): ResilientFastPurchaseMvpReport {
  const rows = LAST_KNOWN_CANDIDATES.map(manualFallbackRow);
  return {
    generatedAt: SNAPSHOT_AT,
    state: "READY_MVP",
    message:
      "실시간 데이터 호출이 일시적으로 실패했습니다. 화면을 막지 않고 마지막 정상 운영 스냅샷을 수동검토 전용으로 열었습니다. 이 모드에서는 시스템 발주·보류 판정을 사용하지 않고 재고0 수요참고만 보여줍니다.",
    evaluatedCount: rows.length,
    systemDecisionCount: 0,
    manualTriageCount: rows.length,
    operationalCoverageCount: rows.length,
    orderReviewCount: 0,
    holdCount: 0,
    fallbackDecisionCount: 0,
    manualReviewCount: 0,
    demandOnlyReviewCount: rows.length,
    dataHoldCount: 0,
    usableDecisionCount: 0,
    fingerprint: hash({ mode: "LAST_KNOWN_MANUAL_FALLBACK", snapshotAt: SNAPSHOT_AT, rows }),
    mode: "FAST_USE_PROVISIONAL_V2_1",
    manualOrderOnly: true,
    automaticPurchaseEnabled: false,
    purchaseWritesEnabled: false,
    inventoryWritesEnabled: false,
    rows,
    dataMode: "LAST_KNOWN_MANUAL_FALLBACK",
    sourceErrorCode,
  };
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function loadFastPurchaseMvpResilient(): Promise<ResilientFastPurchaseMvpReport> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= LOAD_ATTEMPTS; attempt += 1) {
    try {
      const report = await loadFastPurchaseMvp();
      return {
        ...report,
        dataMode: "LIVE",
        sourceErrorCode: null,
      };
    } catch (error) {
      lastError = error;
      console.error("FAST_PURCHASE_MVP_LIVE_LOAD_FAILED", {
        attempt,
        code: errorCode(error),
      });
      if (attempt < LOAD_ATTEMPTS) await wait(350);
    }
  }
  return fallbackReport(errorCode(lastError));
}
