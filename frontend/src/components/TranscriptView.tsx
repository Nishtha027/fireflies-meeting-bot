import type { TranscriptSegment } from "@/lib/types";
import { formatSegmentTime } from "@/lib/format";
import { speakerColor } from "@/lib/speakerColor";

export function TranscriptView({
  segments,
  meetingStartTime,
}: {
  segments: TranscriptSegment[];
  meetingStartTime: string | null;
}) {
  if (segments.length === 0) {
    return (
      <p className="italic text-slate-400">
        No transcript segments were recorded for this meeting.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {segments.map((segment, i) => {
        const color = speakerColor(segment.speaker_label);
        return (
          <div key={i} className="flex gap-3">
            <span
              className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${color.dot}`}
              aria-hidden
            />
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className={`text-sm font-semibold ${color.text}`}>
                  {segment.speaker_label}
                </span>
                <span className="text-xs text-slate-400">
                  {formatSegmentTime(segment.start_timestamp, meetingStartTime)}
                </span>
              </div>
              <p className="mt-0.5 text-sm leading-relaxed text-slate-700">
                {segment.text}
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
          <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-slate-200" />
          <div className="min-w-0 flex-1">
            <div className="h-3 w-24 rounded bg-slate-200" />
            <div className="mt-2 h-3 w-full rounded bg-slate-100" />
          </div>
        </div>
      ))}
    </div>
  );
}
