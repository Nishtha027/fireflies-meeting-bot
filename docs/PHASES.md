# Phases

## Phase 1 - Meeting Bot: Join Only (done)

Playwright script that opens a Google Meet link in a visible Chromium
browser, disables camera/mic, requests to join, and stays connected until
manually stopped. No recording, transcription, or AI features. See
[bot/join_bot.py](../bot/join_bot.py).

## Later phases (not yet started)

- Audio capture from the joined call.
- Live transcription with speaker labels.
- Summaries and action items via a free LLM API (e.g. Groq).
- A UI/dashboard for browsing meetings.
