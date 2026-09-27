#Requires -Version 5.1
<#
.SYNOPSIS
  Post-deploy for GigaGarageSale on socha3 (IIS + WinSW Node API).
#>
[CmdletBinding()]
param(
  [string]$AppRoot = "",
  [int]$Port = 3106,
  [string]$ServiceName = "GigaGarageSaleNode",
  [switch]$SkipNpm,
  [switch]$SkipUiBuild
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "=== $Message ===" -ForegroundColor Cyan
}

if (-not $AppRoot) {
  $here = $PSScriptRoot
  if ($here -and (Split-Path -Leaf $here) -eq "scripts") {
    $AppRoot = Split-Path -Parent $here
  } else {
    $AppRoot = "C:\WebApps\GigaGarageSale"
  }
}

$AppRoot = [System.IO.Path]::GetFullPath($AppRoot)
Write-Step "AppRoot: $AppRoot"
$apiRoot = Join-Path $AppRoot "api"
$uiRoot = Join-Path $AppRoot "ui"
if (-not (Test-Path -LiteralPath (Join-Path $apiRoot "src\index.ts"))) {
  throw "api\src\index.ts not found under $AppRoot - copy the app first, then re-run."
}

$webConfigPath = Join-Path $AppRoot "web.config"
$dataDir = Join-Path $AppRoot "data"
$npm = "C:\Program Files\nodejs\npm.cmd"
$npx = "C:\Program Files\nodejs\npx.cmd"

Write-Step "Ensure data directory"
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null

Write-Step "Ensure IIS ARR web.config (create only if missing)"
if (-not (Test-Path -LiteralPath $webConfigPath)) {
  @"
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <clear />
        <rule name="GigaGarageSaleNode" stopProcessing="true">
          <match url="(.*)" />
          <action type="Rewrite" url="http://localhost:$Port/{R:1}" />
        </rule>
      </rules>
    </rewrite>
    <httpErrors existingResponse="PassThrough" />
    <webSocket enabled="true" />
  </system.webServer>
</configuration>
"@ | Set-Content -LiteralPath $webConfigPath -Encoding UTF8
  Write-Host "Wrote new web.config -> localhost:$Port"
} else {
  Write-Host "Keeping existing web.config"
}

if (-not $SkipNpm) {
  Write-Step "npm install api"
  Push-Location $apiRoot
  try {
    if (Test-Path (Join-Path $apiRoot "package-lock.json")) {
      & $npm ci
      if ($LASTEXITCODE -ne 0) { & $npm install }
    } else {
      & $npm install
    }
    if ($LASTEXITCODE -ne 0) { throw "api npm install failed" }
  } finally { Pop-Location }

  if (-not $SkipUiBuild) {
    Write-Step "npm install + build ui"
    Push-Location $uiRoot
    try {
      if (Test-Path (Join-Path $uiRoot "package-lock.json")) {
        & $npm ci
        if ($LASTEXITCODE -ne 0) { & $npm install }
      } else {
        & $npm install
      }
      if ($LASTEXITCODE -ne 0) { throw "ui npm install failed" }
      & $npx --yes ng build --configuration production
      if ($LASTEXITCODE -ne 0) { throw "ng build failed" }
    } finally { Pop-Location }

    Write-Step "Copy Angular dist into api/public/spa"
    $spa = Join-Path $apiRoot "public\spa"
    if (Test-Path $spa) { Remove-Item $spa -Recurse -Force }
    New-Item -ItemType Directory -Path $spa -Force | Out-Null
    $candidates = @(
      (Join-Path $uiRoot "dist\giga-garage-sale\browser"),
      (Join-Path $uiRoot "dist\giga-garage-sale"),
      (Join-Path $uiRoot "dist\GigaGarageSale\browser"),
      (Join-Path $uiRoot "dist\GigaGarageSale")
    )
    $src = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $src) { throw "Angular dist folder not found under ui\dist" }
    Write-Host "Using dist: $src"
    Copy-Item -Path (Join-Path $src "*") -Destination $spa -Recurse -Force
  }
} else {
  Write-Step "Skipping npm (-SkipNpm)"
}

Write-Step "Restart service $ServiceName"
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
  throw "Service '$ServiceName' not found. Install WinSW first."
}
$winsw = "C:\Tools\WinSW\GigaGarageSaleNode.exe"
try {
  Restart-Service -Name $ServiceName -Force -ErrorAction Stop
} catch {
  if (Test-Path $winsw) { & $winsw restart } else { throw }
}
Start-Sleep -Seconds 3
$svc = Get-Service -Name $ServiceName
if ($svc.Status -ne "Running" -and (Test-Path $winsw)) {
  & $winsw start
  Start-Sleep -Seconds 3
  $svc = Get-Service -Name $ServiceName
}
if ($svc.Status -ne "Running") {
  throw "Service $ServiceName is $($svc.Status) after restart"
}
Write-Host "Service status: $($svc.Status)"

Write-Step "Smoke test"
$health = Invoke-WebRequest -Uri "http://localhost:$Port/api/health" -UseBasicParsing -TimeoutSec 20
Write-Host ("GET /api/health -> {0} {1}" -f [int]$health.StatusCode, $health.Content)
# $home is a read-only automatic variable in PowerShell, so use another name.
$homePage = Invoke-WebRequest -Uri "http://localhost:$Port/" -UseBasicParsing -TimeoutSec 20
Write-Host ("GET / -> {0}" -f [int]$homePage.StatusCode)

Write-Host ""
Write-Host "POST-DEPLOY OK" -ForegroundColor Green
Write-Host "Public URL: https://gigagaragesale.socha3.com/"
