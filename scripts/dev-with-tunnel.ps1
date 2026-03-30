# Start backend + Vite (if needed) and print a public trycloudflare.com URL.
# Run from repo root:  powershell -ExecutionPolicy Bypass -File .\scripts\dev-with-tunnel.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$cf = Join-Path $root "tools\cloudflared.exe"
if (-not (Test-Path $cf)) {
  Write-Host "Downloading cloudflared..."
  New-Item -ItemType Directory -Force -Path (Split-Path $cf) | Out-Null
  $url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
  Invoke-WebRequest -Uri $url -OutFile $cf -UseBasicParsing
}

function Test-Api {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:3001/api/health" -UseBasicParsing -TimeoutSec 2
    return $r.Content -eq "ok"
  } catch { return $false }
}

function Test-Vite {
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:5173/" -UseBasicParsing -TimeoutSec 2
    return $r.StatusCode -eq 200
  } catch { return $false }
}

if (-not (Test-Api)) {
  $exe = Join-Path $root "backend\target\release\mt5-panel-api.exe"
  if (-not (Test-Path $exe)) {
    Write-Host "Building backend..."
    Push-Location (Join-Path $root "backend")
    cargo build --release
    Pop-Location
  }
  Write-Host "Starting API on :3001..."
  Start-Process -FilePath $exe -WorkingDirectory (Join-Path $root "backend") -WindowStyle Hidden
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    if (Test-Api) { break }
    Start-Sleep -Milliseconds 400
  }
  if (-not (Test-Api)) { throw "API did not become ready on port 3001" }
}

if (-not (Test-Vite)) {
  Write-Host "Starting Vite on :5173..."
  Start-Process powershell -ArgumentList "-NoProfile", "-Command", "cd `"$root\frontend`"; npm run dev" -WindowStyle Normal
  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline) {
    if (Test-Vite) { break }
    Start-Sleep -Milliseconds 500
  }
  if (-not (Test-Vite)) { throw "Vite did not become ready on port 5173 (close anything else using 5173)" }
}

Write-Host ""
Write-Host "Starting Cloudflare quick tunnel (Ctrl+C to stop)..."
Write-Host ""
& $cf tunnel --url http://localhost:5173
