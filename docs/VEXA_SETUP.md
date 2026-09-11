# Vexa self-hosting setup

This project uses a self-hosted instance of [Vexa](https://github.com/Vexa-ai/vexa)
(Apache 2.0) for Google Meet bot join + audio capture, paired with a
**separately self-hosted** `faster-whisper` transcription service running on
local GPU hardware. Neither piece uses vexa.ai's hosted/paid API or account
system — everything below runs on this machine, for free.

Vexa is cloned as a **sibling folder** to this repo (`../vexa`, i.e.
`D:\OpenCode\vexa` alongside `D:\OpenCode\fireflies-clone`), not inside it —
it's a separate upstream project we don't modify, only configure.

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

Then mint a self-host API key (the `provision-token` script needs Python;
this host's `python3` resolves to the Windows Store alias stub, so we ran it
with the real `python` install instead):

```bash
ADMIN_TOKEN=<value from .env> ADMIN_API_URL=http://127.0.0.1:18057 \
  EMAIL=self-host@vexa.ai SCOPES=bot,tx ./bin/provision-token
```

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
