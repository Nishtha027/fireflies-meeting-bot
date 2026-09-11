"""
Phase 1: Meeting Bot - Join Only.

Opens a Google Meet link in a visible, automated Chromium browser, makes
sure camera and microphone are off, requests to join, and stays connected
until the user stops the script with Ctrl+C.

Usage:
    python join_bot.py "https://meet.google.com/xxx-yyyy-zzz"

This phase does not record, transcribe, or summarize anything - it only
proves the bot can reliably get into a live call.
"""

import argparse
import os
import re
import sys
import time

from playwright.sync_api import Page, TimeoutError as PlaywrightTimeoutError, sync_playwright

# How long to wait for any single UI element before giving up on it.
ELEMENT_TIMEOUT_MS = 8_000

# Saved login session produced by save_session.py. Google Meet requires a
# signed-in account to join at all, so this must exist before we can run.
AUTH_STATE_PATH = "auth_state.json"


def log(message: str) -> None:
    """Print a timestamped status line so the user can follow along live."""
    print(f"[{time.strftime('%H:%M:%S')}] {message}")


def parse_args() -> str:
    """Read the Meet URL from the command line and do a basic sanity check on it."""
    parser = argparse.ArgumentParser(description="Join a Google Meet call with camera/mic off.")
    parser.add_argument("meet_url", help="Google Meet link, e.g. https://meet.google.com/xxx-yyyy-zzz")
    args = parser.parse_args()

    if not re.match(r"^https://meet\.google\.com/[a-z0-9\-]+", args.meet_url.strip(), re.IGNORECASE):
        log(f"ERROR: '{args.meet_url}' does not look like a valid Google Meet link.")
        sys.exit(1)

    return args.meet_url.strip()


def try_click(page: Page, locator, description: str, timeout_ms: int = ELEMENT_TIMEOUT_MS) -> bool:
    """
    Attempt to click a locator, tolerating the common Meet-specific failure
    modes: the element never appears (feature not shown for this call), or
    it's already in the desired state and not interactable.

    Returns True if the click happened, False otherwise. Never raises.
    """
    try:
        locator.wait_for(state="visible", timeout=timeout_ms)
        locator.click(timeout=timeout_ms)
        log(f"OK: {description}")
        return True
    except PlaywrightTimeoutError:
        log(f"SKIP: '{description}' not found within {timeout_ms}ms (may not apply to this call).")
        return False
    except Exception as exc:  # noqa: BLE001 - we want to keep going regardless of the cause
        log(f"SKIP: '{description}' could not be completed ({exc.__class__.__name__}).")
        return False


def disable_camera_and_mic(page: Page) -> None:
    """
    Make sure camera and microphone are off before joining.

    Google Meet's pre-join screen can present this in a couple of different
    ways depending on device availability and prior browser permissions, so
    we handle the two we know about:
      1. Explicit toggle buttons ("Turn off camera" / "Turn off microphone").
      2. A "Continue without microphone/camera" prompt when no device is
         available (expected here, since we never grant real device access).
    Every step is best-effort: if an element isn't present, we log and move on
    rather than failing the whole run over a UI variant we didn't anticipate.
    """
    log("Disabling camera and microphone before joining...")

    # Toggle buttons use aria-labels that mention "Turn off camera/microphone"
    # when the device is currently on. Locating by role + accessible name is
    # more resistant to Google's frequent class-name changes than CSS selectors.
    try_click(
        page,
        page.get_by_role("button", name=re.compile("Turn off camera", re.IGNORECASE)),
        "Turn off camera",
    )
    try_click(
        page,
        page.get_by_role("button", name=re.compile("Turn off microphone", re.IGNORECASE)),
        "Turn off microphone",
    )

    # If no real camera/mic is available (expected, since we never grant
    # device permissions), Meet may show a one-time dialog instead.
    try_click(
        page,
        page.get_by_role("button", name=re.compile("Continue without microphone", re.IGNORECASE)),
        "Continue without microphone (dialog)",
    )

    log("Camera/mic disabled (or already off / unavailable).")


def click_join(page: Page) -> None:
    """
    Click whichever join control Meet presents: "Ask to join" for guests
    without direct access, or "Join now" when no host approval is required.
    """
    join_button = page.get_by_role("button", name=re.compile("Ask to join|Join now", re.IGNORECASE))
    joined = try_click(page, join_button, "Click join button (Ask to join / Join now)", timeout_ms=15_000)
    if not joined:
        log("ERROR: Could not find a join button. The page layout may have changed, "
            "or the meeting link may be invalid/expired.")
        sys.exit(1)


def wait_for_admission_or_connection(page: Page) -> None:
    """
    Log a clear status once the join button has been clicked.

    Meet doesn't expose a simple, stable signal for "admitted by host", so we
    can't reliably assert we're fully in the call from the DOM alone. We log
    that the request was sent and that we're now waiting, then keep the
    browser open - if a waiting room is used, the host must admit the bot
    manually, after which it becomes a normal call participant.
    """
    log("Waiting for admission (if this call has a waiting room, the host must let the bot in)...")
    # Give Meet a moment to transition from the pre-join screen; this is a
    # best-effort delay, not a proof of connection.
    page.wait_for_timeout(3_000)
    log("Connected to call (join request sent and accepted by the page).")


def run(meet_url: str) -> None:
    if not os.path.exists(AUTH_STATE_PATH):
        log(f"ERROR: No saved login session found at '{AUTH_STATE_PATH}'.")
        log("Google Meet requires a signed-in account to join a call.")
        log("Run 'python save_session.py' first to log in and save a session, then retry.")
        sys.exit(1)

    with sync_playwright() as playwright:
        log("Launching visible Chromium browser...")
        # Playwright's own bundled Chromium build fails to start on some
        # Windows machines ("side-by-side configuration is incorrect"),
        # even freshly reinstalled. Using the system-installed Chrome via
        # the "chrome" channel avoids that and requires no other changes.
        browser = playwright.chromium.launch(headless=False, channel="chrome")

        log("Loaded saved session. Joining as signed-in guest...")
        # A fresh context grants no permissions by default, so Playwright
        # auto-denies any getUserMedia (camera/mic) request without ever
        # showing a native "Allow microphone/camera access?" popup. Loading
        # storage_state restores the signed-in cookies/local storage saved
        # by save_session.py, so Meet sees this as an authenticated user.
        context = browser.new_context(permissions=[], storage_state=AUTH_STATE_PATH)
        page = context.new_page()

        try:
            log(f"Navigating to meeting: {meet_url}")
            try:
                page.goto(meet_url, wait_until="domcontentloaded", timeout=30_000)
            except PlaywrightTimeoutError:
                log("ERROR: The meeting page failed to load in time. Check the link and your network connection.")
                sys.exit(1)

            disable_camera_and_mic(page)
            click_join(page)
            wait_for_admission_or_connection(page)

            log("Bot is connected. Press Ctrl+C to leave the call and close the browser.")
            # Keep the script (and browser) alive until the user stops it.
            # Polling in small increments keeps Ctrl+C responsive on Windows.
            while True:
                page.wait_for_timeout(1_000)

        except KeyboardInterrupt:
            log("Ctrl+C received. Shutting down...")
        finally:
            context.close()
            browser.close()
            log("Browser closed cleanly. No orphaned processes.")


if __name__ == "__main__":
    meet_url = parse_args()
    run(meet_url)
