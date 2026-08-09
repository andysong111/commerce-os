import type { CommerceModule } from "@/lib/moduleRegistry";

export const fastPurchaseMvpModule: CommerceModule = {
  id: "fast-purchase-mvp",
  title: "빠른 발주안 · MVP",
  navigationLabel: "빠른 발주안 · MVP",
  description:
    "재고 전수조사를 기다리지 않고 현재 판매·과거발주·PROVISIONAL 재고밴드에서 발주 방향이 안정적인 상품만 보수적으로 골라 오늘 사용할 발주 검토표를 만듭니다.",
  status: "available",
  route: "/fast-purchase-mvp",
  category: "발주·입고 관리",
  inputType: "Canonical 판매, 과거발주 증거, 추정재고 낮음·높음 밴드, MOQ·박스입수",
  outputType: "발주 검토, 발주 보류, 수동 검토, 데이터 보류, 보수적 MVP 권장수량",
  historySupport: false,
  externalProject: false,
  note:
    "빠른 사용 우선 절충 모드입니다. 양쪽 재고 시나리오 모두 발주가 필요할 때만 두 권장수량 중 작은 값을 사용합니다. 실제 중국 주문 자동전송은 하지 않습니다.",
  helperNote: "전수조사 없이 빠른 운영 · 수동 발주",
  actionLabel: "빠른 발주안 보기",
  safetyBadge: "보수적 수량 · 자동주문 OFF",
};
