import Link from "next/link";
import { getOpsCurrentUser } from "@/lib/supabase/currentUser";

export async function AuthStatus() {
  const { user } = await getOpsCurrentUser();
  const email = user?.email ?? "";

  return (
    <div className="mb-4 flex items-center justify-end gap-3 text-xs text-slate-500">
      <span>{email ? `Signed in: ${email}` : "Not signed in"}</span>
      <Link href={email ? "/logout" : "/login"} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50">
        {email ? "Logout" : "Login"}
      </Link>
    </div>
  );
}
