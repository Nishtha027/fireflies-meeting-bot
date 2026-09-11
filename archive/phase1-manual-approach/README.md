# Phase 1 (archived) — Manual Google Meet bot

This folder holds the original, hand-built approach to getting a bot into a
Google Meet call, before the project switched to self-hosting
[Vexa](https://github.com/Vexa-ai/vexa) for bot join + audio capture +
transcription.

## What's here

- **`join_bot.py`** — a Playwright script that opens a Google Meet link in a
  visible Chromium/Chrome browser, disables camera and microphone, clicks
  "Ask to join" / "Join now", and stays connected until stopped with
  Ctrl+C. Loads a saved login session from `auth_state.json` if present.
- **`save_session.py`** — a one-time script that opens a visible browser at
  the Google sign-in page, waits for a human to log in manually, and saves
  the resulting session to `auth_state.json` via Playwright's
  `storage_state()`. Never touches a password itself.
- **`requirements.txt`** — the Playwright dependency this code needs to run.

## Why it was set aside

Google Meet blocks fully anonymous, signed-out participants from joining a
call at all — an anonymous Playwright session hits a hard "You can't join
this video call" wall rather than a name-entry/waiting-room screen. Working
around that required signing the bot into a dedicated Google account and
reusing a saved session (which `save_session.py` / the `auth_state.json`
loading in `join_bot.py` above were built to do).

Partway through solving that, the project pivoted to self-hosting
[Vexa](https://github.com/Vexa-ai/vexa) (Apache 2.0) instead of continuing
to build and maintain this layer ourselves. Vexa already solves meeting
join and audio capture, and can pair with a separately self-hosted
`faster-whisper` transcription service (its own `deploy/transcription`
unit, run on local GPU hardware rather than Vexa's paid hosted
transcription API) - all as a maintained open-source project with its own
dashboard, so there was no need to keep re-solving the same problem by
hand.

## Status

Kept for reference only — **not run as part of the current architecture.**
If the project ever needs a fully custom, non-Vexa join flow again (e.g. a
platform Vexa doesn't support), this is the starting point to revisit
rather than rebuilding from scratch. See the main
[README.md](../../README.md) and [docs/PHASES.md](../../docs/PHASES.md) for
the current architecture.
