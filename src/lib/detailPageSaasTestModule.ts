import type { CommerceModule } from "@/lib/moduleRegistry";
import { DETAIL_PAGE_V3_BASELINE_NOTE } from "@/lib/detailPageV3ProductionBaseline";

export const detailPageSaasTestModule: CommerceModule = {
  id: "detail-page-studio-saas-test",
  title: "Commerce OS Detail Page Studio · v260807",
  navigationLabel: "상세페이지 스튜디오 · OPS Center 전용",
  description:
    "현재 상품출시진행관리에서 검증한 Production v3 상세페이지 엔진 기준을 사용하는 OPS Center 전용 카드입니다. 대표 1장·부가 4장과 1000×14000 상세페이지 생성 규칙을 공통 baseline으로 유지합니다.",
  status: "available",
  route:
    "https://commerce-os-detail-page-studio.vercel.app/?studio_variant=saas-test",
  category: "detail-page",
  inputType:
    "상품 이미지 최대 3장 또는 1688 링크, 상품명, 공급처 정보, 판매 옵션, 선택형 문구 언어",
  outputType:
    "Production v3 상세페이지 1000×14000 JPG, 대표 1장·부가 4장, 실행·사용량 원장",
  historySupport: false,
  externalProject: true,
  note: `${DETAIL_PAGE_V3_BASELINE_NOTE} 이 카드는 Studio main 배포를 사용합니다.`,
  helperNote: "v260807 · 공통 Production v3 · OPS Center",
  actionLabel: "OPS Center 상세페이지 스튜디오 열기",
};
