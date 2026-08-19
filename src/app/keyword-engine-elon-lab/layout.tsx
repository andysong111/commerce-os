import type { ReactNode } from "react";

import KeywordElonAutoRunToStep4 from "./KeywordElonAutoRunToStep4";
import KeywordElonDemandSummary from "./KeywordElonDemandSummary";
import KeywordElonInterruptedRunRecovery from "./KeywordElonInterruptedRunRecovery";
import KeywordElonScoreFetchBridge from "./KeywordElonScoreFetchBridge";
import KeywordElonStep3Expansion from "./KeywordElonStep3Expansion";
import KeywordElonStep4Filter from "./KeywordElonStep4Filter";

export default function KeywordEngineElonLabLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <KeywordElonScoreFetchBridge />
      <KeywordElonAutoRunToStep4 />
      {children}
      <KeywordElonInterruptedRunRecovery />
      <KeywordElonStep3Expansion />
      <KeywordElonDemandSummary />
      <KeywordElonStep4Filter />
    </>
  );
}
