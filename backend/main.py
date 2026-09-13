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

import logging
import os
import sys
import traceback
from contextlib import asynccontextmanager
from datetime import date

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Path, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ActionItem, Meeting, Summary, TranscriptSegment, User
from analytics import (
    MeetingNotFoundError as AnalyticsMeetingNotFoundError,
    get_analytics_overview,
    get_meeting_analytics,
)
from auth import (
    AuthConfigError,
    EmailAlreadyRegisteredError,
    InvalidCredentialsError,
    create_access_token,
    get_current_user,
    register_user,
    require_auth,
    verify_credentials,
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
from delete_vexa_recording import (
    VexaDeleteError,
    VexaMeetingStillActiveError,
    delete_vexa_meeting,
)
from embeddings import (
    EmbeddingError,
    NoContentError,
    delete_meeting_embeddings,
    embed_all,
    embed_meeting,
)
from embeddings import MeetingNotFoundError as EmbedMeetingNotFoundError
from ingest_transcript import IngestError, VexaAPIError, VexaNotFoundError, ingest
from poller import start_scheduler, stop_scheduler
from schemas import (
    ActionItemOut,
    ActionItemUpdate,
    ActionItemWithMeeting,
    AnalyticsOverviewOut,
    AuthResponse,
    CaptureMeetingRequest,
    CaptureMeetingResponse,
    CaptureStatusResponse,
    ChatRequest,
    ChatResponse,
    ChatSourceOut,
    DeleteMeetingResponse,
    EmbedAllEntry,
    EmbedAllResponse,
    EmbedResponse,
    HealthResponse,
    IngestResponse,
    LoginRequest,
    MeetingAnalyticsOut,
    MeetingDetail,
    MeetingListItem,
    MeResponse,
    RegisterRequest,
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

# So poller.py's logger.info/warning calls are actually visible - without
# this, Python's logging module has no configured handler and silently
# drops everything below WARNING.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title="Fireflies Clone API", version="0.1.0", lifespan=lifespan)

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


# Every business endpoint below (meetings, action-items, search, chat,
# analytics, capture) lives on this router instead of directly on `app`,
# so require_auth is enforced in exactly one place rather than repeated on
# every decorator - a new endpoint only has to remember to use `protected`,
# not to remember to add a dependency. /health and /auth/* are the only
# public routes, and they stay directly on `app`, never on this router.
protected = APIRouter(dependencies=[Depends(require_auth)])

COOKIE_NAME = "access_token"
COOKIE_MAX_AGE_SECONDS = 7 * 24 * 3600
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").strip().lower() == "true"
COOKIE_SAMESITE = os.environ.get("COOKIE_SAMESITE", "lax").strip().lower()


@app.get("/health", response_model=HealthResponse)
def health(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Database connection failed.")
    return HealthResponse(status="ok", database="connected")


def _set_session_cookie(response: Response, user_id: int) -> None:
    token = create_access_token(user_id)
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        max_age=COOKIE_MAX_AGE_SECONDS,
        path="/",
    )


@app.post("/auth/register", response_model=AuthResponse)
def register(payload: RegisterRequest, response: Response, db: Session = Depends(get_db)):
    try:
        user = register_user(db, payload.name, payload.email, payload.password)
    except EmailAlreadyRegisteredError as exc:
        raise HTTPException(status_code=409, detail=str(exc))

    _set_session_cookie(response, user.id)
    return AuthResponse(success=True)


@app.post("/auth/login", response_model=AuthResponse)
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)):
    try:
        user = verify_credentials(db, payload.email, payload.password)
    except InvalidCredentialsError as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    except AuthConfigError as exc:
        raise HTTPException(status_code=500, detail=f"Login is misconfigured: {exc}")

    _set_session_cookie(response, user.id)
    return AuthResponse(success=True)


@app.post("/auth/logout", response_model=AuthResponse)
def logout(response: Response):
    response.delete_cookie(key=COOKIE_NAME, path="/")
    return AuthResponse(success=True)


@app.get("/auth/me", response_model=MeResponse)
def me(user: User | None = Depends(get_current_user)):
    return MeResponse(
        authenticated=user is not None,
        id=user.id if user else None,
        name=user.name if user else None,
        email=user.email if user else None,
    )


@protected.get("/meetings", response_model=list[MeetingListItem])
def list_meetings(current_user: User = Depends(require_auth), db: Session = Depends(get_db)):
    meetings = (
        db.query(Meeting)
        .filter_by(user_id=current_user.id)
        .order_by(Meeting.start_time.desc().nullslast())
        .all()
    )

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


@protected.get("/action-items", response_model=list[ActionItemWithMeeting])
def list_action_items(current_user: User = Depends(require_auth), db: Session = Depends(get_db)):
    # One join, not N+1: the Tasks page needs every action item across every
    # meeting plus enough meeting context to link back, in a single request.
    rows = (
        db.query(ActionItem, Meeting)
        .join(Meeting, ActionItem.meeting_id == Meeting.id)
        .filter(Meeting.user_id == current_user.id)
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


@protected.post("/meetings/start", response_model=CaptureMeetingResponse)
def start_meeting_capture(
    payload: CaptureMeetingRequest, current_user: User = Depends(require_auth)
):
    meeting_url = payload.meeting_url.strip()
    if "meet.google.com" not in meeting_url.lower():
        raise HTTPException(
            status_code=422,
            detail="Please paste a Google Meet link (meet.google.com/...) - other platforms aren't supported yet.",
        )

    try:
        result = start_capture(meeting_url, current_user.id)
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


@protected.get("/meetings/{meeting_id}/capture-status", response_model=CaptureStatusResponse)
def get_meeting_capture_status(
    meeting_id: int = Path(..., gt=0),
    current_user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    meeting = db.get(Meeting, meeting_id)
    if meeting is None or meeting.user_id != current_user.id:
        raise HTTPException(status_code=404, detail=f"No meeting with id={meeting_id}.")

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


@protected.patch("/action-items/{action_item_id}", response_model=ActionItemWithMeeting)
def update_action_item(
    payload: ActionItemUpdate,
    action_item_id: int = Path(..., gt=0),
    current_user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    item = db.get(ActionItem, action_item_id)
    if item is None:
        raise HTTPException(status_code=404, detail=f"No action item with id={action_item_id}.")

    meeting = db.get(Meeting, item.meeting_id)
    if meeting is None or meeting.user_id != current_user.id:
        raise HTTPException(status_code=404, detail=f"No action item with id={action_item_id}.")

    item.completed = payload.completed
    db.commit()
    db.refresh(item)

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
    WHERE m.user_id = :user_id
      AND (CAST(:from_date AS date) IS NULL OR m.start_time >= CAST(:from_date AS date))
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
    WHERE m.user_id = :user_id
      AND (CAST(:from_date AS date) IS NULL OR m.start_time >= CAST(:from_date AS date))
      AND (CAST(:to_date AS date) IS NULL OR m.start_time < CAST(:to_date AS date) + INTERVAL '1 day')
    ORDER BY m.start_time DESC NULLS LAST
""")


@protected.get("/search", response_model=list[SearchResult])
def search_meetings(
    q: str = Query(default=""),
    from_date: date | None = Query(default=None),
    to_date: date | None = Query(default=None),
    current_user: User = Depends(require_auth),
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

    params = {"from_date": from_date, "to_date": to_date, "user_id": current_user.id}
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


@protected.get("/meetings/{meeting_id}", response_model=MeetingDetail)
def get_meeting(
    meeting_id: int = Path(..., gt=0),
    current_user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    meeting = db.get(Meeting, meeting_id)
    if meeting is None or meeting.user_id != current_user.id:
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


@protected.delete("/meetings/{meeting_id}", response_model=DeleteMeetingResponse)
def delete_meeting(
    meeting_id: int = Path(..., gt=0),
    current_user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    meeting = db.get(Meeting, meeting_id)
    if meeting is None or meeting.user_id != current_user.id:
        raise HTTPException(status_code=404, detail=f"No meeting with id={meeting_id}.")

    # Vexa first: like Chroma below, it has no DB-level cascade and isn't
    # part of the Postgres transaction, so a failure here aborts before
    # anything is touched and the meeting is safe to just retry deleting.
    # This is the fix for the orphaned-recording bug - previously nothing
    # ever told Vexa a meeting was deleted, so its audio recording (which
    # Vexa retains indefinitely by default) outlived the meeting in our
    # own app. A 404 from Vexa means there's nothing left to clean up
    # there, which is success, not failure (see delete_vexa_recording.py).
    try:
        delete_vexa_meeting(meeting.platform, meeting.native_meeting_id)
    except VexaMeetingStillActiveError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except VexaDeleteError as exc:
        raise HTTPException(
            status_code=502, detail=f"Failed to remove the Vexa-side recording: {exc}"
        )

    # Chroma next: same reasoning as Vexa above - no DB cascade, not part
    # of the Postgres transaction below, so if this fails we abort here
    # and the meeting is left fully intact (safe to just retry the
    # delete). Doing it in the other order risks the opposite failure: the
    # Postgres row already gone but its embeddings still sitting in Chroma
    # with no meeting left to retry the cleanup against - permanently
    # orphaned vectors that could still surface in another /chat answer,
    # exactly what per-user isolation is supposed to prevent.
    try:
        delete_meeting_embeddings(meeting_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to remove embeddings: {exc}")

    # transcript_segments, summaries, and action_items all have their
    # meeting_id FK declared ON DELETE CASCADE (see app/models.py) - the
    # database removes them the moment this row does, in the same
    # transaction as the commit below. No need to delete each separately.
    db.delete(meeting)
    db.commit()

    return DeleteMeetingResponse(success=True, meeting_id=meeting_id)


@protected.post("/meetings/{meeting_id}/ingest", response_model=IngestResponse)
def trigger_ingest(
    meeting_id: int = Path(..., gt=0),
    current_user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    # This endpoint refreshes an already-ingested, already-owned meeting; it
    # does not create brand-new meetings from scratch (out of scope here -
    # no requirement described creating a meeting via this API yet).
    meeting = db.get(Meeting, meeting_id)
    if meeting is None or meeting.user_id != current_user.id:
        raise HTTPException(status_code=404, detail=f"No meeting with id={meeting_id}.")
    platform, native_meeting_id = meeting.platform, meeting.native_meeting_id

    try:
        result = ingest(platform, native_meeting_id, meeting_id=meeting_id)
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


@protected.post("/meetings/{meeting_id}/summarize", response_model=SummarizeResponse)
def trigger_summarize(
    meeting_id: int = Path(..., gt=0),
    current_user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    meeting = db.get(Meeting, meeting_id)
    if meeting is None or meeting.user_id != current_user.id:
        raise HTTPException(status_code=404, detail=f"No meeting with id={meeting_id}.")

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


@protected.post("/meetings/{meeting_id}/embed", response_model=EmbedResponse)
def trigger_embed(
    meeting_id: int = Path(..., gt=0),
    current_user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    meeting = db.get(Meeting, meeting_id)
    if meeting is None or meeting.user_id != current_user.id:
        raise HTTPException(status_code=404, detail=f"No meeting with id={meeting_id}.")

    try:
        count = embed_meeting(meeting_id)
    except EmbedMeetingNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except NoContentError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except EmbeddingError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return EmbedResponse(success=True, meeting_id=meeting_id, chunks_written=count)


@protected.post("/embed-all", response_model=EmbedAllResponse)
def trigger_embed_all(current_user: User = Depends(require_auth)):
    summary = embed_all(current_user.id)
    return EmbedAllResponse(
        success=True,
        embedded=[
            EmbedAllEntry(meeting_id=meeting_id, chunks_written=count)
            for meeting_id, count in summary.embedded
        ],
        already_embedded=summary.already_embedded,
        skipped_no_content=summary.skipped_no_content,
    )


@protected.post("/chat", response_model=ChatResponse)
def chat_endpoint(request: ChatRequest, current_user: User = Depends(require_auth)):
    try:
        result = answer_question(request.question, current_user.id)
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


@protected.get("/meetings/{meeting_id}/analytics", response_model=MeetingAnalyticsOut)
def get_meeting_analytics_endpoint(
    meeting_id: int = Path(..., gt=0), current_user: User = Depends(require_auth)
):
    try:
        result = get_meeting_analytics(meeting_id, current_user.id)
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


@protected.get("/analytics/overview", response_model=AnalyticsOverviewOut)
def get_analytics_overview_endpoint(current_user: User = Depends(require_auth)):
    result = get_analytics_overview(current_user.id)
    return AnalyticsOverviewOut(
        total_meetings=result.total_meetings,
        total_duration_seconds=result.total_duration_seconds,
        top_speaker=(
            TopSpeakerOut(name=result.top_speaker.name, total_minutes=result.top_speaker.total_minutes)
            if result.top_speaker
            else None
        ),
    )


app.include_router(protected)
