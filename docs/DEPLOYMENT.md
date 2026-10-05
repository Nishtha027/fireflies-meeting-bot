# Deployment

How the production deployment is wired, and how to operate it. Nothing here
is needed for local development (`uvicorn main:app --reload` + `npm run dev`
work exactly as before).

## Topology

```
Browser ──HTTPS──▶ Vercel (Next.js frontend)
                      │  /api/*  (server-side rewrite = reverse proxy)
                      ▼
              Tailscale Funnel  https://<machine>.<tailnet>.ts.net
                      │
                      ▼
        Your machine: FastAPI :8000  ──▶ Postgres (docker :5433)
                                     ──▶ Vexa meeting-bot stack (docker)
                                     ──▶ Chroma (on disk) / Groq API
```

- **Frontend** - Vercel project `frontend` (team `nishtha15`), production
  alias `https://frontend-zeta-brown-62.vercel.app`.
- **Backend** - FastAPI on the host machine, exposed to the internet by
  [Tailscale Funnel](https://tailscale.com/kb/1223/funnel) (free, stable
  HTTPS URL, no port forwarding).
- **Everything stateful stays on the host**: Postgres, Vexa, MinIO, the
  Chroma vector store, recordings.

### Why the browser talks to `/api` on the frontend's own origin

The backend is a different *site* from the frontend. Calling it directly
means the session cookie is a **third-party cookie**, which Safari/iOS
(every iOS browser), Brave and Chrome's stricter modes block - login would
silently fail there. So in production Vercel proxies `/api/*` to the Funnel
URL server-side (`rewrites()` in `frontend/next.config.ts`), and the cookie
becomes first-party everywhere.

The frontend is configured with two Vercel **Production** env vars:

| Variable | Value | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `/api` | Base URL baked into the client bundle. |
| `API_PROXY_TARGET` | `https://<machine>.<tailnet>.ts.net` | Where Vercel forwards `/api/*`. Build-time. |

Leave both **unset** for local dev: the frontend then calls
`http://localhost:8000` directly and no rewrite exists.

Direct cross-origin mode still works too (set `NEXT_PUBLIC_API_URL` to the
Funnel URL and leave `API_PROXY_TARGET` unset): the backend sends
`SameSite=None; Secure` cookies and an explicit-origin CORS allowlist, with
credentials. This works in Chrome/Edge/Firefox but **not** in
third-party-cookie-blocking browsers, which is why the proxy is the default.

## Sharing the app

Give people **one link**; it signs them up and drops them into their own
private account (accounts are isolated - nobody sees anyone else's meetings):

```
https://frontend-zeta-brown-62.vercel.app/register#invite=<INVITE_CODE>
```

The code after `#invite=` pre-fills the invite field. It sits in the URL
*fragment*, which browsers never send to any server (Vercel, the backend,
Referer headers), and the page removes it from the address bar after reading.
Anyone holding the link can register, so treat it like the code itself: to
revoke access, change `INVITE_CODE` in `backend/.env` and restart the backend
(existing accounts keep working). Without the code a plain `/register` link
still can't create an account - the server enforces it (HTTP 403).

## Backend production settings

`scripts/prod-env.ps1` holds the production-only environment, applied as
*process* env vars so `backend/.env` (dev defaults) is never touched:

| Variable | Production | Dev default |
|---|---|---|
| `COOKIE_SECURE` | `true` | `false` |
| `COOKIE_SAMESITE` | `none` | `lax` |
| `CORS_ORIGINS` | production frontend origin + `http://localhost:3000` | `http://localhost:3000` |

CORS is an explicit allowlist (never `*`, credentials are on). Vercel
**preview** deployment URLs are deliberately not allowed: each allowed origin
can make logged-in requests as a user, and preview hostnames are
unpredictable. With the proxy in place CORS is not even on the request path
for the production site.

### One uvicorn worker, on purpose

`/chat` uses an embedded on-disk Chroma store, which is **single-process
only**: every uvicorn worker caches its own copy of the vector index, so a
vector written by worker A is invisible to worker B and about half of
`/chat` calls fail (`Error finding id`). Reproduced with 2 workers; fixed by
running one. Concurrency is unaffected in practice - endpoints are sync and
run in a thread pool, and the slow parts wait on I/O. To scale out, move
Chroma to its own server first. (The background poller is additionally
guarded by an OS file lock so it can never run twice even if workers are
added later.)

### Abuse protection

`/auth/login` and `/auth/register` are public. Failed attempts are
rate-limited (`backend/rate_limit.py`): 8 failed logins per email and 20 per
IP, 10 wrong invite codes per IP and 40 globally, each per 15 minutes, then
HTTP 429 with `Retry-After`. The invite code is a shared secret in
`backend/.env` (`INVITE_CODE`) - **use a long random one**:

```bash
python -c "import secrets; print(secrets.token_urlsafe(16))"
```

## Running the backend

Foreground (testing):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\run-backend-prod.ps1
```

As a Windows service (auto-start at boot, auto-restart on crash), from an
**elevated** PowerShell, once:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-services.ps1
```

It installs `Meetscribe-Backend` via [NSSM](https://nssm.cc), then proves
crash recovery by killing the process tree and confirming it comes back.
Logs: `backend\service-stdout.log`, `backend\service-stderr.log` (rotated at
10 MB). The service needs Docker Desktop running (Postgres + Vexa); Docker
Desktop starts at login and its containers use `restart: unless-stopped`.

Tailscale Funnel configuration persists across reboots; check it with
`tailscale funnel status` (should show `/ proxy http://127.0.0.1:8000`).

## Deploying the frontend

The Vercel project is not Git-linked; deploy from `frontend/`:

```bash
cd frontend
vercel deploy --prod
```

`NEXT_PUBLIC_*` values are inlined at build time, so changing either env var
requires a redeploy. When adding env values from a shell, use `printf '%s'`
(a PowerShell pipe prepends a BOM and breaks the URL).

## Known limits

- **Vercel gives each proxied request 120 seconds.** An upload has to finish
  inside that window, so the practical maximum is *your upload speed x 120 s*
  (about 150 MB at 10 Mbit/s, 30 MB at 2 Mbit/s). The backend itself accepts
  up to 1 GiB; for bigger recordings upload from the local dev setup or
  compress first. Measured: a 4 MB upload through the proxy over a ~0.4 Mbit/s
  uplink took ~76 s; the backend accepts 100 MB in under 2 s over loopback.
- **Account deletion takes ~3 s per meeting** (Vexa + Chroma clean-up). An
  account with 35+ meetings can outlast the 120 s window; the deletion still
  completes on the server, the page just shows an error until you reload.
- **Availability = this machine's availability.** The backend, database and
  Funnel run on one laptop: it has to be on, awake and online. Funnel can
  return brief 502s for a few minutes after the machine's network changes
  (Wi-Fi switch, new IP) while Tailscale re-establishes the path.
- **Uploaded audio is normalized with ffmpeg** (16 kHz mono WAV) before
  transcription - the transcription service returns empty text for MP3 and
  for WAVs at other sample rates. `FFMPEG_PATH` must resolve for the service
  account; `install-services.ps1` sets it.

## Troubleshooting (host machine)

**Symptom: every page errors, `/health` says `Database connection failed`.**
Docker (Postgres + Vexa) is down. On this Windows host that has two known
causes - check the first one first:

1. **The system drive is nearly full.** Under memory pressure Windows grows
   `pagefile.sys` by several GB, and Docker's WSL2 disk image
   (`%LOCALAPPDATA%\Docker\wsl\disk\docker_data.vhdx`) can no longer grow, so
   the VM dies. **Keep at least ~10 GB free on `C:`.** Large, safe wins:
   Downloads, Disk Cleanup -> "Windows Update Cleanup", `npm cache clean --force`.
2. WSL2 networking wedged after sleep/resume (see
   [VEXA_SETUP.md](VEXA_SETUP.md), "Windows host setup").

Why the drive fills: the WSL2/Docker VM alone can commit 10+ GB of memory
(`vmmemWSL`), and Windows backs that with a system-managed `pagefile.sys` on
`C:` that grows (observed 16 GB -> 24 GB in one session) and only shrinks on
reboot. A reboot is therefore the quickest way to get several GB back. To
stop the VM from claiming so much, optionally cap it in
`%UserProfile%\.wslconfig` (then `wsl --shutdown`; trade-off: Docker has less
memory to work with):

```ini
[wsl2]
networkingMode=mirrored
memory=6GB
swap=0
```

Recovery:

```powershell
wsl --shutdown
# then start Docker Desktop from the Start menu and wait for "Engine running"
docker start fireflies-clone-postgres vexa-v012-postgres-1 vexa-v012-redis-1 vexa-v012-minio-1
# ...then the rest of the vexa-v012-* and transcription-* containers
```

Containers use `restart: unless-stopped` and normally come back on their own;
`docker ps -a` shows what didn't. The backend reconnects by itself (the
connection pool pings connections before use), no restart needed.

**Don't force-kill Docker Desktop.** It leaves stale unix-socket files that
make the next start fail with `...listening on unix://...: remove ...: The
file cannot be accessed by the system`. They can't be deleted directly -
rename their folders instead, then start Docker Desktop again (never choose
"Reset to factory defaults": that wipes all container data):

```powershell
Rename-Item "$env:LOCALAPPDATA\Docker\run" "run.stale"
Rename-Item "$env:LOCALAPPDATA\docker-secrets-engine" "docker-secrets-engine.stale"
```

## Verification checklist

- `curl https://<funnel-host>/health` → `{"status":"ok","database":"connected"}`
- `curl https://<frontend>/api/health` returns the same (proves the proxy)
- Register (invite code) / login / logout in a browser, also with
  third-party cookies blocked
- Open a meeting with audio, play and seek (`206 Partial Content` on `Range`)
- Upload an audio file; ask `/chat` a question about a meeting
