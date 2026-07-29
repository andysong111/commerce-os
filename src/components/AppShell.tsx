import type { ReactNode } from "react";
import { Sidebar } from "@/components/Sidebar";
import { isDetailPageCostAdmin } from "@/lib/detailPageCostAdmin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function AppShell({ children }: { children: ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null } };
  const email = data.user?.email ?? "";

  return (
    <div className="app-shell min-h-screen bg-slate-50">
      <Sidebar
        showDetailPageCosts={isDetailPageCostAdmin(email)}
        signedIn={Boolean(data.user)}
        email={email}
      />
      <main className="app-main min-w-0 px-4 py-6 sm:px-6 lg:ml-60 lg:px-8 lg:py-8">
        <div className="app-content mx-auto max-w-[1600px]">{children}</div>
      </main>
    </div>
  );
}
