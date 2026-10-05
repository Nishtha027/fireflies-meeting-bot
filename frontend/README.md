# Meetscribe frontend

The Next.js 16 (App Router) dashboard for [Meetscribe](../README.md). React 19, TypeScript, Tailwind CSS 4.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
```

It talks to the FastAPI backend at `http://localhost:8000` by default, so no configuration is needed for local development (start the backend first - see the [root README](../README.md#getting-started-local-development)).

Other scripts: `npm run build`, `npm run start`, `npm run lint`.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | API base URL baked into the client bundle at build time. Set to `/api` in production. |
| `API_PROXY_TARGET` | unset | Production only. When set, `next.config.ts` rewrites `/api/*` to this backend URL, which makes the session cookie first-party. Build-time. |

Both are inlined at build time, so changing either needs a rebuild/redeploy. Why the proxy exists, and how to deploy, is in [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md).

## Layout

```
src/app/            Routes: / (Home), /meetings, /meetings/[id], /tasks, /chat,
                    /search, /analytics, /settings, /login, /register
src/components/     UI building blocks (transcript view, audio player, modals, charts...)
src/lib/            API client (api.ts), formatting helpers
```

Pages other than `/login` and `/register` require a session; unauthenticated visits are redirected to `/login`.
