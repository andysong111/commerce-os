import type { CommerceModule } from "@/lib/moduleRegistry";

export const keywordEngineElonLabModule: CommerceModule = {
  id: "keyword-engine-elon-lab",
  title: "키워드엔진 일론머스크식 분해개선작업",
  navigationLabel: "키워드엔진 일론머스크식 분해개선작업",
  description:
    "1688 중국 원본 링크에서 상품 정체성을 확정한 뒤 Market Bridge Seed·네이버 쇼핑 실제 상품명·SearchAd를 연결해 한국 시장어휘를 넓게 발굴하고, 안전 Gate 이후 월검색수요 중심으로 재탐색·점수화해 추천 상품명까지 만드는 2단계 실험실입니다.",
  status: "available",
  route: "/keyword-engine-elon-lab",
  category: "판매 콘텐츠 자동화",
  inputType: "1688 중국 상품 링크, 중국 상품명·옵션명 수동 보완",
  outputType: "상품 정체성·Seed, Market Bridge·시장어휘, 월검색수요 중심 키워드 전체, 수요 TOP·정확성 TOP, 추천 상품명",
  historySupport: true,
  externalProject: false,
  note:
    "V4는 goods_key·Shopling 모델명을 키워드 판단에 사용하지 않습니다. 관련성 80+·쇼핑의도 70+ Gate 이후 월검색수요 55% 중심으로 평가하며, 실제 시장어휘를 Naver Shopping/SearchAd로 보강합니다. Shopling/Supabase 쓰기는 실행하지 않습니다.",
  helperNote: "1688 원본 · 2 STEP · Market Recall · 안전 Gate · 수요 재탐색 · 월검색 보강 · 상품명 조립",
  actionLabel: "1688 키워드 실험실 열기",
  safetyBadge: "읽기·분석 전용",
};
