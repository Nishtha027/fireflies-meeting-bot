"""
Backend background job: periodically checks every in-progress meeting
created through the tracked Capture Meeting flow (POST /meetings/start,
i.e. meetings.user_id IS NOT NULL) against Vexa's real status, so
ingestion and summarization happen the moment a meeting actually
completes - regardless of whether any frontend tab is open.

This exists because the frontend's CaptureMeetingModal used to be the
ONLY thing driving this: it polled GET /meetings/{id}/capture-status on a
setInterval, but that interval dies the instant the modal (or its tab)
closes, permanently stranding any meeting that outlives it. This module
moves that responsibility into the backend process itself.

Runs via APScheduler's BackgroundScheduler (its own background thread,
its own thread pool) rather than Celery/Redis or an asyncio-native
scheduler: get_capture_status() and everything it calls (ingest,
summarize, httpx, SQLAlchemy) are all synchronous/blocking, and this app
is a single process with no distributed workers, so a lightweight
in-process scheduler is the simplest fit - no extra infrastructure to
run or fail independently of the app itself. (If this app is ever run
with multiple uvicorn workers, each worker would start its own copy of
this scheduler; that's not the case today, and ingest()/summarize() are
already idempotent, so even then no duplicate data would result - just
some redundant work.)

Deliberately reuses capture_meeting.get_capture_status() as-is - the same
function already proven correct when called manually - rather than
re-implementing its ingest+summarize-on-completion logic here.
"""

import logging

from apscheduler.schedulers.background import BackgroundScheduler

from app.database import SessionLocal
from app.models import Meeting
from capture_meeting import CaptureError, get_capture_status

logger = logging.getLogger("meetscribe.poller")

# 45s: frequent enough that ending a call resolves within well under a
# minute with zero user action, without hammering Vexa's API with a
# request per tracked in-progress meeting many times a minute. Vexa is
# only ever checked for meetings that are actually still in progress, so
# this cost scales with concurrent captures, not with total meeting count.
POLL_INTERVAL_SECONDS = 45

# Matches the frontend's TERMINAL_STATUSES (CaptureMeetingModal.tsx) -
# once a meeting reaches one of these, this job stops checking it.
TERMINAL_STATUSES = ("completed", "failed")

scheduler = BackgroundScheduler()


def poll_in_progress_meetings() -> None:
    """One run of the background poll. Never raises: a DB hiccup or Vexa
    being unreachable is logged and skipped, and the scheduler keeps
    running on its normal interval regardless - a failed cycle just means
    "try again in POLL_INTERVAL_SECONDS," not "stop checking forever."""
    try:
        session = SessionLocal()
        try:
            meeting_ids = [
                m.id
                for m in session.query(Meeting.id)
                .filter(Meeting.user_id.isnot(None))
                .filter(Meeting.status.notin_(TERMINAL_STATUSES))
                .all()
            ]
        finally:
            session.close()
    except Exception:
        logger.exception("Background poll: failed to load in-progress meetings - skipping this cycle.")
        return

    logger.info("Background poll: checking %d in-progress meeting(s).", len(meeting_ids))

    for meeting_id in meeting_ids:
        try:
            result = get_capture_status(meeting_id)
        except CaptureError as exc:
            # Covers Vexa being unreachable (Docker restarted, network
            # blip, etc.) as well as any other capture-status failure -
            # logged clearly, this meeting is simply retried next cycle.
            logger.warning(
                "Background poll: meeting_id=%s check failed (%s) - will retry next cycle.",
                meeting_id,
                exc,
            )
            continue
        except Exception:
            logger.exception(
                "Background poll: unexpected error checking meeting_id=%s - will retry next cycle.",
                meeting_id,
            )
            continue

        if result.status == "completed":
            logger.info(
                "Background poll: meeting_id=%s completed - %d segment(s) ingested, summarized=%s%s",
                meeting_id,
                result.segments_saved,
                result.summarized,
                f" (summarize error: {result.summarize_error})" if result.summarize_error else "",
            )


def start_scheduler() -> None:
    scheduler.add_job(
        poll_in_progress_meetings,
        trigger="interval",
        seconds=POLL_INTERVAL_SECONDS,
        id="poll_in_progress_meetings",
        replace_existing=True,
        # A single run at a time, and if the process was busy/asleep long
        # enough to miss more than one tick, catch up with exactly one run
        # rather than firing several back-to-back.
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()
    logger.info("Background poller started (checking every %ds).", POLL_INTERVAL_SECONDS)


def stop_scheduler() -> None:
    scheduler.shutdown(wait=False)
