"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud, XCircle } from "lucide-react";
import { ApiError, getMeeting, NetworkError, uploadMeeting } from "@/lib/api";
import { TERMINAL_CAPTURE_STATUSES as TERMINAL_STATUSES } from "@/lib/captureStatus";
import { Modal } from "./Modal";

const POLL_INTERVAL_MS = 3000;
const MAX_CONSECUTIVE_POLL_ERRORS = 5;

// Mirrors backend/upload_meeting.py's ALLOWED_EXTENSIONS - kept in sync
// manually, same as this app's other frontend/backend schema mirrors.
const ALLOWED_EXTENSIONS = [
  ".mp3", ".wav", ".m4a", ".ogg",
  ".mp4", ".mov", ".webm",
  ".txt", ".md",
];

function hasAllowedExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

interface UploadState {
  meetingId: number;
  status: string;
  processingError: string | null;
}

export function UploadMeetingModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);

  const consecutiveErrorsRef = useRef(0);

  // Once the transcription service reports "completed", this navigates
  // straight to the meeting page rather than showing a "View meeting"
  // button to click - per the feature's Part C spec, on completion this
  // should behave "like any other meeting". If this modal gets closed
  // before that happens, the upload keeps transcribing regardless (a
  // FastAPI BackgroundTask on the server, not tied to this component being
  // mounted) - the meeting just shows "Processing" until then, found again
  // later via Home/Meetings, same as leaving a live capture unattended.
  useEffect(() => {
    if (upload === null || TERMINAL_STATUSES.has(upload.status)) return;

    let cancelled = false;
    const interval = setInterval(() => {
      getMeeting(upload.meetingId)
        .then((data) => {
          if (cancelled) return;
          if (data.status === "completed") {
            cancelled = true;
            router.push(`/meetings/${data.id}`);
            onClose();
            return;
          }
          consecutiveErrorsRef.current = 0;
          setPollError(null);
          setUpload({
            meetingId: data.id,
            status: data.status,
            processingError: data.processing_error,
          });
        })
        .catch((err) => {
          if (cancelled) return;
          consecutiveErrorsRef.current += 1;
          if (consecutiveErrorsRef.current >= MAX_CONSECUTIVE_POLL_ERRORS) {
            setPollError(
              err instanceof NetworkError || err instanceof ApiError
                ? err.message
                : "Lost track of this upload's status.",
            );
          }
        });
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [upload, router, onClose]);

  async function handleFile(file: File) {
    if (!hasAllowedExtension(file.name)) {
      setFormError(`Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}.`);
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      const result = await uploadMeeting(file);
      // .txt/.md files are processed synchronously (routed into the same
      // manual-meeting path "Paste a transcript" uses) and come back
      // already "completed" - navigate straight there like paste-transcript
      // already does, rather than entering the polling UI meant for
      // audio/video's real, non-instant transcription.
      if (result.status === "completed") {
        router.push(`/meetings/${result.meeting_id}`);
        onClose();
        return;
      }
      setUpload({ meetingId: result.meeting_id, status: result.status, processingError: null });
    } catch (err) {
      if (err instanceof NetworkError || err instanceof ApiError) {
        setFormError(err.message);
      } else {
        setFormError("Something went wrong uploading this file.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function retry() {
    setUpload(null);
    setFormError(null);
    setPollError(null);
  }

  return (
    <Modal title="Upload File" onClose={onClose}>
      {upload === null && (
        <div>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => !submitting && fileInputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center transition ${
              dragActive
                ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-500/10"
                : "border-border bg-muted"
            } ${submitting ? "pointer-events-none opacity-60" : ""}`}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-border text-muted-foreground">
              <UploadCloud className="h-5 w-5" />
            </div>
            <p className="text-sm font-semibold text-foreground">
              {submitting ? "Uploading…" : "Drag & drop a recording, or click to browse"}
            </p>
            <p className="text-xs text-muted-foreground">
              Audio: mp3, wav, m4a, ogg &middot; Video: mp4, mov, webm &middot; Text: txt, md
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ALLOWED_EXTENSIONS.join(",")}
            className="hidden"
            disabled={submitting}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
          />
          <p className="mt-3 text-xs text-muted-foreground">
            Audio/video: transcribed automatically with a single
            &ldquo;Speaker&rdquo; label (no diarization yet). Text files:
            lines formatted as &ldquo;Speaker: text&rdquo; are split per
            speaker automatically &mdash; otherwise saved as one block.
          </p>
          {formError && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">{formError}</p>
          )}
        </div>
      )}

      {upload !== null && (
        <div className="text-center">
          {upload.status === "failed" ? (
            <XCircle className="mx-auto h-10 w-10 text-red-500" />
          ) : (
            <div className="mx-auto h-10 w-10 animate-pulse rounded-full bg-indigo-100 dark:bg-indigo-500/20" />
          )}

          <p className="mt-3 text-sm font-medium text-foreground">
            {upload.status === "failed"
              ? "Transcription failed."
              : "Transcribing your recording…"}
          </p>

          {upload.status === "failed" && upload.processingError && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">
              {upload.processingError}
            </p>
          )}

          {pollError && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{pollError}</p>
          )}

          {!TERMINAL_STATUSES.has(upload.status) && (
            <p className="mt-3 text-xs text-muted-foreground">
              Safe to close &mdash; this keeps transcribing in the background
              even if you close this or leave the page.
            </p>
          )}

          <div className="mt-5 flex justify-center gap-2">
            {upload.status === "failed" && (
              <button
                type="button"
                onClick={retry}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                Try again
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
            >
              {upload.status === "failed" ? "Close" : "Cancel"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
