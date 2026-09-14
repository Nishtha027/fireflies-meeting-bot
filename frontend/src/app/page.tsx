"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import {
  ApiError,
  getActionItems,
  getMeetings,
  NetworkError,
} from "@/lib/api";
import type { MeetingListItem } from "@/lib/types";
import { isThisWeek, sortMeetingsNewestFirst } from "@/lib/format";
import { MeetingCard, MeetingCardSkeleton } from "@/components/MeetingCard";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { StatCard } from "@/components/StatCard";
import { QuickStart } from "@/components/QuickStart";
import { ComingSoonPanel } from "@/components/ComingSoonPanel";

const RECENT_COUNT = 5;

type HomeTab = "recent" | "upcoming";

export default function HomePage() {
  const [meetings, setMeetings] = useState<MeetingListItem[] | null>(null);
  const [openActionItemCount, setOpenActionItemCount] = useState<
    number | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [tab, setTab] = useState<HomeTab>("recent");

  useEffect(() => {
    let cancelled = false;
    Promise.all([getMeetings(), getActionItems()])
      .then(([meetingsData, actionItemsData]) => {
        if (cancelled) return;
        setMeetings(sortMeetingsNewestFirst(meetingsData));
        setOpenActionItemCount(
          actionItemsData.filter((item) => !item.completed).length,
        );
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof NetworkError) {
          setError(err.message);
        } else if (err instanceof ApiError) {
          setError(`The server returned an error: ${err.message}`);
        } else {
          setError("Something went wrong loading your dashboard.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const retry = () => {
    setError(null);
    setMeetings(null);
    setOpenActionItemCount(null);
    setReloadToken((t) => t + 1);
  };

  const meetingsThisWeek =
    meetings?.filter((m) => isThisWeek(m.start_time)).length ?? null;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Home
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          An at-a-glance look at everything Meetscribe has recorded.
        </p>
      </div>

      {error && <ErrorState message={error} onRetry={retry} />}

      {!error && (
        <>
          <QuickStart />

          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Meetings recorded" value={meetings?.length ?? null} />
            <StatCard label="Open action items" value={openActionItemCount} />
            <StatCard label="Meetings this week" value={meetingsThisWeek} />
          </div>

          <div className="mt-10">
            <div className="flex items-center justify-between border-b border-border">
              <div className="flex gap-6">
                <button
                  type="button"
                  onClick={() => setTab("recent")}
                  className={`-mb-px border-b-2 pb-2.5 text-sm font-medium transition ${
                    tab === "recent"
                      ? "border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Recent
                </button>
                <button
                  type="button"
                  onClick={() => setTab("upcoming")}
                  className={`-mb-px border-b-2 pb-2.5 text-sm font-medium transition ${
                    tab === "upcoming"
                      ? "border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Upcoming
                </button>
              </div>
              {tab === "recent" && (
                <Link
                  href="/meetings"
                  className="mb-2.5 text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
                >
                  View all meetings &rarr;
                </Link>
              )}
            </div>

            <div className="mt-4">
              {tab === "upcoming" && (
                <ComingSoonPanel
                  icon={CalendarClock}
                  message="Connect your calendar to see upcoming meetings here."
                />
              )}

              {tab === "recent" && (
                <>
                  {meetings === null && (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <MeetingCardSkeleton key={i} />
                      ))}
                    </div>
                  )}

                  {meetings !== null && meetings.length === 0 && <EmptyState />}

                  {meetings !== null && meetings.length > 0 && (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {meetings.slice(0, RECENT_COUNT).map((meeting) => (
                        <MeetingCard key={meeting.id} meeting={meeting} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
