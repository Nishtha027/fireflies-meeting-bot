"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  getAnalyticsOverview,
  getMeetingAnalytics,
  getMeetings,
  NetworkError,
} from "@/lib/api";
import type {
  AnalyticsOverview,
  MeetingAnalytics,
  MeetingListItem,
} from "@/lib/types";
import { StatCard } from "@/components/StatCard";
import { ErrorState } from "@/components/ErrorState";
import { EmptyState } from "@/components/EmptyState";
import { TalkTimePieChart } from "@/components/TalkTimeChart";
import {
  formatDateTime,
  formatDuration,
  formatDurationSeconds,
  meetingTitle,
  sortMeetingsNewestFirst,
} from "@/lib/format";

export default function AnalyticsPage() {
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [meetings, setMeetings] = useState<MeetingListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [selectedMeetingId, setSelectedMeetingId] = useState<number | null>(null);
  const [meetingAnalytics, setMeetingAnalytics] = useState<MeetingAnalytics | null>(null);
  const [failedMeetingId, setFailedMeetingId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getAnalyticsOverview(), getMeetings()])
      .then(([overviewData, meetingsData]) => {
        if (cancelled) return;
        const sorted = sortMeetingsNewestFirst(meetingsData);
        setOverview(overviewData);
        setMeetings(sorted);
        setSelectedMeetingId((current) => current ?? sorted[0]?.id ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof NetworkError) {
          setError(err.message);
        } else if (err instanceof ApiError) {
          setError(`The server returned an error: ${err.message}`);
        } else {
          setError("Something went wrong loading analytics.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  // State only changes inside the promise callbacks (not synchronously in
  // the effect body); `meetingAnalytics`/`failedMeetingId` are matched
  // against `selectedMeetingId` at render time, so switching meetings never
  // shows a flash of the previous meeting's stale chart.
  useEffect(() => {
    if (selectedMeetingId === null) return;
    let cancelled = false;
    getMeetingAnalytics(selectedMeetingId)
      .then((data) => {
        if (!cancelled) setMeetingAnalytics(data);
      })
      .catch(() => {
        if (!cancelled) setFailedMeetingId(selectedMeetingId);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedMeetingId]);

  const meetingAnalyticsError = failedMeetingId === selectedMeetingId;
  const currentMeetingAnalytics =
    meetingAnalytics?.meeting_id === selectedMeetingId ? meetingAnalytics : null;

  const retry = () => {
    setError(null);
    setOverview(null);
    setMeetings(null);
    setSelectedMeetingId(null);
    setReloadToken((t) => t + 1);
  };

  const selectedMeeting = useMemo(
    () => meetings?.find((m) => m.id === selectedMeetingId) ?? null,
    [meetings, selectedMeetingId],
  );

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Analytics
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Talk-time and meeting stats across everything Meetscribe has recorded.
        </p>
      </div>

      {error && <ErrorState message={error} onRetry={retry} />}

      {!error && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Meetings recorded" value={overview?.total_meetings ?? null} />
            <StatCard
              label="Total recording time"
              value={overview ? formatDurationSeconds(overview.total_duration_seconds) : null}
            />
            <StatCard
              label="Top speaker"
              value={
                overview === null
                  ? null
                  : (overview.top_speaker?.name ?? "No speaker data yet")
              }
              caption={
                overview?.top_speaker
                  ? `${overview.top_speaker.total_minutes.toFixed(1)} min total`
                  : undefined
              }
            />
          </div>

          <div className="mt-10">
            <h2 className="text-lg font-semibold text-foreground">Per-meeting talk time</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Select a meeting to see how talk time was split between speakers.
            </p>

            <div className="mt-4">
              {meetings === null && (
                <div className="animate-pulse space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-16 rounded-xl bg-muted" />
                  ))}
                </div>
              )}

              {meetings !== null && meetings.length === 0 && <EmptyState />}

              {meetings !== null && meetings.length > 0 && (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:items-start">
                  <div className="flex flex-col gap-2 lg:col-span-1">
                    {meetings.map((m) => {
                      const isSelected = m.id === selectedMeetingId;
                      const duration =
                        m.platform === "manual"
                          ? "Manually added"
                          : formatDuration(m.start_time, m.end_time);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setSelectedMeetingId(m.id)}
                          aria-pressed={isSelected}
                          className={`rounded-xl border px-4 py-3 text-left transition ${
                            isSelected
                              ? "border-indigo-300 bg-indigo-50 dark:border-indigo-500/60 dark:bg-indigo-500/15"
                              : "border-border bg-card hover:border-muted-foreground/40"
                          }`}
                        >
                          <p className="text-sm font-medium text-foreground">
                            {meetingTitle(m.title, m.platform, m.native_meeting_id)}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {formatDateTime(m.start_time)}
                            {duration && <> &middot; {duration}</>}
                          </p>
                        </button>
                      );
                    })}
                  </div>

                  <div className="rounded-xl border border-border bg-card p-6 lg:col-span-2">
                    {selectedMeeting && (
                      <h3 className="mb-4 text-sm font-semibold text-foreground">
                        {meetingTitle(selectedMeeting.title, selectedMeeting.platform, selectedMeeting.native_meeting_id)}
                      </h3>
                    )}

                    {selectedMeeting?.platform === "manual" ? (
                      <p className="py-8 text-center text-sm italic text-muted-foreground">
                        Talk-time analytics isn&apos;t available for manually
                        created meetings - timestamps here only preserve line
                        order, not real speaking time.
                      </p>
                    ) : (
                      <>
                        {meetingAnalyticsError && (
                          <p className="text-sm text-red-600 dark:text-red-400">
                            Couldn&apos;t load this meeting&apos;s talk-time breakdown.
                          </p>
                        )}

                        {!meetingAnalyticsError && currentMeetingAnalytics === null && (
                          <div className="h-48 animate-pulse rounded bg-muted" />
                        )}

                        {!meetingAnalyticsError && currentMeetingAnalytics && (
                          <TalkTimePieChart speakers={currentMeetingAnalytics.speakers} />
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
