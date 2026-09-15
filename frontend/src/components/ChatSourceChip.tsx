import Link from "next/link";
import type { ChatSource } from "@/lib/types";
import { formatDateTime, meetingTitle } from "@/lib/format";

const CHUNK_TYPE_LABELS: Record<string, string> = {
  summary: "Summary",
  transcript: "Transcript",
};

export function ChatSourceChip({ source }: { source: ChatSource }) {
  return (
    <Link
      href={`/meetings/${source.meeting_id}`}
      className="block w-56 flex-shrink-0 rounded-lg border border-border bg-card p-3 transition hover:border-indigo-300 hover:shadow-sm dark:hover:border-indigo-500/60"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-semibold text-foreground">
          {meetingTitle(source.meeting_title, source.platform, source.native_meeting_id)}
        </p>
        <span className="flex-shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {CHUNK_TYPE_LABELS[source.chunk_type] ?? source.chunk_type}
        </span>
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {formatDateTime(source.start_time)}
      </p>
      <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
        {source.snippet}
      </p>
    </Link>
  );
}
