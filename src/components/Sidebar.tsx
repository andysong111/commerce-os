"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { extendedModuleRegistry } from "@/lib/extendedModuleRegistry";
import {
  getWorkspaceGroup,
  getWorkspaceGroupById,
  OPS_WORKSPACE_GROUPS,
} from "@/lib/opsWorkspace";

type NavigationItem = {
  href: string;
  label: string;
  iconLabel: string;
  groupId?: string;
};

function navigationFor(signedIn: boolean, loginDisabled: boolean) {
  const primary: NavigationItem[] = [
    { href: "/", label: "대시보드", iconLabel: "D" },
    ...OPS_WORKSPACE_GROUPS.map((group) => ({
      href: `/?group=${group.id}`,
      label: group.shortLabel,
      iconLabel: group.iconLabel,
      groupId: group.id,
    })),
  ];

  if (loginDisabled) return primary;

  return [
    ...primary,
    {
      href: signedIn ? "/account/password" : "/login",
      label: signedIn ? "비밀번호 설정·변경" : "로그인",
      iconLabel: "계",
    },
  ];
}

export function Sidebar({
  showDetailPageCosts: _showDetailPageCosts = false,
  signedIn = false,
  email = "",
  loginDisabled = false,
}: {
  showDetailPageCosts?: boolean;
  signedIn?: boolean;
  email?: string;
  loginDisabled?: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedGroupId =
    getWorkspaceGroupById(searchParams.get("group"))?.id ?? null;
  const currentModule = extendedModuleRegistry.find(
    (module) =>
      module.route?.startsWith("/") &&
      module.route !== "/" &&
      pathname.startsWith(module.route),
  );
  const currentModuleGroupId = currentModule
    ? getWorkspaceGroup(currentModule.id)?.id ?? null
    : null;
  const navigation = navigationFor(signedIn, loginDisabled);

  function isActive(item: NavigationItem) {
    if (item.groupId) {
      return pathname === "/"
        ? selectedGroupId === item.groupId
        : currentModuleGroupId === item.groupId;
    }
    if (item.href === "/") return pathname === "/" && !selectedGroupId;
    return pathname.startsWith(item.href);
  }

  return (
    <>
      <aside className="app-navigation fixed inset-y-0 left-0 z-20 hidden w-60 border-r border-slate-800 bg-slate-950 text-slate-100 lg:flex lg:flex-col">
        <Brand />
        <div className="px-5 pb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600">
          업무 영역
        </div>
        <nav
          className="flex-1 space-y-1 overflow-y-auto px-3 pb-4"
          aria-label="주요 메뉴"
        >
          {navigation.map((item) => {
            const active = isActive(item);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
              >
                <span className="grid size-5 place-items-center rounded bg-white/10 text-[10px] font-black">
                  {item.iconLabel}
                </span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-slate-800 px-5 py-4 text-xs text-slate-500">
          {loginDisabled ? (
            <span className="font-semibold text-amber-300">
              로그인 임시 해제
            </span>
          ) : signedIn ? (
            <>
              <p className="truncate" title={email}>
                {email}
              </p>
              <Link
                href="/logout"
                className="mt-2 inline-block font-semibold text-slate-300 hover:text-white"
              >
                로그아웃
              </Link>
            </>
          ) : (
            "운영 자동화 워크스페이스"
          )}
        </div>
      </aside>

      <header className="app-navigation border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <Brand compact />
        <nav
          className="mt-3 flex gap-2 overflow-x-auto pb-1"
          aria-label="모바일 메뉴"
        >
          {navigation.map((item) => {
            const active = isActive(item);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${
                  active
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>
    </>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "flex items-center gap-2" : "px-5 py-6"}>
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-lg bg-blue-600 text-sm font-bold text-white">
          C
        </span>
        <div>
          <p
            className={`font-bold tracking-tight ${
              compact ? "text-slate-900" : "text-white"
            }`}
          >
            Commerce OS OPS
          </p>
          {!compact ? (
            <p className="mt-0.5 text-xs text-slate-500">OPS CENTER</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
