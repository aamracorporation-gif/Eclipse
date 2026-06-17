param(
  [string]$OutputFile = ".dbg\wallet-pass-secrets.env"
)

$ErrorActionPreference = "Stop"

$root = Get-Location
$pairs = @(
  @{ Name = "PASS_ICON_PNG_BASE64"; Path = (Join-Path $root "assets\wallet-pass\icon.png") },
  @{ Name = "PASS_LOGO_PNG_BASE64"; Path = (Join-Path $root "assets\wallet-pass\logo.png") },
  @{ Name = "PASS_STRIP_PNG_BASE64_VIP"; Path = (Join-Path $root "assets\wallet-pass\strip_vip.png") },
  @{ Name = "PASS_STRIP_PNG_BASE64_PREMIUM"; Path = (Join-Path $root "assets\wallet-pass\strip_premium.png") },
  @{ Name = "PASS_STRIP_PNG_BASE64_GOLD"; Path = (Join-Path $root "assets\wallet-pass\strip_gold.png") }
)

$lines = foreach ($pair in $pairs) {
  $bytes = [System.IO.File]::ReadAllBytes($pair.Path)
  $b64 = [Convert]::ToBase64String($bytes)
  "{0}={1}" -f $pair.Name, $b64
}

$dest = Join-Path $root $OutputFile
[System.IO.File]::WriteAllLines($dest, $lines, [System.Text.UTF8Encoding]::new($false))
Write-Host $dest
