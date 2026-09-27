#Requires -Version 5.1
<#
.SYNOPSIS
  Deploys a CI-built GigaGarageSale package on the socha3 Windows server.

.DESCRIPTION
  Run by the self-hosted runner in .github/workflows/deploy.yml. It does the same
  job as scripts/post-deploy.ps1, except the UI arrives prebuilt (api\public\spa)
  and there are backup / health-check / rollback steps:

    1. Backs up the current code and api\node_modules to -BackupRoot.
    2. Stops the Node service and syncs the code from -Source.
       Server-only files are never touched: web.config, .env files, data\, logs\
       and anything else outside the synced folders.
    3. Runs npm ci for the API, makes sure data\ and web.config exist.
    4. Starts the service and polls the health endpoint.
    5. If anything fails after the service was stopped, restores the backup,
       restarts the service and exits with a non-zero code.

.EXAMPLE
  .\scripts\ci-deploy.ps1 -Source C:\temp\package -AppRoot C:\WebApps\GigaGarageSale
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [string]$AppRoot = "C:\WebApps\GigaGarageSale",
  [string]$BackupRoot = "C:\WebApps\_deploy-backups\GigaGarageSale",
  [string]$ServiceName = "GigaGarageSaleNode",
  [int]$Port = 3106,
  [string]$HealthUrl = "",
  [int]$HealthTimeoutSec = 90,
  [int]$KeepBackups = 5,
  [string]$Commit = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if (-not $HealthUrl) { $HealthUrl = "http://localhost:$Port/api/health" }
$HomeUrl = "http://localhost:$Port/"
$WinSW = "C:\Tools\WinSW\GigaGarageSaleNode.exe"

# Folders CI owns: mirrored exactly (files removed from the repo are removed here too).
$MirrorDirs = @("api\src", "api\public", "shared", "scripts", "ui\src", "ui\public")
# Folders whose top-level files CI owns: copied/overwritten, never deleted.
$FileDirs = @("", "api", "ui")
# Never copied over, never deleted.
$PreserveFiles = @("web.config", ".env", "*.env", ".env.*")

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "=== $Message ===" -ForegroundColor Cyan
}

# Runs a native command without letting stderr output abort the script; returns the exit code.
function Invoke-Native([string]$Exe, [string[]]$Arguments) {
  $old = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $Exe @Arguments 2>&1 | ForEach-Object { Write-Host "$_" }
    return $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $old
  }
}

function Invoke-Robocopy([string]$From, [string]$To, [string[]]$Options) {
  $code = Invoke-Native "robocopy.exe" (@($From, $To) + $Options + @("/R:2", "/W:2", "/NP", "/NFL", "/NDL", "/NJH"))
  if ($code -ge 8) { throw "robocopy '$From' -> '$To' failed (exit code $code)" }
}

# Copies the CI-owned code from $From to $To (used for deploy and for rollback).
function Sync-Code([string]$From, [string]$To, [switch]$IncludeApiNodeModules) {
  $dirs = $MirrorDirs
  if ($IncludeApiNodeModules) { $dirs = $dirs + "api\node_modules" }
  foreach ($d in $dirs) {
    $src = Join-Path $From $d
    if (Test-Path -LiteralPath $src) {
      Invoke-Robocopy $src (Join-Path $To $d) (@("/MIR", "/XF") + $PreserveFiles)
    }
  }
  foreach ($d in $FileDirs) {
    $src = if ($d) { Join-Path $From $d } else { $From }
    $dst = if ($d) { Join-Path $To $d } else { $To }
    if (Test-Path -LiteralPath $src) {
      Invoke-Robocopy $src $dst (@("/XF") + $PreserveFiles)
    }
  }
}

function Stop-App {
  $svc = Get-Service -Name $ServiceName
  if ($svc.Status -ne "Stopped") {
    try {
      Stop-Service -Name $ServiceName -Force -ErrorAction Stop
    } catch {
      if (Test-Path $WinSW) { Invoke-Native $WinSW @("stop") | Out-Null } else { throw }
    }
    (Get-Service -Name $ServiceName).WaitForStatus("Stopped", [TimeSpan]::FromSeconds(60))
  }
  Write-Host "Service $ServiceName stopped"
}

# Make sure no leftover node process still owns the port; otherwise the health
# check could pass against the old version while the new one fails to bind.
function Wait-PortFree {
  if (-not (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) { return }
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -eq 0) { return }
    Start-Sleep -Seconds 2
  }
  $owners = ($listeners | Select-Object -ExpandProperty OwningProcess -Unique) -join ", "
  throw "Port $Port is still in use after stopping $ServiceName (process id: $owners)"
}

function Start-App {
  try {
    Start-Service -Name $ServiceName -ErrorAction Stop
  } catch {
    if (Test-Path $WinSW) { Invoke-Native $WinSW @("start") | Out-Null } else { throw }
  }
  (Get-Service -Name $ServiceName).WaitForStatus("Running", [TimeSpan]::FromSeconds(60))
  Write-Host "Service $ServiceName running"
}

function Test-AppHealthy {
  $deadline = (Get-Date).AddSeconds($HealthTimeoutSec)
  $lastError = ""
  while ((Get-Date) -lt $deadline) {
    try {
      $health = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 5
      $json = $health.Content | ConvertFrom-Json
      if ($health.StatusCode -eq 200 -and $json.ok) {
        $page = Invoke-WebRequest -Uri $HomeUrl -UseBasicParsing -TimeoutSec 10
        if ($page.StatusCode -eq 200) {
          Write-Host ("GET {0} -> 200 {1}" -f $HealthUrl, $health.Content)
          Write-Host ("GET {0} -> 200" -f $HomeUrl)
          return $true
        }
      }
      $lastError = "unexpected response: $($health.StatusCode) $($health.Content)"
    } catch {
      $lastError = $_.Exception.Message
    }
    Start-Sleep -Seconds 3
  }
  Write-Host "Health check failed after $HealthTimeoutSec s: $lastError" -ForegroundColor Red
  return $false
}

function Get-Npm {
  $npm = "C:\Program Files\nodejs\npm.cmd"
  if (Test-Path $npm) { return $npm }
  $cmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw "npm.cmd not found (expected $npm)"
}

# ---------------------------------------------------------------- preflight
$Source = [System.IO.Path]::GetFullPath($Source)
$AppRoot = [System.IO.Path]::GetFullPath($AppRoot)
Write-Step "Deploying $(if ($Commit) { $Commit } else { 'package' }) from $Source to $AppRoot"

foreach ($required in @("api\src\index.ts", "api\package-lock.json", "api\public\spa\index.html")) {
  if (-not (Test-Path -LiteralPath (Join-Path $Source $required))) {
    throw "Package is missing $required - refusing to deploy."
  }
}
if (-not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) {
  throw "Service '$ServiceName' not found. Install the WinSW service first."
}
$npm = Get-Npm
New-Item -ItemType Directory -Path $AppRoot, $BackupRoot -Force | Out-Null

# ---------------------------------------------------------------- backup
$backup = $null
if (Test-Path -LiteralPath (Join-Path $AppRoot "api\src\index.ts")) {
  $backup = Join-Path $BackupRoot (Get-Date -Format "yyyyMMdd-HHmmss")
  Write-Step "Backing up current deploy to $backup"
  Sync-Code -From $AppRoot -To $backup -IncludeApiNodeModules
} else {
  Write-Step "No existing deploy found - first deploy, nothing to back up"
}

# ---------------------------------------------------------------- deploy
$stopped = $false
try {
  Write-Step "Stopping $ServiceName"
  Stop-App
  $stopped = $true
  Wait-PortFree

  Write-Step "Syncing code (preserving web.config, .env, data\, logs\)"
  Sync-Code -From $Source -To $AppRoot

  Write-Step "npm ci (api)"
  $apiRoot = Join-Path $AppRoot "api"
  Push-Location $apiRoot
  try {
    $code = Invoke-Native $npm @("ci", "--no-audit", "--no-fund")
    if ($code -ne 0) { throw "npm ci failed (exit code $code)" }
  } finally { Pop-Location }

  Write-Step "Ensuring data\ and web.config"
  New-Item -ItemType Directory -Path (Join-Path $AppRoot "data") -Force | Out-Null
  $webConfig = Join-Path $AppRoot "web.config"
  if (-not (Test-Path -LiteralPath $webConfig)) {
    $example = Join-Path $AppRoot "web.config.example"
    if (Test-Path -LiteralPath $example) {
      Copy-Item -LiteralPath $example -Destination $webConfig
      Write-Host "Created web.config from web.config.example"
    } else {
      Write-Host "WARNING: no web.config and no web.config.example; IIS proxying may not work" -ForegroundColor Yellow
    }
  } else {
    Write-Host "Keeping existing web.config"
  }
  Write-Step "Starting $ServiceName"
  Start-App

  Write-Step "Health check $HealthUrl"
  if (-not (Test-AppHealthy)) { throw "New version is not healthy" }
} catch {
  Write-Host ""
  Write-Host "DEPLOY FAILED: $($_.Exception.Message)" -ForegroundColor Red
  if ($stopped -and $backup) {
    Write-Step "Rolling back to $backup"
    try {
      Stop-App
      Sync-Code -From $backup -To $AppRoot -IncludeApiNodeModules
      Start-App
      if (Test-AppHealthy) {
        Write-Host "ROLLBACK OK - previous version is serving again" -ForegroundColor Yellow
      } else {
        Write-Host "ROLLBACK DONE BUT THE APP IS STILL UNHEALTHY - check the server" -ForegroundColor Red
      }
    } catch {
      Write-Host "ROLLBACK FAILED: $($_.Exception.Message) - check the server" -ForegroundColor Red
    }
  } elseif ($stopped) {
    Write-Host "No backup to roll back to (first deploy); trying to start the service anyway." -ForegroundColor Red
    try { Start-App } catch { Write-Host "Could not start ${ServiceName}: $($_.Exception.Message)" -ForegroundColor Red }
  } else {
    Write-Host "The service was not stopped, so nothing on the server was changed." -ForegroundColor Yellow
  }
  exit 1
}

# ---------------------------------------------------------------- tidy up
Write-Step "Pruning old backups (keeping $KeepBackups)"
Get-ChildItem -LiteralPath $BackupRoot -Directory |
  Sort-Object Name -Descending |
  Select-Object -Skip $KeepBackups |
  ForEach-Object { Write-Host "Removing $($_.FullName)"; Remove-Item -LiteralPath $_.FullName -Recurse -Force }

Write-Host ""
Write-Host "DEPLOY OK" -ForegroundColor Green
Write-Host "Public URL: https://gigagaragesale.socha3.com/"
exit 0
