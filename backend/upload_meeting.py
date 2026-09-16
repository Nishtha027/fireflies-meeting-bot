"""
Transcribe an uploaded audio/video recording via our self-hosted
faster-whisper service (vexa/deploy/transcription) and summarize it -
joining the same Meetings/Home/Search/Chat/Analytics/Tasks ecosystem as
every other meeting type, under platform="upload".

Confirmed (see Part A of the feature's own investigation): the
transcription container already exposes a generic, OpenAI-Whisper-API-
compatible endpoint (POST /v1/audio/transcriptions) that works on an
arbitrary file, completely independent of a live Vexa bot session - no
new infrastructure needed, just calling it directly.

Unlike live Capture Meeting (bot join, polled over minutes) and manual
(pasted transcript, instant), this has a real one-shot processing step -
optionally extracting audio from video via ffmpeg, then a possibly-slow
HTTP call to the transcription service - so POST /meetings/upload
(main.py) creates the Meeting row and returns immediately
(status="processing"), and process_uploaded_file() below runs afterward as
a FastAPI BackgroundTask, calling the existing summarize_meeting.summarize()
rather than duplicating it.

No diarization: the transcription response has no speaker attribution, so
every segment gets the same UPLOAD_SPEAKER_LABEL - the same "simpler for
now, no new dependency" reasoning already applied elsewhere in this app.
"""

import os
import subprocess
import tempfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import httpx
from dotenv import load_dotenv
from fastapi import UploadFile

from app.database import SessionLocal
from app.models import Meeting, TranscriptSegment
from summarize_meeting import (
    GroqAPIError,
    GroqAuthError,
    GroqConfigError,
    GroqRateLimitError,
    NoTranscriptError,
    SummarizeError,
    TranscriptTooLongError,
    summarize,
)

load_dotenv()


class UploadMeetingError(Exception):
    """Base class for errors this module raises - callers decide how to present them."""


class UnsupportedFileTypeError(UploadMeetingError):
    pass


class FileTooLargeError(UploadMeetingError):
    pass


class UploadConfigError(UploadMeetingError):
    """TRANSCRIPTION_SERVICE_URL/TOKEN not set, or ffmpeg not on PATH."""


AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".ogg"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm"}
ALLOWED_EXTENSIONS = AUDIO_EXTENSIONS | VIDEO_EXTENSIONS

# 1 GiB: generous enough for a full meeting recording (audio-only files are
# tiny at this size - hours of compressed speech; a moderate-length video
# fits too, since only its extracted audio track is ever sent onward to the
# transcription service) while still bounding disk usage on a personal dev
# machine, not a hosted multi-tenant service with per-account storage
# budgets to worry about.
MAX_UPLOAD_SIZE_BYTES = 1024 * 1024 * 1024
_UPLOAD_CHUNK_SIZE = 1024 * 1024

# Single label for every segment - no diarization (see module docstring).
# Plain and honest rather than implying an identity we don't have.
UPLOAD_SPEAKER_LABEL = "Speaker"


def validate_extension(filename: str) -> str:
    """Returns the lowercased extension (e.g. ".mp4") if it's one we
    support. Raises UnsupportedFileTypeError otherwise. Pure/cheap - call
    this before touching the request body at all."""
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        allowed = ", ".join(sorted(ALLOWED_EXTENSIONS))
        raise UnsupportedFileTypeError(
            f"Unsupported file type {ext or '(none)'!r}. Allowed: {allowed}."
        )
    return ext


async def save_upload_to_temp(file: UploadFile, ext: str) -> tuple[str, int]:
    """Streams the upload to a temp file in 1 MiB chunks - never buffers
    the whole file in memory, and aborts (partial file removed) the moment
    MAX_UPLOAD_SIZE_BYTES is exceeded rather than after receiving all of a
    huge file. Returns (temp_path, total_bytes)."""
    fd, path = tempfile.mkstemp(suffix=ext)
    total = 0
    try:
        with os.fdopen(fd, "wb") as out:
            while True:
                chunk = await file.read(_UPLOAD_CHUNK_SIZE)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_UPLOAD_SIZE_BYTES:
                    raise FileTooLargeError(
                        f"File exceeds the {MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)} MB limit."
                    )
                out.write(chunk)
    except Exception:
        if os.path.exists(path):
            os.remove(path)
        raise
    return path, total


@dataclass
class UploadCreateResult:
    meeting_id: int


def create_upload_meeting(user_id: int, filename: str) -> UploadCreateResult:
    """Creates the Meeting row immediately (status="processing") so
    POST /meetings/upload can return a meeting_id right away - the actual
    transcription happens afterward in process_uploaded_file(). Title
    defaults to the filename (extension stripped) - overridable afterward
    via the existing PATCH /meetings/{id}, same as every other meeting."""
    title = Path(filename).stem.strip() or None

    session = SessionLocal()
    try:
        meeting = Meeting(
            user_id=user_id,
            platform="upload",
            native_meeting_id=f"upload-{uuid4()}",
            title=title,
            status="processing",
        )
        session.add(meeting)
        session.commit()
        session.refresh(meeting)
        meeting_id = meeting.id
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

    return UploadCreateResult(meeting_id=meeting_id)


def _ffmpeg_executable() -> str:
    return os.environ.get("FFMPEG_PATH", "ffmpeg")


def _extract_audio(video_path: str) -> str:
    """Extracts the audio track from a video file into a temp 16kHz mono
    .wav - what faster-whisper wants anyway, and far smaller than shipping
    the original video onward. Raises UploadConfigError if ffmpeg itself
    isn't available, or UploadMeetingError with ffmpeg's own stderr for a
    corrupt/unreadable file."""
    fd, audio_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        result = subprocess.run(
            [
                _ffmpeg_executable(),
                "-y",
                "-i", video_path,
                "-vn",
                "-ac", "1",
                "-ar", "16000",
                audio_path,
            ],
            capture_output=True,
            text=True,
            timeout=600,
        )
    except FileNotFoundError as exc:
        os.remove(audio_path)
        raise UploadConfigError(f"ffmpeg is not installed/on PATH: {exc}") from exc
    except subprocess.TimeoutExpired as exc:
        os.remove(audio_path)
        raise UploadMeetingError("Audio extraction timed out after 10 minutes.") from exc

    if result.returncode != 0:
        os.remove(audio_path)
        raise UploadMeetingError(f"ffmpeg failed to extract audio: {result.stderr[-2000:]}")

    return audio_path


@dataclass
class TranscribeResult:
    text: str
    duration_seconds: float
    segments: list[tuple[float, float, str]]  # (start_seconds, end_seconds, text)


def _transcribe(audio_path: str) -> TranscribeResult:
    """Calls the self-hosted transcription service's OpenAI-Whisper-API-
    compatible endpoint directly - confirmed in Part A to work standalone,
    independent of any Vexa bot session."""
    try:
        base_url = os.environ["TRANSCRIPTION_SERVICE_URL"]
        token = os.environ["TRANSCRIPTION_SERVICE_TOKEN"]
    except KeyError as exc:
        raise UploadConfigError(
            f"{exc.args[0]} is not set - check backend/.env."
        ) from exc

    try:
        with open(audio_path, "rb") as f:
            response = httpx.post(
                f"{base_url}/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {token}"},
                files={"file": (os.path.basename(audio_path), f, "audio/wav")},
                data={"model": "whisper-1", "response_format": "verbose_json"},
                # Real transcription can take minutes for a long recording -
                # far past this app's usual short API-call timeouts.
                timeout=900.0,
            )
    except httpx.RequestError as exc:
        raise UploadMeetingError(
            f"could not reach the transcription service at {base_url}: {exc}"
        ) from exc

    if response.status_code in (429, 503):
        raise UploadMeetingError(
            f"Transcription service is overloaded (HTTP {response.status_code}) - try again shortly."
        )
    if response.status_code != 200:
        raise UploadMeetingError(
            f"Transcription service returned {response.status_code}: {response.text[:500]}"
        )

    data = response.json()
    segments = [
        (float(s["start"]), float(s["end"]), s["text"].strip())
        for s in data.get("segments", [])
        if s.get("text", "").strip()
    ]
    return TranscribeResult(
        text=(data.get("text") or "").strip(),
        duration_seconds=float(data.get("duration") or 0.0),
        segments=segments,
    )


def _mark_failed(meeting_id: int, error_message: str) -> None:
    session = SessionLocal()
    try:
        meeting = session.get(Meeting, meeting_id)
        if meeting is not None:
            meeting.status = "failed"
            meeting.processing_error = error_message[:4000]
            session.commit()
    finally:
        session.close()


def process_uploaded_file(meeting_id: int, tmp_path: str, ext: str) -> None:
    """The background work for one uploaded file: extraction (video only),
    transcription, saving segments with REAL timestamps (this is genuine
    audio duration/timing data, unlike pasted/manual meetings' synthetic
    per-line stamps), summarizing. Always cleans up every temp file it
    touched. Never raises - failure is recorded on the meeting row itself
    (status="failed" + processing_error) since this runs detached from any
    request/response cycle that could otherwise surface an exception."""
    audio_path = tmp_path
    extracted_path: str | None = None
    try:
        if ext in VIDEO_EXTENSIONS:
            extracted_path = _extract_audio(tmp_path)
            audio_path = extracted_path

        result = _transcribe(audio_path)
        if not result.segments and not result.text:
            raise UploadMeetingError(
                "Transcription returned no speech - the file may be silent or unreadable."
            )

        # start_time = now (upload/processing time), not a guess at when the
        # original recording actually happened - we have no other signal for
        # that. end_time is start_time + the audio's REAL measured duration,
        # so this meeting gets a genuine duration badge and (unlike
        # platform="manual") is correctly eligible for aggregate analytics.
        start_time = datetime.now(timezone.utc)
        end_time = start_time + timedelta(seconds=result.duration_seconds)
        start_epoch = start_time.timestamp()

        session = SessionLocal()
        try:
            meeting = session.get(Meeting, meeting_id)
            if meeting is None:
                return  # deleted mid-processing - nothing left to update

            segments_to_save = result.segments or [(0.0, result.duration_seconds, result.text)]
            for i, (seg_start, seg_end, seg_text) in enumerate(segments_to_save):
                session.add(
                    TranscriptSegment(
                        meeting_id=meeting_id,
                        segment_id=f"upload-{i}",
                        speaker_label=UPLOAD_SPEAKER_LABEL,
                        text=seg_text,
                        start_timestamp=start_epoch + seg_start,
                        end_timestamp=start_epoch + seg_end,
                    )
                )
            meeting.start_time = start_time
            meeting.end_time = end_time
            meeting.status = "completed"
            meeting.processing_error = None
            session.commit()
        finally:
            session.close()

        try:
            summarize(meeting_id)
        except (
            NoTranscriptError,
            TranscriptTooLongError,
            GroqConfigError,
            GroqAuthError,
            GroqRateLimitError,
            GroqAPIError,
            SummarizeError,
        ):
            # The transcript itself is real and already saved - a failed
            # summary is retryable from the meeting page ("Generate
            # Summary"), same as every other meeting type, so it doesn't
            # flip this upload to status="failed".
            pass

    except UploadMeetingError as exc:
        _mark_failed(meeting_id, str(exc))
    except Exception as exc:  # noqa: BLE001 - last-resort safety net, see docstring
        _mark_failed(meeting_id, f"Unexpected error: {exc}")
    finally:
        for path in (tmp_path, extracted_path):
            if path and os.path.exists(path):
                os.remove(path)
