# Phases

## Superseded — see [archive/phase1-manual-approach/](../archive/phase1-manual-approach/)

- ~~Phase 1 - Meeting Bot: Join Only~~ — Playwright script that manually
  joined a Google Meet call (camera/mic off, click join, stay connected).
  Superseded: Google blocks fully anonymous/signed-out joins, and this
  layer is now handled by self-hosted Vexa instead.
- ~~Phase 2 - Audio Capture~~ (planned, never built) — manual audio capture
  from the joined call. Superseded: folded into Vexa, which handles bot
  join and audio capture directly.

## Phase 1 - Deploy self-hosted Vexa (current)

Self-host [Vexa](https://github.com/Vexa-ai/vexa) (Apache 2.0) for meeting
bot join and audio capture, plus a separately self-hosted `faster-whisper`
transcription service (Vexa's `deploy/transcription` unit) running on local
GPU hardware - not Vexa's hosted/paid transcription API. Both run as their
own services alongside this repo. See
[docs/VEXA_SETUP.md](VEXA_SETUP.md).

## Later phases (not yet started)

- Summaries and action items via a free LLM API (e.g. Groq), built on top
  of Vexa's transcripts.
- A UI/dashboard for browsing meetings.
