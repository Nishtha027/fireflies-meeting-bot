import type { MeetingListItem } from "./types";

const PLATFORM_LABELS: Record<string, string> = {
  google_meet: "Google Meet",
  zoom: "Zoom",
  teams: "Microsoft Teams",
};

/** Vexa's bot-lifecycle statuses are snake_case (e.g. "awaiting_admission");
 * CSS `capitalize` doesn't insert word breaks at underscores, so this turns
 * that into a readable label ("Awaiting admission") for StatusBadge. */
export function formatStatusLabel(status: string): string {
  const words = status.split("_").filter(Boolean);
  if (words.length === 0) return status;
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatPlatform(platform: string): string {
  return (
    PLATFORM_LABELS[platform] ??
    platform
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  );
}

/** The user's own title if they set one, otherwise a readable fallback
 * built from platform + code - the single place this fallback logic lives,
 * so every meeting-name display (cards, detail page, search, chat
 * citations, task links) stays consistent. */
export function meetingTitle(
  title: string | null | undefined,
  platform: string,
  nativeMeetingId: string,
): string {
  if (title && title.trim()) return title;
  return `${formatPlatform(platform)} · ${nativeMeetingId}`;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "Unknown date";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatMinutesLabel(totalMinutes: number): string {
  if (totalMinutes < 1) return "< 1 min";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  return `${hours}h ${minutes}m`;
}

export function formatDuration(
  start: string | null,
  end: string | null,
): string | null {
  if (!start || !end) return null;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    return null;
  }
  return formatMinutesLabel(Math.round((endMs - startMs) / 60000));
}

/** Same "Xh Ym" formatting as formatDuration(), but from a raw seconds
 * total (e.g. analytics.total_duration_seconds) rather than two ISO dates. */
export function formatDurationSeconds(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0 min";
  return formatMinutesLabel(Math.round(totalSeconds / 60));
}

export function sortMeetingsNewestFirst(
  meetings: MeetingListItem[],
): MeetingListItem[] {
  return [...meetings].sort((a, b) => {
    const aTime = a.start_time ? new Date(a.start_time).getTime() : -Infinity;
    const bTime = b.start_time ? new Date(b.start_time).getTime() : -Infinity;
    return bTime - aTime;
  });
}

/** "This week" = the current ISO week, Monday 00:00 local time through now. */
export function isThisWeek(iso: string | null): boolean {
  if (!iso) return false;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;

  const now = new Date();
  const dayOfWeek = (now.getDay() + 6) % 7; // 0 = Monday
  const startOfWeek = new Date(now);
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(now.getDate() - dayOfWeek);

  return date >= startOfWeek && date <= now;
}

function formatMinutesSeconds(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Segment start/end timestamps from Vexa are absolute Unix epoch seconds, not
 * offsets from meeting start - so we anchor against the meeting's own
 * start_time to get a sensible elapsed "mm:ss" marker (plain text, no
 * playback). Falls back to a wall-clock time if there's no meeting
 * start_time to anchor against, or the segment predates it.
 */
export function formatSegmentTime(
  segmentEpochSeconds: number,
  meetingStartIso: string | null,
): string {
  if (meetingStartIso) {
    const meetingStartEpoch = new Date(meetingStartIso).getTime() / 1000;
    const elapsed = segmentEpochSeconds - meetingStartEpoch;
    if (Number.isFinite(elapsed) && elapsed >= 0) {
      return formatMinutesSeconds(elapsed);
    }
  }
  const date = new Date(segmentEpochSeconds * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { timeStyle: "medium" }).format(
    date,
  );
}
