import Link from "next/link";
import type { SearchResult } from "@/lib/types";
import { formatDateTime, meetingTitle } from "@/lib/format";
import { HighlightedSnippet } from "./HighlightedSnippet";

const FIELD_LABELS: Record<string, string> = {
  summary: "Summary",
  key_point: "Key point",
  decision: "Decision",
  transcript: "Transcript",
};

export function SearchResultCard({ result }: { result: SearchResult }) {
  return (
    <Link
      href={`/meetings/${result.meeting_id}`}
      className="block rounded-xl border border-border bg-card p-5 transition hover:border-indigo-300 hover:shadow-md dark:hover:border-indigo-500/60"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-foreground">
          {meetingTitle(result.platform, result.native_meeting_id)}
        </h3>
        <span className="flex-shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          {result.matched_field
            ? (FIELD_LABELS[result.matched_field] ?? result.matched_field)
            : "Match"}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {formatDateTime(result.start_time)}
      </p>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        <HighlightedSnippet text={result.snippet ?? ""} />
      </p>
    </Link>
  );
}

export function SearchResultCardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="h-4 w-40 rounded bg-muted" />
        <div className="h-4 w-16 rounded-full bg-muted" />
      </div>
      <div className="mt-2 h-3 w-32 rounded bg-muted" />
      <div className="mt-4 h-3 w-full rounded bg-muted" />
      <div className="mt-2 h-3 w-2/3 rounded bg-muted" />
    </div>
  );
}
