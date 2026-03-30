# Quick public URL for the Vite dev server (proxies /api and /ws to the backend).
# Usage: after `npm run dev` in frontend/, run:
#   .\scripts\start-tunnel.ps1
# If Vite chose another port (see terminal), pass it:
#   .\scripts\start-tunnel.ps1 -Port 5174
param([int]$Port = 5173)

$root = Split-Path $PSScriptRoot -Parent
$cf = Join-Path $root "tools\cloudflared.exe"
if (-not (Test-Path $cf)) {
  Write-Error "Missing $cf — download cloudflared-windows-amd64.exe from https://github.com/cloudflare/cloudflared/releases and save as tools\cloudflared.exe"
  exit 1
}
& $cf tunnel --url "http://localhost:$Port"
