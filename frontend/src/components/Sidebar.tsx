"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Home,
  ListChecks,
  LogOut,
  MessageCircle,
  Video,
} from "lucide-react";
import { useEffect, useState, type ComponentType } from "react";
import { getAuthStatus, logout } from "@/lib/api";

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/meetings", label: "Meetings", icon: Video },
  { href: "/tasks", label: "Tasks", icon: ListChecks },
  { href: "/chat", label: "Chat", icon: MessageCircle },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [accountName, setAccountName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAuthStatus()
      .then((data) => {
        if (!cancelled) setAccountName(data.name);
      })
      .catch(() => {
        if (!cancelled) setAccountName(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    try {
      await logout();
    } catch {
      // Best-effort: even if clearing the cookie server-side fails, still
      // send the user back to the login screen.
    }
    router.push("/login");
  }

  return (
    <aside className="sticky top-0 flex h-screen w-60 flex-shrink-0 flex-col border-r border-slate-200 bg-white">
      <Link href="/" className="flex items-center gap-2.5 px-5 py-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
          M
        </span>
        <span className="text-lg font-semibold tracking-tight text-slate-900">
          Meetscribe
        </span>
      </Link>

      <nav className="flex flex-1 flex-col gap-1 px-3">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                isActive
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <Icon className="h-[18px] w-[18px]" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-100 px-3 py-3">
        {accountName && (
          <p className="truncate px-3 pb-2 text-xs text-slate-400">
            Logged in as <span className="font-medium text-slate-600">{accountName}</span>
          </p>
        )}
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
        >
          <LogOut className="h-[18px] w-[18px]" />
          Log out
        </button>
      </div>
    </aside>
  );
}
