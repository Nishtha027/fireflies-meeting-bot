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
      className="block w-56 flex-shrink-0 rounded-lg border border-slate-200 bg-white p-3 transition hover:border-indigo-300 hover:shadow-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-semibold text-slate-800">
          {meetingTitle(source.platform, source.native_meeting_id)}
        </p>
        <span className="flex-shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
          {CHUNK_TYPE_LABELS[source.chunk_type] ?? source.chunk_type}
        </span>
      </div>
      <p className="mt-0.5 text-[11px] text-slate-400">
        {formatDateTime(source.start_time)}
      </p>
      <p className="mt-1.5 line-clamp-2 text-xs text-slate-600">
        {source.snippet}
      </p>
    </Link>
  );
}
