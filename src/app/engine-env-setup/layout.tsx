import type { ReactNode } from "react";

import ExtensionManagerPanel from "@/components/system/ExtensionManagerPanel";

export default function EngineEnvSetupLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <ExtensionManagerPanel />
      {children}
    </div>
  );
}
