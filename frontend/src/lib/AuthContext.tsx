"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { getAuthStatus } from "./api";
import type { MeResponse } from "./types";

interface AuthContextValue {
  user: MeResponse | null;
  /** Re-fetches GET /auth/me and updates every consumer. */
  refresh: () => Promise<void>;
  /**
   * Updates the shared user state directly from a response we already
   * have (e.g. PATCH /settings/account's own response) - lets the
   * Settings page and the sidebar's "Logged in as X" reflect a change
   * immediately, without a second round-trip to GET /auth/me.
   */
  setUser: (user: MeResponse) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * A single shared GET /auth/me result for anything that displays the
 * current user's profile (Sidebar, Settings) - separate from AppShell's
 * own auth check, which keeps gating/redirect logic untouched and
 * independent of this. Mounted once in layout.tsx so it's available on
 * every page.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<MeResponse | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getAuthStatus();
      setUserState(data);
    } catch {
      setUserState(null);
    }
  }, []);

  // Inlined rather than calling refresh() from here (matching AppShell's own
  // getAuthStatus().then(...) effect): setUserState then only ever runs
  // inside a .then() callback, not synchronously in the effect body.
  useEffect(() => {
    let cancelled = false;
    getAuthStatus()
      .then((data) => {
        if (!cancelled) setUserState(data);
      })
      .catch(() => {
        if (!cancelled) setUserState(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setUser = useCallback((data: MeResponse) => {
    setUserState(data);
  }, []);

  return (
    <AuthContext.Provider value={{ user, refresh, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth() must be used within an AuthProvider.");
  }
  return ctx;
}
