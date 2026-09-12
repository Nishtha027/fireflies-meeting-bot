"""
FastAPI application exposing our meeting data over HTTP.

Run locally:
    uvicorn main:app --reload --port 8000

Then open http://localhost:8000/docs for interactive API docs.

This is a thin HTTP layer over logic that already lives in
ingest_transcript.py and summarize_meeting.py - it does not duplicate that
logic, it imports and calls the same ingest()/summarize() functions the
standalone scripts use.
"""

import os
import sys
import traceback

from fastapi import Depends, FastAPI, HTTPException, Path
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ActionItem, Meeting, Summary, TranscriptSegment
from ingest_transcript import IngestError, VexaAPIError, VexaNotFoundError, ingest
from schemas import (
    ActionItemOut,
    HealthResponse,
    IngestResponse,
    MeetingDetail,
    MeetingListItem,
    SummarizeResponse,
    SummaryOut,
    TranscriptSegmentOut,
)
from summarize_meeting import (
    GroqAPIError,
    GroqAuthError,
    GroqConfigError,
    GroqRateLimitError,
    MeetingNotFoundError,
    NoTranscriptError,
    SummarizeError,
    TranscriptTooLongError,
    summarize,
)

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

app = FastAPI(title="Fireflies Clone API", version="0.1.0")

# Next.js's default dev server port is 3000. No frontend exists yet, so this
# is intentionally overridable via an env var without touching code once one
# does (e.g. a different port, or a deployed frontend origin).
_default_origins = "http://localhost:3000"
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("CORS_ORIGINS", _default_origins).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request, exc: Exception):
    # Never leak raw stack traces to the client - log them server-side and
    # return a generic message instead.
    traceback.print_exc()
    return JSONResponse(status_code=500, content={"detail": "Internal server error."})


@app.get("/health", response_model=HealthResponse)
def health(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Database connection failed.")
    return HealthResponse(status="ok", database="connected")


@app.get("/meetings", response_model=list[MeetingListItem])
def list_meetings(db: Session = Depends(get_db)):
    meetings = db.query(Meeting).order_by(Meeting.start_time.desc().nullslast()).all()

    items = []
    for meeting in meetings:
        summary = db.query(Summary).filter_by(meeting_id=meeting.id).one_or_none()
        preview = summary.overview_text[:100] if summary else None
        items.append(
            MeetingListItem(
                id=meeting.id,
                platform=meeting.platform,
                native_meeting_id=meeting.native_meeting_id,
                start_time=meeting.start_time,
                end_time=meeting.end_time,
                status=meeting.status,
                overview_preview=preview,
            )
        )
    return items


@app.get("/meetings/{meeting_id}", response_model=MeetingDetail)
def get_meeting(meeting_id: int = Path(..., gt=0), db: Session = Depends(get_db)):
    meeting = db.get(Meeting, meeting_id)
    if meeting is None:
        raise HTTPException(status_code=404, detail=f"No meeting with id={meeting_id}.")

    segments = (
        db.query(TranscriptSegment)
        .filter_by(meeting_id=meeting_id)
        .order_by(TranscriptSegment.start_timestamp)
        .all()
    )
    summary = db.query(Summary).filter_by(meeting_id=meeting_id).one_or_none()
    action_items = db.query(ActionItem).filter_by(meeting_id=meeting_id).all()

    return MeetingDetail(
        id=meeting.id,
        platform=meeting.platform,
        native_meeting_id=meeting.native_meeting_id,
        vexa_meeting_id=meeting.vexa_meeting_id,
        start_time=meeting.start_time,
        end_time=meeting.end_time,
        status=meeting.status,
        transcript=[
            TranscriptSegmentOut(
                speaker_label=seg.speaker_label,
                text=seg.text,
                start_timestamp=seg.start_timestamp,
                end_timestamp=seg.end_timestamp,
            )
            for seg in segments
        ],
        summary=(
            SummaryOut(
                overview_text=summary.overview_text,
                key_points=summary.key_points or [],
                decisions=summary.decisions or [],
            )
            if summary
            else None
        ),
        action_items=[
            ActionItemOut(description=item.description, assignee_guess=item.assignee_guess)
            for item in action_items
        ],
    )


@app.post("/meetings/{meeting_id}/ingest", response_model=IngestResponse)
def trigger_ingest(meeting_id: int = Path(..., gt=0), db: Session = Depends(get_db)):
    # ingest() upserts by (platform, native_meeting_id), not our internal id,
    # so an existing row is looked up first to know which Vexa meeting to
    # re-fetch. This endpoint refreshes an already-ingested meeting; it does
    # not create brand-new meetings from scratch (out of scope here - no
    # requirement described creating a meeting via this API yet).
    meeting = db.get(Meeting, meeting_id)
    if meeting is None:
        raise HTTPException(status_code=404, detail=f"No meeting with id={meeting_id}.")
    platform, native_meeting_id = meeting.platform, meeting.native_meeting_id

    try:
        result = ingest(platform, native_meeting_id)
    except VexaNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except VexaAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except IngestError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return IngestResponse(
        success=True,
        meeting_id=result.meeting_id,
        status=result.status,
        segments_saved=result.segments_saved,
        warning=result.warning,
    )


@app.post("/meetings/{meeting_id}/summarize", response_model=SummarizeResponse)
def trigger_summarize(meeting_id: int = Path(..., gt=0)):
    try:
        result = summarize(meeting_id)
    except MeetingNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except (NoTranscriptError, TranscriptTooLongError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except GroqConfigError as exc:
        raise HTTPException(status_code=500, detail=f"Groq is misconfigured: {exc}")
    except GroqAuthError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except GroqRateLimitError as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    except (GroqAPIError, SummarizeError) as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    return SummarizeResponse(
        success=True,
        meeting_id=result.meeting_id,
        overview=result.overview,
        key_points=result.key_points,
        decisions=result.decisions,
        action_items=[
            ActionItemOut(description=item["description"], assignee_guess=item["assignee"])
            for item in result.action_items
        ],
    )
