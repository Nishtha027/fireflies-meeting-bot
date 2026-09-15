import type { ReactNode } from "react";

/** Renders `text` with each of `matches` (offsets already scoped to this one
 * segment) wrapped in <mark> - same amber highlight style as the global
 * Search page's HighlightedSnippet (see ./HighlightedSnippet.tsx), plus a
 * stronger, distinct highlight for whichever one is `currentMatchStart` (the
 * "Find in transcript" bar's currently-selected match). Plain text nodes
 * only, no dangerouslySetInnerHTML. */
export function HighlightedTranscriptText({
  text,
  matches,
  currentMatchStart,
}: {
  text: string;
  matches: { start: number; length: number }[];
  currentMatchStart: number | null;
}) {
  if (matches.length === 0) return <>{text}</>;

  const pieces: ReactNode[] = [];
  let cursor = 0;
  matches.forEach((m, i) => {
    if (m.start > cursor) pieces.push(text.slice(cursor, m.start));
    const isCurrent = m.start === currentMatchStart;
    pieces.push(
      <mark
        key={i}
        className={
          isCurrent
            ? "rounded bg-orange-400 px-0.5 text-slate-900 dark:bg-orange-500 dark:text-slate-900"
            : "rounded bg-amber-200 px-0.5 text-inherit dark:bg-amber-400/40 dark:text-amber-100"
        }
      >
        {text.slice(m.start, m.start + m.length)}
      </mark>,
    );
    cursor = m.start + m.length;
  });
  if (cursor < text.length) pieces.push(text.slice(cursor));

  return <>{pieces}</>;
}
