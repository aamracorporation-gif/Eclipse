param(
  [string]$OutputFile = "supabase\functions\apple-wallet-generator\bundledAssets.ts"
)

$ErrorActionPreference = "Stop"

$root = Get-Location

function Get-B64([string]$path) {
  return [Convert]::ToBase64String([IO.File]::ReadAllBytes($path))
}

$icon = Get-B64 (Join-Path $root "assets\wallet-pass\icon.png")
$logo = Get-B64 (Join-Path $root "assets\wallet-pass\logo.png")
$footer = Get-B64 (Join-Path $root "assets\wallet-pass\footer.png")
$music = Get-B64 (Join-Path $root "assets\wallet-pass\strip_music.png")
$sports = Get-B64 (Join-Path $root "assets\wallet-pass\strip_sports.png")
$corporate = Get-B64 (Join-Path $root "assets\wallet-pass\strip_corporate.png")
$art = Get-B64 (Join-Path $root "assets\wallet-pass\strip_art.png")
$default = Get-B64 (Join-Path $root "assets\wallet-pass\strip_default.png")

$content = @"
export const BUNDLED_ICON_PNG_BASE64 = '$icon';
export const BUNDLED_LOGO_PNG_BASE64 = '$logo';
export const BUNDLED_FOOTER_PNG_BASE64 = '$footer';
export const BUNDLED_STRIP_PNG_BASE64_MUSIC = '$music';
export const BUNDLED_STRIP_PNG_BASE64_SPORTS = '$sports';
export const BUNDLED_STRIP_PNG_BASE64_CORPORATE = '$corporate';
export const BUNDLED_STRIP_PNG_BASE64_ART = '$art';
export const BUNDLED_STRIP_PNG_BASE64_DEFAULT = '$default';
"@

$dest = Join-Path $root $OutputFile
[IO.File]::WriteAllText($dest, $content, [Text.UTF8Encoding]::new($false))
Write-Host $dest
