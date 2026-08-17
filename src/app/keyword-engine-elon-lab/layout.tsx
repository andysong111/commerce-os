import type { ReactNode } from "react";

import KeywordElonScoreFetchBridge from "./KeywordElonScoreFetchBridge";

export default function KeywordEngineElonLabLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <KeywordElonScoreFetchBridge />
      {children}
    </>
  );
}
