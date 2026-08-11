import { detailPageSaasTest260807Module } from "@/lib/detailPageSaasTest260807Module";
import { detailPageSaasTestModule } from "@/lib/detailPageSaasTestModule";
import { DETAIL_PAGE_V3_BASELINE_NOTE } from "@/lib/detailPageV3ProductionBaseline";
import { extendedModuleRegistry } from "@/lib/extendedModuleRegistry";
import { fastPurchaseMvpModule } from "@/lib/fastPurchaseMvpModule";
import type { CommerceModule } from "@/lib/moduleRegistry";

const isolatedBaseModules: readonly CommerceModule[] = extendedModuleRegistry.map(
  (module) => {
    if (module.id === "sourcing-engine") {
      return {
        ...module,
        title: "소싱센터",
        navigationLabel: "소싱센터",
        description:
          "1688 후보 수집부터 한국 수요, 실제 공급상품·SKU, 수익성, 시장가격, AI 상세페이지 사전검사, 소액 테스트 발주까지 전체 소싱 순서를 한 화면에서 확인하고 필요한 단계로 바로 이동합니다.",
        route: "/sourcing-center",
        category: "소싱",
        inputType: "1688 후보, NAVER 수요, 실제 공급상품·SKU, 계획원가, 한국 시장가격, AI 상세페이지 검사결과",
        outputType: "현재 다음 행동, 단계별 통과·탈락 흐름, TEST_READY까지의 전체 소싱 진행상태",
        historySupport: true,
        externalProject: false,
        note: "소싱엔진의 실제 계산·검증 화면은 독립 Production에서 실행하고, OPS Center 소싱센터는 쉬운 용어의 통합 입구와 현재 다음 행동을 제공합니다.",
        helperNote: "전체 소싱 흐름 · 한눈에 보기",
        actionLabel: "소싱센터 열기",
        safetyBadge: "TEST_READY 전 실제 발주 없음",
      };
    }
    if (module.id !== "detail-page-studio") return module;
    return {
      ...module,
      title: "Commerce OS Detail Page Studio · SaaS 전용 · v260807",
      navigationLabel: "상세페이지 스튜디오 · SaaS 전용",
      description:
        "현재 상품출시진행관리에서 검증한 Production v3 상세페이지 엔진 기준을 SaaS 운영 카드에도 동일 적용합니다. SaaS UI·과금·다국어는 독립 확장하되 대표 1장·부가 4장과 1000×14000 상세페이지 생성 기준은 공통 baseline을 사용합니다.",
      route:
        "https://commerce-os-detail-page-studio-git-isolated-sa-3f377e-a2bsangsa.vercel.app/?studio_variant=saas-test",
      inputType:
        "상품 이미지 최대 3장 또는 1688 링크, 상품명, 공급처 정보, 판매 옵션, 선택형 문구 언어",
      outputType:
        "Production v3 상세페이지 1000×14000 JPG, 대표 1장·부가 4장, 실행·사용량 원장",
      note: `${DETAIL_PAGE_V3_BASELINE_NOTE} 이 카드는 isolated/saas-production 배포 별칭을 유지합니다.`,
      helperNote: "v260807 · 공통 Production v3 · SaaS 전용",
      actionLabel: "SaaS 상세페이지 스튜디오 열기",
    };
  },
);

export const opsModuleRegistry: readonly CommerceModule[] = [
  ...isolatedBaseModules,
  fastPurchaseMvpModule,
  detailPageSaasTestModule,
  detailPageSaasTest260807Module,
];
