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
from datetime import date

from fastapi import Depends, FastAPI, HTTPException, Path, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ActionItem, Meeting, Summary, TranscriptSegment
from analytics import (
    MeetingNotFoundError as AnalyticsMeetingNotFoundError,
    get_analytics_overview,
    get_meeting_analytics,
)
from capture_meeting import (
    CaptureAPIError,
    CaptureConfigError,
    CaptureConflictError,
    CaptureError,
    CaptureMeetingNotFoundError,
    CaptureRateLimitError,
    InvalidMeetingUrlError,
    get_capture_status,
    start_capture,
)
from chat import (
    ChatError,
    EmptyQuestionError,
    NoIndexedMeetingsError,
    answer_question,
)
from embeddings import (
    EmbeddingError,
    NoContentError,
    embed_all,
    embed_meeting,
)
from embeddings import MeetingNotFoundError as EmbedMeetingNotFoundError
from ingest_transcript import IngestError, VexaAPIError, VexaNotFoundError, ingest
from schemas import (
    ActionItemOut,
    ActionItemUpdate,
    ActionItemWithMeeting,
    AnalyticsOverviewOut,
    CaptureMeetingRequest,
    CaptureMeetingResponse,
    CaptureStatusResponse,
    ChatRequest,
    ChatResponse,
    ChatSourceOut,
    EmbedAllEntry,
    EmbedAllResponse,
    EmbedResponse,
    HealthResponse,
    IngestResponse,
    MeetingAnalyticsOut,
    MeetingDetail,
    MeetingListItem,
    SearchResult,
    SpeakerTalkTimeOut,
    SummarizeResponse,
    SummaryOut,
    TopSpeakerOut,
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


@app.get("/action-items", response_model=list[ActionItemWithMeeting])
def list_action_items(db: Session = Depends(get_db)):
    # One join, not N+1: the Tasks page needs every action item across every
    # meeting plus enough meeting context to link back, in a single request.
    rows = (
        db.query(ActionItem, Meeting)
        .join(Meeting, ActionItem.meeting_id == Meeting.id)
        .order_by(ActionItem.generated_at.desc())
        .all()
    )
    return [
        ActionItemWithMeeting(
            id=item.id,
            description=item.description,
            assignee_guess=item.assignee_guess,
            generated_at=item.generated_at,
            completed=item.completed,
            meeting_id=meeting.id,
            platform=meeting.platform,
            native_meeting_id=meeting.native_meeting_id,
            meeting_start_time=meeting.start_time,
        )
        for item, meeting in rows
    ]


@app.post("/meetings/start", response_model=CaptureMeetingResponse)
def start_meeting_capture(payload: CaptureMeetingRequest):
    meeting_url = payload.meeting_url.strip()
    if "meet.google.com" not in meeting_url.lower():
        raise HTTPException(
            status_code=422,
            detail="Please paste a Google Meet link (meet.google.com/...) - other platforms aren't supported yet.",
        )

    try:
        result = start_capture(meeting_url)
    except InvalidMeetingUrlError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except CaptureConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except CaptureRateLimitError as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    except CaptureConfigError as exc:
        raise HTTPException(status_code=500, detail=f"Vexa is misconfigured: {exc}")
    except CaptureAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except CaptureError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return CaptureMeetingResponse(
        success=True,
        meeting_id=result.meeting_id,
        status=result.status,
        platform=result.platform,
        native_meeting_id=result.native_meeting_id,
    )


@app.get("/meetings/{meeting_id}/capture-status", response_model=CaptureStatusResponse)
def get_meeting_capture_status(meeting_id: int = Path(..., gt=0)):
    try:
        result = get_capture_status(meeting_id)
    except CaptureMeetingNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except CaptureAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except CaptureError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return CaptureStatusResponse(
        meeting_id=result.meeting_id,
        status=result.status,
        segments_saved=result.segments_saved,
        summarized=result.summarized,
        summarize_error=result.summarize_error,
    )


@app.patch("/action-items/{action_item_id}", response_model=ActionItemWithMeeting)
def update_action_item(
    payload: ActionItemUpdate,
    action_item_id: int = Path(..., gt=0),
    db: Session = Depends(get_db),
):
    item = db.get(ActionItem, action_item_id)
    if item is None:
        raise HTTPException(status_code=404, detail=f"No action item with id={action_item_id}.")

    item.completed = payload.completed
    db.commit()
    db.refresh(item)

    meeting = db.get(Meeting, item.meeting_id)
    return ActionItemWithMeeting(
        id=item.id,
        description=item.description,
        assignee_guess=item.assignee_guess,
        generated_at=item.generated_at,
        completed=item.completed,
        meeting_id=meeting.id,
        platform=meeting.platform,
        native_meeting_id=meeting.native_meeting_id,
        meeting_start_time=meeting.start_time,
    )


# Full-text search across, for each meeting: its summary overview, key
# points, decisions, and every transcript segment. Computed live per request
# (no tsvector column/GIN index) since the dataset is small - see the final
# report for when that would be worth adding.
#
# Each field is unioned into a common (meeting_id, field, content) shape,
# ranked with ts_rank_cd, then reduced to one row per meeting (DISTINCT ON)
# so results are grouped by meeting rather than one row per matching
# segment. Ties (common for short, similarly-sized fields under
# ts_rank_cd's default, non-length-normalized scoring) are broken toward
# curated summary content over raw transcript utterances.
SEARCH_SQL = text("""
    WITH candidates AS (
        SELECT s.meeting_id, 'summary' AS field, s.overview_text AS content
        FROM summaries s
        WHERE s.overview_text IS NOT NULL AND s.overview_text <> ''

        UNION ALL

        SELECT s.meeting_id, 'key_point' AS field, kp.value AS content
        FROM summaries s
        CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(s.key_points, '[]'::json)::jsonb) AS kp(value)

        UNION ALL

        SELECT s.meeting_id, 'decision' AS field, d.value AS content
        FROM summaries s
        CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(s.decisions, '[]'::json)::jsonb) AS d(value)

        UNION ALL

        SELECT ts.meeting_id, 'transcript' AS field, ts.text AS content
        FROM transcript_segments ts
    ),
    query AS (
        SELECT websearch_to_tsquery('english', :q) AS tsq
    ),
    ranked AS (
        SELECT
            c.meeting_id,
            c.field,
            ts_rank_cd(to_tsvector('english', c.content), q.tsq) AS rank,
            ts_headline(
                'english', c.content, q.tsq,
                'StartSel=⟪, StopSel=⟫, MaxFragments=1, MaxWords=30, MinWords=10'
            ) AS snippet
        FROM candidates c, query q
        WHERE to_tsvector('english', c.content) @@ q.tsq
    ),
    best AS (
        SELECT DISTINCT ON (meeting_id) meeting_id, field, rank, snippet
        FROM ranked
        ORDER BY
            meeting_id,
            rank DESC,
            CASE field
                WHEN 'decision' THEN 1
                WHEN 'key_point' THEN 2
                WHEN 'summary' THEN 3
                WHEN 'transcript' THEN 4
            END
    )
    SELECT
        m.id AS meeting_id,
        m.platform,
        m.native_meeting_id,
        m.start_time,
        m.end_time,
        m.status,
        b.field AS matched_field,
        b.snippet,
        b.rank
    FROM best b
    JOIN meetings m ON m.id = b.meeting_id
    WHERE (CAST(:from_date AS date) IS NULL OR m.start_time >= CAST(:from_date AS date))
      AND (CAST(:to_date AS date) IS NULL OR m.start_time < CAST(:to_date AS date) + INTERVAL '1 day')
    ORDER BY b.rank DESC
""")

# Pure date-range browse, no keyword: same response shape as a keyword
# match (so the frontend can share result-rendering plumbing), but sorted
# chronologically instead of by relevance, with the summary's overview
# (truncated the same way /meetings already does for overview_preview) as
# the snippet and matched_field left null - the frontend uses that null to
# render these with the plain MeetingCard instead of a highlighted-snippet
# card, since there's no keyword match to highlight.
DATE_ONLY_SQL = text("""
    SELECT
        m.id AS meeting_id,
        m.platform,
        m.native_meeting_id,
        m.start_time,
        m.end_time,
        m.status,
        NULL AS matched_field,
        LEFT(s.overview_text, 100) AS snippet,
        0.0 AS rank
    FROM meetings m
    LEFT JOIN summaries s ON s.meeting_id = m.id
    WHERE (CAST(:from_date AS date) IS NULL OR m.start_time >= CAST(:from_date AS date))
      AND (CAST(:to_date AS date) IS NULL OR m.start_time < CAST(:to_date AS date) + INTERVAL '1 day')
    ORDER BY m.start_time DESC NULLS LAST
""")


@app.get("/search", response_model=list[SearchResult])
def search_meetings(
    q: str = Query(default=""),
    from_date: date | None = Query(default=None),
    to_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
):
    if from_date is not None and to_date is not None and from_date > to_date:
        raise HTTPException(
            status_code=400,
            detail="from_date must not be after to_date.",
        )

    query = q.strip()
    has_keyword = len(query) >= 2
    has_date_filter = from_date is not None or to_date is not None

    if not has_keyword and not has_date_filter:
        return []

    params = {"from_date": from_date, "to_date": to_date}
    if has_keyword:
        rows = db.execute(SEARCH_SQL, {**params, "q": query}).mappings().all()
    else:
        rows = db.execute(DATE_ONLY_SQL, params).mappings().all()

    return [
        SearchResult(
            meeting_id=row["meeting_id"],
            platform=row["platform"],
            native_meeting_id=row["native_meeting_id"],
            start_time=row["start_time"],
            end_time=row["end_time"],
            status=row["status"],
            matched_field=row["matched_field"],
            snippet=row["snippet"],
            rank=float(row["rank"]),
        )
        for row in rows
    ]


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


@app.post("/meetings/{meeting_id}/embed", response_model=EmbedResponse)
def trigger_embed(meeting_id: int = Path(..., gt=0)):
    try:
        count = embed_meeting(meeting_id)
    except EmbedMeetingNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except NoContentError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except EmbeddingError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return EmbedResponse(success=True, meeting_id=meeting_id, chunks_written=count)


@app.post("/embed-all", response_model=EmbedAllResponse)
def trigger_embed_all():
    summary = embed_all()
    return EmbedAllResponse(
        success=True,
        embedded=[
            EmbedAllEntry(meeting_id=meeting_id, chunks_written=count)
            for meeting_id, count in summary.embedded
        ],
        already_embedded=summary.already_embedded,
        skipped_no_content=summary.skipped_no_content,
    )


@app.post("/chat", response_model=ChatResponse)
def chat_endpoint(request: ChatRequest):
    try:
        result = answer_question(request.question)
    except EmptyQuestionError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except NoIndexedMeetingsError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except GroqConfigError as exc:
        raise HTTPException(status_code=500, detail=f"Groq is misconfigured: {exc}")
    except GroqAuthError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except GroqRateLimitError as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    except (GroqAPIError, ChatError) as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    return ChatResponse(
        answer=result.answer,
        sources=[
            ChatSourceOut(
                meeting_id=source.meeting_id,
                native_meeting_id=source.native_meeting_id,
                platform=source.platform,
                start_time=source.start_time,
                chunk_type=source.chunk_type,
                snippet=source.snippet,
            )
            for source in result.sources
        ],
    )


@app.get("/meetings/{meeting_id}/analytics", response_model=MeetingAnalyticsOut)
def get_meeting_analytics_endpoint(meeting_id: int = Path(..., gt=0)):
    try:
        result = get_meeting_analytics(meeting_id)
    except AnalyticsMeetingNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    return MeetingAnalyticsOut(
        meeting_id=result.meeting_id,
        total_duration_seconds=result.total_duration_seconds,
        speakers=[
            SpeakerTalkTimeOut(
                speaker_label=s.speaker_label,
                talk_time_seconds=s.talk_time_seconds,
                percentage=s.percentage,
            )
            for s in result.speakers
        ],
    )


@app.get("/analytics/overview", response_model=AnalyticsOverviewOut)
def get_analytics_overview_endpoint():
    result = get_analytics_overview()
    return AnalyticsOverviewOut(
        total_meetings=result.total_meetings,
        total_duration_seconds=result.total_duration_seconds,
        top_speaker=(
            TopSpeakerOut(name=result.top_speaker.name, total_minutes=result.top_speaker.total_minutes)
            if result.top_speaker
            else None
        ),
    )
