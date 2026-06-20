param(
  [string]$OutputFile = "supabase\functions\apple-wallet-generator\bundledAssets.ts"
)

$ErrorActionPreference = "Stop"
$root = Get-Location

function Get-B64([string]$path) {
  return [Convert]::ToBase64String([IO.File]::ReadAllBytes($path))
}

$icon      = Get-B64 (Join-Path $root "assets\wallet-pass\icon.png")
$logo      = Get-B64 (Join-Path $root "assets\wallet-pass\logo.png")
$footer    = Get-B64 (Join-Path $root "assets\wallet-pass\footer.png")
$standard  = Get-B64 (Join-Path $root "assets\wallet-pass\strip_standard.png")
$premium   = Get-B64 (Join-Path $root "assets\wallet-pass\strip_premium.png")
$vip       = Get-B64 (Join-Path $root "assets\wallet-pass\strip_vip.png")
$legendary = Get-B64 (Join-Path $root "assets\wallet-pass\strip_legendary.png")

$content = @"
// AUTO-GENERATED — do not edit manually
// Regenerate: node scripts/generate_eclipse_wallet_assets.mjs
//         then .\scripts\generate_wallet_assets_module.ps1

export const BUNDLED_ICON_PNG_BASE64            = '$icon';
export const BUNDLED_LOGO_PNG_BASE64            = '$logo';
export const BUNDLED_FOOTER_PNG_BASE64          = '$footer';
export const BUNDLED_STRIP_PNG_BASE64_STANDARD  = '$standard';
export const BUNDLED_STRIP_PNG_BASE64_PREMIUM   = '$premium';
export const BUNDLED_STRIP_PNG_BASE64_VIP       = '$vip';
export const BUNDLED_STRIP_PNG_BASE64_LEGENDARY = '$legendary';
"@

$dest = Join-Path $root $OutputFile
[IO.File]::WriteAllText($dest, $content, [Text.UTF8Encoding]::new($false))
Write-Host "Written: $dest  ($([math]::Round((Get-Item $dest).Length/1KB)) KB)"
