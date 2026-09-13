"""Pydantic response models for main.py - kept separate from app/models.py
(the SQLAlchemy ORM models) so the HTTP-facing shape can evolve independently
of the DB schema."""

from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class HealthResponse(BaseModel):
    status: str
    database: str


class MeetingListItem(BaseModel):
    id: int
    platform: str
    native_meeting_id: str
    start_time: datetime | None
    end_time: datetime | None
    status: str
    overview_preview: str | None


class TranscriptSegmentOut(BaseModel):
    speaker_label: str
    text: str
    start_timestamp: float
    end_timestamp: float


class SummaryOut(BaseModel):
    overview_text: str
    key_points: list[str]
    decisions: list[str]


class ActionItemOut(BaseModel):
    description: str
    assignee_guess: str | None


class MeetingDetail(BaseModel):
    id: int
    platform: str
    native_meeting_id: str
    vexa_meeting_id: int | None
    start_time: datetime | None
    end_time: datetime | None
    status: str
    transcript: list[TranscriptSegmentOut]
    summary: SummaryOut | None
    action_items: list[ActionItemOut]


class IngestResponse(BaseModel):
    success: bool
    meeting_id: int
    status: str
    segments_saved: int
    warning: str | None


class SummarizeResponse(BaseModel):
    success: bool
    meeting_id: int
    overview: str
    key_points: list[str]
    decisions: list[str]
    action_items: list[ActionItemOut]


class SearchResult(BaseModel):
    """One meeting matching a search, with its single best-matching snippet
    (across overview/key_points/decisions/transcript) so results are grouped
    by meeting rather than one row per match.

    For a pure date-range browse (no keyword), matched_field is null and
    snippet is the plain summary preview instead of a highlighted match -
    the frontend renders those with the existing MeetingCard component
    instead of the highlighted-snippet search result style."""

    meeting_id: int
    platform: str
    native_meeting_id: str
    start_time: datetime | None
    end_time: datetime | None
    status: str
    matched_field: str | None
    snippet: str | None
    rank: float


class ActionItemWithMeeting(BaseModel):
    """An action item plus enough of its parent meeting's context to link
    back to it, so the Tasks page can render a cross-meeting list without
    the frontend making one request per meeting."""

    id: int
    description: str
    assignee_guess: str | None
    generated_at: datetime
    completed: bool
    meeting_id: int
    platform: str
    native_meeting_id: str
    meeting_start_time: datetime | None


class ActionItemUpdate(BaseModel):
    """Body for PATCH /action-items/{id} - completion is the only thing a
    user can change about an action item themselves (everything else is
    AI-generated from the transcript)."""

    completed: bool


class EmbedResponse(BaseModel):
    success: bool
    meeting_id: int
    chunks_written: int


class EmbedAllEntry(BaseModel):
    meeting_id: int
    chunks_written: int


class EmbedAllResponse(BaseModel):
    success: bool
    embedded: list[EmbedAllEntry]
    already_embedded: list[int]
    skipped_no_content: list[int]


class ChatRequest(BaseModel):
    question: str


class ChatSourceOut(BaseModel):
    meeting_id: int
    native_meeting_id: str
    platform: str
    start_time: datetime | None
    chunk_type: str
    snippet: str


class ChatResponse(BaseModel):
    answer: str
    sources: list[ChatSourceOut]


class SpeakerTalkTimeOut(BaseModel):
    speaker_label: str
    talk_time_seconds: float
    # Share of this meeting's total TALKED time (every speaker's time
    # summed), not of wall-clock meeting duration - see analytics.py.
    percentage: float


class MeetingAnalyticsOut(BaseModel):
    meeting_id: int
    total_duration_seconds: float
    speakers: list[SpeakerTalkTimeOut]


class TopSpeakerOut(BaseModel):
    name: str
    total_minutes: float


class AnalyticsOverviewOut(BaseModel):
    total_meetings: int
    total_duration_seconds: float
    top_speaker: TopSpeakerOut | None


class CaptureMeetingRequest(BaseModel):
    meeting_url: str


class CaptureMeetingResponse(BaseModel):
    success: bool
    meeting_id: int
    status: str
    platform: str
    native_meeting_id: str


class CaptureStatusResponse(BaseModel):
    meeting_id: int
    status: str
    segments_saved: int
    summarized: bool
    summarize_error: str | None


class SetupStatusResponse(BaseModel):
    account_exists: bool


class SetupRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class AuthResponse(BaseModel):
    success: bool


class MeResponse(BaseModel):
    authenticated: bool
    name: str | None
    email: str | None
