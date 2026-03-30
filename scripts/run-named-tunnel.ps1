# Run a Cloudflare *named* tunnel using a token from Zero Trust (stable hostname on your domain).
# 1) Create tunnel in Cloudflare dashboard and copy the token.
# 2) setx CLOUDFLARE_TUNNEL_TOKEN "your-token"  (then open a NEW terminal)
#    or:  $env:CLOUDFLARE_TUNNEL_TOKEN = "your-token"
# 3) powershell -ExecutionPolicy Bypass -File .\scripts\run-named-tunnel.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$cf = Join-Path $root "tools\cloudflared.exe"
if (-not (Test-Path $cf)) {
  Write-Error "Missing tools\cloudflared.exe. See cloudflared\NAMED_TUNNEL.txt"
  exit 1
}
$t = $env:CLOUDFLARE_TUNNEL_TOKEN
if (-not $t) {
  Write-Error "Set environment variable CLOUDFLARE_TUNNEL_TOKEN (from Cloudflare Zero Trust tunnel)."
  exit 1
}
Write-Host "Starting named tunnel (Ctrl+C to stop)..."
& $cf tunnel run --token $t
