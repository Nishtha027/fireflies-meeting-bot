"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, getMeetings, NetworkError } from "@/lib/api";
import type { MeetingListItem } from "@/lib/types";
import { MeetingCard, MeetingCardSkeleton } from "@/components/MeetingCard";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";

function sortNewestFirst(meetings: MeetingListItem[]): MeetingListItem[] {
  return [...meetings].sort((a, b) => {
    const aTime = a.start_time ? new Date(a.start_time).getTime() : -Infinity;
    const bTime = b.start_time ? new Date(b.start_time).getTime() : -Infinity;
    return bTime - aTime;
  });
}

export default function Home() {
  const [meetings, setMeetings] = useState<MeetingListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setMeetings(null);
    try {
      const data = await getMeetings();
      setMeetings(sortNewestFirst(data));
    } catch (err) {
      if (err instanceof NetworkError) {
        setError(err.message);
      } else if (err instanceof ApiError) {
        setError(`The server returned an error: ${err.message}`);
      } else {
        setError("Something went wrong loading meetings.");
      }
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Meetings
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Transcripts and summaries from every recorded meeting.
        </p>
      </div>

      {error && <ErrorState message={error} onRetry={load} />}

      {!error && meetings === null && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <MeetingCardSkeleton key={i} />
          ))}
        </div>
      )}

      {!error && meetings !== null && meetings.length === 0 && <EmptyState />}

      {!error && meetings !== null && meetings.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {meetings.map((meeting) => (
            <MeetingCard key={meeting.id} meeting={meeting} />
          ))}
        </div>
      )}
    </main>
  );
}
