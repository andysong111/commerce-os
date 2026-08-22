import type { CommerceModule } from "@/lib/moduleRegistry";

export const shoplingSeoDispatchModule: CommerceModule = {
  id: "shopling-seo-dispatch",
  title: "샵플링 SEO 출고센터",
  navigationLabel: "샵플링 SEO 출고센터",
  description:
    "SEO 상품명 재고 원장에서 미사용 제목을 예약해 상품그룹·쇼핑몰별 출고 계획을 만들고, 누적 출고 횟수·남은 재고·전체몰 등록 가능 회수를 관리합니다.",
  status: "available",
  route: "/shopling-seo-dispatch",
  category: "상품 등록 자동화",
  inputType:
    "SEO 상품명 재고 원장, 상품출시 진행관리 연결상품, 샵플링 6개 상품그룹 goods_key",
  outputType:
    "중복 없는 상품명 예약, 29개 쇼핑몰별 제목 배정, 공통 검색어 10개, 샵플링 실행 계획",
  historySupport: true,
  externalProject: false,
  note:
    "초기 버전은 재고 예약과 실행 계획 생성까지만 수행합니다. 실제 반복 상품 복제·대량등록은 샵플링 생성 API 연결 후 명시적 승인 단계로 확장합니다.",
  helperNote:
    "상품명 미사용 재고 · 예약 · 누적 출고 · 잔여 전체몰 회수 · 중복 재사용 금지",
  actionLabel: "SEO 출고센터 열기",
  safetyBadge: "실제 외부 전송 전 예약·검증",
};
