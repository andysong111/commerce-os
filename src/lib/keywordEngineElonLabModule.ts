import type { CommerceModule } from "@/lib/moduleRegistry";

export const keywordEngineElonLabModule: CommerceModule = {
  id: "keyword-engine-elon-lab",
  title: "키워드엔진 일론머스크식 분해개선작업",
  navigationLabel: "키워드엔진 일론머스크식 분해개선작업",
  description:
    "키워드 엔진을 완성 결과로 평가하지 않고 goods_key 입력부터 단계별 Input·Output을 6개 고정 테스트 상품으로 비교합니다. 각 단계를 직접 검수해 통과시킨 뒤 다음 단계로 넘어가는 격리 실험실입니다.",
  status: "available",
  route: "/keyword-engine-elon-lab",
  category: "판매 콘텐츠 자동화",
  inputType: "고정 테스트 goods_key 6개, 단계별 실행 입력, 운영자 검수 판정",
  outputType: "단계별 Input/Output 스냅샷, 6상품 비교표, 통과/개선필요 판정 이력",
  historySupport: true,
  externalProject: false,
  note:
    "운영 키워드 적용 경로와 분리된 실험 카드입니다. 현재는 1단계 Shopling 상품 Context를 실제 조회하고, 후속 단계는 앞 단계 검수 통과 후 하나씩 연결합니다.",
  helperNote: "단계별 분해 · 6상품 고정 시험 · Supabase 이력",
  actionLabel: "분해개선 실험실 열기",
  safetyBadge: "실제 Shopling 쓰기 없음",
};
