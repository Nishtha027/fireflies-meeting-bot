# Runs the backend in production mode (no reload, 2 workers) with the
# production cookie/CORS environment. Foreground - Ctrl+C to stop.
#   powershell -ExecutionPolicy Bypass -File scripts\run-backend-prod.ps1

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "prod-env.ps1")
foreach ($k in $ProdBackendEnv.Keys) { Set-Item -Path "Env:$k" -Value $ProdBackendEnv[$k] }

$backendDir = Join-Path (Split-Path -Parent $PSScriptRoot) "backend"
Set-Location $backendDir
& (Join-Path $backendDir "venv\Scripts\python.exe") -m uvicorn main:app --workers 2 --port 8000
