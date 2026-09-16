from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class User(Base):
    """A real, independent registered account - open registration, no admin
    approval. Every meeting a user captures belongs to them via
    Meeting.user_id; nothing here implies or grants visibility into any
    other user's data."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    email: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    meetings: Mapped[list["Meeting"]] = relationship(back_populates="owner")


class Meeting(Base):
    __tablename__ = "meetings"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "platform", "native_meeting_id", name="uq_meetings_user_platform_native_id"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Nullable: legacy meetings captured before multi-user support has no
    # owner yet (see the auth migration's docstring for how those are
    # handled). SET NULL on delete rather than CASCADE - deleting a user
    # account isn't exposed anywhere today, but if it ever is, their past
    # meetings becoming ownerless again is the safer default over silently
    # deleting recorded transcripts.
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str | None] = mapped_column(String, nullable=True)
    source_link: Mapped[str | None] = mapped_column(String, nullable=True)
    # Vexa is multi-platform (google_meet, teams, zoom); native_meeting_id is
    # Vexa's own per-platform meeting code (e.g. "abc-defg-hij"). Uniqueness
    # is scoped per-user (not globally) so two different users can each
    # independently capture "the same" external link (e.g. a recurring
    # standup) as their own separate, privately-owned meeting - re-running
    # capture/ingestion for the SAME user against the same meeting still
    # updates their own row in place instead of creating a duplicate.
    platform: Mapped[str] = mapped_column(String, nullable=False)
    native_meeting_id: Mapped[str] = mapped_column(String, nullable=False)
    # Vexa's own internal integer meeting id, kept for direct traceability
    # back to its API (e.g. GET /meetings/{id}) without re-deriving it.
    vexa_meeting_id: Mapped[int | None] = mapped_column(nullable=True)
    start_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="unknown")
    # Only ever set (status="failed") by the upload pipeline (upload_meeting.py)
    # when transcription/extraction fails - lets GET /meetings/{id} surface a
    # real error instead of a meeting stuck at "processing" forever with no
    # explanation. Null for every other platform, which has no comparable
    # failure mode to report this way.
    processing_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    owner: Mapped["User | None"] = relationship(back_populates="meetings")
    segments: Mapped[list["TranscriptSegment"]] = relationship(
        back_populates="meeting", cascade="all, delete-orphan"
    )
    summaries: Mapped[list["Summary"]] = relationship(back_populates="meeting", cascade="all, delete-orphan")
    action_items: Mapped[list["ActionItem"]] = relationship(
        back_populates="meeting", cascade="all, delete-orphan"
    )


class TranscriptSegment(Base):
    __tablename__ = "transcript_segments"
    __table_args__ = (
        UniqueConstraint("meeting_id", "segment_id", name="uq_segments_meeting_segment_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    meeting_id: Mapped[int] = mapped_column(ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False)
    # Vexa's own segment_id (e.g. "ch-0:2:1789162203877"), kept so re-running
    # ingestion is idempotent (upsert on meeting_id+segment_id) rather than
    # appending duplicate rows every time.
    segment_id: Mapped[str] = mapped_column(String, nullable=False)
    # NOT NULL with an ingestion-time fallback to "Unknown Speaker", rather
    # than nullable: Vexa's own docs confirm diarization attribution isn't
    # guaranteed per-segment (~4-7% of rows can come back with an empty
    # speaker under heavy crosstalk). Every downstream consumer (dashboard,
    # summarizer) can then assume a display-ready string always exists,
    # instead of special-casing NULL everywhere.
    speaker_label: Mapped[str] = mapped_column(String, nullable=False, default="Unknown Speaker")
    text: Mapped[str] = mapped_column(Text, nullable=False)
    start_timestamp: Mapped[float] = mapped_column(Float, nullable=False)
    end_timestamp: Mapped[float] = mapped_column(Float, nullable=False)
    language: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    meeting: Mapped["Meeting"] = relationship(back_populates="segments")


class Summary(Base):
    """Empty until the summarization phase; schema exists now so it doesn't
    need reworking later."""

    __tablename__ = "summaries"

    id: Mapped[int] = mapped_column(primary_key=True)
    meeting_id: Mapped[int] = mapped_column(ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False)
    overview_text: Mapped[str] = mapped_column(Text, nullable=False)
    # Arrays of strings, stored as JSON (nullable: only populated once the
    # summarization pipeline runs). Added for the summarization phase after
    # confirming with the user that plain columns (over one catch-all JSON
    # blob) were preferred for later direct SQL querying.
    key_points: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    decisions: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    # List of {"title": str, "start_time_seconds": float}, each snapped to a
    # real transcript segment's elapsed start time before being stored (see
    # summarize_meeting.py) - never a raw/interpolated model timestamp.
    # Nullable: only populated once a meeting is (re)summarized after this
    # feature shipped, older summaries stay null rather than being
    # backfilled (regenerating is already a one-click action).
    chapters: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    meeting: Mapped["Meeting"] = relationship(back_populates="summaries")


class ActionItem(Base):
    """Empty until the summarization phase; schema exists now so it doesn't
    need reworking later."""

    __tablename__ = "action_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    meeting_id: Mapped[int] = mapped_column(ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    assignee_guess: Mapped[str | None] = mapped_column(String, nullable=True)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )

    meeting: Mapped["Meeting"] = relationship(back_populates="action_items")
