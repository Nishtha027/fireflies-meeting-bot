"""
Send a Vexa bot into a live Google Meet call ("Capture Meeting") and poll its
status until the meeting completes, at which point our existing
ingest_transcript.py / summarize_meeting.py functions are called to fetch the
transcript and generate a summary - this module does not duplicate that
logic, it only adds the "start a bot" step in front of it.

start_capture() calls POST /bots and creates/updates our own Meeting row.
get_capture_status() is meant to be polled repeatedly by the frontend (a few
seconds apart): it re-fetches the meeting's live status from Vexa (reusing
ingest_transcript.ingest(), which is already idempotent), and once Vexa
reports the meeting "completed", triggers summarize_meeting.summarize() the
first time that happens.

Both raise CaptureError subclasses instead of calling sys.exit(), same
convention as ingest_transcript.py and summarize_meeting.py, so main.py can
map them to HTTP responses.
"""

import os
from dataclasses import dataclass

import httpx
from dotenv import load_dotenv

from app.database import SessionLocal
from app.models import Meeting, Summary
from ingest_transcript import (
    IngestError,
    VexaAPIError,
    VexaNotFoundError,
    ingest,
)
from summarize_meeting import (
    GroqAPIError,
    GroqAuthError,
    GroqConfigError,
    GroqRateLimitError,
    NoTranscriptError,
    SummarizeError,
    TranscriptTooLongError,
    summarize,
)

load_dotenv()


class CaptureError(Exception):
    """Base class for errors this module raises - callers decide how to present them."""


class CaptureConfigError(CaptureError):
    """Vexa is misconfigured on our end (missing VEXA_API_BASE/VEXA_API_KEY)."""


class InvalidMeetingUrlError(CaptureError):
    """Vexa rejected the meeting_url as unparseable (422)."""


class CaptureConflictError(CaptureError):
    """A bot is already active on this meeting link (409)."""


class CaptureRateLimitError(CaptureError):
    """Past the account's concurrent-bot limit (429, or 403 on some deployments)."""


class CaptureAPIError(CaptureError):
    """Vexa's API was unreachable or returned an unexpected error."""


class CaptureMeetingNotFoundError(CaptureError):
    """No meeting with this id in our own database."""


@dataclass
class CaptureResult:
    meeting_id: int
    status: str
    platform: str
    native_meeting_id: str


@dataclass
class CaptureStatusResult:
    meeting_id: int
    status: str
    segments_saved: int
    summarized: bool
    summarize_error: str | None


def start_capture(meeting_url: str, bot_name: str = "Meetscribe") -> CaptureResult:
    """Send a bot to meeting_url via Vexa's POST /bots. Vexa parses the URL
    itself (platform + native_meeting_id), so we don't duplicate that
    parsing here - we just relay whatever it resolves the link to."""
    try:
        api_base = os.environ["VEXA_API_BASE"]
        api_key = os.environ["VEXA_API_KEY"]
    except KeyError as exc:
        raise CaptureConfigError(
            f"{exc.args[0]} is not set - check backend/.env."
        ) from exc

    try:
        response = httpx.post(
            f"{api_base}/bots",
            json={"meeting_url": meeting_url, "bot_name": bot_name},
            headers={"X-API-Key": api_key},
            timeout=15.0,
        )
    except httpx.RequestError as exc:
        raise CaptureAPIError(f"could not reach Vexa's API at {api_base}: {exc}") from exc

    if response.status_code == 422:
        raise InvalidMeetingUrlError(
            "That doesn't look like a Google Meet link Vexa can join "
            f"(Vexa said: {response.text})."
        )
    if response.status_code == 409:
        raise CaptureConflictError("A bot is already active on this meeting.")
    if response.status_code in (403, 429):
        raise CaptureRateLimitError(
            "Past the concurrent-bot limit - stop an existing bot and try again."
        )
    if response.status_code == 503:
        raise CaptureConfigError(
            f"Vexa's transcription backend isn't configured (Vexa said: {response.text})."
        )
    if response.status_code not in (200, 201):
        raise CaptureAPIError(
            f"Vexa's API returned {response.status_code} sending a bot to "
            f"{meeting_url}: {response.text}"
        )

    data = response.json()
    platform = data.get("platform")
    native_meeting_id = data.get("native_meeting_id")
    if not platform or not native_meeting_id:
        raise CaptureAPIError(
            f"Vexa's response was missing platform/native_meeting_id: {data}"
        )
    status = data.get("status", "requested")

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

        meeting.source_link = data.get("constructed_meeting_url") or meeting_url
        meeting.vexa_meeting_id = data.get("id")
        meeting.status = status
        session.commit()
        session.refresh(meeting)
        meeting_id = meeting.id
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

    return CaptureResult(
        meeting_id=meeting_id,
        status=status,
        platform=platform,
        native_meeting_id=native_meeting_id,
    )


def get_capture_status(meeting_id: int) -> CaptureStatusResult:
    session = SessionLocal()
    try:
        meeting = session.get(Meeting, meeting_id)
        if meeting is None:
            raise CaptureMeetingNotFoundError(f"No meeting with id={meeting_id}.")
        platform, native_meeting_id, current_status = (
            meeting.platform,
            meeting.native_meeting_id,
            meeting.status,
        )
        already_summarized = (
            session.query(Summary).filter_by(meeting_id=meeting_id).count() > 0
        )
    finally:
        session.close()

    try:
        result = ingest(platform, native_meeting_id)
    except VexaNotFoundError:
        # The bot was just requested - Vexa may not have indexed the
        # transcript lookup for it yet. Report our last-known status
        # instead of surfacing this as an error to the poller.
        return CaptureStatusResult(
            meeting_id=meeting_id,
            status=current_status,
            segments_saved=0,
            summarized=already_summarized,
            summarize_error=None,
        )
    except (VexaAPIError, IngestError) as exc:
        raise CaptureAPIError(str(exc)) from exc

    summarize_error = None
    summarized = already_summarized
    if result.status == "completed" and not already_summarized:
        try:
            summarize(meeting_id)
            summarized = True
        except (
            NoTranscriptError,
            TranscriptTooLongError,
            GroqConfigError,
            GroqAuthError,
            GroqRateLimitError,
            GroqAPIError,
            SummarizeError,
        ) as exc:
            summarize_error = str(exc)

    return CaptureStatusResult(
        meeting_id=meeting_id,
        status=result.status,
        segments_saved=result.segments_saved,
        summarized=summarized,
        summarize_error=summarize_error,
    )
