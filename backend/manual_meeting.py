"""
Create a meeting from a pasted transcript instead of live Vexa capture - no
bot, no recording, no audio, ever, for meetings created this way (platform
"manual"). Content is already final, so this creates the Meeting +
TranscriptSegment rows and summarizes immediately, synchronously, reusing
summarize_meeting.summarize() rather than duplicating that logic.

create_manual_meeting() is called directly by main.py's POST /meetings/manual
endpoint - it raises ManualMeetingError subclasses instead of
printing+sys.exit(), same convention as ingest_transcript.py,
summarize_meeting.py, and capture_meeting.py.
"""

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import uuid4

from app.database import SessionLocal
from app.models import Meeting, TranscriptSegment
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


class ManualMeetingError(Exception):
    """Base class for errors this module raises - callers decide how to present them."""


class EmptyTranscriptError(ManualMeetingError):
    pass


@dataclass
class ManualMeetingResult:
    meeting_id: int
    segments_saved: int
    speaker_format_detected: bool
    summarized: bool
    summarize_error: str | None


# Matches "Speaker Name: text", optionally prefixed with a "[mm:ss]" or
# "[hh:mm:ss]" elapsed-time marker - the same per-line shape
# summarize_meeting.build_transcript_text() itself produces for a segment
# with no anchorable timestamp (plain "{speaker}: {text}"), or with one
# ("[mm:ss] {speaker}: {text}") - so text copy-pasted straight out of this
# app's own transcript view round-trips correctly. The speaker portion is
# capped at 150 chars, well past any real name, to keep an ordinary sentence
# containing a colon (e.g. "Note: bring laptop") from being mistaken for a
# name on its own - a false match there just costs one line's worth of
# attribution accuracy, and the majority-match check below is what actually
# decides per-line vs. single-segment fallback.
_LINE_PATTERN = re.compile(r"^(?:\[\d{1,3}(?::\d{2}){1,2}\]\s*)?([^:\n]{1,150}):\s*(\S.*)$")

# "Most/all lines match" per the spec - a simple majority is enough to
# commit to per-line segmentation; anything less falls back to one plain
# segment rather than guessing badly on a transcript that mostly isn't in
# this shape.
_MATCH_THRESHOLD = 0.6

FALLBACK_SPEAKER_LABEL = "Transcript"


def parse_transcript_lines(text: str) -> tuple[list[tuple[str, str]], bool]:
    """Returns (segments, speaker_format_detected) where segments is a list
    of (speaker_label, line_text) pairs, one per transcript_segment to
    create.

    If at least _MATCH_THRESHOLD of non-blank lines match "Speaker: text",
    every line becomes its own segment - a line that individually doesn't
    match (in an otherwise-matching paste) gets "Unknown Speaker", the same
    existing fallback real diarization gaps already use (see
    app/models.py's TranscriptSegment.speaker_label). Otherwise the entire
    paste becomes a single segment under FALLBACK_SPEAKER_LABEL."""
    lines = [ln.strip() for ln in text.strip().splitlines() if ln.strip()]
    if not lines:
        return [], False

    parsed: list[tuple[str | None, str]] = []
    match_count = 0
    for line in lines:
        m = _LINE_PATTERN.match(line)
        if m:
            speaker, content = m.group(1).strip(), m.group(2).strip()
            if speaker and content:
                parsed.append((speaker, content))
                match_count += 1
                continue
        parsed.append((None, line))

    if match_count / len(lines) < _MATCH_THRESHOLD:
        return [(FALLBACK_SPEAKER_LABEL, text.strip())], False

    return [(speaker or "Unknown Speaker", content) for speaker, content in parsed], True


def create_manual_meeting(
    user_id: int,
    title: str | None,
    meeting_date: datetime | None,
    transcript_text: str,
) -> ManualMeetingResult:
    """Raises ManualMeetingError subclasses - never calls sys.exit(), safe to
    call from a web request."""
    transcript_text = (transcript_text or "").strip()
    if not transcript_text:
        raise EmptyTranscriptError("transcript_text must not be empty.")

    segments, speaker_format_detected = parse_transcript_lines(transcript_text)
    start_time = meeting_date or datetime.now(timezone.utc)
    # Epoch seconds, matching how every other segment's start/end_timestamp
    # is stored (see ingest_transcript.py) - +1 second per line purely to
    # preserve display/playback order, NOT a real duration. This is why
    # talk-time analytics and duration badges are suppressed for
    # platform="manual" meetings elsewhere (frontend + analytics.py).
    start_epoch = start_time.timestamp()

    session = SessionLocal()
    try:
        meeting = Meeting(
            user_id=user_id,
            platform="manual",
            native_meeting_id=f"manual-{uuid4()}",
            title=(title or "").strip() or None,
            status="completed",
            start_time=start_time,
        )
        session.add(meeting)
        session.flush()  # assigns meeting.id

        for i, (speaker, line_text) in enumerate(segments):
            session.add(
                TranscriptSegment(
                    meeting_id=meeting.id,
                    segment_id=f"manual-{i}",
                    speaker_label=speaker,
                    text=line_text,
                    start_timestamp=start_epoch + i,
                    end_timestamp=start_epoch + i + 1,
                )
            )
        session.commit()
        meeting_id = meeting.id
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

    # Synchronous, like every other summarize() call site in this app - the
    # content is already complete (no live-capture polling to wait on), and
    # nothing else here introduces a background-task pattern this codebase
    # doesn't already have. A failure here doesn't undo the meeting/segments
    # already committed above - same "partial pipeline" shape as capture's
    # get_capture_status(), which is where this error-swallowing mirrors.
    summarize_error = None
    summarized = False
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

    return ManualMeetingResult(
        meeting_id=meeting_id,
        segments_saved=len(segments),
        speaker_format_detected=speaker_format_detected,
        summarized=summarized,
        summarize_error=summarize_error,
    )
