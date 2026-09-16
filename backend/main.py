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

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Path, Query, Request, Response
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
    change_password,
    create_access_token,
    get_current_user,
    register_user,
    require_auth,
    update_account,
    verify_credentials,
    verify_password,
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
from meeting_audio import MeetingAudioError, NoRecordingError, get_audio_stream
from poller import start_scheduler, stop_scheduler
from schemas import (
    AccountUpdateRequest,
    AccountUpdateResponse,
    ActionItemCreate,
    ActionItemOut,
    ActionItemUpdate,
    ActionItemWithMeeting,
    AnalyticsOverviewOut,
    AuthResponse,
    CaptureMeetingRequest,
    CaptureMeetingResponse,
    CaptureStatusResponse,
    ChangePasswordRequest,
    ChangePasswordResponse,
    ChapterOut,
    ChatRequest,
    ChatResponse,
    ChatSourceOut,
    DeleteAccountRequest,
    DeleteAccountResponse,
    DeleteActionItemResponse,
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
    MeetingTitleUpdateRequest,
    MeetingTitleUpdateResponse,
    MeResponse,
    RegisterRequest,
    SearchResult,
    SpeakerTalkTimeOut,
    SummarizeResponse,
    SummaryOut,
    TopSpeakerOut,
    TranscriptSegmentOut,
)
from stop_vexa_bot import VexaStopBotAPIError, stop_vexa_bot
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
logger = logging.getLogger("meetscribe.main")


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


def _participants_by_meeting(db: Session, user_id: int) -> dict[int, list[str]]:
    """One aggregated query (not N+1) across every meeting user_id owns:
    every distinct (meeting_id, speaker_label) pair, grouped in Python into
    a per-meeting list. "Unknown Speaker" is not special-cased, consistent
    with analytics.py's talk-time aggregation."""
    rows = (
        db.query(TranscriptSegment.meeting_id, TranscriptSegment.speaker_label)
        .join(Meeting, TranscriptSegment.meeting_id == Meeting.id)
        .filter(Meeting.user_id == user_id)
        .distinct()
        .all()
    )
    by_meeting: dict[int, list[str]] = {}
    for meeting_id, speaker_label in rows:
        by_meeting.setdefault(meeting_id, []).append(speaker_label)
    for labels in by_meeting.values():
        labels.sort()
    return by_meeting


def _meeting_participants(db: Session, meeting_id: int) -> list[str]:
    """Same distinct-speaker-label logic as _participants_by_meeting(), but
    scoped to a single already-owned meeting (GET /meetings/{id}) - a
    targeted one-meeting query here isn't the N+1 pattern that matters for
    GET /meetings' list of many meetings."""
    rows = (
        db.query(TranscriptSegment.speaker_label)
        .filter(TranscriptSegment.meeting_id == meeting_id)
        .distinct()
        .all()
    )
    return sorted(label for (label,) in rows)


@protected.get("/meetings", response_model=list[MeetingListItem])
def list_meetings(current_user: User = Depends(require_auth), db: Session = Depends(get_db)):
    meetings = (
        db.query(Meeting)
        .filter_by(user_id=current_user.id)
        .order_by(Meeting.start_time.desc().nullslast())
        .all()
    )
    participants_by_meeting = _participants_by_meeting(db, current_user.id)

    items = []
    for meeting in meetings:
        summary = db.query(Summary).filter_by(meeting_id=meeting.id).one_or_none()
        preview = summary.overview_text[:100] if summary else None
        items.append(
            MeetingListItem(
                id=meeting.id,
                title=meeting.title,
                platform=meeting.platform,
                native_meeting_id=meeting.native_meeting_id,
                start_time=meeting.start_time,
                end_time=meeting.end_time,
                status=meeting.status,
                overview_preview=preview,
                participants=participants_by_meeting.get(meeting.id, []),
            )
        )
    return items


@protected.get("/meetings/participants", response_model=list[str])
def list_participants(current_user: User = Depends(require_auth), db: Session = Depends(get_db)):
    """Distinct participant names across the current user's own meetings
    ONLY - same per-user privacy boundary as every other endpoint (the join
    filters on Meeting.user_id, never returning another account's speaker
    labels). Powers the /search page's participant filter dropdown.

    Registered before GET /meetings/{meeting_id} below: FastAPI/Starlette
    matches routes in declaration order, and {meeting_id} has no `:int`
    path convertor, so "participants" would otherwise be swallowed by that
    route first and rejected as an invalid int rather than reaching here.
    """
    rows = (
        db.query(TranscriptSegment.speaker_label)
        .join(Meeting, TranscriptSegment.meeting_id == Meeting.id)
        .filter(Meeting.user_id == current_user.id)
        .distinct()
        .all()
    )
    return sorted({label for (label,) in rows})


@protected.patch("/meetings/{meeting_id}", response_model=MeetingTitleUpdateResponse)
def update_meeting_title(
    payload: MeetingTitleUpdateRequest,
    meeting_id: int = Path(..., gt=0),
    current_user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    meeting = db.get(Meeting, meeting_id)
    if meeting is None or meeting.user_id != current_user.id:
        raise HTTPException(status_code=404, detail=f"No meeting with id={meeting_id}.")

    title = payload.title.strip() if payload.title else None
    meeting.title = title or None
    db.commit()
    db.refresh(meeting)

    return MeetingTitleUpdateResponse(success=True, meeting_id=meeting.id, title=meeting.title)


@protected.post("/meetings/{meeting_id}/action-items", response_model=ActionItemOut, status_code=201)
def create_action_item(
    payload: ActionItemCreate,
    meeting_id: int = Path(..., gt=0),
    current_user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Manually adds an action item the AI missed. Goes through the exact
    same ActionItem row/table as AI-generated ones - nothing downstream
    (Tasks page, this meeting's own panel, PATCH/DELETE below) needs to know
    or care which way a given item was created."""
    meeting = db.get(Meeting, meeting_id)
    if meeting is None or meeting.user_id != current_user.id:
        raise HTTPException(status_code=404, detail=f"No meeting with id={meeting_id}.")

    description = payload.description.strip()
    if not description:
        raise HTTPException(status_code=422, detail="description cannot be empty.")
    assignee = payload.assignee_guess.strip() if payload.assignee_guess else ""

    item = ActionItem(
        meeting_id=meeting_id,
        description=description,
        assignee_guess=assignee or "Unassigned",
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    return ActionItemOut(
        id=item.id,
        description=item.description,
        assignee_guess=item.assignee_guess,
        completed=item.completed,
    )


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
            meeting_title=meeting.title,
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


@protected.post("/meetings/{meeting_id}/stop-recording", response_model=CaptureStatusResponse)
def stop_meeting_recording(
    meeting_id: int = Path(..., gt=0),
    current_user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """The "End Recording" button: end the bot's participation right now
    rather than waiting on Vexa's own silence-based detection or the next
    background poll cycle (backend/poller.py, unchanged - this is an
    additional, faster, explicit path alongside it, not a replacement).

    Stops the bot first, then immediately reuses get_capture_status() - the
    same ingest-then-summarize-on-completion logic the poller and the
    frontend's status polling already rely on - so the transcript and
    summary are ready by the time this call returns instead of waiting for
    the next poll.
    """
    meeting = db.get(Meeting, meeting_id)
    if meeting is None or meeting.user_id != current_user.id:
        raise HTTPException(status_code=404, detail=f"No meeting with id={meeting_id}.")

    # A 404 here means Vexa already has no active bot for this meeting -
    # e.g. it independently completed between page load and this click -
    # which is exactly the outcome this call wants, so stop_vexa_bot()
    # already treats that as success. Proceed to the completion logic
    # below either way, rather than requiring the bot to still be active.
    try:
        stop_vexa_bot(meeting.platform, meeting.native_meeting_id)
    except VexaStopBotAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

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

    # exclude_unset, not just "is not None": completed is a plain bool once
    # set, so a request that only wants to rename an item must be able to
    # omit it entirely without that being mistaken for "set completed to
    # None" - same reasoning for the other two fields.
    updates = payload.model_dump(exclude_unset=True)
    if updates.get("completed") is not None:
        item.completed = updates["completed"]
    if "description" in updates:
        description = (updates["description"] or "").strip()
        if not description:
            raise HTTPException(status_code=422, detail="description cannot be empty.")
        item.description = description
    if "assignee_guess" in updates:
        assignee = (updates["assignee_guess"] or "").strip()
        item.assignee_guess = assignee or "Unassigned"

    db.commit()
    db.refresh(item)

    return ActionItemWithMeeting(
        id=item.id,
        description=item.description,
        assignee_guess=item.assignee_guess,
        generated_at=item.generated_at,
        completed=item.completed,
        meeting_id=meeting.id,
        meeting_title=meeting.title,
        platform=meeting.platform,
        native_meeting_id=meeting.native_meeting_id,
        meeting_start_time=meeting.start_time,
    )


@protected.delete("/action-items/{action_item_id}", response_model=DeleteActionItemResponse)
def delete_action_item(
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

    db.delete(item)
    db.commit()

    return DeleteActionItemResponse(success=True, action_item_id=action_item_id)


# Full-text search across, for each meeting: its title, summary overview,
# key points, decisions, and every transcript segment. Computed live per
# request (no tsvector column/GIN index) since the dataset is small - see
# the final report for when that would be worth adding.
#
# Each field is unioned into a common (meeting_id, field, content) shape,
# ranked with ts_rank_cd, then reduced to one row per meeting (DISTINCT ON)
# so results are grouped by meeting rather than one row per matching
# segment. A title match's rank is boosted (x4) over every other field - a
# deliberately chosen title is the most explicit match signal there is, so
# it should outrank a same-scoring transcript/summary hit, not just win a
# tie. Ties (common for short, similarly-sized fields under ts_rank_cd's
# default, non-length-normalized scoring) are broken toward title, then
# curated summary content, over raw transcript utterances.
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

        UNION ALL

        SELECT tm.id AS meeting_id, 'title' AS field, tm.title AS content
        FROM meetings tm
        WHERE tm.title IS NOT NULL AND tm.title <> ''
    ),
    query AS (
        SELECT websearch_to_tsquery('english', :q) AS tsq
    ),
    ranked AS (
        SELECT
            c.meeting_id,
            c.field,
            ts_rank_cd(to_tsvector('english', c.content), q.tsq)
                * CASE c.field WHEN 'title' THEN 4.0 ELSE 1.0 END AS rank,
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
                WHEN 'title' THEN 0
                WHEN 'decision' THEN 1
                WHEN 'key_point' THEN 2
                WHEN 'summary' THEN 3
                WHEN 'transcript' THEN 4
            END
    )
    SELECT
        m.id AS meeting_id,
        m.title,
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
      AND (CAST(:participant AS text) IS NULL OR EXISTS (
          SELECT 1 FROM transcript_segments pts
          WHERE pts.meeting_id = m.id AND pts.speaker_label = CAST(:participant AS text)
      ))
    ORDER BY b.rank DESC
""")

# No keyword: same response shape as a keyword match (so the frontend can
# share result-rendering plumbing), but sorted chronologically instead of by
# relevance, with the summary's overview (truncated the same way /meetings
# already does for overview_preview) as the snippet and matched_field left
# null - the frontend uses that null to render these with the plain
# MeetingCard instead of a highlighted-snippet card, since there's no
# keyword match to highlight. Still supports date and/or participant
# filtering (AND-combined) so "just filter by participant, no keyword" -
# the participant-only case the frontend's filter dropdown supports - has
# somewhere to go besides an empty result.
BROWSE_SQL = text("""
    SELECT
        m.id AS meeting_id,
        m.title,
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
      AND (CAST(:participant AS text) IS NULL OR EXISTS (
          SELECT 1 FROM transcript_segments pts
          WHERE pts.meeting_id = m.id AND pts.speaker_label = CAST(:participant AS text)
      ))
    ORDER BY m.start_time DESC NULLS LAST
""")


@protected.get("/search", response_model=list[SearchResult])
def search_meetings(
    q: str = Query(default=""),
    from_date: date | None = Query(default=None),
    to_date: date | None = Query(default=None),
    participant: str | None = Query(default=None),
    current_user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    if from_date is not None and to_date is not None and from_date > to_date:
        raise HTTPException(
            status_code=400,
            detail="from_date must not be after to_date.",
        )

    query = q.strip()
    participant_filter = participant.strip() if participant else None
    has_keyword = len(query) >= 2
    has_date_filter = from_date is not None or to_date is not None
    has_participant_filter = bool(participant_filter)

    if not has_keyword and not has_date_filter and not has_participant_filter:
        return []

    params = {
        "from_date": from_date,
        "to_date": to_date,
        "user_id": current_user.id,
        "participant": participant_filter,
    }
    if has_keyword:
        rows = db.execute(SEARCH_SQL, {**params, "q": query}).mappings().all()
    else:
        rows = db.execute(BROWSE_SQL, params).mappings().all()

    return [
        SearchResult(
            meeting_id=row["meeting_id"],
            title=row["title"],
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
    action_items = (
        db.query(ActionItem)
        .filter_by(meeting_id=meeting_id)
        .order_by(ActionItem.generated_at)
        .all()
    )

    return MeetingDetail(
        id=meeting.id,
        title=meeting.title,
        platform=meeting.platform,
        native_meeting_id=meeting.native_meeting_id,
        vexa_meeting_id=meeting.vexa_meeting_id,
        start_time=meeting.start_time,
        end_time=meeting.end_time,
        status=meeting.status,
        participants=_meeting_participants(db, meeting_id),
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
                chapters=[ChapterOut(**c) for c in (summary.chapters or [])],
            )
            if summary
            else None
        ),
        action_items=[
            ActionItemOut(
                id=item.id,
                description=item.description,
                assignee_guess=item.assignee_guess,
                completed=item.completed,
            )
            for item in action_items
        ],
    )


@protected.get("/meetings/{meeting_id}/audio")
def get_meeting_audio(
    request: Request,
    meeting_id: int = Path(..., gt=0),
    current_user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Proxy a meeting's recorded audio from Vexa - the browser only ever
    talks to us, never to Vexa's API/key directly. Forwards the browser's
    own Range header through to Vexa's Range-aware endpoint (see
    meeting_audio.py) and relays back whatever status/headers Vexa answers
    with (200 or 206 Partial Content), so seeking fetches only the
    requested byte slice instead of the whole recording.
    """
    meeting = db.get(Meeting, meeting_id)
    if meeting is None or meeting.user_id != current_user.id:
        raise HTTPException(status_code=404, detail=f"No meeting with id={meeting_id}.")
    if meeting.vexa_meeting_id is None:
        raise HTTPException(status_code=404, detail="No audio available for this meeting.")

    try:
        stream = get_audio_stream(meeting.vexa_meeting_id, request.headers.get("range"))
    except NoRecordingError:
        raise HTTPException(status_code=404, detail="No audio available for this meeting.")
    except MeetingAudioError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    return Response(
        content=stream.content,
        status_code=stream.status_code,
        media_type=stream.content_type,
        headers={"Accept-Ranges": "bytes", **stream.headers},
    )


class _ChromaCleanupError(Exception):
    """Wraps whatever delete_meeting_embeddings() raised, so callers of
    _delete_meeting_fully() can tell a Chroma failure apart from an
    unrelated error (e.g. the final Postgres commit) without the two being
    mislabeled as each other."""


def _find_other_local_reference(db: Session, meeting: Meeting) -> Meeting | None:
    """Another Meeting row (any user) that still points at the same Vexa
    recording as `meeting` - i.e. shares its (platform, native_meeting_id).
    See the incident note in _delete_meeting_fully() for why this matters."""
    return (
        db.query(Meeting)
        .filter(
            Meeting.platform == meeting.platform,
            Meeting.native_meeting_id == meeting.native_meeting_id,
            Meeting.id != meeting.id,
        )
        .first()
    )


def _delete_meeting_fully(db: Session, meeting: Meeting) -> None:
    """The actual cross-system cleanup for one meeting - Vexa's recording,
    then Chroma's embeddings, then the Postgres row itself. Shared by the
    single-meeting DELETE endpoint below and by account deletion (Part B),
    which calls this once per meeting the account owns rather than
    reimplementing any of it.

    Raises the same VexaMeetingStillActiveError / VexaDeleteError / a plain
    Exception (from Chroma) that delete_meeting() already handled inline -
    left un-mapped to HTTP here so each caller can decide its own response
    (a single meeting delete vs. one step of a whole-account delete).
    """
    # Vexa first: like Chroma below, it has no DB-level cascade and isn't
    # part of the Postgres transaction, so a failure here aborts before
    # anything is touched and the meeting is safe to just retry deleting.
    # This is the fix for the orphaned-recording bug - previously nothing
    # ever told Vexa a meeting was deleted, so its audio recording (which
    # Vexa retains indefinitely by default) outlived the meeting in our
    # own app. A 404 from Vexa means there's nothing left to clean up
    # there, which is success, not failure (see delete_vexa_recording.py).
    #
    # INCIDENT (2026-09-15): Vexa's DELETE /meetings/{platform}/{native_id}
    # is keyed by the native meeting code alone - Vexa has no concept of our
    # app's users, so it deletes that recording GLOBALLY, even if other rows
    # in our own meetings table (under a different user_id) still point at
    # the exact same (platform, native_meeting_id). This is not hypothetical:
    # our own QA process deliberately mirrors a real meeting's
    # native_meeting_id onto a disposable test account to exercise real audio
    # playback, and deleting that disposable account cascaded a real Vexa
    # delete that destroyed two real users' recordings (meetings id=2 and
    # id=18) even though those meetings were never touched locally. Before
    # ever calling Vexa's delete-by-native-key, we MUST confirm no other
    # local row still depends on that same recording - if one does, this
    # call is skipped and only our own local data for `meeting` is removed.
    # Do not remove this check.
    other = _find_other_local_reference(db, meeting)
    if other is not None:
        logger.info(
            "Skipping Vexa-side delete for %s/%s: meeting id=%d still references "
            "it - removing only meeting id=%d's local data.",
            meeting.platform,
            meeting.native_meeting_id,
            other.id,
            meeting.id,
        )
    else:
        delete_vexa_meeting(meeting.platform, meeting.native_meeting_id)

    # Chroma next: same reasoning as Vexa above - no DB cascade, not part
    # of the Postgres transaction below, so if this fails we abort here
    # and the meeting is left fully intact (safe to just retry the
    # delete). Doing it in the other order risks the opposite failure: the
    # Postgres row already gone but its embeddings still sitting in Chroma
    # with no meeting left to retry the cleanup against - permanently
    # orphaned vectors that could still surface in another /chat answer,
    # exactly what per-user isolation is supposed to prevent.
    try:
        delete_meeting_embeddings(meeting.id)
    except Exception as exc:
        raise _ChromaCleanupError(str(exc)) from exc

    # transcript_segments, summaries, and action_items all have their
    # meeting_id FK declared ON DELETE CASCADE (see app/models.py) - the
    # database removes them the moment this row does, in the same
    # transaction as the commit below. No need to delete each separately.
    db.delete(meeting)
    db.commit()


@protected.delete("/meetings/{meeting_id}", response_model=DeleteMeetingResponse)
def delete_meeting(
    meeting_id: int = Path(..., gt=0),
    current_user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    meeting = db.get(Meeting, meeting_id)
    if meeting is None or meeting.user_id != current_user.id:
        raise HTTPException(status_code=404, detail=f"No meeting with id={meeting_id}.")

    try:
        _delete_meeting_fully(db, meeting)
    except VexaMeetingStillActiveError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except VexaDeleteError as exc:
        raise HTTPException(
            status_code=502, detail=f"Failed to remove the Vexa-side recording: {exc}"
        )
    except _ChromaCleanupError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to remove embeddings: {exc}")

    return DeleteMeetingResponse(success=True, meeting_id=meeting_id)


@protected.patch("/settings/account", response_model=AccountUpdateResponse)
def update_account_settings(
    payload: AccountUpdateRequest,
    current_user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Name/email only - no password required, unlike change-password and
    delete-account below, which both deliberately re-verify identity."""
    try:
        user = update_account(db, current_user, payload.name, payload.email)
    except EmailAlreadyRegisteredError as exc:
        raise HTTPException(status_code=409, detail=str(exc))

    return AccountUpdateResponse(success=True, id=user.id, name=user.name, email=user.email)


@protected.post("/settings/change-password", response_model=ChangePasswordResponse)
def change_password_settings(
    payload: ChangePasswordRequest,
    current_user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    try:
        change_password(db, current_user, payload.current_password, payload.new_password)
    except InvalidCredentialsError as exc:
        raise HTTPException(status_code=401, detail=str(exc))

    return ChangePasswordResponse(success=True)


@protected.post("/settings/delete-account", response_model=DeleteAccountResponse)
def delete_account(
    payload: DeleteAccountRequest,
    response: Response,
    current_user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Irreversible: re-verifies the current password (not just the active
    session - same reasoning as change-password) before touching anything,
    then cleans up every meeting this account owns via the same
    _delete_meeting_fully() the single-meeting DELETE endpoint uses (Vexa
    recording, Chroma embeddings, Postgres row - nothing reimplemented
    here), and only removes the user row itself once all of them are gone.
    """
    if not verify_password(current_user, payload.password):
        raise HTTPException(status_code=401, detail="Current password is incorrect.")

    meetings = db.query(Meeting).filter_by(user_id=current_user.id).all()
    for meeting in meetings:
        try:
            _delete_meeting_fully(db, meeting)
        except VexaMeetingStillActiveError as exc:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Meeting id={meeting.id} is still being recorded - stop it "
                    f"before deleting your account. ({exc})"
                ),
            )
        except VexaDeleteError as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to remove the Vexa-side recording for meeting id={meeting.id}: {exc}",
            )
        except _ChromaCleanupError as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to remove embeddings for meeting id={meeting.id}: {exc}",
            )

    db.delete(current_user)
    db.commit()

    response.delete_cookie(key=COOKIE_NAME, path="/")
    return DeleteAccountResponse(success=True)


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

    # summarize() returns the LLM's raw parsed dicts (no db id yet - it ran
    # against its own separate session). save_summary() inside it deletes and
    # recreates every ActionItem row for this meeting each time, so
    # re-querying here gets exactly the freshly-created rows, now with real
    # ids - needed since ActionItemOut carries id/completed for the frontend.
    fresh_items = (
        db.query(ActionItem)
        .filter_by(meeting_id=meeting_id)
        .order_by(ActionItem.generated_at)
        .all()
    )

    return SummarizeResponse(
        success=True,
        meeting_id=result.meeting_id,
        overview=result.overview,
        key_points=result.key_points,
        decisions=result.decisions,
        action_items=[
            ActionItemOut(
                id=item.id,
                description=item.description,
                assignee_guess=item.assignee_guess,
                completed=item.completed,
            )
            for item in fresh_items
        ],
        chapters=[ChapterOut(**c) for c in result.chapters],
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
def chat_endpoint(
    request: ChatRequest,
    current_user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
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

    # Titles aren't stored in Chroma's chunk metadata (that's frozen at
    # embed time, and a rename shouldn't require re-embedding to show up
    # here) - one batched lookup for every source meeting instead, not one
    # query per source.
    source_meeting_ids = {source.meeting_id for source in result.sources}
    titles_by_meeting: dict[int, str | None] = dict(
        db.query(Meeting.id, Meeting.title).filter(Meeting.id.in_(source_meeting_ids)).all()
    )

    return ChatResponse(
        answer=result.answer,
        sources=[
            ChatSourceOut(
                meeting_id=source.meeting_id,
                meeting_title=titles_by_meeting.get(source.meeting_id),
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
