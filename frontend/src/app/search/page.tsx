"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { ApiError, NetworkError, searchMeetings } from "@/lib/api";
import type { MeetingListItem, SearchResult } from "@/lib/types";
import { ErrorState } from "@/components/ErrorState";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { ParticipantFilter } from "@/components/ParticipantFilter";
import { MeetingCard, MeetingCardSkeleton } from "@/components/MeetingCard";
import {
  SearchResultCard,
  SearchResultCardSkeleton,
} from "@/components/SearchResultCard";

const MIN_QUERY_LENGTH = 2;

function toMeetingListItem(result: SearchResult): MeetingListItem {
  return {
    id: result.meeting_id,
    title: result.title,
    platform: result.platform,
    native_meeting_id: result.native_meeting_id,
    start_time: result.start_time,
    end_time: result.end_time,
    status: result.status,
    overview_preview: result.snippet,
    // Search results don't carry per-meeting participant lists (that'd mean
    // an extra aggregation per result row) - the card just renders no
    // avatars for these, same as a meeting with zero known speakers.
    participants: [],
  };
}

function describeFilters(
  q: string,
  fromDate: string,
  toDate: string,
  participant: string,
): string {
  const parts: string[] = [];
  if (q) parts.push(`"${q}"`);
  if (fromDate && toDate) parts.push(`${fromDate} to ${toDate}`);
  else if (fromDate) parts.push(`from ${fromDate} onward`);
  else if (toDate) parts.push(`through ${toDate}`);
  if (participant) parts.push(`participant: ${participant}`);
  return parts.join(" · ");
}

function NeutralPlaceholder() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted px-6 py-16 text-center">
      <SearchIcon className="h-6 w-6 text-muted-foreground" />
      <p className="text-base font-semibold text-foreground">
        Search by keyword, filter by date, or both
      </p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Type something above, pick a date range or participant below, or
        combine them - no keyword required.
      </p>
    </div>
  );
}

function NoResults({ description }: { description: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted px-6 py-16 text-center">
      <p className="text-base font-semibold text-foreground">
        No meetings match {description}
      </p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Try a different word, phrase, date range, or participant.
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
  const participant = searchParams.get("participant") ?? "";

  const hasKeyword = q.length >= MIN_QUERY_LENGTH;
  const hasDateFilter = fromDate !== "" || toDate !== "";
  const hasParticipantFilter = participant !== "";
  const hasAnyFilter = hasKeyword || hasDateFilter || hasParticipantFilter;
  const invalidRange = fromDate !== "" && toDate !== "" && fromDate > toDate;

  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [lastFilterKey, setLastFilterKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const filterKey = `${q}|${fromDate}|${toDate}|${participant}`;

  useEffect(() => {
    if (!hasAnyFilter || invalidRange) return;
    let cancelled = false;
    searchMeetings({
      q: hasKeyword ? q : undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      participant: participant || undefined,
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
    participant,
    hasKeyword,
    hasAnyFilter,
    invalidRange,
    reloadToken,
  ]);

  const retry = () => {
    setError(null);
    setReloadToken((t) => t + 1);
  };

  // Preserves every OTHER active filter (q, dates, participant) while
  // updating just the one the caller changed - shared by the date range and
  // participant filter handlers below so changing one never silently drops
  // the other.
  const pushFilters = (next: {
    fromDate: string;
    toDate: string;
    participant: string;
  }) => {
    const usp = new URLSearchParams();
    if (q) usp.set("q", q);
    if (next.fromDate) usp.set("from", next.fromDate);
    if (next.toDate) usp.set("to", next.toDate);
    if (next.participant) usp.set("participant", next.participant);
    const qs = usp.toString();
    router.replace(qs ? `/search?${qs}` : "/search", { scroll: false });
  };

  const handleDateChange = (range: { fromDate: string; toDate: string }) => {
    pushFilters({ fromDate: range.fromDate, toDate: range.toDate, participant });
  };

  const handleParticipantChange = (nextParticipant: string) => {
    pushFilters({ fromDate, toDate, participant: nextParticipant });
  };

  // A new filter combination is in flight while we still have results from
  // the previous one - keep them visible with a subtle indicator instead of
  // flashing a full skeleton on every change.
  const isLoading = hasAnyFilter && filterKey !== lastFilterKey && !error;
  const description = describeFilters(q, fromDate, toDate, participant);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Search
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {hasAnyFilter
            ? `Results for ${description}`
            : "Search across every meeting's transcript and summary, or browse by date."}
        </p>
      </div>

      <div className="mb-8 flex flex-wrap items-center gap-x-4 gap-y-3">
        <DateRangeFilter
          fromDate={fromDate}
          toDate={toDate}
          onChange={handleDateChange}
        />
        <ParticipantFilter
          participant={participant}
          onChange={handleParticipantChange}
        />
      </div>

      {invalidRange && (
        <p className="mb-4 text-sm text-red-600 dark:text-red-400">
          The &ldquo;from&rdquo; date must not be after the &ldquo;to&rdquo;
          date.
        </p>
      )}

      {!hasAnyFilter && !invalidRange && <NeutralPlaceholder />}

      {hasAnyFilter && error && <ErrorState message={error} onRetry={retry} />}

      {hasAnyFilter && !error && !invalidRange && (
        <>
          {isLoading && (
            <p className="mb-3 text-xs text-muted-foreground">Searching…</p>
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
