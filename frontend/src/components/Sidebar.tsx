"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Home,
  ListChecks,
  LogOut,
  MessageCircle,
  Settings,
  Video,
} from "lucide-react";
import { type ComponentType } from "react";
import { logout } from "@/lib/api";
import { useAuth } from "@/lib/AuthContext";

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
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const accountName = user?.name ?? null;

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
    <aside className="sticky top-0 flex h-screen w-60 flex-shrink-0 flex-col border-r border-border bg-card">
      <Link href="/" className="flex items-center gap-2.5 px-5 py-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
          M
        </span>
        <span className="text-lg font-semibold tracking-tight text-foreground">
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
                  ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-[18px] w-[18px]" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border px-3 py-3">
        {accountName && (
          <p className="truncate px-3 pb-2 text-xs text-muted-foreground">
            Logged in as <span className="font-medium text-foreground">{accountName}</span>
          </p>
        )}
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <LogOut className="h-[18px] w-[18px]" />
          Log out
        </button>
      </div>
    </aside>
  );
}
