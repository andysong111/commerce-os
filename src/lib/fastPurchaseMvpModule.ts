import type { CommerceModule } from "@/lib/moduleRegistry";

export const fastPurchaseMvpModule: CommerceModule = {
  id: "fast-purchase-mvp",
  title: "빠른 발주안 · MVP",
  navigationLabel: "빠른 발주안 · MVP",
  description:
    "재고 전수조사를 기다리지 않고 오늘 사용할 발주 판단·검토표를 만듭니다. 재고증거가 있는 상품은 보수적으로 판단하고, 나머지 기존 발주후보도 재고0 수요참고와 함께 수동 검토목록으로 보여줍니다.",
  status: "available",
  route: "/fast-purchase-mvp",
  category: "발주·입고 관리",
  inputType: "Canonical 판매, 기존 발주후보, 과거발주 증거, PROVISIONAL 재고증거, MOQ·박스입수",
  outputType: "시스템 발주·보류 판단, 상한편향 절충판정, 수요만 수동검토, 재고0 수요참고",
  historySupport: false,
  externalProject: false,
  note:
    "빠른 사용 우선 V2.1입니다. 재고증거가 없는 상품의 참고수량은 실제 주문수량이 아니며 사용자가 판단할 수 있도록만 공개합니다. 실제 중국 주문 자동전송은 하지 않습니다.",
  helperNote: "전수조사 없이 빠른 운영 · V2.1 수동판단 확장",
  actionLabel: "빠른 발주안 보기",
  safetyBadge: "참고수량 분리 · 자동주문 OFF",
};
