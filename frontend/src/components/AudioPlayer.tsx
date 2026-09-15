"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

// Same API_URL fallback as lib/api.ts - the <audio> element loads this URL
// directly (not through request()'s JSON-only fetch wrapper), so the
// backend proxy - not Vexa, and not our API key - is what the browser talks
// to. Cookies ride along automatically: this is a same-site (if
// cross-port) plain resource load, not a fetch() that needs an explicit
// credentials option.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export interface AudioPlayerHandle {
  /** Jump playback to `seconds` and resume - used by the transcript's
   * click-to-seek. Autoplay can still be blocked by the browser (no prior
   * user gesture on this element); the seek itself always lands regardless. */
  seekTo: (seconds: number) => void;
}

export const AudioPlayer = forwardRef<
  AudioPlayerHandle,
  {
    meetingId: number;
    /** meeting.end_time - meeting.start_time, in seconds - a recording
     * assembled from uploaded chunks (backend/meeting_audio.py) doesn't
     * always declare a Duration in its webm container, so browsers can
     * report audio.duration as Infinity/unknown indefinitely. The
     * meeting's own recorded start/end (already shown elsewhere as the
     * "X min" badge) is a reliable stand-in for the seek bar's range and
     * the total-time label; the real audio.duration is still preferred
     * whenever the browser does resolve it to a finite value. */
    knownDurationSeconds?: number;
    onTimeUpdate?: (seconds: number) => void;
  }
>(function AudioPlayer({ meetingId, knownDurationSeconds, onTimeUpdate }, ref) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(knownDurationSeconds ?? 0);
  const [unavailable, setUnavailable] = useState(false);

  useImperativeHandle(
    ref,
    () => ({
      seekTo(seconds: number) {
        const audio = audioRef.current;
        if (!audio || unavailable) return;
        audio.currentTime = seconds;
        setCurrentTime(seconds);
        audio.play().catch(() => {});
      },
    }),
    [unavailable],
  );

  // A meeting-to-meeting navigation reuses this component instance (same
  // page, new meetingId) - reset local playback state so the previous
  // meeting's position/duration/error don't flash before the new <audio>
  // element (key'd by src change below) finishes loading its own.
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(knownDurationSeconds ?? 0);
    setUnavailable(false);
  }, [meetingId, knownDurationSeconds]);

  function handleTimeUpdate() {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(audio.currentTime);
    onTimeUpdate?.(audio.currentTime);
  }

  function handleLoadedMetadata() {
    const audio = audioRef.current;
    if (audio && Number.isFinite(audio.duration)) setDuration(audio.duration);
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }

  if (unavailable) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted px-4 py-3 text-center text-sm text-muted-foreground">
        No audio available for this meeting.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <audio
        ref={audioRef}
        src={`${API_URL}/meetings/${meetingId}/audio`}
        preload="metadata"
        onError={() => setUnavailable(true)}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        className="hidden"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={isPlaying ? "Pause" : "Play"}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white hover:bg-indigo-700"
        >
          {isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4 translate-x-0.5" />
          )}
        </button>
        <span className="w-10 flex-shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {formatTime(currentTime)}
        </span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(currentTime, duration || 0)}
          onChange={(e) => {
            const audio = audioRef.current;
            if (!audio) return;
            const next = Number(e.target.value);
            audio.currentTime = next;
            setCurrentTime(next);
          }}
          aria-label="Seek"
          className="h-1.5 flex-1 cursor-pointer accent-indigo-600"
        />
        <span className="w-10 flex-shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatTime(duration)}
        </span>
      </div>
    </div>
  );
});
