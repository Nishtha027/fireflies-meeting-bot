"""
Fetch a completed meeting's transcript from Vexa's API and store it in our
own app database (see app/models.py).

Usage:
    python ingest_transcript.py --native-meeting-id msv-yqyx-rzd [--platform google_meet]

Re-running against the same meeting updates it in place (upsert on
platform+native_meeting_id for the meeting, meeting_id+segment_id for each
segment) rather than creating duplicates.

The ingest() function is also called directly by main.py's
POST /meetings/{id}/ingest endpoint - it raises IngestError subclasses
instead of printing+sys.exit() so callers (CLI or API) can each handle
errors their own way (stderr+exit code vs. an HTTP response).
"""

import argparse
import os
import sys
from dataclasses import dataclass
from datetime import datetime

import httpx
from dotenv import load_dotenv

from app.database import SessionLocal
from app.models import Meeting, TranscriptSegment

load_dotenv()


class IngestError(Exception):
    """Base class for errors ingest() raises - callers decide how to present them."""


class VexaNotFoundError(IngestError):
    """Vexa has no record of this platform/native_meeting_id (404)."""


class VexaAPIError(IngestError):
    """Vexa's API was unreachable or returned an unexpected error."""


@dataclass
class IngestResult:
    meeting_id: int
    status: str
    platform: str
    native_meeting_id: str
    vexa_meeting_id: int | None
    segments_saved: int
    warning: str | None = None


def fetch_transcript(platform: str, native_meeting_id: str) -> dict:
    api_base = os.environ["VEXA_API_BASE"]
    api_key = os.environ["VEXA_API_KEY"]
    url = f"{api_base}/transcripts/{platform}/{native_meeting_id}"

    try:
        response = httpx.get(url, headers={"X-API-Key": api_key}, timeout=15.0)
    except httpx.RequestError as exc:
        raise VexaAPIError(f"could not reach Vexa's API at {url}: {exc}") from exc

    if response.status_code == 404:
        raise VexaNotFoundError(
            f"Vexa has no meeting {platform}/{native_meeting_id} "
            f"(404 - never joined, or a typo in the id)."
        )
    if response.status_code != 200:
        raise VexaAPIError(
            f"Vexa's API returned {response.status_code} for "
            f"{platform}/{native_meeting_id}: {response.text}"
        )

    return response.json()


def _parse_ts(value: str | None):
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def ingest(platform: str, native_meeting_id: str, meeting_id: int | None = None) -> IngestResult:
    """Fetch + upsert a meeting's transcript. Raises IngestError subclasses on
    failure - never calls sys.exit(), so it's safe to call from a web request.

    Pass meeting_id when the caller already has a specific row in hand (as
    main.py and capture_meeting.py always do, after their own ownership
    check) - under multi-user, more than one Meeting row can share the same
    (platform, native_meeting_id), one per owner, so looking it up by that
    pair alone would be ambiguous. meeting_id is omitted only by this
    module's own CLI, a trusted local operator tool with no per-user
    request to scope to; it falls back to the first row matching the
    natural key."""
    print(f"Fetching transcript for {platform}/{native_meeting_id} from Vexa...")
    data = fetch_transcript(platform, native_meeting_id)

    segments = data.get("segments", [])
    warning = None
    if not segments:
        warning = f"Vexa returned 0 segments for this meeting (status={data.get('status')!r})."

    session = SessionLocal()
    try:
        if meeting_id is not None:
            meeting = session.get(Meeting, meeting_id)
        else:
            meeting = (
                session.query(Meeting)
                .filter_by(platform=platform, native_meeting_id=native_meeting_id)
                .order_by(Meeting.id)
                .first()
            )
        if meeting is None:
            meeting = Meeting(platform=platform, native_meeting_id=native_meeting_id)
            session.add(meeting)

        meeting.source_link = data.get("constructed_meeting_url")
        meeting.vexa_meeting_id = data.get("id")
        meeting.status = data.get("status", "unknown")
        meeting.start_time = _parse_ts(data.get("start_time"))
        meeting.end_time = _parse_ts(data.get("end_time"))
        session.flush()  # assigns meeting.id if this is a new row

        saved_count = 0
        for seg in segments:
            existing = (
                session.query(TranscriptSegment)
                .filter_by(meeting_id=meeting.id, segment_id=seg["segment_id"])
                .one_or_none()
            )
            speaker = seg.get("speaker") or "Unknown Speaker"

            if existing is None:
                existing = TranscriptSegment(meeting_id=meeting.id, segment_id=seg["segment_id"])
                session.add(existing)

            existing.speaker_label = speaker
            existing.text = seg["text"]
            existing.start_timestamp = seg["start"]
            existing.end_timestamp = seg["end"]
            existing.language = seg.get("language")
            saved_count += 1

        session.commit()
        # Capture what we need to return while the session is still live -
        # accessing ORM attributes after close() raises DetachedInstanceError.
        result = IngestResult(
            meeting_id=meeting.id,
            status=meeting.status,
            platform=platform,
            native_meeting_id=native_meeting_id,
            vexa_meeting_id=meeting.vexa_meeting_id,
            segments_saved=saved_count,
            warning=warning,
        )
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--native-meeting-id", required=True, help="Vexa's per-platform meeting code, e.g. msv-yqyx-rzd")
    parser.add_argument("--platform", default="google_meet", help="Meeting platform (default: google_meet)")
    args = parser.parse_args()

    try:
        result = ingest(args.platform, args.native_meeting_id)
    except IngestError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

    if result.warning:
        print(f"WARNING: {result.warning}")
    print(f"Meeting saved: id={result.meeting_id} status={result.status!r} "
          f"({result.platform}/{result.native_meeting_id}, Vexa meeting_id={result.vexa_meeting_id})")
    print(f"Segments saved: {result.segments_saved}")


if __name__ == "__main__":
    main()
