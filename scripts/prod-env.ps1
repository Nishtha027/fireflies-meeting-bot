# Production-only backend environment. Dot-sourced by run-backend-prod.ps1
# and install-services.ps1 so both use identical values.
#
# These are set as process environment variables, which python-dotenv does
# NOT override - so backend/.env (local dev: COOKIE_SECURE=false,
# COOKIE_SAMESITE=lax) is left untouched and `uvicorn --reload` for local
# dev keeps behaving exactly as before.
#
# The frontend (Vercel) and backend (Tailscale Funnel) are different sites,
# so the session cookie must be SameSite=None; Secure (both ends are HTTPS).
# CORS must list the exact frontend origin(s) - never "*" - because
# credentials are in play. Only the stable production URL is allowed;
# Vercel preview-deployment hostnames are intentionally NOT included.

$ProdBackendEnv = @{
    COOKIE_SECURE   = "true"
    COOKIE_SAMESITE = "none"
    CORS_ORIGINS    = "https://frontend-zeta-brown-62.vercel.app,http://localhost:3000"
}
