"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { ApiError, NetworkError, searchMeetings } from "@/lib/api";
import type { MeetingListItem, SearchResult } from "@/lib/types";
import { ErrorState } from "@/components/ErrorState";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { MeetingCard, MeetingCardSkeleton } from "@/components/MeetingCard";
import {
  SearchResultCard,
  SearchResultCardSkeleton,
} from "@/components/SearchResultCard";

const MIN_QUERY_LENGTH = 2;

function toMeetingListItem(result: SearchResult): MeetingListItem {
  return {
    id: result.meeting_id,
    platform: result.platform,
    native_meeting_id: result.native_meeting_id,
    start_time: result.start_time,
    end_time: result.end_time,
    status: result.status,
    overview_preview: result.snippet,
  };
}

function describeFilters(q: string, fromDate: string, toDate: string): string {
  const parts: string[] = [];
  if (q) parts.push(`"${q}"`);
  if (fromDate && toDate) parts.push(`${fromDate} to ${toDate}`);
  else if (fromDate) parts.push(`from ${fromDate} onward`);
  else if (toDate) parts.push(`through ${toDate}`);
  return parts.join(" · ");
}

function NeutralPlaceholder() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-16 text-center">
      <SearchIcon className="h-6 w-6 text-slate-400" />
      <p className="text-base font-semibold text-slate-700">
        Search by keyword, filter by date, or both
      </p>
      <p className="max-w-sm text-sm text-slate-500">
        Type something above, pick a date range below, or combine both - no
        keyword required.
      </p>
    </div>
  );
}

function NoResults({ description }: { description: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-16 text-center">
      <p className="text-base font-semibold text-slate-700">
        No meetings match {description}
      </p>
      <p className="max-w-sm text-sm text-slate-500">
        Try a different word, phrase, or date range.
      </p>
    </div>
  );
}

function SearchPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const q = (searchParams.get("q") ?? "").trim();
  const fromDate = searchParams.get("from") ?? "";
  const toDate = searchParams.get("to") ?? "";

  const hasKeyword = q.length >= MIN_QUERY_LENGTH;
  const hasDateFilter = fromDate !== "" || toDate !== "";
  const hasAnyFilter = hasKeyword || hasDateFilter;
  const invalidRange = fromDate !== "" && toDate !== "" && fromDate > toDate;

  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [lastFilterKey, setLastFilterKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const filterKey = `${q}|${fromDate}|${toDate}`;

  useEffect(() => {
    if (!hasAnyFilter || invalidRange) return;
    let cancelled = false;
    searchMeetings({
      q: hasKeyword ? q : undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
    })
      .then((data) => {
        if (cancelled) return;
        setResults(data);
        setLastFilterKey(filterKey);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof NetworkError) {
          setError(err.message);
        } else if (err instanceof ApiError) {
          setError(`The server returned an error: ${err.message}`);
        } else {
          setError("Something went wrong searching.");
        }
        setLastFilterKey(filterKey);
      });
    return () => {
      cancelled = true;
    };
  }, [
    filterKey,
    q,
    fromDate,
    toDate,
    hasKeyword,
    hasAnyFilter,
    invalidRange,
    reloadToken,
  ]);

  const retry = () => {
    setError(null);
    setReloadToken((t) => t + 1);
  };

  const handleDateChange = (range: { fromDate: string; toDate: string }) => {
    const usp = new URLSearchParams();
    if (q) usp.set("q", q);
    if (range.fromDate) usp.set("from", range.fromDate);
    if (range.toDate) usp.set("to", range.toDate);
    const qs = usp.toString();
    router.replace(qs ? `/search?${qs}` : "/search", { scroll: false });
  };

  // A new filter combination is in flight while we still have results from
  // the previous one - keep them visible with a subtle indicator instead of
  // flashing a full skeleton on every change.
  const isLoading = hasAnyFilter && filterKey !== lastFilterKey && !error;
  const description = describeFilters(q, fromDate, toDate);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Search
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {hasAnyFilter
            ? `Results for ${description}`
            : "Search across every meeting's transcript and summary, or browse by date."}
        </p>
      </div>

      <div className="mb-8">
        <DateRangeFilter
          fromDate={fromDate}
          toDate={toDate}
          onChange={handleDateChange}
        />
      </div>

      {invalidRange && (
        <p className="mb-4 text-sm text-red-600">
          The &ldquo;from&rdquo; date must not be after the &ldquo;to&rdquo;
          date.
        </p>
      )}

      {!hasAnyFilter && !invalidRange && <NeutralPlaceholder />}

      {hasAnyFilter && error && <ErrorState message={error} onRetry={retry} />}

      {hasAnyFilter && !error && !invalidRange && (
        <>
          {isLoading && (
            <p className="mb-3 text-xs text-slate-400">Searching…</p>
          )}

          {results === null && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <SearchResultCardSkeleton key={i} />
              ))}
            </div>
          )}

          {results !== null && results.length === 0 && (
            <NoResults description={description} />
          )}

          {results !== null && results.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {results.map((result) =>
                result.matched_field === null ? (
                  <MeetingCard
                    key={result.meeting_id}
                    meeting={toMeetingListItem(result)}
                  />
                ) : (
                  <SearchResultCard key={result.meeting_id} result={result} />
                ),
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}

function SearchPageFallback() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <MeetingCardSkeleton key={i} />
        ))}
      </div>
    </main>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<SearchPageFallback />}>
      <SearchPageContent />
    </Suspense>
  );
}
