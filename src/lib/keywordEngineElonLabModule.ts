import type { CommerceModule } from "@/lib/moduleRegistry";

export const keywordEngineElonLabModule: CommerceModule = {
  id: "keyword-engine-elon-lab",
  title: "키워드엔진 일론머스크식 분해개선작업",
  navigationLabel: "키워드엔진 일론머스크식 분해개선작업",
  description:
    "1688 중국 원본 링크에서 상품 정체성을 확정한 뒤 짧은 Market Bridge를 만들고, NAVER API HUB 지식iN·카페·블로그·웹문서의 실제 문서 증거에서 한국 시장어를 발굴합니다. SearchAd가 월검색량·경쟁을 계측하고 Search Trend가 최근성을 보조 검증한 뒤 안전 Gate와 수요 중심 점수로 추천 상품명까지 만드는 2단계 실험실입니다.",
  status: "available",
  route: "/keyword-engine-elon-lab",
  category: "판매 콘텐츠 자동화",
  inputType: "1688 중국 상품 링크, 중국 상품명·옵션명 수동 보완",
  outputType: "상품 정체성·Seed, Evidence Market Mine, canonical no-space 검색키워드, 월검색수요 TOP·정확성 TOP·추세 신호, 추천 상품명",
  historySupport: true,
  externalProject: false,
  note:
    "V6는 goods_key·Shopling 모델명을 키워드 판단에 사용하지 않습니다. API HUB 지식iN/카페/블로그/웹문서를 증거 광산으로, SearchAd를 월검색량·경쟁 계측기로, Search Trend를 최근성 보조 검증기로 사용합니다. 관련성 80+·쇼핑의도 70+ Gate 이후 월검색수요 55% 중심으로 평가하며 Shopling/Supabase 쓰기는 실행하지 않습니다.",
  helperNote: "1688 원본 · 2 STEP · Evidence Market Mine · 안전 Gate · SearchAd 수요 · Search Trend · no-space 검색키 · 상품명 조립",
  actionLabel: "1688 키워드 실험실 열기",
  safetyBadge: "읽기·분석 전용",
};
