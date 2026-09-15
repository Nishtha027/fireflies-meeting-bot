import type { Chapter } from "@/lib/types";
import { formatMinutesSeconds } from "@/lib/format";

/** Chapters list for the meeting detail sidebar - clicking one seeks the
 * audio player (via the page's onChapterClick, which reuses the exact same
 * AudioPlayerHandle.seekTo() the transcript's click-to-seek already uses),
 * and the chapter whose start_time_seconds is at-or-before the current
 * playback position is highlighted the same way the active transcript
 * segment is (see TranscriptView.tsx). */
export function ChaptersList({
  chapters,
  activeIndex = null,
  onChapterClick,
}: {
  chapters: Chapter[];
  activeIndex?: number | null;
  onChapterClick?: (index: number) => void;
}) {
  if (chapters.length === 0) {
    return (
      <p className="text-sm italic text-muted-foreground">
        No chapters yet &mdash; regenerate summary to add them.
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {chapters.map((chapter, i) => {
        const isActive = i === activeIndex;
        return (
          <li key={i}>
            <button
              type="button"
              onClick={onChapterClick ? () => onChapterClick(i) : undefined}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                isActive
                  ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300"
                  : "text-foreground hover:bg-muted"
              }`}
            >
              <span className="w-10 flex-shrink-0 text-xs tabular-nums text-muted-foreground">
                {formatMinutesSeconds(chapter.start_time_seconds)}
              </span>
              <span className="truncate">{chapter.title}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
