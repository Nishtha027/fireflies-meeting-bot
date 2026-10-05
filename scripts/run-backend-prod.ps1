# Runs the backend in production mode (no reload) with the production
# cookie/CORS environment. Foreground - Ctrl+C to stop.
#   powershell -ExecutionPolicy Bypass -File scripts\run-backend-prod.ps1
#
# ONE worker on purpose. /chat's vector store is an embedded, on-disk Chroma
# (backend/embeddings.py), which is single-process only: each uvicorn worker
# caches its own copy of the HNSW index, so a vector written by worker A is
# invisible to worker B and ~half of /chat calls fail with "Error finding
# id". Concurrency is not lost - the sync endpoints run in a 40-thread pool
# and the slow parts (Groq, Vexa, torch) release the GIL or wait on I/O.
# To scale to several workers, move Chroma to its own server first.

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "prod-env.ps1")
foreach ($k in $ProdBackendEnv.Keys) { Set-Item -Path "Env:$k" -Value $ProdBackendEnv[$k] }

$backendDir = Join-Path (Split-Path -Parent $PSScriptRoot) "backend"
Set-Location $backendDir
& (Join-Path $backendDir "venv\Scripts\python.exe") -m uvicorn main:app --port 8000
