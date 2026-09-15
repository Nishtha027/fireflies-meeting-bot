# fireflies-clone

A free, self-hosted, open-source clone of Fireflies.ai, built in small,
verified phases. It transcribes Google Meet calls live with speaker labels
and generates summaries/action items using free APIs - all coordinated from
a single machine.

See [docs/PHASES.md](docs/PHASES.md) for the phase-by-phase plan and status.

**Before writing any test that needs real audio or a disposable account,
read [docs/TESTING_GUIDELINES.md](docs/TESTING_GUIDELINES.md)** - it documents
a real incident where mirroring a real meeting's identifiers into test data
led to permanent data loss, and the rule that prevents it from happening
again.

## Architecture

Meeting join and audio capture are handled by a self-hosted instance of
[Vexa](https://github.com/Vexa-ai/vexa) (Apache 2.0), an open-source
meeting bot + API/dashboard. Vexa lives at [`vexa/`](vexa) as a **git
submodule**, pinned to a specific tested commit (see
[docs/VEXA_SETUP.md](docs/VEXA_SETUP.md) for how this project's instance is
configured and run, and how to pull the submodule in when cloning).

Live transcription runs as a **separately self-hosted** `faster-whisper`
service (Vexa's own `deploy/transcription` unit) on local GPU hardware, not
Vexa's hosted/paid transcription API - keeping the whole stack free with no
ongoing per-hour cost. The main Vexa stack talks to this transcription
service over the network via `TRANSCRIPTION_SERVICE_URL`.

This repo focuses on the layers built on top of Vexa's transcript output:
dashboard, summarization, search, and chat.

We originally hand-built the Google Meet join step ourselves with
Playwright, but Google blocks fully anonymous/signed-out bots from joining
calls at all, and Vexa already solves that (plus audio capture, and
transcription via its self-hostable STT unit) as a maintained project - so
we adopted it instead of continuing to build and maintain that layer
ourselves. The original manual bot is kept for reference in
[archive/phase1-manual-approach/](archive/phase1-manual-approach/).
