"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Check, ChevronDown, ChevronUp, Pencil, Trash2, X } from "lucide-react";
import {
  ApiError,
  deleteMeeting,
  getCaptureStatus,
  getMeeting,
  getMeetingAnalytics,
  NetworkError,
  stopRecording,
  summarizeMeeting,
  updateMeetingTitle,
} from "@/lib/api";
import { isTerminalCaptureStatus } from "@/lib/captureStatus";
import type { MeetingAnalytics, MeetingDetail } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { ErrorState } from "@/components/ErrorState";
import { Modal } from "@/components/Modal";
import { AudioPlayer, type AudioPlayerHandle } from "@/components/AudioPlayer";
import { TranscriptView, TranscriptSkeleton } from "@/components/TranscriptView";
import { SummaryPanelContent, SidebarSkeleton } from "@/components/SummarySidebar";
import { TalkTimeBarChart } from "@/components/TalkTimeChart";
import { ParticipantsList } from "@/components/ParticipantsList";
import { formatDateTime, formatDuration, meetingTitle, segmentElapsedSeconds } from "@/lib/format";
import { findTranscriptMatches } from "@/lib/transcriptSearch";

// After the initial POST /stop-recording call, Vexa's bot typically needs a
// few seconds to actually finalize the meeting (it answers "stopping"
// immediately, not "completed") - so this briefly polls capture-status the
// same way CaptureMeetingModal already does, rather than assuming one call
// is enough. If it somehow isn't done within this window, the background
// poller (backend/poller.py, unchanged) still picks it up on its own
// schedule - this is just the fast path, not the only path.
const STOP_POLL_INTERVAL_MS = 2000;
const MAX_STOP_POLL_ATTEMPTS = 15;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Click-to-edit title, in place - editing the raw title.title (which may
 * be null/empty), not the display fallback string, so saving an emptied
 * field correctly clears the title back to null rather than persisting the
 * "platform · code" fallback text as a literal title. */
function EditableTitle({
  meetingId,
  displayTitle,
  rawTitle,
  onSaved,
}: {
  meetingId: number;
  displayTitle: string;
  rawTitle: string | null;
  onSaved: (title: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEditing() {
    setDraft(rawTitle ?? "");
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const result = await updateMeetingTitle(meetingId, draft.trim() || null);
      onSaved(result.title);
      setEditing(false);
    } catch (err) {
      if (err instanceof NetworkError || err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Something went wrong saving the title.");
      }
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {displayTitle}
        </h1>
        <button
          type="button"
          onClick={startEditing}
          aria-label="Edit meeting title"
          title="Edit title"
          className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") cancel();
          }}
          placeholder={displayTitle}
          autoFocus
          disabled={saving}
          className="w-full max-w-md rounded-lg border border-border bg-muted px-2.5 py-1.5 text-xl font-semibold text-foreground focus:border-indigo-300 focus:bg-card focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="button"
          onClick={save}
          disabled={saving}
          aria-label="Save title"
          title="Save"
          className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
        >
          <Check className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          aria-label="Cancel editing title"
          title="Cancel"
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {error && <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

export default function MeetingDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [stoppingRecording, setStoppingRecording] = useState(false);
  const [stopRecordingError, setStopRecordingError] = useState<string | null>(null);

  // --- Audio <-> transcript/chapters bidirectional sync ---------------
  const audioPlayerRef = useRef<AudioPlayerHandle>(null);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number | null>(null);
  const [activeChapterIndex, setActiveChapterIndex] = useState<number | null>(null);

  const knownDurationSeconds = useMemo(() => {
    if (!meeting?.start_time || !meeting.end_time) return undefined;
    const startMs = new Date(meeting.start_time).getTime();
    const endMs = new Date(meeting.end_time).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
      return undefined;
    }
    return (endMs - startMs) / 1000;
  }, [meeting]);

  // start_timestamp values are absolute epoch seconds; this maps each one
  // to elapsed-seconds-from-meeting-start once per meeting load, using the
  // exact same anchoring math the mm:ss labels use (lib/format.ts).
  const segmentElapsed = useMemo(() => {
    if (!meeting) return [];
    return meeting.transcript.map((seg) =>
      segmentElapsedSeconds(seg.start_timestamp, meeting.start_time),
    );
  }, [meeting]);

  // Resets activeSegmentIndex/activeChapterIndex when navigating to a
  // different meeting - the React-recommended "adjust state during render"
  // pattern (comparing against the last-seen id) rather than a useEffect,
  // since this is state derived from a prop change, not a subscription to
  // an external system.
  const [lastSyncedMeetingId, setLastSyncedMeetingId] = useState(meetingId);
  if (meetingId !== lastSyncedMeetingId) {
    setLastSyncedMeetingId(meetingId);
    setActiveSegmentIndex(null);
    setActiveChapterIndex(null);
  }

  // Chapters are already sorted (and grounded in real transcript moments)
  // server-side - see backend/summarize_meeting.py's _snap_chapters(). Null
  // when the summary hasn't been (re)generated with chapters support yet.
  const chapters = useMemo(() => meeting?.summary?.chapters ?? [], [meeting]);

  // Re-created every render (not memoized), so this always closes over the
  // current activeSegmentIndex/activeChapterIndex - safe to compare against
  // directly, no ref mirror needed. Only calls setState (the thing that
  // re-renders the transcript/chapters list) when the active item genuinely
  // changes, even though timeupdate itself fires several times a second.
  function handleAudioTimeUpdate(seconds: number) {
    // Segments are chronological, so the last one whose elapsed start is
    // <= the current playback position is "active" - stop as soon as we
    // pass it instead of scanning the whole transcript every tick.
    let idx: number | null = null;
    for (let i = 0; i < segmentElapsed.length; i++) {
      const elapsed = segmentElapsed[i];
      if (elapsed === null) continue;
      if (elapsed <= seconds) idx = i;
      else break;
    }
    if (idx !== activeSegmentIndex) {
      setActiveSegmentIndex(idx);
    }

    // Same "last one at-or-before current time" rule, applied to chapters.
    let chapterIdx: number | null = null;
    for (let i = 0; i < chapters.length; i++) {
      if (chapters[i].start_time_seconds <= seconds) chapterIdx = i;
      else break;
    }
    if (chapterIdx !== activeChapterIndex) {
      setActiveChapterIndex(chapterIdx);
    }
  }

  function handleSegmentClick(index: number) {
    const elapsed = segmentElapsed[index];
    if (elapsed === null || elapsed === undefined) return;
    audioPlayerRef.current?.seekTo(elapsed);
  }

  // Reuses the exact same seek mechanism as transcript click-to-seek above -
  // AudioPlayerHandle.seekTo() - rather than a separate implementation.
  function handleChapterClick(index: number) {
    const chapter = chapters[index];
    if (!chapter) return;
    audioPlayerRef.current?.seekTo(chapter.start_time_seconds);
  }

  // --- "Find in transcript" (client-side, distinct from global Search) ---
  const [transcriptQuery, setTranscriptQuery] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  const transcriptMatches = useMemo(() => {
    if (!meeting) return [];
    return findTranscriptMatches(meeting.transcript, transcriptQuery);
  }, [meeting, transcriptQuery]);

  // Same render-time reset pattern as activeSegmentIndex above: jump back
  // to the first match whenever the query changes (or on a new meeting).
  const matchResetKey = `${meetingId}|${transcriptQuery}`;
  const [lastMatchResetKey, setLastMatchResetKey] = useState(matchResetKey);
  if (matchResetKey !== lastMatchResetKey) {
    setLastMatchResetKey(matchResetKey);
    if (currentMatchIndex !== 0) setCurrentMatchIndex(0);
  }

  const currentMatch =
    transcriptMatches.length > 0
      ? transcriptMatches[currentMatchIndex % transcriptMatches.length]
      : null;

  function goToNextMatch() {
    if (transcriptMatches.length === 0) return;
    setCurrentMatchIndex((i) => (i + 1) % transcriptMatches.length);
  }

  function goToPrevMatch() {
    if (transcriptMatches.length === 0) return;
    setCurrentMatchIndex((i) => (i - 1 + transcriptMatches.length) % transcriptMatches.length);
  }

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

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteMeeting(meetingId);
      router.push("/meetings");
    } catch (err) {
      if (err instanceof NetworkError || err instanceof ApiError) {
        setDeleteError(err.message);
      } else {
        setDeleteError("Something went wrong deleting this meeting.");
      }
      setDeleting(false);
    }
  }

  async function handleStopRecording() {
    setStoppingRecording(true);
    setStopRecordingError(null);
    try {
      let result = await stopRecording(meetingId);
      let attempts = 0;
      while (
        !isTerminalCaptureStatus(result.status) &&
        attempts < MAX_STOP_POLL_ATTEMPTS
      ) {
        await sleep(STOP_POLL_INTERVAL_MS);
        result = await getCaptureStatus(meetingId);
        attempts += 1;
      }
      const refreshed = await getMeeting(meetingId);
      setMeeting(refreshed);
    } catch (err) {
      if (err instanceof NetworkError || err instanceof ApiError) {
        setStopRecordingError(err.message);
      } else {
        setStopRecordingError("Something went wrong ending the recording.");
      }
    } finally {
      setStoppingRecording(false);
    }
  }

  // A rename can change segment counts per speaker (merge case) and the
  // set of distinct participant names, so both the transcript-derived
  // meeting data and the talk-time analytics need a full refetch rather
  // than a local patch - simplest way to stay correct across the merge
  // case without hand-reconciling state in multiple places.
  async function handleParticipantRenamed() {
    try {
      const [freshMeeting, freshAnalytics] = await Promise.all([
        getMeeting(meetingId),
        getMeetingAnalytics(meetingId),
      ]);
      setMeeting(freshMeeting);
      setAnalytics(freshAnalytics);
    } catch {
      // Best-effort refresh - the rename itself already succeeded server-
      // side; a reload of the page will show the latest state regardless.
    }
  }

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
        <h1 className="text-xl font-semibold text-foreground">
          Meeting not found
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
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
    ? meeting.platform === "manual"
      ? "Manually added"
      : formatDuration(meeting.start_time, meeting.end_time)
    : null;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <Link
        href="/meetings"
        className="text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
      >
        &larr; Back to meetings
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {meeting ? (
            <>
              <EditableTitle
                meetingId={meeting.id}
                displayTitle={meetingTitle(meeting.title, meeting.platform, meeting.native_meeting_id)}
                rawTitle={meeting.title}
                onSaved={(title) => setMeeting({ ...meeting, title })}
              />
              <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
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
              <div className="h-7 w-64 rounded bg-muted" />
              <div className="h-4 w-40 rounded bg-muted" />
            </div>
          )}
        </div>
        {meeting && (
          <div className="flex items-center gap-2">
            <StatusBadge status={meeting.status} />
            {checkingStatus && (
              <span className="text-xs text-muted-foreground">Checking status&hellip;</span>
            )}
            {meeting.status === "active" && (
              <button
                type="button"
                onClick={handleStopRecording}
                disabled={stoppingRecording}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
              >
                {stoppingRecording ? "Ending recording…" : "End Recording"}
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              aria-label="Delete meeting"
              title="Delete meeting"
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {stopRecordingError && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{stopRecordingError}</p>
      )}

      {showDeleteConfirm && (
        <Modal
          title="Delete meeting"
          onClose={() => {
            if (!deleting) {
              setShowDeleteConfirm(false);
              setDeleteError(null);
            }
          }}
        >
          <p className="text-sm text-muted-foreground">
            Delete this meeting? This can&apos;t be undone &mdash; its
            transcript, summary, and action items will be permanently
            removed.
          </p>
          {deleteError && (
            <p className="mt-3 text-sm text-red-600 dark:text-red-400">{deleteError}</p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowDeleteConfirm(false);
                setDeleteError(null);
              }}
              disabled={deleting}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </div>
        </Modal>
      )}

      {meeting && (
        <div className="mt-6">
          <AudioPlayer
            ref={audioPlayerRef}
            meetingId={meeting.id}
            knownDurationSeconds={knownDurationSeconds}
            onTimeUpdate={handleAudioTimeUpdate}
          />
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3 lg:items-start">
        <section className="rounded-xl border border-border bg-card p-6 lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">Transcript</h2>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={transcriptQuery}
                onChange={(e) => setTranscriptQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  if (e.shiftKey) goToPrevMatch();
                  else goToNextMatch();
                }}
                placeholder="Find in transcript"
                className="w-40 rounded-lg border border-border bg-muted px-2.5 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:border-indigo-300 focus:bg-card focus:outline-none sm:w-48"
              />
              {transcriptQuery.trim() && (
                <div className="flex items-center gap-0.5 text-xs text-muted-foreground">
                  <span className="mr-1 tabular-nums">
                    {transcriptMatches.length > 0
                      ? `${(currentMatchIndex % transcriptMatches.length) + 1} of ${transcriptMatches.length}`
                      : "0 of 0"}
                  </span>
                  <button
                    type="button"
                    onClick={goToPrevMatch}
                    disabled={transcriptMatches.length === 0}
                    aria-label="Previous match"
                    title="Previous match (Shift+Enter)"
                    className="rounded p-1 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={goToNextMatch}
                    disabled={transcriptMatches.length === 0}
                    aria-label="Next match"
                    title="Next match (Enter)"
                    className="rounded p-1 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="max-h-[70vh] overflow-y-auto pr-1">
            {meeting ? (
              <TranscriptView
                segments={meeting.transcript}
                meetingStartTime={meeting.start_time}
                activeSegmentIndex={activeSegmentIndex}
                onSegmentClick={handleSegmentClick}
                matches={transcriptMatches}
                currentMatch={currentMatch}
              />
            ) : (
              <TranscriptSkeleton />
            )}
          </div>
        </section>

        <aside className="rounded-xl border border-border bg-card p-6 lg:sticky lg:top-6">
          {meeting && meeting.participants.length > 0 && (
            <div className="mb-6 border-b border-border pb-6">
              <h3 className="mb-2 text-sm font-semibold text-foreground">Talk time</h3>
              {meeting.platform === "manual" ? (
                <p className="text-xs italic text-muted-foreground">
                  Talk-time analytics isn&apos;t available for manually created
                  meetings - timestamps here only preserve line order, not
                  real speaking time.
                </p>
              ) : (
                !analyticsFailed &&
                (currentAnalytics === null || currentAnalytics.speakers.length > 0) &&
                (currentAnalytics === null ? (
                  <div className="h-14 animate-pulse rounded bg-muted" />
                ) : (
                  <TalkTimeBarChart speakers={currentAnalytics.speakers} />
                ))
              )}
              <ParticipantsList
                meetingId={meeting.id}
                participants={meeting.participants}
                onRenamed={handleParticipantRenamed}
              />
            </div>
          )}

          {!meeting && <SidebarSkeleton />}

          {meeting && meeting.summary && (
            <SummaryPanelContent
              meetingId={meeting.id}
              summary={meeting.summary}
              actionItems={meeting.action_items}
              onActionItemsChange={(action_items) =>
                setMeeting({ ...meeting, action_items })
              }
              activeChapterIndex={activeChapterIndex}
              onChapterClick={handleChapterClick}
            />
          )}

          {meeting && !meeting.summary && (
            <div className="text-center">
              <p className="text-sm text-muted-foreground">
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
                <p className="mt-2 text-xs text-muted-foreground">
                  This calls Groq and can take a few seconds.
                </p>
              )}
              {summarizeError && (
                <p className="mt-3 text-xs text-red-600 dark:text-red-400">{summarizeError}</p>
              )}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
