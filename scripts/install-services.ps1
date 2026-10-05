#Requires -RunAsAdministrator
<#
Installs Meetscribe's backend (FastAPI/uvicorn) and frontend (Next.js) as
real Windows services via NSSM, so both auto-restart on crash and
auto-start on machine reboot - instead of needing a terminal kept open.

NSSM must already be installed (winget install NSSM.NSSM).

Run once, from an elevated PowerShell ("Run as Administrator"):
    powershell -ExecutionPolicy Bypass -File scripts\install-services.ps1

This also runs a self-test at the end: it force-kills each freshly
started process and confirms NSSM brings it back up on its own, so you
get proof the crash-recovery setup actually works, not just that the
services were created.
#>

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
if (-not (Test-Path $nextBin)) { throw "Next.js build not found at $nextBin - run 'npm run build' in frontend/ first." }

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
    & $nssm set $Name Start SERVICE_AUTO_START
    & $nssm set $Name DisplayName $Name
}

Write-Host "== Installing Meetscribe-Backend =="
Install-ManagedService -Name "Meetscribe-Backend" -Exe $pythonExe `
    -Arguments "-m uvicorn main:app --workers 2 --port 8000" -WorkDir $backendDir
$envExtra = ($ProdBackendEnv.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" })
& $nssm set Meetscribe-Backend AppEnvironmentExtra $envExtra

Write-Host "== Installing Meetscribe-Frontend =="
Install-ManagedService -Name "Meetscribe-Frontend" -Exe $nodeExe `
    -Arguments "`"$nextBin`" start -p 3000" -WorkDir $frontendDir

Write-Host "== Starting services =="
& $nssm start Meetscribe-Backend
& $nssm start Meetscribe-Frontend

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

function Get-ServicePid($Name) {
    (Get-CimInstance Win32_Service -Filter "Name='$Name'").ProcessId
}

Write-Host "== Waiting for backend (http://localhost:8000/docs) =="
if (-not (Wait-ForHttp "http://localhost:8000/docs" 90)) { throw "Backend did not come up in time." }
Write-Host "Backend is up."

Write-Host "== Waiting for frontend (http://localhost:3000) =="
if (-not (Wait-ForHttp "http://localhost:3000" 60)) { throw "Frontend did not come up in time." }
Write-Host "Frontend is up."

Write-Host ""
Write-Host "== Crash-recovery self-test =="

foreach ($svc in @("Meetscribe-Backend", "Meetscribe-Frontend")) {
    $url = if ($svc -eq "Meetscribe-Backend") { "http://localhost:8000/docs" } else { "http://localhost:3000" }
    $beforePid = Get-ServicePid $svc
    Write-Host "$svc running as PID $beforePid - force-killing it..."
    Stop-Process -Id $beforePid -Force
    Start-Sleep -Seconds 2

    $recovered = Wait-ForHttp $url 60
    $afterPid = Get-ServicePid $svc
    if ($recovered -and $afterPid -and $afterPid -ne $beforePid) {
        Write-Host "PASS: $svc auto-restarted (old PID $beforePid -> new PID $afterPid), responding again."
    } else {
        Write-Host "FAIL: $svc did not recover cleanly (old PID $beforePid, new PID $afterPid, responding=$recovered)."
    }
}

Write-Host ""
Write-Host "== Final status =="
Get-Service Meetscribe-Backend, Meetscribe-Frontend | Format-Table Name, Status, StartType

Write-Host ""
Write-Host "Done. Both services are set to Automatic start, so they'll also come up on reboot."
Write-Host "Logs: $backendDir\service-std*.log and $frontendDir\service-std*.log"
