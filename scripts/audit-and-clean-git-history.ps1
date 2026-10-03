param(
  [switch]$Execute,
  [string]$Remote = "origin"
)
$ErrorActionPreference = "Stop"

Write-Host "Scanning the current history with gitleaks..."
gitleaks git --redact
if (-not $Execute) {
  Write-Host "Dry run only. Rotate exposed credentials first, then rerun with -Execute."
  exit 0
}

if ($env:CONFIRM_HISTORY_REWRITE -ne "I_HAVE_ROTATED_ALL_SECRETS") {
  throw "Set CONFIRM_HISTORY_REWRITE=I_HAVE_ROTATED_ALL_SECRETS after rotating every exposed credential."
}

git filter-repo --sensitive-data-removal --invert-paths `
  --path-glob '.env*' --path-glob '*.jks' --path-glob '*.keystore' `
  --path-glob 'google-services.json' --path-glob 'GoogleService-Info.plist'
git push --force --mirror $Remote
Write-Host "History rewritten. Every collaborator must clone again; revoke old deploy tokens too."
