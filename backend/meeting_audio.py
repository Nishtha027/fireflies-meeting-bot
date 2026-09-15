"""
Resolve and fetch a meeting's recorded audio from Vexa.

get_audio_stream() is called directly by main.py's GET /meetings/{id}/audio
endpoint. Confirmed live (2026-09-15, against native_meeting_id
hvz-frxu-hvx / vexa_meeting_id=5) call sequence:

  1. GET /recordings?meeting_id={vexa_meeting_id} -> {"recordings": [...]},
     newest first (Vexa's own sort - see vexa's recordings/router.py). Each
     recording carries `id` and `media_files: [{id, type, ...}]`; we pick
     the newest recording that has an `audio` media file.
  2. GET /recordings/{recording_id}/master?type=audio -> finalizes the
     audio master if it hasn't been assembled yet, and returns `raw_url`
     (the byte route below) plus the confirmed `media_file_id`.
  3. GET {raw_url} (i.e. /recordings/{recording_id}/media/{media_file_id}/
     raw?type=audio), forwarding the browser's own Range header verbatim.
     Vexa answers 206 Partial Content with Content-Range/Accept-Ranges when
     Range is set, so only the requested byte slice is ever fetched here -
     never the whole file.

Same "raise a module-specific exception, let the caller map it to HTTP"
convention as capture_meeting.py / stop_vexa_bot.py / delete_vexa_recording.py.
"""

import os
from dataclasses import dataclass

import httpx
from dotenv import load_dotenv

load_dotenv()


class MeetingAudioError(Exception):
    """Base class for errors resolving/fetching a meeting's Vexa audio."""


class NoRecordingError(MeetingAudioError):
    """Vexa has no playable audio for this meeting (never recorded, deleted,
    or only a non-audio media file exists)."""


class VexaAudioAPIError(MeetingAudioError):
    """Vexa's API was unreachable or returned an unexpected error."""


@dataclass
class AudioStream:
    status_code: int
    content: bytes
    content_type: str
    headers: dict[str, str]


def _vexa_config() -> tuple[str, str]:
    try:
        return os.environ["VEXA_API_BASE"], os.environ["VEXA_API_KEY"]
    except KeyError as exc:
        raise VexaAudioAPIError(f"{exc.args[0]} is not set - check backend/.env.") from exc


def _resolve_recording_id(api_base: str, headers: dict, vexa_meeting_id: int) -> int:
    try:
        resp = httpx.get(
            f"{api_base}/recordings",
            params={"meeting_id": vexa_meeting_id},
            headers=headers,
            timeout=15.0,
        )
    except httpx.RequestError as exc:
        raise VexaAudioAPIError(f"could not reach Vexa's API at {api_base}: {exc}") from exc
    if resp.status_code != 200:
        raise VexaAudioAPIError(
            f"Vexa's API returned {resp.status_code} listing recordings for "
            f"meeting_id={vexa_meeting_id}: {resp.text}"
        )
    recordings = resp.json().get("recordings", [])
    recording = next(
        (
            r
            for r in recordings
            if any(mf.get("type") == "audio" for mf in r.get("media_files", []))
        ),
        None,
    )
    if recording is None:
        raise NoRecordingError(f"No Vexa audio recording exists for meeting_id={vexa_meeting_id}.")
    return recording["id"]


def _resolve_raw_url(api_base: str, headers: dict, recording_id: int) -> str:
    try:
        resp = httpx.get(
            f"{api_base}/recordings/{recording_id}/master",
            params={"type": "audio"},
            headers=headers,
            timeout=30.0,
        )
    except httpx.RequestError as exc:
        raise VexaAudioAPIError(f"could not reach Vexa's API at {api_base}: {exc}") from exc
    if resp.status_code == 404:
        raise NoRecordingError(f"Recording {recording_id} has no audio media file.")
    if resp.status_code != 200:
        raise VexaAudioAPIError(
            f"Vexa's API returned {resp.status_code} resolving the audio master "
            f"for recording {recording_id}: {resp.text}"
        )
    raw_url = resp.json().get("raw_url")
    if not raw_url:
        raise NoRecordingError(f"Recording {recording_id} has no playable audio yet.")
    return raw_url


def get_audio_stream(vexa_meeting_id: int, range_header: str | None) -> AudioStream:
    """Resolve vexa_meeting_id to Vexa's audio recording and fetch its raw
    bytes, forwarding range_header (the browser's own Range header value, or
    None) straight through to Vexa's Range-aware raw endpoint."""
    api_base, api_key = _vexa_config()
    headers = {"X-API-Key": api_key}

    recording_id = _resolve_recording_id(api_base, headers, vexa_meeting_id)
    raw_url = _resolve_raw_url(api_base, headers, recording_id)

    raw_headers = dict(headers)
    if range_header:
        raw_headers["Range"] = range_header

    try:
        raw_resp = httpx.get(f"{api_base}{raw_url}", headers=raw_headers, timeout=30.0)
    except httpx.RequestError as exc:
        raise VexaAudioAPIError(f"could not reach Vexa's API at {api_base}: {exc}") from exc
    if raw_resp.status_code == 404:
        raise NoRecordingError(f"Recording {recording_id}'s audio file is no longer available.")
    if raw_resp.status_code not in (200, 206, 416):
        raise VexaAudioAPIError(
            f"Vexa's API returned {raw_resp.status_code} fetching audio for "
            f"recording {recording_id}: {raw_resp.text}"
        )

    passthrough_headers: dict[str, str] = {}
    if raw_resp.headers.get("accept-ranges"):
        passthrough_headers["Accept-Ranges"] = raw_resp.headers["accept-ranges"]
    if raw_resp.headers.get("content-range"):
        passthrough_headers["Content-Range"] = raw_resp.headers["content-range"]

    return AudioStream(
        status_code=raw_resp.status_code,
        content=raw_resp.content,
        content_type=raw_resp.headers.get("content-type", "application/octet-stream"),
        headers=passthrough_headers,
    )
