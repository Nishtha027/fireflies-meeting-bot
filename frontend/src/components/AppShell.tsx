"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getAuthStatus } from "@/lib/api";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

const PUBLIC_PATHS = new Set(["/login", "/register"]);

type AuthState = "checking" | "authed" | "anon";

/**
 * Gates every page behind a session check and swaps the app's chrome
 * in/out: /login and /register render standalone (no sidebar/top bar),
 * everything else renders behind Sidebar+TopBar only once GET /auth/me
 * confirms a session.
 *
 * Re-checks on every navigation (not just first mount) so a session that
 * expires mid-use gets caught on the next click, not just on a hard
 * refresh - but doesn't reset to "checking" between navigations, so
 * switching pages while already logged in never flashes a loading state.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isPublicPath = PUBLIC_PATHS.has(pathname);
  const [authState, setAuthState] = useState<AuthState>("checking");

  useEffect(() => {
    let cancelled = false;
    getAuthStatus()
      .then((data) => {
        if (!cancelled) setAuthState(data.authenticated ? "authed" : "anon");
      })
      .catch(() => {
        if (!cancelled) setAuthState("anon");
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    if (authState === "checking") return;
    if (authState === "anon" && !isPublicPath) {
      router.replace("/login");
    } else if (authState === "authed" && isPublicPath) {
      router.replace("/");
    }
  }, [authState, isPublicPath, router]);

  if (isPublicPath) {
    return <>{children}</>;
  }

  if (authState !== "authed") {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-indigo-600" />
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
