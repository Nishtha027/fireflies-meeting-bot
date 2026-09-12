const PLATFORM_LABELS: Record<string, string> = {
  google_meet: "Google Meet",
  zoom: "Zoom",
  teams: "Microsoft Teams",
};

export function formatPlatform(platform: string): string {
  return (
    PLATFORM_LABELS[platform] ??
    platform
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  );
}

/** We don't have a real title field yet - build a readable label from what we do have. */
export function meetingTitle(platform: string, nativeMeetingId: string): string {
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
  const totalMinutes = Math.round((endMs - startMs) / 60000);
  if (totalMinutes < 1) return "< 1 min";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  return `${hours}h ${minutes}m`;
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
