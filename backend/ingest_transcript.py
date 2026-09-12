"""
Fetch a completed meeting's transcript from Vexa's API and store it in our
own app database (see app/models.py).

Usage:
    python ingest_transcript.py --native-meeting-id msv-yqyx-rzd [--platform google_meet]

Re-running against the same meeting updates it in place (upsert on
platform+native_meeting_id for the meeting, meeting_id+segment_id for each
segment) rather than creating duplicates.
"""

import argparse
import os
import sys
from datetime import datetime, timezone

import httpx
from dotenv import load_dotenv

from app.database import SessionLocal
from app.models import Meeting, TranscriptSegment

load_dotenv()


def fetch_transcript(platform: str, native_meeting_id: str) -> dict:
    api_base = os.environ["VEXA_API_BASE"]
    api_key = os.environ["VEXA_API_KEY"]
    url = f"{api_base}/transcripts/{platform}/{native_meeting_id}"

    try:
        response = httpx.get(url, headers={"X-API-Key": api_key}, timeout=15.0)
    except httpx.RequestError as exc:
        print(f"ERROR: could not reach Vexa's API at {url}: {exc}", file=sys.stderr)
        sys.exit(1)

    if response.status_code == 404:
        print(
            f"ERROR: Vexa has no meeting {platform}/{native_meeting_id} "
            f"(404 - never joined, or a typo in the id).",
            file=sys.stderr,
        )
        sys.exit(1)
    if response.status_code != 200:
        print(
            f"ERROR: Vexa's API returned {response.status_code} for "
            f"{platform}/{native_meeting_id}: {response.text}",
            file=sys.stderr,
        )
        sys.exit(1)

    return response.json()


def _parse_ts(value: str | None):
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def ingest(platform: str, native_meeting_id: str) -> None:
    print(f"Fetching transcript for {platform}/{native_meeting_id} from Vexa...")
    data = fetch_transcript(platform, native_meeting_id)

    segments = data.get("segments", [])
    if not segments:
        print(
            f"WARNING: Vexa returned 0 segments for this meeting "
            f"(status={data.get('status')!r}). Nothing to save."
        )

    session = SessionLocal()
    try:
        meeting = (
            session.query(Meeting)
            .filter_by(platform=platform, native_meeting_id=native_meeting_id)
            .one_or_none()
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
        # Capture what we need to print while the session is still live -
        # accessing ORM attributes after close() raises DetachedInstanceError.
        meeting_id, meeting_status, vexa_meeting_id = (
            meeting.id,
            meeting.status,
            meeting.vexa_meeting_id,
        )
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

    print(f"Meeting saved: id={meeting_id} status={meeting_status!r} "
          f"({platform}/{native_meeting_id}, Vexa meeting_id={vexa_meeting_id})")
    print(f"Segments saved: {saved_count}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--native-meeting-id", required=True, help="Vexa's per-platform meeting code, e.g. msv-yqyx-rzd")
    parser.add_argument("--platform", default="google_meet", help="Meeting platform (default: google_meet)")
    args = parser.parse_args()

    ingest(args.platform, args.native_meeting_id)


if __name__ == "__main__":
    main()
