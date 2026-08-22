import type { ReactNode } from "react";

import KeywordElonAutoRunResumeBridge from "./KeywordElonAutoRunResumeBridge";
import KeywordElonAutoRunToStep4 from "./KeywordElonAutoRunToStep4";
import KeywordElonBrowserContextBridge from "./KeywordElonBrowserContextBridge";
import KeywordElonCollectorPresenceBridge from "./KeywordElonCollectorPresenceBridge";
import KeywordElonCollapsibleSection from "./KeywordElonCollapsibleSection";
import KeywordElonDemandSummary from "./KeywordElonDemandSummary";
import KeywordElonDiversitySupplement from "./KeywordElonDiversitySupplement";
import KeywordElonInterruptedRunRecovery from "./KeywordElonInterruptedRunRecovery";
import KeywordElonLinkHealthBridge from "./KeywordElonLinkHealthBridge";
import KeywordElonPopupCollectorBridge from "./KeywordElonPopupCollectorBridge";
import KeywordElonScoreFetchBridge from "./KeywordElonScoreFetchBridge";
import KeywordElonShoplingSeoOutput from "./KeywordElonShoplingSeoOutput";
import KeywordElonStep3Expansion from "./KeywordElonStep3Expansion";
import KeywordElonStep4DualFilter from "./KeywordElonStep4DualFilter";
import SeoFinalShoplingUploadPanel from "./SeoFinalShoplingUploadPanel";
import SeoTitleLedgerControlPanel from "./SeoTitleLedgerControlPanel";
import SeoTitleLedgerLaunchHandoff from "./SeoTitleLedgerLaunchHandoff";
import SeoTitleLedgerPageIdentityBridge from "./SeoTitleLedgerPageIdentityBridge";

export default function KeywordEngineElonLabLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <KeywordElonPopupCollectorBridge />
      <SeoTitleLedgerPageIdentityBridge />
      <KeywordElonBrowserContextBridge />
      <KeywordElonCollectorPresenceBridge />
      <KeywordElonScoreFetchBridge />
      <SeoTitleLedgerLaunchHandoff />
      <KeywordElonLinkHealthBridge />
      <KeywordElonAutoRunResumeBridge />
      <KeywordElonAutoRunToStep4 />
      <KeywordElonShoplingSeoOutput />
      <SeoFinalShoplingUploadPanel />
      <SeoTitleLedgerControlPanel />

      <KeywordElonCollapsibleSection
        title="STEP 1~4 세부내용 · 제조 근거"
        description="상품 정체성, 시장어, 점수표, STEP 3 확장과 STEP 4 위험어 검수는 필요할 때만 펼쳐서 확인합니다."
      >
        {children}
        <KeywordElonInterruptedRunRecovery />
        <KeywordElonStep3Expansion />
        <KeywordElonDemandSummary />
        <KeywordElonStep4DualFilter />
      </KeywordElonCollapsibleSection>

      <KeywordElonCollapsibleSection
        title="STEP 5 · 다양성 보조 · 원장 재료 확장"
        description="상품명 재고가 목표 수량에 미달할 때만 펼쳐서 안전 키워드 재료를 추가 발굴합니다."
        badge="수동 실행"
      >
        <KeywordElonDiversitySupplement />
      </KeywordElonCollapsibleSection>
    </>
  );
}
