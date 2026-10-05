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

In production this app runs as multiple uvicorn worker processes
(--workers N), each an independent OS process that re-imports this module
and re-runs the FastAPI lifespan - so without a guard, N workers would
mean N copies of this scheduler all polling Vexa and the DB on the same
interval. start_scheduler() guards against that with a singleton lock
(see _try_acquire_singleton_lock): an OS-level exclusive lock on a fixed
file, so only the first worker to grab it actually starts the scheduler -
the rest see it already held and skip it. (An earlier version of this
lock used a fixed localhost TCP port as the mutex instead of a file; that
was dropped after live testing on this machine found the chosen port
reliably failed to bind - even with nothing else in Task Manager using it
- almost certainly a Hyper-V/WSL2 NAT port reservation, which made every
worker lose the race. A file lock has no such port-collision risk.) The OS
releases the lock automatically if the owning process dies or is killed,
so a crashed/restarted worker can't leave the poller permanently stuck
off.
"""

import logging
import sys
import tempfile
from pathlib import Path
from typing import IO

if sys.platform == "win32":
    import msvcrt
else:
    import fcntl

from apscheduler.schedulers.background import BackgroundScheduler

from app.database import SessionLocal
from app.models import Meeting
from capture_meeting import CaptureError, get_capture_status

logger = logging.getLogger("meetscribe.poller")

# A fixed path in the OS temp dir, used purely as a cross-process mutex -
# its content is irrelevant, only whether a process holds an exclusive
# lock on it. See _try_acquire_singleton_lock.
_LOCK_PATH = Path(tempfile.gettempdir()) / "meetscribe-poller.lock"
_lock_file: IO[str] | None = None

# 25s (tightened from 45s): still frequent enough that ending a call
# resolves fast with zero user action, without hammering Vexa's API - each
# tick is one GET /transcripts/{platform}/{native_meeting_id} per tracked
# in-progress meeting (Vexa is only ever checked for meetings that are
# actually still in progress, so this cost scales with concurrent captures,
# not with total meeting count), nowhere near Vexa's gateway rate limits
# (GATEWAY_RATE_LIMIT_RPS defaults to 40/s) for the realistic handful of
# concurrent captures a self-hosted single-user deployment runs.
POLL_INTERVAL_SECONDS = 25

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
                # platform="upload" meetings are never Vexa-backed - they
                # have no bot, no native_meeting_id Vexa has ever heard of,
                # and their own FastAPI BackgroundTask (upload_meeting.py)
                # already drives them to "completed"/"failed" directly.
                # Checking them here would just be a guaranteed-404 round
                # trip to Vexa's API, repeated every cycle for as long as a
                # transcription is running.
                .filter(Meeting.platform != "upload")
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


def _try_acquire_singleton_lock() -> bool:
    """Takes an OS-level exclusive, non-blocking lock on a fixed file.
    Returns True if this process won it (and should run the scheduler),
    False if another worker process already holds it. The open file handle
    is kept in _lock_file for the life of the process - closing it would
    release the lock and let another worker "steal" it while this one is
    still running the scheduler."""
    global _lock_file
    f = open(_LOCK_PATH, "a+")
    try:
        f.seek(0)
        if sys.platform == "win32":
            msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        f.close()
        return False
    _lock_file = f
    return True


def start_scheduler() -> None:
    if not _try_acquire_singleton_lock():
        logger.info(
            "Background poller not started in this worker process - another "
            "worker process already owns it (singleton lock on %s held "
            "elsewhere). This is expected under multiple uvicorn workers.",
            _LOCK_PATH,
        )
        return

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
    global _lock_file
    if _lock_file is None:
        # This worker never won the singleton lock, so it never started
        # the scheduler - nothing to shut down.
        return
    scheduler.shutdown(wait=False)
    try:
        _lock_file.seek(0)
        if sys.platform == "win32":
            msvcrt.locking(_lock_file.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            fcntl.flock(_lock_file.fileno(), fcntl.LOCK_UN)
    finally:
        _lock_file.close()
        _lock_file = None
