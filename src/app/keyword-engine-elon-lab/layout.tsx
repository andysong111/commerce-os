import type { ReactNode } from "react";

import KeywordElonAutoRunResumeBridge from "./KeywordElonAutoRunResumeBridge";
import KeywordElonAutoRunToStep4 from "./KeywordElonAutoRunToStep4";
import KeywordElonDemandSummary from "./KeywordElonDemandSummary";
import KeywordElonDiversitySupplement from "./KeywordElonDiversitySupplement";
import KeywordElonInterruptedRunRecovery from "./KeywordElonInterruptedRunRecovery";
import KeywordElonScoreFetchBridge from "./KeywordElonScoreFetchBridge";
import KeywordElonStep3Expansion from "./KeywordElonStep3Expansion";
import KeywordElonStep4DualFilter from "./KeywordElonStep4DualFilter";

export default function KeywordEngineElonLabLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <KeywordElonScoreFetchBridge />
      <KeywordElonAutoRunResumeBridge />
      <KeywordElonAutoRunToStep4 />
      {children}
      <KeywordElonInterruptedRunRecovery />
      <KeywordElonStep3Expansion />
      <KeywordElonDemandSummary />
      <KeywordElonStep4DualFilter />
      <KeywordElonDiversitySupplement />
    </>
  );
}
