"""
Delete a meeting's audio recording (and Vexa's own transcript copy) from our
self-hosted Vexa deployment.

Usage:
    python delete_vexa_recording.py --native-meeting-id itu-etnh-tgj [--platform google_meet]

delete_vexa_meeting() is also called directly by main.py's
DELETE /meetings/{id} endpoint, before it touches our own Postgres/Chroma
data - see that endpoint's comments for why the ordering matters.
"""

import argparse
import os
import sys

import httpx
from dotenv import load_dotenv

load_dotenv()


class VexaDeleteError(Exception):
    """Base class for errors deleting a meeting's Vexa-side recording."""


class VexaMeetingStillActiveError(VexaDeleteError):
    """Vexa still considers this meeting in-flight (409) - refuses to delete
    artifacts until it's terminal. Stop the bot first."""


class VexaDeleteAPIError(VexaDeleteError):
    """Vexa's API was unreachable or returned an unexpected error."""


def delete_vexa_meeting(platform: str, native_meeting_id: str) -> None:
    """Delete a meeting's recording via Vexa's native-key route,
    DELETE /meetings/{platform}/{native_meeting_id} - the one Vexa's own
    docs (docs/api/meetings.mdx, "Edit a plan or delete meeting artifacts")
    name as removing "recording objects from primary object storage and
    recording metadata" for a terminal meeting. We already store platform +
    native_meeting_id on every Meeting row, so this needs no extra lookup
    of Vexa's internal recording_id via GET /recordings first.

    A 404 (Vexa never had this meeting, or its recording was already
    cleaned up) is treated as success, not failure - the goal ("no Vexa-
    side recording survives this meeting") is already true either way.
    """
    api_base = os.environ["VEXA_API_BASE"]
    api_key = os.environ["VEXA_API_KEY"]
    url = f"{api_base}/meetings/{platform}/{native_meeting_id}"

    try:
        response = httpx.delete(url, headers={"X-API-Key": api_key}, timeout=15.0)
    except httpx.RequestError as exc:
        raise VexaDeleteAPIError(f"could not reach Vexa's API at {url}: {exc}") from exc

    if response.status_code == 404:
        return
    if response.status_code == 409:
        raise VexaMeetingStillActiveError(
            f"Vexa still considers {platform}/{native_meeting_id} in progress - "
            "stop the bot before deleting this meeting."
        )
    if response.status_code not in (200, 204):
        raise VexaDeleteAPIError(
            f"Vexa's API returned {response.status_code} deleting "
            f"{platform}/{native_meeting_id}: {response.text}"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--native-meeting-id", required=True, help="Vexa's per-platform meeting code, e.g. itu-etnh-tgj")
    parser.add_argument("--platform", default="google_meet", help="Meeting platform (default: google_meet)")
    args = parser.parse_args()

    try:
        delete_vexa_meeting(args.platform, args.native_meeting_id)
    except VexaDeleteError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

    print(f"Vexa-side recording for {args.platform}/{args.native_meeting_id} deleted (or none existed).")


if __name__ == "__main__":
    main()
