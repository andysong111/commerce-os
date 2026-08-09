import type { CommerceModule } from "@/lib/moduleRegistry";

export const fastPurchaseMvpModule: CommerceModule = {
  id: "fast-purchase-mvp",
  title: "빠른 발주안 · MVP",
  navigationLabel: "빠른 발주안 · MVP",
  description:
    "재고 전수조사를 기다리지 않고 현재 판매·과거발주·PROVISIONAL 재고증거로 오늘 사용할 발주 판단표를 만듭니다. 완전한 재고밴드가 없으면 누적발주-최근360일판매를 상한편향 임시재고로 사용해 빠르게 절충합니다.",
  status: "available",
  route: "/fast-purchase-mvp",
  category: "발주·입고 관리",
  inputType: "Canonical 판매, 과거발주 증거, 추정재고 밴드 또는 상한편향 임시재고, MOQ·박스입수",
  outputType: "발주 검토, 보수적 발주 검토·보류, 수동 검토, 데이터 보류, MVP 권장수량",
  historySupport: false,
  externalProject: false,
  note:
    "빠른 사용 우선 절충 모드입니다. 상한편향 fallback은 실제재고보다 높게 계산될 수 있어 과잉발주보다 발주 지연 쪽 위험을 허용합니다. 실제 중국 주문 자동전송은 하지 않습니다.",
  helperNote: "전수조사 없이 빠른 운영 · V2 절충",
  actionLabel: "빠른 발주안 보기",
  safetyBadge: "과잉발주 억제 · 자동주문 OFF",
};
