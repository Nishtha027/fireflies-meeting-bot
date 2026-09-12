"use client";

import { useEffect, useState } from "react";
import { ApiError, getMeetings, NetworkError } from "@/lib/api";
import type { MeetingListItem } from "@/lib/types";
import { sortMeetingsNewestFirst } from "@/lib/format";
import { MeetingCard, MeetingCardSkeleton } from "@/components/MeetingCard";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";

export default function MeetingsPage() {
  const [meetings, setMeetings] = useState<MeetingListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getMeetings()
      .then((data) => {
        if (!cancelled) setMeetings(sortMeetingsNewestFirst(data));
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof NetworkError) {
          setError(err.message);
        } else if (err instanceof ApiError) {
          setError(`The server returned an error: ${err.message}`);
        } else {
          setError("Something went wrong loading meetings.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const retry = () => {
    setError(null);
    setMeetings(null);
    setReloadToken((t) => t + 1);
  };

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

      {error && <ErrorState message={error} onRetry={retry} />}

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
