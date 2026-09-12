import Link from "next/link";
import type { MeetingListItem } from "@/lib/types";
import { formatDateTime, formatDuration, meetingTitle } from "@/lib/format";
import { StatusBadge } from "./StatusBadge";

export function MeetingCard({ meeting }: { meeting: MeetingListItem }) {
  const duration = formatDuration(meeting.start_time, meeting.end_time);

  return (
    <Link
      href={`/meetings/${meeting.id}`}
      className="block rounded-xl border border-slate-200 bg-white p-5 transition hover:border-indigo-300 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-slate-900">
          {meetingTitle(meeting.platform, meeting.native_meeting_id)}
        </h3>
        <StatusBadge status={meeting.status} />
      </div>

      <div className="mt-1.5 flex items-center gap-2 text-sm text-slate-500">
        <span>{formatDateTime(meeting.start_time)}</span>
        {duration && (
          <>
            <span aria-hidden>&middot;</span>
            <span>{duration}</span>
          </>
        )}
      </div>

      <p className="mt-3 line-clamp-2 text-sm text-slate-600">
        {meeting.overview_preview ? (
          `${meeting.overview_preview}${meeting.overview_preview.length >= 100 ? "…" : ""}`
        ) : (
          <span className="italic text-slate-400">Not summarized yet</span>
        )}
      </p>
    </Link>
  );
}

export function MeetingCardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="h-4 w-40 rounded bg-slate-200" />
        <div className="h-4 w-16 rounded-full bg-slate-200" />
      </div>
      <div className="mt-2 h-3 w-32 rounded bg-slate-100" />
      <div className="mt-4 h-3 w-full rounded bg-slate-100" />
      <div className="mt-2 h-3 w-2/3 rounded bg-slate-100" />
    </div>
  );
}
