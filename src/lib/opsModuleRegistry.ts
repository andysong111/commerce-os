import { detailPageSaasTest260807Module } from "@/lib/detailPageSaasTest260807Module";
import { detailPageSaasTestModule } from "@/lib/detailPageSaasTestModule";
import { extendedModuleRegistry } from "@/lib/extendedModuleRegistry";
import type { CommerceModule } from "@/lib/moduleRegistry";

const isolatedBaseModules: readonly CommerceModule[] = extendedModuleRegistry.map(
  (module) => {
    if (module.id !== "detail-page-studio") return module;
    return {
      ...module,
      title: "Commerce OS Detail Page Studio · SaaS 전용 · v260807",
      navigationLabel: "상세페이지 스튜디오 · SaaS 전용",
      description:
        "SaaS 테스트버전에서 검증된 동일 엔진 기준을 SaaS 전용 독립 개발선으로 복제했습니다. 상품 이미지와 정보를 입력하면 표준 생성 프로필에 따라 8개 섹션을 만들고, AI 검수·문제 패널 자동보정 후 최종 상세페이지를 제공합니다.",
      route:
        "https://commerce-os-detail-page-studio-git-isolated-sa-3f377e-a2bsangsa.vercel.app/?studio_variant=saas-test",
      outputType:
        "AI 검수된 8개 섹션 상세페이지, 대표 1장·부가 4장, 실행·사용량 원장",
      note: "기준 버전 v260807. commerce-os-detail-page-studio의 isolated/saas-production 개발선만 사용합니다. OPS Center 전용·SaaS 테스트버전 엔진 수정은 이 카드에 자동 반영하지 않습니다.",
      helperNote: "v260807 · SaaS 전용 · 독립 엔진",
      actionLabel: "SaaS 상세페이지 스튜디오 열기",
    };
  },
);

export const opsModuleRegistry: readonly CommerceModule[] = [
  ...isolatedBaseModules,
  detailPageSaasTestModule,
  detailPageSaasTest260807Module,
];
