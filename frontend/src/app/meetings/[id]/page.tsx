"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ApiError,
  getCaptureStatus,
  getMeeting,
  getMeetingAnalytics,
  NetworkError,
  summarizeMeeting,
} from "@/lib/api";
import { isTerminalCaptureStatus } from "@/lib/captureStatus";
import type { MeetingAnalytics, MeetingDetail } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { ErrorState } from "@/components/ErrorState";
import { TranscriptView, TranscriptSkeleton } from "@/components/TranscriptView";
import { SummaryPanelContent, SidebarSkeleton } from "@/components/SummarySidebar";
import { TalkTimeBarChart } from "@/components/TalkTimeChart";
import { formatDateTime, formatDuration, meetingTitle } from "@/lib/format";

export default function MeetingDetailPage() {
  const params = useParams<{ id: string }>();
  const meetingId = Number(params.id);

  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [analytics, setAnalytics] = useState<MeetingAnalytics | null>(null);
  const [analyticsFailedFor, setAnalyticsFailedFor] = useState<number | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [summarizeError, setSummarizeError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const invalidId = Number.isNaN(meetingId);

  useEffect(() => {
    if (invalidId) return;
    let cancelled = false;
    getMeeting(meetingId)
      .then((data) => {
        if (cancelled) return;
        setMeeting(data);

        // The backend's own background job (see backend/poller.py) is what
        // actually finishes an in-progress meeting - it runs independently
        // of this page. This is just a single, one-time check so a page
        // load that happens to land between the job's cycles doesn't show
        // stale "Active" for up to a full interval: if the meeting has
        // already completed by the time this loads, refresh once to show
        // it. Not a polling loop - if it's still in progress, the page
        // simply shows that, same as before.
        if (!isTerminalCaptureStatus(data.status)) {
          setCheckingStatus(true);
          getCaptureStatus(meetingId)
            .then((status) => {
              if (cancelled || status.status !== "completed") return;
              return getMeeting(meetingId).then((fresh) => {
                if (!cancelled) setMeeting(fresh);
              });
            })
            .catch(() => {
              // Best-effort only - if this single check fails, the page
              // just shows what it already has, and the background job
              // will still catch up on its own schedule regardless.
            })
            .finally(() => {
              if (!cancelled) setCheckingStatus(false);
            });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else if (err instanceof NetworkError) {
          setError(err.message);
        } else if (err instanceof ApiError) {
          setError(`The server returned an error: ${err.message}`);
        } else {
          setError("Something went wrong loading this meeting.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [meetingId, invalidId, reloadToken]);

  // Independent of the meeting fetch above (and of the "no summary yet"
  // state) - a compact talk-time widget that just quietly doesn't render if
  // it fails, rather than blocking the whole page on a secondary feature.
  // State only changes inside the promise callbacks (not synchronously in
  // the effect body); `analytics`/`analyticsFailedFor` are matched against
  // `meetingId` at render time so stale data from a previous id is never
  // shown, without needing an eager reset.
  useEffect(() => {
    if (invalidId) return;
    let cancelled = false;
    getMeetingAnalytics(meetingId)
      .then((data) => {
        if (!cancelled) setAnalytics(data);
      })
      .catch(() => {
        if (!cancelled) setAnalyticsFailedFor(meetingId);
      });
    return () => {
      cancelled = true;
    };
  }, [meetingId, invalidId, reloadToken]);

  const analyticsFailed = analyticsFailedFor === meetingId;
  const currentAnalytics = analytics?.meeting_id === meetingId ? analytics : null;

  const retry = () => {
    setError(null);
    setNotFound(false);
    setMeeting(null);
    setReloadToken((t) => t + 1);
  };

  async function handleGenerateSummary() {
    setSummarizing(true);
    setSummarizeError(null);
    try {
      await summarizeMeeting(meetingId);
      const refreshed = await getMeeting(meetingId);
      setMeeting(refreshed);
    } catch (err) {
      if (err instanceof NetworkError || err instanceof ApiError) {
        setSummarizeError(err.message);
      } else {
        setSummarizeError("Something went wrong generating the summary.");
      }
    } finally {
      setSummarizing(false);
    }
  }

  if (invalidId || notFound) {
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-16 text-center">
        <h1 className="text-xl font-semibold text-slate-900">
          Meeting not found
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          There&apos;s no meeting with id {params.id}.
        </p>
        <Link
          href="/meetings"
          className="mt-6 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Back to meetings
        </Link>
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <ErrorState message={error} onRetry={retry} />
      </main>
    );
  }

  const duration = meeting
    ? formatDuration(meeting.start_time, meeting.end_time)
    : null;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <Link
        href="/meetings"
        className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
      >
        &larr; Back to meetings
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          {meeting ? (
            <>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                {meetingTitle(meeting.platform, meeting.native_meeting_id)}
              </h1>
              <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
                <span>{formatDateTime(meeting.start_time)}</span>
                {duration && (
                  <>
                    <span aria-hidden>&middot;</span>
                    <span>{duration}</span>
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="animate-pulse space-y-2">
              <div className="h-7 w-64 rounded bg-slate-200" />
              <div className="h-4 w-40 rounded bg-slate-100" />
            </div>
          )}
        </div>
        {meeting && (
          <div className="flex items-center gap-2">
            <StatusBadge status={meeting.status} />
            {checkingStatus && (
              <span className="text-xs text-slate-400">Checking status&hellip;</span>
            )}
          </div>
        )}
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3 lg:items-start">
        <section className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">
            Transcript
          </h2>
          <div className="max-h-[70vh] overflow-y-auto pr-1">
            {meeting ? (
              <TranscriptView
                segments={meeting.transcript}
                meetingStartTime={meeting.start_time}
              />
            ) : (
              <TranscriptSkeleton />
            )}
          </div>
        </section>

        <aside className="rounded-xl border border-slate-200 bg-white p-6 lg:sticky lg:top-6">
          {meeting &&
            !analyticsFailed &&
            (currentAnalytics === null || currentAnalytics.speakers.length > 0) && (
              <div className="mb-6 border-b border-slate-100 pb-6">
                <h3 className="mb-2 text-sm font-semibold text-slate-900">Talk time</h3>
                {currentAnalytics === null ? (
                  <div className="h-14 animate-pulse rounded bg-slate-100" />
                ) : (
                  <TalkTimeBarChart speakers={currentAnalytics.speakers} />
                )}
              </div>
            )}

          {!meeting && <SidebarSkeleton />}

          {meeting && meeting.summary && (
            <SummaryPanelContent
              summary={meeting.summary}
              actionItems={meeting.action_items}
            />
          )}

          {meeting && !meeting.summary && (
            <div className="text-center">
              <p className="text-sm text-slate-500">
                This meeting hasn&apos;t been summarized yet.
              </p>
              <button
                onClick={handleGenerateSummary}
                disabled={summarizing}
                className="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {summarizing ? "Generating summary…" : "Generate Summary"}
              </button>
              {summarizing && (
                <p className="mt-2 text-xs text-slate-400">
                  This calls Groq and can take a few seconds.
                </p>
              )}
              {summarizeError && (
                <p className="mt-3 text-xs text-red-600">{summarizeError}</p>
              )}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
