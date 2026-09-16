"""
Talk-time analytics computed live from transcript_segments - no new columns
or tables, since the data (speaker_label, start_timestamp, end_timestamp per
segment) already exists.

Also used directly by main.py's GET /meetings/{id}/analytics and
GET /analytics/overview endpoints - functions here raise AnalyticsError
subclasses instead of printing+sys.exit(), same pattern as chat.py,
embeddings.py, and summarize_meeting.py.
"""

from dataclasses import dataclass, field

from app.database import SessionLocal
from app.models import Meeting, TranscriptSegment


class AnalyticsError(Exception):
    """Base class for errors these functions raise."""


class MeetingNotFoundError(AnalyticsError):
    pass


@dataclass
class SpeakerTalkTime:
    speaker_label: str
    talk_time_seconds: float
    percentage: float


@dataclass
class MeetingAnalytics:
    meeting_id: int
    total_duration_seconds: float
    speakers: list[SpeakerTalkTime] = field(default_factory=list)


@dataclass
class TopSpeaker:
    name: str
    total_minutes: float


@dataclass
class AnalyticsOverview:
    total_meetings: int
    total_duration_seconds: float
    top_speaker: TopSpeaker | None


def _meeting_duration_seconds(meeting: Meeting, segments: list[TranscriptSegment]) -> float:
    """Prefer the meeting's own start_time/end_time - the same fields the
    frontend already uses for formatDuration() elsewhere in the app - and
    fall back to the transcript's own span (max end - min start) for a
    meeting missing one of those. Returns 0.0 if there's nothing to measure
    (e.g. zero segments and no end_time yet)."""
    if meeting.start_time is not None and meeting.end_time is not None:
        return max(0.0, (meeting.end_time - meeting.start_time).total_seconds())
    if segments:
        return max(0.0, max(s.end_timestamp for s in segments) - min(s.start_timestamp for s in segments))
    return 0.0


def _talk_time_by_speaker(segments: list[TranscriptSegment]) -> dict[str, float]:
    talk_time: dict[str, float] = {}
    for seg in segments:
        talk_time[seg.speaker_label] = talk_time.get(seg.speaker_label, 0.0) + (
            seg.end_timestamp - seg.start_timestamp
        )
    return talk_time


def get_meeting_analytics(meeting_id: int, user_id: int) -> MeetingAnalytics:
    """Raises MeetingNotFoundError - both when the meeting truly doesn't
    exist and when it belongs to someone other than user_id, so a caller
    can't tell the two apart (don't reveal another user's meeting exists).
    Never calls sys.exit(), safe to call from a web request."""
    session = SessionLocal()
    try:
        meeting = session.get(Meeting, meeting_id)
        if meeting is None or meeting.user_id != user_id:
            raise MeetingNotFoundError(f"no meeting with id={meeting_id} in the database.")

        segments = session.query(TranscriptSegment).filter_by(meeting_id=meeting_id).all()
    finally:
        session.close()

    talk_time = _talk_time_by_speaker(segments)
    # Percentages are of total TALKED time (every speaker's time in this
    # meeting summed), not of the meeting's wall-clock duration - those two
    # differ whenever there's silence/crosstalk the transcript doesn't
    # attribute to anyone. This is also why a solo meeting is correctly
    # ~100% here rather than whatever smaller fraction of wall-clock time
    # the one person actually spoke.
    total_talk_time = sum(talk_time.values())

    speakers = [
        SpeakerTalkTime(
            speaker_label=label,
            talk_time_seconds=seconds,
            percentage=(seconds / total_talk_time * 100) if total_talk_time > 0 else 0.0,
        )
        for label, seconds in talk_time.items()
    ]
    speakers.sort(key=lambda s: s.talk_time_seconds, reverse=True)

    return MeetingAnalytics(
        meeting_id=meeting_id,
        total_duration_seconds=_meeting_duration_seconds(meeting, segments),
        speakers=speakers,
    )


def get_analytics_overview(user_id: int) -> AnalyticsOverview:
    """Aggregates only across user_id's own meetings - never another
    user's, even in a global-sounding "overview"."""
    session = SessionLocal()
    try:
        meetings = session.query(Meeting).filter_by(user_id=user_id).all()
        # platform="manual" meetings (created from a pasted transcript, see
        # manual_meeting.py) only have synthetic, order-preserving per-line
        # timestamps - not real durations or real speaking time - so they're
        # excluded from these aggregate duration/top-speaker calculations
        # entirely, to avoid quietly skewing real numbers with meaningless
        # synthetic data. They still count toward total_meetings below -
        # they're real meetings the user added, just not real recordings.
        real_meetings = [m for m in meetings if m.platform != "manual"]
        real_meeting_ids = [m.id for m in real_meetings]
        segments = (
            session.query(TranscriptSegment)
            .filter(TranscriptSegment.meeting_id.in_(real_meeting_ids))
            .all()
            if real_meeting_ids
            else []
        )
    finally:
        session.close()

    segments_by_meeting: dict[int, list[TranscriptSegment]] = {}
    for seg in segments:
        segments_by_meeting.setdefault(seg.meeting_id, []).append(seg)

    total_duration_seconds = sum(
        _meeting_duration_seconds(meeting, segments_by_meeting.get(meeting.id, []))
        for meeting in real_meetings
    )

    # Combined across every real meeting - there's no separate speaker-
    # identity table in this app, so speaker_label IS the identity (e.g.
    # "Nishtha Jain" said the same way in every meeting she's in). "Unknown
    # Speaker" is not special-cased, per the same rule as the per-meeting
    # endpoint.
    talk_time_across_meetings = _talk_time_by_speaker(segments)

    top_speaker = None
    if talk_time_across_meetings:
        name, total_seconds = max(talk_time_across_meetings.items(), key=lambda kv: kv[1])
        top_speaker = TopSpeaker(name=name, total_minutes=total_seconds / 60)

    return AnalyticsOverview(
        total_meetings=len(meetings),
        total_duration_seconds=total_duration_seconds,
        top_speaker=top_speaker,
    )
