"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getAuthStatus, getSetupStatus } from "@/lib/api";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

const PUBLIC_PATHS = new Set(["/login", "/setup"]);

type Phase = "checking" | "needs-setup" | "needs-login" | "authed";

/**
 * Gates every page behind two checks - GET /auth/setup-status (has the one
 * account been created yet?) and GET /auth/me (is this request logged in?)
 * - and swaps the app's chrome in/out accordingly:
 *
 *   no account yet        -> /setup (first-run, standalone, no chrome)
 *   account exists, anon  -> /login (standalone, no chrome)
 *   authed                -> everything else, behind Sidebar+TopBar
 *
 * /setup bounces to /login once an account exists (it's a one-time
 * first-run flow, not an open signup page) and /login bounces to /setup if
 * no account exists yet - so neither screen is reachable in the wrong phase
 * even by typing the URL directly.
 *
 * Re-checks on every navigation (not just first mount) so a session that
 * expires mid-use gets caught on the next click - but doesn't reset to
 * "checking" between navigations, so switching pages while already logged
 * in never flashes a loading state.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const setupStatus = await getSetupStatus();
        if (!setupStatus.account_exists) {
          if (!cancelled) setPhase("needs-setup");
          return;
        }
        const me = await getAuthStatus();
        if (!cancelled) setPhase(me.authenticated ? "authed" : "needs-login");
      } catch {
        if (!cancelled) setPhase("needs-login");
      }
    }

    check();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    if (phase === "checking") return;
    if (phase === "needs-setup" && pathname !== "/setup") {
      router.replace("/setup");
    } else if (phase === "needs-login" && pathname !== "/login") {
      router.replace("/login");
    } else if (phase === "authed" && PUBLIC_PATHS.has(pathname)) {
      router.replace("/");
    }
  }, [phase, pathname, router]);

  const rendersOwnScreen =
    (phase === "needs-setup" && pathname === "/setup") ||
    (phase === "needs-login" && pathname === "/login");

  if (rendersOwnScreen) {
    return <>{children}</>;
  }

  if (phase !== "authed") {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        {children}
      </div>
    </div>
  );
}
