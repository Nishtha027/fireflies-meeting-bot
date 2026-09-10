# fireflies-clone

A free, self-hosted, open-source clone of Fireflies.ai, built in small,
verified phases. Eventually it will join Google Meet calls, transcribe them
live with speaker labels, and generate summaries/action items using free
APIs - all coordinated from a single machine.

See [docs/PHASES.md](docs/PHASES.md) for the phase-by-phase plan and status.

## Phase 1: Meeting Bot - Join Only

A Playwright-driven bot that opens a Google Meet link, disables camera and
microphone, requests to join, and stays connected until stopped. No
recording, transcription, or AI features yet.

### Setup (Windows)

```powershell
cd bot
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium
```

### Run

```powershell
python join_bot.py "https://meet.google.com/xxx-yyyy-zzz"
```

Press `Ctrl+C` to leave the call and close the browser.
