"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";

const SEARCH_DEBOUNCE_MS = 350;

export function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Read via a ref (not a reactive dependency) so navigating away - e.g.
  // clicking a search result - doesn't re-run the debounce effect and
  // reschedule another push back to /search just because pathname changed.
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const goToSearch = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      const url = trimmed
        ? `/search?q=${encodeURIComponent(trimmed)}`
        : "/search";
      if (pathnameRef.current === "/search") {
        router.replace(url, { scroll: false });
      } else {
        router.push(url);
      }
    },
    [router],
  );

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) return;

    const timeout = setTimeout(() => goToSearch(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [query, goToSearch]);

  // Ctrl+K / Cmd+K focuses the search input from anywhere in the app - this
  // component lives in the root layout, so it's always mounted.
  useEffect(() => {
    function handleGlobalKeyDown(e: globalThis.KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      goToSearch(query);
    }
  }

  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <header className="sticky top-0 z-10 flex h-14 flex-shrink-0 items-center border-b border-border bg-card px-6">
      <div className="relative w-full max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search by title or keyword"
          aria-label="Search meetings"
          className="w-full rounded-lg border border-border bg-muted py-2 pl-9 pr-14 text-sm text-foreground placeholder:text-muted-foreground focus:border-indigo-300 focus:bg-card focus:outline-none"
        />
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {isMac ? "⌘K" : "Ctrl K"}
        </kbd>
      </div>
    </header>
  );
}
