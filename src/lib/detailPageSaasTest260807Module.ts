import type { CommerceModule } from "@/lib/moduleRegistry";
import { DETAIL_PAGE_V3_BASELINE_NOTE } from "@/lib/detailPageV3ProductionBaseline";

export const detailPageSaasTest260807Module: CommerceModule = {
  id: "detail-page-studio-saas-test-260807",
  title: "Commerce OS Detail Page Studio · SaaS(테스트버전) · v260807",
  navigationLabel: "상세페이지 스튜디오 · SaaS(테스트버전)",
  description:
    "Production v3 기준과 동일한 상세페이지 생성 코드를 사용하는 SaaS 실험 카드입니다. 새 UI·과금·다국어 실험은 이 카드에서 진행하되 대표 1장·부가 4장과 1000×14000 상세페이지 엔진 기준은 공통 baseline에서 시작합니다.",
  status: "available",
  route:
    "https://commerce-os-detail-page-studio-git-isolated-saas-test-a2bsangsa.vercel.app/?studio_variant=saas-test",
  category: "detail-page",
  inputType:
    "상품 이미지 최대 3장 또는 1688 링크, 상품명, 공급처 정보, 판매 옵션, 선택형 문구 언어",
  outputType:
    "Production v3 상세페이지 1000×14000 JPG, 대표 1장·부가 4장, 실행·사용량 원장",
  historySupport: false,
  externalProject: true,
  note: `${DETAIL_PAGE_V3_BASELINE_NOTE} 이 카드는 isolated/saas-test 배포 별칭을 유지합니다.`,
  helperNote: "v260807 · 공통 Production v3 · SaaS 테스트",
  actionLabel: "SaaS 테스트 스튜디오 열기",
};
