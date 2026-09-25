# Vexa self-hosting setup

This project uses a self-hosted instance of [Vexa](https://github.com/Vexa-ai/vexa)
(Apache 2.0) for Google Meet bot join + audio capture, paired with a
**separately self-hosted** `faster-whisper` transcription service running on
local GPU hardware. Neither piece uses vexa.ai's hosted/paid API or account
system — everything below runs on this machine, for free.

Vexa lives at [`vexa/`](../vexa) as a **git submodule** — a formally
recorded dependency pinned to an exact commit, not a loose sibling clone.
The submodule points at **our fork**, [`Nishtha027/vexa`](https://github.com/Nishtha027/vexa)
(`meetscribe-local-patches` branch), not `Vexa-ai/vexa` directly: it
carries two small local patches (the MinIO/Chainguard fixes below) that
aren't merged upstream, and a submodule pointer can only resolve to a
commit that's actually fetchable from wherever its URL points — a commit
that exists only on someone's local machine breaks `git submodule update`
for everyone else. `upstream` (the real `Vexa-ai/vexa`) is still configured
as a second remote inside `vexa/` for pulling future updates. Beyond those
two patches we don't modify Vexa's source, only configure it (`.env`
files, which are gitignored and never come from a submodule clone — see
"Cloning this repo" below).

## Cloning this repo (with Vexa included)

```bash
git clone --recurse-submodules <this-repo-url>
```

Already cloned without that flag? Pull the submodule in after the fact:

```bash
git submodule update --init --recursive
```

Either way, this only brings Vexa's **tracked source code** at the pinned
commit — `vexa/deploy/compose/.env` and `vexa/deploy/transcription/.env`
are *not* included (submodules never carry gitignored/untracked files).
Recreate them by following the steps below.

## Two deploy units

Vexa's own repo splits this into two independent Docker Compose projects:

| Unit | Path | What it runs | GPU? |
|---|---|---|---|
| Main stack | `vexa/deploy/compose` | admin-api, runtime, meeting-api, agent-api, gateway, terminal UI, mcp, flows, postgres, redis, minio | No (CPU only) |
| Transcription | `vexa/deploy/transcription` | nginx LB + `faster-whisper` worker (STT) | Yes (required for the GPU compose file) |

They're deliberately decoupled (Vexa's own docs: "GPU inference is expensive,
stateful, and hardware-specific... keeps the core stack running everywhere").
The main stack talks to transcription over plain HTTP via
`TRANSCRIPTION_SERVICE_URL`.

We use `make`-less equivalents of Vexa's own targets throughout (this
environment doesn't have `make` installed) — the exact commands each
target runs are in `vexa/Makefile` and `vexa/deploy/compose/Makefile`.

## Transcription (`vexa/deploy/transcription`)

```bash
cd vexa/deploy/transcription
cp .env.example .env
# API_TOKEN set to a self-generated openssl rand -hex 32 value (shared secret,
# not a vexa.ai account credential)
docker compose up -d          # builds vexaai/v012-transcription:dev from source, then starts it
docker compose logs -f        # wait for "Model loaded successfully"
curl http://localhost:8083/health
```

**Model: `large-v3-turbo` at `int8`** (both are the file's shipped defaults —
we did not change them). Vexa's own `.env.example` states this config uses
**~2.1 GB VRAM**, which fits comfortably under this machine's RTX 2050 (4 GB
VRAM) with headroom to spare — and gives better accuracy than the `small`
model originally assumed, while still satisfying the "must not crash/thrash
a 4GB card" constraint. `COMPUTE_TYPE=int8` is what gets it into that
footprint (50-60% VRAM cut vs float16, "minimal accuracy loss" per the
docs).

Model weights download on first run into the `transcription-models` named
Docker volume (not the working tree) — persists across restarts.

## Main stack (`vexa/deploy/compose`)

```bash
cd vexa/deploy/compose
cp .env.example .env
# Minted ourselves (deployment-internal secrets, not external accounts):
#   ADMIN_TOKEN, INTERNAL_API_SECRET, VEXA_FLOWS_API_KEY  ← openssl rand -hex 32 each
# Pointed at the transcription unit above:
#   TRANSCRIPTION_SERVICE_URL=http://host.docker.internal:8083
#   TRANSCRIPTION_SERVICE_TOKEN=<same value as transcription/.env's API_TOKEN>
#   TRANSCRIPTION_MODEL=            (left empty — this unit ignores it; MODEL_SIZE above decides)
# Left empty (anonymous bot-join mode — see "Bot join mode" below):
#   BOT_AUTHENTICATED, BOT_USERDATA_S3_PATH, BOT_S3_*

docker compose pull                                    # published v012 images
docker pull vexaai/v012-agent-worker:v012               # build-only profile, pulled directly
docker pull vexaai/vexa-bot:v012                        # the meeting bot image
docker compose -p vexa-v012 -f docker-compose.yml up -d --no-build
```

**MinIO local patch: Chainguard images, current working setup.** MinIO's
open-source image distribution collapsed entirely over two weeks; this is
the full timeline and the fix actually running today.

1. MinIO withdrew `minio/minio` and `minio/mc` from Docker Hub entirely
   (confirmed via Docker Hub's own API returning "object not found" - not
   specific to this project). This broke `minio-init` and `minio` on any
   machine without a local image cache, including a fresh clone here.
2. Vexa's own community filed [issue #1671](https://github.com/Vexa-ai/vexa/issues/1671)
   and opened [PR #1685](https://github.com/Vexa-ai/vexa/pull/1685), repointing
   both images at MinIO's own quay.io registry, pinned to a dated release
   (not `:latest` - the PR's own reasoning: "an upstream retag is what broke
   this"). Verified working in the PR's own observation log as of 2026-09-17.
   We cherry-picked that PR's commit directly onto our pinned submodule
   commit (`git fetch origin pull/1685/head && git cherry-pick 494c25f3` -
   applied cleanly, zero conflicts).
3. **As of 2026-09-25, that fix stopped working too.** quay.io itself closed
   anonymous pull access to `minio/minio`/`minio/mc` starting ~13:00 UTC on
   2026-09-24 - the day after PR #1685's own verification - returning `401
   Unauthorized` even on the exact pinned tags the PR uses. Confirmed
   deliberate (not a flake) by decoding quay.io's own anonymous auth token:
   it grants `"actions": []` for the repository. Industry-wide - other
   unrelated projects (Grafana Mimir among them) hit the identical wall the
   same week. `bitnami/minio` was evaluated and rejected too - Bitnami's own
   Docker Hub page states that image now requires a paid Bitnami Secure
   Images subscription. At this point every free MinIO-published channel we
   could find was dead, with no upstream fix in sight (MinIO's community
   edition was archived in April 2026 - there's no further channel to
   repoint to).
4. **Switched to Chainguard's images** (`cgr.dev/chainguard/minio` and
   `cgr.dev/chainguard/minio-client`) - the only channel still serving
   anonymous pulls, confirmed genuinely maintained (the server binary
   inside was built 2026-09-22, days before we evaluated it, not a stale
   mirror). Two real differences from a plain image-name swap, both found
   by testing rather than assumed:
   - `mc` lives in a separate image, `chainguard/minio-client`, and its
     `:latest` tag has no shell - `minio-init`'s `/bin/sh -c "..."`
     entrypoint needs the `:latest-dev` variant specifically, which does
     carry one. The `mc` bundled inside `chainguard/minio` itself is
     sufficient for our existing healthcheck (`mc ready local`).
   - Both images run as non-root UID 65532 by default, and **in this
     Docker Desktop/WSL2 environment that non-root user cannot initialize
     MinIO's backend on any volume** - reproducibly `FATAL Unable to
     initialize backend: file access denied`, on both our real data volume
     (even after confirming `chown -R 65532:65532` took effect and made
     plain file writes succeed) and a brand-new empty volume. Root
     (`--user 0:0`) works immediately on both. `docker-compose.yml` sets
     `user: "0:0"` on both `minio` and `minio-init` accordingly - the
     original `minio/minio` image also ran as root, so this isn't a new
     posture, just an explicit one now.
5. **Pre-existing recordings did not survive the version jump, but were not
   silently lost either.** Pointed the new Chainguard `minio` (as root) at
   our existing data volume: the raw object files on disk were provably
   untouched (same directory count, same file timestamps, confirmed by
   inspecting the volume directly, not through MinIO), but the S3 API could
   not see the bucket at all (`mc ls` empty, `mc stat` "Object does not
   exist") - most likely because the data was written by a MinIO release
   from around April 2025 and this build is over a year newer. No MinIO
   binary anywhere (Docker Hub, quay.io, or a local image cache) could
   still read that old on-disk format, so before applying the swap we
   extracted what audio was cheaply recoverable straight from the volume's
   files: MinIO's `xl-single` format stores small/whole objects as
   `[32-byte bitrot hash][raw object bytes]` (confirmed byte-for-byte - the
   raw bytes immediately after the 32-byte prefix are valid WebM/EBML,
   `1a 45 df a3`), so stripping that prefix per object (per 1 MiB block, for
   objects spanning more than one) recovers the original file without
   needing a working MinIO server at all. All 4 pre-existing recordings
   were recovered this way and validated by fully decoding each with
   `ffmpeg` (clean exit, real Opus audio, plausible durations from ~4 to
   ~21 minutes) - saved outside the repo (`_minio_extraction/`, gitignored)
   rather than committed. `minio-init` then created a fresh, empty `vexa`
   bucket on first boot against the new image, confirmed directly (`mc ls`
   before/after) rather than assumed - old recordings are not visible
   through the app going forward, only through the extracted files.
6. **Verified working end-to-end on real, fresh data**, not just "containers
   start": dispatched a real Vexa bot to a throwaway Jitsi room, let the new
   5-minute `BOT_ALONE_SILENCE_WINDOW_MS` (see below) fire and complete the
   meeting, then fetched its recording through the app's actual
   `GET /meetings/{id}/audio` endpoint (which itself calls Vexa's
   `/recordings/{id}/master` - the real production code path, not a
   filesystem shortcut) - got back a 200, `audio/webm`, 70536 bytes,
   starting with the correct EBML magic bytes and decoding cleanly under
   `ffmpeg` with a real Opus stream. The test call had no real speech (no
   microphone device is available in the automated test browser used for
   this), so transcription correctly produced zero segments - a limitation
   of that test's audio input, not of the storage swap - but the
   write-to-MinIO-during-recording and read-back-through-Vexa's-own-API
   paths are both proven on this image.

**Re-check before relying on this**: if the `vexa` submodule pin is ever
bumped, confirm these `MINIO_IMAGE`/`MINIO_MC_IMAGE` defaults and the
`user: "0:0"` overrides survive the bump - a naive update could silently
drop them and reintroduce the pull failure, or conflict with an
already-merged upstream fix. If quay.io or Docker Hub ever restore
anonymous MinIO access, or Vexa's own [#1671](https://github.com/Vexa-ai/vexa/issues/1671)
lands a durable fix, it's worth re-evaluating whether Chainguard + the
root override is still the best option or just the one that was necessary
in September 2026.

**`vexa/` has two remotes**: `origin` is our fork
([`Nishtha027/vexa`](https://github.com/Nishtha027/vexa)), where the two
local patches actually live (branch `meetscribe-local-patches`, tip
`7fa678fd`); `upstream` is the real `Vexa-ai/vexa`, kept configured so
future updates can still be pulled from it. `git status` inside `vexa/`
should be clean - the patches are committed (`2ac91b39`/`be5d5cb1` for the
MinIO/Chainguard fixes above, plus `be5d5cb1`'s own uv-timeout tweak),
just on a fork the pinned commit (`7fa678fd`) is fetchable from. If
`git status` ever shows uncommitted changes here unexpectedly, that's
drift to investigate, not the norm.

Then mint a self-host API key (the `provision-token` script needs Python;
this host's `python3` resolves to the Windows Store alias stub, so we ran it
with the real `python` install instead):

```bash
ADMIN_TOKEN=<value from .env> ADMIN_API_URL=http://127.0.0.1:18057 \
  EMAIL=self-host@vexa.ai SCOPES=bot,tx ./bin/provision-token
```

## Windows host setup: WSL2 mirrored networking (required)

**Set this on any fresh Windows machine before relying on this stack —
don't wait to discover the problem it prevents.** Create (or edit)
`%UserProfile%\.wslconfig`:

```ini
[wsl2]
networkingMode=mirrored
```

Then `wsl --shutdown` once to apply it (safe — Docker Desktop and every
compose stack here restart automatically afterward, `restart:
unless-stopped` policy).

**Why:** on default WSL2 NAT networking, this laptop's Modern Standby sleep
mode reliably broke the WSL2 VM's network state on resume — every `docker`
command (and this app's connection to Postgres/Vexa) would hang
indefinitely, with no recovery short of `wsl --shutdown` + a full Docker
Desktop restart. Confirmed via Docker Desktop's own logs
(`%LOCALAPPDATA%\Docker\log\host\electron-*.log`) across 4 separate
incidents between 2026-09-12 and 2026-09-15: every one began within
minutes (as little as 68 seconds) of the machine waking from sleep — not
correlated with Windows Update or Docker Desktop's own auto-update, both
independently checked and ruled out. Mirrored networking mode is
Microsoft's own documented fix for WSL2 losing connectivity after
sleep/resume; verified here (2026-09-16) with all four ports this project
depends on (frontend `:3000`, backend `:8000`, Vexa gateway `:18056`, our
Postgres `:5433`) plus a real Capture Meeting round-trip (bot join, record,
stop, ingest) all behaving identically to pre-change behavior.

**Update (2026-09-19): mirrored networking does not fully hold, and at
least one recurrence had a different cause.** Three separate `docker`
hangs occurred in one work session on this date, despite `.wslconfig`
confirmed still set to `networkingMode=mirrored` (unchanged). Investigated
each rather than assuming they were all the original pattern:

- **Hang #1**: Windows Event Viewer (`Power-Troubleshooter` Event ID 1)
  shows one real sleep/wake cycle that day, 12:33:24-14:40:43 IST. Docker
  Desktop's own log (`electron-*.log`) shows its live `/events` connections
  dropped at 15:07:44 IST - 27 minutes after that wake, not the "as little
  as 68 seconds" of the original Sep 12-15 pattern. A `Microsoft-Windows-
  NDIS` driver error (Event ID 10317) fired at 14:40:43 IST, the exact wake
  moment - consistent with, but not conclusive proof of, the same
  sleep/resume networking failure as before, just slower to surface.
- **Hangs #2 and #3** occurred within roughly 15-40 minutes of fixing hang
  #1 and each other - far too soon for another natural sleep cycle, and no
  Kernel-Power/Power-Troubleshooter event supports one. These cannot be the
  original sleep/wake pattern.
- **What was different this time, confirmed present throughout the whole
  session: the system drive had 9-22 MB free out of 219 GB** (a separate
  issue, unrelated to WSL networking - see below). A near-full disk is a
  plausible independent trigger for WSL2/Docker instability on its own
  (the VHDX backing WSL2's filesystem needs room to grow); it was active
  for the full session, so it can't be ruled out as a contributor to hang
  #1 either, but it's the only candidate that explains hangs #2 and #3,
  which had no sleep/wake event to blame.

**Read:** the mirrored-networking fix is not fully holding on its own, but
"three hangs in one session" is not simply that fix failing three times -
at least two of the three had a disk-space explanation available and no
sleep/wake trigger. Keep free disk space well above a few GB as routine
hygiene; don't assume every future hang is the original sleep/resume bug
without checking for both causes independently, the way this entry did.

## Pinned version

The submodule is pinned to commit `59e2c413a53479125b70b712ade12ab470d55512`
— the exact commit already tested end-to-end (bot join + self-hosted
transcription confirmed working). Don't bump it to "latest" casually;
re-verify the full flow (join + transcript) after any deliberate update.

## URLs

- Terminal UI (the fast path — send a bot / watch transcripts live, no curl needed): `http://localhost:13000`
- API gateway: `http://localhost:18056` (health: `GET /health`)
- Admin API: `http://localhost:18057`
- Transcription service: `http://localhost:8083` (health: `GET /health`)

## Bot join mode: anonymous (for now)

Vexa bots can join **anonymously** (default — knocks in the lobby, a human
admits it) or **authenticated** (signed into a real Google account via a
one-time `make login`-equivalent flow, session stored in MinIO). Phase 1's
manual bot (see [archive/phase1-manual-approach/](../archive/phase1-manual-approach/))
already hit Google blocking a fully anonymous/signed-out join on this
account's meetings — Vexa's anonymous mode is structurally the same
knock-and-admit pattern, so it may hit the same wall. We're trying anonymous
first since it needs zero extra setup; if it fails, the next step is
authenticated mode, which needs a one-time manual Google sign-in (the user's
own action — never automated) into a dedicated bot account, the same pattern
as the archived `save_session.py`.

## What's NOT used

- No vexa.ai account was created.
- No vexa.ai hosted transcription token was requested, generated, or set
  anywhere in either `.env` file — `TRANSCRIPTION_SERVICE_URL` points at
  `http://host.docker.internal:8083`, this machine's own transcription
  container, never `vexa.ai`.
