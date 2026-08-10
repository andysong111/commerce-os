export const DETAIL_PAGE_V3_PRODUCTION_BASELINE = {
  engineProfile: "source-first-v3",
  studioRepository: "andysong111/commerce-os-detail-page-studio",
  studioStableBranch: "stable/v260807-highpoint-20260810",
  studioCommit: "bc3666b093e3c05aba605382ca8e3a798e02f42d",
  saasProductionBranch: "isolated/saas-production",
  saasTestBranch: "isolated/saas-test",
  opsIntegrationStableBranch: "stable/product-launch-detail-v3-integration-20260809",
  detailImageSize: "1000px width · up to 14000px",
  representativeImageCount: 5,
} as const;

export const DETAIL_PAGE_V3_BASELINE_NOTE =
  `공통 Production v3 고점 기준: ${DETAIL_PAGE_V3_PRODUCTION_BASELINE.engineProfile} · ` +
  `${DETAIL_PAGE_V3_PRODUCTION_BASELINE.studioStableBranch} · ` +
  `${DETAIL_PAGE_V3_PRODUCTION_BASELINE.studioCommit}. ` +
  `${DETAIL_PAGE_V3_PRODUCTION_BASELINE.saasProductionBranch}와 ` +
  `${DETAIL_PAGE_V3_PRODUCTION_BASELINE.saasTestBranch}도 같은 커밋으로 동기화되어 있습니다. ` +
  "세 카드는 역할·배포 주소·향후 개발 브랜치만 분리하고 현재 상세페이지 생성 엔진 내용은 동일하게 유지합니다.";
