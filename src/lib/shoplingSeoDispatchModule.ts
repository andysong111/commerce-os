import type { CommerceModule } from "@/lib/moduleRegistry";

export const shoplingSeoDispatchModule: CommerceModule = {
  id: "shopling-seo-dispatch",
  title: "샵플링 SEO 출고센터",
  navigationLabel: "샵플링 SEO 출고센터",
  description:
    "SEO 대량등록 클라우드의 미사용 상품명 재고를 전체몰 1회분씩 꺼내 샵플링 상품 6개와 29개 쇼핑몰별 상품명·공통 검색어를 실제 등록합니다.",
  status: "available",
  route: "/shopling-seo-dispatch",
  category: "상품 등록 자동화",
  inputType:
    "SEO 상품명 재고 원장, 상품출시 진행관리 연결상품, 샵플링 6개 상품그룹 등록정보",
  outputType:
    "샵플링 신규상품 6개, 쇼핑몰별 SEO 상품명 29개, 공통 검색어 10개, 사용완료·확인필요 재고 이력",
  historySupport: true,
  externalProject: false,
  note:
    "한 번 실행할 때 전체몰 1회분만 처리합니다. 기준 goods_key가 없으면 첫 6개 상품을 만들고, 기존 기준상품이 있으면 첫 SEO 적용에 재사용합니다. 이후 추가등록은 dispatch별 고유 자사상품코드로 새 6개 상품을 만들며 기존 기준 goods_key를 덮어쓰지 않습니다. 29개 제목과 검색어는 직렬 적용 후 결과를 확인하고, 완전 성공한 제목만 사용완료 처리하며 불확실·부분 실패는 확인필요로 격리합니다.",
  helperNote:
    "전체몰 1회 29제목 · 6상품그룹 신규등록 · 직렬 SEO 반영 · 중복 재사용 금지",
  actionLabel: "SEO 실제 출고센터 열기",
  safetyBadge: "1회분 제한 · 성공 검증 후 재고 소비",
};
