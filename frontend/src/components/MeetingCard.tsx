import Link from "next/link";
import type { MeetingListItem } from "@/lib/types";
import { formatDateTime, formatDuration, meetingTitle } from "@/lib/format";
import { StatusBadge } from "./StatusBadge";

const MAX_AVATARS = 4;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Small avatar-initials stack plus a name list - uses only the app's
 * neutral bg-muted/text-foreground tokens (not a per-speaker color), since
 * those are the ones already verified for contrast in both themes. */
function ParticipantList({ participants }: { participants: string[] }) {
  if (participants.length === 0) return null;
  const shown = participants.slice(0, MAX_AVATARS);
  const overflow = participants.length - shown.length;

  return (
    <div className="mt-3 flex items-center gap-2">
      <div className="flex -space-x-2">
        {shown.map((name) => (
          <span
            key={name}
            title={name}
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 border-card bg-muted text-[10px] font-semibold text-foreground"
          >
            {initials(name)}
          </span>
        ))}
        {overflow > 0 && (
          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 border-card bg-muted text-[10px] font-semibold text-muted-foreground">
            +{overflow}
          </span>
        )}
      </div>
      <span className="truncate text-xs text-muted-foreground">
        {participants.join(", ")}
      </span>
    </div>
  );
}

export function MeetingCard({ meeting }: { meeting: MeetingListItem }) {
  // Manually created meetings (pasted transcript) only have synthetic,
  // order-preserving line timestamps - showing a computed "X min" here
  // would present fabricated data as if it were a real duration.
  const duration =
    meeting.platform === "manual"
      ? "Manually added"
      : formatDuration(meeting.start_time, meeting.end_time);

  return (
    <Link
      href={`/meetings/${meeting.id}`}
      className="block rounded-xl border border-border bg-card p-5 transition hover:border-indigo-300 hover:shadow-md dark:hover:border-indigo-500/60"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-foreground">
          {meetingTitle(meeting.title, meeting.platform, meeting.native_meeting_id)}
        </h3>
        <StatusBadge status={meeting.status} />
      </div>

      <div className="mt-1.5 flex items-center gap-2 text-sm text-muted-foreground">
        <span>{formatDateTime(meeting.start_time)}</span>
        {duration && (
          <>
            <span aria-hidden>&middot;</span>
            <span>{duration}</span>
          </>
        )}
      </div>

      <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
        {meeting.overview_preview ? (
          `${meeting.overview_preview}${meeting.overview_preview.length >= 100 ? "…" : ""}`
        ) : (
          <span className="italic text-muted-foreground">Not summarized yet</span>
        )}
      </p>

      <ParticipantList participants={meeting.participants} />
    </Link>
  );
}

export function MeetingCardSkeleton() {
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
