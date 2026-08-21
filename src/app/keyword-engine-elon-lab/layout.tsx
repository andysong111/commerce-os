import type { ReactNode } from "react";

import KeywordElonAutoRunResumeBridge from "./KeywordElonAutoRunResumeBridge";
import KeywordElonAutoRunToStep4 from "./KeywordElonAutoRunToStep4";
import KeywordElonCollectorPresenceBridge from "./KeywordElonCollectorPresenceBridge";
import KeywordElonCollapsibleSection from "./KeywordElonCollapsibleSection";
import KeywordElonDemandSummary from "./KeywordElonDemandSummary";
import KeywordElonDiversitySupplement from "./KeywordElonDiversitySupplement";
import KeywordElonInterruptedRunRecovery from "./KeywordElonInterruptedRunRecovery";
import KeywordElonScoreFetchBridge from "./KeywordElonScoreFetchBridge";
import KeywordElonStep3Expansion from "./KeywordElonStep3Expansion";
import KeywordElonStep4DualFilter from "./KeywordElonStep4DualFilter";

export default function KeywordEngineElonLabLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <KeywordElonCollectorPresenceBridge />
      <KeywordElonScoreFetchBridge />
      <KeywordElonAutoRunResumeBridge />
      <KeywordElonAutoRunToStep4 />

      <KeywordElonCollapsibleSection
        title="STEP 1~4 세부내용"
        description="수동 실행, 상품 정체성, 점수표, STEP 3 확장과 STEP 4 위험어 검수는 필요할 때만 펼쳐서 확인합니다."
      >
        {children}
        <KeywordElonInterruptedRunRecovery />
        <KeywordElonStep3Expansion />
        <KeywordElonDemandSummary />
        <KeywordElonStep4DualFilter />
      </KeywordElonCollapsibleSection>

      <KeywordElonCollapsibleSection
        title="STEP 5 · 다양성 보조"
        description="STEP 5는 원클릭 실행에서 제외합니다. FINAL RESULT를 확인한 뒤 부족할 때만 펼쳐서 직접 실행합니다."
        badge="수동 실행"
      >
        <KeywordElonDiversitySupplement />
      </KeywordElonCollapsibleSection>
    </>
  );
}
