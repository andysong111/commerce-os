import type { ReactNode } from "react";

import KeywordElonDemandSummary from "./KeywordElonDemandSummary";
import KeywordElonInterruptedRunRecovery from "./KeywordElonInterruptedRunRecovery";
import KeywordElonScoreFetchBridge from "./KeywordElonScoreFetchBridge";
import KeywordElonStep3Expansion from "./KeywordElonStep3Expansion";

export default function KeywordEngineElonLabLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <KeywordElonScoreFetchBridge />
      {children}
      <KeywordElonInterruptedRunRecovery />
      <KeywordElonStep3Expansion />
      <KeywordElonDemandSummary />
    </>
  );
}
