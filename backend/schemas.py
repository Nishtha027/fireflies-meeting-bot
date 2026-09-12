"""Pydantic response models for main.py - kept separate from app/models.py
(the SQLAlchemy ORM models) so the HTTP-facing shape can evolve independently
of the DB schema."""

from datetime import datetime

from pydantic import BaseModel


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


class ActionItemWithMeeting(BaseModel):
    """An action item plus enough of its parent meeting's context to link
    back to it, so the Tasks page can render a cross-meeting list without
    the frontend making one request per meeting."""

    id: int
    description: str
    assignee_guess: str | None
    generated_at: datetime
    meeting_id: int
    platform: str
    native_meeting_id: str
    meeting_start_time: datetime | None
