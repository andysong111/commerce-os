import type { CommerceModule } from "@/lib/moduleRegistry";

export const keywordEngineElonLabModule: CommerceModule = {
  id: "keyword-engine-elon-lab",
  title: "키워드엔진 일론머스크식 분해개선작업",
  navigationLabel: "키워드엔진 일론머스크식 분해개선작업",
  description:
    "1688 중국 원본 링크에서 상품 정체성을 확정한 뒤 Market Bridge Seed·NAVER API HUB 블로그/카페/웹문서 시장어·SearchAd를 연결해 한국 소비자 검색어를 넓게 발굴하고, 안전 Gate 이후 월검색수요 중심으로 재탐색·점수화해 추천 상품명까지 만드는 2단계 실험실입니다.",
  status: "available",
  route: "/keyword-engine-elon-lab",
  category: "판매 콘텐츠 자동화",
  inputType: "1688 중국 상품 링크, 중국 상품명·옵션명 수동 보완",
  outputType: "상품 정체성·Seed, Market Bridge·API HUB 시장어, no-space 검색키워드, 월검색수요 TOP·정확성 TOP, 추천 상품명",
  historySupport: true,
  externalProject: false,
  note:
    "V5는 goods_key·Shopling 모델명을 키워드 판단에 사용하지 않습니다. API HUB Search를 시장어 광산으로, SearchAd를 월검색량·경쟁 계측기로 사용하며 관련성 80+·쇼핑의도 70+ Gate 이후 월검색수요 55% 중심으로 평가합니다. Shopling/Supabase 쓰기는 실행하지 않습니다.",
  helperNote: "1688 원본 · 2 STEP · API HUB Market Mine · 안전 Gate · SearchAd 수요 · no-space 검색키 · 상품명 조립",
  actionLabel: "1688 키워드 실험실 열기",
  safetyBadge: "읽기·분석 전용",
};
