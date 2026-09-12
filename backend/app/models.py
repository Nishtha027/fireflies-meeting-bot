from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class Meeting(Base):
    __tablename__ = "meetings"
    __table_args__ = (
        UniqueConstraint("platform", "native_meeting_id", name="uq_meetings_platform_native_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str | None] = mapped_column(String, nullable=True)
    source_link: Mapped[str | None] = mapped_column(String, nullable=True)
    # Vexa is multi-platform (google_meet, teams, zoom); native_meeting_id is
    # Vexa's own per-platform meeting code (e.g. "abc-defg-hij"). The pair is
    # unique-constrained so re-running the ingestion script against the same
    # meeting updates it in place instead of creating a duplicate row.
    platform: Mapped[str] = mapped_column(String, nullable=False)
    native_meeting_id: Mapped[str] = mapped_column(String, nullable=False)
    # Vexa's own internal integer meeting id, kept for direct traceability
    # back to its API (e.g. GET /meetings/{id}) without re-deriving it.
    vexa_meeting_id: Mapped[int | None] = mapped_column(nullable=True)
    start_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="unknown")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

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

    meeting: Mapped["Meeting"] = relationship(back_populates="action_items")
