import type { TranscriptSegment } from "./types";

/** One case-insensitive occurrence of the search query inside one segment's
 * text - `start`/`length` are character offsets into that segment's raw
 * text, not the whole transcript. */
export interface TranscriptMatch {
  segmentIndex: number;
  start: number;
  length: number;
}

/** Every occurrence of `query` across every segment's text, in document
 * order (segment order, then left-to-right within a segment) - this is the
 * order "next"/"previous" navigate through. Client-side only, independent
 * of the global cross-meeting Search feature (backend/main.py's /search). */
export function findTranscriptMatches(
  segments: TranscriptSegment[],
  query: string,
): TranscriptMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const matches: TranscriptMatch[] = [];
  segments.forEach((segment, segmentIndex) => {
    const haystack = segment.text.toLowerCase();
    let from = 0;
    while (from <= haystack.length) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) break;
      matches.push({ segmentIndex, start: at, length: needle.length });
      from = at + needle.length;
    }
  });
  return matches;
}
