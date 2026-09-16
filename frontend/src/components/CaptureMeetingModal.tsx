"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";
import {
  ApiError,
  captureMeeting,
  createManualMeeting,
  getCaptureStatus,
  NetworkError,
} from "@/lib/api";
import { TERMINAL_CAPTURE_STATUSES as TERMINAL_STATUSES } from "@/lib/captureStatus";
import { Modal } from "./Modal";

const POLL_INTERVAL_MS = 4000;
const MAX_CONSECUTIVE_POLL_ERRORS = 5;

type Mode = "live" | "paste";

const STATUS_MESSAGES: Record<string, string> = {
  requested: "Bot dispatched — waiting to join the call…",
  joining: "Bot is joining the meeting…",
  awaiting_admission: "Waiting to be admitted — please let the bot into the meeting.",
  active: "Connected — recording the meeting…",
  stopping: "Wrapping up…",
  needs_help: "The bot needs help — check the meeting window.",
};

interface CaptureState {
  meetingId: number;
  status: string;
  segmentsSaved: number;
  summarized: boolean;
  summarizeError: string | null;
}

export function CaptureMeetingModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("live");

  const [meetingUrl, setMeetingUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [capture, setCapture] = useState<CaptureState | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);

  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteDate, setPasteDate] = useState("");
  const [pasteTranscript, setPasteTranscript] = useState("");
  const [pasteSubmitting, setPasteSubmitting] = useState(false);
  const [pasteError, setPasteError] = useState<string | null>(null);

  const consecutiveErrorsRef = useRef(0);

  // Live UI feedback only, for whoever's actively watching this modal - not
  // load-bearing. The backend's own background poller (see backend/poller.py)
  // independently checks every in-progress meeting on its own schedule and
  // triggers ingestion/summarization on completion regardless of whether
  // this modal - or any tab - is even open. If this interval never got
  // another chance to run (closed modal, closed tab), the meeting still
  // completes and gets summarized on its own.
  useEffect(() => {
    if (capture === null || TERMINAL_STATUSES.has(capture.status)) return;

    let cancelled = false;
    const interval = setInterval(() => {
      getCaptureStatus(capture.meetingId)
        .then((data) => {
          if (cancelled) return;
          consecutiveErrorsRef.current = 0;
          setPollError(null);
          setCapture({
            meetingId: data.meeting_id,
            status: data.status,
            segmentsSaved: data.segments_saved,
            summarized: data.summarized,
            summarizeError: data.summarize_error,
          });
        })
        .catch((err) => {
          if (cancelled) return;
          consecutiveErrorsRef.current += 1;
          if (consecutiveErrorsRef.current >= MAX_CONSECUTIVE_POLL_ERRORS) {
            setPollError(
              err instanceof NetworkError || err instanceof ApiError
                ? err.message
                : "Lost track of this meeting's status.",
            );
          }
        });
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [capture]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = meetingUrl.trim();
    if (!trimmed) {
      setFormError("Paste a Google Meet link first.");
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      const result = await captureMeeting(trimmed);
      setCapture({
        meetingId: result.meeting_id,
        status: result.status,
        segmentsSaved: 0,
        summarized: false,
        summarizeError: null,
      });
    } catch (err) {
      if (err instanceof NetworkError) {
        setFormError(err.message);
      } else if (err instanceof ApiError) {
        setFormError(err.message);
      } else {
        setFormError("Something went wrong starting the bot.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePasteSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pasteTranscript.trim()) {
      setPasteError("Paste a transcript first.");
      return;
    }

    setPasteSubmitting(true);
    setPasteError(null);
    try {
      // datetime-local gives a zone-less local string (e.g.
      // "2026-09-16T14:30") - `new Date(...)` parses that as local time,
      // and toISOString() converts it to the UTC instant the backend
      // expects, same as every other timestamp in this app.
      const isoDate = pasteDate ? new Date(pasteDate).toISOString() : null;
      const result = await createManualMeeting({
        title: pasteTitle.trim() || null,
        meetingDate: isoDate,
        transcriptText: pasteTranscript,
      });
      router.push(`/meetings/${result.meeting_id}`);
      onClose();
    } catch (err) {
      if (err instanceof NetworkError || err instanceof ApiError) {
        setPasteError(err.message);
      } else {
        setPasteError("Something went wrong creating this meeting.");
      }
      setPasteSubmitting(false);
    }
  }

  // Tabs only make sense before either flow has committed to something -
  // once a live capture has actually started (`capture !== null`), hide
  // them rather than let switching modes strand an in-progress bot.
  const showTabs = capture === null;

  return (
    <Modal
      title={mode === "live" ? "Capture meeting" : "Paste a transcript"}
      onClose={onClose}
    >
      {showTabs && (
        <div className="mb-4 flex gap-1 rounded-lg bg-muted p-1 text-sm">
          <button
            type="button"
            onClick={() => setMode("live")}
            className={`flex-1 rounded-md py-1.5 font-medium transition ${
              mode === "live"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Join a live meeting
          </button>
          <button
            type="button"
            onClick={() => setMode("paste")}
            className={`flex-1 rounded-md py-1.5 font-medium transition ${
              mode === "paste"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Paste a transcript
          </button>
        </div>
      )}

      {mode === "paste" && (
        <form onSubmit={handlePasteSubmit}>
          <label htmlFor="paste-title" className="text-sm font-medium text-foreground">
            Title (optional)
          </label>
          <input
            id="paste-title"
            type="text"
            value={pasteTitle}
            onChange={(e) => setPasteTitle(e.target.value)}
            placeholder="e.g. Weekly sync"
            disabled={pasteSubmitting}
            className="mt-1.5 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-indigo-300 focus:bg-card focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          />

          <label
            htmlFor="paste-date"
            className="mt-3 block text-sm font-medium text-foreground"
          >
            Meeting date (optional)
          </label>
          <input
            id="paste-date"
            type="datetime-local"
            value={pasteDate}
            onChange={(e) => setPasteDate(e.target.value)}
            disabled={pasteSubmitting}
            className="mt-1.5 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground focus:border-indigo-300 focus:bg-card focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          />

          <label
            htmlFor="paste-transcript"
            className="mt-3 block text-sm font-medium text-foreground"
          >
            Transcript
          </label>
          <textarea
            id="paste-transcript"
            value={pasteTranscript}
            onChange={(e) => setPasteTranscript(e.target.value)}
            rows={8}
            placeholder={"Jordan: Let's kick off with the roadmap review.\nAlex: Sounds good, first item is..."}
            disabled={pasteSubmitting}
            className="mt-1.5 w-full resize-y rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-indigo-300 focus:bg-card focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Lines formatted as &ldquo;Speaker: text&rdquo; are split per
            speaker automatically - otherwise it&apos;s saved as one block.
            No bot, recording, or audio is created for a meeting added this
            way.
          </p>

          {pasteError && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">{pasteError}</p>
          )}

          <button
            type="submit"
            disabled={pasteSubmitting}
            className="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pasteSubmitting ? "Creating meeting…" : "Create meeting"}
          </button>
          {pasteSubmitting && (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Saving the transcript and generating a summary - this can take
              a few seconds.
            </p>
          )}
        </form>
      )}

      {mode === "live" && capture === null && (
        <form onSubmit={handleSubmit}>
          <label
            htmlFor="meeting-url"
            className="text-sm font-medium text-foreground"
          >
            Google Meet link
          </label>
          <input
            id="meeting-url"
            type="text"
            autoFocus
            value={meetingUrl}
            onChange={(e) => setMeetingUrl(e.target.value)}
            placeholder="https://meet.google.com/abc-defg-hij"
            className="mt-1.5 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-indigo-300 focus:bg-card focus:outline-none"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            The bot will knock and wait in the meeting&apos;s lobby &mdash;
            admit it like any other guest once you see it join.
          </p>
          {formError && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">{formError}</p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Sending bot…" : "Send bot to meeting"}
          </button>
        </form>
      )}

      {mode === "live" && capture !== null && (
        <div className="text-center">
          {capture.status === "completed" ? (
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
          ) : capture.status === "failed" ? (
            <XCircle className="mx-auto h-10 w-10 text-red-500" />
          ) : (
            <div className="mx-auto h-10 w-10 animate-pulse rounded-full bg-indigo-100 dark:bg-indigo-500/20" />
          )}

          <p className="mt-3 text-sm font-medium text-foreground">
            {capture.status === "completed"
              ? capture.summarized
                ? "Meeting processed — transcript and summary are ready."
                : capture.summarizeError
                  ? "Transcript saved, but the summary couldn't be generated automatically."
                  : "Meeting finished — processing transcript and summary…"
              : capture.status === "failed"
                ? "The bot couldn't complete this meeting."
                : (STATUS_MESSAGES[capture.status] ?? `Status: ${capture.status}`)}
          </p>

          {capture.summarizeError && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">
              {capture.summarizeError} You can retry from the meeting page.
            </p>
          )}

          {capture.segmentsSaved > 0 && capture.status !== "completed" && (
            <p className="mt-1 text-xs text-muted-foreground">
              {capture.segmentsSaved} transcript segment
              {capture.segmentsSaved === 1 ? "" : "s"} captured so far
            </p>
          )}

          {pollError && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{pollError}</p>
          )}

          {!TERMINAL_STATUSES.has(capture.status) && (
            <p className="mt-3 text-xs text-muted-foreground">
              Safe to close &mdash; the meeting will finish processing
              automatically in the background, even if you close this or
              leave the page. It&apos;ll be waiting on the meeting page when
              it&apos;s done.
            </p>
          )}

          <div className="mt-5 flex justify-center gap-2">
            {TERMINAL_STATUSES.has(capture.status) ? (
              <Link
                href={`/meetings/${capture.meetingId}`}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                View meeting
              </Link>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
            >
              {TERMINAL_STATUSES.has(capture.status) ? "Close" : "Cancel"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
