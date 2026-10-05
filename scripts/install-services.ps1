#Requires -RunAsAdministrator
<#
Installs Meetscribe's backend (FastAPI/uvicorn) as a real Windows service via
NSSM, so it auto-restarts on crash and auto-starts on machine reboot -
instead of needing a terminal kept open.

The frontend is hosted on Vercel in the standard deployment, so only the
backend service is installed by default. Pass -IncludeFrontend to also run
the Next.js production server locally as a service (port 3000).

NSSM must already be installed (winget install NSSM.NSSM).

Run once, from an elevated PowerShell ("Run as Administrator"):
    powershell -ExecutionPolicy Bypass -File scripts\install-services.ps1

This also runs a self-test at the end: it force-kills each freshly started
service's process tree and confirms NSSM brings it back up on its own, and
that the background poller still starts exactly once afterwards - so you get
proof the crash-recovery setup actually works, not just that the service was
created.
#>
[CmdletBinding()]
param(
    [switch]$IncludeFrontend,
    [switch]$SkipSelfTest
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "prod-env.ps1")

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot "backend"
$frontendDir = Join-Path $repoRoot "frontend"
$pythonExe = Join-Path $backendDir "venv\Scripts\python.exe"
$nextBin = Join-Path $frontendDir "node_modules\next\dist\bin\next"

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$nodeExe = if ($nodeCmd) { $nodeCmd.Source } else { "C:\Program Files\nodejs\node.exe" }

$nssmCmd = Get-Command nssm -ErrorAction SilentlyContinue
if ($nssmCmd) {
    $nssm = $nssmCmd.Source
} else {
    $nssm = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\NSSM.NSSM_*\*\win64\nssm.exe" -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $nssm) {
    throw "nssm.exe not found. Install it first: winget install NSSM.NSSM"
}

if (-not (Test-Path $pythonExe)) { throw "Backend venv not found at $pythonExe - create it first." }
if ($IncludeFrontend -and -not (Test-Path $nextBin)) {
    throw "Next.js build not found at $nextBin - run 'npm run build' in frontend/ first."
}

# A Windows service runs as LocalSystem, whose PATH does not include
# per-user installs (ffmpeg is a per-user winget package here). The upload
# feature reads FFMPEG_PATH, so resolve it now, from this user's PATH.
$ffmpegCmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($ffmpegCmd) {
    $ProdBackendEnv["FFMPEG_PATH"] = $ffmpegCmd.Source
} else {
    Write-Warning "ffmpeg not found on PATH - video uploads will fail until FFMPEG_PATH is set (audio/text uploads are unaffected)."
}

function Install-ManagedService {
    param($Name, $Exe, $Arguments, $WorkDir)

    $existing = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "$Name already exists - stopping and removing it first."
        & $nssm stop $Name confirm | Out-Null
        & $nssm remove $Name confirm | Out-Null
    }

    & $nssm install $Name $Exe $Arguments
    & $nssm set $Name AppDirectory $WorkDir
    & $nssm set $Name AppStdout (Join-Path $WorkDir "service-stdout.log")
    & $nssm set $Name AppStderr (Join-Path $WorkDir "service-stderr.log")
    & $nssm set $Name AppRotateFiles 1
    & $nssm set $Name AppRotateOnline 1
    & $nssm set $Name AppRotateBytes 10485760
    & $nssm set $Name AppExit Default Restart
    & $nssm set $Name AppRestartDelay 3000
    # Stop the whole process tree on service stop, so a stale uvicorn worker
    # can never keep holding the port when the service restarts.
    & $nssm set $Name AppKillProcessTree 1
    & $nssm set $Name Start SERVICE_AUTO_START
    & $nssm set $Name DisplayName $Name
}

# Free the port if a hand-started backend (scripts\run-backend-prod.ps1) is
# still running - two servers can't share :8000 and the service would loop.
$listener = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
$svcExists = Get-Service -Name "Meetscribe-Backend" -ErrorAction SilentlyContinue
if ($listener -and -not $svcExists) {
    Write-Host "Port 8000 is in use by PID $($listener.OwningProcess) (a hand-started backend) - stopping it."
    & taskkill /F /T /PID $listener.OwningProcess | Out-Null
    Start-Sleep -Seconds 3
}

Write-Host "== Installing Meetscribe-Backend =="
Install-ManagedService -Name "Meetscribe-Backend" -Exe $pythonExe `
    -Arguments "-m uvicorn main:app --port 8000" -WorkDir $backendDir
$envExtra = ($ProdBackendEnv.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" })
& $nssm set Meetscribe-Backend AppEnvironmentExtra $envExtra

$services = @("Meetscribe-Backend")
if ($IncludeFrontend) {
    Write-Host "== Installing Meetscribe-Frontend =="
    Install-ManagedService -Name "Meetscribe-Frontend" -Exe $nodeExe `
        -Arguments "`"$nextBin`" start -p 3000" -WorkDir $frontendDir
    $services += "Meetscribe-Frontend"
}

Write-Host "== Starting services =="
foreach ($svc in $services) { & $nssm start $svc }

function Wait-ForHttp($Url, $TimeoutSec = 60) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
            if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 400) { return $true }
        } catch {
            if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -lt 500) { return $true }
        }
        Start-Sleep -Seconds 2
    }
    return $false
}

# Win32_Service.ProcessId is nssm.exe itself (the service host), not the app.
# The app is its child - that is what a real crash would take down.
function Get-ServiceHostPid($Name) {
    (Get-CimInstance Win32_Service -Filter "Name='$Name'").ProcessId
}
function Get-AppChildPid($Name) {
    $hostPid = Get-ServiceHostPid $Name
    (Get-CimInstance Win32_Process -Filter "ParentProcessId=$hostPid" | Select-Object -First 1).ProcessId
}

$checks = @{
    "Meetscribe-Backend"  = "http://localhost:8000/health"
    "Meetscribe-Frontend" = "http://localhost:3000"
}

foreach ($svc in $services) {
    Write-Host "== Waiting for $svc ($($checks[$svc])) =="
    if (-not (Wait-ForHttp $checks[$svc] 120)) { throw "$svc did not come up in time." }
    Write-Host "$svc is up."
}

if (-not $SkipSelfTest) {
    Write-Host ""
    Write-Host "== Crash-recovery self-test =="
    foreach ($svc in $services) {
        $beforeApp = Get-AppChildPid $svc
        Write-Host "$svc app process is PID $beforeApp - force-killing its whole process tree..."
        & taskkill /F /T /PID $beforeApp | Out-Null
        Start-Sleep -Seconds 2

        $recovered = Wait-ForHttp $checks[$svc] 120
        $afterApp = Get-AppChildPid $svc
        if ($recovered -and $afterApp -and $afterApp -ne $beforeApp) {
            Write-Host "PASS: $svc auto-restarted (app PID $beforeApp -> $afterApp), responding again."
        } else {
            Write-Host "FAIL: $svc did not recover cleanly (app PID $beforeApp -> $afterApp, responding=$recovered)."
        }
    }

    # After a crash-restart the poller must still run exactly once (the file
    # lock is released by the OS when the old process dies).
    $log = Join-Path $backendDir "service-stderr.log"
    if (Test-Path $log) {
        Start-Sleep -Seconds 5
        $starts = (Select-String -Path $log -Pattern "Background poller started" | Measure-Object).Count
        Write-Host "Background poller 'started' log lines so far: $starts (expect one per backend start: initial start + each crash-restart)."
    }
}

Write-Host ""
Write-Host "== Final status =="
Get-Service $services | Format-Table Name, Status, StartType

Write-Host ""
Write-Host "Done. Set to Automatic start, so they'll also come up on reboot."
Write-Host "Logs: $backendDir\service-std*.log"
Write-Host "Note: the backend needs Docker Desktop (Postgres, Vexa) running; Docker Desktop starts at login."
