# Project history

The project was built in small, verified phases. This is the record of what
was built, in order, and why the early approach was replaced. For how it
works *now*, see the [README](../README.md); for running it in production,
see [DEPLOYMENT.md](DEPLOYMENT.md).

## Superseded - see [archive/phase1-manual-approach/](../archive/phase1-manual-approach/)

- ~~Manual Meeting Bot (join only)~~ - a Playwright script that joined a
  Google Meet call with camera/mic off. Superseded: Google blocks fully
  anonymous/signed-out joins, and this layer is now handled by self-hosted
  Vexa instead.
- ~~Manual audio capture~~ (planned, never built) - folded into Vexa, which
  handles bot join and audio capture directly.

## Done

1. **Self-hosted Vexa** - meeting bot join + audio capture, plus a separately
   self-hosted `faster-whisper` transcription service on local GPU hardware
   (not Vexa's hosted/paid transcription API). See [VEXA_SETUP.md](VEXA_SETUP.md).
2. **Ingestion + app database** - dedicated Postgres for the app's own data
   (meetings, transcript segments, summaries, action items), Alembic
   migrations, and a transcript ingestion path from Vexa.
3. **Summaries** - one structured-JSON Groq call per meeting produces the
   summary, key points, decisions, action items and chapters.
4. **FastAPI layer + Next.js dashboard** - meeting library and detail views,
   transcript with speaker labels, summary/action-items panels, Home
   dashboard, cross-meeting Tasks page.
5. **Search** - keyword search with date-range and participant filters.
6. **Chat (RAG)** - ask natural-language questions across your meetings:
   local sentence-transformers embeddings, Chroma vector store, answers from
   Groq grounded only in the retrieved context, with source chips.
7. **Analytics** - per-meeting and aggregate talk-time, action-item
   completion tracking.
8. **Capture flow** - paste a meeting link to send the bot; a backend poller
   tracks capture status; manual End Recording.
9. **Accounts** - multi-user with per-user data isolation, invite-code
   registration gate, Settings (profile, password change, account deletion
   with full cleanup), light/dark/system theme.
10. **Meeting polish** - editable titles, per-meeting participant renaming,
    audio playback synced to the transcript, in-transcript search, chapters,
    create/edit/delete action items, meeting deletion with Vexa-side cleanup.
11. **Upload File** - transcribe uploaded audio/video (`.mp3 .wav .m4a .ogg
    .mp4 .mov .webm`) or import a pasted/uploaded text transcript
    (`.txt .md`).
12. **Production deployment** - Vercel frontend, Tailscale Funnel to the
    backend, same-origin `/api` proxy so login works in every browser,
    failed-attempt rate limiting, DB pool hardening, single-worker backend,
    one-link invite signup. See [DEPLOYMENT.md](DEPLOYMENT.md).

## Not built / known limits

- Mobile/native apps and calendar integration (the bot is started by pasting
  a link).
- Per-user invite codes or an admin console (the invite gate is one shared
  code by design).
- Moving Chroma to its own server (needed before running more than one
  backend worker).
- Always-on hosting: the backend, database and bot stack run on one machine,
  so the app is available when that machine is on and online. See
  "Known limits" in [DEPLOYMENT.md](DEPLOYMENT.md).
