export const DETAIL_PAGE_V3_PRODUCTION_BASELINE = {
  engineProfile: "source-first-v3",
  studioRepository: "andysong111/commerce-os-detail-page-studio",
  studioStableBranch: "stable/ops-v3-production-20260809",
  studioCommit: "48ee179b4c7cd067c93ddbcfa3fd02a2a349796e",
  opsIntegrationStableBranch: "stable/product-launch-detail-v3-integration-20260809",
  detailImageSize: "1000×14000",
  representativeImageCount: 5,
} as const;

export const DETAIL_PAGE_V3_BASELINE_NOTE =
  `공통 Production v3 기준: ${DETAIL_PAGE_V3_PRODUCTION_BASELINE.engineProfile} · ` +
  `${DETAIL_PAGE_V3_PRODUCTION_BASELINE.studioStableBranch} · ` +
  `${DETAIL_PAGE_V3_PRODUCTION_BASELINE.studioCommit}. ` +
  `OPS 연결 기준은 ${DETAIL_PAGE_V3_PRODUCTION_BASELINE.opsIntegrationStableBranch}에 보존합니다. ` +
  "세 카드는 역할과 배포 주소만 분리하고 상세페이지 생성 엔진 기준은 동일하게 유지합니다.";
