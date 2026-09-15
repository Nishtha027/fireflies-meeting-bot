import { useEffect, useRef } from "react";
import type { TranscriptSegment } from "@/lib/types";
import type { TranscriptMatch } from "@/lib/transcriptSearch";
import { formatSegmentTime } from "@/lib/format";
import { speakerColor } from "@/lib/speakerColor";
import { HighlightedTranscriptText } from "./HighlightedTranscriptText";

export function TranscriptView({
  segments,
  meetingStartTime,
  activeSegmentIndex = null,
  onSegmentClick,
  matches = [],
  currentMatch = null,
}: {
  segments: TranscriptSegment[];
  meetingStartTime: string | null;
  /** The segment whose start time is at-or-before the audio player's
   * current playback position - highlighted and auto-scrolled to as audio
   * plays. Null when nothing is playing / synced. */
  activeSegmentIndex?: number | null;
  /** Click-to-seek: fired with a segment's index when a line is clicked. */
  onSegmentClick?: (index: number) => void;
  /** All "Find in transcript" matches across the whole transcript. */
  matches?: TranscriptMatch[];
  /** Whichever one of `matches` is currently selected in the find bar. */
  currentMatch?: TranscriptMatch | null;
}) {
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Follow playback: scroll the active segment into view only when it isn't
  // already visible - scrollIntoView's block:"nearest" scrolls the minimum
  // amount necessary and does nothing at all when the target is already
  // fully in the scrollable container's viewport.
  useEffect(() => {
    if (activeSegmentIndex === null) return;
    rowRefs.current[activeSegmentIndex]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [activeSegmentIndex]);

  // Follow "Find in transcript" navigation the same way.
  useEffect(() => {
    if (!currentMatch) return;
    rowRefs.current[currentMatch.segmentIndex]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [currentMatch]);

  if (segments.length === 0) {
    return (
      <p className="italic text-muted-foreground">
        No transcript segments were recorded for this meeting.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {segments.map((segment, i) => {
        const color = speakerColor(segment.speaker_label);
        const isActive = i === activeSegmentIndex;
        const segmentMatches = matches.filter((m) => m.segmentIndex === i);
        const currentMatchStart =
          currentMatch?.segmentIndex === i ? currentMatch.start : null;
        return (
          <div
            key={i}
            ref={(el) => {
              rowRefs.current[i] = el;
            }}
            onClick={onSegmentClick ? () => onSegmentClick(i) : undefined}
            className={`flex gap-3 rounded-lg -mx-2 px-2 py-1 transition-colors ${
              onSegmentClick ? "cursor-pointer hover:bg-muted" : ""
            } ${isActive ? "bg-indigo-50 dark:bg-indigo-950/30" : ""}`}
          >
            <span
              className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${color.dot}`}
              aria-hidden
            />
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className={`text-sm font-semibold ${color.text}`}>
                  {segment.speaker_label}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatSegmentTime(segment.start_timestamp, meetingStartTime)}
                </span>
              </div>
              <p className="mt-0.5 text-sm leading-relaxed text-foreground">
                <HighlightedTranscriptText
                  text={segment.text}
                  matches={segmentMatches}
                  currentMatchStart={currentMatchStart}
                />
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TranscriptSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-muted" />
          <div className="min-w-0 flex-1">
            <div className="h-3 w-24 rounded bg-muted" />
            <div className="mt-2 h-3 w-full rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}
