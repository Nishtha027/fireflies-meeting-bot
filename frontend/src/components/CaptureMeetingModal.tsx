"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { ApiError, captureMeeting, getCaptureStatus, NetworkError } from "@/lib/api";
import { Modal } from "./Modal";

const POLL_INTERVAL_MS = 4000;
const MAX_CONSECUTIVE_POLL_ERRORS = 5;
const TERMINAL_STATUSES = new Set(["completed", "failed"]);

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
  const [meetingUrl, setMeetingUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [capture, setCapture] = useState<CaptureState | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);

  const consecutiveErrorsRef = useRef(0);

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

  return (
    <Modal title="Capture meeting" onClose={onClose}>
      {capture === null && (
        <form onSubmit={handleSubmit}>
          <label
            htmlFor="meeting-url"
            className="text-sm font-medium text-slate-700"
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
            className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:outline-none"
          />
          <p className="mt-2 text-xs text-slate-500">
            The bot will knock and wait in the meeting&apos;s lobby &mdash;
            admit it like any other guest once you see it join.
          </p>
          {formError && (
            <p className="mt-2 text-sm text-red-600">{formError}</p>
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

      {capture !== null && (
        <div className="text-center">
          {capture.status === "completed" ? (
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
          ) : capture.status === "failed" ? (
            <XCircle className="mx-auto h-10 w-10 text-red-500" />
          ) : (
            <div className="mx-auto h-10 w-10 animate-pulse rounded-full bg-indigo-100" />
          )}

          <p className="mt-3 text-sm font-medium text-slate-900">
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
            <p className="mt-2 text-xs text-red-600">
              {capture.summarizeError} You can retry from the meeting page.
            </p>
          )}

          {capture.segmentsSaved > 0 && capture.status !== "completed" && (
            <p className="mt-1 text-xs text-slate-400">
              {capture.segmentsSaved} transcript segment
              {capture.segmentsSaved === 1 ? "" : "s"} captured so far
            </p>
          )}

          {pollError && (
            <p className="mt-2 text-xs text-red-600">{pollError}</p>
          )}

          {!TERMINAL_STATUSES.has(capture.status) && (
            <p className="mt-3 text-xs text-slate-400">
              Closing this won&apos;t stop the bot &mdash; come back to check on it later.
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
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              {TERMINAL_STATUSES.has(capture.status) ? "Close" : "Cancel"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
