# Vexa self-hosting setup

This project uses a self-hosted instance of [Vexa](https://github.com/Vexa-ai/vexa)
(Apache 2.0) for Google Meet bot join + audio capture, paired with a
**separately self-hosted** `faster-whisper` transcription service running on
local GPU hardware. Neither piece uses vexa.ai's hosted/paid API or account
system — everything below runs on this machine, for free.

Vexa lives at [`vexa/`](../vexa) as a **git submodule** — a formally
recorded dependency pinned to an exact upstream commit, not a loose sibling
clone. We don't modify its source, only configure it (`.env` files, which
are gitignored and never come from a submodule clone — see "Cloning this
repo" below).

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

**TEMPORARY LOCAL PATCH (as of this pinned commit): MinIO images cherry-picked
from upstream, currently still broken upstream too.** Timeline, in order:

1. MinIO withdrew `minio/minio` and `minio/mc` from Docker Hub entirely
   (confirmed via Docker Hub's own API returning "object not found" - not
   specific to this project). This broke `minio-init` and `minio` on any
   machine without a local image cache, including a fresh clone here.
2. Vexa's own community filed [issue #1671](https://github.com/Vexa-ai/vexa/issues/1671)
   and opened [PR #1685](https://github.com/Vexa-ai/vexa/pull/1685), repointing
   both images at MinIO's own quay.io registry, pinned to a dated release
   (not `:latest` - the PR's own reasoning: "an upstream retag is what broke
   this"). Verified working in the PR's own observation log as of 2026-09-17.
3. **We cherry-picked that PR's commit directly onto our pinned submodule
   commit** (`git fetch origin pull/1685/head && git cherry-pick 494c25f3` -
   applied cleanly, zero conflicts, since the PR branch was only 2 commits
   ahead of our pin). This is applied in the submodule working tree right
   now: `deploy/compose/docker-compose.yml` and `.env.example` reference
   `MINIO_IMAGE`/`MINIO_MC_IMAGE`, defaulting to
   `quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z` and
   `quay.io/minio/mc:RELEASE.2025-04-16T18-13-26Z`.
4. **As of 2026-09-25, this does NOT actually fix the problem.** Confirmed
   directly: quay.io itself closed anonymous pull access to `minio/minio`/
   `minio/mc` starting ~13:00 UTC on 2026-09-24 - the day after PR #1685's
   own verification - returning `401 Unauthorized` even on the exact pinned
   tags the PR uses. Confirmed this is a deliberate access restriction (not
   a flake) by decoding quay.io's own anonymous auth token: it grants
   `"actions": []` for the repository. This is industry-wide - other
   unrelated projects (Grafana Mimir among them) hit the identical wall the
   same week. No Vexa-side fix exists yet for this second break; evaluated
   and rejected `bitnami/minio` as an alternative too (Bitnami's own Docker
   Hub page states that image now requires a paid Bitnami Secure Images
   subscription).

**Why this patch is still here despite not fixing the live problem:** it's
the correct, upstream-verified fix for the *first* break (Docker Hub
withdrawal), it's committed once quay.io access is restored or a further
upstream fix lands, and re-deriving it later would just mean repeating the
same cherry-pick. Re-check this section (and quay.io access, and Vexa's
[#1671](https://github.com/Vexa-ai/vexa/issues/1671)/[#1685](https://github.com/Vexa-ai/vexa/pull/1685) status) before relying on
`docker compose up` bringing the main stack up cleanly.

**`git status` inside `vexa/` will now correctly show local modifications**
relative to the pinned commit (the cherry-picked commit, detached from
`59e2c413a53479125b70b712ade12ab470d55512`). That's expected and
intentional - not something to "clean up" - until the pinned submodule
commit is updated to one that includes the real merged upstream fix. When
that update happens, re-check whether this patch is still needed (a naive
submodule bump could otherwise silently drop it and reintroduce the
breakage, or conflict with an already-merged version of the same fix).

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
