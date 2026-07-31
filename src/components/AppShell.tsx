import { Suspense, type ReactNode } from "react";
import { OpsRetryPrefill } from "@/components/OpsRetryPrefill";
import { Sidebar } from "@/components/Sidebar";
import { isDetailPageCostAdmin } from "@/lib/detailPageCostAdmin";
import { isOpsLoginTemporarilyDisabled } from "@/lib/opsLoginBypass";
import { getOpsCurrentUser } from "@/lib/supabase/currentUser";

export async function AppShell({ children }: { children: ReactNode }) {
  const loginDisabled = isOpsLoginTemporarilyDisabled();
  const { user } = loginDisabled ? { user: null } : await getOpsCurrentUser();
  const email = user?.email ?? "";

  return (
    <div className="app-shell min-h-screen bg-slate-50">
      <Suspense fallback={null}>
        <Sidebar
          showDetailPageCosts={isDetailPageCostAdmin(email)}
          signedIn={Boolean(user)}
          email={email}
          loginDisabled={loginDisabled}
        />
      </Suspense>
      <OpsRetryPrefill />
      <main className="app-main min-w-0 px-4 py-6 sm:px-6 lg:ml-60 lg:px-8 lg:py-8">
        <div className="app-content mx-auto max-w-[1600px]">{children}</div>
      </main>
    </div>
  );
}
