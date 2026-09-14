"""
Stop a Vexa bot that's still active in a meeting - the "End Recording"
button's Vexa-side call.

This is deliberately separate from delete_vexa_recording.py: that module
calls DELETE /meetings/{platform}/{native_meeting_id} to remove a terminal
meeting's stored recording/transcript artifacts after the fact. This module
calls DELETE /bots/{platform}/{native_meeting_id} - Vexa's "Stop / leave"
endpoint - to end an in-progress bot's participation right now, so the
meeting can transition to completed instead of waiting on Vexa's own
silence-based detection.

stop_vexa_bot() is called directly by main.py's POST /meetings/{id}/
stop-recording endpoint, before it calls get_capture_status() to ingest and
summarize immediately - see that endpoint's comments for why.
"""

import os

import httpx
from dotenv import load_dotenv

load_dotenv()


class VexaStopBotError(Exception):
    """Base class for errors stopping a meeting's active Vexa bot."""


class VexaStopBotAPIError(VexaStopBotError):
    """Vexa's API was unreachable or returned an unexpected error."""


def stop_vexa_bot(platform: str, native_meeting_id: str) -> None:
    """Stop the bot Vexa has in this meeting via DELETE /bots/{platform}/
    {native_meeting_id} - confirmed directly against our own Vexa deployment
    to answer 200 with {"status": "stopping", ...} when a bot is active.

    A 404 ("No active meeting for this bot" - confirmed directly too, the
    same response whether the meeting already completed on its own or never
    had a bot at all) is treated as success, not failure: the caller's goal
    ("no bot is still sitting in this meeting") is already true either way,
    matching delete_vexa_recording.py's same treatment of 404.
    """
    api_base = os.environ["VEXA_API_BASE"]
    api_key = os.environ["VEXA_API_KEY"]
    url = f"{api_base}/bots/{platform}/{native_meeting_id}"

    try:
        response = httpx.delete(url, headers={"X-API-Key": api_key}, timeout=15.0)
    except httpx.RequestError as exc:
        raise VexaStopBotAPIError(f"could not reach Vexa's API at {url}: {exc}") from exc

    if response.status_code == 404:
        return
    if response.status_code not in (200, 204):
        raise VexaStopBotAPIError(
            f"Vexa's API returned {response.status_code} stopping the bot for "
            f"{platform}/{native_meeting_id}: {response.text}"
        )
